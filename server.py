#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""오늘은 여기 — 정적 파일 서버 + 카카오 로컬 API 프록시

실행법 — 둘 중 아무거나.

    # 1) .env 파일에 키를 적어두고 (권장)
    python3 server.py

    # 2) 그때그때 환경변수로
    KAKAO_REST_API_KEY=발급받은_REST_API_키 python3 server.py

    # 포트를 바꾸고 싶을 때
    PORT=8080 python3 server.py

기존 `python3 -m http.server 8000`을 대체한다. 정적 파일은 그대로 서빙하고
세 경로만 가로채 외부 API로 중계한다.

    /api/search    카카오 로컬 API  (KAKAO_REST_API_KEY)           GET
    /api/reviews   구글 Places API (New) 리뷰  (GOOGLE_PLACES_KEY)  GET
    /api/analyze   구글 Gemini 리뷰 분석  (GEMINI_API_KEY)          POST

키가 없는 쪽은 그 경로만 503을 돌려주고, 나머지는 정상 동작한다.

API 키는 환경변수 또는 `.env`에서만 읽는다. 코드·HTML·JS 어디에도 키를 넣지 않는다 (PRD 8장).
프록시가 존재하는 이유가 바로 이것이다 — 브라우저로 키를 내려보내지 않기 위해서다.
`.env`는 `.gitignore`에 있으므로 커밋되지 않는다.

표준 라이브러리만 쓴다. 이 프로젝트엔 패키지 매니저가 없다 —
`python-dotenv` 대신 아래 `load_env_file()`이 같은 일을 20줄로 한다.
"""

import json
import math
import os
import re
import ssl
import sys
import urllib.error
import urllib.parse
import urllib.request
# 사진 3장을 동시에 해석하기 위한 것이다. 차례로 하면 지연이 3배가 된다.
# 표준 라이브러리라 `pip install` 금지 규칙에 걸리지 않는다.
from concurrent.futures import ThreadPoolExecutor
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))
ENV_FILE = os.path.join(ROOT, ".env")

KAKAO_ENDPOINT = "https://dapi.kakao.com/v2/local/search/keyword.json"
KAKAO_TIMEOUT = 5  # 초

GOOGLE_ENDPOINT = "https://places.googleapis.com/v1/places:searchText"
GOOGLE_TIMEOUT = 6  # 초 — 검색보다 조금 넉넉하다. 리뷰 본문까지 실려 온다

# 요청 필드가 늘어나면 과금 등급이 함께 올라간다 (Places API는 FieldMask 단위 과금이다).
# **이 6개에서 늘리지 않는다.** searchText는 응답이 places[]이므로 `places.` 접두사가 필요하다.
#
# 등급은 요청 필드 중 **가장 높은 것 하나**로 정해진다. 지금 그것은 reviews(Enterprise)이고
# photos는 그 아래(Pro)라서 얹어도 검색 요금이 오르지 않는다.
# **reviews를 빼는 날 이 전제가 뒤집힌다** — 그때는 photos가 등급을 떠받친다.
GOOGLE_FIELD_MASK = ",".join(
    (
        "places.displayName",
        "places.rating",
        "places.userRatingCount",
        "places.reviews",
        "places.googleMapsUri",
        "places.photos",
    )
)

# 사진은 검색과 **별개의 SKU**이고 1장당 1건으로 매겨진다 (무료 월 1만 장).
# **가게당 3장을 넘기지 않는다.** 화면(save.js)도 같은 수로 한 번 더 자른다 —
# 비용이 걸린 제한을 한 곳에서만 지키면 그 한 곳이 뚫렸을 때 아무도 못 막는다.
MAX_PHOTOS = 3
PHOTO_MAX_WIDTH = 800  # 원본은 4800px까지 온다. 화면에 그만한 것이 필요 없다
PHOTO_TIMEOUT = 4  # 초 — 3장을 동시에 부르므로 이 값이 그대로 사진 단계의 상한이다

PHOTO_MEDIA_BASE = "https://places.googleapis.com/v1/"

# 사진 이름은 URL 경로에 그대로 들어간다. 남이 준 문자열이므로 모양을 먼저 확인한다.
# `/`가 살아 있어야 해서 quote()로 감쌀 수 없다 — 대신 허용 문자만 통과시킨다.
# 실측한 이름은 `places/ChIJ…/photos/AVoNoXQ…` 꼴로 영숫자·`-`·`_`뿐이다.
PHOTO_NAME_RE = re.compile(r"^places/[A-Za-z0-9_-]+/photos/[A-Za-z0-9_-]+$")

# 오매칭 방지. 이름이 같은 가게가 전국에 있으므로 카카오 좌표 반경 안으로 가둔다.
#
# **locationBias가 아니라 locationRestriction이다. 되돌리지 말 것.**
# 이름 그대로 bias는 '선호'일 뿐 반경 밖 결과를 배제하지 않는다. 실측으로 확인했다 —
# 부산에만 있는 `해운대암소갈비집`을 서울 성수동 좌표로 조회했더니
# bias는 부산 가게를 그대로 돌려줬고(오매칭), restriction은 0건을 돌려줬다.
#
# **도형은 rectangle이어야 한다.** Text Search의 locationRestriction은 circle을 받지 않는다
# (`Unknown name "circle"` 400). circle을 받는 것은 locationBias 쪽이다.
# **둘을 함께 넣을 수도 없다** — 구글이 400으로 거절한다.
#
# 대가: 박스가 원보다 넓어 모서리는 약 212m까지 늘어나고, 반대로 카카오와 구글의
# 좌표가 이 반경 이상 어긋난 가게는 '못 찾음'이 된다.
# 틀린 가게의 리뷰를 보여주는 것보다 못 찾았다고 말하는 편이 낫다는 판단이다.
SEARCH_RADIUS_M = 150
M_PER_DEG_LAT = 111320  # 위도 1도의 대략적인 거리

# --- Gemini 리뷰 분석 -------------------------------------------------
#
# `api/analyze.js`와 **같은 계약을 지킨다.** 사양은 UI-CONTRACT.md
# 「/api/analyze 요청·응답 봉투」다. 아래 상수는 전부 그쪽과 값이 같아야 한다.
#
# **모델명을 환경변수로 덮어쓸 수 있게 둔 것은 실수가 아니라 대비다.**
# `gemini-2.0-flash`는 이미 종료됐다. 종료된 모델을 부르면 404 NOT_FOUND가 나는데
# 화면에는 `분석 결과를 읽지 못했어요`만 떠서 원인이 드러나지 않는다.
# 다음 종료 때는 코드가 아니라 GEMINI_MODEL만 바꾼다. 기본값은 두 구현에서 같이 올린다.
GEMINI_MODEL = (os.environ.get("GEMINI_MODEL") or "gemini-3.5-flash").strip()

# **generateContent를 쓴다. 새 interactions 쪽이 아니다.**
# 이유는 api/analyze.js 상단 주석에 적어뒀다 — 최신인 것보다 정확한 것을 고른다.
GEMINI_ENDPOINT = (
    "https://generativelanguage.googleapis.com/v1beta/models/"
    + urllib.parse.quote(GEMINI_MODEL, safe="")
    + ":generateContent"
)

# 배포 함수의 상한 안쪽이다 — vercel.json이 maxDuration을 30초로 고정한다.
# 플랫폼이 먼저 끊으면 우리 봉투가 아니라 Vercel의 불투명한 에러 페이지가 내려간다.
#
# 8초였다가 20초로 올렸다. 실측에서 gemini-3.5-flash가 실제 payload로
# 6.7 / 9.2 / 15.9 / 16.0초를 찍었다 — 8초면 성공 응답 대부분을 우리 손으로 버렸다.
# thinking 토큰을 많이 쓰는 모델일수록 느리다. 모델을 바꾸면 이 값을 다시 잰다.
# 값을 올릴 때는 vercel.json과 api/analyze.js를 함께 본다.
GEMINI_TIMEOUT = 20  # 초

# 서버가 잘라내는 상한. api/analyze.js와 같은 값이어야 한다.
MAX_REVIEWS = 5
MAX_REVIEW_CHARS = 1200
MAX_TOTAL_CHARS = 8000
MAX_BODY_BYTES = 32 * 1024

# 화면이 쓰는 상한.
MAX_KEYWORDS = 15
MAX_WORD_CHARS = 20
MAX_SUMMARY_CHARS = 120

TONES = ("positive", "neutral", "negative")

# **AI가 쓴 문장이 화면에 그대로 올라간다.**
# 그래서 DESIGN 7장의 카피 규칙을 프롬프트 안에 심어둔다.
# 넣지 않으면 나머지 화면은 `~해요`체인데 총평 한 줄만 톤이 어긋난다.
GEMINI_SYSTEM_PROMPT = "\n".join(
    (
        "너는 한국 음식점 리뷰를 분석하는 도구다. 주어진 리뷰만 근거로 삼고, 없는 내용을 지어내지 않는다.",
        "",
        "① sentiment — 각 리뷰를 positive/neutral/negative 중 하나로 분류하고 개수를 센다.",
        "   세 수의 합은 반드시 입력된 리뷰 개수와 같아야 한다.",
        "",
        "② keywords — 리뷰에 자주 나오는 핵심 단어를 8~15개 뽑는다.",
        "   음식 이름·맛·분위기·서비스 위주로 고른다.",
        "   한국어 명사 6자 이내. 가게 이름·지역명·`정말`·`매우` 같은 정도부사는 제외한다.",
        "   weight는 그 단어가 리뷰 전체에서 얼마나 중요한지 1~10.",
        "   tone은 그 단어가 쓰인 맥락이 좋으면 positive, 나쁘면 negative, 중립이면 neutral.",
        "",
        "③ summary — 이 가게 리뷰를 한 문장으로 요약한다.",
        "   60자 이내. `~해요`체 존댓말. 느낌표를 쓰지 않는다.",
        "   `최고의`·`완벽한`·`혁신적인` 같은 과장 표현을 쓰지 않는다.",
        "",
        "JSON 외에 어떤 텍스트도 쓰지 않는다.",
    )
)

# 형식 강제의 **실제 장치**다. 프롬프트의 「JSON으로만 답하라」는 보조일 뿐이다.
# responseSchema는 모델의 디코딩 자체를 스키마에 묶어 형식 위반을 구조적으로 불가능하게 만든다.
#
# type이 대문자인 것은 이것이 JSON Schema가 아니라 구글의 OpenAPI Schema 서브셋이기 때문이다.
# minItems/maxItems는 **넣지 않는다** — 지원 여부가 문서마다 갈리고, 모르는 필드를 보내면
# Gemini가 400으로 거절한다. 개수는 프롬프트로 요청하고 shape_analysis가 잘라낸다.
GEMINI_RESPONSE_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "sentiment": {
            "type": "OBJECT",
            "properties": {
                "positive": {"type": "INTEGER"},
                "neutral": {"type": "INTEGER"},
                "negative": {"type": "INTEGER"},
            },
            "required": ["positive", "neutral", "negative"],
        },
        "keywords": {
            "type": "ARRAY",
            "items": {
                "type": "OBJECT",
                "properties": {
                    "word": {"type": "STRING"},
                    "weight": {"type": "INTEGER"},
                    "tone": {"type": "STRING", "enum": list(TONES)},
                },
                "required": ["word", "weight", "tone"],
            },
        },
        "summary": {"type": "STRING"},
    },
    "required": ["sentiment", "keywords", "summary"],
    "propertyOrdering": ["sentiment", "keywords", "summary"],
}

# 프론트가 쓰는 필드만 추려 내려보낸다. 카카오 원본을 그대로 흘리지 않는다.
# x(경도)·y(위도)는 /api/reviews가 locationBias로 쓴다 — 좌표가 없으면
# 같은 이름의 다른 지역 가게 리뷰가 붙는다 (UI-CONTRACT 「/api/search 응답 봉투」).
PLACE_FIELDS = (
    "id",
    "place_name",
    "category_name",
    "road_address_name",
    "address_name",
    "distance",
    "place_url",
    "x",
    "y",
)

# 카카오 size/page 허용 범위 (문서 기준)
SIZE_MIN, SIZE_MAX, SIZE_DEFAULT = 1, 15, 10
PAGE_MIN, PAGE_MAX, PAGE_DEFAULT = 1, 45, 1

ALLOWED_CATEGORY_CODES = ("FD6", "CE7")


def build_ssl_context():
    """카카오는 HTTPS다. 파이썬이 CA 번들을 못 찾는 설치본이 있어 대비한다.

    python.org 프레임워크 빌드는 `Install Certificates.command`를 돌리기 전까지
    CA 번들이 비어 있어 모든 HTTPS 검증이 실패한다.
    `curl`은 되는데 파이썬만 안 되는 상태라 원인을 찾기 어렵다.
    그럴 때 macOS가 들고 있는 시스템 번들로 대신한다.

    **검증을 끄지는 않는다.** 번들을 하나도 못 찾으면 기본 컨텍스트를 그대로 쓰고,
    실패는 다른 네트워크 오류와 같이 upstream_unreachable로 정규화된다.
    """
    default_cafile = ssl.get_default_verify_paths().cafile
    if default_cafile and os.path.exists(default_cafile):
        return ssl.create_default_context()

    for path in (os.environ.get("SSL_CERT_FILE"), "/etc/ssl/cert.pem"):
        if path and os.path.exists(path):
            try:
                return ssl.create_default_context(cafile=path)
            except OSError:
                continue

    return ssl.create_default_context()


SSL_CONTEXT = build_ssl_context()


def error_body(code, message):
    """모든 실패를 같은 모양으로 정규화한다.

    프론트는 HTTP 상태를 보지 않고 `ok`만 확인하면 되므로 예외 분기가 하나로 끝난다.
    `message`는 `.search__status--error`에 그대로 노출되는 한국어 문구다.
    """
    return {"ok": False, "error": {"code": code, "message": message}}


class AppHandler(SimpleHTTPRequestHandler):
    """정적 파일 서빙 + `/api/search` 프록시."""

    def do_GET(self):
        path = urllib.parse.urlparse(self.path).path
        if path == "/api/search":
            self.handle_search()
            return
        if path == "/api/reviews":
            self.handle_reviews()
            return
        if path == "/api/analyze":
            # 이 경로만 POST다. GET으로 오면 JS 구현과 **같은 봉투**로 거절한다.
            self.send_header_allow_json(405, "POST", "method_not_allowed", "지원하지 않는 요청이에요")
            return
        if self.is_hidden_path(path):
            # .git, .claude 같은 숨김 경로는 내려보내지 않는다.
            self.send_error(404, "Not Found")
            return
        super().do_GET()

    def do_POST(self):
        """POST를 받는 경로는 `/api/analyze` 하나뿐이다.

        리뷰 본문 5개(최대 ~7KB)를 쿼리스트링에 실으면 URL 길이 한계에 걸리기 때문이다.
        나머지 경로는 정적 파일이므로 POST를 받을 이유가 없다.
        """
        path = urllib.parse.urlparse(self.path).path
        if path == "/api/analyze":
            self.handle_analyze()
            return
        if path in ("/api/search", "/api/reviews"):
            self.send_header_allow_json(405, "GET", "method_not_allowed", "지원하지 않는 요청이에요")
            return
        self.send_error(501, "Unsupported method ('POST')")

    def do_HEAD(self):
        path = urllib.parse.urlparse(self.path).path
        if path in ("/api/search", "/api/reviews", "/api/analyze"):
            # 본문 없이 상태만 확인하는 경우. 어느 쪽이든 HEAD로는 쓰지 않는다.
            self.send_response(405)
            self.send_header("Allow", "POST" if path == "/api/analyze" else "GET")
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        if self.is_hidden_path(path):
            self.send_error(404, "Not Found")
            return
        super().do_HEAD()

    def send_header_allow_json(self, status, allow, code, message):
        """Allow 헤더를 붙여 정규화된 봉투를 내려보낸다. 405 전용이다."""
        body = json.dumps(error_body(code, message), ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Allow", allow)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    @staticmethod
    def is_hidden_path(path):
        return any(part.startswith(".") for part in path.split("/") if part)

    # --- 프록시 -----------------------------------------------------

    def handle_search(self):
        params = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)

        query = (params.get("query", [""])[0] or "").strip()
        if not query:
            # 검증 실패는 카카오를 부르기 전에 즉시 돌려준다.
            self.send_json(400, error_body("empty_query", "검색어를 입력해 주세요"))
            return

        api_key = (os.environ.get("KAKAO_REST_API_KEY") or "").strip()
        if not api_key:
            self.send_json(
                503,
                error_body("no_api_key", "검색 서버 설정이 아직 안 됐어요"),
            )
            return

        upstream = {"query": query, "size": self.clamped_size(params), "page": self.clamped_page(params)}

        code = (params.get("category_group_code", [""])[0] or "").strip().upper()
        if code in ALLOWED_CATEGORY_CODES:
            upstream["category_group_code"] = code
        # 목록에 없는 코드는 조용히 무시한다 — 전체 검색으로 떨어진다.

        # x·y가 오면 카카오가 distance를 채워준다. 없으면 distance 자체가 내려오지 않는다.
        for coord in ("x", "y"):
            value = (params.get(coord, [""])[0] or "").strip()
            if value:
                upstream[coord] = value

        status, body = self.call_kakao(api_key, upstream)
        self.send_json(status, body)

    @staticmethod
    def clamped_size(params):
        return clamp_int(params.get("size", [""])[0], SIZE_MIN, SIZE_MAX, SIZE_DEFAULT)

    @staticmethod
    def clamped_page(params):
        return clamp_int(params.get("page", [""])[0], PAGE_MIN, PAGE_MAX, PAGE_DEFAULT)

    def call_kakao(self, api_key, upstream):
        """카카오 호출. 어떤 실패든 (상태코드, 정규화된 JSON) 한 쌍으로 돌려준다."""
        url = KAKAO_ENDPOINT + "?" + urllib.parse.urlencode(upstream)
        request = urllib.request.Request(
            url,
            headers={"Authorization": "KakaoAK " + api_key},
            method="GET",
        )

        try:
            with urllib.request.urlopen(request, timeout=KAKAO_TIMEOUT, context=SSL_CONTEXT) as response:
                raw = response.read()
        except urllib.error.HTTPError as exc:
            self.log_message("kakao HTTPError %s", exc.code)
            return 502, error_body("upstream_http", kakao_http_message(exc.code))
        except urllib.error.URLError as exc:
            # 사용자에게 보이는 문구는 그대로 두고, 원인만 서버 로그에서 구분한다.
            if isinstance(exc.reason, ssl.SSLCertVerificationError):
                self.log_message(
                    "kakao TLS 인증서 검증 실패 — 파이썬이 CA 번들을 못 찾습니다. "
                    "'Install Certificates.command'를 실행하거나 SSL_CERT_FILE을 지정하세요."
                )
            else:
                self.log_message("kakao URLError %s", exc.reason)
            return 502, error_body("upstream_unreachable", "검색 서버에 연결하지 못했어요")
        except TimeoutError:
            self.log_message("kakao timeout")
            return 504, error_body("upstream_timeout", "검색이 오래 걸려서 멈췄어요. 잠시 뒤에 다시 해주세요")
        except OSError as exc:
            self.log_message("kakao OSError %s", exc)
            return 502, error_body("upstream_unreachable", "검색 서버에 연결하지 못했어요")

        try:
            payload = json.loads(raw.decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            self.log_message("kakao 응답을 JSON으로 읽지 못함")
            return 502, error_body("upstream_bad_json", "검색 결과를 읽지 못했어요")

        documents = payload.get("documents")
        if not isinstance(documents, list):
            return 502, error_body("upstream_bad_json", "검색 결과를 읽지 못했어요")

        meta = payload.get("meta") or {}
        return 200, {
            "ok": True,
            "places": [pick_fields(doc) for doc in documents if isinstance(doc, dict)],
            "is_end": bool(meta.get("is_end", True)),
            "total_count": meta.get("total_count", 0),
        }

    # --- 구글 리뷰 프록시 -------------------------------------------

    def handle_reviews(self):
        """구글 Places API (New)로 가게 하나의 리뷰를 가져온다.

        `api/reviews.js`(Vercel)와 **같은 계약을 지킨다.**
        사양은 UI-CONTRACT.md 「/api/reviews 응답 봉투」다. 한쪽만 고치지 않는다.
        """
        params = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)

        name = (params.get("name", [""])[0] or "").strip()
        if not name:
            self.send_json(400, error_body("empty_query", "가게 이름이 없어요"))
            return

        center = to_coords(params.get("x", [""])[0], params.get("y", [""])[0])
        if center is None:
            self.send_json(400, error_body("bad_coords", "가게 위치를 알 수 없어요"))
            return

        api_key = (os.environ.get("GOOGLE_PLACES_KEY") or "").strip()
        if not api_key:
            self.send_json(503, error_body("no_api_key", "리뷰 서버 설정이 아직 안 됐어요"))
            return

        status, body = self.call_google(api_key, name, center)
        self.send_json(status, body)

    def call_google(self, api_key, name, center):
        """구글 호출. 어떤 실패든 (상태코드, 정규화된 JSON) 한 쌍으로 돌려준다."""
        payload = {
            "textQuery": name,
            # 반경 밖은 아예 후보에서 빠진다. 이름만으로 전국을 뒤지지 않게 하는 장치다.
            "locationRestriction": {"rectangle": bounding_box(center)},
            "maxResultCount": 1,
            # FieldMask가 아니라 요청 본문 필드다 — 과금 등급에 영향을 주지 않는다.
            # 한국어 리뷰와 "3개월 전" 같은 한국어 시점 문구를 받기 위한 것이다.
            "languageCode": "ko",
            "regionCode": "KR",
        }

        request = urllib.request.Request(
            GOOGLE_ENDPOINT,
            data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
            headers={
                "Content-Type": "application/json; charset=utf-8",
                # 신버전 방식이다. URL에 ?key= 를 붙이는 구버전으로 돌아가지 않는다.
                "X-Goog-Api-Key": api_key,
                "X-Goog-FieldMask": GOOGLE_FIELD_MASK,
            },
            method="POST",
        )

        try:
            with urllib.request.urlopen(request, timeout=GOOGLE_TIMEOUT, context=SSL_CONTEXT) as response:
                raw = response.read()
        except urllib.error.HTTPError as exc:
            # 키·FieldMask 문제는 전부 여기로 떨어진다. 본문에 원인이 적혀 있으므로 로그에 남긴다.
            detail = ""
            try:
                detail = exc.read().decode("utf-8", "replace")[:500]
            except OSError:
                pass
            self.log_message("google HTTPError %s %s", exc.code, detail)
            return 502, error_body("upstream_http", google_http_message(exc.code))
        except urllib.error.URLError as exc:
            self.log_message("google URLError %s", exc.reason)
            return 502, error_body("upstream_unreachable", "리뷰 서버에 연결하지 못했어요")
        except TimeoutError:
            self.log_message("google timeout")
            return 504, error_body(
                "upstream_timeout",
                "리뷰를 불러오는 데 오래 걸려서 멈췄어요. 잠시 뒤에 다시 해주세요",
            )
        except OSError as exc:
            self.log_message("google OSError %s", exc)
            return 502, error_body("upstream_unreachable", "리뷰 서버에 연결하지 못했어요")

        try:
            body = json.loads(raw.decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            self.log_message("google 응답을 JSON으로 읽지 못함")
            return 502, error_body("upstream_bad_json", "리뷰를 읽지 못했어요")

        # 결과가 없으면 구글은 places 배열이 아니라 **빈 객체 {}** 를 준다. 둘 다 받아준다.
        places = body.get("places")
        place = next((p for p in places if isinstance(p, dict)), None) if isinstance(places, list) else None
        if place is None:
            return 404, error_body("not_found", "구글 리뷰를 찾지 못했어요")

        # 사진 해석은 여기서만 왕복을 한 번 더 한다.
        # **실패해도 리뷰는 나간다** — resolve_photos가 어떤 경우에도 리스트를 돌려준다.
        photos = self.resolve_photos(api_key, place)

        return 200, {"ok": True, "place": shape_place(place, photos)}

    # --- 사진 -------------------------------------------------------
    #
    # 구글이 주는 것은 이미지가 아니라 이름(`places/{id}/photos/{ref}`)이다.
    # 실물 주소로 바꾸려면 키가 필요한데, **그 키를 화면에 내려보내면 안 된다** (CLAUDE.md ⑩·⑪).
    # 그래서 서버가 대신 바꿔서 **키 없이 열리는 주소만** 내보낸다.

    def resolve_photos(self, api_key, place):
        """최대 3장을 **동시에** 해석한다. 어떤 실패도 리뷰를 막지 않는다."""
        raw = place.get("photos")
        if not isinstance(raw, list):
            return []
        picked = [p for p in raw if isinstance(p, dict)][:MAX_PHOTOS]
        if not picked:
            return []

        # 차례로 하면 지연이 3배가 된다. 장수가 3으로 묶여 있어 워커도 그만큼만 만든다.
        try:
            with ThreadPoolExecutor(max_workers=len(picked)) as pool:
                results = list(pool.map(lambda p: self.resolve_photo(api_key, p), picked))
        except OSError as exc:
            # 스레드를 못 만드는 환경. 사진을 포기하고 리뷰는 그대로 내보낸다.
            self.log_message("사진 해석 실패 %s", exc)
            return []

        return [item for item in results if item]

    def resolve_photo(self, api_key, photo):
        """사진 하나를 키 없는 주소로 바꾼다. 실패하면 None."""
        name = photo.get("name")
        if not isinstance(name, str) or not PHOTO_NAME_RE.match(name):
            return None

        url = (
            PHOTO_MEDIA_BASE
            + name
            + "/media?maxWidthPx="
            + str(PHOTO_MAX_WIDTH)
            # **skipHttpRedirect가 이 기능의 핵심이다.** 빼면 구글이 이미지 바이트로
            # 302를 쏘므로, 화면에 주소를 주려면 키가 박힌 URL을 내려보내야 한다.
            + "&skipHttpRedirect=true"
        )

        request = urllib.request.Request(
            url,
            # 키는 헤더로 보낸다. URL에 ?key= 를 붙이는 구버전으로 돌아가지 않는다 (⑪).
            headers={"X-Goog-Api-Key": api_key, "Accept": "application/json"},
            method="GET",
        )

        try:
            with urllib.request.urlopen(request, timeout=PHOTO_TIMEOUT, context=SSL_CONTEXT) as response:
                raw = response.read()
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            # HTTPError도 URLError의 하위라 여기서 함께 잡힌다.
            self.log_message("google photo 실패 %s", exc)
            return None

        try:
            body = json.loads(raw.decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            self.log_message("google photo 응답을 JSON으로 읽지 못함")
            return None

        uri = body.get("photoUri")
        if not isinstance(uri, str) or not uri:
            return None

        # **내보내기 직전 마지막 확인이다.** 지금 구글이 주는 주소에는 키가 없지만,
        # 이 검사가 없으면 응답 모양이 바뀐 날 키가 조용히 화면으로 새어나간다.
        # 새는 것보다 사진 한 장을 잃는 편이 낫다.
        if api_key in uri:
            self.log_message("photoUri에 API 키가 섞여 있어 버림")
            return None

        return {"url": uri, "attribution": photo_attribution(photo)}

    # --- Gemini 리뷰 분석 -------------------------------------------

    def handle_analyze(self):
        """구글 Gemini로 리뷰 여러 개를 눌러 감정·키워드·총평을 뽑는다.

        `api/analyze.js`(Vercel)와 **같은 계약을 지킨다.**
        사양은 UI-CONTRACT.md 「/api/analyze 요청·응답 봉투」다. 한쪽만 고치지 않는다.
        """
        body = self.read_json_body()
        reviews = trim_reviews(body.get("reviews") if isinstance(body, dict) else None)
        if not reviews:
            self.send_json(400, error_body("empty_reviews", "분석할 리뷰가 없어요"))
            return

        api_key = (os.environ.get("GEMINI_API_KEY") or "").strip()
        if not api_key:
            self.send_json(503, error_body("no_api_key", "분석 서버 설정이 아직 안 됐어요"))
            return

        name = str(body.get("name") or "").strip()[:60]
        status, payload = self.call_gemini(api_key, name, reviews)
        self.send_json(status, payload)

    def read_json_body(self):
        """요청 본문을 JSON으로 읽는다. 못 읽으면 빈 dict — 호출부가 400으로 끊는다.

        Content-Length가 없거나 상한을 넘으면 읽지 않는다.
        `api/analyze.js`는 Vercel이 req.body를 파싱해주지만 이쪽은 직접 읽는다.
        **두 구현이 갈릴 수 있는 지점이라 상한(32KB)을 양쪽에 같이 둔다.**
        """
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except (TypeError, ValueError):
            return {}

        if length <= 0 or length > MAX_BODY_BYTES:
            return {}

        try:
            raw = self.rfile.read(length)
        except OSError:
            return {}

        try:
            parsed = json.loads(raw.decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            return {}

        return parsed if isinstance(parsed, dict) else {}

    def call_gemini(self, api_key, name, reviews):
        """Gemini 호출. 어떤 실패든 (상태코드, 정규화된 JSON) 한 쌍으로 돌려준다."""
        numbered = "\n".join("[%d] %s" % (i + 1, text) for i, text in enumerate(reviews))
        user_text = ("가게 이름: %s\n\n" % name if name else "") + (
            "리뷰 %d개:\n%s" % (len(reviews), numbered)
        )

        payload = {
            "systemInstruction": {"parts": [{"text": GEMINI_SYSTEM_PROMPT}]},
            "contents": [{"role": "user", "parts": [{"text": user_text}]}],
            "generationConfig": {
                # 같은 리뷰는 같은 분석이 나와야 한다. 캐시해두고 다시 보여주는 값이라 흔들리면 곤란하다.
                "temperature": 0.2,
                # 이 상한은 thinking 토큰과 나눠 쓴다. 3.x flash는 기본으로 생각을 하고,
                # 그 토큰이 여기 상한에 함께 잡힌다. 실측(리뷰 5개·키워드 10개 기준):
                #   3.7-flash  thinking 587  + 출력 160  =  747
                #   3.6-flash  thinking 1414 + 출력 173  = 1587
                #   3.5-flash  thinking 1307 + 출력 349  = 1656
                # 2048이면 최악 81%가 차서 여유가 20%도 없었고, 실제로 한 번 넘쳐 잘렸다.
                # 넘치면 JSON이 중간에서 끊겨 bad_analysis가 된다 — 에러가 아니라 그럴듯한 실패다.
                # 출력 토큰은 상한이 아니라 실제 사용량으로 과금되므로 올려도 비용이 늘지 않는다.
                # api/analyze.js와 같이 올린다.
                "maxOutputTokens": 4096,
                "responseMimeType": "application/json",
                "responseSchema": GEMINI_RESPONSE_SCHEMA,
            },
            # thinkingConfig는 넣지 않는다. 3.x 계열의 필드명을 확신할 수 없고,
            # 모르는 필드를 보내면 Gemini가 400으로 거절한다. 기본값을 쓴다.
            # 생각을 끄는 대신 위 maxOutputTokens로 여유를 준다.
        }

        request = urllib.request.Request(
            GEMINI_ENDPOINT,
            data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
            headers={
                "Content-Type": "application/json; charset=utf-8",
                # 헤더로 보낸다. ?key=는 URL이라 접근 로그·리퍼러에 키가 남는다.
                "x-goog-api-key": api_key,
            },
            method="POST",
        )

        try:
            with urllib.request.urlopen(request, timeout=GEMINI_TIMEOUT, context=SSL_CONTEXT) as response:
                raw = response.read()
        except urllib.error.HTTPError as exc:
            # 모델 종료(404)·키 문제(403)·한도(429)가 전부 여기로 떨어진다.
            # 본문에 원인이 적혀 있으므로 반드시 로그에 남긴다 — 화면 문구만으로는 구분되지 않는다.
            # 2000자를 읽는 이유: 일일 한도 판별에 쓰는 quotaId가 details[] 안에 있어
            # 500자만 잘라 보면 놓친다 (UI-CONTRACT 「/api/analyze」의 429 두 갈래).
            detail = ""
            try:
                detail = exc.read().decode("utf-8", "replace")[:2000]
            except OSError:
                pass
            self.log_message("gemini HTTPError %s %s %s", exc.code, GEMINI_MODEL, detail[:500])
            return 502, error_body("upstream_http", gemini_http_message(exc.code, detail))
        except urllib.error.URLError as exc:
            self.log_message("gemini URLError %s", exc.reason)
            return 502, error_body("upstream_unreachable", "분석 서버에 연결하지 못했어요")
        except TimeoutError:
            self.log_message("gemini timeout")
            return 504, error_body(
                "upstream_timeout",
                "분석이 오래 걸려서 멈췄어요. 잠시 뒤에 다시 해주세요",
            )
        except OSError as exc:
            self.log_message("gemini OSError %s", exc)
            return 502, error_body("upstream_unreachable", "분석 서버에 연결하지 못했어요")

        try:
            body = json.loads(raw.decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            self.log_message("gemini 응답을 JSON으로 읽지 못함")
            return 502, error_body("upstream_bad_json", "분석 결과를 읽지 못했어요")

        # 안전 필터에 걸리면 candidates가 아예 비어 온다.
        feedback = body.get("promptFeedback") if isinstance(body, dict) else None
        block_reason = feedback.get("blockReason") if isinstance(feedback, dict) else None
        if block_reason:
            self.log_message("gemini blocked: %s", block_reason)
            return 502, error_body("bad_analysis", "분석 결과를 읽지 못했어요")

        analysis = shape_analysis(parse_loose(extract_text(body)))
        if analysis is None:
            self.log_message("gemini 응답이 스키마와 다름. finishReason: %s", finish_reason(body))
            return 502, error_body("bad_analysis", "분석 결과를 읽지 못했어요")

        return 200, {"ok": True, "analysis": analysis}

    # --- 응답 -------------------------------------------------------

    def send_json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)


def load_env_file(path=ENV_FILE):
    """`.env`를 읽어 os.environ에 채운다.

    표준 라이브러리만 쓰므로 python-dotenv를 대신하는 최소 구현이다.
    `KEY=VALUE` 한 줄에 하나, `#`으로 시작하는 줄과 빈 줄은 건너뛴다.
    값을 감싼 따옴표는 벗겨낸다.

    이미 환경에 있는 값은 덮어쓰지 않는다 — 명령줄로 준 값이 파일보다 우선이다.
    파일이 없어도 조용히 넘어간다. 없는 게 정상인 상황이 있다.
    """
    try:
        with open(path, encoding="utf-8") as handle:
            lines = handle.readlines()
    except OSError:
        return

    for line in lines:
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        if key and key not in os.environ:
            os.environ[key] = value


def clamp_int(raw, low, high, fallback):
    try:
        value = int(str(raw).strip())
    except (TypeError, ValueError):
        return fallback
    return max(low, min(high, value))


def pick_fields(doc):
    return {key: doc.get(key, "") for key in PLACE_FIELDS}


def to_coords(raw_x, raw_y):
    """카카오는 좌표를 문자열로 준다. 숫자로 바꾸고 범위까지 확인한다.

    x가 경도(longitude), y가 위도(latitude)다 — **순서를 뒤집기 쉽다.**
    뒤집으면 에러가 아니라 지구 반대편을 가리키므로 조용히 not_found가 된다.
    """
    try:
        lng = float(str(raw_x or "").strip())
        lat = float(str(raw_y or "").strip())
    except (TypeError, ValueError):
        return None
    if not (-90.0 <= lat <= 90.0) or not (-180.0 <= lng <= 180.0):
        return None
    return {"latitude": lat, "longitude": lng}


def bounding_box(center):
    """반경(m)을 구글이 받는 위경도 박스로 바꾼다. rectangle만 받기 때문이다."""
    d_lat = SEARCH_RADIUS_M / M_PER_DEG_LAT
    # 위도가 높아질수록 경도 1도의 실제 거리가 줄어든다.
    # 극지방에서 cos이 0으로 수렴해 d_lng가 발산하는 것을 막으려고 바닥을 깐다.
    cos = max(math.cos(math.radians(center["latitude"])), 0.01)
    d_lng = SEARCH_RADIUS_M / (M_PER_DEG_LAT * cos)

    def clamp(value, low, high):
        return max(low, min(high, value))

    return {
        "low": {
            "latitude": clamp(center["latitude"] - d_lat, -90.0, 90.0),
            "longitude": clamp(center["longitude"] - d_lng, -180.0, 180.0),
        },
        "high": {
            "latitude": clamp(center["latitude"] + d_lat, -90.0, 90.0),
            "longitude": clamp(center["longitude"] + d_lng, -180.0, 180.0),
        },
    }


def google_text(value):
    """displayName·text는 { text, languageCode } 꼴로 온다. 문자열로 오는 경우도 받아준다."""
    if isinstance(value, str):
        return value
    if isinstance(value, dict) and isinstance(value.get("text"), str):
        return value["text"]
    return ""


def shape_review(review):
    """구글 원본을 프론트가 쓰는 모양으로 눕힌다. 원본을 그대로 흘리지 않는다."""
    if not isinstance(review, dict):
        return None
    author = review.get("authorAttribution") or {}
    # text는 번역본, originalText는 작성 언어 원문이다. 번역본을 우선한다.
    body = google_text(review.get("text")) or google_text(review.get("originalText"))
    if not body:
        return None
    rating = review.get("rating")
    return {
        "author": google_text(author.get("displayName")) or "구글 이용자",
        "rating": rating if isinstance(rating, (int, float)) and not isinstance(rating, bool) else None,
        "text": body,
        "relative_time": str(review.get("relativePublishTimeDescription") or ""),
    }


def shape_place(place, photos=None):
    raw_reviews = place.get("reviews")
    reviews = []
    if isinstance(raw_reviews, list):
        for item in raw_reviews:
            shaped = shape_review(item)
            if shaped:
                reviews.append(shaped)

    rating = place.get("rating")
    count = place.get("userRatingCount")
    uri = place.get("googleMapsUri")
    return {
        "name": google_text(place.get("displayName")),
        "rating": rating if isinstance(rating, (int, float)) and not isinstance(rating, bool) else None,
        "user_rating_count": count if isinstance(count, int) and not isinstance(count, bool) else 0,
        "google_maps_uri": uri if isinstance(uri, str) else "",
        "reviews": reviews,
        # **항상 배열이다. 사진이 없어도 null이 아니다** — 화면 쪽 분기를 하나로 유지한다.
        "photos": list(photos) if photos else [],
    }


def photo_attribution(photo):
    """구글 정책상 사진에는 제공자 표기가 따라붙어야 한다. 없으면 빈 문자열."""
    attributions = photo.get("authorAttributions")
    if not isinstance(attributions, list):
        return ""
    for item in attributions:
        if isinstance(item, dict):
            return google_text(item.get("displayName"))
    return ""


def google_http_message(status):
    if status == 400:
        return "리뷰 조회 조건을 확인해 주세요"
    if status in (401, 403):
        return "리뷰 서버 인증에 문제가 있어요"
    if status == 429:
        return "리뷰 요청이 많아요. 잠시 뒤에 다시 해주세요"
    if 400 <= status < 500:
        return "리뷰를 불러오지 못했어요"
    return "리뷰 서버가 잠시 불안정해요. 잠시 뒤에 다시 해주세요"


def kakao_http_message(status):
    if status in (401, 403):
        return "검색 서버 인증에 문제가 있어요"
    if status == 429:
        return "검색 요청이 많아요. 잠시 뒤에 다시 해주세요"
    if 400 <= status < 500:
        return "검색 조건을 확인해 주세요"
    return "검색 서버가 잠시 불안정해요. 잠시 뒤에 다시 해주세요"


def gemini_http_message(status, detail=""):
    """업스트림 상태코드를 화면 문구로 옮긴다. `api/analyze.js`의 geminiHttpMessage와 같아야 한다."""
    if status == 400:
        return "분석 요청을 처리하지 못했어요"
    if status in (401, 403):
        return "분석 서버 인증에 문제가 있어요"
    if status == 404:
        # 모델이 종료된 경우가 여기다. 화면 문구만으로는 알 수 없으니 로그를 본다 (CLAUDE.md ⑭).
        return "분석 모델을 찾지 못했어요"
    if status == 429:
        # 429는 두 가지가 겹쳐 온다 — 분당 제한은 기다리면 풀리고, 일일 한도는 안 풀린다.
        # 상태코드로는 구분되지 않으므로 본문의 quotaId를 본다.
        # 잘못 띄우면 거짓말이 된다: 일일 소진에 「잠시 뒤에 다시」는 사실이 아니다.
        if is_daily_quota(detail):
            return "오늘 분석 한도를 다 썼어요. 내일 다시 해주세요"
        return "분석 요청이 많아요. 잠시 뒤에 다시 해주세요"
    if 400 <= status < 500:
        return "리뷰를 분석하지 못했어요"
    return "분석 서버가 잠시 불안정해요. 잠시 뒤에 다시 해주세요"


def is_daily_quota(detail):
    """429 본문이 '일일' 한도 소진인지 가린다. 판별 못 하면 False — 덜 틀린 쪽으로 떨어진다.

    구글은 quotaId에 `GenerateRequestsPerDayPerProjectPerModel-FreeTier` 처럼 적어 보낸다.
    `api/analyze.js`의 isDailyQuota와 같은 규칙이어야 한다.
    """
    return "perday" in (detail or "").replace(" ", "").lower()


def trim_reviews(value):
    """리뷰 본문을 상한 안으로 자른다. 빈 목록이면 호출부가 400으로 끊는다.

    프롬프트 인젝션을 막는 장치가 아니라(그건 애초에 남의 리뷰다) 토큰과 지연을 묶는 장치다.
    """
    if not isinstance(value, list):
        return []

    out = []
    total = 0

    for item in value:
        if len(out) >= MAX_REVIEWS:
            break

        text = ("" if item is None else str(item)).strip()
        if not text:
            continue

        clipped = text[:MAX_REVIEW_CHARS]
        if total + len(clipped) > MAX_TOTAL_CHARS:
            break

        total += len(clipped)
        out.append(clipped)

    return out


def extract_text(payload):
    """응답에서 모델이 쓴 텍스트만 뽑는다.

    **`part["thought"]`가 True인 조각은 건너뛴다.** 요즘 모델은 생각 과정을 별도 part로
    실어 보내며, 그걸 같이 이어붙이면 JSON 앞에 산문이 붙어 파싱이 깨진다.
    """
    if not isinstance(payload, dict):
        return ""

    candidates = payload.get("candidates")
    if not isinstance(candidates, list) or not candidates:
        return ""

    content = candidates[0].get("content") if isinstance(candidates[0], dict) else None
    parts = content.get("parts") if isinstance(content, dict) else None
    if not isinstance(parts, list):
        return ""

    return "".join(
        part["text"]
        for part in parts
        if isinstance(part, dict) and part.get("thought") is not True and isinstance(part.get("text"), str)
    )


def parse_loose(text):
    """텍스트에서 JSON 객체를 건져낸다.

    responseSchema가 걸려 있으면 보통 그냥 파싱된다. 이 함수는 그게 지켜지지 않은 경우를
    위한 그물이다 — ```json 펜스가 붙거나 앞뒤로 한 줄 설명이 붙는 경우.
    「형식이 어긋난 답이 와도 사이트가 죽지 않게」가 이 함수의 일이다.
    """
    trimmed = ("" if text is None else str(text)).strip()
    if not trimmed:
        return None

    try:
        return json.loads(trimmed)
    except ValueError:
        pass

    start = trimmed.find("{")
    end = trimmed.rfind("}")
    if start == -1 or end <= start:
        return None

    try:
        return json.loads(trimmed[start : end + 1])
    except ValueError:
        return None


def finish_reason(payload):
    """로그용. 잘린 응답(MAX_TOKENS)인지 구분하려고 본다."""
    candidates = payload.get("candidates") if isinstance(payload, dict) else None
    if isinstance(candidates, list) and candidates and isinstance(candidates[0], dict):
        return candidates[0].get("finishReason") or ""
    return ""


# 십진수 문자열만 통과시킨다. **정규식이 여기 있는 이유가 있다.**
#
# 파이썬 float()와 JS Number()가 받아들이는 문자열의 범위가 다르다 —
# float("1_0")은 10인데 Number("1_0")은 NaN이고, Number("0x10")은 16인데
# float("0x10")은 ValueError다. 둘 다 받는 모양을 이 정규식으로 못박아 갈라질 여지를 없앤다.
DECIMAL_RE = re.compile(r"[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?")


def to_number(value):
    """숫자로 읽을 수 있으면 float, 아니면 None. **JS toNumber()와 짝이다.**

    모델이 `9` 대신 `"9"`를 내는 것은 흔한 형식 흔들림이라 받아준다.
    반대로 다음은 전부 거절한다 — None·불리언·빈 문자열·dict·list.

    불리언을 먼저 거르는 이유: 파이썬에서 `isinstance(True, int)`는 **True**라
    걸러내지 않으면 `weight: true`가 1로 통과한다. JS는 typeof로 걸러 5가 되므로 갈린다.
    """
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value) if math.isfinite(value) else None
    if not isinstance(value, str):
        return None

    text = value.strip()
    if not DECIMAL_RE.fullmatch(text):
        return None

    number = float(text)
    return number if math.isfinite(number) else None


def count_of(value):
    """0 이상 정수로 강제. 숫자로 읽히지 않으면 0이다."""
    number = to_number(value)
    if number is None or number < 0:
        return 0
    return int(math.floor(number))


def weight_of(value):
    """1~10으로 clamp.

    **숫자인지 먼저 판정하고 나서 clamp한다 — 순서를 바꾸지 않는다.**
    「숫자로 읽히지 않으면 기본값 5」를 먼저 확정해야 두 구현이 같은 값을 낸다.

    **반올림은 round()가 아니라 floor(n + 0.5)다.** 파이썬 round()는 은행가 반올림이라
    round(2.5)가 2인데 JS의 Math.round(2.5)는 3이다 — weight 2.5 하나로 두 구현이 갈린다.
    floor(n + 0.5)는 음수까지 포함해 Math.round와 정확히 같은 값을 낸다.
    """
    number = to_number(value)
    if number is None:
        return 5
    return max(1, min(10, int(math.floor(number + 0.5))))


def shape_analysis(raw):
    """**최후 방어선.** 예외를 던지지 않고 언제나 화면이 쓸 수 있는 값을 낸다.

    실패로 볼 유일한 경우는 감정 세 수가 모두 0일 때다 — 분석이 아예 없었다는 뜻이다.
    """
    if not isinstance(raw, dict):
        return None

    source = raw.get("sentiment")
    if not isinstance(source, dict):
        source = {}

    sentiment = {
        "positive": count_of(source.get("positive")),
        "neutral": count_of(source.get("neutral")),
        "negative": count_of(source.get("negative")),
    }
    if sentiment["positive"] + sentiment["neutral"] + sentiment["negative"] == 0:
        return None

    keywords = []
    seen = set()

    raw_keywords = raw.get("keywords")
    if isinstance(raw_keywords, list):
        for item in raw_keywords:
            if len(keywords) >= MAX_KEYWORDS:
                break
            if not isinstance(item, dict):
                continue

            word = item.get("word")
            word = ("" if word is None else str(word)).strip()[:MAX_WORD_CHARS]
            if not word or word in seen:
                continue

            seen.add(word)
            tone = item.get("tone")
            keywords.append(
                {
                    "word": word,
                    "weight": weight_of(item.get("weight")),
                    "tone": tone if tone in TONES else "neutral",
                }
            )

    summary = raw.get("summary")
    summary = ("" if summary is None else str(summary)).strip()[:MAX_SUMMARY_CHARS]

    # 키워드 0개·총평 빈 문자열이어도 성공으로 내보낸다.
    # 화면이 그 둘을 각각 숨기고 감정 막대만 그린다 — 통째로 실패하는 것보다 낫다.
    return {"sentiment": sentiment, "keywords": keywords, "summary": summary}


def main():
    load_env_file()

    port = clamp_int(os.environ.get("PORT"), 1, 65535, 8000)

    if not (os.environ.get("KAKAO_REST_API_KEY") or "").strip():
        print(
            "KAKAO_REST_API_KEY가 없습니다. 정적 파일은 그대로 서빙되지만\n"
            "/api/search는 설정 안내 에러만 돌려줍니다.\n"
            "  %s 파일에 KAKAO_REST_API_KEY 값을 채우거나,\n"
            "  KAKAO_REST_API_KEY=발급받은_REST_API_키 python3 server.py 로 실행하세요." % ENV_FILE,
            file=sys.stderr,
        )

    if not (os.environ.get("GOOGLE_PLACES_KEY") or "").strip():
        print(
            "GOOGLE_PLACES_KEY가 없습니다. 검색은 되지만\n"
            "/api/reviews는 설정 안내 에러만 돌려줍니다 (리뷰 패널에 안내 문구가 뜹니다).\n"
            "  %s 파일에 GOOGLE_PLACES_KEY 값을 채우세요.\n"
            "  배포(Vercel)는 대시보드 환경변수에서 따로 설정합니다." % ENV_FILE,
            file=sys.stderr,
        )

    handler = partial(AppHandler, directory=ROOT)
    with ThreadingHTTPServer(("127.0.0.1", port), handler) as httpd:
        print("http://localhost:%d 에서 실행 중입니다. 종료는 Ctrl+C." % port, file=sys.stderr)
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n종료합니다.", file=sys.stderr)


if __name__ == "__main__":
    main()
