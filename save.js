'use strict';

/* ============================================================
   오늘은 여기 — 맛집 담기 (Phase 1)

   검색은 server.py의 /api/search 프록시를 거친다.
   카카오 REST API 키는 서버 환경변수에만 있고 이 파일로 내려오지 않는다 (PRD 8장).

   클래식 스크립트다. storage.js가 먼저 로드되어 window.SavedPlaces를 만들어 둔다.
   ============================================================ */

(function () {
  var SEARCH_SIZE = 12;
  var TOAST_MS = 2400;   // DESIGN v2 5.2장 권장값. 퇴장 애니메이션은 없고 hidden이 붙는 즉시 사라진다.

  var STATUS = {
    loading: { modifier: 'search__status--loading', text: '찾아보는 중이에요' },
    empty:   { modifier: 'search__status--empty',   text: '검색 결과가 없어요. 다른 이름으로 찾아보세요' },
    error:   { modifier: 'search__status--error',   text: '' }  // 문구는 서버가 준 것을 그대로 쓴다
  };
  var STATUS_MODIFIERS = ['search__status--loading', 'search__status--empty', 'search__status--error'];

  var form = document.getElementById('search-form');
  var input = document.getElementById('search-input');
  var chips = document.getElementById('search-chips');
  var status = document.getElementById('search-status');
  var results = document.getElementById('results');
  var savedList = document.getElementById('saved-list');
  var savedCount = document.getElementById('saved-count');
  var toast = document.getElementById('toast');

  /* 마지막 검색에서 받은 장소를 id로 찾을 수 있게 들고 있는다.
     담기 버튼이 눌렸을 때 DOM을 되읽지 않고 원본 값을 그대로 저장하기 위해서다. */
  var placesById = Object.create(null);

  /* 연타·느린 응답 경합 방지.
     늦게 보낸 요청이 최신이며, 그보다 먼저 보낸 응답이 뒤늦게 와도 화면을 덮지 않는다. */
  var requestSeq = 0;

  var toastTimer = null;

  /* --- 상태 줄 -------------------------------------------------- */

  function setStatus(kind, message) {
    status.classList.remove.apply(status.classList, STATUS_MODIFIERS);

    if (!kind) {
      status.textContent = '';
      return;
    }
    var preset = STATUS[kind];
    status.classList.add(preset.modifier);
    status.textContent = message || preset.text;
  }

  /* --- 토스트 --------------------------------------------------- */

  function showToast(message) {
    toast.textContent = message;
    toast.hidden = false;
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(function () {
      toast.hidden = true;
    }, TOAST_MS);
  }

  /* --- 카드 만들기 ---------------------------------------------- */

  function el(tag, className, textContent) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    // 카카오가 준 문자열은 항상 textContent로만 넣는다 (innerHTML 금지).
    if (textContent != null) node.textContent = textContent;
    return node;
  }

  /* "음식점 > 한식 > 국밥" 처럼 오는 값에서 마지막 마디만 쓴다 */
  function lastCategory(categoryName) {
    var parts = String(categoryName || '').split('>');
    return parts[parts.length - 1].trim();
  }

  function addressOf(place) {
    return place.road_address_name || place.address_name || '';
  }

  function placeCard(place, saved) {
    var li = el('li', 'place-card');
    li.dataset.kakaoId = place.id;

    var category = lastCategory(place.category_name);
    if (category) li.appendChild(el('p', 'caption place-card__category', category));

    li.appendChild(el('h3', 'h2 place-card__name', place.place_name));

    var address = addressOf(place);
    if (address) li.appendChild(el('p', 'body place-card__address', address));

    // 거리가 없으면 빈 요소를 남기지 않는다.
    if (place.distance) {
      li.appendChild(el('p', 'caption place-card__distance', place.distance + 'm'));
    }

    var actions = el('div', 'place-card__actions');

    if (place.place_url) {
      var link = el('a', 'place-card__link', '상세 보기');
      link.href = place.place_url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      actions.appendChild(link);
    }

    var button = el('button', 'place-card__save');
    button.type = 'button';
    button.dataset.action = 'save';
    applySaveState(button, saved, place.place_name);
    actions.appendChild(button);

    li.appendChild(actions);
    return li;
  }

  /* 상태를 색만으로 구분하지 않는다 — 라벨과 aria-pressed를 함께 바꾼다.
     .is-saved는 버튼에만 붙는다. 카드에는 걸지 않는다. */
  function applySaveState(button, saved, name) {
    button.classList.toggle('is-saved', saved);
    button.textContent = saved ? '담았어요' : '담기';
    button.setAttribute('aria-pressed', saved ? 'true' : 'false');
    button.setAttribute('aria-label', name + (saved ? ' 담기 해제' : ' 담기'));
  }

  function savedItem(place) {
    var li = el('li', 'saved-item');
    li.dataset.kakaoId = place.id;

    var body = el('div', 'saved-item__body');
    body.appendChild(el('p', 'h2 saved-item__name', place.name));
    if (place.category) body.appendChild(el('p', 'caption saved-item__category', place.category));
    li.appendChild(body);

    var button = el('button', 'saved-item__remove', '해제');
    button.type = 'button';
    button.dataset.action = 'remove';
    button.setAttribute('aria-label', place.name + ' 담기 해제');
    li.appendChild(button);

    return li;
  }

  /* --- 그리기 --------------------------------------------------- */

  function renderResults(places) {
    placesById = Object.create(null);
    results.textContent = '';

    var fragment = document.createDocumentFragment();
    for (var i = 0; i < places.length; i += 1) {
      var place = places[i];
      if (!place || !place.id) continue;
      placesById[place.id] = place;
      // 이미 담아둔 곳은 처음부터 담긴 상태로 그린다.
      fragment.appendChild(placeCard(place, window.SavedPlaces.has(place.id)));
    }
    results.appendChild(fragment);
  }

  function renderSaved() {
    var list = window.SavedPlaces.list();

    savedCount.textContent = String(list.length);
    savedList.textContent = '';

    var fragment = document.createDocumentFragment();
    for (var i = 0; i < list.length; i += 1) {
      fragment.appendChild(savedItem(list[i]));
    }
    savedList.appendChild(fragment);
  }

  /* 담김 여부가 바뀌면 검색 결과 쪽 버튼도 같이 맞춘다 */
  function syncResultButton(id) {
    var card = results.querySelector('.place-card[data-kakao-id="' + cssEscape(id) + '"]');
    if (!card) return;
    var button = card.querySelector('.place-card__save');
    if (!button) return;
    var place = placesById[id];
    applySaveState(button, window.SavedPlaces.has(id), place ? place.place_name : '');
  }

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(value);
    return String(value).replace(/["\\]/g, '\\$&');
  }

  /* --- 검색 ----------------------------------------------------- */

  function activeCode() {
    var active = chips.querySelector('.chip.is-active');
    return active ? (active.dataset.code || '') : '';
  }

  function search(query) {
    var trimmed = query.trim();
    if (!trimmed) {
      setStatus('error', '검색어를 입력해 주세요');
      input.focus();
      return;
    }

    requestSeq += 1;
    var seq = requestSeq;

    setStatus('loading');

    var params = new URLSearchParams();
    params.set('query', trimmed);
    params.set('size', String(SEARCH_SIZE));
    var code = activeCode();
    if (code) params.set('category_group_code', code);

    window.fetch('/api/search?' + params.toString(), { headers: { Accept: 'application/json' } })
      .then(function (response) { return response.json(); })
      .then(function (data) {
        if (seq !== requestSeq) return;   // 더 나중 검색이 이미 떠 있다

        // 서버가 모든 실패를 같은 모양으로 정규화해주므로 분기가 하나로 끝난다.
        if (!data || !data.ok) {
          results.textContent = '';
          placesById = Object.create(null);
          setStatus('error', (data && data.error && data.error.message) || '검색에 실패했어요');
          return;
        }

        var places = data.places || [];
        renderResults(places);
        setStatus(places.length ? null : 'empty');
      })
      .catch(function () {
        if (seq !== requestSeq) return;
        results.textContent = '';
        placesById = Object.create(null);
        setStatus('error', '검색 서버에 연결하지 못했어요');
      });
  }

  /* --- 이벤트 --------------------------------------------------- */

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    search(input.value);
  });

  chips.addEventListener('click', function (event) {
    var chip = event.target.closest('.chip');
    if (!chip || !chips.contains(chip)) return;
    if (chip.classList.contains('is-active')) return;

    var all = chips.querySelectorAll('.chip');
    for (var i = 0; i < all.length; i += 1) {
      var isTarget = all[i] === chip;
      all[i].classList.toggle('is-active', isTarget);
      all[i].setAttribute('aria-pressed', isTarget ? 'true' : 'false');
    }

    // 칩을 바꾸면 지금 검색어로 다시 찾는다. 검색어가 없으면 아직 할 일이 없다.
    if (input.value.trim()) search(input.value);
  });

  // 카드마다 리스너를 붙이지 않고 목록에서 한 번만 받는다.
  results.addEventListener('click', function (event) {
    var button = event.target.closest('[data-action="save"]');
    if (!button || !results.contains(button)) return;

    var card = button.closest('.place-card');
    if (!card) return;
    var id = card.dataset.kakaoId;

    if (window.SavedPlaces.has(id)) {
      window.SavedPlaces.remove(id);
      showToast('담기를 해제했어요');
    } else {
      var place = placesById[id];
      if (!place) return;
      window.SavedPlaces.add({
        id: place.id,
        name: place.place_name,
        category: lastCategory(place.category_name),
        address: addressOf(place),
        url: place.place_url,
        savedAt: Date.now()
      });
      showToast('담았어요');
    }

    syncResultButton(id);
    renderSaved();
  });

  savedList.addEventListener('click', function (event) {
    var button = event.target.closest('[data-action="remove"]');
    if (!button || !savedList.contains(button)) return;

    var item = button.closest('.saved-item');
    if (!item) return;

    window.SavedPlaces.remove(item.dataset.kakaoId);
    showToast('담기를 해제했어요');
    syncResultButton(item.dataset.kakaoId);
    renderSaved();
  });

  /* --- 시작 ----------------------------------------------------- */

  renderSaved();
  setStatus(null);
})();
