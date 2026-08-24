# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트

**오늘은 여기** — 담아둔 맛집 중에서 오늘 갈 한 곳을 골라주는 서비스의 랜딩페이지.
핵심 가치는 검색이 아니라 **결정**이다.
현재 Phase 0(랜딩페이지 + 체험 데모)과 Phase 1의 맛집 담기(F1)가 구현되어 있다.
담아둔 곳은 **계정에 저장된다** — Supabase `saved_places` 테이블 + RLS.
랜딩페이지에는 추천 코너가 둘 붙어 있다 — **지금 인기**(모두의 집계)와 **나를 위한 추천**(내 취향).

## 명령어

빌드 도구, 패키지 매니저, 테스트 러너가 **없다.** 정적 파일과 표준 라이브러리 서버가 전부다.

```bash
python3 server.py                # 로컬 실행 → localhost:8000
PORT=8080 python3 server.py      # 포트 변경
```

`server.py`가 `python3 -m http.server`를 **대체한다.** 정적 파일을 그대로 서빙하면서
`/api/search` 한 경로만 가로채 카카오 로컬 API로 중계한다. 표준 라이브러리만 쓴다 — `pip install` 금지.

**이제 세 페이지 모두 서버로 띄운다. `file://`로 여는 길은 닫혔다.**
담기 페이지(`save.html`)는 `fetch('/api/search')`·`fetch('/api/reviews')`·`fetch('/api/analyze')`를 쓰고,
**랜딩페이지(`index.html`)도 맞춤 추천이 `fetch('/api/search')`를 쓴다.**
`file://`로 열면 그 코너만 `추천을 불러오지 못했어요`가 되고 인기 코너와 데모는 그대로 돈다 —
**에러가 아니라 부분 고장이라 알아채기 어렵다.**

`gh` CLI는 Homebrew가 아니라 `~/.local/bin/gh`에 직접 설치되어 있다.

### 배포 (Vercel)

배포는 **GitHub 연동**이다. `origin`에 push하면 Vercel이 빌드한다 — CLI도 `.vercel/` 링크도 없다.

API 경로의 구현이 **둘씩이다.** 로컬은 `server.py`, 배포는 `api/*.js`.

```
server.py        로컬 개발 — 정적 서빙 + 프록시 셋 다. 파이썬 표준 라이브러리만
api/search.js    배포 — 카카오 검색.       Vercel 서버리스 함수. 의존성 없음(전역 fetch), CommonJS
api/reviews.js   배포 — 구글 리뷰.         같음
api/analyze.js   배포 — 구글 Gemini 분석.  같음. 셋 중 여기만 POST다
```

**짝지어진 둘은 같은 계약을 지켜야 한다** — 사양은 `UI-CONTRACT.md`의
「/api/search 응답 봉투」·「/api/reviews 응답 봉투」·「/api/analyze 요청·응답 봉투」다.
한쪽만 고치면 로컬에서는 되는데 배포에서 깨진다. 고쳤으면 아래로 대조한다:

```bash
# server.py를 빈 포트로 띄우고, 같은 입력을 두 구현에 태워 JSON을 비교한다.
# api/*.js는 req/res를 흉내내는 하네스로 직접 require해서 돌린다.
# 상태코드·Allow 헤더·본문을 JSON.stringify로 대조한다 — 키 순서까지 같아야 한다.
```

**포트가 이미 점유돼 있으면 `server.py`는 뜨지 못하고 요청은 그 자리의 다른 서버로 간다.**
그쪽은 `/api/*`를 라우팅하지 않아 `501`·`404`가 돌아오는데, 계약 불일치처럼 보인다.
검증 전에 `lsof -nP -iTCP:<포트> -sTCP:LISTEN`으로 빈 포트인지 먼저 확인한다.

`.vercelignore`가 `server.py`를 배포에서 뺀다. 빼지 않으면 Vercel이 정적 파일로 취급해 **소스를 그대로 내려준다**
(실측: `GET /server.py` → `200`, 전문). 사양 문서(`*.md`)와 저장소 메타파일도 같은 이유로 뺀다.

**Vercel 환경변수에 세 개를 등록해야 한다** — `KAKAO_REST_API_KEY` · `GOOGLE_PLACES_KEY` · `GEMINI_API_KEY`.
`.env`는 배포에 올라가지 않는다. 로컬에서 리뷰·분석을 보려면 `.env`에도 같은 키가 있어야 한다.
**한쪽 키가 없으면 그 경로만 `503`을 돌려주고 나머지는 정상 동작한다** — 셋이 서로를 막지 않는다.

`GEMINI_MODEL`은 선택이다. 기본값은 `gemini-3.5-flash` — **최신 모델이 아닌 것이 의도다**(⑭).
모델이 종료되면 코드 배포 없이 대시보드에서 이 값만 바꾼다.

**`package.json`을 만들지 않는다.** 없어야 Vercel이 `api/*.js`를 CommonJS로 해석한다.
만들면서 `"type": "module"`이 붙는 순간 세 함수의 `module.exports`가 전부 깨진다.

`vercel.json`은 `api/analyze.js`의 `maxDuration`을 **30초로 고정**한다.
코드의 `GEMINI_TIMEOUT`(20초)은 그 안에서 우리 `504 upstream_timeout` 봉투를 내보내기 위한 값이다.
두 값은 ⑭의 지연 실측 표에 맞춰져 있다 — 모델을 바꾸면 **셋을 함께** 다시 본다.
플랫폼이 먼저 끊으면 우리 봉투가 아니라 **Vercel의 불투명한 에러 페이지**가 내려간다.
고정해두지 않으면 이 전제가 플랫폼 기본값 변경에 조용히 딸려간다.

## 문서가 사양이다

`PRD.md`와 `DESIGN.md`는 참고 문서가 아니라 **확정된 사양서**다. 코드를 고치기 전에 해당 장을 먼저 읽는다.

**충돌 시 우선순위** (DESIGN.md 서문에 명시):

- 기능·범위 결정 → **PRD.md**가 우선
- 시각·카피 톤 결정 → **DESIGN.md**가 우선

예: 서브카피의 *내용*은 PRD 5장을 따르되 *어미*는 DESIGN 7장의 `~해요`체를 따른다.

## 아키텍처

```
Phase 0 — 랜딩페이지
index.html   섹션 7개 마크업. 데모(#demo-stage)와 추천 두 코너만 비어 있고 JS가 채운다
style.css    DESIGN.md의 토큰·스케일·컴포넌트 수치를 그대로 옮긴 것. 세 페이지가 공유한다
             `.toast`도 여기 있다 — index.html과 save.html이 **같은 마크업을** 쓰기 때문이다
app.js       PLACES 데이터 + pickPlace() + 데모 상태 관리
site-nav.js  상단 내비게이션(헤더) 필의 선택 상태만 맞춘다. 이동은 <a href="#...">가
             브라우저 기본 동작으로 한다 — 이 파일이 없어도 링크는 그대로 동작한다.
             `#for-you` 필의 hidden 토글은 여기서 하지 않는다 — 그 판단은 home.js가
             #for-you 섹션을 여닫는 곳 한 군데다 (㉖과 같은 이유: 창구가 둘이면 경쟁이 생긴다)

Phase 1 — 랜딩페이지의 추천 두 코너
home.js      「지금 인기」와「나를 위한 추천」 렌더 + 담기. 두 목록의 생김새가 같아 한 파일이다
home.css     두 코너 전용 스타일. style.css 다음에 로드된다
popular-places.js  `popular_places()` rpc 래퍼. 공개 창구는 window.PopularPlaces 하나뿐이다
supabase-popular-places.sql  랭킹 함수 DDL + grant. 대시보드 SQL Editor에서 실행한다 (㉓)
supabase-category-column.sql saved_places.category_name 추가. 맞춤 추천의 재료다
supabase-seed-dummy.sql      더미 계정 12개 + 담은 기록 100건. 랭킹을 눈으로 보려고 만든 것이다

Phase 1 — 맛집 담기
server.py    정적 서버 + /api/search·/api/reviews·/api/analyze 프록시. 표준 라이브러리만
save.html    담기 페이지 마크업. 클래스 이름은 UI-CONTRACT.md에 고정되어 있다
save.css     담기 페이지 전용 스타일. style.css 다음에 로드된다
save.js      검색·렌더·담기 상태 관리 + 구글 리뷰 패널 + AI 분석 패널

Phase 1 — 담아둔 곳 저장 (계정)
saved-places.js  Supabase `saved_places` 래퍼. 공개 창구는 window.SavedPlaces 하나뿐이다
                 storage.js(localStorage)를 **대체한다** — 그 파일은 지웠다 (⑳)
mypage.html      마이페이지 마크업. 클래스는 UI-CONTRACT.md에 고정되어 있다
mypage.css       마이페이지 전용 스타일. style.css 다음에 로드된다 (save.css는 안 쓴다)
mypage.js        가볼 곳/가본 곳 렌더 + 방문 기록 입력창 + 삭제
supabase-saved-places.sql   테이블·인덱스·RLS 정책 DDL. 대시보드 SQL Editor에서 실행한다
supabase-visit-policy.sql   방문 기록용 update 정책. 위 파일 다음에 실행한다 (㉒)

Phase 1 — 구글 리뷰
api/reviews.js   배포 — 구글 Places API (New) 프록시. server.py의 handle_reviews()와 같은 계약
review-cache.js  sessionStorage 래퍼(조회한 리뷰). 무료 한도를 지키는 장치다

Phase 1 — 리뷰 분석
api/analyze.js     배포 — 구글 Gemini 프록시. server.py의 handle_analyze()와 같은 계약. POST다
analysis-cache.js  sessionStorage 래퍼(분석 결과). review-cache.js와 같은 결의 장치다

Phase 1 — 로그인 (F7)
auth.js      Supabase 이메일 로그인. 공개 창구는 window.Auth 하나뿐이다
             supabase-js UMD를 CDN에서 받는다 (빌드 도구가 없으므로 ESM이 아니라 UMD)
             DB가 필요한 모듈은 Auth.client()로 클라이언트를 받아간다 — 새 전역을 만들지 않는다

vercel.json  api/analyze.js의 maxDuration 고정. 배포 전용 — 로컬은 읽지 않는다
.env         API 키 셋. gitignore 대상 — 절대 커밋하지 않는다
             Supabase publishable 키는 여기가 아니라 auth.js에 있다 (⑯)
```

`save.html`·`save.js`·`save.css`와 `mypage.html`·`mypage.js`·`mypage.css`의 클래스 이름은
**`UI-CONTRACT.md`가 사양이다.**
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
영속시키면 몇 달 전 리뷰를 새것처럼 보여준다.
담아둔 곳은 사용자 본인의 의도라 반대다 — 브라우저가 아니라 **계정에** 영속시킨다 (`saved-places.js` · ⑳).

### ⑬ 좌표는 `x`가 경도, `y`가 위도다

`/api/search`가 카카오 원본 그대로 문자열로 내려보내고, `/api/reviews`가 `locationBias`로 쓴다.
**뒤집어도 에러가 나지 않는다** — 지구 반대편을 가리켜 조용히 `not_found`가 될 뿐이라 찾기 어렵다.

JS 쪽에서 빈 문자열을 먼저 걸러내는 줄을 지우지 말 것. **`Number("")`는 `NaN`이 아니라 `0`이다** —
좌표 없는 요청이 위도 0·경도 0(기니만 앞바다)으로 통과한다.
파이썬은 `float("")`가 `ValueError`를 내므로 이 함정이 없다. **두 구현을 나란히 태워보지 않으면 드러나지 않는다.**

### ⑭ Gemini 모델은 `GEMINI_MODEL`로 바꾸되, 바꾸기 전에 세 가지를 잰다

기본값은 `gemini-3.5-flash`다. **최신 모델이 아닌 것이 의도다.**
모델을 올리기 전에 아래 셋을 실측한다 — 하나만 보고 고르면 배포 후에 드러난다.

**㉠ 무료 등급 일일 한도는 모델마다 따로 걸린다. 신모델일수록 좁다.**

```
Quota exceeded for metric: generate_content_free_tier_requests
limit: 20,  model: gemini-3.7-flash
quotaId: GenerateRequestsPerDayPerProjectPerModel-FreeTier
```

`gemini-3.7-flash`는 **하루 20건**이었다(실측). 서비스로 쓸 수 있는 수치가 아니다.
`analysis-cache.js`는 `sessionStorage`라 **탭 단위로만** 듣는다 — 사용자가 다르면 캐시가 겹치지 않아
방문자 몇 명이면 그날 몫이 끝난다. ⑫의 리뷰 캐시(월 1,000건)와는 강도가 다르다.
자기 프로젝트의 모델별 한도는 <https://aistudio.google.com/rate-limit>에서 본다.

**㉡ 지연이 함수 상한을 넘으면 그 모델은 쓸 수 없다.** 실제 payload 기준 실측:

| 모델 | 지연 | thinking + 출력 | 판정 |
|---|---|---|---|
| `gemini-3.7-flash` | 3.4 ~ 8.9s | 304~587 + 160~378 | 빠르나 한도 20/일 |
| `gemini-3.5-flash` | 5.0 ~ 16.0s | ~1400 + 155~349 | **현재 기본값** |
| `gemini-3.6-flash` | 26 ~ 41s | 652~1414 + 151~176 | 상한 초과, 쓸 수 없음 |

`GEMINI_TIMEOUT`(20초)과 `vercel.json`의 `maxDuration`(30초)이 이 표에 맞춰져 있다.
8초였을 때 **성공 응답을 우리 손으로 버렸다** — 화면에는 `분석이 오래 걸려서 멈췄어요`가 떴다.

**㉢ `maxOutputTokens`(4096)는 thinking 토큰과 나눠 쓴다.**
3.x flash는 기본으로 생각하고 그 토큰이 상한에 함께 잡힌다. thinking이 출력의 **4~8배**다.
2048이던 시절 최악 1656/2048(81%)까지 찼고 실제로 한 번 넘쳤다.
넘치면 JSON이 중간에서 끊겨 `bad_analysis`가 된다 — 에러가 아니라 **그럴듯한 실패**다.
**상한을 올려도 thinking은 늘지 않는다**(실측 확인). 출력 토큰은 사용량 과금이라 비용도 늘지 않는다.

**모델 종료(404)도 여기 얽힌다.** 종료된 모델을 부르면 화면에는 `분석 모델을 찾지 못했어요`만 뜬다.
종료 공지가 오면 **코드 배포가 아니라 대시보드의 `GEMINI_MODEL`만 바꾼다.**

### ⑮ `429`는 두 갈래다 — 하나는 기다리면 풀리고 하나는 안 풀린다

분당 요청 제한과 일일 무료 한도 소진이 **둘 다 `429 RESOURCE_EXHAUSTED`로 온다.**
상태코드로는 구분되지 않으므로 본문의 `quotaId`에 `PerDay`가 있는지 본다.
일일 소진에 `잠시 뒤에 다시 해주세요`를 띄우면 **거짓말이 된다** — 날짜가 바뀌어야 풀린다.

**판별하려면 본문을 넉넉히 읽어야 한다.** `quotaId`는 `details[]` 안에 있어 실측에서 **995번째 문자**에 있었다.
로그용으로 500자만 잘라 보던 코드로는 **놓친다.** 두 구현 모두 판별에 2000자를 읽고 로그에는 500자만 남긴다.

응답 시간이 단서다 — 용량 부족(`503`)은 서버가 시도하다 포기하므로 수 초가 걸리고,
쿼터 거절(`429`)은 계산 전에 끊으므로 **200~300ms 즉답**이다. 둘 다 우리 코드에서는 `upstream_http` 하나로 묶인다.

### ⑯ Supabase publishable 키가 `auth.js`에 있는 것은 ⑩ 위반이 아니다

⑩은 「API 키를 클라이언트 코드에 넣지 않는다」고 못 박는다. 그 규칙은 **카카오·구글·Gemini 키**의
이야기다 — 그 키들은 손에 넣으면 곧바로 과금 API를 부를 수 있어서 프록시(`server.py`·`api/*.js`)가 있다.

Supabase publishable 키는 **브라우저에 내려보내라고 만든 키다.** 이것만으로는 남의 데이터를 읽지 못한다.
프록시로 감싸도 얻는 것이 없다. → **이 값을 서버로 옮기려 하지 말 것.**

**대신 진짜 방어선은 RLS(Row Level Security)다.**
**담기가 `saved_places` 테이블로 옮겨왔으므로 이 방어선은 이제 가정이 아니라 실전이다.**
RLS를 끄면 publishable 키만 있는 누구나 남의 담아둔 목록을 읽는다 — 키는 `auth.js`에 그대로 적혀 있다.

`saved_places`에 켜져 있는 것을 확인하는 법:

```sql
select relrowsecurity from pg_class where relname = 'saved_places';   -- t 여야 한다
select policyname, cmd from pg_policies where tablename = 'saved_places';
-- select · insert · delete 셋. update 정책은 일부러 없다 (담기는 넣기와 지우기뿐이다)
```

**테이블을 새로 추가할 때마다 같은 것을 다시 확인한다.** 켜는 것을 잊어도
화면은 멀쩡하게 동작한다 — 내 것이 잘 보이기 때문이다. 남의 것도 함께 보인다는 사실은
계정을 두 개 만들어보기 전에는 드러나지 않는다.

`sb_secret_…`·`service_role` 키는 **절대 클라이언트에 넣지 않는다.** 그건 ⑩ 그대로다.

### ⑰ 로그인 여부는 `onChange`로 그린다. `isSignedIn()`을 직접 읽지 않는다

supabase-js는 세션을 `localStorage`에서 **비동기로** 복원한다.
페이지 로드 직후에 `Auth.isSignedIn()`을 읽으면 **로그인한 사용자가 비로그인으로 보인다.**
에러가 나지 않고 조용히 틀린 값이 나오는 부류다 — ⑬의 `Number("")`와 같은 계열이다.

```js
window.Auth.onChange(function (user) { render(user); });   // 이렇게
if (window.Auth.isSignedIn()) { … }                        // 이렇게 말고
```

`onChange`는 **등록 즉시 한 번**, 복원이 끝나면 **다시** 호출되므로 두 시점이 모두 덮인다.

같은 이유로 `.site-auth`는 **복원 전에 아무것도 그리지 않는다.**
`로그인`을 미리 그려두면 로그인한 사용자에게 로그인 버튼이 깜빡인다.

### ⑱ 「가입 즉시 로그인」은 코드가 아니라 프로젝트 설정이 정한다

대시보드의 **Authentication → Sign In / Providers → Email → Confirm email**이 꺼져 있어야
`signUp()` 응답에 `session`이 함께 온다. 켜져 있으면 `session`이 `null`로 오고 메일 인증을 기다린다.

**둘 다 성공 응답이다.** `error`만 보고 「가입 완료」라고 띄우면
인증이 켜진 프로젝트에서 **로그인도 안 됐는데 완료라고 말하게 된다.**
`auth.js`가 `res.data.session`의 유무로 갈라두었다 — 이 분기를 지우지 말 것.

설정은 코드로 확인할 수 있다:

```bash
curl -s -H "apikey: <publishable>" "<project-url>/auth/v1/settings" | grep -o '"mailer_autoconfirm":[a-z]*'
# true  → 인증 꺼짐. 가입 즉시 로그인된다
# false → 인증 켜짐. 메일을 기다린다
```

### ⑲ `invalid_credentials`를 「가입되지 않은 이메일」로 옮기지 않는다

Supabase는 **비밀번호 오류와 미가입 계정에 같은 코드**를 돌려준다.
어느 이메일이 가입돼 있는지 알아내지 못하게 하려는 **의도적 설계**다.
둘을 나눠 안내하면 그 방어가 무너진다 → `이메일 또는 비밀번호가 맞지 않아요` 하나로 합친다.

안내 문구는 `error.code`로 가른다. **`message`로 가르지 않는다** — 영어이고 버전에 따라 바뀐다.
표는 UI-CONTRACT 「안내 문구 — Supabase 오류를 한국어로 옮기는 표」에 있다.

### ⑳ 담아둔 곳의 저장소는 `saved_places` 하나뿐이다

`storage.js`(localStorage)는 **지웠다.** 되살리지 않는다.
두 저장소가 함께 있으면 어느 쪽이 진실인지 알 수 없다 — 기기를 옮기면 한쪽만 따라오고,
로그아웃하면 한쪽만 비는데 화면은 둘을 섞어 보여준다.

`save.js`·`mypage.js`가 `localStorage`나 supabase 클라이언트를 **직접 만지지 않는다.**
창구는 `saved-places.js`의 `window.SavedPlaces` 하나다 (⑫의 `ReviewCache`와 같은 규칙).

**화면은 동기, 저장은 비동기다.** `renderResults()`가 카드를 그리는 **도중에**
담김 여부를 물어보므로 거기서 네트워크를 기다릴 수 없다. 그래서:

- 로그인하면 내 목록을 한 번 받아 메모리 색인에 넣는다
- `has()`·`list()`·`count()`는 그 색인만 본다 → 그대로 동기
- `add()`·`remove()`는 `Promise<{ok}>`를 돌려준다

**성공했을 때 화면을 고치는 곳은 `onChange` 구독 한 군데다.** 부르는 쪽에서 낙관적으로
먼저 칠하지 않는다 — 저장에 실패했는데 담긴 것처럼 보이면 **새로고침해야 드러나는 거짓말**이 된다.

왕복하는 동안 버튼을 `disabled`로 잠근다. 잠그지 않으면 연타가 insert와 delete를
엇갈리게 보내 화면과 DB가 갈린다.

**`isLoaded()`를 보지 않으면 「불러오는 중」이 「비어 있음」으로 보인다.**
목록이 도착하기 전에도 `list()`는 빈 배열이라, 담아둔 것이 있는 사용자에게
`아직 담은 맛집이 없어요`가 잠깐 스친다. ⑰과 같은 계열의 함정이다.

### ㉑ 조회에 `user_id` 조건을 걸지 않는다. 거르는 일은 RLS 담당이다

```js
.from('saved_places').select(...).order('created_at', { ascending: false })   // 이렇게
.from('saved_places').select(...).eq('user_id', user.id)                      // 이렇게 말고
```

조건 없이 전체를 요청하면 RLS가 내 것만 돌려준다.
프론트에서 한 번 더 거르면 **방어선이 프론트에 있는 것처럼 보인다** — 나중에 그 줄을
지웠을 때 아무 일도 일어나지 않으므로(RLS가 여전히 막아주므로) 걷어내도 되는 줄로 오해하고,
정작 RLS가 꺼진 테이블에서 같은 습관을 반복하면 그때 뚫린다.

같은 이유로 **`user_id`를 코드에서 만들어 넣지 않는다.** 컬럼 기본값 `auth.uid()`가 채운다.
직접 실어보내면 남의 id를 넣는 실수를 `with check`가 막아주기는 하지만,
막아주는 것과 시도하지 않는 것은 다르다.

### ㉒ 방문 기록은 행을 **고친다.** update 정책이 없으면 에러 없이 조용히 실패한다

`visited_at` · `note` · `would_return` 셋은 `saved_places`의 칸이다. **새 테이블을 만들지 않는다** —
방문 기록은 담아둔 곳의 속성이지 별개의 사건이 아니다.

담기는 넣기와 지우기뿐이라 정책을 셋(`select`·`insert`·`delete`)만 만들어 두었다.
기록은 **`update`**라 정책이 하나 더 필요하다 (`supabase-visit-policy.sql`).

**없으면 에러가 나지 않는다.** 고칠 대상이 0건으로 보여 PostgREST가 `200 OK` + 빈 배열을 돌려준다 —
거절이 아니라 「0건 고쳤다」다. `error`만 보면 성공으로 읽혀서 화면에는 `기록을 남겼어요`가 뜨고,
새로고침하면 기록이 사라져 있다. **에러가 아니라 그럴듯한 실패다** (⑭·⑮와 같은 계열).

→ `saved-places.js`의 `saveVisit()`이 **돌려받은 행이 0건이면 실패로 처리한다**(`reason: 'not_updated'`).
정책이 있어도 없어도 화면이 거짓말하지 않는다. **이 검사를 지우지 말 것.**

세 가지를 더 지킨다:

- **`wouldReturn`만 필수다.** `note`는 비어도 저장된다 — 기록을 강요하지 않는 것이 이 화면의 약속이다
- **`visited_at`은 처음 기록할 때만 넣는다.** 「기록 수정」에서 다시 넣으면
  지난달에 간 곳이 오늘 간 것으로 덮인다 — 데이터가 조용히 틀려진다
- **`wouldReturn`을 `Boolean()`으로 감싸지 않는다.** `null`(아직 답 안 함)과 `false`(글쎄요)가
  같아져 **「글쎄요」라고 답한 데이터가 사라진다.** ⑬의 `Number("")`와 같은 계열이다

### ㉓ 인기 랭킹은 **RLS를 끄지 않는다.** `popular_places()` 함수가 대신 센다

랭킹은 「**모두**가 담은 것」을 세는 일인데, `saved_places`의 select 정책은
`auth.uid() = user_id`다. 브라우저에서 무엇을 물어봐도 **내 것만** 돌아온다 —
거기서 `count`를 세면 「모두가 담은 수」가 아니라 **내 목록의 길이**가 나온다.

**여기서 RLS를 끄고 싶어진다. 끄면 안 된다.**
끄는 순간 publishable 키만 있는 누구나 남의 담아둔 목록을 통째로 읽는다.
키는 `auth.js`에 그대로 적혀 있다 (⑯). 랭킹 하나 때문에 방어선 전체가 무너진다.

→ **세는 일만** 대신해 주는 `security definer` 함수를 하나 두고 그것만 부른다.
RLS를 넘어가는 것은 **함수 안에서만**이고, 밖으로는 집계값만 나간다.

새어나가지 않게 하는 장치가 셋이다. 함수를 고칠 때 셋 다 유지한다:

- **`returns table`에 `user_id`가 아예 없다.** 흘릴 통로 자체를 만들지 않는다.
  `returns setof saved_places`로 바꾸면 이 방어가 통째로 사라진다
- **집계만 내보낸다.** 「누가」는 `count(distinct user_id)` 안에서 숫자로 접힌다
- **`set search_path = public, pg_temp`** — 호출자가 `search_path`를 바꿔
  다른 `saved_places`를 가리키게 만드는 수법을 막는다. `security definer`에는 반드시 붙인다

```sql
select relrowsecurity from pg_class where relname = 'saved_places';   -- 여전히 t 여야 한다

set local role anon;
select (select count(*) from public.saved_places)      as 직접읽기,   -- 0 이어야 한다
       (select count(*) from public.popular_places(5)) as 함수로;     -- 5 여야 한다
```

**Supabase 보안 어드바이저가 이 함수에 경고 두 줄을 띄운다** —
`Public Can Execute SECURITY DEFINER Function`과 그 authenticated 판이다.
**의도한 것이다.** 이 함수는 애초에 남의 집계를 보여주려고 만든 창구다.
경고를 없애려고 `grant`를 걷어내면 랭킹 코너가 통째로 죽는다.
확인할 것은 「경고가 있는가」가 아니라 「**이 함수가 무엇을 내보내는가**」다.

### ㉔ 창구가 `auth.js`를 기다린다. 부르는 쪽이 시점을 알게 하지 않는다

`auth.js`는 supabase 클라이언트를 **`DOMContentLoaded`에서** 만든다.
그런데 본문 끝의 `<script>`는 그보다 **먼저** 실행된다.
그래서 페이지가 뜨자마자 `Auth.client()`를 부르면 **아직 `null`이다.**

돌아오는 것은 예외가 아니라 `{ ok: false, reason: 'unavailable' }`다 —
**콘솔에 아무것도 남지 않고** 화면에는 「불러오지 못했어요」만 뜬다.
⑰의 「복원 전에 `isSignedIn()`을 읽으면 조용히 틀린 값이 나온다」와 같은 계열이고,
인기 코너를 처음 붙였을 때 실제로 이것으로 한 번 걸렸다.
**콘솔이 조용한 것이 오히려 단서다.**

고치는 자리는 **부르는 쪽이 아니라 창구 쪽이다.**

```js
// popular-places.js — 창구가 안에서 기다린다
function whenReady() {
  if (window.Auth && window.Auth.ready) return window.Auth.ready;
  return Promise.resolve();
}
```

부르는 쪽마다 「언제 불러야 안전한가」를 알아야 한다면 그 지식이 곧 다음 버그가 된다.
`SavedPlaces`가 `Auth.onChange`로 시작하는 것도 같은 이유다 —
**창구는 자기 준비를 스스로 책임진다.**

### ㉕ 맞춤 추천은 카카오 카테고리의 **두 번째 마디**로 묶는다

카카오는 `음식점 > 한식 > 국밥`처럼 계층으로 준다. 쓰는 데가 둘인데 **깊이가 다르다:**

- 카드에 보여주는 작은 글씨 → **마지막 마디** (`국밥`)
- 취향을 묶는 단위 → **두 번째 마디** (`한식`)

마지막 마디로 세면 국밥·감자탕·해장국이 전부 따로 놀아 **1건짜리 잔가지만 잔뜩 생긴다.**
최빈값이 의미를 잃고, 「자주 담는 카테고리」가 사실상 「가장 최근에 담은 곳」이 된다.

그래서 **`saved_places.category_name`에는 계층 문자열을 통째로 넣는다.**
잘라서 저장하면 어느 깊이로 자를지를 DB가 먼저 정해버려, 나중에 다른 깊이가 필요할 때 재료가 없다.

세 가지를 더 지킨다:

- **컬럼이 생기기 전에 담긴 행은 `category_name`이 `null`이다.** 억지로 채우지 않고
  **세지 않고 넘어간다.** 전부 null이면 `한 곳만 더 담으면 취향을 찾아드릴게요`로 받는다
- **조사를 받침에 맞춰 고른다** — `한식을` / `카페를`.
  `한식을(를)`처럼 괄호로 미루지 않는다. 괄호가 섞이는 순간 사람이 쓴 문장이 아니게 된다
- **`AI 추천`이라고 쓰지 않는다** (③). 이 추천은 담은 카테고리를 세는 **규칙 기반**이다

### ㉖ 담은 뒤에도 추천 카드는 사라지지 않는다

「이미 담은 가게는 추천에서 뺀다」는 목록을 **만들 때** 지키는 약속이다.
`SavedPlaces.onChange`가 올 때마다 추천을 다시 받으면, 담기 버튼을 누른 **그 카드가**
눈앞에서 사라진다 — 토스트는 `담았어요`인데 카드는 없어지니 취소된 것처럼 보인다.

→ `home.js`는 **무엇을 기준으로 받았는지**(`지역|카테고리`)를 들고 있다가
같은 기준이면 다시 받지 않고 **버튼 상태만 맞춘다.**
사람이 바뀌면(`Auth.onChange`) 그 기준을 버린다 — 버리지 않으면 앞사람 취향으로
받아둔 목록이 다음 사람 화면에 그대로 남는다.

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

**로그인 (F7)**

- `python3 server.py`로 띄운다. `file://`로는 supabase-js의 세션 저장이 출처 없이 동작하지 않는다
- **키 없이도 여기까지는 전부 검증된다** — 창 열림 · 빈 입력 · 이메일 형식 · 짧은 비밀번호.
  전부 `auth.js`가 서버에 가기 전에 잡는 경로다
- 오류 문구는 실제로 태워 확인한다. 서버 왕복이 필요한 것은 `invalid_credentials` 하나뿐이고,
  **없는 계정에 아무 비밀번호나 넣으면 재현된다** (계정을 만들 필요가 없다)
- 브라우저 도구로 잴 때 **`Auth`가 든 객체 키는 민감정보로 가려진다.**
  `{로그인상태: A.isSignedIn()}` 처럼 한글 키로 바꿔 읽는다
- 세션 유지는 새로고침 뒤 `.site-auth`가 `…님 / 로그아웃`을 그리는지로 본다.
  **복원이 비동기라 즉시 읽으면 비로그인으로 보인다** — `await window.Auth.ready` 뒤에 읽는다 (⑰)
- 담기 게이트는 저장 개수로 잰다 — 비로그인 상태에서 담기를 눌러
  `SavedPlaces.list().length`가 그대로이고 창이 떴는지 확인한다
- 반응형은 375/768/1440에서 `.site-auth`가 `.save-header__back`과 겹치지 않는지,
  창이 화면 안에 들어오는지 본다 (`position: fixed`라 컨테이너 폭과 무관하다)

**담아둔 곳 저장 · 마이페이지**

- `python3 server.py`로 띄운다. `file://`로는 세션이 복원되지 않아 목록이 항상 비어 보인다
- **RLS를 실제로 잰다. 이것이 이 기능의 유일한 방어선이다** (⑯·㉑).
  한 계정으로 담고 → 로그아웃 → **다른 이메일로 가입** → 마이페이지가 **비어 있어야** 한다.
  내 계정만 써보면 RLS가 꺼져 있어도 화면이 멀쩡해서 드러나지 않는다
- 왕복을 실제로 확인한다 — 담기 → 새로고침 → `담았어요`가 남아 있는지.
  메모리 색인만 맞고 DB에 안 들어간 경우가 여기서만 드러난다
- 코드에 조회 조건이 없는지 기계적으로 확인한다 (㉑):
  ```bash
  grep -n "eq('user_id'\|user_id:" saved-places.js mypage.js save.js   # 0건이어야 한다
  ```
- 계약 정합성은 담기 페이지와 같은 방식으로 잰다 — `mypage.html`+`mypage.js`가 쓰는 클래스와
  `mypage.css`가 스타일하는 선택자를 양방향 대조해 **죽은 CSS 0건 · 미구현 0건**.
  주석을 먼저 걷어내지 않으면 주석 속 `save.css`·`.results` 같은 말이 선택자로 잡힌다
- 상태 넷을 각각 태운다 — 비로그인 · 불러오는 중 · 읽기 실패 · 비어 있음.
  읽기 실패는 `Auth.client()`의 `from`을 잠시 바꿔치기하면 키 없이도 재현된다
- 연타를 재본다 — 담기 버튼을 빠르게 두 번 눌러 행이 **하나만** 생기는지.
  `unique (user_id, place_id)`와 버튼 `disabled`가 이중으로 막는다

**방문 기록 (㉒)**

- 정책부터 확인한다. **네 줄(select·insert·update·delete)이어야 한다:**
  ```sql
  select policyname, cmd from pg_policies where tablename = 'saved_places' order by cmd;
  ```
- **update 정책이 없는 상태를 일부러 태워본다.** 이것이 이 기능의 유일한 조용한 실패다 —
  `window.fetch`가 아니라 `Auth.client().from`을 바꿔치기해 `update…select`가 **빈 배열**을
  돌려주게 하면 재현된다. 카드가 「가본 곳」으로 옮겨가지 **않아야** 하고
  `기록을 남겼어요`가 뜨지 **않아야** 한다
- 한 줄 기록을 **비우고** 저장 → 정상 저장되고 `note`가 `null`인지 (빈 문자열이 아니라)
- 「기록 수정」으로 답을 바꿔 저장 → `visited_at`이 **그대로**인지.
  나간 patch에 `visited_at`이 **없어야** 한다
- 답 없이 저장 → `또 올지 먼저 골라주세요`로 막히고 창이 열린 채인지

**주의:** 브라우저 도구로 `.visit-dialog`를 열면 `showModal()`의 포커스 트랩이 CDP와 충돌해
**탭이 죽는다**(실측: 반복 재현). 창 안쪽을 자동화로 재려면 `dlg.showModal = dlg.show`로
비모달로 바꿔 연다 — 코드 경로는 그대로다.

**주의:** `dialog.close()` 직후 **같은 태스크에서** 다시 열면 안 된다.
`close` 이벤트가 뒤늦게 도착해 `editing`을 지워, 저장이 조용히 무시된다.
자동화에서 닫고 다시 열 때는 사이에 한 틱을 둔다.

**추천 두 코너 (㉓~㉖)**

- `python3 server.py`로 띄운다. **`file://`로는 맞춤 추천만 조용히 죽는다** — 인기 코너와 데모는 돌아서
  페이지가 멀쩡해 보인다
- **랭킹이 RLS를 우회하지 **않는지** 먼저 잰다. 이것이 이 기능에서 가장 중요한 검사다** (㉓):
  ```sql
  set local role anon;
  select (select count(*) from public.saved_places)      as 직접읽기,   -- 0
         (select count(*) from public.popular_places(5)) as 함수로;     -- 5
  ```
  **내 계정으로만 보면 이 차이가 드러나지 않는다.** 로그인한 채로는 둘 다 값이 나온다
- 함수가 무엇을 내보내는지 **DB에 직접 물어본다.** 파일을 눈으로 읽지 않는다 —
  배포된 함수와 파일이 어긋나 있을 수 있다. `user_id`가 **없어야** 한다:
  ```sql
  select unnest(proargnames) as 반환컬럼 from pg_proc where proname = 'popular_places';
  -- limit_count(입력) · rank · place_id · place_name · category_name
  --   · road_address_name · x · y · place_url · save_count
  ```
- 계약 정합성은 담기 페이지와 같은 방식으로 잰다 — `index.html`+`home.js`가 쓰는 클래스와
  `home.css`가 스타일하는 선택자를 양방향 대조해 **죽은 CSS 0건 · 미구현 0건**.
  `home.js`도 `el(tag, className, text)` 헬퍼를 쓰므로 **2번째 인자까지** 긁는다.
  `setStatus(node, msg, kind)`가 `'pick-status--' + kind`로 조립하는 것은 정규식에 잡히지 않으니
  `kind` 인자를 따로 모은다
- **비로그인으로 먼저 연다.** 인기 5곳이 뜨고 `#for-you`가 `hidden`이어야 한다.
  인기 목록의 담기를 누르면 **저장되지 않고** 로그인 창이 떠야 한다
  (`SavedPlaces.count()`가 그대로인지로 잰다)
- 더미 계정으로 들어가 맞춤 추천을 잰다. **계정마다 다른 목록이 나와야 한다** —
  `seed01`(25건 담음)과 `seed03`(10건)은 지역도 카테고리도 다르게 잡힌다.
  같은 목록이 나오면 앞사람 기준이 남은 것이다 (㉖)
- 이미 담은 곳이 추천에서 빠졌는지 대조한다:
  ```js
  const 담은것 = new Set(SavedPlaces.list().map(i => i.id));
  [...document.querySelectorAll('#for-you-list .pick-card')].some(c => 담은것.has(c.dataset.placeId));
  // false 여야 한다
  ```
- **담기를 눌러도 카드가 사라지지 않아야 한다** (㉖). 라벨이 `담았어요`로 바뀌고
  `SavedPlaces.count()`가 1 늘면 된다. 카드가 사라지면 목록을 매번 다시 받고 있는 것이다
- 상태 다섯을 각각 태운다 — 담은 곳 0건 · 불러오는 중 · 목록 읽기 실패 · 검색 실패 · 새 곳 0건.
  **`window.fetch`를 통째로 막지 말 것** — supabase 왕복까지 함께 죽어서
  「담아둔 곳을 불러오지 못했어요」가 뜬다. 검색 실패만 재현하려면 URL을 보고 갈라야 한다:
  ```js
  const real = window.fetch.bind(window);
  window.fetch = (u, o) => String(u).indexOf('/api/search') >= 0
    ? Promise.reject(new Error('offline')) : real(u, o);
  ```
- **검색 실패를 들고 있지 않은지 확인한다.** `fetch`를 되돌리고 `SavedPlaces.refresh()`를
  부르면 다시 시도해야 한다. 실패를 캐시하면 새로고침 전까지 고쳐지지 않은 것처럼 보인다 (⑫와 같은 결)

**주의:** 패치를 걸기 **전에** 페이지가 이미 추천을 다 받아왔으면 재조회 자체가 일어나지 않아
(㉖의 기준 캐시 때문에) **성공 화면을 실패로 착각한 채 측정하게 된다.**
로그아웃→로그인으로 기준을 확실히 비운 뒤에 잰다.

**더미 데이터**

- `supabase-seed-dummy.sql`이 계정 12개 + 담은 기록 100건을 만든다. 여러 번 실행해도 안전하다
- 지울 때는 계정만 지운다 — `saved_places` 행은 `on delete cascade`로 함께 사라진다:
  ```sql
  delete from auth.users where raw_user_meta_data->>'seed_data' = 'true';
  ```
- **`auth.users`에 손으로 넣을 때 토큰 칸 넷을 빈 문자열로 채운다** —
  `confirmation_token`·`recovery_token`·`email_change_token_new`·`email_change`.
  컬럼 기본값이 없어 `null`이 들어가는데, GoTrue는 이 넷을 Go의 `string`으로 읽으므로
  `null`을 만나면 조회가 통째로 실패한다:
  ```
  AuthApiError: Database error querying schema
  ```
  **계정은 멀쩡히 보이는데 로그인만 안 되는** 상태가 된다. 대시보드로 만든 계정에는
  이미 `''`이 들어 있어 이 함정이 없다 — 그래서 시드에서만 터진다
- `auth.identities` 행도 함께 넣는다. 없으면 같은 증상이 난다
- **가짜 `place_id`를 지어내지 않는다.** 카카오에서 실제 장소를 받아 쓴다 —
  지어내면 `place_url` 링크가 죽고 구글 리뷰 조회가 엉뚱한 가게를 물어온다

## 범위 밖 (Phase 0~1)

서버 DB, 리뷰 리스트, 대시보드, 사전 신청 이메일 수집. 로드맵은 PRD 7장 참고.
(**방문 기록은 범위 안으로 들어왔다** — `saved_places`의 `visited_at`·`note`·`would_return` 셋. ㉒)

**범위 안으로 들어온 것** — 맛집 담기(F1) · 구글 리뷰 보기 · Gemini 리뷰 분석 ·
**로그인(F7)** · **계정별 저장과 마이페이지** · **방문 기록** ·
**인기 랭킹**과 **맞춤 추천**(랜딩페이지 두 코너).
카카오 로컬 API 검색, 구글 Places API (New) 리뷰 조회, Gemini 분석,
Supabase 이메일 로그인과 `saved_places` 저장이 붙었다.

**저장은 이제 계정에 묶여 있다.** 기기를 옮겨도 같은 계정이면 목록이 따라오고,
다른 계정으로 로그인하면 그 계정의 목록이 나온다 — RLS가 그렇게 돌려주기 때문이다.
`localStorage` 저장(`storage.js`)은 **지웠다.** 되살리지 않는다 (⑳).

**Supabase는 이제 auth 전용이 아니다 — auth + `saved_places` 맛집 저장이다.**
테이블이 생겼으므로 ⑯의 「RLS를 켜지 않으면 뚫린다」는 가정이 아니라 실전 조건이다.

체험 데모의 `PLACES`는 여전히 하드코딩이고 담기 목록과 **연결되어 있지 않다.**
「담아둔 맛집 중에서 골라준다」는 핵심 가치를 실제 데이터로 잇는 것이 다음 단계다 —
`saved_places`가 그 재료를 이제 들고 있고, **맞춤 추천이 그 재료를 처음으로 읽기 시작했다.**

**추천 두 코너는 성격이 다르다.** 인기 랭킹은 **모두의 집계**라 DB 함수가 세어주고(㉓),
맞춤 추천은 **내 것만** 보면 되므로 RLS가 걸러준 목록을 그대로 쓴다.
둘을 한 창구로 합치려 하지 말 것 — 합치는 순간 「내 것만」과 「모두의 것」의 경계가 흐려진다.

**현재 `saved_places`에는 더미 100건이 들어 있다**(계정 12개). 랭킹을 눈으로 보려고 넣은 것이고,
`supabase-seed-dummy.sql`에 적힌 한 줄로 계정째 지울 수 있다. **실서비스 전에 지운다.**

**Gemini API 키는 여전히 클라이언트에 넣지 않는다** (PRD 8장) — `api/analyze.js` 프록시가 그 이유다.
Supabase publishable 키는 성격이 달라 클라이언트에 있다. 둘을 같은 규칙으로 묶지 않는다 (⑯).

## 반응형

- 모바일 (375)
- 태블릿 (768)
- 데스크탑 (1440)
  으로 브레이크포인트 설정
