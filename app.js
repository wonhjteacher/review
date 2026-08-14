'use strict';

/* ============================================================
   오늘은 여기 — 체험 데모
   Phase 0: 저장 없음. 추천은 규칙 기반 필터링이며 AI가 아니다.
   ============================================================ */

/* --- 샘플 데이터 (PRD 6장) -------------------------------------
   전부 가상의 매장명이다.
   Q1×Q2×Q3 12개 조합 전부에 최소 1곳이 매칭되도록 구성되어 있다.
   값을 고칠 때는 이 조건이 깨지지 않는지 반드시 확인할 것.
------------------------------------------------------------- */
const PLACES = [
  // 가본 곳
  { name: "담백한식탁",     category: "한식",     status: "visited", tags: ["혼밥","가까움","가성비"], oneLiner: "혼자 가서 20분 만에 먹고 나오기 좋아요", revisitRate: 88 },
  { name: "라멘 코지",      category: "일식",     status: "visited", tags: ["혼밥","가까움","분위기"], oneLiner: "카운터석이 조용해서 혼자 앉기 편해요",   revisitRate: 82 },
  { name: "화로상회",       category: "고기",     status: "visited", tags: ["여럿","분위기"],          oneLiner: "회식하기 딱 좋은 자리 간격",             revisitRate: 79 },
  { name: "골목분식",       category: "분식",     status: "visited", tags: ["혼밥","여럿","가성비"],   oneLiner: "가격 생각하면 다시 갈 수밖에 없어요",   revisitRate: 85 },
  { name: "테라스 델피",    category: "양식",     status: "visited", tags: ["여럿","분위기","가까움"], oneLiner: "창가 자리가 좋아서 손님 데려가기 좋아요", revisitRate: 76 },

  // 가볼 곳
  { name: "미도리 스시",    category: "일식",     status: "wish",    tags: ["혼밥","분위기"],          oneLiner: "조용한 오마카세라고 들었어요",           revisitRate: null },
  { name: "마라공방",       category: "중식",     status: "wish",    tags: ["여럿","가성비"],          oneLiner: "양 많고 저렴하다는 얘기가 많아요",       revisitRate: null },
  { name: "브레드 앤 스푼", category: "브런치",   status: "wish",    tags: ["혼밥","가까움","가성비"], oneLiner: "회사에서 걸어서 5분 거리",               revisitRate: null },
  { name: "루프탑 하루",    category: "이자카야", status: "wish",    tags: ["여럿","분위기","가까움"], oneLiner: "퇴근하고 한잔하기 좋아 보여요",         revisitRate: null },
  { name: "삼거리 곱창",    category: "곱창",     status: "wish",    tags: ["여럿","가성비","가까움"], oneLiner: "줄 선다는 얘기를 계속 듣고 있어요",     revisitRate: null }
];

/* --- 질문 정의 (PRD 6장) --- */
const QUESTIONS = [
  {
    title: '오늘은 어떤 기분인가요?',
    choices: [
      { label: '새로운 곳',    value: 'wish' },
      { label: '실패 없는 곳', value: 'visited' }
    ]
  },
  {
    title: '누구랑 가세요?',
    choices: [
      { label: '혼자',   value: '혼밥' },
      { label: '동료랑', value: '여럿' }
    ]
  },
  {
    title: '뭐가 제일 중요해요?',
    choices: [
      { label: '가까움', value: '가까움' },
      { label: '가성비', value: '가성비' },
      { label: '분위기', value: '분위기' }
    ]
  }
];

/* --- 추천 이유 문구 조각 (DESIGN 7장 톤) --- */
const REASON_GROUP_JOIN = { '혼밥': '혼자 가기 좋고',   '여럿': '같이 가기 좋고' };
const REASON_GROUP_ONLY = { '혼밥': '혼자 가기 좋아서', '여럿': '같이 가기 좋아서' };
const REASON_PRIORITY   = { '가까움': '가까워서', '가성비': '가격이 좋아서', '분위기': '분위기가 좋아서' };

/* ============================================================
   매칭 로직 (PRD 6장)

   순수 함수로 둔다 — 상태를 읽지 않고 인자로만 동작하므로
   콘솔에서 12개 조합을 그대로 호출해 검증할 수 있다.

   answers  = [status, groupTag, priorityTag]
   lastName = 직전에 보여준 맛집 이름 (없으면 null)
   반환      = { place, relaxed }  relaxed: null | 'q3' | 'q2' | 'q1'
   ============================================================ */
function pickPlace(answers, lastName) {
  const status = answers[0];
  const group = answers[1];
  const priority = answers[2];

  const byStatus = PLACES.filter(function (p) { return p.status === status; });

  let relaxed = null;
  let pool = byStatus.filter(function (p) {
    return p.tags.indexOf(group) !== -1 && p.tags.indexOf(priority) !== -1;
  });

  // 조건 완화 — 빈 결과 화면은 만들지 않는다 (PRD 6장)
  if (pool.length === 0) {
    relaxed = 'q3';
    pool = byStatus.filter(function (p) { return p.tags.indexOf(group) !== -1; });
  }
  if (pool.length === 0) {
    relaxed = 'q2';
    pool = byStatus;
  }
  if (pool.length === 0) {
    // PRD에 없는 최종 안전망. 데이터가 어떻게 바뀌어도 빈 화면은 못 나오게 한다.
    relaxed = 'q1';
    pool = PLACES;
  }

  // 직전 제외는 후보가 2곳 이상일 때만.
  // 1곳뿐인 조합에서 제외해버리면 후보가 0곳이 되고,
  // 조건이 맞았는데도 "조건을 조금 넓혀서 골랐어요"라는 거짓 안내가 뜬다.
  let candidates = pool;
  if (pool.length > 1 && lastName) {
    const withoutLast = pool.filter(function (p) { return p.name !== lastName; });
    if (withoutLast.length > 0) candidates = withoutLast;
  }

  const place = candidates[Math.floor(Math.random() * candidates.length)];
  return { place: place, relaxed: relaxed };
}

/* 선택한 조건을 조합해 추천 이유 한 줄을 만든다 */
function buildReason(answers, relaxed) {
  const group = answers[1];
  const priority = answers[2];

  if (relaxed === 'q2' || relaxed === 'q1') return '오늘 기분에 맞춰 골랐어요';
  if (relaxed === 'q3') return REASON_GROUP_ONLY[group] + ' 골랐어요';
  return REASON_GROUP_JOIN[group] + ', ' + REASON_PRIORITY[priority] + ' 골랐어요';
}

/* ============================================================
   화면
   ============================================================ */
const state = {
  step: 0,                 // 0~2 = 질문, 3 = 결과
  answers: [null, null, null],
  lastPlaceName: null
};

const stage = document.getElementById('demo-stage');

const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function esc(str) {
  return String(str).replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
  });
}

function questionMarkup(index) {
  const q = QUESTIONS[index];
  const percent = ((index + 1) / QUESTIONS.length) * 100;

  const choices = q.choices.map(function (c) {
    return '<button type="button" class="choice" data-value="' + esc(c.value) + '">' +
           esc(c.label) + '</button>';
  }).join('');

  const back = index > 0
    ? '<button type="button" class="btn-text demo__back" data-action="back">← 이전 질문</button>'
    : '';

  return '' +
    '<div class="view">' +
      '<div class="progress">' +
        '<span class="caption progress__label">' + (index + 1) + ' / ' + QUESTIONS.length + '</span>' +
        '<div class="progress__track">' +
          '<div class="progress__fill" style="width:' + percent + '%"></div>' +
        '</div>' +
      '</div>' +
      '<h2 class="h1 question" tabindex="-1">' + esc(q.title) + '</h2>' +
      '<div class="choices">' + choices + '</div>' +
      back +
    '</div>';
}

function resultMarkup() {
  const result = pickPlace(state.answers, state.lastPlaceName);
  const place = result.place;
  state.lastPlaceName = place.name;

  const tags = place.tags.map(function (t) {
    return '<span>#' + esc(t) + '</span>';
  }).join('');

  // 실제로 조건을 푼 경우에만 밝힌다
  const note = result.relaxed
    ? '<p class="caption result__note">조건을 조금 넓혀서 골랐어요</p>'
    : '';

  const footer = place.status === 'visited'
    ? '<hr class="result__divider">' +
      '<div class="result__revisit">' +
        '<span>또 갈 것 같아요</span>' +
        '<span class="result__rate">' + place.revisitRate + '%</span>' +
      '</div>'
    : '<hr class="result__divider">' +
      '<span class="badge badge--wish">아직 안 가본 곳</span>';

  return '' +
    '<div class="view view--result">' +
      '<h2 class="h1 question" tabindex="-1">오늘은 여기 어때요?</h2>' +
      '<div class="result__card">' +
        '<p class="caption result__category">' + esc(place.category) + '</p>' +
        '<p class="h2 result__name">' + esc(place.name) + '</p>' +
        '<p class="caption result__tags">' + tags + '</p>' +
        '<p class="body result__oneliner">&ldquo;' + esc(place.oneLiner) + '&rdquo;</p>' +
        note +
        footer +
      '</div>' +
      '<p class="caption result__reason">' + esc(buildReason(state.answers, result.relaxed)) + '</p>' +
      '<button type="button" class="btn-primary result__again" data-action="restart">다시 하기</button>' +
    '</div>';
}

/* 화면을 그린다. focus=true면 제목으로 포커스를 옮겨
   키보드·스크린리더 사용자가 전환을 놓치지 않게 한다. */
function render(focus) {
  stage.innerHTML = state.step < QUESTIONS.length
    ? questionMarkup(state.step)
    : resultMarkup();

  if (focus) {
    const heading = stage.querySelector('.question');
    if (heading) heading.focus({ preventScroll: true });
  }
}

/* fade-out 150ms 후 교체 (DESIGN 6장) */
function transitionTo(step) {
  state.step = step;
  stage.classList.add('is-leaving');
  window.setTimeout(function () {
    stage.classList.remove('is-leaving');
    render(true);
  }, 150);
}

function resetDemo() {
  state.step = 0;
  state.answers = [null, null, null];
  // lastPlaceName은 일부러 남긴다 — 다시 해도 직전과 다른 곳이 나오게
}

function scrollToDemo() {
  document.getElementById('demo').scrollIntoView({
    behavior: prefersReducedMotion ? 'auto' : 'smooth',
    block: 'start'
  });
}

/* --- 이벤트 --- */
stage.addEventListener('click', function (event) {
  const choice = event.target.closest('.choice');
  if (choice) {
    // 선택됨 상태를 250ms 보여준 뒤 넘어간다 (DESIGN 5장)
    choice.classList.add('is-selected');
    state.answers[state.step] = choice.dataset.value;
    const next = state.step + 1;
    window.setTimeout(function () { transitionTo(next); }, 250);
    return;
  }

  const action = event.target.closest('[data-action]');
  if (!action) return;

  if (action.dataset.action === 'back') {
    state.answers[state.step] = null;
    transitionTo(state.step - 1);
  } else if (action.dataset.action === 'restart') {
    resetDemo();
    transitionTo(0);
  }
});

document.getElementById('hero-cta').addEventListener('click', function () {
  resetDemo();
  scrollToDemo();
  render(true);
});

document.getElementById('closing-cta').addEventListener('click', function () {
  resetDemo();
  scrollToDemo();
  render(true);
});

// 첫 화면 — 스크롤이 튀지 않게 포커스는 옮기지 않는다
render(false);
