'use strict';

/* ============================================================
   오늘은 여기 — 랜딩페이지의 추천 두 코너 (Phase 1)

   ① 지금 인기        — 모두가 담은 것을 합쳐 상위 5곳. 순위 리스트(.pick-row). 비로그인도 본다
   ② 오늘 여기 어때?  — 내가 자주 담는 카테고리의 다른 가게 2곳. 카드(.pick-card). 로그인해야 보인다

   ── 두 코너가 한 파일에 있는 이유 ───────────────────────────
   v3부터 생김새는 갈렸지만, 담기 버튼(.pick-save)·안내 문구(.pick-status)·
   토스트·데이터 창구를 그대로 공유한다. 두 파일로 가르면 그 공유분이 두 벌 생긴다.

   ── 데이터 창구는 직접 만지지 않는다 ────────────────────────
   · 인기 랭킹      → window.PopularPlaces   (popular_places() rpc)
   · 담아둔 곳      → window.SavedPlaces     (saved_places 테이블)
   · 카테고리 검색  → fetch('/api/search')   (카카오 프록시)
   supabase 클라이언트도 localStorage도 여기서 직접 열지 않는다 (CLAUDE.md ⑳).

   **이 파일 때문에 index.html은 이제 서버로 띄워야 한다.**
   맞춤 추천이 fetch('/api/search')를 쓰기 때문이다 — file://로 열면
   그 코너만 「추천을 불러오지 못했어요」가 되고 나머지는 그대로 돈다.

   클래식 스크립트다. app.js와 같은 결로 IIFE 안에 가둔다.
   ============================================================ */

(function () {
  var TOP_N = 5;          // 인기 랭킹에 세울 수
  var PICK_N = 2;         // 맞춤 추천에 세울 수. 랜딩은 결정을 돕는 자리라 2장까지만 (DESIGN v3)
  var SEARCH_SIZE = 15;   // /api/search의 상한값(SIZE_MAX)과 같다. 걸러낼 여유분까지 받아온다
  var TOAST_MS = 2400;    // save.js와 같은 값 (DESIGN v2 5.2장)

  /* 카테고리 → 카카오 category_group_code.
     검색 정확도를 위한 것이다. 표에 없으면 코드 없이 전체 검색으로 떨어진다
     (server.py의 ALLOWED_CATEGORY_CODES도 이 둘만 받는다). */
  var GROUP_CODE = { '카페': 'CE7' };
  var FOOD_CODE = 'FD6';

  var popularSection = document.getElementById('popular');
  var popularList = document.getElementById('popular-list');
  var popularStatus = document.getElementById('popular-status');

  var forYouSection = document.getElementById('for-you');
  var forYouList = document.getElementById('for-you-list');
  var forYouStatus = document.getElementById('for-you-status');
  var forYouReason = document.getElementById('for-you-reason');

  // 상단 내비게이션의 "추천" 필. #for-you를 여닫는 곳에서 같이 맞춘다 —
  // 없는 페이지(마크업이 없을 수도 있으므로)에서도 조용히 넘어가게 null을 허용한다.
  var forYouNavPill = document.getElementById('site-nav-foryou');

  var toast = document.getElementById('toast');

  // 마크업이 없는 페이지에서 로드돼도 조용히 아무 일도 하지 않는다.
  if (!popularSection || !forYouSection) return;

  /* 화면에 서 있는 카드의 원본. 담기 버튼이 place_id로 여기서 찾아간다. */
  var itemsById = Object.create(null);

  /* 맞춤 추천은 **한 번만** 받아온다. 무엇을 기준으로 받았는지 들고 있는다.
     로그인한 사람이 바뀌면 null로 되돌려 다시 받게 한다. */
  var pickKey = null;

  var toastTimer = null;

  /* --- 잔손 -------------------------------------------------- */

  function el(tag, className, textContent) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    // 카카오·DB가 준 문자열은 항상 textContent로만 넣는다 (innerHTML 금지).
    if (textContent != null) node.textContent = textContent;
    return node;
  }

  function text(value) {
    return typeof value === 'string' ? value : (value == null ? '' : String(value));
  }

  function showToast(message) {
    if (!toast) return;
    toast.textContent = message;
    toast.hidden = false;
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(function () { toast.hidden = true; }, TOAST_MS);
  }

  /* 안내 문구 한 줄. 클래스로 상태를 갈라 색만이 아니라 형태로도 구별되게 한다
     (DESIGN 2장 — 에러를 색만으로 구분하지 않는다). */
  function setStatus(node, message, kind) {
    if (!node) return;
    node.textContent = message || '';
    node.className = 'pick-status' + (message && kind ? ' pick-status--' + kind : '');
  }

  /* --- 카테고리 문자열 다루기 ----------------------------------
     카카오는 "음식점 > 한식 > 국밥"처럼 계층으로 준다.
     쓰는 데가 둘인데 **깊이가 다르다** — 그래서 자르는 함수도 둘이다. */

  // 카드에 보여줄 잔가지. save.js의 lastCategory()와 같은 규칙이다.
  function lastSegment(categoryName) {
    var parts = String(categoryName || '').split('>');
    return (parts[parts.length - 1] || '').trim();
  }

  /* 취향을 묶는 단위. **두 번째 마디**다 — 국밥·감자탕·해장국이
     전부 「한식」으로 모여야 「자주 담는 카테고리」가 뜻을 갖는다.
     마지막 마디로 세면 1건짜리 잔가지만 잔뜩 생겨 최빈값이 의미를 잃는다. */
  function groupSegment(categoryName) {
    var parts = String(categoryName || '').split('>');
    var at = parts.length > 1 ? 1 : 0;
    return (parts[at] || '').trim();
  }

  /* 목적격 조사를 받침에 맞춰 고른다 — 한식**을** / 카페**를**.
     「한식을(를)」처럼 괄호로 미루지 않는다. 화면에 나가는 한국어에
     괄호가 섞이는 순간 사람이 쓴 문장이 아니게 된다 (DESIGN 7장).
     한글 음절은 0xAC00부터 28개씩 묶여 있고, 그 나머지가 0이면 받침이 없다. */
  function objectParticle(word) {
    var last = String(word || '').charCodeAt(String(word).length - 1);
    if (!(last >= 0xAC00 && last <= 0xD7A3)) return '를';   // 한글이 아니면 기본값
    return (last - 0xAC00) % 28 === 0 ? '를' : '을';
  }

  // "서울 종로구 자하문로5길 5" → "서울 종로구". 추천을 내 동네 쪽으로 당긴다.
  function areaOf(address) {
    var parts = String(address || '').trim().split(/\s+/);
    if (parts.length < 2) return '';
    return parts[0] + ' ' + parts[1];
  }

  /* 최빈값. 동점이면 **먼저 나온 것**이 이긴다 —
     SavedPlaces.list()가 최신순이므로 최근 취향이 이긴다는 뜻이다. */
  function mostCommon(values) {
    var counts = Object.create(null);   // null 프로토타입 — "__proto__" 같은 값이 키로 와도 안전하다
    var best = '';
    var bestCount = 0;
    for (var i = 0; i < values.length; i += 1) {
      var value = values[i];
      if (!value) continue;             // 카테고리 컬럼이 생기기 전에 담긴 행은 비어 있다. 세지 않는다
      counts[value] = (counts[value] || 0) + 1;
      if (counts[value] > bestCount) {
        bestCount = counts[value];
        best = value;
      }
    }
    return best;
  }

  /* --- 목록 항목 두 가지 ----------------------------------------
     v3부터 두 코너의 생김새가 다르다 (UI-CONTRACT 「.pick-row」·「.pick-card」).
     인기 = 순위 리스트 한 줄, 추천 = 사진 카드. 담기 버튼(.pick-save)만 공유한다. */

  function saveButton(item) {
    var button = el('button', 'pick-save');
    button.type = 'button';
    button.dataset.action = 'save';
    applySaveState(button, savedHas(item.id), item.name);
    return button;
  }

  /* 인기 한 줄 — 순위·이름·(카테고리 · n명이 담았어요)·담기 */
  function pickRow(item) {
    var li = el('li', 'pick-row');
    li.dataset.placeId = item.id;

    li.appendChild(el('span', 'pick-row__rank', String(item.rank)));

    var body = el('div', 'pick-row__body');
    body.appendChild(el('span', 'pick-row__name', item.name));

    /* 카테고리가 비어 있으면(컬럼이 생기기 전에 담긴 행) 담긴 수만 쓴다 —
       앞에 붙은 `·`를 남기지 않는다 (UI-CONTRACT). */
    var category = lastSegment(item.category);
    var meta = category
      ? category + ' · ' + item.count + '명이 담았어요'
      : item.count + '명이 담았어요';
    body.appendChild(el('span', 'caption pick-row__meta', meta));
    li.appendChild(body);

    li.appendChild(saveButton(item));
    return li;
  }

  /* 추천 카드 — 글자만 있다. 사진을 넣지 않는 이유:
     추천 두 장은 항상 같은 카테고리라, 실제 가게 사진이 없는 지금은
     같은 분위기 그림 두 장이 나란히 서게 된다. 정보가 아니라 소음이다. */
  function pickCard(item) {
    var li = el('li', 'pick-card');
    li.dataset.placeId = item.id;

    var body = el('div', 'pick-card__body');
    var category = lastSegment(item.category);
    if (category) body.appendChild(el('p', 'caption pick-card__category', category));
    body.appendChild(el('h3', 'h2 pick-card__name', item.name));
    if (item.address) body.appendChild(el('p', 'caption pick-card__address', item.address));
    li.appendChild(body);

    var side = el('div', 'pick-card__side');
    side.appendChild(saveButton(item));
    li.appendChild(side);

    return li;
  }

  /* 상태를 색만으로 구분하지 않는다 — 라벨과 aria-pressed를 함께 바꾼다.
     save.js의 applySaveState()와 같은 규칙이다. */
  function applySaveState(button, saved, name) {
    button.classList.toggle('is-saved', saved);
    button.textContent = saved ? '담았어요' : '담기';
    button.setAttribute('aria-pressed', saved ? 'true' : 'false');
    button.setAttribute('aria-label', name + (saved ? ' 담기 해제' : ' 담기'));
  }

  function savedHas(placeId) {
    return !!(window.SavedPlaces && window.SavedPlaces.has(placeId));
  }

  function renderList(listNode, items, kind) {
    listNode.textContent = '';
    for (var i = 0; i < items.length; i += 1) {
      itemsById[items[i].id] = items[i];
      listNode.appendChild(kind === 'row' ? pickRow(items[i]) : pickCard(items[i]));
    }
  }

  /* **담기 성공 뒤 화면을 고치는 곳은 여기 하나다** (CLAUDE.md ⑳).
     부르는 쪽에서 낙관적으로 먼저 칠하지 않는다 — 저장에 실패했는데
     담긴 것처럼 보이면 새로고침해야 드러나는 거짓말이 된다. */
  function syncSaveButtons() {
    var nodes = document.querySelectorAll('.pick-row, .pick-card');
    for (var i = 0; i < nodes.length; i += 1) {
      var node = nodes[i];
      var item = itemsById[node.dataset.placeId];
      var button = node.querySelector('.pick-save');
      if (!item || !button) continue;
      applySaveState(button, savedHas(item.id), item.name);
    }
  }

  /* --- 담기 --------------------------------------------------- */

  function onListClick(event) {
    var button = event.target.closest('[data-action="save"]');
    if (!button) return;

    var card = button.closest('.pick-row, .pick-card');
    if (!card) return;
    var item = itemsById[card.dataset.placeId];
    if (!item) return;

    if (!window.SavedPlaces) { showToast('담기 기능을 불러오지 못했어요'); return; }
    if (!window.Auth || !window.Auth.requireSignIn('로그인하면 담아둘 수 있어요')) return;

    var saved = savedHas(item.id);

    /* 왕복하는 동안 잠근다. 잠그지 않으면 연타가 insert와 delete를
       엇갈리게 보내 화면과 DB가 갈린다. */
    button.disabled = true;

    var work = saved
      ? window.SavedPlaces.remove(item.id)
      : window.SavedPlaces.add({
          id: item.id,
          place_name: item.name,
          category_name: item.category,   // 계층 문자열 그대로 — 다음 추천의 재료다
          road_address_name: item.address,
          x: item.x,
          y: item.y,
          place_url: item.url
        });

    work.then(function (res) {
      button.disabled = false;
      if (!res || !res.ok) {
        showToast(saved ? '해제하지 못했어요' : '담지 못했어요');
        return;
      }
      showToast(saved ? '담기를 해제했어요' : '담았어요');
    });
  }

  popularList.addEventListener('click', onListClick);
  forYouList.addEventListener('click', onListClick);

  /* --- ① 지금 인기 --------------------------------------------
     로그인과 무관하다. 비로그인 방문자가 이 페이지에서 처음 보는
     「진짜 데이터」이므로 세션 복원을 기다리지 않고 바로 시작한다. */

  function loadPopular() {
    if (!window.PopularPlaces) {
      setStatus(popularStatus, '인기 목록을 불러오지 못했어요', 'error');
      return;
    }

    setStatus(popularStatus, '인기 맛집을 세는 중이에요', 'loading');

    window.PopularPlaces.top(TOP_N).then(function (res) {
      if (!res.ok) {
        setStatus(popularStatus, '인기 목록을 불러오지 못했어요', 'error');
        return;
      }
      if (!res.items.length) {
        setStatus(popularStatus, '아직 담긴 곳이 없어요', 'empty');
        return;
      }
      setStatus(popularStatus, '');
      renderList(popularList, res.items, 'row');
    });
  }

  /* --- ② 나를 위한 추천 ---------------------------------------- */

  function searchCategory(query, code) {
    var params = 'query=' + encodeURIComponent(query) + '&size=' + SEARCH_SIZE;
    if (code) params += '&category_group_code=' + encodeURIComponent(code);

    /* **HTTP 상태 코드를 보지 않고 `ok`만 본다** (UI-CONTRACT 「/api/search 응답 봉투」).
       서버가 모든 실패를 같은 모양으로 정규화해 주므로 분기가 하나로 끝난다. */
    return window.fetch('/api/search?' + params)
      .then(function (res) { return res.json(); })
      .then(function (body) {
        if (!body || !body.ok) return { ok: false };
        return { ok: true, places: body.places || [] };
      })
      .catch(function () { return { ok: false }; });
  }

  // 카카오 문서 → 두 목록이 함께 쓰는 항목 모양 (popular-places.js의 normalize와 같은 키)
  function fromKakao(doc) {
    return {
      rank: 0,
      id: text(doc.id),
      name: text(doc.place_name),
      category: text(doc.category_name),
      address: text(doc.road_address_name) || text(doc.address_name),
      x: text(doc.x),      // ⑬ x가 경도, y가 위도. 문자열 그대로 둔다
      y: text(doc.y),
      url: text(doc.place_url),
      count: 0
    };
  }

  function renderForYou() {
    var store = window.SavedPlaces;
    if (!store) {
      setStatus(forYouStatus, '담아둔 곳을 불러오지 못했어요', 'error');
      return;
    }

    /* **isLoaded()를 먼저 본다** (CLAUDE.md ⑳).
       목록이 도착하기 전에도 list()는 빈 배열이라, 담아둔 것이 있는 사람에게
       「아직 담은 곳이 없어요」가 잠깐 스친다. */
    if (!store.isLoaded()) {
      setStatus(forYouStatus, '담아둔 곳을 보는 중이에요', 'loading');
      return;
    }
    if (store.error()) {
      setStatus(forYouStatus, '담아둔 곳을 불러오지 못했어요', 'error');
      return;
    }

    var mine = store.list();
    if (!mine.length) {
      forYouList.textContent = '';
      setStatus(forYouStatus, '맛집을 몇 곳 담으면 취향에 맞는 곳을 찾아드려요', 'empty');
      setReason('');
      return;
    }

    var categories = [];
    var areas = [];
    for (var i = 0; i < mine.length; i += 1) {
      categories.push(groupSegment(mine[i].category));
      areas.push(areaOf(mine[i].address));
    }

    var category = mostCommon(categories);
    if (!category) {
      // 카테고리 컬럼이 생기기 전에 담은 행만 있을 때다. 다음에 담으면 풀린다.
      forYouList.textContent = '';
      setStatus(forYouStatus, '한 곳만 더 담으면 취향을 찾아드릴게요', 'empty');
      setReason('');
      return;
    }

    var area = mostCommon(areas);
    var key = area + '|' + category;

    /* **이미 받아온 기준과 같으면 다시 받지 않는다.**
       담기 버튼을 누를 때마다 SavedPlaces가 onChange를 쏘는데, 그때마다
       추천을 새로 받으면 방금 담은 카드가 눈앞에서 사라진다.
       「이미 담은 곳은 뺀다」는 목록을 **만들 때** 지키면 되는 약속이다. */
    if (pickKey === key) {
      syncSaveButtons();
      return;
    }
    pickKey = key;

    setReason(category + objectParticle(category) + ' 가장 많이 담으셨어요');
    setStatus(forYouStatus, '어울리는 곳을 찾는 중이에요', 'loading');

    var query = area ? area + ' ' + category : category;
    var code = GROUP_CODE[category] || FOOD_CODE;

    searchCategory(query, code).then(function (res) {
      // 기다리는 사이에 다른 사람으로 바뀌었으면 그 결과는 버린다.
      if (pickKey !== key) return;

      if (!res.ok) {
        pickKey = null;                 // 실패는 들고 있지 않는다. 다음 기회에 다시 받는다
        setStatus(forYouStatus, '추천을 불러오지 못했어요', 'error');
        return;
      }

      var picks = [];
      for (var i = 0; i < res.places.length && picks.length < PICK_N; i += 1) {
        var item = fromKakao(res.places[i]);
        if (!item.id) continue;
        if (savedHas(item.id)) continue;                 // 이미 담은 곳은 뺀다
        if (groupSegment(item.category) !== category) continue;  // 검색이 흘린 다른 갈래도 뺀다
        picks.push(item);
      }

      if (!picks.length) {
        setStatus(forYouStatus, '추천할 만한 새 곳을 찾지 못했어요', 'empty');
        forYouList.textContent = '';
        return;
      }

      setStatus(forYouStatus, '');
      renderList(forYouList, picks, 'card');
    });
  }

  function setReason(message) {
    if (!forYouReason) return;
    forYouReason.textContent = message || '';
    forYouReason.hidden = !message;
  }

  /* --- 시작 ---------------------------------------------------
     **isSignedIn()을 직접 읽지 않고 onChange로 그린다** (CLAUDE.md ⑰).
     세션 복원이 비동기라 지금 읽으면 로그인한 사람을 비로그인으로 본다.
     onChange는 등록 즉시 한 번, 복원이 끝나면 다시 호출된다. */

  loadPopular();

  if (window.Auth && typeof window.Auth.onChange === 'function') {
    var lastUserId = null;

    window.Auth.onChange(function (user) {
      var id = user ? user.id : null;

      /* 사람이 바뀌면 추천 기준을 버린다. 버리지 않으면 앞사람 취향으로
         받아둔 목록이 다음 사람 화면에 그대로 남는다. */
      if (id !== lastUserId) {
        lastUserId = id;
        pickKey = null;
        forYouList.textContent = '';
        setReason('');
      }

      /* 복원 전에는 로그인 여부를 모르므로 아무것도 그리지 않는다.
         `.site-auth`가 로그인 버튼을 미리 그리지 않는 것과 같은 이유다 (⑰). */
      if (!window.Auth.isReady()) return;

      forYouSection.hidden = !user;
      if (forYouNavPill) forYouNavPill.hidden = !user;
      if (user) renderForYou();
    });
  } else {
    // auth.js를 못 불러온 경우. 인기 코너는 그대로 두고 이 코너만 접는다.
    forYouSection.hidden = true;
    if (forYouNavPill) forYouNavPill.hidden = true;
  }

  if (window.SavedPlaces && typeof window.SavedPlaces.onChange === 'function') {
    window.SavedPlaces.onChange(function () {
      syncSaveButtons();
      if (!forYouSection.hidden) renderForYou();
    });
  }
})();
