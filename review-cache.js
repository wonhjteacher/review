'use strict';

/* ============================================================
   오늘은 여기 — 구글 리뷰 세션 캐시 (Phase 1)

   구글 Places 리뷰는 월 1,000건까지만 무료다.
   같은 가게를 다시 열 때 네트워크를 타지 않게 하는 것이 이 파일의 유일한 일이다.

   담아둔 곳(saved-places.js)과 달리 **sessionStorage**를 쓴다.
   리뷰는 남의 데이터이고 시간이 지나면 낡는다 —
   탭을 닫으면 같이 사라지는 편이 맞다. 영속시키면 몇 달 전 리뷰를 새것처럼 보여준다.

   **실패도 캐시한다.** 구글에 없는 가게를 연타하면
   '못 찾음'을 확인하는 호출만으로 무료 한도가 닳는다.

   클래식 스크립트다. 최상위 var는 window 속성이 되지 않으므로 명시적으로 붙인다.
   ============================================================ */

window.ReviewCache = (function () {
  var KEY = 'oneul-yeogi:reviews:v1';

  /* 리뷰 본문은 담아둔 곳보다 훨씬 무겁다(가게당 대략 2~3KB).
     한 세션에서 이만큼 넘게 열 일은 없고, 넘으면 오래된 것부터 버린다. */
  var MAX_ENTRIES = 120;

  /* sessionStorage는 사파리 프라이빗 모드 등에서 접근만으로도 throw한다.
     막힌 환경에서 접근만으로도 throw하므로 실제로 한 번 써보고 판단한다.
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
       봉투는 /api/reviews가 준 것 그대로다 — { ok: true, place } 또는 { ok: false, error }.
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
