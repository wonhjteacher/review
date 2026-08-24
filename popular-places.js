'use strict';

/* ============================================================
   오늘은 여기 — 인기 랭킹 창구 (Phase 1)

   ── 왜 별도 파일인가 ────────────────────────────────────────
   saved-places.js는 **내 것**을 다루고, 여기는 **모두의 집계**를 다룬다.
   읽는 경로도 다르다 — 저쪽은 테이블을 직접 select 하고(RLS가 걸러준다),
   이쪽은 `popular_places()` 함수를 rpc로 부른다.

   ── 왜 함수를 부르는가 ──────────────────────────────────────
   saved_places의 select 정책은 `auth.uid() = user_id`다. 브라우저에서
   무엇을 물어봐도 **내 것만** 돌아오므로, 여기서 count를 세면
   「모두가 담은 수」가 아니라 「내 목록의 길이」가 나온다.

   RLS를 끄면 될 일이 아니다 — 끄는 순간 publishable 키만 있는 누구나
   남의 담아둔 목록을 통째로 읽는다 (CLAUDE.md ⑯).
   그래서 **세는 일만** 대신해 주는 함수를 DB에 두고 그것만 부른다.
   함수는 가게 정보와 담긴 횟수만 내보낸다 — user_id는 반환 타입에 아예 없다.
   DDL은 `supabase-popular-places.sql`이다.

   ── 창구는 하나다 ──────────────────────────────────────────
   ReviewCache·SavedPlaces와 같은 규칙 — home.js가 supabase 클라이언트를
   직접 만지지 않는다. 여기를 거친다.

   클래식 스크립트다. 최상위 var는 window 속성이 되지 않으므로
   전역 객체를 명시적으로 만들어 붙인다.
   ============================================================ */

window.PopularPlaces = (function () {
  var FN = 'popular_places';
  var DEFAULT_LIMIT = 5;

  /* 한 번 받아온 결과는 페이지가 살아 있는 동안 다시 받지 않는다.
     랭킹은 초 단위로 바뀌는 값이 아니고, 랜딩페이지는 스크롤 한 번에
     여러 번 다시 그려질 수 있다. limit별로 따로 들고 있는다. */
  var pending = Object.create(null);

  function text(value) {
    return typeof value === 'string' ? value : (value == null ? '' : String(value));
  }

  function db() {
    if (!window.Auth || typeof window.Auth.client !== 'function') return null;
    return window.Auth.client();
  }

  /* ── 클라이언트가 생기기를 기다린다 ──────────────────────────
     **auth.js는 DOMContentLoaded에서야 클라이언트를 만든다.**
     본문 끝의 <script>는 그보다 **먼저** 실행되므로, 페이지가 뜨자마자
     top()을 부르면 Auth.client()가 아직 null이다.

     그때 돌아가는 것은 예외가 아니라 { ok: false, reason: 'unavailable' }다 —
     콘솔에 아무것도 남지 않고 화면에는 「불러오지 못했어요」만 뜬다.
     ⑰의 「복원 전에 isSignedIn()을 읽으면 조용히 틀린 값이 나온다」와 같은 계열이고,
     실제로 이 코너를 처음 붙였을 때 이것으로 한 번 걸렸다.

     **부르는 쪽이 시점을 알아야 하는 구조를 만들지 않는다.** 여기서 기다린다.
     Auth.ready는 세션 복원까지 끝난 뒤에 풀린다. */
  function whenReady() {
    if (window.Auth && window.Auth.ready && typeof window.Auth.ready.then === 'function') {
      return window.Auth.ready;
    }
    return Promise.resolve();   // auth.js 자체를 못 불러온 경우. db()가 null을 돌려준다
  }

  /* DB 컬럼명을 화면까지 끌고 가지 않는다. saved-places.js의 normalize()와
     **같은 모양으로** 맞춘다 — home.js가 두 목록을 같은 함수로 그리기 때문이다.
     이름이 어긋나면 카드 한쪽에만 주소가 비는 식으로 조용히 깨진다. */
  function normalize(row) {
    if (!row || typeof row !== 'object') return null;
    var placeId = text(row.place_id);
    if (!placeId) return null;

    return {
      rank: Number(row.rank) || 0,
      id: placeId,
      name: text(row.place_name),
      category: text(row.category_name),
      address: text(row.road_address_name),

      /* 좌표는 **문자열 그대로** 둔다 (CLAUDE.md ⑬).
         x가 경도, y가 위도이고, Number("")는 NaN이 아니라 0이라
         여기서 숫자로 바꾸면 좌표 없는 항목이 기니만 앞바다를 가리킨다. */
      x: text(row.x),
      y: text(row.y),

      url: text(row.place_url),

      /* 몇 **명**이 담았는가. 함수가 count(distinct user_id)로 센 값이다. */
      count: Number(row.save_count) || 0
    };
  }

  function fetchTop(limit) {
    return whenReady().then(function () {
      var client = db();
      if (!client) return { ok: false, reason: 'unavailable' };

      return client
        .rpc(FN, { limit_count: limit })
        .then(function (res) {
          if (res.error) {
            if (window.console) console.error('[popular-places] 랭킹을 읽지 못했습니다', res.error);
            return { ok: false, reason: 'rpc_failed', error: res.error };
          }

          var rows = res.data || [];
          var items = [];
          for (var i = 0; i < rows.length; i += 1) {
            var item = normalize(rows[i]);
            if (item) items.push(item);
          }
          return { ok: true, items: items };
        })
        .catch(function (err) {
          if (window.console) console.error('[popular-places] 랭킹 요청 실패', err);
          return { ok: false, reason: 'network', error: err };
        });
    });
  }

  return {
    /* 담긴 수 상위 n곳. 항상 Promise를 돌려준다 —
       실패도 예외가 아니라 { ok: false } 봉투로 온다 (/api/search와 같은 결). */
    top: function (limit) {
      var n = Number(limit);
      if (!isFinite(n) || n < 1) n = DEFAULT_LIMIT;
      n = Math.min(Math.round(n), 20);   // 함수 쪽에서도 접지만 여기서도 접는다

      /* **실패한 결과는 들고 있지 않는다.** 네트워크가 끊긴 순간의 실패를
          캐시하면 연결이 돌아와도 새로고침 전까지 계속 실패한 것처럼 보인다
          (ReviewCache가 서버 오류를 캐시하지 않는 것과 같은 이유 — ⑫). */
      if (!pending[n]) {
        pending[n] = fetchTop(n).then(function (res) {
          if (!res.ok) pending[n] = null;
          return res;
        });
      }
      return pending[n];
    },

    /* 다음 top() 호출이 서버를 다시 타게 한다. */
    reset: function () { pending = Object.create(null); }
  };
})();
