'use strict';

/* ============================================================
   오늘은 여기 — AI 리뷰 분석 세션 캐시 (Phase 1)

   Gemini 무료 한도를 지키는 장치다.
   같은 가게를 다시 열 때 AI에게 다시 묻지 않게 하는 것이 이 파일의 유일한 일이다.

   `review-cache.js`와 **같은 방식**이다 — sessionStorage, 접근 프로브, 메모리 폴백, LRU.
   별도 파일인 이유: UI-CONTRACT가 「리뷰 캐시 담당은 review-cache.js 하나뿐」이라고
   못박아 뒀다. 거기에 두 번째 책임을 얹지 않는다.

   **한 가지가 리뷰와 갈린다 — 여기서는 실패를 캐시하지 않는다.**
   리뷰의 `not_found`는 다시 물어도 답이 같은 **영구 실패**라 캐시할 값이 있었다.
   분석에는 그런 상태가 없다. 타임아웃·한도 초과·키 없음·형식 오류는 전부 시간이 지나면
   풀리므로, 캐시하면 고쳐도 탭을 새로 열기 전까지 고쳐지지 않은 것처럼 보인다.
   그 판단은 save.js의 shouldCacheAnalysis()가 하고, 이 파일은 넣으라는 것만 넣는다.

   클래식 스크립트다. 최상위 var는 window 속성이 되지 않으므로 명시적으로 붙인다.
   ============================================================ */

window.AnalysisCache = (function () {
  var KEY = 'oneul-yeogi:analysis:v1';

  /* 리뷰 캐시(120)보다 넉넉한 이유 — 분석 결과는 가게당 0.5KB 남짓이라
     리뷰 본문(2~3KB)보다 훨씬 가볍다. 넘으면 오래된 것부터 버린다. */
  var MAX_ENTRIES = 200;

  /* sessionStorage는 사파리 프라이빗 모드 등에서 접근만으로도 throw한다.
     review-cache.js와 같은 이유·같은 방식으로 실제 써보고 판단한다.
     못 쓰면 메모리로 폴백한다 — 새로고침하면 캐시가 비지만 기능은 죽지 않는다. */
  var available = (function () {
    try {
      var probe = KEY + ':probe';
      window.sessionStorage.setItem(probe, '1');
      window.sessionStorage.removeItem(probe);
      return true;
    } catch (error) {
      return false;
    }
  })();

  var memory = {};

  function read() {
    if (!available) return memory;

    var raw;
    try {
      raw = window.sessionStorage.getItem(KEY);
    } catch (error) {
      return memory;
    }
    if (!raw) return {};

    var parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      // 깨진 값이 남아 있으면 계속 실패하므로 지우고 빈 캐시로 시작한다.
      try { window.sessionStorage.removeItem(KEY); } catch (ignored) {}
      return {};
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed;
  }

  function write(map) {
    memory = map;
    if (!available) return;
    try {
      window.sessionStorage.setItem(KEY, JSON.stringify(map));
    } catch (error) {
      // 용량 초과·권한 없음. 이후 읽기도 메모리를 보게 되므로 어긋나지 않는다.
      available = false;
    }
  }

  /* 가장 오래 전에 넣은 것부터 버린다. at은 넣은 시각이다. */
  function evict(map) {
    var ids = Object.keys(map);
    if (ids.length <= MAX_ENTRIES) return map;

    ids.sort(function (a, b) { return (map[a].at || 0) - (map[b].at || 0); });
    for (var i = 0; i < ids.length - MAX_ENTRIES; i += 1) {
      delete map[ids[i]];
    }
    return map;
  }

  return {
    /* 캐시된 응답 봉투. 없으면 null.
       봉투는 /api/analyze가 준 것 그대로다 — { ok: true, analysis }.
       화면 쪽 분기가 네트워크 응답과 캐시에서 완전히 같아진다. */
    get: function (id) {
      if (!id) return null;
      var entry = read()[String(id)];
      if (!entry || typeof entry !== 'object' || typeof entry.envelope !== 'object') return null;
      return entry.envelope;
    },

    set: function (id, envelope) {
      if (!id || !envelope || typeof envelope !== 'object') return;
      var map = read();
      map[String(id)] = { envelope: envelope, at: Date.now() };
      write(evict(map));
    },

    has: function (id) {
      return this.get(id) !== null;
    },

    /* 캐시가 세션 동안 유지되는 환경인지. 폴백 상태를 알려주고 싶을 때 쓴다. */
    isPersistent: function () {
      return available;
    }
  };
})();
