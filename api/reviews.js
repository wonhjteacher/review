/**
 * /api/reviews — 구글 Places API (New) 리뷰 프록시 (Vercel 서버리스 함수)
 *
 * 로컬 개발용 `server.py`의 handle_reviews()와 **같은 계약을 지킨다.**
 * 사양은 `UI-CONTRACT.md`「/api/reviews 응답 봉투」다. 한쪽만 고치지 않는다.
 *
 * API 키는 Vercel 환경변수 GOOGLE_PLACES_KEY에서만 읽는다.
 * 코드에 키를 넣지 않는다 (PRD 8장) — 이 저장소는 공개다.
 *
 * 런타임: Vercel Node.js (18+). 전역 fetch·AbortController를 쓰므로 의존성이 없다.
 * CommonJS로 쓴 이유는 package.json 없이 동작시키기 위해서다 — api/search.js와 같다.
 */

const GOOGLE_ENDPOINT = "https://places.googleapis.com/v1/places:searchText";
const GOOGLE_TIMEOUT = 6000; // ms — 검색(5s)보다 조금 넉넉하다. 리뷰 본문까지 실려 온다

/**
 * 요청 필드가 늘어나면 과금 등급이 함께 올라간다 (Places API는 FieldMask 단위 과금이다).
 * **이 5개에서 늘리지 않는다.** searchText는 응답이 `places[]`이므로 `places.` 접두사가 필요하다.
 *
 * 지금 등급을 올리는 필드는 `reviews` 하나다. 나머지 넷은 낮은 등급이므로
 * 리뷰를 빼면 요금이 내려간다 — 리뷰가 이 기능의 목적이라 지금은 감수한다.
 */
const FIELD_MASK = [
  "places.displayName",
  "places.rating",
  "places.userRatingCount",
  "places.reviews",
  "places.googleMapsUri",
].join(",");

/**
 * 오매칭 방지. 이름이 같은 가게가 전국에 있으므로 카카오 좌표 반경 안으로 가둔다.
 *
 * **`locationBias`가 아니라 `locationRestriction`이다. 되돌리지 말 것.**
 * 이름 그대로 bias는 '선호'일 뿐 반경 밖 결과를 배제하지 않는다. 실측으로 확인했다 —
 * 부산에만 있는 `해운대암소갈비집`을 서울 성수동 좌표로 조회했더니
 * bias는 부산 가게를 그대로 돌려줬고(오매칭), restriction은 0건을 돌려줬다.
 *
 * **도형은 rectangle이어야 한다.** Text Search의 locationRestriction은 circle을 받지 않는다
 * (`Unknown name "circle"` 400). circle을 받는 것은 locationBias 쪽이다.
 * 그래서 반경을 위경도 박스로 바꿔서 넣는다.
 *
 * **둘을 함께 넣을 수 없다** — 구글이 400으로 거절한다
 * (`Location_restriction and location_bias cannot be set at the same time`).
 *
 * 대가: 박스가 원보다 넓어 모서리는 약 212m까지 늘어나고, 반대로 카카오와 구글의
 * 좌표가 이 반경 이상 어긋난 가게는 '못 찾음'이 된다.
 * **틀린 가게의 리뷰를 보여주는 것보다 못 찾았다고 말하는 편이 낫다는 판단이다.**
 * 못 찾는 가게가 잦으면 이 값만 키운다.
 */
const SEARCH_RADIUS_M = 150;
const M_PER_DEG_LAT = 111320;   // 위도 1도의 대략적인 거리

function errorBody(code, message) {
  return { ok: false, error: { code, message } };
}

function sendJson(res, status, payload) {
  res.status(status);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.send(JSON.stringify(payload));
}

function googleHttpMessage(status) {
  if (status === 400) return "리뷰 조회 조건을 확인해 주세요";
  if (status === 401 || status === 403) return "리뷰 서버 인증에 문제가 있어요";
  if (status === 429) return "리뷰 요청이 많아요. 잠시 뒤에 다시 해주세요";
  if (status >= 400 && status < 500) return "리뷰를 불러오지 못했어요";
  return "리뷰 서버가 잠시 불안정해요. 잠시 뒤에 다시 해주세요";
}

/**
 * 카카오는 좌표를 문자열로 준다. 숫자로 바꾸고 범위까지 확인한다.
 * x가 경도(longitude), y가 위도(latitude)다 — **순서를 뒤집기 쉽다.**
 * 뒤집으면 에러가 아니라 지구 반대편을 가리키므로 조용히 not_found가 된다.
 */
function toCoords(rawX, rawY) {
  const sx = String(rawX ?? "").trim();
  const sy = String(rawY ?? "").trim();

  /* 빈 문자열을 먼저 걸러낸다. Number("")는 NaN이 아니라 **0**이다.
     이 줄이 없으면 좌표가 아예 없는 요청이 위도 0·경도 0(기니만 앞바다)으로
     통과해, 에러 대신 조용히 not_found가 된다.
     파이썬 쪽은 float("")가 ValueError를 내므로 이 함정이 없다 —
     그래서 두 구현을 나란히 태워보지 않으면 드러나지 않는다. */
  if (!sx || !sy) return null;

  const lng = Number(sx);
  const lat = Number(sy);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { latitude: lat, longitude: lng };
}

/** 반경(m)을 구글이 받는 위경도 박스로 바꾼다. rectangle만 받기 때문이다. */
function boundingBox(center) {
  const dLat = SEARCH_RADIUS_M / M_PER_DEG_LAT;
  /* 위도가 높아질수록 경도 1도의 실제 거리가 줄어든다.
     극지방에서 cos이 0으로 수렴해 dLng가 발산하는 것을 막으려고 바닥을 깐다.
     한국 위도에서는 걸릴 일이 없지만, 좌표가 어디서 오는지는 이 함수가 알 수 없다. */
  const cos = Math.max(Math.cos((center.latitude * Math.PI) / 180), 0.01);
  const dLng = SEARCH_RADIUS_M / (M_PER_DEG_LAT * cos);
  const clampLat = (v) => Math.max(-90, Math.min(90, v));
  const clampLng = (v) => Math.max(-180, Math.min(180, v));
  return {
    low:  { latitude: clampLat(center.latitude - dLat), longitude: clampLng(center.longitude - dLng) },
    high: { latitude: clampLat(center.latitude + dLat), longitude: clampLng(center.longitude + dLng) },
  };
}

function textOf(value) {
  // displayName·text는 { text, languageCode } 꼴로 온다. 문자열로 오는 경우도 받아준다.
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && typeof value.text === "string") return value.text;
  return "";
}

/** 구글 원본을 프론트가 쓰는 모양으로 눕힌다. 원본을 그대로 흘리지 않는다. */
function shapeReview(review) {
  if (!review || typeof review !== "object") return null;
  const author = review.authorAttribution || {};
  // text는 번역본, originalText는 작성 언어 원문이다. 번역본을 우선한다.
  const body = textOf(review.text) || textOf(review.originalText);
  if (!body) return null;
  return {
    author: textOf(author.displayName) || "구글 이용자",
    rating: typeof review.rating === "number" ? review.rating : null,
    text: body,
    relative_time: String(review.relativePublishTimeDescription || ""),
  };
}

function shapePlace(place) {
  const reviews = Array.isArray(place.reviews)
    ? place.reviews.map(shapeReview).filter(Boolean)
    : [];
  return {
    name: textOf(place.displayName),
    rating: typeof place.rating === "number" ? place.rating : null,
    user_rating_count: typeof place.userRatingCount === "number" ? place.userRatingCount : 0,
    google_maps_uri: typeof place.googleMapsUri === "string" ? place.googleMapsUri : "",
    reviews,
  };
}

module.exports = async function handler(req, res) {
  // 프록시는 GET으로만 쓴다. 구글로 나가는 요청만 POST다.
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return sendJson(res, 405, errorBody("method_not_allowed", "지원하지 않는 요청이에요"));
  }

  const params = req.query || {};
  const first = (v) => (Array.isArray(v) ? v[0] : v) ?? "";

  const name = String(first(params.name)).trim();
  if (!name) {
    return sendJson(res, 400, errorBody("empty_query", "가게 이름이 없어요"));
  }

  const center = toCoords(first(params.x), first(params.y));
  if (!center) {
    return sendJson(res, 400, errorBody("bad_coords", "가게 위치를 알 수 없어요"));
  }

  const apiKey = String(process.env.GOOGLE_PLACES_KEY || "").trim();
  if (!apiKey) {
    return sendJson(res, 503, errorBody("no_api_key", "리뷰 서버 설정이 아직 안 됐어요"));
  }

  const body = {
    textQuery: name,
    // 반경 밖은 아예 후보에서 빠진다. 이름만으로 전국을 뒤지지 않게 하는 장치다.
    locationRestriction: { rectangle: boundingBox(center) },
    maxResultCount: 1,
    // FieldMask가 아니라 요청 본문 필드다 — 과금 등급에 영향을 주지 않는다.
    // 한국어 리뷰와 "3개월 전" 같은 한국어 시점 문구를 받기 위한 것이다.
    languageCode: "ko",
    regionCode: "KR",
  };

  // 타임아웃은 fetch가 스스로 걸지 않으므로 AbortController로 건다.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GOOGLE_TIMEOUT);

  let response;
  try {
    response = await fetch(GOOGLE_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // 신버전 방식이다. URL에 ?key= 를 붙이는 구버전으로 돌아가지 않는다.
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": FIELD_MASK,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    // 사용자에게 보이는 문구는 그대로 두고, 원인만 서버 로그에서 구분한다.
    if (err && err.name === "AbortError") {
      console.error("google timeout");
      return sendJson(res, 504,
        errorBody("upstream_timeout", "리뷰를 불러오는 데 오래 걸려서 멈췄어요. 잠시 뒤에 다시 해주세요"));
    }
    console.error("google fetch 실패:", err && err.message);
    return sendJson(res, 502, errorBody("upstream_unreachable", "리뷰 서버에 연결하지 못했어요"));
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    // 키·FieldMask 문제는 전부 여기로 떨어진다. 본문에 원인이 적혀 있으므로 로그에 남긴다.
    console.error("google HTTP", response.status, await response.text().catch(() => ""));
    return sendJson(res, 502, errorBody("upstream_http", googleHttpMessage(response.status)));
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    console.error("google 응답을 JSON으로 읽지 못함");
    return sendJson(res, 502, errorBody("upstream_bad_json", "리뷰를 읽지 못했어요"));
  }

  // 결과가 없으면 구글은 places 배열이 아니라 **빈 객체 {}** 를 준다. 둘 다 받아준다.
  const places = Array.isArray(payload.places) ? payload.places : [];
  const place = places.find((p) => p && typeof p === "object");
  if (!place) {
    return sendJson(res, 404, errorBody("not_found", "구글 리뷰를 찾지 못했어요"));
  }

  return sendJson(res, 200, { ok: true, place: shapePlace(place) });
};
