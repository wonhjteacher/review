'use strict';

/* ============================================================
   오늘은 여기 — 담아둔 곳 저장소 (Phase 1)

   localStorage 얇은 래퍼. 담아둔 곳 배열 하나를 단일 키에 넣는다.

   클래식 스크립트다. 최상위 const는 window 속성이 되지 않으므로
   전역 객체를 명시적으로 만들어 붙인다.
   이름이 SavedPlaces인 이유 — window.Storage는 브라우저 내장 인터페이스라 쓸 수 없다.
   ============================================================ */

window.SavedPlaces = (function () {
  var KEY = 'oneul-yeogi:saved-places:v1';

  /* localStorage는 사파리 프라이빗 모드나 file:// 일부 환경에서 접근만으로도 throw한다.
     그래서 쓸 수 있는지 실제로 한 번 써보고 판단한다.
     못 쓰면 메모리 배열로 폴백한다 — 새로고침하면 사라지지만 페이지는 죽지 않는다. */
  var available = (function () {
    try {
      var probe = KEY + ':probe';
      window.localStorage.setItem(probe, '1');
      window.localStorage.removeItem(probe);
      return true;
    } catch (error) {
      return false;
    }
  })();

  var memory = [];

  /* 저장 항목 한 건의 형태를 여기서만 정한다.
     읽을 때도 통과시켜 다른 버전이 남긴 이상한 값이 화면까지 가지 않게 한다. */
  function normalize(item) {
    if (!item || typeof item !== 'object') return null;
    var id = typeof item.id === 'string' ? item.id : String(item.id == null ? '' : item.id);
    if (!id) return null;
    return {
      id: id,
      name: text(item.name),
      category: text(item.category),
      address: text(item.address),
      url: text(item.url),
      savedAt: typeof item.savedAt === 'number' ? item.savedAt : Date.now()
    };
  }

  function text(value) {
    return typeof value === 'string' ? value : (value == null ? '' : String(value));
  }

  function read() {
    if (!available) return memory.slice();

    var raw;
    try {
      raw = window.localStorage.getItem(KEY);
    } catch (error) {
      return memory.slice();
    }
    if (!raw) return [];

    var parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      // 깨진 값이 남아 있으면 계속 실패하므로 지우고 빈 목록으로 시작한다.
      try { window.localStorage.removeItem(KEY); } catch (ignored) {}
      return [];
    }
    if (!Array.isArray(parsed)) return [];

    var list = [];
    for (var i = 0; i < parsed.length; i += 1) {
      var item = normalize(parsed[i]);
      if (item) list.push(item);
    }
    return list;
  }

  /* 쓰기에 실패하면(용량 초과·권한 없음) 메모리로 내려앉는다.
     이후 읽기도 메모리를 보게 되므로 화면과 저장소가 어긋나지 않는다. */
  function write(list) {
    memory = list.slice();
    if (!available) return false;
    try {
      window.localStorage.setItem(KEY, JSON.stringify(list));
      return true;
    } catch (error) {
      available = false;
      return false;
    }
  }

  function indexOfId(list, id) {
    for (var i = 0; i < list.length; i += 1) {
      if (list[i].id === id) return i;
    }
    return -1;
  }

  return {
    /* 담아둔 곳 전체. 최근에 담은 것이 앞으로 온다.
       Date.now()는 밀리초라 연달아 담으면 savedAt이 같아질 수 있다.
       저장 배열은 담은 순서이므로 먼저 뒤집어 두면, 안정 정렬(ES2019)이
       savedAt이 같은 항목의 순서를 그대로 유지해 나중에 담은 쪽이 앞에 남는다. */
    list: function () {
      return read().reverse().sort(function (a, b) { return b.savedAt - a.savedAt; });
    },

    /* 담기. 이미 있으면 아무것도 하지 않고 false. */
    add: function (place) {
      var item = normalize(place);
      if (!item) return false;

      var list = read();
      if (indexOfId(list, item.id) !== -1) return false;

      list.push(item);
      write(list);
      return true;
    },

    /* 해제. 없던 항목이면 false. */
    remove: function (id) {
      var key = text(id);
      var list = read();
      var at = indexOfId(list, key);
      if (at === -1) return false;

      list.splice(at, 1);
      write(list);
      return true;
    },

    has: function (id) {
      return indexOfId(read(), text(id)) !== -1;
    },

    count: function () {
      return read().length;
    },

    /* 저장이 실제로 유지되는 환경인지. 폴백 상태를 화면에서 알려주고 싶을 때 쓴다. */
    isPersistent: function () {
      return available;
    }
  };
})();
