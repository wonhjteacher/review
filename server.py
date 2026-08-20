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
`/api/search` 한 경로만 가로채 카카오 로컬 API로 중계한다.

API 키는 환경변수 또는 `.env`에서만 읽는다. 코드·HTML·JS 어디에도 키를 넣지 않는다 (PRD 8장).
프록시가 존재하는 이유가 바로 이것이다 — 브라우저로 키를 내려보내지 않기 위해서다.
`.env`는 `.gitignore`에 있으므로 커밋되지 않는다.

표준 라이브러리만 쓴다. 이 프로젝트엔 패키지 매니저가 없다 —
`python-dotenv` 대신 아래 `load_env_file()`이 같은 일을 20줄로 한다.
"""

import json
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

# 프론트가 쓰는 필드만 추려 내려보낸다. 카카오 원본을 그대로 흘리지 않는다.
PLACE_FIELDS = (
    "id",
    "place_name",
    "category_name",
    "road_address_name",
    "address_name",
    "distance",
    "place_url",
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
        if self.is_hidden_path(path):
            # .git, .claude 같은 숨김 경로는 내려보내지 않는다.
            self.send_error(404, "Not Found")
            return
        super().do_GET()

    def do_HEAD(self):
        path = urllib.parse.urlparse(self.path).path
        if path == "/api/search":
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

    handler = partial(AppHandler, directory=ROOT)
    with ThreadingHTTPServer(("127.0.0.1", port), handler) as httpd:
        print("http://localhost:%d 에서 실행 중입니다. 종료는 Ctrl+C." % port, file=sys.stderr)
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n종료합니다.", file=sys.stderr)


if __name__ == "__main__":
    main()
