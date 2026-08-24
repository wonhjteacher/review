'use strict';

/* ============================================================
   오늘은 여기 — 상단 내비게이션 (index.html 전용)

   여기서 하는 일은 딱 하나, 지금 화면 가운데에 있는 섹션에 맞춰
   필의 선택 상태만 바꾸는 것이다. 실제 이동은 <a href="#...">가
   브라우저 기본 동작으로 한다 — 이 파일이 없어도 링크는 그대로 동작한다.

   "추천" 필의 hidden 토글은 여기서 하지 않는다. #for-you 섹션을
   열고 닫는 곳(home.js)이 그 판단의 유일한 창구이기 때문이다 —
   따로 관찰하면 "누가 먼저 여는가" 경쟁이 생긴다.
   ============================================================ */

(function () {
  var pills = Array.prototype.slice.call(document.querySelectorAll('.site-nav__pill[data-nav]'));
  if (!pills.length || typeof IntersectionObserver !== 'function') return;

  var sections = pills
    .map(function (pill) {
      var target = document.getElementById(pill.dataset.nav);
      return target ? { pill: pill, el: target } : null;
    })
    .filter(Boolean);

  if (!sections.length) return;

  function setActive(id) {
    pills.forEach(function (pill) {
      pill.classList.toggle('is-active', pill.dataset.nav === id);
    });
  }

  // 화면 세로 가운데 10% 띠를 지나는 섹션을 "지금 보고 있는 섹션"으로 본다.
  var observer = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (entry.isIntersecting) setActive(entry.target.id);
    });
  }, { rootMargin: '-45% 0px -45% 0px' });

  sections.forEach(function (s) { observer.observe(s.el); });
})();
