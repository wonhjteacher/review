'use strict';

/* ============================================================
   오늘은 여기 — 맛집 담기 (Phase 1)

   검색은 /api/search, 구글 리뷰는 /api/reviews 프록시를 거친다.
   두 API 키 모두 서버 환경변수에만 있고 이 파일로 내려오지 않는다 (PRD 8장).

   클래식 스크립트다. 먼저 로드된 세 파일이 전역을 만들어 둔다 —
   storage.js → window.SavedPlaces · review-cache.js → window.ReviewCache ·
   analysis-cache.js → window.AnalysisCache.
   워드클라우드(window.WordCloud)는 CDN이고 **없을 수도 있다** — 없으면 목록으로 대신 그린다.
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

  /* 리뷰 패널 문구. 「~해요」체 · 느낌표 없음 (DESIGN 7장).
     로딩 문구는 검색 쪽 '찾아보는 중이에요'와 같은 결로 맞췄다. */
  var REVIEW_TEXT = {
    loading:  '리뷰를 불러오는 중이에요',
    notFound: '구글 리뷰를 찾지 못했어요',
    failed:   '리뷰를 불러오지 못했어요',
    google:   '구글맵에서 전체 리뷰 보기',
    kakao:    '카카오맵에서 보기'
  };

  /* AI 리뷰 분석 문구 (UI-CONTRACT 「.analysis」).
     「AI 리뷰 분석」은 `AI 추천` 금지에 걸리지 않는다 — 그 조항의 취지는
     「지금 못 지키는 약속을 카피에 넣지 않는다」였고, 이쪽은 **실제로 Gemini가 하는 일**이다. */
  var ANALYSIS_TEXT = {
    title:   'AI 리뷰 분석',
    loading: 'AI가 리뷰를 분석하는 중이에요',
    failed:  '리뷰를 분석하지 못했어요'
  };

  /* 감정 3분류. 순서가 곧 막대의 왼쪽→오른쪽 순서다.
     이모지는 CLAUDE.md ③ 「이모지를 UI 요소로 쓰지 않는다」의 **유일한 예외**다
     (UI-CONTRACT 공통 사항 참고). aria-hidden으로 두고 의미는 옆 라벨이 진다 —
     보조기기 사용자에게 「웃는 얼굴」이 아니라 「긍정 3」이 읽힌다. */
  var SENTIMENTS = [
    { key: 'positive', label: '긍정', face: '😀' },
    { key: 'neutral',  label: '보통', face: '😐' },
    { key: 'negative', label: '부정', face: '😠' }
  ];

  /* 워드클라우드 색은 **CSS 토큰이 진실의 원천**이다.
     캔버스는 var()를 읽지 못하므로 실제 렌더링된 값을 꺼내 쓴다.
     토큰 값을 여기 다시 적어두면 화면은 멀쩡한데 나중에 조용히 갈라진다. */
  var TONE_TOKENS = {
    positive: '--color-success',
    negative: '--color-error',
    neutral:  '--color-ink-500'
  };

  var form = document.getElementById('search-form');
  var input = document.getElementById('search-input');
  var chips = document.getElementById('search-chips');
  var status = document.getElementById('search-status');
  var results = document.getElementById('results');
  var savedList = document.getElementById('saved-list');
  var savedCount = document.getElementById('saved-count');
  var toast = document.getElementById('toast');
  var panel = document.getElementById('review-panel');
  var panelName = document.getElementById('review-panel-name');
  var panelBody = document.getElementById('review-panel-body');

  /* 마지막 검색에서 받은 장소를 id로 찾을 수 있게 들고 있는다.
     담기 버튼이 눌렸을 때 DOM을 되읽지 않고 원본 값을 그대로 저장하기 위해서다. */
  var placesById = Object.create(null);

  /* 연타·느린 응답 경합 방지.
     늦게 보낸 요청이 최신이며, 그보다 먼저 보낸 응답이 뒤늦게 와도 화면을 덮지 않는다. */
  var requestSeq = 0;

  /* 리뷰 요청도 같은 이유로 순번을 센다.
     패널을 A로 열었다가 닫고 B로 다시 열었을 때, 늦게 도착한 A의 응답이
     B의 패널을 덮어쓰면 **다른 가게의 리뷰가 붙는다.** */
  var reviewSeq = 0;

  var toastTimer = null;

  /* 패널을 열기 직전에 포커스가 있던 요소. 닫을 때 여기로 되돌린다.
     showModal()은 포커스를 가둬주지만, 닫은 뒤 어디로 돌려놓을지는 정해주지 않는다. */
  var panelOpener = null;

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

    /* 카드 전체가 클릭 영역이지만 그것만으로는 키보드로 리뷰를 열 수 없다.
       카드에 tabindex를 거는 대신(안에 이미 포커스 가능한 요소가 셋이다)
       진짜 버튼을 하나 둔다 — 마우스와 키보드가 같은 곳에 닿는다. */
    var reviewButton = el('button', 'place-card__reviews', '리뷰 보기');
    reviewButton.type = 'button';
    reviewButton.dataset.action = 'reviews';
    reviewButton.setAttribute('aria-label', place.place_name + ' 리뷰 보기');
    actions.appendChild(reviewButton);

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

  /* 로그인해야 담을 수 있다는 안내 (UI-CONTRACT 「.saved__locked」).
     .saved-list를 지우지 않고 위에 문단만 얹는다 — 이미 담아둔 목록이 있는
     사용자의 데이터를 화면에서 없애지 않기 위해서다. 저장은 아직 브라우저
     로컬(storage.js)이고 계정과 묶여 있지 않다. */
  function renderLocked() {
    var section = savedList.parentNode;
    var existing = section.querySelector('.saved__locked');
    var signedIn = !!(window.Auth && window.Auth.isSignedIn());

    if (signedIn) {
      if (existing) existing.remove();
      return;
    }
    if (existing) return;

    var note = el('p', 'saved__locked', '로그인하면 마음에 든 곳을 담아둘 수 있어요');
    savedList.parentNode.insertBefore(note, savedList);
  }

  function renderSaved() {
    var list = window.SavedPlaces.list();

    savedCount.textContent = String(list.length);
    savedList.textContent = '';

    renderLocked();

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

  /* --- 리뷰 패널 ------------------------------------------------
     본문은 UI-CONTRACT 「.review-panel」의 세 상태 중 하나만 담는다.
     상태를 섞지 않으려고 그릴 때마다 본문을 통째로 비우고 다시 채운다.
     ------------------------------------------------------------ */

  function clearPanelBody() {
    panelBody.textContent = '';
  }

  function panelStatus(modifier, message) {
    var node = el('p', 'review-panel__status ' + modifier, message);
    panelBody.appendChild(node);
  }

  /* 바깥으로 나가는 링크는 항상 같은 안전 속성을 달고 나간다.
     rel 없이 target="_blank"를 쓰면 열린 문서가 window.opener로 이쪽을 건드릴 수 있다. */
  function panelLink(href, text) {
    if (!href) return;
    var link = el('a', 'review-panel__link', text);
    link.href = href;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    panelBody.appendChild(link);
  }

  /* 별 개수로 점수를 표현하지 않는다 — 4.3을 별 4개로 반올림하면 거짓이 된다.
     별 하나는 '이 숫자가 별점'이라는 표시일 뿐이고, 값은 숫자가 말한다.
     ⭐(이모지)가 아니라 ★(U+2605 활자 문자)다 (CLAUDE.md ③ 이모지 금지). */
  function star() {
    var node = el('span', 'review-panel__star', '\u2605');
    // 스크린리더가 "검은 별"을 읽지 않게 한다. 점수는 옆 숫자가 이미 말한다.
    node.setAttribute('aria-hidden', 'true');
    return node;
  }

  function ratingRow(place) {
    // 평점도 리뷰 수도 없으면 빈 줄을 남기지 않는다.
    if (place.rating == null && !place.user_rating_count) return;

    var row = el('p', 'review-panel__rating');

    if (place.rating != null) {
      row.appendChild(star());
      row.appendChild(el('span', 'review-panel__score', place.rating.toFixed(1)));
      row.setAttribute('aria-label', '구글 별점 ' + place.rating.toFixed(1) + '점');
    }
    if (place.user_rating_count) {
      row.appendChild(el('span', 'review-panel__count', '리뷰 ' + place.user_rating_count + '개'));
    }
    panelBody.appendChild(row);
  }

  function reviewItem(review) {
    var li = el('li', 'review-item');

    var head = el('div', 'review-item__head');
    head.appendChild(el('span', 'review-item__author', review.author));

    if (review.rating != null) {
      var rating = el('span', 'review-item__rating');
      rating.appendChild(star());
      rating.appendChild(document.createTextNode(' ' + review.rating));
      rating.setAttribute('aria-label', '별점 ' + review.rating + '점');
      head.appendChild(rating);
    }
    if (review.relative_time) {
      head.appendChild(el('span', 'review-item__time', review.relative_time));
    }
    li.appendChild(head);

    // 남이 쓴 글이다. 항상 textContent로만 넣는다 (innerHTML 금지).
    li.appendChild(el('p', 'review-item__text', review.text));
    return li;
  }

  function renderReviewPlace(place, kakaoPlace) {
    clearPanelBody();
    ratingRow(place);

    var reviews = place.reviews || [];
    if (reviews.length) {
      var list = el('ul', 'review-list plain-list');
      for (var i = 0; i < reviews.length; i += 1) {
        list.appendChild(reviewItem(reviews[i]));
      }
      panelBody.appendChild(list);

      /* 리뷰가 있을 때만 분석을 시작한다.
         **리뷰가 0개면 이 블록을 숨기는 게 아니라 아예 만들지 않는다** —
         분석할 원문이 없는데 「분석 중」을 띄우면 영영 끝나지 않는 것처럼 보인다. */
      startAnalysis(kakaoPlace, reviews);
    } else {
      // 가게는 찾았는데 리뷰만 없는 경우다. '못 찾음'과 구분해서 말한다.
      panelStatus('review-panel__status--empty', '아직 등록된 구글 리뷰가 없어요');
    }

    // 바깥으로 나가는 링크는 언제나 맨 끝이다. 분석 블록보다 뒤에 붙는다.
    panelLink(place.google_maps_uri, REVIEW_TEXT.google);
  }

  /* --- AI 리뷰 분석 ---------------------------------------------
     UI-CONTRACT 「.analysis」. 리뷰가 그려진 직후 자동으로 시작한다 —
     사용자가 누르는 버튼은 없다.
     ------------------------------------------------------------ */

  /* 캔버스는 var()를 읽지 못하므로 실제 렌더링된 토큰 값을 꺼내 쓴다.
     읽지 못하는 환경(아주 오래된 브라우저)에서는 본문 색으로 떨어진다. */
  function toneColor(tone) {
    var token = TONE_TOKENS[tone] || TONE_TOKENS.neutral;
    var value = window.getComputedStyle(document.documentElement).getPropertyValue(token);
    return (value || '').trim() || 'currentColor';
  }

  function analysisStatus(section, modifier, message) {
    section.appendChild(el('p', 'analysis__status ' + modifier, message));
  }

  /* 제목만 남기고 본문을 비운다. 리뷰 패널과 같은 방식이다 —
     상태를 섞지 않으려고 그릴 때마다 통째로 지우고 다시 채운다. */
  function clearAnalysisBody(section) {
    while (section.childNodes.length > 1) {
      section.removeChild(section.lastChild);
    }
  }

  function buildAnalysisSection() {
    var section = el('section', 'analysis');
    section.setAttribute('aria-labelledby', 'analysis-title');

    var title = el('h3', 'h2 analysis__title', ANALYSIS_TEXT.title);
    title.id = 'analysis-title';
    section.appendChild(title);

    return section;
  }

  function sentimentBlock(sentiment) {
    var block = el('div', 'analysis__sentiment');
    var total = 0;
    var i;

    for (i = 0; i < SENTIMENTS.length; i += 1) {
      total += sentiment[SENTIMENTS[i].key] || 0;
    }
    if (!total) return null;

    var bar = el('div', 'analysis__bar');
    bar.setAttribute('role', 'img');

    var legend = el('ul', 'analysis__legend plain-list');
    var described = [];

    for (i = 0; i < SENTIMENTS.length; i += 1) {
      var spec = SENTIMENTS[i];
      var count = sentiment[spec.key] || 0;

      /* 0인 구간은 <span>을 만들지 않는다.
         .analysis__bar에 border-radius가 걸려 있어 width:0인 조각이 1px 슬라이버로 남는다. */
      if (count > 0) {
        var seg = el('span', 'analysis__seg analysis__seg--' + spec.key);
        seg.style.width = ((count / total) * 100).toFixed(2) + '%';
        bar.appendChild(seg);
      }

      described.push(spec.label + ' ' + count + '개');

      /* 항목마다 modifier를 붙이지 않는다 — 셋의 생김새가 같기 때문이다.
         구분은 이모지·라벨·바로 위 막대의 색 셋이 함께 진다.
         쓰이지 않을 이름을 계약서에 얼려두면 나중에 죽은 선택자가 된다. */
      var item = el('li', 'analysis__legend-item');
      // 이모지는 장식이다. 의미는 바로 옆 라벨이 진다 (색만으로 구분하지 않는다).
      var face = el('span', 'analysis__face', spec.face);
      face.setAttribute('aria-hidden', 'true');
      item.appendChild(face);
      item.appendChild(el('span', 'analysis__legend-label', spec.label));
      item.appendChild(el('span', 'analysis__legend-count', String(count)));
      legend.appendChild(item);
    }

    // 막대는 <span> 덩어리라 그 자체로는 읽히지 않는다. 전체를 한 문장으로 준다.
    bar.setAttribute('aria-label', described.join(', '));

    block.appendChild(bar);
    block.appendChild(legend);
    return block;
  }

  /* 라이브러리가 없을 때(CDN 차단·오프라인) 쓰는 대체 구름.
     weight에 비례해 글자 크기만 준다. 캔버스가 아니라 진짜 텍스트다. */
  function fallbackCloud(keywords) {
    var list = el('ul', 'analysis__fallback plain-list');

    for (var i = 0; i < keywords.length; i += 1) {
      var keyword = keywords[i];
      var word = el('li', 'analysis__word analysis__word--' + keyword.tone, keyword.word);
      // 1~10 → 14~32px
      word.style.fontSize = (14 + (keyword.weight - 1) * 2) + 'px';
      list.appendChild(word);
    }
    return list;
  }

  function cloudBlock(keywords) {
    if (!keywords.length) return null;

    var block = el('div', 'analysis__cloud');
    /* 패널 본문이 aria-live="polite"라 분석이 끝나면 추가된 내용이 낭독된다.
       감정과 총평은 들을 값이 있지만 단어 15개를 줄줄이 읽는 것은 소음이다. */
    block.setAttribute('aria-live', 'off');

    if (typeof window.WordCloud === 'function') {
      var canvas = el('canvas', 'analysis__canvas');
      // 캔버스 안의 글자는 보조기기에 읽히지 않는다. 아래 숨김 목록이 그 몫을 한다.
      canvas.setAttribute('aria-hidden', 'true');
      block.appendChild(canvas);

      var words = el('ul', 'plain-list visually-hidden');
      for (var i = 0; i < keywords.length; i += 1) {
        words.appendChild(el('li', null, keywords[i].word));
      }
      block.appendChild(words);
    } else {
      block.appendChild(fallbackCloud(keywords));
    }
    return block;
  }

  /**
   * 캔버스에 실제로 그린다. **레이아웃이 잡힌 뒤에 불러야 한다** —
   * 폭이 0이면 wordcloud2가 아무것도 그리지 않는다.
   */
  function drawCloud(canvas, keywords) {
    var cssWidth = canvas.clientWidth;
    var cssHeight = canvas.clientHeight;
    if (!cssWidth || !cssHeight) return false;

    /* 캔버스 픽셀과 CSS 픽셀을 맞춘다. 이걸 하지 않으면 레티나에서 글자가 뭉갠다.
       wordcloud2는 canvas.width/height(픽셀 공간)에 그리므로 dpr을 곱해둔다. */
    var dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(cssWidth * dpr);
    canvas.height = Math.round(cssHeight * dpr);

    var colorByWord = Object.create(null);
    var list = [];
    for (var i = 0; i < keywords.length; i += 1) {
      colorByWord[keywords[i].word] = toneColor(keywords[i].tone);
      list.push([keywords[i].word, keywords[i].weight]);
    }

    window.WordCloud(canvas, {
      list: list,
      // style.css의 font-family와 맞춘다. 캔버스는 CSS 폰트를 물려받지 않는다.
      fontFamily: "'Inter', 'Pretendard', -apple-system, sans-serif",
      fontWeight: '600',
      color: function (word) { return colorByWord[word] || 'currentColor'; },
      // 폭에 비례시켜 375px과 1080px 양쪽에서 같은 밀도로 보이게 한다
      weightFactor: function (weight) {
        return (weight / 10) * (canvas.width / 13);
      },
      // 한글은 세로로 눕히면 읽기 어렵다. 회전을 아예 끈다
      rotateRatio: 0,
      minRotation: 0,
      maxRotation: 0,
      // 캐시된 결과를 다시 그릴 때 같은 그림이 나오게 한다
      shuffle: false,
      gridSize: Math.max(4, Math.round(canvas.width / 90)),
      backgroundColor: 'transparent',
      drawOutOfBound: false
    });
    return true;
  }

  function renderAnalysis(section, analysis) {
    clearAnalysisBody(section);

    var sentiment = sentimentBlock(analysis.sentiment);
    if (sentiment) section.appendChild(sentiment);

    // 키워드가 0개면 구름을 만들지 않는다. 서버가 빈 배열을 성공으로 내보낼 수 있다.
    var keywords = analysis.keywords || [];
    var cloud = cloudBlock(keywords);
    if (cloud) section.appendChild(cloud);

    // 총평도 빈 문자열이면 말풍선을 띄우지 않는다.
    if (analysis.summary) {
      section.appendChild(el('p', 'analysis__summary', analysis.summary));
    }

    /* 그리기는 DOM에 붙은 뒤여야 한다 — 그래야 clientWidth가 잡힌다.
       실패하면(폭 0 등) 캔버스를 걷어내고 목록으로 대신한다. 빈 네모를 남기지 않는다. */
    if (cloud) {
      var canvas = cloud.querySelector('.analysis__canvas');
      if (canvas && !drawCloud(canvas, keywords)) {
        cloud.replaceChild(fallbackCloud(keywords), canvas);
      }
    }
  }

  function renderAnalysisLoading(section) {
    clearAnalysisBody(section);
    analysisStatus(section, 'analysis__status--loading', ANALYSIS_TEXT.loading);
  }

  /* 네트워크 응답과 캐시가 **완전히 같은 봉투**로 들어온다.
     분석은 곁다리 정보라 실패해도 리뷰 본문은 그대로 남는다 —
     리뷰처럼 카카오맵 링크로 빠져나갈 길을 따로 주지 않는다. */
  function applyAnalysisEnvelope(section, data) {
    if (data && data.ok && data.analysis) {
      renderAnalysis(section, data.analysis);
      return;
    }
    var error = (data && data.error) || {};
    clearAnalysisBody(section);
    analysisStatus(section, 'analysis__status--error', error.message || ANALYSIS_TEXT.failed);
  }

  /* 리뷰 캐시와 갈리는 지점이다 — **성공만 캐시한다.**
     리뷰의 not_found는 다시 물어도 답이 같은 영구 실패라 캐시할 값이 있었다.
     분석에는 그런 상태가 없다. 타임아웃·한도 초과·키 없음·형식 오류는 전부
     시간이 지나면 풀리므로, 캐시하면 고쳐도 탭을 새로 열기 전까지 고쳐지지 않은 것처럼 보인다. */
  function shouldCacheAnalysis(data) {
    return Boolean(data && typeof data === 'object' && data.ok);
  }

  function startAnalysis(place, reviews) {
    if (!place || !reviews.length) return;

    var section = buildAnalysisSection();
    panelBody.appendChild(section);

    var cached = window.AnalysisCache.get(place.id);
    if (cached) {
      // 캐시 적중 — AI에게 다시 묻지 않는다. 로딩 문구도 띄우지 않는다.
      applyAnalysisEnvelope(section, cached);
      return;
    }

    renderAnalysisLoading(section);

    /* 리뷰와 **같은 순번을 쓴다.** 분석은 리뷰가 그려진 직후에 시작하므로
       그 시점의 reviewSeq를 잡아두면 된다. 새 변수를 만들면 두 장치가 어긋날 수 있다.
       패널을 A로 열고 닫고 B로 다시 열었을 때 A의 분석이 B에 붙는 사고를 막는다. */
    var seq = reviewSeq;

    var texts = [];
    for (var i = 0; i < reviews.length; i += 1) {
      if (reviews[i] && reviews[i].text) texts.push(reviews[i].text);
    }
    if (!texts.length) {
      clearAnalysisBody(section);
      analysisStatus(section, 'analysis__status--error', ANALYSIS_TEXT.failed);
      return;
    }

    window.fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ name: place.place_name, reviews: texts })
    })
      .then(function (response) { return response.json(); })
      .then(function (data) {
        if (seq !== reviewSeq) return;   // 그 사이 다른 가게를 열었다
        if (shouldCacheAnalysis(data)) window.AnalysisCache.set(place.id, data);
        applyAnalysisEnvelope(section, data);
      })
      .catch(function () {
        if (seq !== reviewSeq) return;
        // 연결 실패는 캐시하지 않는다. 연결이 돌아오면 다시 시도할 수 있어야 한다.
        clearAnalysisBody(section);
        analysisStatus(section, 'analysis__status--error', '분석 서버에 연결하지 못했어요');
      });
  }

  /* 못 찾음·실패. 어느 쪽이든 빠져나갈 길(카카오맵)을 함께 준다. */
  function renderReviewProblem(modifier, message, kakaoUrl) {
    clearPanelBody();
    panelStatus(modifier, message);
    panelLink(kakaoUrl, REVIEW_TEXT.kakao);
  }

  function renderReviewLoading() {
    clearPanelBody();
    panelStatus('review-panel__status--loading', REVIEW_TEXT.loading);
  }

  /* 네트워크 응답과 캐시가 **완전히 같은 봉투**로 들어온다.
     그래서 이 분기가 두 경로에서 한 번만 쓰인다. */
  function applyReviewEnvelope(data, place) {
    if (data && data.ok && data.place) {
      // 카카오 쪽 place도 함께 넘긴다 — 분석이 place.id(캐시 키)와 place_name을 쓴다.
      renderReviewPlace(data.place, place);
      return;
    }
    var error = (data && data.error) || {};
    if (error.code === 'not_found') {
      renderReviewProblem('review-panel__status--empty', REVIEW_TEXT.notFound, place.place_url);
      return;
    }
    renderReviewProblem('review-panel__status--error', error.message || REVIEW_TEXT.failed, place.place_url);
  }

  /* 캐시할 값과 하지 않을 값을 가른다.

     넣는다  — 성공, 그리고 not_found.
               not_found야말로 캐시가 필요한 쪽이다. 구글에 없는 가게를 연타하면
               '없다'를 확인하는 호출만으로 무료 한도(월 1,000건)가 닳는다.
     안 넣는다 — 타임아웃·업스트림 오류·키 없음.
               전부 시간이 지나면 풀리는 상태다. 캐시하면 탭을 새로 열기 전까지
               고쳐도 고쳐지지 않은 것처럼 보인다. */
  function shouldCache(data) {
    if (!data || typeof data !== 'object') return false;
    if (data.ok) return true;
    return Boolean(data.error && data.error.code === 'not_found');
  }

  function requestReviews(place) {
    var cached = window.ReviewCache.get(place.id);
    if (cached) {
      // 캐시 적중 — 네트워크를 타지 않는다. 로딩 문구도 띄우지 않는다.
      applyReviewEnvelope(cached, place);
      return;
    }

    renderReviewLoading();

    reviewSeq += 1;
    var seq = reviewSeq;

    var params = new URLSearchParams();
    params.set('name', place.place_name);
    // x가 경도, y가 위도다. 서버가 숫자로 바꾸고 범위까지 확인한다.
    params.set('x', place.x || '');
    params.set('y', place.y || '');

    window.fetch('/api/reviews?' + params.toString(), { headers: { Accept: 'application/json' } })
      .then(function (response) { return response.json(); })
      .then(function (data) {
        if (seq !== reviewSeq) return;   // 그 사이 다른 가게를 열었다
        if (shouldCache(data)) window.ReviewCache.set(place.id, data);
        applyReviewEnvelope(data, place);
      })
      .catch(function () {
        if (seq !== reviewSeq) return;
        // 연결 실패는 캐시하지 않는다. 연결이 돌아오면 다시 시도할 수 있어야 한다.
        renderReviewProblem('review-panel__status--error', '리뷰 서버에 연결하지 못했어요', place.place_url);
      });
  }

  function openReviews(place, opener) {
    panelOpener = opener || null;
    panelName.textContent = place.place_name;
    clearPanelBody();

    // showModal()이 포커스 가둠·Esc 닫기·배경 비활성을 한 번에 해준다.
    // 아주 오래된 브라우저에는 없으므로 그때는 open 속성만 세운다(모달 동작은 빠진다).
    if (typeof panel.showModal === 'function') {
      if (!panel.open) panel.showModal();
    } else {
      panel.setAttribute('open', '');
    }

    requestReviews(place);
  }

  function closeReviews() {
    reviewSeq += 1;   // 떠 있는 응답이 닫힌 패널을 덮지 않게 무효화한다
    if (typeof panel.close === 'function' && panel.open) {
      panel.close();
    } else {
      panel.removeAttribute('open');
      restoreFocus();
    }
  }

  function restoreFocus() {
    // 열기 전 있던 자리로 포커스를 되돌린다. showModal()은 여기까지는 해주지 않는다.
    if (panelOpener && document.contains(panelOpener)) panelOpener.focus();
    panelOpener = null;
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
      /* 해제는 막지 않는다. 이미 담아둔 것은 본인 데이터이고,
         저장이 아직 브라우저 로컬이라 계정과 묶여 있지도 않다.
         로그인 게이트는 **새로 담는 쪽**에만 세운다. */
      window.SavedPlaces.remove(id);
      showToast('담기를 해제했어요');
    } else {
      /* 담기는 로그인한 사람만 (UI-CONTRACT 「window.Auth」).
         requireSignIn이 false면 로그인 창까지 이미 띄운 뒤다. */
      if (window.Auth && !window.Auth.requireSignIn('로그인하면 이 가게를 담아둘 수 있어요')) {
        return;
      }
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

  /* 카드 전체가 리뷰 패널의 클릭 영역이다 (UI-CONTRACT 「.place-card」).
     담기 핸들러와 따로 두는 이유 — 저 위 핸들러는 담기 버튼에서 이미 return하므로
     두 리스너가 같은 클릭을 두 번 처리하는 일은 없다. */
  results.addEventListener('click', function (event) {
    var card = event.target.closest('.place-card');
    if (!card || !results.contains(card)) return;

    var reviewButton = event.target.closest('[data-action="reviews"]');

    /* 액션 줄 안에서 시작된 클릭은 리뷰를 열지 않는다 — 담기와 상세 보기가 먼저다.
       리뷰 보기 버튼만 예외다. 그 줄 안에 있지만 리뷰를 여는 것이 하는 일이다. */
    if (!reviewButton && event.target.closest('.place-card__actions')) return;

    var place = placesById[card.dataset.kakaoId];
    if (!place) return;

    // 닫을 때 포커스를 돌려놓을 자리. 카드는 포커스를 받지 못하므로 버튼을 넘긴다.
    openReviews(place, reviewButton || card.querySelector('.place-card__reviews'));
  });

  panel.addEventListener('click', function (event) {
    if (event.target.closest('[data-action="close-reviews"]')) {
      closeReviews();
      return;
    }
    /* 배경(::backdrop)을 눌렀을 때다.
       <dialog>는 배경도 자기 자신이 받으므로 target이 패널 그 자체면 바깥을 누른 것이다.
       내용은 .review-panel__inner가 덮고 있어 여기까지 오지 않는다. */
    if (event.target === panel) closeReviews();
  });

  /* Esc로 닫을 때는 위 핸들러를 타지 않고 브라우저가 바로 close 이벤트를 쏜다.
     포커스 되돌리기를 여기 두어야 세 경로(닫기 버튼·배경·Esc)가 모두 지나간다. */
  panel.addEventListener('close', function () {
    reviewSeq += 1;
    restoreFocus();
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

  /* 로그인 상태에 따라 안내 문단이 붙고 떨어진다.
     **isSignedIn()을 직접 읽지 않고 onChange로 그린다** — 세션 복원이 비동기라
     페이지 로드 직후에 읽으면 로그인한 사용자를 비로그인으로 본다
     (UI-CONTRACT 「window.Auth」). onChange는 등록 즉시 한 번,
     복원이 끝나면 다시 호출되므로 두 시점이 모두 덮인다. */
  if (window.Auth) {
    window.Auth.onChange(function () { renderLocked(); });
  }
})();
