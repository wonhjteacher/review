# UI-CONTRACT.md — 맛집 담기 페이지 클래스 계약

> **작성** 팀 리드 · 2026-08-20
> **개정** 2026-08-20 — `<head>` 계약 추가 · `<body>` 컨테이너 조합 확정 (공백 2건 메움)
> **개정** 2026-08-21 — 구글 리뷰 패널 추가. `.review-panel`·`.review-item` 계약 신설 ·
>   `/api/search`가 `x`·`y`를 함께 내려보내도록 봉투 확장 · `/api/reviews` 봉투 신설
> **개정** 2026-08-24 — 랜딩페이지에 추천 두 코너 추가. `.pick-list`·`.pick-card`·
>   `.pick-status`·`.pick-reason` 계약 신설 · `window.PopularPlaces` 창구 신설 ·
>   `SavedPlaces`에 `category` 추가 · `.toast`가 `style.css`로 이사 ·
>   `.place-card`에서 `상세 보기` 링크 제거
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

  <!-- 워드클라우드 (「.analysis」). defer라 파싱을 막지 않는다.
       이 줄이 없거나 CDN이 막혀도 save.js가 .analysis__fallback 목록으로 그린다 —
       폰트 4줄과 달리 **없어도 기능이 죽지 않는다.** -->
  <script defer src="https://cdn.jsdelivr.net/npm/wordcloud@1.2.3/src/wordcloud2.min.js"></script>
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
    <button type="button" class="place-card__save" data-action="save">담기</button>
  </div>
</li>
```

**카드 전체가 리뷰 패널의 클릭 영역이다.**
`.place-card__actions` **안**에서 시작된 클릭은 제외한다 — 담기가 먼저다.
`.place-card__reviews` 버튼은 그 클릭 영역의 **키보드 대체 수단**이다.
카드 전체에 `tabindex`를 걸지 않는다 (카드 안에 이미 포커스 가능한 요소가 둘이다).

카드에는 **상세 보기 링크를 두지 않는다.** 액션 줄은 `리뷰 보기`와 `담기` 둘뿐이다 —
`place_url`은 리뷰 패널의 `.review-panel__link`와 `saved_places` 저장에만 쓴다.

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

## `.analysis` — AI 리뷰 분석 (`.review-panel__body` 안)

구글 리뷰를 Gemini로 눌러 **한눈에 보이는 판단 재료**로 바꾼 블록이다.
자리는 **리뷰 목록 뒤 · `.review-panel__link` 앞**이다 — 바깥으로 나가는 링크는 언제나 맨 끝이다.

**리뷰가 0개면 이 블록을 아예 만들지 않는다.** 숨기는 것이 아니라 DOM에 넣지 않는다.
분석할 원문이 없는데 「분석 중」을 띄우면 영영 끝나지 않는 것처럼 보인다.

리뷰가 그려진 직후 **자동으로** 시작한다. 사용자가 누르는 버튼은 없다.

```html
<section class="analysis" aria-labelledby="analysis-title">
  <h3 class="h2 analysis__title" id="analysis-title">AI 리뷰 분석</h3>
  <!-- 아래 ①②③ 중 하나만 들어간다 -->
</section>
```

**① 분석 중**
```html
<p class="analysis__status analysis__status--loading">AI가 리뷰를 분석하는 중이에요</p>
```

**② 결과** — 감정 막대 · 워드클라우드 · 한 줄 총평
```html
<div class="analysis__sentiment">
  <div class="analysis__bar" role="img" aria-label="긍정 3개, 보통 1개, 부정 1개">
    <span class="analysis__seg analysis__seg--positive" style="width:60%"></span>
    <span class="analysis__seg analysis__seg--neutral"  style="width:20%"></span>
    <span class="analysis__seg analysis__seg--negative" style="width:20%"></span>
  </div>
  <ul class="analysis__legend plain-list">
    <li class="analysis__legend-item">
      <span class="analysis__face" aria-hidden="true">😀</span>
      <span class="analysis__legend-label">긍정</span>
      <span class="analysis__legend-count">3</span>
    </li>
    <!-- 보통 😐 · 부정 😠 도 같은 구조. **항목에는 modifier를 붙이지 않는다** —
         셋의 생김새가 같고, 구분은 이모지·라벨·바로 위 막대 색이 함께 진다 -->
  </ul>
</div>

<div class="analysis__cloud" aria-live="off">
  <canvas class="analysis__canvas" aria-hidden="true"></canvas>
  <!-- 캔버스 안의 글자는 보조기기에 **읽히지 않는다.** 같은 단어를 숨김 목록으로 함께 둔다.
       `.visually-hidden`은 화면에서만 감춘다 — display:none은 낭독에서도 빠지므로 쓰지 않는다 -->
  <ul class="plain-list visually-hidden">
    <li>국물</li><li>친절</li>
  </ul>
</div>

<p class="analysis__summary">진한 국물과 친절한 응대를 꼽는 리뷰가 많아요</p>
```

**③ 실패**
```html
<p class="analysis__status analysis__status--error">{서버가 준 메시지}</p>
```
`.review-panel__status--error`와 같은 규칙이다 — **색만으로 구분하지 않는다.**
분석은 곁다리 정보라 실패해도 **리뷰 본문은 그대로 남는다.** 카카오맵 링크로 대체하지 않는다.

**0%인 구간은 `<span>`을 만들지 않는다.** `.analysis__bar`에 `border-radius`가 걸려 있어
`width:0`인 조각이 1px 슬라이버로 남는다.

**워드클라우드 라이브러리가 없을 때**(CDN 차단·오프라인) — 캔버스 대신 목록으로 그린다.
`weight`에 비례해 `font-size`만 인라인으로 준다.
```html
<ul class="analysis__fallback plain-list">
  <li class="analysis__word analysis__word--positive" style="font-size:28px">국물</li>
</ul>
```

**색은 의미 색(semantic)만 쓴다. `--color-primary`를 쓰지 않는다.**

| 대상 | 토큰 | 흰 배경 대비 |
|---|---|---|
| 긍정 (막대·단어) | `--color-success` | 4.86:1 |
| 보통 (막대) | `--color-warning` | 4.71:1 |
| 부정 (막대·단어) | `--color-error` | 6.54:1 |
| 중립 (단어) | `--color-ink-500` | 4.69:1 |

토마토 레드는 DESIGN 10장이 CTA·선택 상태·재방문율 숫자로 한정한 색이다.
부정을 브랜드 레드로 칠하면 「빨강 = 우리 브랜드」와 「빨강 = 나쁨」이 한 화면에서 충돌한다.

**캔버스는 `var()`를 읽지 못한다.** 워드클라우드 색은 반드시
`getComputedStyle(document.documentElement).getPropertyValue('--color-success')`로 꺼내 쓴다.
토큰 값을 JS에 다시 적어두면 화면은 멀쩡한데 나중에 조용히 갈라진다 (`.container--wide`와 같은 함정).

---

## `.saved-item` — 담아둔 목록 (`.saved-list` 안, `<li>`)

```html
<li class="saved-item" data-kakao-id="{id}">
  <div class="saved-item__body">
    <p class="h2 saved-item__name">{name}</p>
    <p class="caption saved-item__category">{road_address_name}</p>
  </div>
  <button type="button" class="saved-item__remove" data-action="remove"
          aria-label="{name} 담기 해제">해제</button>
</li>
```

**`.saved-item__category`에 담기는 값은 카테고리가 아니라 주소다.**
저장소가 `saved_places` 테이블로 옮겨가면서 카테고리 컬럼이 없어졌기 때문이다.
클래스 이름을 새로 지어내지 않고(⑦) 이 줄의 자리를 주소에 내주었다 — 이름과 내용이
어긋나 있으니 나중에 카테고리를 저장하게 되면 여기를 먼저 본다.

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

## `/api/analyze` 요청·응답 봉투 — AI 리뷰 분석

앞의 둘과 **같은 봉투 규칙**이다. 프론트는 여기서도 `ok`만 본다.
구현이 둘인 것도 같다 — 로컬 `server.py`, 배포 `api/analyze.js`. **한쪽만 고치지 않는다.**

**요청** — 세 경로 중 **여기만 `POST`다.**

```
POST /api/analyze
Content-Type: application/json
```
```jsonc
{ "name": "{place_name}", "reviews": ["리뷰 본문", "…"] }
```

`GET`이 아닌 이유: 리뷰 본문 5개는 최대 7KB 남짓이라 쿼리스트링에 실으면 URL 길이 한계에 걸린다.
`name`은 프롬프트에서 **가게 이름을 키워드에서 빼는 데** 쓴다 (없어도 동작한다).

```jsonc
// 성공
{ "ok": true,
  "analysis": {
    "sentiment": { "positive": 3, "neutral": 1, "negative": 1 },
    "keywords": [ { "word": "국물", "weight": 9, "tone": "positive" } ],  // 0~15개
    "summary": "진한 국물과 친절한 응대를 꼽는 리뷰가 많아요"              // 없으면 ""
  } }
// 실패 — 앞의 두 경로와 완전히 같은 모양
{ "ok": false, "error": { "code": "bad_analysis", "message": "분석 결과를 읽지 못했어요" } }
```

| code | HTTP | message |
|---|---|---|
| `method_not_allowed` | 405 | `지원하지 않는 요청이에요` |
| `empty_reviews` | 400 | `분석할 리뷰가 없어요` |
| `no_api_key` | 503 | `분석 서버 설정이 아직 안 됐어요` |
| `upstream_http` | 502 | 상황별 `~해요` 문구 (429는 아래 두 갈래) |
| `upstream_unreachable` | 502 | `분석 서버에 연결하지 못했어요` |
| `upstream_bad_json` · `bad_analysis` | 502 | `분석 결과를 읽지 못했어요` |
| `upstream_timeout` | 504 | `분석이 오래 걸려서 멈췄어요. 잠시 뒤에 다시 해주세요` |

**429는 두 가지가 겹쳐 온다. 문구를 나눈다 — 하나는 기다리면 풀리고 하나는 안 풀린다.**

| 429의 종류 | 판별 | message |
|---|---|---|
| 분당 요청 제한 | 기본값 | `분석 요청이 많아요. 잠시 뒤에 다시 해주세요` |
| **일일 무료 한도 소진** | 응답 본문의 `quotaId`에 `PerDay` | `오늘 분석 한도를 다 썼어요. 내일 다시 해주세요` |

둘 다 `429 RESOURCE_EXHAUSTED`라 상태코드로는 구분되지 않는다. **본문을 봐야 갈린다.**
`잠시 뒤에 다시 해주세요`를 일일 소진에 띄우면 **거짓말이 된다** — 날짜가 바뀌어야 풀리기 때문이다.
판별에 실패하면 분당 제한 쪽 문구로 떨어진다(덜 틀린 쪽).

**판별하려면 본문을 넉넉히 읽어야 한다.** `quotaId`는 응답 앞부분이 아니라 `details[]` 안에 있어
500자만 잘라 보면 **놓친다.** 두 구현 모두 판별용으로 2000자를 읽고, 로그에는 500자만 남긴다.

**형식 강제는 프롬프트가 아니라 `responseSchema`가 한다.**
`generationConfig.responseSchema`는 모델의 **디코딩 자체를** 스키마에 묶으므로
형식 위반이 구조적으로 불가능해진다. 프롬프트의 「JSON으로만 답하라」는 보조 장치일 뿐이다.
그래도 서버는 `shapeAnalysis()`/`shape_analysis()`로 한 번 더 정규화한다 —
**`keywords`가 0개거나 `summary`가 빈 문자열이어도 `ok: true`로 내보낸다.**
감정 막대만이라도 뜨는 편이 통째로 실패하는 것보다 낫다.

**서버가 잘라내는 상한** — 두 구현 모두 같다: 리뷰 **5개** · 각 **1200자** · 합계 **8000자**.

**모델명은 `GEMINI_MODEL` 환경변수로 덮어쓸 수 있다.** 기본값은 `gemini-3.5-flash`.

기본값이 최신 모델이 **아닌** 것은 의도다. 무료 등급 한도가 모델마다 따로 걸리고,
신모델일수록 좁다 — 실측으로 `gemini-3.7-flash`는 **하루 20건**이었다
(`GenerateRequestsPerDayPerProjectPerModel-FreeTier`, `limit: 20`).
지연도 함께 봐야 한다. 실제 payload 기준 실측:

| 모델 | 지연 | thinking + 출력 |
|---|---|---|
| `gemini-3.7-flash` | 3.4 ~ 8.9s | 304~587 + 160~378 |
| `gemini-3.5-flash` | 6.7 ~ 16.0s | ~1400 + 155~349 |
| `gemini-3.6-flash` | **26 ~ 41s** | 652~1414 + 151~176 |

`3.6-flash`는 서버리스 함수 상한을 넘겨 **쓸 수 없다.** 바꿀 때 지연을 먼저 잰다.
`gemini-2.0-flash`는 이미 종료됐다 — Gemini 모델은 종료되며, 종료된 모델을 부르면
화면에는 `분석 결과를 읽지 못했어요`만 떠서 원인이 드러나지 않는다.
종료 공지가 뜨면 **코드가 아니라 환경변수를 바꾼다** (CLAUDE.md ⑭).

**캐시** — 리뷰와 같은 이유·같은 방식이다.
담당은 `analysis-cache.js`(`window.AnalysisCache`) 하나뿐이고, `save.js`가 직접 `sessionStorage`를 만지지 않는다.

**리뷰와 갈리는 점이 하나 있다 — 여기서는 실패를 캐시하지 않는다.**
리뷰의 `not_found`는 다시 물어도 답이 같은 **영구 실패**라 캐시할 값이 있었다.
분석에는 그런 상태가 없다. 타임아웃·한도 초과·키 없음·형식 오류는 전부 시간이 지나면 풀리므로,
캐시하면 고쳐도 탭을 새로 열기 전까지 고쳐지지 않은 것처럼 보인다.

---

## `.toast` — 담김 안내

- `hidden` 속성으로 토글한다. `display: none`을 CSS에서 강제하지 않는다 (JS가 `hidden`을 제어).
- 문구: `담았어요` / `담기를 해제했어요`
- **스타일은 `style.css`에 있다.** `save.html`과 `index.html`이 **같은 마크업을 그대로** 쓰므로
  한쪽 페이지의 CSS에 두면 다른 쪽에서 스타일 없는 흰 글자가 된다.
  `save.css`에 다시 선언하지 않는다 — 두 곳에 있으면 조용히 갈라진다.

---

## `.site-auth` — 오른쪽 위 로그인 영역 (`<body>` 직속, **맨 앞**)

두 페이지에 **똑같이** 들어간다. 마크업은 HTML에 비워두고 `auth.js`가 상태에 따라 채운다.

```html
<div class="site-auth" id="site-auth"></div>
```

`auth.js`가 그리는 모양이다. **①~③ 중 하나만 화면에 있고, 그 앞에 마이페이지 링크가 붙는다.**

```html
<!-- ⓪ 마이페이지 — ①·②와 **함께** 나온다. ③(모듈 실패)일 때는 나오지 않는다 -->
<a class="site-auth__mypage" href="mypage.html">마이페이지</a>

<!-- ① 로그아웃 상태 -->
<button type="button" class="site-auth__button" data-action="open-auth">로그인</button>

<!-- ② 로그인 상태 -->
<span class="site-auth__user">길동님</span>
<button type="button" class="site-auth__signout" data-action="sign-out">로그아웃</button>

<!-- ③ 인증 모듈을 못 불러온 상태 (CDN 차단 등) -->
<span class="site-auth__error">로그인 기능을 불러오지 못했어요</span>
```

**마이페이지 링크는 로그인 여부와 무관하게 나온다.** 비로그인으로 들어가도 그 페이지가
「로그인하면 담은 맛집을 볼 수 있어요」로 받아주므로, 숨기면 들어갈 길만 사라진다.
**단 마이페이지 자신에서는 빼둔다** — `auth.js`가 `<body data-page="mypage">`를 보고 판단한다.

**세션 복원이 끝나기 전에는 아무것도 그리지 않는다.** `localStorage`에서 세션을 되살리는 데
한 틱이 걸리는데, 그동안 `로그인`을 그려두면 **로그인한 사용자에게 로그인 버튼이 깜빡인다.**

`.site-auth__user`의 이름은 **이메일의 `@` 앞부분**이다. 가입 폼이 이메일·비밀번호만 받기 때문이다.

---

## `.auth-dialog` — 로그인 창 (`<body>` 직속, `.toast` 앞)

`.review-panel`과 **같은 이유로 `<dialog>`다** — `showModal()`이 포커스 가둠·Esc 닫기·배경
비활성을 브라우저에게서 공짜로 준다. 직접 만든 오버레이로 대체하지 않는다.

```html
<dialog class="auth-dialog" id="auth-dialog" aria-labelledby="auth-dialog-title">
  <div class="auth-dialog__inner">
    <header class="auth-dialog__head">
      <h2 class="h2 auth-dialog__title" id="auth-dialog-title">로그인</h2>
      <button type="button" class="auth-dialog__close" data-action="close-auth" aria-label="닫기">닫기</button>
    </header>

    <form class="auth-dialog__form" id="auth-form" novalidate>
      <div class="auth-dialog__field">
        <label class="auth-dialog__label" for="auth-email">이메일</label>
        <input class="auth-dialog__input" id="auth-email" type="email" name="email"
               autocomplete="email" placeholder="you@example.com">
      </div>
      <div class="auth-dialog__field">
        <label class="auth-dialog__label" for="auth-password">비밀번호</label>
        <input class="auth-dialog__input" id="auth-password" type="password" name="password"
               autocomplete="current-password" placeholder="6자 이상">
      </div>

      <p class="auth-dialog__status" id="auth-status" role="status" aria-live="polite"></p>

      <div class="auth-dialog__actions">
        <button type="submit" class="auth-dialog__submit">로그인</button>
        <button type="button" class="auth-dialog__signup" data-action="sign-up">회원가입</button>
      </div>
    </form>
  </div>
</dialog>
```

`.auth-dialog__status`는 `.search__status`와 같은 규칙이다 — 상태 modifier로 색만 바꾼다.

| 클래스 | 쓰임 |
|---|---|
| `.auth-dialog__status--error` | 실패 안내. `--color-error` |
| `.auth-dialog__status--info` | 메일 확인 안내 등. `--color-ink-700` |
| `.auth-dialog__status--loading` | 처리 중. 버튼도 함께 `disabled` |

**`novalidate`를 지운다면 안내 문구가 브라우저 기본 말풍선에 가려진다.**
이메일·비밀번호 검사를 우리가 직접 해서 `~해요`체로 보여주려는 것이다 (DESIGN 7장).

---

## 안내 문구 — Supabase 오류를 한국어로 옮기는 표

**`error.code`로 가른다. `message`는 영어이고 버전에 따라 문구가 바뀐다.**
아래 코드는 실제 프로젝트에 요청을 태워 받아낸 값이다.

| `error.code` | HTTP | 화면 문구 |
|---|---|---|
| `invalid_credentials` | 400 | `이메일 또는 비밀번호가 맞지 않아요` |
| `user_already_exists` · `email_exists` | 422 | `이미 가입된 이메일이에요. 로그인해주세요` |
| `weak_password` | 422 | `비밀번호는 6자 이상이어야 해요` |
| `validation_failed` | 400 | `이메일 형식이 올바르지 않아요` |
| `email_not_confirmed` | 400 | `메일함에서 인증을 먼저 완료해주세요` |
| `over_email_send_rate_limit` · `over_request_rate_limit` | 429 | `요청이 많아요. 잠시 뒤에 다시 해주세요` |
| 그 밖 | — | `로그인에 실패했어요. 잠시 뒤에 다시 해주세요` |

**`invalid_credentials`를 「가입되지 않은 이메일이에요」로 옮기지 않는다.**
Supabase는 비밀번호 오류와 미가입 계정에 **같은 코드를 돌려준다** — 어느 이메일이 가입돼
있는지 알아내지 못하게 하려는 의도적 설계다. 둘을 나눠 안내하면 그 방어가 무너진다.

---

## `window.Auth` — 로그인 상태를 다른 기능이 가져다 쓰는 창구

담당은 `auth.js` 하나뿐이다. **다른 파일이 `window.supabase`를 직접 만지지 않는다** —
`saved-places.js`·`review-cache.js`와 같은 규칙이다.
DB에 접근해야 하는 `saved-places.js`도 새 전역을 만들지 않고 `Auth.client()`로 받아간다.

| 이름 | 반환 | 설명 |
|---|---|---|
| `Auth.ready` | `Promise<void>` | 최초 세션 복원이 끝나면 resolve. **실패해도 resolve된다** |
| `Auth.isReady()` | `boolean` | 복원이 끝났는지 |
| `Auth.isAvailable()` | `boolean` | 인증 모듈을 불러왔는지. CDN이 막히면 `false` |
| `Auth.getUser()` | `{id,email,name}` \| `null` | **동기.** 복원 전에는 항상 `null` |
| `Auth.isSignedIn()` | `boolean` | 동기 |
| `Auth.onChange(fn)` | `() => void` | 구독. **등록 즉시 현재 상태로 한 번 호출된다.** 반환값은 해제 함수 |
| `Auth.requireSignIn(reason)` | `boolean` | 로그인돼 있으면 `true`. 아니면 창을 띄우고 `false` |
| `Auth.open(reason)` / `Auth.close()` | — | 창 열고 닫기 |
| `Auth.signOut()` | `Promise<void>` | |
| `Auth.client()` | supabase client \| `null` | **데이터 접근 창구.** `saved-places.js`가 쓴다. CDN이 막히면 `null`이라 **쓰는 쪽이 반드시 확인한다** |

**로그인 여부에 따라 달라지는 UI는 `getUser()`를 직접 읽지 말고 `onChange`로 그린다.**
`getUser()`는 복원 전에 `null`이라, 페이지 로드 직후에 읽으면 **로그인한 사용자를 비로그인으로 본다.**
`onChange`는 등록 즉시 한 번 호출되고 복원이 끝나면 다시 호출되므로 두 시점이 모두 덮인다.

```js
// 이렇게 쓴다
window.Auth.onChange(function (user) { render(user); });

// 이렇게 쓰지 않는다 — 새로고침 직후 항상 비로그인으로 보인다
if (window.Auth.isSignedIn()) { … }
```

---

## `.saved__locked` — 로그인해야 담을 수 있다는 안내

담기는 **로그인한 사람만** 쓴다. 검색·리뷰·분석은 로그인 없이 그대로 쓴다.

```html
<p class="saved__locked">로그인하면 마음에 든 곳을 담아둘 수 있어요</p>
```

`.saved-list`를 **지우지 않고** 이 문단을 위에 둔다.
비로그인일 때 목록은 어차피 비어 있다 — 저장이 `saved_places` 테이블 + RLS로 계정에
묶여 있어, 로그인해야 내 것이 돌아오기 때문이다.

---

## `window.SavedPlaces` — 담아둔 곳 저장소 (`saved-places.js`)

저장소는 Supabase `saved_places` 테이블 **하나뿐이다.** `localStorage`를 쓰던
`storage.js`는 지웠다 — 두 저장소가 섞이면 어느 쪽이 진실인지 알 수 없다.

**화면은 동기, 저장은 비동기다.** `renderResults()`는 카드를 그리는 도중에 담김 여부를
물어보므로 거기서 기다릴 수 없다. 그래서 로그인하면 내 목록을 한 번 받아 메모리 색인에
넣어두고, 조회는 그 색인만 본다.

| 이름 | 반환 | 설명 |
|---|---|---|
| `SavedPlaces.ready` | `Promise<void>` | 첫 응답이 끝나면 resolve. **실패해도 resolve된다** |
| `SavedPlaces.isLoaded()` | `boolean` | 서버 응답을 받아봤는지. 「비어 있음」과 「아직 모름」을 가른다 |
| `SavedPlaces.error()` | `error` \| `null` | 마지막 읽기 실패 |
| `SavedPlaces.list()` | `Item[]` | **동기.** 최신순 |
| `SavedPlaces.has(placeId)` | `boolean` | **동기.** 메모리 색인 |
| `SavedPlaces.get(placeId)` | `Item` \| `null` | **동기** |
| `SavedPlaces.count()` | `number` | **동기** |
| `SavedPlaces.add(place)` | `Promise<{ok, already?, reason?}>` | 카카오 원본 필드명으로 넘긴다 |
| `SavedPlaces.remove(placeId)` | `Promise<{ok, reason?}>` | |
| `SavedPlaces.refresh()` | `Promise<void>` | 서버에서 다시 읽는다 |
| `SavedPlaces.isVisited(placeId)` | `boolean` | **동기.** `visitedAt`이 있는지 |
| `SavedPlaces.toVisit()` | `Item[]` | **동기.** 안 가본 곳 — 담은 순 |
| `SavedPlaces.visited()` | `Item[]` | **동기.** 다녀온 곳 — **다녀온 순** |
| `SavedPlaces.saveVisit(placeId, {wouldReturn, note})` | `Promise<{ok, reason?}>` | 방문 기록. `wouldReturn`만 필수 |
| `SavedPlaces.onChange(fn)` | `() => void` | 구독. **등록 즉시 한 번 호출된다.** 반환값은 해제 함수 |

`add()`에 넘기는 것과 `list()`가 돌려주는 것의 **이름이 다르다.** 앞은 카카오 검색 결과
그대로이고, 뒤는 화면용으로 정규화한 모양이다.

```js
// add() — /api/search가 준 place 객체의 필드명 그대로
{ id, place_name, category_name, road_address_name, x, y, place_url }

// list()·get() — 정규화된 Item
{ rowId, id, name, category, address, x, y, url, savedAt,
  visitedAt, note, wouldReturn }
//  ↑행 uuid  ↑카카오 place id            ↑ms
```

**`visitedAt`은 `null` 아니면 ms다. 0으로 접지 않는다** — 0은 1970년이라 「다녀왔다」로 읽힌다.
**`wouldReturn`은 `true`·`false`·`null` 셋이다.** `Boolean()`으로 감싸면 `null`(아직 답 안 함)과
`false`(글쎄요)가 같아져 **「글쎄요」라고 답한 데이터가 사라진다.**

**좌표는 문자열 그대로 둔다.** ⑬에 따라 `x`가 경도, `y`가 위도이고,
`Number("")`는 `NaN`이 아니라 `0`이라 여기서 숫자로 바꾸면 좌표 없는 항목이
조용히 기니만 앞바다를 가리킨다.

### 읽을 때 `user_id`로 거르지 않는다

```js
.from('saved_places').select(...).order('created_at', { ascending: false })   // 이렇게
.from('saved_places').select(...).eq('user_id', user.id)                      // 이렇게 말고
```

조건 없이 전체를 요청하면 RLS가 내 것만 돌려준다. 거르는 일은 창고(서버) 담당이다.
프론트에서 한 번 더 거르면 **방어선이 프론트에 있는 것처럼 보여**, 나중에 그 줄을
지웠을 때 뚫린 것을 눈치채지 못한다.

같은 이유로 **`user_id`를 코드에서 만들어 넣지 않는다.** 컬럼 기본값 `auth.uid()`가 채운다.

### 화면을 고치는 곳은 한 군데다

`add()`·`remove()`가 성공하면 저장소가 `onChange`로 알린다. 부르는 쪽은 **직접 DOM을
건드리지 않는다.** 낙관적으로 먼저 칠해두면 저장되지 않은 것이 담긴 것처럼 보이고,
그 거짓말은 새로고침해야 드러난다.

---

### `saveVisit()` — 방문 기록

담아둔 행을 **고친다.** 새 행을 만들지 않는다 — 방문 기록은 담아둔 곳의 속성이지 별개의 사건이 아니다.

| 규칙 | 이유 |
|---|---|
| `wouldReturn`만 필수 | 재방문율이 이 서비스가 쌓으려는 데이터다 |
| `note`가 비면 `null`로 넣는다 | 「안 썼다」와 「빈 줄을 썼다」를 DB에서 구별할 이유가 없다 |
| `visited_at`은 **처음 기록할 때만** 넣는다 | 「기록 수정」에서 다시 넣으면 지난달에 간 곳이 오늘 간 것으로 덮인다 |

> **돌려받은 행이 0건이면 실패로 처리한다.**
> RLS에 `update` 정책이 없으면 고칠 대상이 0건으로 보여 PostgREST가 **`200 OK` + 빈 배열**을
> 돌려준다 — 거절이 아니라 「0건 고쳤다」다. `error`만 보면 성공으로 읽혀서, 화면에는
> `기록을 남겼어요`가 뜨고 새로고침하면 기록이 사라져 있다. **에러가 아니라 그럴듯한 실패다.**
> `saveVisit()`이 이때 `reason: 'not_updated'`를 돌려준다.

---

## `.mypage-group` — 가볼 곳 / 가본 곳

**탭이 아니라 구분 제목이다.** 탭은 한 번에 한쪽만 보여주는데, 담아둔 곳이 몇 개 안 되는
초반에는 양쪽을 한눈에 보는 편이 「오늘 어디 가지」를 결정하는 데 낫다.

```html
<section class="mypage-group" id="group-to-visit" hidden>
  <h2 class="h2 mypage-group__title">가볼 곳 <span class="mypage-group__count">0</span></h2>
  <ul class="mypage-list plain-list" id="list-to-visit"></ul>
</section>
```

- **가르는 기준은 `visitedAt`이 비어 있는지 하나뿐이다.** `note`나 `wouldReturn`은 보지 않는다 —
  한 줄 기록은 선택이라 비어 있는 것이 정상이고, 기준에 넣으면 기록 없이 다녀온 곳이
  영영 「가볼 곳」에 남는다
- **「가볼 곳」이 위다.** 이 서비스는 결정을 돕는 서비스이고, 오늘 어디 갈지 고르는 사람에게
  먼저 보여야 하는 것은 아직 안 가본 곳이다
- **빈 그룹은 `hidden`으로 섹션째 감춘다.** 「가본 곳 0」이 서 있으면 아직 안 간 것을 채근하는 화면이 된다
- 정렬이 다르다 — 가볼 곳은 **담은 순**, 가본 곳은 **다녀온 순**.
  작년에 담아둔 곳을 오늘 다녀왔다면, 담은 순으로는 맨 아래에 남아
  **방금 남긴 기록이 화면에서 사라진 것처럼 보인다**

---

## `.visit-dialog` — 방문 기록 입력창 (`<body>` 직속)

`<dialog>`인 이유는 `.review-panel`·`.auth-dialog`와 같다 — `showModal()`이 포커스 가둠·
Esc 닫기·배경 비활성을 브라우저에게서 공짜로 준다. 직접 만든 오버레이로 대체하지 않는다.

**처음 기록할 때와 고칠 때가 같은 창이다.** 다른 것은 제목과 들어와 있는 값뿐이라 창을 둘로 만들지 않는다.

| | 처음 | 고칠 때 |
|---|---|---|
| 제목 | `다녀왔어요` | `기록 수정` |
| 또 올까 | 아무것도 안 골라짐 | 기존 답이 골라져 있음 |
| 한 줄 기록 | 빈칸 | 기존 기록 |
| 첫 포커스 | 「또 올래요」 버튼 | 한 줄 기록 칸 |

```html
<button type="button" class="visit-choice" data-return="yes" aria-pressed="false">
  <span class="visit-choice__face" aria-hidden="true">&#128522;</span>
  <span class="visit-choice__text">또 올래요</span>
</button>
```

- **「또 올까」만 필수다.** 한 줄 기록은 비워도 저장된다 — `required`를 붙이지 않는다.
  답 없이 저장하면 `또 올지 먼저 골라주세요`로 막고 창은 열어둔다
- 두 칸을 **같은 폭**으로 둔다. 한쪽이 넓으면 그쪽이 권장 답으로 읽혀 재방문율 데이터가 기운다
- 선택 상태는 `.is-selected` + `aria-pressed`. 색만으로 구분하지 않고 **면(tint)이 함께 바뀐다**
- `radio`가 아니라 `button`인 이유 — 큰 터치 영역이 필요하고, `aria-pressed`로 알리면
  기본 라디오 모양을 지우는 CSS가 필요 없다
- 저장에 **실패하면 창을 닫지 않는다.** 닫으면 쓴 내용이 사라지고, 다시 쓰라는 말도 못 한다

> **이모지 예외가 하나 늘었다.** `.analysis__face`(😀😐😠)에 이어 `.visit-choice__face`(😊🤔)와
> `.mypage-card__verdict-face`가 예외다. 「또 올까」는 감정에 대한 질문이라 얼굴이 가장 짧은 표현이고,
> **글자(`또 올래요`/`글쎄요`)가 항상 함께 있어** 이모지가 빠져도 뜻이 전달된다.
> 얼굴에는 `aria-hidden`을 달아 낭독기가 글자만 읽게 한다.

---

## `.mypage-card` — 담아둔 맛집 카드 (`.mypage-list` 안, `<li>`)

```html
<li class="mypage-card" data-kakao-id="{id}">
  <div class="mypage-card__body">
    <h3 class="h2 mypage-card__name">{name}</h3>
    <p class="body mypage-card__address">{address}</p>
    <!-- 가볼 곳은 「…에 담았어요」, 가본 곳은 「…에 다녀왔어요」 -->
    <p class="caption mypage-card__date">{YYYY}년 {M}월 {D}일에 담았어요</p>

    <!-- 가본 곳에만 -->
    <div class="mypage-card__record">
      <p class="mypage-card__verdict is-yes">
        <span class="mypage-card__verdict-face">&#128522;</span>
        <span class="mypage-card__verdict-text">또 올래요</span>
      </p>
      <p class="body mypage-card__note">{note}</p>
    </div>

    <div class="mypage-card__actions">
      <a class="mypage-card__link" href="{url}" target="_blank" rel="noopener noreferrer"
         aria-label="{name} 카카오맵에서 보기">카카오맵 보기</a>
      <!-- 가볼 곳 → .mypage-card__visit 「다녀왔어요」 -->
      <!-- 가본 곳 → .mypage-card__edit  「기록 수정」  -->
      <button type="button" class="mypage-card__visit" data-action="visit"
              aria-label="{name} 다녀왔다고 기록하기">다녀왔어요</button>
    </div>
  </div>
  <button type="button" class="mypage-card__remove" data-action="remove"
          aria-label="{name} 목록에서 지우기">&times;</button>
</li>
```

**두 그룹이 같은 카드를 쓴다.** 다른 것은 날짜 문구·기록 블록·액션 버튼 셋뿐이라
카드를 둘로 나누지 않는다 — 나누면 이름·주소·카카오맵·삭제를 한쪽만 고치는 실수가 생긴다.

`.mypage-card__record`는 **가본 곳에만** 붙는다. 그 안에서도 둘 다 없으면 없는 대로 둔다 —
`.mypage-card__note`는 **선택이라 없는 것이 정상이고**, 「기록 없음」 같은 문구로 빈자리를
채우지 않는다. 안 쓴 것을 나무라는 화면이 된다.

`.mypage-card__address`와 `.mypage-card__link`는 **값이 없으면 요소째 뺀다.**
주소가 없는 가게가 있어 빈 문단이 남으면 카드 높이만 들쭉날쭉해진다.

**날짜 문구는 우리가 만든다.** `toLocaleDateString('ko-KR')`은 브라우저·OS 로케일에 따라
`2026. 8. 23.`이 되기도 `8/23/2026`이 되기도 한다 — 화면에 나갈 문구는 우리가 정한다(DESIGN 7장).

`×`는 글꼴의 문자이지 이모지가 아니라 「이모지를 UI 요소로 쓰지 않는다」에 걸리지 않는다.
다만 낭독기에는 아무 뜻이 없으므로 `aria-label`을 **반드시** 붙인다.

`.is-busy`는 지우는 동안 카드에 붙는다. 되돌리는 상태가 아니라 **성공하면 카드가 사라지므로**,
실패했을 때만 떼어낸다.

---

## `.mypage__notice` — 비로그인 · 비어 있음 안내

**두 상태가 같은 상자를 쓴다.** 둘 다 「문구 한 줄 + 버튼 하나」다.

```html
<div class="mypage__notice-box">
  <p class="body-l mypage__notice-text">{message}</p>
  <div class="action mypage__notice-action">
    <button type="button" class="btn-primary">{actionText}</button>
  </div>
</div>
```

| 상태 | 문구 | 버튼 | 누르면 |
|---|---|---|---|
| 비로그인 | `로그인하면 담은 맛집을 볼 수 있어요` | `로그인` | `Auth.open()` |
| 비어 있음 | `아직 담은 맛집이 없어요` | `맛집 검색하러 가기` | `save.html`로 이동 |

**화면이 가질 수 있는 상태는 넷이고 한 번에 하나만 그린다** — 비로그인 · 불러오는 중 ·
읽기 실패 · (목록 또는 비어 있음). 섞이면 「로그인하세요」와 카드 목록이 함께 보인다.

불러오는 중과 읽기 실패는 상자가 아니라 `.mypage__status` 한 줄로 알린다.

> **`isLoaded()`를 보지 않으면 「불러오는 중」이 「비어 있음」으로 보인다.**
> 목록이 도착하기 전에도 `list()`는 빈 배열이라, 담아둔 것이 있는 사용자에게
> 잠깐 `아직 담은 맛집이 없어요`가 스친다. ⑰과 같은 계열의 함정이다.

---

## 랜딩페이지의 추천 두 코너 — `index.html`

`save.html`·`mypage.html`과 달리 **한 파일 안에 코너가 둘**이고,
목록의 생김새는 **같다.** 그래서 클래스도 코너 이름이 아니라 부품 이름으로 붙인다
(`.popular-…`/`.for-you-…`가 아니라 `.pick-…`).

```html
<head>
  <link rel="stylesheet" href="style.css">
  <link rel="stylesheet" href="home.css">   <!-- style.css 다음이어야 한다 -->
</head>

<!-- ⑤ 나를 위한 추천 — 로그인한 사람에게만 보인다 -->
<section id="for-you" class="section section--alt" hidden>
  <div class="container container--wide">
    <h2 class="h1 section__title">담아두신 곳을 보니,<br>여기도 어울려요</h2>
    <p class="body pick-reason" id="for-you-reason" hidden>{카테고리}을 가장 많이 담으셨어요</p>
    <ul class="plain-list pick-list" id="for-you-list"></ul>
    <p class="pick-status" id="for-you-status" role="status" aria-live="polite"></p>
  </div>
</section>

<!-- ⑥ 지금 인기 — 로그인과 무관하다 -->
<section id="popular" class="section section--bg">
  <div class="container container--wide">
    <h2 class="h1 section__title">요즘 사람들이<br>가장 많이 담은 곳</h2>
    <ol class="plain-list pick-list" id="popular-list"></ol>
    <p class="pick-status" id="popular-status" role="status" aria-live="polite"></p>
  </div>
</section>
```

**`#for-you`는 `hidden`으로 시작한다.** 세션 복원이 끝나기 전에는 로그인 여부를
알 수 없으므로 미리 펴두면 비로그인 방문자에게 잠깐 나타났다 접히는 것이 보인다
(`.site-auth`가 로그인 버튼을 미리 그리지 않는 것과 같은 이유 — CLAUDE.md ⑰).

**인기 목록은 `<ol>`, 추천 목록은 `<ul>`이다.** 순위가 있는 쪽만 순서 있는 목록이다 —
낭독기가 「목록 5개 중 1번째」를 읽어주는 것이 순위와 겹치지 않게, 순위 숫자는
화면용 `<span>`으로 따로 둔다.

---

## `.pick-card` — 추천 카드 (`.pick-list` 안, `<li>`)

**두 코너가 같은 카드를 쓴다.** 다른 것은 `__rank`와 `__count`의 **유무뿐이다.**

```html
<li class="pick-card" data-place-id="{id}">
  <span class="pick-card__rank">1</span>                    <!-- 인기 목록에만 -->
  <div class="pick-card__body">
    <p class="caption pick-card__category">{category_name 마지막 마디}</p>
    <h3 class="h2 pick-card__name">{place_name}</h3>
    <p class="caption pick-card__address">{road_address_name}</p>
  </div>
  <div class="pick-card__side">
    <span class="caption pick-card__count">{n}명이 담았어요</span>   <!-- 인기 목록에만 -->
    <button type="button" class="pick-card__save" data-action="save">담기</button>
  </div>
</li>
```

**카드 전체는 클릭 영역이 아니다.** `.place-card`와 다른 점이다 —
랜딩페이지에는 리뷰 패널이 없으므로 카드를 눌러서 열 곳이 없다.

**상세 보기 링크를 두지 않는다.** `.place-card`와 같은 규칙이다 —
액션 줄은 `담기` 하나(인기 목록은 담긴 수 + 담기)뿐이다.

**상태**

| 클래스 | 의미 | 버튼 라벨 |
|---|---|---|
| `.pick-card__save` | 아직 안 담음 | `담기` |
| `.pick-card__save.is-saved` | 이미 담음 | `담았어요` |

- `.place-card__save`와 **같은 모양이어야 한다.** 한쪽을 고치면 다른 쪽도 함께 고친다 —
  같은 일을 하는 버튼이 페이지마다 다르게 보이면 그것부터 버그로 읽힌다.
- 비로그인 상태에서 누르면 저장하지 않고 **로그인 창을 띄운다**
  (`Auth.requireSignIn('로그인하면 담아둘 수 있어요')`).
- 왕복하는 동안 `disabled`로 잠근다. 잠그지 않으면 연타가 insert와 delete를 엇갈리게 보낸다.
- **담긴 뒤에도 카드는 사라지지 않는다.** 「이미 담은 곳을 뺀다」는 목록을 **만들 때**
  지키는 약속이다. 누르는 즉시 사라지면 방금 담은 것이 취소된 것처럼 보인다.

---

## `.pick-status` · `.pick-reason` — 안내 문구

`.search__status`와 같은 규칙이다. 평상시에는 클래스가 `.pick-status` 하나뿐이라
**자리를 차지하지 않고**, 상태 클래스가 붙을 때만 나타난다.

| 클래스 | 언제 |
|---|---|
| `.pick-status--loading` | 인기 목록을 세는 중 · 담아둔 곳을 보는 중 · 어울리는 곳을 찾는 중 |
| `.pick-status--empty` | 아직 담긴 곳이 없음 · 내가 담은 곳이 없음 · 추천할 새 곳이 없음 |
| `.pick-status--error` | 인기 목록 실패 · 담아둔 곳 읽기 실패 · 추천 검색 실패 |

**문구 표**

| 코너 | 상황 | 문구 |
|---|---|---|
| 인기 | 부르는 중 | `인기 맛집을 세는 중이에요` |
| 인기 | 0건 | `아직 담긴 곳이 없어요` |
| 인기 | 실패 | `인기 목록을 불러오지 못했어요` |
| 추천 | 목록 오는 중 | `담아둔 곳을 보는 중이에요` |
| 추천 | 목록 실패 | `담아둔 곳을 불러오지 못했어요` |
| 추천 | 담은 것 0건 | `맛집을 몇 곳 담으면 취향에 맞는 곳을 찾아드려요` |
| 추천 | 카테고리를 알 수 없음 | `한 곳만 더 담으면 취향을 찾아드릴게요` |
| 추천 | 검색 중 | `어울리는 곳을 찾는 중이에요` |
| 추천 | 검색 실패 | `추천을 불러오지 못했어요` |
| 추천 | 새 곳 0건 | `추천할 만한 새 곳을 찾지 못했어요` |

`.pick-reason`은 왜 이 목록이 나왔는지 말해주는 한 줄이다 — `한식을 가장 많이 담으셨어요`.
**목적격 조사를 받침에 맞춰 고른다.** `한식을` / `카페를` —
`한식을(를)`처럼 괄호로 미루지 않는다 (DESIGN 7장).
채울 것이 없으면 `hidden`을 붙여 접는다.

**`AI 추천`이라고 쓰지 않는다** (PRD 4장 · DESIGN 7장 · CLAUDE.md ③).
이 추천은 담은 카테고리를 세는 **규칙 기반**이다. 지금 못 지키는 약속을 카피에 넣지 않는다.

---

## `window.PopularPlaces` — 인기 랭킹 창구 (`popular-places.js`)

`SavedPlaces`가 **내 것**을 다루는 창구라면, 여기는 **모두의 집계**를 다루는 창구다.
읽는 경로부터 다르다 — 저쪽은 테이블을 직접 `select`하고(RLS가 걸러준다),
이쪽은 `popular_places()` 함수를 `rpc`로 부른다.

| 이름 | 반환 | 설명 |
|---|---|---|
| `PopularPlaces.top(n)` | `Promise<{ok, items?, reason?}>` | 담긴 수 상위 n곳. n은 1~20으로 접힌다 |
| `PopularPlaces.reset()` | `void` | 다음 `top()`이 서버를 다시 타게 한다 |

```js
// items[] — SavedPlaces.list()와 **같은 키 이름**을 쓴다.
// home.js가 두 목록을 같은 함수로 그리기 때문이다.
{ rank, id, name, category, address, x, y, url, count }
```

- **실패는 예외가 아니라 `{ ok: false }` 봉투로 온다** (`/api/search`와 같은 결).
- **성공만 들고 있는다.** 실패를 캐시하면 연결이 돌아와도 새로고침 전까지
  계속 실패한 것처럼 보인다 (`ReviewCache`가 서버 오류를 캐시하지 않는 것과 같은 이유).
- **`auth.js`가 클라이언트를 만들 때까지 안에서 기다린다.** 부르는 쪽이 시점을
  알아야 하는 구조를 만들지 않는다 — 자세한 것은 CLAUDE.md ㉔.

---

## `popular_places()` — 대신 세어주는 DB 함수

`saved_places`의 `select` 정책은 `auth.uid() = user_id`라, 브라우저에서 무엇을
물어봐도 **내 것만** 돌아온다. 그래서 「모두가 담은 수」는 클라이언트가 셀 수 없다.

**RLS를 끄는 것은 답이 아니다.** 대신 **세는 일만** 하는 함수를 두고 그것만 부른다.

```
popular_places(limit_count integer default 5)
  → rank, place_id, place_name, category_name,
    road_address_name, x, y, place_url, save_count
```

- **`user_id`가 반환 타입에 없다.** 실수로 흘릴 통로 자체를 만들지 않는다.
- `save_count`는 `count(distinct user_id)` — 몇 **명**이 담았는가다.
- `anon`·`authenticated` 둘 다 부를 수 있다. 인기 코너는 비로그인 방문자가 먼저 본다.
- DDL은 `supabase-popular-places.sql`. 자세한 것은 CLAUDE.md ㉓.

---

## 지켜야 할 공통 사항

**카피 (CLAUDE.md ③ · DESIGN 7장)**
`AI 추천` 및 준하는 표현 금지 · 느낌표 금지 · `최고의`·`완벽한`·`혁신적인` 금지 ·
`~해요` 중심 존댓말 · 이모지를 UI 요소로 쓰지 않음

> **「AI 리뷰 분석」은 `AI 추천` 금지에 걸리지 않는다.** 그 조항의 취지는
> 「지금 못 지키는 약속을 카피에 넣지 않는다」였고, Phase 0의 추천이 규칙 기반 필터링이라
> AI라고 부를 수 없었기 때문이다. 이쪽은 **실제로 Gemini가 하는 일**이라 정확한 이름이다.
> 다만 AI가 쓴 총평 문장이 화면에 그대로 올라가므로, **위 카피 규칙을 시스템 프롬프트 안에**
> 심어둔다. 프롬프트에 넣지 않으면 총평 한 줄만 톤이 어긋난다.

> **이모지 금지의 유일한 예외는 `.analysis__face`(😀😐😠)다.**
> 감정 3분류를 색·텍스트와 **함께** 얼굴로도 보여주려고 사용자가 명시적으로 요청한 것이다.
> `aria-hidden="true"`로 두어 의미는 옆의 텍스트 라벨(`긍정`/`보통`/`부정`)이 진다 —
> 「상태를 색만으로 구분하지 않는다」는 그대로 지켜진다.
> **별점의 `★`은 여전히 활자 문자(U+2605)다.** 이 예외를 별점으로 넓히지 않는다.

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
