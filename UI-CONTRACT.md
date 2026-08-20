# UI-CONTRACT.md — 맛집 담기 페이지 클래스 계약

> **작성** 팀 리드 · 2026-08-20
> **개정** 2026-08-20 — `<head>` 계약 추가 · `<body>` 컨테이너 조합 확정 (공백 2건 메움)
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
    <a class="place-card__link" href="{place_url}" target="_blank" rel="noopener noreferrer">상세 보기</a>
    <button type="button" class="place-card__save" data-action="save">담기</button>
  </div>
</li>
```

**상태**
| 클래스 | 의미 | 버튼 라벨 |
|---|---|---|
| `.place-card__save` | 아직 안 담음 | `담기` |
| `.place-card__save.is-saved` | 이미 담음 | `담았어요` |

- `.is-saved`일 때 버튼은 **비활성이 아니라** 담기 해제로 동작한다 (`aria-pressed` 사용).
- 카드 자체에는 상태 클래스를 걸지 않는다. 상태는 버튼에만 붙는다.

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

`server.py`와 `save.js` 사이의 인터페이스다. **모든 실패를 한 봉투로 정규화한다.**
프론트는 HTTP 상태 코드를 보지 않고 `ok`만 확인하므로 예외 분기가 하나로 끝난다.

```jsonc
// 성공
{ "ok": true,  "places": [ { id, place_name, category_name,
                             road_address_name, address_name, distance, place_url } ] }
// 실패 — 상태 코드와 무관하게 언제나 같은 모양
{ "ok": false, "error": { "code": "empty_query", "message": "검색어를 입력해 주세요" } }
```

- `message`는 **`~해요`체 한국어**다. 프론트가 `.search__status--error`에 **그대로** 노출한다.
  서버가 사용자 문구의 주인이므로, 여기에 영문 예외 메시지나 스택을 넣지 않는다.
- 필드는 위 7개만 내려보낸다. `phone`·`x`·`y` 등 카카오 원본을 그대로 흘리지 않는다.
- 상태 코드는 정직하게 붙이되(키 없음 `503` / 빈 검색어 `400` / 업스트림 `502`·`504`) **프론트의 분기 근거로 쓰지 않는다.**

**`distance`에 대한 현재 상태** — `server.py`는 좌표(`x`/`y`)를 받으면 카카오가 준 `distance`를 그대로 내려보낸다.
다만 `save.js`가 아직 좌표를 보내지 않으므로 **`.place-card__distance`는 실제로 렌더된 적이 없다.**
위치 권한을 붙일지는 미정이다. 그때까지 이 요소는 계약에만 있고 화면에는 없다.

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
