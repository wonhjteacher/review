'use strict';

/* ============================================================
   오늘은 여기 — 담아둔 곳 저장소 (Phase 1, 계정 저장)

   storage.js(localStorage)를 **대체한다.** 두 방식이 섞이지 않도록
   그 파일은 지웠다. 저장소는 이제 Supabase `saved_places` 하나뿐이다.

   ── 왜 이런 모양인가 ────────────────────────────────────────
   localStorage는 동기라 `has(id)`가 즉시 답했다. Supabase는 네트워크다.
   그런데 save.js의 renderResults()는 카드를 그리는 **도중에** 담김 여부를
   물어본다 — 거기서 기다릴 수 없다.

   그래서 화면과 저장을 갈라놓는다:
     · 로그인하면 내 목록을 한 번 받아 메모리 색인에 넣는다
     · has()·list()·count()는 그 색인만 본다 → 그대로 동기
     · add()·remove()는 Promise를 돌려준다 → 부르는 쪽이 결과를 기다린다

   ── RLS에 맡긴다 ────────────────────────────────────────────
   읽을 때 `user_id`로 거르지 않는다. 조건 없이 전체를 요청하고
   내 것만 돌아오는 것은 **서버(RLS) 담당이다.** 넣을 때도 user_id를
   싣지 않는다 — 컬럼 기본값 auth.uid()가 채운다.

   클래식 스크립트다. 최상위 var는 window 속성이 되지 않으므로
   전역 객체를 명시적으로 만들어 붙인다.
   이름이 SavedPlaces인 이유 — window.Storage는 브라우저 내장 인터페이스라 쓸 수 없다.
   ============================================================ */

window.SavedPlaces = (function () {
  var TABLE = 'saved_places';

  /* 최신순으로 정렬된 정규화 항목. 화면이 읽는 유일한 원본이다. */
  var cache = [];
  /* place_id → 항목. has()가 O(1)로 답하게 한다. */
  var index = Object.create(null);

  var listeners = [];
  var loaded = false;        // 한 번이라도 서버 응답을 받아봤는가
  var loadError = null;      // 마지막 읽기 실패 (화면에서 알려주려고 들고 있다)

  /* 연타·느린 응답 경합 방지. 로그인/로그아웃을 빠르게 오가면
     먼저 보낸 응답이 뒤늦게 도착해 최신 상태를 덮을 수 있다. */
  var seq = 0;

  var resolveReady;
  var readyPromise = new Promise(function (resolve) { resolveReady = resolve; });
  var readyResolved = false;

  /* ── 클라이언트 ──────────────────────────────────────────────
     auth.js가 창구다. window.supabase를 직접 잡지 않는다.
     CDN이 막히면 null이므로 쓰는 쪽마다 확인한다. */
  function db() {
    if (!window.Auth || typeof window.Auth.client !== 'function') return null;
    return window.Auth.client();
  }

  function signedIn() {
    return !!(window.Auth && window.Auth.isSignedIn());
  }

  /* ── 정규화 ──────────────────────────────────────────────────
     DB 컬럼명을 화면까지 끌고 가지 않는다. 저장 항목 한 건의 형태를
     여기서만 정해서, 컬럼이 바뀌어도 고칠 곳이 이 함수 하나가 되게 한다.

     좌표는 문자열 그대로 둔다 — ⑬에 따라 x가 경도, y가 위도이고
     Number("")는 NaN이 아니라 0이라 여기서 숫자로 바꾸면
     좌표 없는 항목이 조용히 기니만 앞바다를 가리킨다. */
  function normalize(row) {
    if (!row || typeof row !== 'object') return null;
    var placeId = text(row.place_id);
    if (!placeId) return null;

    var at = Date.parse(row.created_at);
    var visited = row.visited_at == null ? NaN : Date.parse(row.visited_at);

    return {
      rowId: text(row.id),           // 행 자체의 uuid. 삭제할 때 쓴다
      id: placeId,                   // 카카오 place id. 화면이 가게를 가리키는 키
      name: text(row.place_name),
      address: text(row.road_address_name),
      x: text(row.x),
      y: text(row.y),
      url: text(row.place_url),
      savedAt: isNaN(at) ? 0 : at,   // 담은 시각(ms)

      /* ── 방문 기록 ────────────────────────────────────────────
         **`visitedAt`이 `null`인지가 「가볼 곳/가본 곳」을 가르는 유일한 기준이다.**
         0으로 접지 않는 이유 — 0은 1970년이라 「다녀왔다」로 읽힌다.
         파싱에 실패한 값도 null로 모아 「안 갔다」쪽에 둔다. 기록이 깨졌을 때
         가본 곳에 날짜 없는 카드가 서는 것보다 가볼 곳에 남는 편이 덜 이상하다. */
      visitedAt: isNaN(visited) ? null : visited,

      note: text(row.note),

      /* **`null`(아직 안 정함)과 `false`(글쎄요)를 접지 않는다.**
         Boolean()으로 감싸면 둘이 같아져 「글쎄요」로 답한 기록이
         「답 안 함」과 구별되지 않는다. 셋 다 살려 둔다. */
      wouldReturn: typeof row.would_return === 'boolean' ? row.would_return : null
    };
  }

  /* 다녀온 곳인가. 화면이 그룹을 가를 때 이 한 가지 기준만 본다. */
  function isVisited(item) {
    return !!item && item.visitedAt != null;
  }

  function text(value) {
    return typeof value === 'string' ? value : (value == null ? '' : String(value));
  }

  function reindex() {
    index = Object.create(null);
    for (var i = 0; i < cache.length; i += 1) index[cache[i].id] = cache[i];
  }

  function notify() {
    for (var i = 0; i < listeners.length; i += 1) {
      try { listeners[i](); } catch (err) {
        if (window.console) console.error('[saved-places] 구독자 오류', err);
      }
    }
  }

  function settleReady() {
    if (readyResolved) return;
    readyResolved = true;
    resolveReady();
  }

  /* 로그아웃했을 때. 남의 계정으로 갈아타면 앞사람 목록이 남으면 안 된다. */
  function clear() {
    seq += 1;
    cache = [];
    index = Object.create(null);
    loadError = null;
    loaded = false;
    notify();
    settleReady();
  }

  /* ── 읽기 ────────────────────────────────────────────────────
     **`user_id`로 거르지 않는다.** 조건 없이 전체를 요청하면
     RLS가 내 것만 돌려준다. 거르는 일은 창고 담당이다. */
  function refresh() {
    var client = db();
    if (!client || !signedIn()) {
      clear();
      return Promise.resolve();
    }

    var mine = ++seq;

    return client
      .from(TABLE)
      .select('id, place_id, place_name, road_address_name, x, y, place_url, created_at, visited_at, note, would_return')
      .order('created_at', { ascending: false })   // 최근에 담은 것이 위로
      .then(function (res) {
        if (mine !== seq) return;                  // 더 새 요청이 이미 나갔다

        if (res.error) {
          loadError = res.error;
          loaded = true;
          if (window.console) console.error('[saved-places] 목록을 읽지 못했습니다', res.error);
          notify();
          settleReady();
          return;
        }

        var rows = res.data || [];
        var list = [];
        for (var i = 0; i < rows.length; i += 1) {
          var item = normalize(rows[i]);
          if (item) list.push(item);
        }

        cache = list;
        loadError = null;
        loaded = true;
        reindex();
        notify();
        settleReady();
      })
      .catch(function (err) {
        if (mine !== seq) return;
        loadError = err;
        loaded = true;
        if (window.console) console.error('[saved-places] 목록 요청 실패', err);
        notify();
        settleReady();
      });
  }

  /* ── 시작 ────────────────────────────────────────────────────
     **isSignedIn()을 직접 읽지 않고 onChange로 시작한다** (⑰).
     세션 복원이 비동기라 지금 읽으면 로그인한 사용자를 비로그인으로 본다.
     onChange는 등록 즉시 한 번, 복원이 끝나면 다시 호출되므로 두 시점이 모두 덮인다. */
  if (window.Auth && typeof window.Auth.onChange === 'function') {
    window.Auth.onChange(function (user) {
      if (user) refresh();
      else clear();
    });
  } else {
    // auth.js를 못 불러온 경우. 화면은 비로그인으로 그려진다.
    settleReady();
  }

  return {
    /* 첫 응답이 끝났을 때 풀린다. 목록을 그리기 전에 기다리는 화면이 쓴다. */
    ready: readyPromise,

    /* 서버 응답을 한 번이라도 받아봤는가. 「비어 있음」과 「아직 모름」을 가른다. */
    isLoaded: function () { return loaded; },

    /* 마지막 읽기가 실패했으면 그 오류. 성공했으면 null. */
    error: function () { return loadError; },

    /* 담아둔 곳 전체. 최근에 담은 것이 앞으로 온다 (DB에서 이미 정렬해 받는다). */
    list: function () { return cache.slice(); },

    /* 담김 여부. 메모리 색인만 보므로 동기다. */
    has: function (placeId) { return !!index[text(placeId)]; },

    get: function (placeId) { return index[text(placeId)] || null; },

    count: function () { return cache.length; },

    /* 다녀온 곳인가. `visitedAt`이 비어 있는지 하나만 본다. */
    isVisited: function (placeId) { return isVisited(index[text(placeId)]); },

    /* 아직 안 가본 곳 — 담은 순(최신이 위). DB 정렬을 그대로 물려받는다. */
    toVisit: function () { return cache.filter(function (i) { return !isVisited(i); }); },

    /* 다녀온 곳 — **다녀온 순**(최신이 위)으로 다시 정렬한다.
       담은 순서와 다녀온 순서는 같지 않다. 작년에 담아둔 곳을 오늘 다녀왔다면
       담은 순으로는 맨 아래에 남아, 방금 남긴 기록이 화면에서 사라진 것처럼 보인다. */
    visited: function () {
      return cache.filter(isVisited).sort(function (a, b) { return b.visitedAt - a.visitedAt; });
    },

    /* 서버에서 다시 읽는다. */
    refresh: refresh,

    /* ── 담기 ──────────────────────────────────────────────────
       **user_id를 싣지 않는다.** 컬럼 기본값 auth.uid()가 채운다.
       돌려받은 행을 그대로 캐시에 넣어, 화면이 보는 값과 DB의 값이 어긋나지 않게 한다. */
    add: function (place) {
      var client = db();
      if (!client) return Promise.resolve({ ok: false, reason: 'unavailable' });
      if (!signedIn()) return Promise.resolve({ ok: false, reason: 'signed_out' });
      if (!place || !place.id) return Promise.resolve({ ok: false, reason: 'bad_place' });

      var placeId = text(place.id);
      if (index[placeId]) return Promise.resolve({ ok: true, already: true });

      var row = {
        place_id: placeId,
        place_name: text(place.place_name),
        road_address_name: text(place.road_address_name) || null,
        x: text(place.x) || null,
        y: text(place.y) || null,
        place_url: text(place.place_url) || null
      };

      return client
        .from(TABLE)
        .insert(row)
        .select('id, place_id, place_name, road_address_name, x, y, place_url, created_at, visited_at, note, would_return')
        .single()
        .then(function (res) {
          if (res.error) {
            /* 23505 = unique 위반. (user_id, place_id)에 걸린 것이므로
               「이미 담겨 있다」는 뜻이다 — 실패가 아니라 목표 상태에 이미 도달했다.
               캐시가 서버와 어긋났다는 신호이므로 다시 읽어 맞춘다. */
            if (res.error.code === '23505') {
              return refresh().then(function () { return { ok: true, already: true }; });
            }
            if (window.console) console.error('[saved-places] 담기 실패', res.error);
            return { ok: false, reason: 'insert_failed', error: res.error };
          }

          var item = normalize(res.data);
          if (item && !index[item.id]) {
            cache.unshift(item);          // 최신순이므로 맨 앞
            reindex();
            notify();
          }
          return { ok: true };
        })
        .catch(function (err) {
          if (window.console) console.error('[saved-places] 담기 요청 실패', err);
          return { ok: false, reason: 'network', error: err };
        });
    },

    /* ── 방문 기록 ─────────────────────────────────────────────
       담아둔 행을 **고친다.** 새 행을 만들지 않는다 — 방문 기록은
       담아둔 곳의 속성이지 별개의 사건이 아니다.

       `wouldReturn`만 필수다. `note`는 비워도 저장된다 — 기록을 강요하지 않는다.
       빈 문자열이 아니라 **null**로 넣는 이유: 「안 썼다」와 「빈 줄을 썼다」를
       DB에서 구별할 이유가 없고, 나중에 `where note is not null`로 세기 편하다.

       `visited_at`은 **처음 기록할 때만** 넣는다. 「기록 수정」에서 다시 넣으면
       다녀온 날짜가 수정한 날짜로 덮여, 지난달에 간 곳이 오늘 간 것으로 바뀐다. */
    saveVisit: function (placeId, record) {
      var client = db();
      if (!client) return Promise.resolve({ ok: false, reason: 'unavailable' });
      if (!signedIn()) return Promise.resolve({ ok: false, reason: 'signed_out' });

      var key = text(placeId);
      var current = index[key];
      if (!current) return Promise.resolve({ ok: false, reason: 'not_saved' });

      // 「또 올까」는 필수다. 이 서비스가 쌓으려는 데이터가 이것이다.
      if (!record || typeof record.wouldReturn !== 'boolean') {
        return Promise.resolve({ ok: false, reason: 'missing_verdict' });
      }

      var note = text(record.note).trim();
      var patch = {
        would_return: record.wouldReturn,
        note: note ? note : null
      };
      if (!isVisited(current)) patch.visited_at = new Date().toISOString();

      return client
        .from(TABLE)
        .update(patch)
        .eq('place_id', key)
        .select('id, place_id, place_name, road_address_name, x, y, place_url, created_at, visited_at, note, would_return')
        .then(function (res) {
          if (res.error) {
            if (window.console) console.error('[saved-places] 기록 저장 실패', res.error);
            return { ok: false, reason: 'update_failed', error: res.error };
          }

          /* **행이 0건이면 실패다.** RLS에 update 정책이 없으면 고칠 대상이
             0건으로 보여 PostgREST가 200 + 빈 배열을 돌려준다 — 거절이 아니라
             「0건 고쳤다」다. error만 보면 성공으로 읽혀서, 화면에는
             「저장했어요」가 뜨고 새로고침하면 기록이 사라져 있다.
             에러가 아니라 **그럴듯한 실패**라 여기서 명시적으로 잡는다. */
          var rows = res.data || [];
          if (!rows.length) {
            if (window.console) {
              console.error('[saved-places] 기록이 저장되지 않았습니다 — ' +
                'saved_places에 update 정책이 있는지 확인하세요');
            }
            return { ok: false, reason: 'not_updated' };
          }

          var item = normalize(rows[0]);
          if (item) {
            for (var i = 0; i < cache.length; i += 1) {
              if (cache[i].id === item.id) { cache[i] = item; break; }
            }
            reindex();
            notify();
          }
          return { ok: true, item: item };
        })
        .catch(function (err) {
          if (window.console) console.error('[saved-places] 기록 요청 실패', err);
          return { ok: false, reason: 'network', error: err };
        });
    },

    /* ── 해제 ──────────────────────────────────────────────────
       place_id로 지운다. 남의 행이 지워질 걱정은 하지 않는다 —
       delete 정책이 auth.uid() = user_id를 걸어두었다. */
    remove: function (placeId) {
      var client = db();
      if (!client) return Promise.resolve({ ok: false, reason: 'unavailable' });
      if (!signedIn()) return Promise.resolve({ ok: false, reason: 'signed_out' });

      var key = text(placeId);
      if (!key) return Promise.resolve({ ok: false, reason: 'bad_place' });

      return client
        .from(TABLE)
        .delete()
        .eq('place_id', key)
        .then(function (res) {
          if (res.error) {
            if (window.console) console.error('[saved-places] 해제 실패', res.error);
            return { ok: false, reason: 'delete_failed', error: res.error };
          }

          if (index[key]) {
            var next = [];
            for (var i = 0; i < cache.length; i += 1) {
              if (cache[i].id !== key) next.push(cache[i]);
            }
            cache = next;
            reindex();
            notify();
          }
          return { ok: true };
        })
        .catch(function (err) {
          if (window.console) console.error('[saved-places] 해제 요청 실패', err);
          return { ok: false, reason: 'network', error: err };
        });
    },

    /* 목록이 바뀔 때마다 부른다. 등록 즉시 한 번 불러서
       구독자가 초기 렌더를 따로 하지 않아도 되게 한다 (Auth.onChange와 같은 결). */
    onChange: function (fn) {
      if (typeof fn !== 'function') return function () {};
      listeners.push(fn);
      try { fn(); } catch (err) {
        if (window.console) console.error('[saved-places] 구독자 오류', err);
      }
      return function () {
        var at = listeners.indexOf(fn);
        if (at >= 0) listeners.splice(at, 1);
      };
    }
  };
})();
