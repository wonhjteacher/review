# UI-CONTRACT.md — 맛집 담기 페이지 클래스 계약

> **작성** 팀 리드 · 2026-08-20
> **개정** 2026-08-20 — `<head>` 계약 추가 · `<body>` 컨테이너 조합 확정 (공백 2건 메움)
> **개정** 2026-08-21 — 구글 리뷰 패널 추가. `.review-panel`·`.review-item` 계약 신설 ·
>   `/api/search`가 `x`·`y`를 함께 내려보내도록 봉투 확장 · `/api/reviews` 봉투 신설
> **읽는 사람** `logic`(마크업 작성) · `design`(스타일 작성)
> **이 파일은 두 팀원 모두 읽기 전용이다.** 변경이 필요하면 리드에게 SendMessage.

---

## 왜 이 문서가 있나

`save.html`의 **마크업은 `logic`이**, **스타일은 `design`이** 쓴다.
클래스 이름을 미리 고정해두지 않으면 design이 logic을 기다려야 하므로 병렬 작업이 무너진다.
아래 이름만 쓰면 둘은 서로의 파일을 한 번도 열지 않고 동시에 끝낼 수 있다.

**규칙**
- `logic`은 아래 클래스를 **그대로** 쓴다. 이름을 바꾸거나 줄이지 않는다.
- `design`은 아래 클래스에만 스타일을 건다. 여기 없는 선택자를 지어내지 않는다.
- 추가 클래스가 필요하면 → 상대에게 SendMessage → 합의 후 리드가 이 문서를 갱신한다.
- 유틸 클래스(`.container`, `.caption`, `.body`, `.h1`, `.h2`, `.badge`, `.btn-primary`)는
  `style.css`에 이미 있으므로 **재정의하지 말고 그대로 재사용**한다.

---

## 문서 구조

```html
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>맛집 담기 — 오늘은 여기</title>

  <!-- 폰트 4줄은 index.html 9~12행과 완전히 동일하게 유지한다.
       style.css가 font-family: 'Inter','Pretendard',... 를 선언하므로
       이 줄들이 없으면 에러 없이 시스템 폰트로 조용히 떨어진다. -->
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css">

  <link rel="stylesheet" href="style.css">
  <link rel="stylesheet" href="save.css">
</head>

<body class="save-page container container--wide">
  <header class="save-header">
    <a class="save-header__back" href="index.html">← 오늘은 여기</a>
    <h1 class="h1 save-header__title">맛집 담기</h1>
    <p class="body save-header__desc">가보고 싶은 곳을 검색해서 목록에 담아두세요</p>
  </header>

  <section class="search">
    <form class="search__form" id="search-form">
      <input class="search__input" id="search-input" type="search"
             placeholder="가게 이름이나 지역을 입력하세요">
      <button class="search__submit" type="submit">검색</button>
    </form>

    <div class="search__chips" id="search-chips" role="group" aria-label="카테고리">
      <button type="button" class="chip is-active" data-code="">전체</button>
      <button type="button" class="chip" data-code="FD6">음식점</button>
      <button type="button" class="chip" data-code="CE7">카페</button>
    </div>
  </section>

  <p class="search__status" id="search-status" role="status" aria-live="polite"></p>

  <ul class="results plain-list" id="results"></ul>

  <section class="saved">
    <h2 class="h2 saved__title">담아둔 곳 <span class="saved__count" id="saved-count">0</span></h2>
    <ul class="saved-list plain-list" id="saved-list"></ul>
  </section>

  <div class="toast" id="toast" role="status" aria-live="polite" hidden></div>
</body>
```

---

## `.place-card` — 검색 결과 카드 (`.results` 안, `<li>`)

```html
<li class="place-card" data-kakao-id="{id}">
  <p class="caption place-card__category">{category_name 마지막 마디}</p>
  <h3 class="h2 place-card__name">{place_name}</h3>
  <p class="body place-card__address">{road_address_name || address_name}</p>
  <p class="caption place-card__distance">{distance}m</p>   <!-- 거리 없으면 이 요소를 아예 넣지 않는다 -->
  <div class="place-card__actions">
    <button type="button" class="place-card__reviews" data-action="reviews">리뷰 보기</button>
    <a class="place-card__link" href="{place_url}" target="_blank" rel="noopener noreferrer">상세 보기</a>
    <button type="button" class="place-card__save" data-action="save">담기</button>
  </div>
</li>
```

**카드 전체가 리뷰 패널의 클릭 영역이다.**
`.place-card__actions` **안**에서 시작된 클릭은 제외한다 — 담기·상세 보기가 먼저다.
`.place-card__reviews` 버튼은 그 클릭 영역의 **키보드 대체 수단**이다.
카드 전체에 `tabindex`를 걸지 않는다 (카드 안에 이미 포커스 가능한 요소가 셋이다).

**상태**
| 클래스 | 의미 | 버튼 라벨 |
|---|---|---|
| `.place-card__save` | 아직 안 담음 | `담기` |
| `.place-card__save.is-saved` | 이미 담음 | `담았어요` |

- `.is-saved`일 때 버튼은 **비활성이 아니라** 담기 해제로 동작한다 (`aria-pressed` 사용).
- 카드 자체에는 상태 클래스를 걸지 않는다. 상태는 버튼에만 붙는다.

---

## `.review-panel` — 구글 리뷰 패널 (`<body>` 직속, `.toast` 앞)

`<dialog>`다. `showModal()`이 포커스 가둠·Esc 닫기·배경 비활성을 브라우저에게서 공짜로 받는다.
직접 만든 오버레이로 대체하지 않는다.

```html
<dialog class="review-panel" id="review-panel" aria-labelledby="review-panel-name">
  <div class="review-panel__inner">
    <header class="review-panel__head">
      <h2 class="h2 review-panel__name" id="review-panel-name">{가게 이름}</h2>
      <button type="button" class="review-panel__close" data-action="close-reviews"
              aria-label="리뷰 닫기">닫기</button>
    </header>
    <div class="review-panel__body" id="review-panel-body"><!-- JS가 채운다 --></div>
  </div>
</dialog>
```

`.review-panel__body` 안은 **세 상태 중 하나**다. 세 개를 동시에 두지 않는다.

**① 불러오는 중**
```html
<p class="review-panel__status review-panel__status--loading">리뷰를 불러오는 중이에요</p>
```

**② 리뷰 있음**
```html
<p class="review-panel__rating">
  <span class="review-panel__star" aria-hidden="true">★</span>
  <span class="review-panel__score">4.3</span>
  <span class="review-panel__count">리뷰 128개</span>
</p>
<ul class="review-list plain-list">
  <li class="review-item">
    <div class="review-item__head">
      <span class="review-item__author">{작성자}</span>
      <span class="review-item__rating"><span aria-hidden="true">★</span> 5</span>
      <span class="review-item__time">{3개월 전}</span>
    </div>
    <p class="review-item__text">{내용}</p>
  </li>
</ul>
<a class="review-panel__link" href="{googleMapsUri}" target="_blank" rel="noopener noreferrer">
  구글맵에서 전체 리뷰 보기</a>
```

**③ 못 찾음 · 실패** — 카카오맵 링크로 빠져나갈 길을 반드시 함께 준다
```html
<p class="review-panel__status review-panel__status--empty">구글 리뷰를 찾지 못했어요</p>
<a class="review-panel__link" href="{place_url}" target="_blank" rel="noopener noreferrer">
  카카오맵에서 보기</a>
```
실패는 `--empty` 대신 `.review-panel__status--error`를 쓰고 서버 메시지를 그대로 노출한다.
`.search__status--error`와 같은 규칙이다 — **색만으로 구분하지 않는다.**

**별점은 `★`(U+2605)로 쓴다. `⭐`(이모지)를 쓰지 않는다** — CLAUDE.md ③ 이모지 금지.
`★`는 활자 문자라 본문 색·굵기를 그대로 따르고, 이모지는 OS 컬러 글리프로 튄다.
숫자를 항상 옆에 붙이고 별 개수로 점수를 표현하지 않는다 (4.3을 별 4개로 반올림하면 거짓이 된다).

**`display`를 무조건 선언하지 않는다.** `.toast`와 **똑같은 함정**이다 —
`dialog`의 브라우저 기본값은 `dialog:not([open]) { display: none }`인데,
`.review-panel { display: flex }`가 이를 이겨 패널이 영영 떠 있게 된다.
`save.css`의 이 한 줄을 지우지 않는다:

```css
.review-panel:not([open]) { display: none; }
```

---

## `.saved-item` — 담아둔 목록 (`.saved-list` 안, `<li>`)

```html
<li class="saved-item" data-kakao-id="{id}">
  <div class="saved-item__body">
    <p class="h2 saved-item__name">{name}</p>
    <p class="caption saved-item__category">{category}</p>
  </div>
  <button type="button" class="saved-item__remove" data-action="remove"
          aria-label="{name} 담기 해제">해제</button>
</li>
```

---

## `.search__status` — 로딩 · 에러 · 0건

**단일 요소를 modifier로 전환한다.** 세 개를 각각 만들지 않는다.

| 클래스 | 문구 (`~해요`체 · 느낌표 없음) |
|---|---|
| `.search__status--loading` | `찾아보는 중이에요` |
| `.search__status--error` | 서버가 준 메시지를 그대로 노출 |
| `.search__status--empty` | `검색 결과가 없어요. 다른 이름으로 찾아보세요` |
| (클래스 없음 + 빈 텍스트) | 평상시 — `design`은 이때 요소가 자리를 차지하지 않게 처리 |

에러는 **색만으로 구분하지 않는다** (DESIGN 2장). 문구를 반드시 함께 쓴다.

---

## `/api/search` 응답 봉투 — 서버와 프론트의 계약

`/api/search` 구현과 `save.js` 사이의 인터페이스다. **모든 실패를 한 봉투로 정규화한다.**

> **구현이 둘이다.** 로컬은 `server.py`, 배포는 `api/search.js`(Vercel).
> 둘은 같은 봉투·같은 에러 코드·같은 상태 코드를 내야 하며, **어긋나면 이 문서가 옳다.**
> 한쪽을 고치면 반드시 다른 쪽도 고친다. 대조 방법은 `CLAUDE.md` 검증 절 참고.
프론트는 HTTP 상태 코드를 보지 않고 `ok`만 확인하므로 예외 분기가 하나로 끝난다.

```jsonc
// 성공
{ "ok": true,  "places": [ { id, place_name, category_name,
                             road_address_name, address_name, distance, place_url,
                             x, y } ] }
// 실패 — 상태 코드와 무관하게 언제나 같은 모양
{ "ok": false, "error": { "code": "empty_query", "message": "검색어를 입력해 주세요" } }
```

- `message`는 **`~해요`체 한국어**다. 프론트가 `.search__status--error`에 **그대로** 노출한다.
  서버가 사용자 문구의 주인이므로, 여기에 영문 예외 메시지나 스택을 넣지 않는다.
- 필드는 위 **9개만** 내려보낸다. `phone`·`category_group_code` 등 나머지 카카오 원본은 흘리지 않는다.
- **`x`·`y`는 2026-08-21에 추가됐다.** 구글 리뷰 조회가 `locationBias`로 쓴다 —
  같은 이름의 가게가 전국에 있으므로 좌표 없이는 엉뚱한 가게의 리뷰가 붙는다.
  `x`가 경도(longitude), `y`가 위도(latitude)다. **순서를 뒤집기 쉬우니 주의한다.**
  카카오는 둘 다 문자열로 준다 — 숫자로 바꾸는 것은 서버(`/api/reviews`)의 몫이다.
- 상태 코드는 정직하게 붙이되(키 없음 `503` / 빈 검색어 `400` / 업스트림 `502`·`504`) **프론트의 분기 근거로 쓰지 않는다.**

**`distance`에 대한 현재 상태** — `server.py`는 좌표(`x`/`y`)를 받으면 카카오가 준 `distance`를 그대로 내려보낸다.
다만 `save.js`가 아직 좌표를 보내지 않으므로 **`.place-card__distance`는 실제로 렌더된 적이 없다.**
위치 권한을 붙일지는 미정이다. 그때까지 이 요소는 계약에만 있고 화면에는 없다.

## `/api/reviews` 응답 봉투 — 구글 리뷰

`/api/search`와 **같은 봉투 규칙**을 따른다. 프론트는 여기서도 `ok`만 본다.
구현이 둘인 것도 같다 — 로컬 `server.py`, 배포 `api/reviews.js`. **한쪽만 고치지 않는다.**

**요청** `GET /api/reviews?name={place_name}&x={경도}&y={위도}`
세 값 모두 `/api/search`가 준 것을 그대로 넘긴다.

```jsonc
// 성공
{ "ok": true,
  "place": {
    "name": "…",                       // displayName.text
    "rating": 4.3,                     // 없으면 null
    "user_rating_count": 128,          // 없으면 0
    "google_maps_uri": "https://…",    // 없으면 ""
    "reviews": [ { "author": "…", "rating": 5,
                   "text": "…", "relative_time": "3개월 전" } ]
  } }
// 실패 — /api/search와 완전히 같은 모양
{ "ok": false, "error": { "code": "not_found", "message": "구글 리뷰를 찾지 못했어요" } }
```

| code | HTTP | message |
|---|---|---|
| `empty_query` | 400 | `가게 이름이 없어요` |
| `bad_coords` | 400 | `가게 위치를 알 수 없어요` |
| `no_api_key` | 503 | `리뷰 서버 설정이 아직 안 됐어요` |
| `not_found` | 404 | `구글 리뷰를 찾지 못했어요` |
| `upstream_http` / `upstream_unreachable` / `upstream_bad_json` | 502 | 상황별 `~해요` 문구 |
| `upstream_timeout` | 504 | `리뷰를 불러오는 데 오래 걸려서 멈췄어요. 잠시 뒤에 다시 해주세요` |

**서버는 구글 Places API (New)만 쓴다.** `POST https://places.googleapis.com/v1/places:searchText`,
키는 `X-Goog-Api-Key` 헤더, 필드는 `X-Goog-FieldMask` 헤더.
**구버전(`?key=`를 URL에 붙이는 GET)으로 돌아가지 않는다.**

**오매칭 방지는 `locationRestriction` + `rectangle`이다. `locationBias`로 되돌리지 않는다.**
이름 그대로 bias는 '선호'일 뿐 반경 밖 결과를 **배제하지 않는다.** 실측으로 확인했다 —
부산에만 있는 `해운대암소갈비집`을 서울 성수동 좌표로 조회했을 때:

| 방식 | 결과 |
|---|---|
| `locationBias` + circle | **부산 가게를 그대로 반환 — 오매칭** |
| `locationRestriction` + circle | `400 Unknown name "circle"` — Text Search는 circle을 안 받는다 |
| `locationRestriction` + rectangle | **0건 — 차단 성공** |
| 둘을 함께 지정 | `400 ... cannot be set at the same time` — 택일이다 |

반경은 `bounding_box()`/`boundingBox()`가 위경도 박스로 바꾼다.
박스는 원보다 넓어 **모서리가 약 212m까지** 늘어난다. 그래도 도시 단위 오매칭은 확실히 막힌다.

대가가 있다 — 카카오와 구글의 좌표가 이 반경 이상 어긋난 가게는 `not_found`가 된다.
**틀린 가게의 리뷰를 보여주느니 못 찾았다고 말하는 편이 낫다**는 판단이다.
못 찾는 가게가 잦으면 `SEARCH_RADIUS_M` **하나만** 키운다 (두 구현 모두).

**FieldMask는 아래 5개로 고정이다. 늘리지 않는다** — 요청 필드가 늘면 과금 등급이 올라간다.
```
places.displayName,places.rating,places.userRatingCount,places.reviews,places.googleMapsUri
```

**캐시** — 구글 리뷰는 월 1,000건까지만 무료다.
한 번 조회한 가게는 `sessionStorage`에 넣고, 같은 카카오 `id`를 다시 열면 **네트워크를 타지 않는다.**
캐시 담당은 `review-cache.js`(`window.ReviewCache`) 하나뿐이다 — `save.js`가 직접 `sessionStorage`를 만지지 않는다.
**실패 응답도 캐시한다.** 못 찾는 가게를 연타하면 못 찾는 호출로 무료 한도가 닳는다.

---

## `.toast` — 담김 안내

- `hidden` 속성으로 토글한다. `display: none`을 CSS에서 강제하지 않는다 (JS가 `hidden`을 제어).
- 문구: `담았어요` / `담기를 해제했어요`

---

## 지켜야 할 공통 사항

**카피 (CLAUDE.md ③ · DESIGN 7장)**
`AI 추천` 및 준하는 표현 금지 · 느낌표 금지 · `최고의`·`완벽한`·`혁신적인` 금지 ·
`~해요` 중심 존댓말 · 이모지를 UI 요소로 쓰지 않음

**접근성 (DESIGN 9장)**
- 모든 버튼 터치 영역 최소 44×44px
- 포커스 링 제거 금지
- 상태를 색만으로 구분하지 않음 (`.is-active` 칩, `.is-saved` 버튼 모두 형태도 함께 변경)
- 375px에서 가로 스크롤 없음

**반응형 (CLAUDE.md ④)**
브레이크포인트 3단 — 모바일 <768 / 태블릿 768~1023 / PC ≥1024.
`<body>`는 `save-page container container--wide` **세 클래스를 함께** 쓴다.

`.container--wide`는 단독 클래스가 아니라 **modifier**다 — `max-width`(480/768/1080)만 갖고 있고
`width: 100%` · `margin: 0 auto` · 좌우 `padding`은 `.container` 쪽에 있다.
`--wide`만 붙이면 정렬과 여백이 통째로 빠진다.

→ `design`은 `.save-page`에서 `max-width`를 **다시 선언하지 않는다.**
브레이크포인트 폭의 진실의 원천은 `style.css`의 `.container--wide` 하나뿐이다.
`.save-page`가 더할 수 있는 것은 세로 여백(예: 고정 토스트를 피하는 `padding-bottom`)뿐이다.
`.results` 그리드는 모바일 1열 → 태블릿 2열 → PC 3열.
