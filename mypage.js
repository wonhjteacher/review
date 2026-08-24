'use strict';

/* ============================================================
   오늘은 여기 — 맛집주머니 (Phase 1, 파일 이름은 mypage로 남아 있다)

   담아둔 맛집을 「가볼 곳 / 가본 곳」 두 그룹으로 보여주고,
   방문 기록을 남기고, 지운다.
   저장소는 Supabase `saved_places` 하나뿐이다 (saved-places.js).

   클래식 스크립트다. 먼저 로드된 두 파일이 전역을 만들어 둔다 —
   auth.js → window.Auth · saved-places.js → window.SavedPlaces.

   ── 이 페이지가 조회 조건을 걸지 않는 이유 ────────────────────
   `user_id`로 거르는 코드가 여기에도, saved-places.js에도 없다.
   조건 없이 전체를 요청하면 RLS가 내 것만 돌려준다 — 거르는 일은
   창고(서버) 담당이다. 프론트에서 한 번 더 거르면 방어선이 프론트에
   있는 것처럼 보여, 나중에 그 줄을 지웠을 때 뚫린 것을 눈치채지 못한다.

   ── 그룹을 가르는 기준은 하나다 ──────────────────────────────
   `visitedAt`이 비어 있으면 가볼 곳, 있으면 가본 곳.
   `note`나 `wouldReturn`은 보지 않는다 — 한 줄 기록은 선택이라
   비어 있는 것이 정상이고, 그걸 기준에 넣으면 기록 없이 다녀온 곳이
   영영 「가볼 곳」에 남는다.
   ============================================================ */

(function () {
  var noticeEl = document.getElementById('mypage-notice');
  var statusEl = document.getElementById('mypage-status');

  var groups = {
    toVisit: {
      section: document.getElementById('group-to-visit'),
      list:    document.getElementById('list-to-visit'),
      count:   document.getElementById('count-to-visit')
    },
    visited: {
      section: document.getElementById('group-visited'),
      list:    document.getElementById('list-visited'),
      count:   document.getElementById('count-visited')
    }
  };

  var dialog     = document.getElementById('visit-dialog');
  var dialogForm = document.getElementById('visit-form');
  var dialogPlace = document.getElementById('visit-dialog-place');
  var dialogTitle = document.getElementById('visit-dialog-title');
  var dialogNote  = document.getElementById('visit-note');
  var dialogStatus = document.getElementById('visit-status');
  var dialogSubmit = dialogForm.querySelector('.visit-dialog__submit');

  var removeDialog = document.getElementById('remove-dialog');
  var removeDialogPlace = document.getElementById('remove-dialog-place');
  var removeStatus = document.getElementById('remove-status');

  /* 입력창이 지금 어느 가게를 다루는지. 닫으면 비운다.
     DOM에서 되읽지 않고 여기에 들고 있는 이유 — 저장이 왕복하는 동안
     목록이 다시 그려져도(다른 탭에서 담기 등) 대상이 흔들리지 않게. */
  var editing = null;
  /* 「또 올까」의 현재 선택. null이면 아직 안 골랐다 — false(글쎄요)와 다르다. */
  var verdict = null;

  /* 창을 열기 직전에 포커스가 있던 요소. 닫을 때 여기로 되돌린다.
     showModal()은 포커스를 가둬주지만, 닫은 뒤 어디로 돌려놓을지는 정해주지 않는다. */
  var opener = null;

  /* 삭제 확인창이 지금 어느 카드를 다루는지 — editing/opener와 같은 이유로
     DOM에서 되읽지 않고 여기에 들고 있는다. */
  var pendingRemove = null;
  var removeOpener = null;

  /* --- 만들기 헬퍼 ---------------------------------------------
     save.js의 el()과 같은 것이다. 두 페이지가 스크립트를 공유하지 않아
     (파일 하나가 IIFE 하나다) 여기에 같은 모양으로 둔다. */
  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  /* --- 상태 한 줄 ---------------------------------------------- */

  function setStatus(message, isError) {
    statusEl.textContent = message || '';
    statusEl.className = 'mypage__status' + (message && isError ? ' mypage__status--error' : '');
  }

  /* --- 날짜 -----------------------------------------------------
     toLocaleDateString('ko-KR')에 기대지 않는다. 브라우저·OS 로케일에 따라
     `2026. 8. 23.`이 되기도 하고 `8/23/2026`이 되기도 한다.
     화면에 나갈 문구는 우리가 정한다 (DESIGN 7장). */
  function formatDate(ms, suffix) {
    if (ms == null) return '';
    var d = new Date(ms);
    if (isNaN(d.getTime())) return '';
    return d.getFullYear() + '년 ' + (d.getMonth() + 1) + '월 ' + d.getDate() + '일' + (suffix || '');
  }

  /* --- 카드 -----------------------------------------------------
     두 그룹이 같은 카드를 쓴다. 다른 것은 아래 두 줄뿐이다 —
     가볼 곳에는 「다녀왔어요」 버튼, 가본 곳에는 기록 블록과 「기록 수정」.
     카드를 둘로 나누지 않는 이유: 이름·주소·카카오맵·삭제가 완전히 같고,
     나누면 한쪽만 고치는 실수가 생긴다. */
  function card(place) {
    var visited = place.visitedAt != null;

    /* 가본 곳/가볼 곳을 카드 modifier로 가르지 않는다 — 그룹 제목이 이미 갈라놓았고,
       안 쓰는 클래스를 붙여두면 나중에 스타일이 있는 줄 알고 찾게 된다. */
    var li = el('li', 'mypage-card');
    li.dataset.kakaoId = place.id;

    var body = el('div', 'mypage-card__body');
    body.appendChild(el('h3', 'h2 mypage-card__name', place.name));

    // 주소가 없는 가게가 있다. 빈 요소를 남기지 않는다.
    if (place.address) {
      body.appendChild(el('p', 'body mypage-card__address', place.address));
    }

    var when = visited
      ? formatDate(place.visitedAt, '에 다녀왔어요')
      : formatDate(place.savedAt, '에 담았어요');
    if (when) body.appendChild(el('p', 'caption mypage-card__date', when));

    if (visited) body.appendChild(record(place));

    /* 액션 줄 — 카카오맵 링크와 기록 버튼이 한 줄에 선다. */
    var actions = el('div', 'mypage-card__actions');

    /* target=_blank에는 rel=noopener를 함께 단다 —
       없으면 새 탭이 window.opener로 이 페이지를 건드릴 수 있다. */
    if (place.url) {
      var link = el('a', 'mypage-card__link', '카카오맵 보기');
      link.href = place.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.setAttribute('aria-label', place.name + ' 카카오맵에서 보기');
      actions.appendChild(link);
    }

    var visitBtn = el('button',
      visited ? 'mypage-card__edit' : 'mypage-card__visit',
      visited ? '기록 수정' : '다녀왔어요');
    visitBtn.type = 'button';
    visitBtn.dataset.action = 'visit';
    visitBtn.setAttribute('aria-label',
      place.name + (visited ? ' 방문 기록 수정' : ' 다녀왔다고 기록하기'));
    actions.appendChild(visitBtn);

    body.appendChild(actions);
    li.appendChild(body);

    /* ×는 모양일 뿐이라 낭독기에는 아무 뜻이 없다. 이름을 붙여 읽히게 한다. */
    var remove = el('button', 'mypage-card__remove', '×');
    remove.type = 'button';
    remove.dataset.action = 'remove';
    remove.setAttribute('aria-label', place.name + ' 목록에서 지우기');
    li.appendChild(remove);

    return li;
  }

  /* 가본 곳 카드의 기록 블록 — 또 올까 답 + 한 줄 기록.
     한 줄 기록은 **선택이라 없는 것이 정상이다.** 없으면 줄째 빼고,
     「기록 없음」 같은 문구로 빈자리를 채우지 않는다 — 안 쓴 것을 나무라는 화면이 된다. */
  function record(place) {
    var box = el('div', 'mypage-card__record');

    if (place.wouldReturn != null) {
      var yes = place.wouldReturn === true;
      var badge = el('p', 'mypage-card__verdict' + (yes ? ' is-yes' : ' is-no'));
      badge.appendChild(el('span', 'mypage-card__verdict-face', yes ? '😊' : '🤔'));
      badge.appendChild(el('span', 'mypage-card__verdict-text', yes ? '또 올래요' : '글쎄요'));
      box.appendChild(badge);
    }

    if (place.note) {
      box.appendChild(el('p', 'body mypage-card__note', place.note));
    }

    return box;
  }

  /* --- 안내 (비로그인 · 비어 있음) -------------------------------
     둘 다 「문구 + 버튼 하나」라 같은 상자를 쓴다. */
  function notice(message, actionText, onAction) {
    noticeEl.textContent = '';

    var box = el('div', 'mypage__notice-box');
    box.appendChild(el('p', 'body-l mypage__notice-text', message));

    var action = el('div', 'action mypage__notice-action');
    var button = el('button', 'btn-primary', actionText);
    button.type = 'button';
    button.addEventListener('click', onAction);
    action.appendChild(button);
    box.appendChild(action);

    noticeEl.appendChild(box);
  }

  /* 두 그룹을 한꺼번에 감춘다. 안내를 띄우는 상태(비로그인·로딩·오류·비어 있음)에서
     빈 제목만 남지 않게 한다. */
  function hideGroups() {
    groups.toVisit.section.hidden = true;
    groups.visited.section.hidden = true;
    groups.toVisit.list.textContent = '';
    groups.visited.list.textContent = '';
  }

  function fillGroup(group, list) {
    group.count.textContent = String(list.length);
    group.list.textContent = '';

    // 빈 그룹은 섹션째 감춘다. 「가본 곳 0」이 서 있으면 아직 안 간 것을 채근하는 화면이 된다.
    group.section.hidden = list.length === 0;
    if (!list.length) return;

    var fragment = document.createDocumentFragment();
    for (var i = 0; i < list.length; i += 1) fragment.appendChild(card(list[i]));
    group.list.appendChild(fragment);
  }

  /* --- 그리기 ---------------------------------------------------
     화면이 가질 수 있는 상태가 넷이다. 매번 전부 지우고 하나만 그린다 —
     섞이면 「로그인하세요」와 카드 목록이 함께 보이는 화면이 나온다. */
  function render() {
    noticeEl.textContent = '';

    var signedIn = !!(window.Auth && window.Auth.isSignedIn());

    /* ① 비로그인.
       **isSignedIn()을 페이지 로드 직후에 읽지 않는다** — 세션 복원이 비동기라
       로그인한 사용자가 비로그인으로 보인다 (CLAUDE.md ⑰).
       그래서 render()는 Auth.onChange가 부를 때만 돈다. */
    if (!signedIn) {
      hideGroups();
      setStatus('');
      closeDialog();
      closeRemoveDialog();
      notice('로그인하면 담은 맛집을 볼 수 있어요', '로그인', function () {
        if (window.Auth) window.Auth.open('로그인하면 담은 맛집을 볼 수 있어요');
      });
      return;
    }

    // ② 아직 서버 응답을 받아보지 못했다. 「비어 있음」과 구별해야 한다.
    if (!window.SavedPlaces.isLoaded()) {
      hideGroups();
      setStatus('담아둔 곳을 불러오는 중이에요');
      return;
    }

    // ③ 읽기 실패. 비어 있는 것처럼 보여주면 담아둔 것이 사라진 줄 안다.
    if (window.SavedPlaces.error()) {
      hideGroups();
      setStatus('목록을 불러오지 못했어요. 잠시 뒤에 다시 열어주세요', true);
      return;
    }

    setStatus('');

    var toVisit = window.SavedPlaces.toVisit();   // 담은 순 (최신이 위)
    var visited = window.SavedPlaces.visited();   // 다녀온 순 (최신이 위)

    // ④ 아무것도 담지 않았다.
    if (!toVisit.length && !visited.length) {
      hideGroups();
      notice('아직 담은 맛집이 없어요', '맛집 검색하러 가기', function () {
        window.location.href = 'save.html';
      });
      return;
    }

    fillGroup(groups.toVisit, toVisit);
    fillGroup(groups.visited, visited);
  }

  /* --- 방문 기록 입력창 -----------------------------------------
     처음 기록할 때와 고칠 때가 **같은 창이다.** 다른 것은 제목과
     들어와 있는 값뿐이라 창을 둘로 만들지 않는다. */

  function setVerdict(next) {
    verdict = next;
    var buttons = dialogForm.querySelectorAll('.visit-choice');
    for (var i = 0; i < buttons.length; i += 1) {
      var mine = buttons[i].dataset.return === 'yes';
      var on = next != null && mine === next;
      buttons[i].classList.toggle('is-selected', on);
      buttons[i].setAttribute('aria-pressed', on ? 'true' : 'false');
    }
  }

  function setDialogStatus(message, isError) {
    dialogStatus.textContent = message || '';
    dialogStatus.className = 'visit-dialog__status' +
      (message && isError ? ' visit-dialog__status--error' : '');
  }

  function openDialog(place, focusBack) {
    editing = place.id;
    opener = focusBack || null;

    var revisit = place.visitedAt != null;
    dialogTitle.textContent = revisit ? '기록 수정' : '다녀왔어요';
    dialogPlace.textContent = place.name;
    dialogNote.value = place.note || '';
    setVerdict(place.wouldReturn);       // null이면 아무것도 안 골라진 상태
    setDialogStatus('');
    setBusy(false);

    if (!dialog.open) dialog.showModal();

    /* 처음 기록할 때는 답부터 골라야 하므로 「또 올래요」에 포커스를 준다.
       고칠 때는 답이 이미 있으므로 한 줄 기록으로 바로 간다. */
    var target = revisit ? dialogNote : dialogForm.querySelector('.visit-choice');
    if (target) target.focus();
  }

  function closeDialog() {
    if (dialog.open) dialog.close();
  }

  function setBusy(busy) {
    dialogSubmit.disabled = busy;
    dialogNote.disabled = busy;
    var buttons = dialogForm.querySelectorAll('.visit-choice');
    for (var i = 0; i < buttons.length; i += 1) buttons[i].disabled = busy;
  }

  /* --- 삭제 확인창 -----------------------------------------------
     「×」를 눌러도 곧바로 지우지 않는다 — 특히 가본 곳 카드는 방문 기록
     (visited_at·note·would_return)까지 함께 지워지는데, 되돌릴 방법이 없다.
     가볼 곳/가본 곳을 가르지 않고 모든 카드에 같은 확인창을 띄운다. */

  function setRemoveStatus(message, isError) {
    removeStatus.textContent = message || '';
    removeStatus.className = 'remove-dialog__status' +
      (message && isError ? ' remove-dialog__status--error' : '');
  }

  function openRemoveDialog(place, item, button) {
    pendingRemove = { id: item.dataset.kakaoId, item: item, button: button };
    removeOpener = button;
    removeDialogPlace.textContent = place.name;
    setRemoveStatus('');

    if (!removeDialog.open) removeDialog.showModal();

    // 파괴적 동작이므로 기본 포커스는 「취소」에 둔다.
    var cancelBtn = removeDialog.querySelector('.remove-dialog__cancel');
    if (cancelBtn) cancelBtn.focus();
  }

  function closeRemoveDialog() {
    if (removeDialog.open) removeDialog.close();
  }

  removeDialog.addEventListener('click', function (event) {
    if (event.target.closest('[data-action="close-remove"]')) {
      closeRemoveDialog();
      return;
    }

    var confirmBtn = event.target.closest('[data-action="confirm-remove"]');
    if (confirmBtn) {
      if (!pendingRemove || confirmBtn.disabled) return;

      var target = pendingRemove;
      confirmBtn.disabled = true;
      target.button.disabled = true;
      target.item.classList.add('is-busy');
      setRemoveStatus('지우는 중이에요');

      window.SavedPlaces.remove(target.id).then(function (res) {
        // 성공하면 저장소가 onChange로 알려주고 render()가 카드를 지운다.
        if (res && res.ok) {
          closeRemoveDialog();
          return;
        }

        confirmBtn.disabled = false;
        target.button.disabled = false;
        target.item.classList.remove('is-busy');
        setRemoveStatus('지우지 못했어요. 잠시 뒤에 다시 해주세요', true);
      });
      return;
    }

    /* 배경(::backdrop)을 눌렀을 때다 — visit-dialog와 같은 판정. */
    if (event.target === removeDialog) closeRemoveDialog();
  });

  /* Esc로 닫을 때는 위 핸들러를 타지 않고 브라우저가 바로 close 이벤트를 쏜다.
     정리를 여기 두어야 세 경로(취소·배경·Esc)가 모두 지나간다. */
  removeDialog.addEventListener('close', function () {
    pendingRemove = null;
    if (removeOpener && document.contains(removeOpener)) removeOpener.focus();
    removeOpener = null;
  });

  // 「또 올까」 두 버튼
  dialogForm.addEventListener('click', function (event) {
    var choice = event.target.closest('.visit-choice');
    if (!choice || !dialogForm.contains(choice)) return;
    setVerdict(choice.dataset.return === 'yes');
    setDialogStatus('');
  });

  dialog.addEventListener('click', function (event) {
    if (event.target.closest('[data-action="close-visit"]')) {
      closeDialog();
      return;
    }
    /* 배경(::backdrop)을 눌렀을 때다.
       <dialog>는 배경도 자기 자신이 받으므로 target이 창 그 자체면 바깥을 누른 것이다.
       내용은 .visit-dialog__inner가 덮고 있어 여기까지 오지 않는다. */
    if (event.target === dialog) closeDialog();
  });

  /* Esc로 닫을 때는 위 핸들러를 타지 않고 브라우저가 바로 close 이벤트를 쏜다.
     정리를 여기 두어야 세 경로(닫기 버튼·배경·Esc)가 모두 지나간다. */
  dialog.addEventListener('close', function () {
    editing = null;
    verdict = null;
    if (opener && document.contains(opener)) opener.focus();
    opener = null;
  });

  dialogForm.addEventListener('submit', function (event) {
    event.preventDefault();
    if (!editing) return;

    /* **「또 올까」만 필수다.** 한 줄 기록은 비어도 저장한다 —
       기록을 강요하지 않는 것이 이 화면의 약속이다. */
    if (typeof verdict !== 'boolean') {
      setDialogStatus('또 올지 먼저 골라주세요', true);
      var first = dialogForm.querySelector('.visit-choice');
      if (first) first.focus();
      return;
    }

    var placeId = editing;
    setBusy(true);
    setDialogStatus('저장하는 중이에요');

    window.SavedPlaces.saveVisit(placeId, { wouldReturn: verdict, note: dialogNote.value })
      .then(function (res) {
        if (res && res.ok) {
          /* 성공하면 저장소가 onChange로 알려주고 render()가 카드를 옮긴다.
             여기서 직접 DOM을 옮기지 않는다 — 화면을 고치는 곳이 둘이 되면
             실패했을 때 한쪽만 되돌려진다. */
          closeDialog();
          setStatus('기록을 남겼어요');
          return;
        }

        setBusy(false);
        /* not_updated는 「에러 없이 0건 고쳤다」다. RLS에 update 정책이 없을 때
           이렇게 온다 — 성공으로 읽으면 새로고침해야 드러나는 거짓말이 된다. */
        setDialogStatus(
          res && res.reason === 'not_updated'
            ? '기록을 저장할 권한이 없어요. 잠시 뒤에 다시 해주세요'
            : '저장하지 못했어요. 잠시 뒤에 다시 해주세요',
          true);
      });
  });

  /* --- 카드 위 동작 ---------------------------------------------
     카드마다 리스너를 붙이지 않고 그룹 목록에서 한 번씩만 받는다. */
  function bindList(list) {
    list.addEventListener('click', function (event) {
      var item = event.target.closest('.mypage-card');
      if (!item || !list.contains(item)) return;

      var place = window.SavedPlaces.get(item.dataset.kakaoId);

      // ① 기록 남기기 · 고치기
      var visitBtn = event.target.closest('[data-action="visit"]');
      if (visitBtn) {
        if (!place) return;
        openDialog(place, visitBtn);
        return;
      }

      // ② 지우기 — 곧바로 지우지 않고 확인창을 연다 (아래 「삭제 확인창」 참고)
      var removeBtn = event.target.closest('[data-action="remove"]');
      if (!removeBtn) return;
      if (removeBtn.disabled) return;
      if (!place) return;

      openRemoveDialog(place, item, removeBtn);
    });
  }

  bindList(groups.toVisit.list);
  bindList(groups.visited.list);

  /* --- 시작 -----------------------------------------------------
     그리는 계기가 둘이다:
       · 로그인 상태가 바뀔 때 (Auth.onChange) — 다른 계정으로 갈아타면
         앞사람 목록이 남으면 안 된다
       · 목록이 바뀔 때 (SavedPlaces.onChange) — 첫 로드·기록·지우기

     둘 다 등록 즉시 한 번 불러주므로 초기 렌더를 따로 하지 않는다.
     그래서 이 파일 어디에도 render()를 맨몸으로 부르는 줄이 없다 —
     세션 복원 전에 그려버리는 ⑰의 함정을 구조로 막는다. */
  if (window.Auth) window.Auth.onChange(render);
  window.SavedPlaces.onChange(render);
})();
