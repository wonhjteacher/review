# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트

**오늘은 여기** — 담아둔 맛집 중에서 오늘 갈 한 곳을 골라주는 서비스의 랜딩페이지.
핵심 가치는 검색이 아니라 **결정**이다.
현재 Phase 0(랜딩페이지 + 체험 데모)과 Phase 1의 맛집 담기(F1)가 구현되어 있다.

## 명령어

빌드 도구, 패키지 매니저, 테스트 러너가 **없다.** 정적 파일과 표준 라이브러리 서버가 전부다.

```bash
python3 server.py                # 로컬 실행 → localhost:8000
PORT=8080 python3 server.py      # 포트 변경
```

`server.py`가 `python3 -m http.server`를 **대체한다.** 정적 파일을 그대로 서빙하면서
`/api/search` 한 경로만 가로채 카카오 로컬 API로 중계한다. 표준 라이브러리만 쓴다 — `pip install` 금지.

**랜딩페이지(`index.html`)만 볼 때는 여전히 `file://`로 열어도 된다.**
담기 페이지(`save.html`)는 `fetch('/api/search')`·`fetch('/api/reviews')`를 쓰므로 반드시 서버로 띄워야 한다.

`gh` CLI는 Homebrew가 아니라 `~/.local/bin/gh`에 직접 설치되어 있다.

### 배포 (Vercel)

API 경로의 구현이 **둘씩이다.** 로컬은 `server.py`, 배포는 `api/*.js`.

```
server.py        로컬 개발 — 정적 서빙 + 프록시 둘 다. 파이썬 표준 라이브러리만
api/search.js    배포 — 카카오 검색.  Vercel 서버리스 함수. 의존성 없음(전역 fetch), CommonJS
api/reviews.js   배포 — 구글 리뷰.    같음
```

**짝지어진 둘은 같은 계약을 지켜야 한다** — 사양은 `UI-CONTRACT.md`의
「/api/search 응답 봉투」와 「/api/reviews 응답 봉투」다.
한쪽만 고치면 로컬에서는 되는데 배포에서 깨진다. 고쳤으면 아래로 대조한다:

```bash
# server.py를 띄워두고, 같은 쿼리를 두 구현에 태워 JSON을 비교한다
python3 server.py &
node -e '…' # 두 응답의 JSON.stringify를 직접 비교 — 바이트 단위로 같아야 한다
```

`.vercelignore`가 `server.py`를 배포에서 뺀다. 빼지 않으면 Vercel이 정적 파일로 취급해 **소스를 그대로 내려준다.**

**Vercel 환경변수에 `KAKAO_REST_API_KEY`와 `GOOGLE_PLACES_KEY`를 등록해야 한다.**
`.env`는 배포에 올라가지 않는다. 로컬에서 리뷰를 보려면 `.env`에도 `GOOGLE_PLACES_KEY`가 있어야 한다.
한쪽 키가 없으면 그 경로만 `503`을 돌려주고 나머지는 정상 동작한다.

## 문서가 사양이다

`PRD.md`와 `DESIGN.md`는 참고 문서가 아니라 **확정된 사양서**다. 코드를 고치기 전에 해당 장을 먼저 읽는다.

**충돌 시 우선순위** (DESIGN.md 서문에 명시):

- 기능·범위 결정 → **PRD.md**가 우선
- 시각·카피 톤 결정 → **DESIGN.md**가 우선

예: 서브카피의 *내용*은 PRD 5장을 따르되 *어미*는 DESIGN 7장의 `~해요`체를 따른다.

## 아키텍처

```
Phase 0 — 랜딩페이지
index.html   섹션 7개 마크업. 데모 영역(#demo-stage)만 비어 있고 JS가 채운다
style.css    DESIGN.md의 토큰·스케일·컴포넌트 수치를 그대로 옮긴 것. 두 페이지가 공유한다
app.js       PLACES 데이터 + pickPlace() + 데모 상태 관리

Phase 1 — 맛집 담기
server.py    정적 서버 + /api/search 카카오 프록시. 표준 라이브러리만
save.html    담기 페이지 마크업. 클래스 이름은 UI-CONTRACT.md에 고정되어 있다
save.css     담기 페이지 전용 스타일. style.css 다음에 로드된다
save.js      검색·렌더·담기 상태 관리 + 구글 리뷰 패널
storage.js   localStorage 래퍼(담아둔 곳). 막힌 환경에서는 메모리로 폴백한다

Phase 1 — 구글 리뷰
api/reviews.js   배포 — 구글 Places API (New) 프록시. server.py의 handle_reviews()와 같은 계약
review-cache.js  sessionStorage 래퍼(조회한 리뷰). 무료 한도를 지키는 장치다
.env         API 키. gitignore 대상 — 절대 커밋하지 않는다
```

`save.html`·`save.js`·`storage.js`·`save.css`의 클래스 이름은 **`UI-CONTRACT.md`가 사양이다.**
마크업과 스타일을 따로 작업할 수 있게 이름을 미리 동결해둔 문서다. 이름을 바꾸려면 계약서를 먼저 고친다.

`app.js`는 클래식 스크립트다(모듈 아님). 최상위 `const` 선언은 `window` 속성이 **되지 않으므로** 다른 프레임에서 `iframe.contentWindow.state`로 접근할 수 없다. 해당 프레임 안에서 평가해야 한다.

### 데모 흐름

`state.step` 0~2는 질문, 3은 결과. 선택 → 250ms(선택 상태 노출) → 150ms(fade-out) → 다음 화면. 전환 총 400ms.

### `pickPlace(answers, lastName)` — 순수 함수

상태를 읽지 않고 인자로만 동작한다. **의도적인 설계**다 — 브라우저 콘솔에서 12개 조합을 직접 호출해 전수 검증할 수 있다. 리팩터링할 때 이 순수성을 깨지 않는다.

## 반드시 지킬 불변 조건

### ① `PLACES` 데이터의 12개 조합 매칭

Q1(2) × Q2(2) × Q3(3) = 12개 조합 **전부에 최소 1곳**이 매칭되도록 데이터가 구성되어 있다.
`PLACES`를 수정하면 이 조건이 깨질 수 있다. 콘솔에서 확인할 것:

```js
for (const s of ["visited", "wish"])
  for (const g of ["혼밥", "여럿"])
    for (const p of ["가까움", "가성비", "분위기"])
      console.log(
        s,
        g,
        p,
        PLACES.filter(
          (x) => x.status === s && x.tags.includes(g) && x.tags.includes(p),
        ).length,
      );
```

**빈 결과 화면은 절대 만들지 않는다.** 조건 완화 3단계(q3→q2→q1)가 그래서 존재한다.

### ② 직전 제외는 후보가 2곳 이상일 때만

12개 중 6개 조합은 매칭이 **정확히 1곳**이다. 여기서 "직전에 보여준 곳 제외"를 그대로 적용하면 후보가 0곳이 되고, 조건 완화로 넘어가 `조건을 조금 넓혀서 골랐어요`가 **거짓으로** 표시된다. 조건은 실제로 맞았기 때문이다.
→ 완화 안내는 실제로 조건을 푼 경우에만 띄운다.

### ③ 카피 금지 사항 (PRD 4장 · DESIGN 7장)

- **`AI 추천` 및 이에 준하는 표현 금지.** Phase 0의 추천은 규칙 기반 필터링이다. 지금 못 지키는 약속을 카피에 넣지 않는다.
- 느낌표 쓰지 않는다. `최고의`·`완벽한`·`혁신적인` 금지.
- `~해요` 중심 존댓말. 한 문장 한 메시지, 두 줄 이내.
- 이모지를 UI 요소로 쓰지 않는다.

### ④ 반응형 구조 (DESIGN 4·8장)

브레이크포인트는 **모바일 <768 / 태블릿 768~1023 / PC ≥1024** 세 단계다.

컨테이너가 두 종류라는 점이 핵심이다:
- `.container` — 읽는 컬럼 (480/600/640). 데모·마무리 CTA
- `.container--wide` — 배치 컬럼 (480/768/1080). Hero·공감·해결·기능·푸터

**체험 데모만은 예외로 항상 520px 고정이다.** 다른 섹션이 넓어져도 여기는 넓히지 않는다 — 「한 화면에 하나씩」이 이 섹션의 존재 이유다.

`.container`에 붙은 `width: 100%`를 지우지 말 것. 플렉스/그리드 부모 안에서 가로 `auto` 마진이 `stretch`를 취소해 컨테이너가 내용물 크기로 줄어든다 (Hero가 그 경우다).

### ⑤ 시각 제약 (DESIGN 10장)

- 토마토 레드는 CTA·선택 상태·재방문율 숫자에만. 넓은 배경 면적에 쓰지 않는다.
- 폰트 굵기는 400/600/700 **세 가지만**.
- 그림자는 결과 카드에만. 나머지는 1px 테두리로 구분한다.
- CTA 버튼은 태블릿부터 최대 320px. 컨테이너 전체 폭으로 늘리지 않는다.
- 체험 데모에서 질문을 한 화면에 여러 개 보여주지 않는다.

### ⑥ 대비율은 실제 배경 기준으로 잰다

토큰 표의 값은 **흰 배경 기준**이다. `--color-surface-alt`(#FAF8F7)나 `--color-primary-tint`(#FDF0EE) 위에 올라가면 떨어진다.
이미 두 곳은 AA 미달이라 의도적으로 토큰에서 벗어나 있다 — `style.css`에 사유가 주석으로 달려 있으니 **토큰 값으로 되돌리지 말 것**:

- `.badge--wish` → `primary` 대신 `primary-hover` (4.11 → 5.24)
- `.footer__meta` → `ink-500` 대신 `ink-700` (4.43 → 9.27)

### ⑦ 담기 페이지의 클래스는 `UI-CONTRACT.md`가 사양이다

마크업(`save.html`·`save.js`)과 스타일(`save.css`)을 따로 작업할 수 있도록 클래스 이름을 동결한 문서다.
이름을 바꾸려면 **계약서를 먼저 고친다.** 계약서에 없는 선택자를 CSS에 지어내지 않는다.

계약서가 다루지 않는 축에서 사고가 난다. 실제로 두 번 겪었다:

- **`<head>`는 초판에 없었다.** 폰트 링크가 빠지면 에러 없이 시스템 폰트로 조용히 떨어진다
  (`style.css`가 `font-family: 'Inter','Pretendard',...`를 선언하므로). 두 페이지의 폰트 링크는 **동일하게 유지**한다.
- **컨테이너 조합도 없었다.** 아래 ⑧ 참고.

### ⑧ `.container--wide`는 단독 클래스가 아니라 modifier다

```css
.container       { width: 100%; max-width: 480px; margin: 0 auto; padding: 0 20px; }
.container--wide { max-width: 480px; }   /* max-width만 갖고 있다 */
```

`--wide`만 붙이면 `margin: 0 auto`와 좌우 padding이 빠져 **페이지가 왼쪽에 붙는다.**
→ `<body class="save-page container container--wide">` 처럼 **셋을 함께** 쓴다.

브레이크포인트 폭(480/768/1080)의 진실의 원천은 `style.css`의 `.container--wide` **하나뿐이다.**
`.save-page`에서 `max-width`를 다시 선언하지 않는다. 값이 우연히 일치하면 화면은 멀쩡한데 나중에 조용히 갈라진다.

### ⑨ `.toast`는 `hidden` 속성으로 토글한다

`.toast`에 `display: flex`를 선언하면 그 규칙이 브라우저 기본 `[hidden] { display: none }`을 **이긴다.**
토스트가 영영 사라지지 않는다. `save.css`의 이 한 줄을 지우지 말 것:

```css
.toast[hidden] { display: none; }
```

### ⑩ 카카오 API 키는 `.env` 또는 환경변수에서만 읽는다

`server.py`가 프록시로 존재하는 이유가 이것이다 — **브라우저로 키를 내려보내지 않기 위해서다.**
클라이언트 코드(`save.html`·`save.js`)에 키를 넣지 않는다. `.env`는 `.gitignore` 대상이다 (PRD 8장).

키가 없어도 서버는 뜨고 정적 파일은 서빙된다. `/api/search`만 `503` + `검색 서버 설정이 아직 안 됐어요`를 돌려준다.
**에러 경로를 검증할 때는 `unset KAKAO_REST_API_KEY`만으로 부족하다** — `.env`가 있으면 그쪽에서 읽어간다.

### ⑪ 구글 리뷰의 FieldMask를 늘리지 않는다

Places API (New)는 **요청한 필드에 따라 과금 등급이 올라간다.** 두 구현이 같은 5개로 고정되어 있다:

```
places.displayName, places.rating, places.userRatingCount, places.reviews, places.googleMapsUri
```

`languageCode`·`regionCode`는 FieldMask가 아니라 **요청 본문 필드**라 등급에 영향이 없다. 이 둘은 한국어 리뷰를 받기 위한 것이다.

**신버전 방식만 쓴다** — 키는 `X-Goog-Api-Key` 헤더, 필드는 `X-Goog-FieldMask` 헤더, 메서드는 POST.
URL에 `?key=`를 붙이는 구버전 GET으로 돌아가지 않는다.

**오매칭 방지는 `locationRestriction` + `rectangle`이다. `locationBias`로 되돌리지 않는다.**
bias는 '선호'일 뿐 반경 밖을 **배제하지 않는다.** 부산 `해운대암소갈비집`을 서울 좌표로 조회하면
bias는 부산 가게를 그대로 돌려준다 — 실측으로 확인했고, 에러가 아니라 **그럴듯한 오답**이라 놓치기 쉽다.

- Text Search의 `locationRestriction`은 **circle을 받지 않는다** (`400 Unknown name "circle"`).
  circle을 받는 쪽은 `locationBias`다 — 그래서 반경을 위경도 박스로 바꿔서 넣는다
- **둘을 함께 지정할 수 없다** — 구글이 400으로 거절한다. 택일이다
- 박스는 원보다 넓어 모서리가 약 212m까지 늘어난다. 도시 단위 오매칭을 막는 것이 목적이라 감수한다
- 못 찾는 가게가 잦으면 `SEARCH_RADIUS_M` 하나만 키운다 (**두 구현 모두**)

### ⑫ 리뷰 캐시는 무료 한도를 지키는 장치다

구글 리뷰는 **월 1,000건까지만 무료다.** `review-cache.js`가 조회 결과를 sessionStorage에 넣어
같은 가게를 다시 열 때 네트워크를 타지 않게 한다. `save.js`가 `sessionStorage`를 직접 만지지 않는다.

캐시하는 것과 안 하는 것이 갈린다 — **의도적이다:**

- **넣는다** — 성공, 그리고 `not_found`.
  `not_found`야말로 캐시가 필요한 쪽이다. 구글에 없는 가게를 연타하면 '없다'를 확인하는 호출만으로 한도가 닳는다
- **안 넣는다** — 타임아웃·업스트림 오류·키 없음·네트워크 실패.
  전부 시간이 지나면 풀리는 상태다. 캐시하면 키를 고쳐도 탭을 새로 열기 전까지 고쳐지지 않은 것처럼 보인다

`localStorage`가 아니라 `sessionStorage`인 것도 의도다. 리뷰는 남의 데이터라 낡는다 —
영속시키면 몇 달 전 리뷰를 새것처럼 보여준다. 담아둔 곳(`storage.js`)은 사용자 본인의 의도라 반대로 영속시킨다.

### ⑬ 좌표는 `x`가 경도, `y`가 위도다

`/api/search`가 카카오 원본 그대로 문자열로 내려보내고, `/api/reviews`가 `locationBias`로 쓴다.
**뒤집어도 에러가 나지 않는다** — 지구 반대편을 가리켜 조용히 `not_found`가 될 뿐이라 찾기 어렵다.

JS 쪽에서 빈 문자열을 먼저 걸러내는 줄을 지우지 말 것. **`Number("")`는 `NaN`이 아니라 `0`이다** —
좌표 없는 요청이 위도 0·경도 0(기니만 앞바다)으로 통과한다.
파이썬은 `float("")`가 `ValueError`를 내므로 이 함정이 없다. **두 구현을 나란히 태워보지 않으면 드러나지 않는다.**

## 검증

테스트 프레임워크가 없으므로 브라우저 콘솔에서 확인한다.

- `pickPlace`를 12개 조합 × N회 호출 → 빈 결과 0건, 매칭 1곳인 조합에서 `relaxed`가 `null`인지
- 완화 경로는 현재 데이터에서 발동하지 않는다. 검증하려면 `PLACES`를 일시적으로 비워 강제 발동시킨 뒤 원복한다
- 반응형은 iframe을 375/834/1440px로 띄워 한 번에 잰다 (창 리사이즈는 이 환경에서 뷰포트에 반영되지 않는다)
- 각 폭에서 `document.documentElement.scrollWidth <= window.innerWidth`
- 대비는 토큰이 아니라 `getComputedStyle`로 실제 렌더링된 색을 잰다

**담기 페이지 (Phase 1)**

- `python3 server.py`로 띄운다. `file://`로는 `fetch('/api/search')`가 실패한다
- 계약 정합성은 기계적으로 잰다 — `save.html`+`save.js`가 쓰는 클래스와 `save.css`가 스타일하는 선택자를
  양방향으로 대조해 **죽은 CSS 0건 · 미구현 0건**을 확인한다
  (`save.js`는 `el(tag, className, text)` 헬퍼로 클래스를 붙이므로 2번째 인자까지 긁어야 한다)
- 에러 3경로를 실제로 태운다 — 키 없음(503) · 빈 검색어(400) · 네트워크 실패(`.catch`)
- `storage.js`는 localStorage가 막힌 환경에서 메모리로 폴백한다. 사파리 프라이빗 모드에서 확인한다

**구글 리뷰 (Phase 1)**

- 두 구현을 나란히 태워 **에러 봉투가 같은지** 본다. 키가 없어도 여기까지는 전부 검증된다:
  이름 없음(400) · 좌표 없음(400) · 좌표가 숫자 아님(400) · 위도 범위 밖(400) · 키 없음(503)
  ```bash
  curl -s "http://127.0.0.1:8000/api/reviews?name=%EA%B0%80%EA%B2%8C"   # server.py
  # api/reviews.js는 req/res를 흉내내는 10줄짜리 하네스로 직접 require해서 돌린다
  ```
- 패널은 `window.fetch`를 가로채 구글 응답을 흉내내면 **키 없이도 전 경로를 검증할 수 있다.**
  `save.js`가 `window.fetch(...)`로 호출하므로 덮어쓰기가 먹는다
- 캐시 정책을 실제로 잰다 — 성공·`not_found`는 재호출 0건, 서버 오류는 재호출 1건
  (`window.ReviewCache.get(id)`로 직접 확인한다. `sessionStorage`를 직접 읽으면 도구가 막을 수 있다)
- 좌표가 뒤집히지 않았는지 나간 요청으로 확인한다 — 서울이면 `x≈127`(경도) · `y≈37.5`(위도)

**주의:** iframe으로 반응형을 잴 때 리뷰 패널은 **애니메이션이 조여져 `from` 상태(`translateY(16px)`)에 멈춘다.**
`animation: ... both`라서 시작 프레임이 그대로 남는 것이다. 레이아웃만 잴 때는
`panel.style.animation = 'none'`으로 끄고 측정한다. 끄지 않으면 16px 어긋난 값을 버그로 오인한다.

**주의:** `sessionStorage`는 같은 출처의 **프레임끼리 공유된다.** 검증용 iframe이 본 페이지가 남긴
리뷰 캐시를 그대로 물려받아 stub이 호출되지 않는다. iframe에서 먼저 캐시를 비우고 시작한다.

**주의:** 브라우저 탭이 백그라운드면 Chrome이 `setTimeout`을 심하게 조인다(250ms → 1200ms 이상 관측). 자동화 검증에서 고정 `sleep` 대신 **조건 폴링**을 쓴다.

## 범위 밖 (Phase 0~1)

로그인, 서버 DB, 방문 기록, 리뷰 리스트, 대시보드, Gemini API, Supabase, 사전 신청 이메일 수집.
로드맵은 PRD 7장 참고.

**Phase 1에서 범위 안으로 들어온 것** — 맛집 담기(F1)와 구글 리뷰 보기.
카카오 로컬 API 검색, localStorage 저장, 구글 Places API (New) 리뷰 조회가 붙었다.
다만 저장은 **브라우저 로컬뿐이다.** 기기를 옮기면 목록이 따라가지 않는다. 계정 기반 영속 저장은 F7(로그인)의 일이다.

체험 데모의 `PLACES`는 여전히 하드코딩이고 담기 목록과 **연결되어 있지 않다.**
담아둔 곳으로 데모를 돌리는 것은 다음 단계다.

**Gemini API 키를 클라이언트 코드에 넣지 않는다** (PRD 8장). Supabase Edge Function을 경유해야 하므로 F6(AI 요약)은 F7(로그인) 없이 안전하게 구현할 수 없다.

## 반응형

- 모바일 (375)
- 태블릿 (768)
- 데스크탑 (1440)
  으로 브레이크포인트 설정
