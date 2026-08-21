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
두 경로만 가로채 외부 API로 중계한다.

    /api/search    카카오 로컬 API  (KAKAO_REST_API_KEY)
    /api/reviews   구글 Places API (New) 리뷰  (GOOGLE_PLACES_KEY)

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
import ssl
import sys
import urllib.error
import urllib.parse
import urllib.request
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))
ENV_FILE = os.path.join(ROOT, ".env")

KAKAO_ENDPOINT = "https://dapi.kakao.com/v2/local/search/keyword.json"
KAKAO_TIMEOUT = 5  # 초

GOOGLE_ENDPOINT = "https://places.googleapis.com/v1/places:searchText"
GOOGLE_TIMEOUT = 6  # 초 — 검색보다 조금 넉넉하다. 리뷰 본문까지 실려 온다

# 요청 필드가 늘어나면 과금 등급이 함께 올라간다 (Places API는 FieldMask 단위 과금이다).
# **이 5개에서 늘리지 않는다.** searchText는 응답이 places[]이므로 `places.` 접두사가 필요하다.
GOOGLE_FIELD_MASK = ",".join(
    (
        "places.displayName",
        "places.rating",
        "places.userRatingCount",
        "places.reviews",
        "places.googleMapsUri",
    )
)

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
        if self.is_hidden_path(path):
            # .git, .claude 같은 숨김 경로는 내려보내지 않는다.
            self.send_error(404, "Not Found")
            return
        super().do_GET()

    def do_HEAD(self):
        path = urllib.parse.urlparse(self.path).path
        if path in ("/api/search", "/api/reviews"):
            # 본문 없이 상태만 확인하는 경우. 프록시는 GET으로만 쓴다.
            self.send_response(405)
            self.send_header("Allow", "GET")
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        if self.is_hidden_path(path):
            self.send_error(404, "Not Found")
            return
        super().do_HEAD()

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

        return 200, {"ok": True, "place": shape_place(place)}

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


def shape_place(place):
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
    }


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
