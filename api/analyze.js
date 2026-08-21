/**
 * /api/analyze — 구글 Gemini 리뷰 분석 프록시 (Vercel 서버리스 함수)
 *
 * 로컬 개발용 `server.py`의 handle_analyze()와 **같은 계약을 지킨다.**
 * 사양은 `UI-CONTRACT.md`「/api/analyze 요청·응답 봉투」다. 한쪽만 고치지 않는다.
 *
 * API 키는 Vercel 환경변수 GEMINI_API_KEY에서만 읽는다.
 * 코드에 키를 넣지 않는다 (PRD 8장) — 이 저장소는 공개다.
 *
 * 런타임: Vercel Node.js (18+). 전역 fetch·AbortController를 쓰므로 의존성이 없다.
 * CommonJS로 쓴 이유는 package.json 없이 동작시키기 위해서다 — api/reviews.js와 같다.
 */

/**
 * **모델명을 환경변수로 덮어쓸 수 있게 둔 것은 실수가 아니라 대비다.**
 * `gemini-2.0-flash`는 이미 종료됐다. 종료된 모델을 부르면 404 NOT_FOUND가 나는데,
 * 화면에는 `분석 결과를 읽지 못했어요`만 떠서 **원인이 드러나지 않는다.**
 * 다음 종료 공지 때는 코드 배포가 아니라 Vercel 대시보드에서 GEMINI_MODEL만 바꾼다.
 * 기본값을 올릴 때는 server.py와 **같이** 올린다.
 */
const GEMINI_MODEL = String(process.env.GEMINI_MODEL || "gemini-3.5-flash").trim();

/**
 * **`generateContent`를 쓴다. 새 `interactions` 쪽이 아니다.**
 * 구글은 Interactions API를 새 권장 경로로 밀고 있지만, 공식 문서 두 페이지가
 * `response_format` 모양을 서로 다르게 적고 있어 필드명을 확신할 수 없다.
 * 반면 generateContent는 문서에 「fully supported」로 명시돼 있고 요청·응답 모양이 안정적이다.
 * 이 프로젝트엔 SDK도 빌드도 없어 손으로 쓴 fetch가 틀리면 그대로 깨진다 —
 * 최신인 것보다 **정확한 것**을 고른다. 서버 상태·툴·에이전트가 필요해지면 그때 옮긴다.
 */
const GEMINI_ENDPOINT =
  "https://generativelanguage.googleapis.com/v1beta/models/" +
  encodeURIComponent(GEMINI_MODEL) +
  ":generateContent";

/**
 * **함수 상한 안쪽**이다 — `vercel.json`이 이 함수의 maxDuration을 30s로 고정해두었다.
 * 플랫폼 기본값에 기대지 않으려는 것이다. 플랫폼이 먼저 끊으면 우리 봉투가 아니라
 * Vercel의 불투명한 에러 페이지가 내려간다. 그 전에 504 upstream_timeout을 돌려주려는 값이다.
 *
 * **8s였다가 20s로 올렸다.** 실측에서 gemini-3.5-flash가 실제 payload로
 * 6.7 / 9.2 / 15.9 / 16.0초를 찍었다 — 8s면 성공 응답 대부분을 우리 손으로 버렸다.
 * thinking 토큰을 많이 쓰는 모델일수록 느리다. 모델을 바꾸면 이 값을 다시 잰다.
 * 올릴 때는 `vercel.json`의 maxDuration과 `server.py`를 함께 본다.
 */
const GEMINI_TIMEOUT = 20000; // ms

/* 서버가 잘라내는 상한. server.py와 같은 값이어야 한다.
   프롬프트 인젝션을 막는 장치가 아니라(그건 애초에 남의 리뷰다) 토큰과 지연을 묶는 장치다. */
const MAX_REVIEWS = 5;
const MAX_REVIEW_CHARS = 1200;
const MAX_TOTAL_CHARS = 8000;
const MAX_BODY_BYTES = 32 * 1024;

/* 화면이 쓰는 상한. shapeAnalysis가 여기까지 잘라서 내보낸다. */
const MAX_KEYWORDS = 15;
const MAX_WORD_CHARS = 20;
const MAX_SUMMARY_CHARS = 120;

const TONES = ["positive", "neutral", "negative"];

/**
 * **AI가 쓴 문장이 화면에 그대로 올라간다.**
 * 그래서 DESIGN 7장의 카피 규칙을 여기 프롬프트 안에 심어둔다.
 * 넣지 않으면 나머지 화면은 `~해요`체인데 총평 한 줄만 톤이 어긋난다.
 */
const SYSTEM_PROMPT = [
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
].join("\n");

/**
 * 형식 강제의 **실제 장치**다. 프롬프트의 「JSON으로만 답하라」는 보조일 뿐이다.
 * responseSchema는 모델의 디코딩 자체를 스키마에 묶으므로 형식 위반이 구조적으로 불가능해진다.
 *
 * type은 대문자다 — 이것은 JSON Schema가 아니라 구글의 OpenAPI Schema 서브셋이다.
 * minItems/maxItems는 **넣지 않는다.** 지원 여부가 문서마다 갈리고, 모르는 필드를 보내면
 * Gemini가 400으로 거절한다. 개수는 프롬프트로 요청하고 shapeAnalysis가 잘라낸다.
 */
const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    sentiment: {
      type: "OBJECT",
      properties: {
        positive: { type: "INTEGER" },
        neutral: { type: "INTEGER" },
        negative: { type: "INTEGER" },
      },
      required: ["positive", "neutral", "negative"],
    },
    keywords: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          word: { type: "STRING" },
          weight: { type: "INTEGER" },
          tone: { type: "STRING", enum: TONES },
        },
        required: ["word", "weight", "tone"],
      },
    },
    summary: { type: "STRING" },
  },
  required: ["sentiment", "keywords", "summary"],
  propertyOrdering: ["sentiment", "keywords", "summary"],
};

function errorBody(code, message) {
  return { ok: false, error: { code, message } };
}

function sendJson(res, status, payload) {
  res.status(status);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.send(JSON.stringify(payload));
}

/* 업스트림 상태코드를 화면 문구로 옮긴다. server.py의 gemini_http_message와 같아야 한다. */
function geminiHttpMessage(status, detail) {
  if (status === 400) return "분석 요청을 처리하지 못했어요";
  if (status === 401 || status === 403) return "분석 서버 인증에 문제가 있어요";
  if (status === 404) return "분석 모델을 찾지 못했어요";
  if (status === 429) {
    /* 429는 두 가지가 겹쳐 온다 — 분당 제한은 기다리면 풀리고, 일일 한도는 안 풀린다.
       상태코드로는 구분되지 않으므로 본문의 quotaId를 본다.
       잘못 띄우면 거짓말이 된다: 일일 소진에 「잠시 뒤에 다시」는 사실이 아니다. */
    if (isDailyQuota(detail)) return "오늘 분석 한도를 다 썼어요. 내일 다시 해주세요";
    return "분석 요청이 많아요. 잠시 뒤에 다시 해주세요";
  }
  if (status >= 400 && status < 500) return "리뷰를 분석하지 못했어요";
  return "분석 서버가 잠시 불안정해요. 잠시 뒤에 다시 해주세요";
}

/* 429 본문이 '일일' 한도 소진인지 가린다. 판별 못 하면 false — 덜 틀린 쪽으로 떨어진다.
   구글은 quotaId에 `GenerateRequestsPerDayPerProjectPerModel-FreeTier` 처럼 적어 보낸다.
   server.py의 is_daily_quota와 같은 규칙이어야 한다. */
function isDailyQuota(detail) {
  return String(detail || "").replace(/ /g, "").toLowerCase().includes("perday");
}

/* Vercel은 Content-Type이 application/json이면 req.body를 객체로 파싱해준다.
   다만 그렇지 않은 경우(문자열·미파싱)도 있어 셋 다 받아준다.
   server.py는 항상 원시 바이트를 직접 읽으므로 그쪽이 진실의 기준이다. */
function readBody(req) {
  return new Promise(function (resolve) {
    if (req.body && typeof req.body === "object") return resolve(req.body);

    if (typeof req.body === "string") {
      try {
        return resolve(JSON.parse(req.body));
      } catch {
        return resolve(null);
      }
    }

    let raw = "";
    let tooBig = false;
    req.on("data", function (chunk) {
      if (tooBig) return;
      raw += chunk;
      if (raw.length > MAX_BODY_BYTES) tooBig = true;
    });
    req.on("end", function () {
      if (tooBig) return resolve(null);
      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve(null);
      }
    });
    req.on("error", function () { resolve(null); });
  });
}

/** 리뷰 본문을 상한 안으로 자른다. 빈 배열이면 호출부가 400으로 끊는다. */
function trimReviews(value) {
  if (!Array.isArray(value)) return [];

  const out = [];
  let total = 0;

  for (const item of value) {
    if (out.length >= MAX_REVIEWS) break;

    const text = String(item == null ? "" : item).trim();
    if (!text) continue;

    const clipped = text.slice(0, MAX_REVIEW_CHARS);
    if (total + clipped.length > MAX_TOTAL_CHARS) break;

    total += clipped.length;
    out.push(clipped);
  }
  return out;
}

/**
 * 응답에서 모델이 쓴 텍스트만 뽑는다.
 *
 * **`part.thought === true`인 조각은 건너뛴다.** 요즘 모델은 생각 과정을 별도 part로 실어 보내며,
 * 그걸 같이 이어붙이면 JSON 앞에 산문이 붙어 파싱이 깨진다.
 */
function extractText(payload) {
  const candidate = (payload && Array.isArray(payload.candidates) && payload.candidates[0]) || null;
  const parts = (candidate && candidate.content && candidate.content.parts) || [];
  if (!Array.isArray(parts)) return "";

  return parts
    .filter((part) => part && part.thought !== true && typeof part.text === "string")
    .map((part) => part.text)
    .join("");
}

/**
 * 텍스트에서 JSON 객체를 건져낸다.
 *
 * responseSchema가 걸려 있으면 보통 그냥 파싱된다. 이 함수는 그게 지켜지지 않은
 * 경우를 위한 그물이다 — ```json 펜스가 붙거나 앞뒤로 한 줄 설명이 붙는 경우.
 * 「형식이 어긋난 답이 와도 사이트가 죽지 않게」가 이 함수의 일이다.
 */
function parseLoose(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return null;

  try {
    return JSON.parse(trimmed);
  } catch {
    /* 아래에서 다시 시도한다 */
  }

  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end <= start) return null;

  try {
    return JSON.parse(trimmed.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * 십진수 문자열만 통과시킨다. **정규식이 여기 있는 이유가 있다.**
 *
 * `Number()`와 파이썬 `float()`가 받아들이는 문자열의 범위가 다르다 —
 * `Number("0x10")`은 16인데 `float("0x10")`은 ValueError고, `float("1_0")`은 10인데
 * `Number("1_0")`은 NaN이다. 둘 다 받는 모양을 이 정규식으로 못박아 갈라질 여지를 없앤다.
 */
const DECIMAL = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

/**
 * 숫자로 읽을 수 있으면 숫자, 아니면 null. **파이썬 to_number()와 짝이다.**
 *
 * 모델이 `9` 대신 `"9"`를 내는 것은 흔한 형식 흔들림이라 받아준다.
 * 반대로 다음은 전부 거절한다 — `null`·`undefined`·불리언·빈 문자열·객체·배열.
 *
 * **`Number(null)`은 NaN이 아니라 `0`이고 `Number("")`도 `0`이다** (CLAUDE.md ⑬과 같은 함정).
 * typeof로 먼저 거르지 않으면 `weight: null`이 0으로 통과해 clamp 뒤 1이 되고,
 * `float(None)`이 예외인 파이썬 쪽은 기본값 5가 되어 **두 구현이 조용히 갈린다.**
 * 실제로 갈렸고, 두 구현을 나란히 태워보고서야 드러났다.
 */
function toNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;

  const text = value.trim();
  if (!DECIMAL.test(text)) return null;

  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

/* 0 이상 정수로 강제. 숫자로 읽히지 않으면 0이다. */
function countOf(value) {
  const n = toNumber(value);
  if (n === null || n < 0) return 0;
  return Math.floor(n);
}

/**
 * 1~10으로 clamp. **숫자인지 먼저 판정하고 나서 clamp한다 — 순서를 바꾸지 않는다.**
 * 「숫자로 읽히지 않으면 기본값 5」를 먼저 확정해야 두 구현이 같은 값을 낸다.
 *
 * 반올림은 파이썬 쪽에서 `floor(n + 0.5)`로 맞춘다. 파이썬 `round()`는 은행가 반올림이라
 * `round(2.5)`가 2인데 `Math.round(2.5)`는 3이다 — weight 2.5 하나로 갈릴 수 있다.
 */
function weightOf(value) {
  const n = toNumber(value);
  if (n === null) return 5;
  return Math.max(1, Math.min(10, Math.round(n)));
}

/**
 * **최후 방어선.** 예외를 던지지 않고 언제나 화면이 쓸 수 있는 값을 낸다.
 * 실패로 볼 유일한 경우는 감정 세 수가 모두 0일 때다 — 그건 분석이 아예 없었다는 뜻이다.
 */
function shapeAnalysis(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;

  const source = raw.sentiment && typeof raw.sentiment === "object" ? raw.sentiment : {};
  const sentiment = {
    positive: countOf(source.positive),
    neutral: countOf(source.neutral),
    negative: countOf(source.negative),
  };
  if (sentiment.positive + sentiment.neutral + sentiment.negative === 0) return null;

  const keywords = [];
  const seen = new Set();

  if (Array.isArray(raw.keywords)) {
    for (const item of raw.keywords) {
      if (keywords.length >= MAX_KEYWORDS) break;
      if (!item || typeof item !== "object") continue;

      const word = String(item.word == null ? "" : item.word).trim().slice(0, MAX_WORD_CHARS);
      if (!word || seen.has(word)) continue;

      seen.add(word);
      keywords.push({
        word,
        weight: weightOf(item.weight),
        tone: TONES.indexOf(item.tone) === -1 ? "neutral" : item.tone,
      });
    }
  }

  const summary = String(raw.summary == null ? "" : raw.summary).trim().slice(0, MAX_SUMMARY_CHARS);

  /* 키워드 0개·총평 빈 문자열이어도 성공으로 내보낸다.
     화면이 그 둘을 각각 숨기고 감정 막대만 그린다 — 통째로 실패하는 것보다 낫다. */
  return { sentiment, keywords, summary };
}

module.exports = async function handler(req, res) {
  // 세 프록시 중 여기만 POST다. 리뷰 본문이 쿼리스트링에 실리지 않는다.
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return sendJson(res, 405, errorBody("method_not_allowed", "지원하지 않는 요청이에요"));
  }

  const body = await readBody(req);
  const reviews = trimReviews(body && body.reviews);
  if (!reviews.length) {
    return sendJson(res, 400, errorBody("empty_reviews", "분석할 리뷰가 없어요"));
  }

  const apiKey = String(process.env.GEMINI_API_KEY || "").trim();
  if (!apiKey) {
    return sendJson(res, 503, errorBody("no_api_key", "분석 서버 설정이 아직 안 됐어요"));
  }

  const name = String((body && body.name) || "").trim().slice(0, 60);
  const userText =
    (name ? "가게 이름: " + name + "\n\n" : "") +
    "리뷰 " + reviews.length + "개:\n" +
    reviews.map((text, i) => "[" + (i + 1) + "] " + text).join("\n");

  const payload = {
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [{ role: "user", parts: [{ text: userText }] }],
    generationConfig: {
      // 같은 리뷰는 같은 분석이 나와야 한다. 캐시해두고 다시 보여주는 값이라 흔들리면 곤란하다.
      temperature: 0.2,
      /* **이 상한은 thinking 토큰과 나눠 쓴다.** 3.x flash는 기본으로 생각을 하고,
         그 토큰이 여기 상한에 함께 잡힌다. 실측(리뷰 5개·키워드 10개 기준):
           3.7-flash  thinking 587  + 출력 160  =  747
           3.6-flash  thinking 1414 + 출력 173  = 1587
           3.5-flash  thinking 1307 + 출력 349  = 1656
         2048이면 최악 81%가 차서 여유가 20%도 없었고, 실제로 한 번 넘쳐 잘렸다.
         **넘치면 JSON이 중간에서 끊겨 bad_analysis가 된다** — 에러가 아니라 그럴듯한 실패다.
         출력 토큰은 상한이 아니라 실제 사용량으로 과금되므로 올려도 비용이 늘지 않는다.
         server.py와 **같이** 올린다. */
      maxOutputTokens: 4096,
      responseMimeType: "application/json",
      responseSchema: RESPONSE_SCHEMA,
    },
    /* thinkingConfig는 넣지 않는다. 3.x 계열의 필드명을 확신할 수 없고,
       모르는 필드를 보내면 Gemini가 400으로 거절한다. 기본값을 쓴다.
       생각을 끄는 대신 위 maxOutputTokens로 여유를 준다. */
  };

  // 타임아웃은 fetch가 스스로 걸지 않으므로 AbortController로 건다.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GEMINI_TIMEOUT);

  let response;
  try {
    response = await fetch(GEMINI_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        /* 헤더로 보낸다. ?key=는 URL이라 접근 로그·리퍼러에 키가 남는다
           (api/reviews.js가 X-Goog-Api-Key를 쓰는 것과 같은 결이다). */
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch (err) {
    if (err && err.name === "AbortError") {
      console.error("gemini timeout");
      return sendJson(res, 504,
        errorBody("upstream_timeout", "분석이 오래 걸려서 멈췄어요. 잠시 뒤에 다시 해주세요"));
    }
    console.error("gemini fetch 실패:", err && err.message);
    return sendJson(res, 502, errorBody("upstream_unreachable", "분석 서버에 연결하지 못했어요"));
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    /* 모델 종료(404)·키 문제(403)·한도(429)가 전부 여기로 떨어진다.
       본문에 원인이 적혀 있으므로 반드시 로그에 남긴다 — 화면 문구만으로는 구분되지 않는다.
       본문 전체를 잡아 판별에 쓰고 로그에는 500자만 남긴다: 일일 한도 판별에 쓰는
       quotaId가 details[] 안에 있어 앞부분만 잘라 보면 놓친다. */
    const detail = await response.text().catch(() => "");
    console.error("gemini HTTP", response.status, GEMINI_MODEL, detail.slice(0, 500));
    return sendJson(res, 502,
      errorBody("upstream_http", geminiHttpMessage(response.status, detail)));
  }

  let payloadJson;
  try {
    payloadJson = await response.json();
  } catch {
    console.error("gemini 응답을 JSON으로 읽지 못함");
    return sendJson(res, 502, errorBody("upstream_bad_json", "분석 결과를 읽지 못했어요"));
  }

  /* 안전 필터에 걸리면 candidates가 아예 비어 온다. 잘린 응답(MAX_TOKENS)도 여기서 걸러진다 —
     JSON이 중간에서 끊겨 파싱에 실패하기 때문이다. */
  const blockReason = payloadJson && payloadJson.promptFeedback && payloadJson.promptFeedback.blockReason;
  if (blockReason) {
    console.error("gemini blocked:", blockReason);
    return sendJson(res, 502, errorBody("bad_analysis", "분석 결과를 읽지 못했어요"));
  }

  const analysis = shapeAnalysis(parseLoose(extractText(payloadJson)));
  if (!analysis) {
    const finish = payloadJson && payloadJson.candidates && payloadJson.candidates[0]
      ? payloadJson.candidates[0].finishReason
      : "";
    console.error("gemini 응답이 스키마와 다름. finishReason:", finish);
    return sendJson(res, 502, errorBody("bad_analysis", "분석 결과를 읽지 못했어요"));
  }

  return sendJson(res, 200, { ok: true, analysis });
};
