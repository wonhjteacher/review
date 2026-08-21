/**
 * /api/search — 카카오 로컬 API 프록시 (Vercel 서버리스 함수)
 *
 * 로컬 개발용 `server.py`의 handle_search()와 **같은 계약을 지킨다.**
 * 응답 형태·에러 코드·상태 코드의 사양은 `UI-CONTRACT.md`
 * 「/api/search 응답 봉투」 절이다. 한쪽만 고치지 않는다.
 *
 * API 키는 Vercel 환경변수 KAKAO_REST_API_KEY에서만 읽는다.
 * 코드에 키를 넣지 않는다 (PRD 8장) — 이 저장소는 공개다.
 *
 * 런타임: Vercel Node.js (18+). 전역 fetch·AbortController를 쓰므로 의존성이 없다.
 * CommonJS로 쓴 이유는 package.json 없이 동작시키기 위해서다.
 */

const KAKAO_ENDPOINT = "https://dapi.kakao.com/v2/local/search/keyword.json";
const KAKAO_TIMEOUT = 5000; // ms

// 프론트가 쓰는 필드만 추려 내려보낸다. 카카오 원본을 그대로 흘리지 않는다.
// x(경도)·y(위도)는 /api/reviews가 locationBias로 쓴다 — 좌표가 없으면
// 같은 이름의 다른 지역 가게 리뷰가 붙는다 (UI-CONTRACT 「/api/search 응답 봉투」).
const PLACE_FIELDS = [
  "id",
  "place_name",
  "category_name",
  "road_address_name",
  "address_name",
  "distance",
  "place_url",
  "x",
  "y",
];

// 카카오 size/page 허용 범위 (문서 기준)
const SIZE_MIN = 1, SIZE_MAX = 15, SIZE_DEFAULT = 10;
const PAGE_MIN = 1, PAGE_MAX = 45, PAGE_DEFAULT = 1;

const ALLOWED_CATEGORY_CODES = ["FD6", "CE7"];

function errorBody(code, message) {
  return { ok: false, error: { code, message } };
}

function clampInt(raw, low, high, fallback) {
  const value = parseInt(String(raw ?? "").trim(), 10);
  if (Number.isNaN(value)) return fallback;
  return Math.max(low, Math.min(high, value));
}

function pickFields(doc) {
  const out = {};
  for (const key of PLACE_FIELDS) out[key] = doc[key] ?? "";
  return out;
}

function kakaoHttpMessage(status) {
  if (status === 401 || status === 403) return "검색 서버 인증에 문제가 있어요";
  if (status === 429) return "검색 요청이 많아요. 잠시 뒤에 다시 해주세요";
  if (status >= 400 && status < 500) return "검색 조건을 확인해 주세요";
  return "검색 서버가 잠시 불안정해요. 잠시 뒤에 다시 해주세요";
}

function sendJson(res, status, payload) {
  res.status(status);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.send(JSON.stringify(payload));
}

module.exports = async function handler(req, res) {
  // 프록시는 GET으로만 쓴다.
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return sendJson(res, 405, errorBody("method_not_allowed", "지원하지 않는 요청이에요"));
  }

  const params = req.query || {};
  const first = (v) => (Array.isArray(v) ? v[0] : v) ?? "";

  const query = String(first(params.query)).trim();
  if (!query) {
    // 검증 실패는 카카오를 부르기 전에 즉시 돌려준다.
    return sendJson(res, 400, errorBody("empty_query", "검색어를 입력해 주세요"));
  }

  const apiKey = String(process.env.KAKAO_REST_API_KEY || "").trim();
  if (!apiKey) {
    return sendJson(res, 503, errorBody("no_api_key", "검색 서버 설정이 아직 안 됐어요"));
  }

  const upstream = new URLSearchParams({
    query,
    size: String(clampInt(first(params.size), SIZE_MIN, SIZE_MAX, SIZE_DEFAULT)),
    page: String(clampInt(first(params.page), PAGE_MIN, PAGE_MAX, PAGE_DEFAULT)),
  });

  const code = String(first(params.category_group_code)).trim().toUpperCase();
  if (ALLOWED_CATEGORY_CODES.includes(code)) {
    upstream.set("category_group_code", code);
  }
  // 목록에 없는 코드는 조용히 무시한다 — 전체 검색으로 떨어진다.

  // x·y가 오면 카카오가 distance를 채워준다. 없으면 distance 자체가 내려오지 않는다.
  for (const coord of ["x", "y"]) {
    const value = String(first(params[coord])).trim();
    if (value) upstream.set(coord, value);
  }

  // 타임아웃은 fetch가 스스로 걸지 않으므로 AbortController로 건다.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), KAKAO_TIMEOUT);

  let response;
  try {
    response = await fetch(`${KAKAO_ENDPOINT}?${upstream.toString()}`, {
      headers: { Authorization: `KakaoAK ${apiKey}` },
      signal: controller.signal,
    });
  } catch (err) {
    // 사용자에게 보이는 문구는 그대로 두고, 원인만 서버 로그에서 구분한다.
    if (err && err.name === "AbortError") {
      console.error("kakao timeout");
      return sendJson(res, 504,
        errorBody("upstream_timeout", "검색이 오래 걸려서 멈췄어요. 잠시 뒤에 다시 해주세요"));
    }
    console.error("kakao fetch 실패:", err && err.message);
    return sendJson(res, 502,
      errorBody("upstream_unreachable", "검색 서버에 연결하지 못했어요"));
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    console.error("kakao HTTP", response.status);
    return sendJson(res, 502, errorBody("upstream_http", kakaoHttpMessage(response.status)));
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    console.error("kakao 응답을 JSON으로 읽지 못함");
    return sendJson(res, 502, errorBody("upstream_bad_json", "검색 결과를 읽지 못했어요"));
  }

  if (!Array.isArray(payload.documents)) {
    return sendJson(res, 502, errorBody("upstream_bad_json", "검색 결과를 읽지 못했어요"));
  }

  const meta = payload.meta || {};
  return sendJson(res, 200, {
    ok: true,
    places: payload.documents.filter((d) => d && typeof d === "object").map(pickFields),
    is_end: Boolean(meta.is_end ?? true),
    total_count: meta.total_count ?? 0,
  });
};
