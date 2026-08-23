/* auth.js — Supabase 로그인. 공개 창구는 `window.Auth` 하나뿐이다.
 *
 * 사양은 UI-CONTRACT.md의 「`.site-auth`」·「`.auth-dialog`」·「안내 문구」·「`window.Auth`」다.
 *
 * **다른 파일이 `window.supabase`를 직접 만지지 않는다.**
 * `saved-places.js`가 saved_places 테이블을, `review-cache.js`가 sessionStorage를
 * 혼자 맡는 것과 같은 규칙이다. DB가 필요한 쪽은 `Auth.client()`로 받아간다.
 * 창구가 하나여야 로그인 판정이 한 곳에서만 바뀐다.
 *
 * 비밀번호는 **한 글자도 우리가 다루지 않는다.** 입력값을 그대로 Supabase에 넘기고 버린다.
 * 해싱·검증·세션 발급·토큰 갱신이 전부 저쪽 일이다 (PRD 8장).
 */
window.Auth = (function () {
  'use strict';

  /* ── 키를 코드에 적어둔 것은 실수가 아니다 ─────────────────────────────
   *
   * CLAUDE.md ⑩은 「API 키를 클라이언트 코드에 넣지 않는다」고 못 박는다.
   * 그 규칙은 **카카오·구글·Gemini 키**의 이야기다 — 그 키들은 손에 넣으면
   * 곧바로 과금 API를 부를 수 있어서 `server.py`/`api/*.js` 프록시가 존재한다.
   *
   * Supabase publishable 키는 **성격이 다르다.** 브라우저에 내려보내라고 만든 키이고,
   * 이것만으로는 남의 데이터를 읽지 못한다. 데이터를 지키는 것은 키가 아니라
   * **RLS(Row Level Security)**다. 프록시로 감싸도 얻는 것이 없다.
   *
   * → 그러므로 이 값을 서버로 옮기려 하지 말 것.
   * → 대신 **테이블을 만들 때 RLS를 켜지 않으면 그때 진짜로 뚫린다.**
   *    지금은 auth만 쓰므로 테이블이 없다. 담기를 서버로 옮길 때 반드시 켠다.
   *
   * secret 키(`sb_secret_…`·service_role)는 **절대 여기 넣지 않는다.** 그건 ⑩ 그대로다.
   */
  var SUPABASE_URL = 'https://xrngvljbtffzdbywyjva.supabase.co';
  var SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_xU7bY4Hs3kiJlsQlQIEovA_PjPiXB4n';

  /* Supabase가 정한 최소 길이. 서버도 같은 값으로 거절하지만(`weak_password`),
     왕복 한 번을 아끼려고 여기서 먼저 잡는다. 서버 검사를 대체하는 것이 아니다. */
  var MIN_PASSWORD = 6;

  var client = null;
  var currentUser = null;
  var ready = false;
  var listeners = [];
  var resolveReady;
  var readyPromise = new Promise(function (resolve) { resolveReady = resolve; });

  /* ── 화면 요소 ───────────────────────────────────────────────────── */
  var slot, dialog, form, emailInput, passwordInput, statusEl, submitBtn, signupBtn;

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  /* ── 오류를 한국어로 옮긴다 ──────────────────────────────────────────
   *
   * `error.code`로 가른다. `message`는 영어이고 라이브러리 버전에 따라 문구가 바뀐다.
   * 아래 코드는 실제 프로젝트에 요청을 태워 받아낸 값이다
   * (UI-CONTRACT 「안내 문구 — Supabase 오류를 한국어로 옮기는 표」).
   */
  var MESSAGES = {
    invalid_credentials: '이메일 또는 비밀번호가 맞지 않아요',
    user_already_exists: '이미 가입된 이메일이에요. 로그인해주세요',
    email_exists: '이미 가입된 이메일이에요. 로그인해주세요',
    weak_password: '비밀번호는 ' + MIN_PASSWORD + '자 이상이어야 해요',
    validation_failed: '이메일 형식이 올바르지 않아요',
    email_address_invalid: '이메일 형식이 올바르지 않아요',
    email_not_confirmed: '메일함에서 인증을 먼저 완료해주세요',
    over_email_send_rate_limit: '요청이 많아요. 잠시 뒤에 다시 해주세요',
    over_request_rate_limit: '요청이 많아요. 잠시 뒤에 다시 해주세요',
    signup_disabled: '지금은 회원가입을 받지 않아요',
  };

  function messageFor(error, fallback) {
    if (!error) return fallback;
    var code = error.code || error.error_code || '';
    if (MESSAGES[code]) return MESSAGES[code];

    /* 코드가 비어 오는 구버전 응답을 위한 최소한의 보루다.
       **여기에 의존하지 말 것** — 영어 문구는 예고 없이 바뀐다. */
    var raw = String(error.message || '').toLowerCase();
    if (raw.indexOf('already registered') >= 0 || raw.indexOf('already exists') >= 0) {
      return MESSAGES.user_already_exists;
    }
    if (raw.indexOf('invalid login') >= 0) return MESSAGES.invalid_credentials;
    if (raw.indexOf('password should be') >= 0) return MESSAGES.weak_password;

    /* 네트워크가 끊긴 경우가 여기로 온다. 원인을 콘솔에 남긴다 —
       화면 문구만으로는 서버 거절과 구분되지 않는다. */
    if (window.console) console.error('[auth]', code || '(코드 없음)', error.message);
    return fallback;
  }

  /* ── 상태 ────────────────────────────────────────────────────────── */

  /* 표시 이름은 이메일의 `@` 앞부분이다. 가입 폼이 이메일·비밀번호만 받기 때문이다
     (UI-CONTRACT 「.site-auth」). 별명을 받게 되면 user_metadata로 옮긴다. */
  function toUser(session) {
    if (!session || !session.user) return null;
    var email = session.user.email || '';
    return {
      id: session.user.id,
      email: email,
      name: email.split('@')[0] || '회원',
    };
  }

  function setUser(next) {
    var before = currentUser && currentUser.id;
    var after = next && next.id;
    currentUser = next;
    renderSlot();
    if (before !== after) notify();
  }

  function notify() {
    for (var i = 0; i < listeners.length; i++) {
      try { listeners[i](currentUser); } catch (err) {
        if (window.console) console.error('[auth] 구독자 오류', err);
      }
    }
  }

  /* ── 오른쪽 위 영역 ──────────────────────────────────────────────── */
  function renderSlot() {
    if (!slot) return;
    slot.textContent = '';

    /* **복원 전에는 아무것도 그리지 않는다.** 세션을 localStorage에서 되살리는 데
       한 틱이 걸리는데, 그동안 `로그인`을 그려두면 로그인한 사용자에게
       로그인 버튼이 깜빡인다 (UI-CONTRACT 「.site-auth」). */
    if (!ready) return;

    if (!client) {
      slot.appendChild(el('span', 'site-auth__error', '로그인 기능을 불러오지 못했어요'));
      return;
    }

    /* 마이페이지는 로그인 여부와 상관없이 낸다. 비로그인으로 들어가도
       그 페이지가 「로그인하면 담은 맛집을 볼 수 있어요」로 받아주므로,
       숨기면 들어갈 길만 사라지고 얻는 것이 없다.
       자기 페이지에서는 빼둔다 — 지금 보고 있는 곳으로 가는 링크는 소음이다. */
    if (document.body && document.body.getAttribute('data-page') !== 'mypage') {
      var mypage = el('a', 'site-auth__mypage', '마이페이지');
      mypage.href = 'mypage.html';
      slot.appendChild(mypage);
    }

    if (currentUser) {
      slot.appendChild(el('span', 'site-auth__user', currentUser.name + '님'));
      var out = el('button', 'site-auth__signout', '로그아웃');
      out.type = 'button';
      out.setAttribute('data-action', 'sign-out');
      slot.appendChild(out);
      return;
    }

    var login = el('button', 'site-auth__button', '로그인');
    login.type = 'button';
    login.setAttribute('data-action', 'open-auth');
    slot.appendChild(login);
  }

  /* ── 창 ──────────────────────────────────────────────────────────── */
  function setStatus(text, kind) {
    if (!statusEl) return;
    statusEl.textContent = text || '';
    statusEl.className = 'auth-dialog__status' + (text && kind ? ' auth-dialog__status--' + kind : '');
  }

  function setBusy(busy) {
    if (submitBtn) submitBtn.disabled = busy;
    if (signupBtn) signupBtn.disabled = busy;
    if (emailInput) emailInput.disabled = busy;
    if (passwordInput) passwordInput.disabled = busy;
  }

  function open(reason) {
    if (!dialog) return;
    setStatus(reason || '', reason ? 'info' : null);
    if (!dialog.open) dialog.showModal();
    if (emailInput) emailInput.focus();
  }

  function close() {
    if (dialog && dialog.open) dialog.close();
  }

  /* 폼 값을 읽고 **우리가 먼저 검사한다.** `novalidate`를 붙여
     브라우저 기본 말풍선 대신 `~해요`체 문구를 쓰기 위해서다 (DESIGN 7장). */
  function readForm() {
    var email = (emailInput ? emailInput.value : '').trim();
    var password = passwordInput ? passwordInput.value : '';

    if (!email) return { error: '이메일을 입력해주세요' };
    if (email.indexOf('@') < 0 || email.indexOf('.') < 0) {
      return { error: '이메일 형식이 올바르지 않아요' };
    }
    if (!password) return { error: '비밀번호를 입력해주세요' };
    if (password.length < MIN_PASSWORD) {
      return { error: '비밀번호는 ' + MIN_PASSWORD + '자 이상이어야 해요' };
    }
    return { email: email, password: password };
  }

  function afterSignedIn() {
    close();
    if (form) form.reset();
    setStatus('');
  }

  function signIn() {
    if (!client) { setStatus('로그인 기능을 불러오지 못했어요', 'error'); return; }
    var input = readForm();
    if (input.error) { setStatus(input.error, 'error'); return; }

    setBusy(true);
    setStatus('로그인하는 중이에요', 'loading');
    client.auth.signInWithPassword({ email: input.email, password: input.password })
      .then(function (res) {
        setBusy(false);
        if (res.error) {
          setStatus(messageFor(res.error, '로그인에 실패했어요. 잠시 뒤에 다시 해주세요'), 'error');
          return;
        }
        /* onAuthStateChange가 setUser를 대신 불러준다. 여기서 또 부르지 않는다 —
           두 곳에서 상태를 쓰면 구독자가 두 번 호출된다. */
        afterSignedIn();
      })
      .catch(function (err) {
        setBusy(false);
        setStatus(messageFor(err, '로그인에 실패했어요. 잠시 뒤에 다시 해주세요'), 'error');
      });
  }

  function signUp() {
    if (!client) { setStatus('로그인 기능을 불러오지 못했어요', 'error'); return; }
    var input = readForm();
    if (input.error) { setStatus(input.error, 'error'); return; }

    setBusy(true);
    setStatus('가입하는 중이에요', 'loading');
    client.auth.signUp({ email: input.email, password: input.password })
      .then(function (res) {
        setBusy(false);
        if (res.error) {
          setStatus(messageFor(res.error, '가입에 실패했어요. 잠시 뒤에 다시 해주세요'), 'error');
          return;
        }

        /* ── 가입 즉시 로그인이 되는지는 **프로젝트 설정이 정한다** ──────────
         *
         * 대시보드의 Authentication → Sign In / Providers → Email → Confirm email이
         * 꺼져 있으면 `data.session`이 함께 오고 그대로 로그인 상태가 된다.
         * 켜져 있으면 `session`이 `null`로 오고 메일 인증을 기다려야 한다.
         *
         * **둘 다 성공 응답이다.** `error`만 보고 「가입 완료」라고 띄우면
         * 인증이 켜진 프로젝트에서 로그인도 안 됐는데 완료라고 말하게 된다.
         */
        if (res.data && res.data.session) {
          afterSignedIn();
          return;
        }

        /* 이미 가입된 이메일인데 서버가 오류 대신 빈 신원을 돌려주는 경우가 있다
           (계정 존재 여부를 숨기는 설정). 그때도 여기로 떨어진다. */
        setStatus('가입 확인 메일을 보냈어요. 메일함에서 인증을 완료해주세요', 'info');
      })
      .catch(function (err) {
        setBusy(false);
        setStatus(messageFor(err, '가입에 실패했어요. 잠시 뒤에 다시 해주세요'), 'error');
      });
  }

  function signOut() {
    if (!client) return Promise.resolve();
    return client.auth.signOut().then(function () {
      /* signOut은 성공해도 onAuthStateChange가 늦게 올 수 있다. 화면을 먼저 되돌린다. */
      setUser(null);
    }).catch(function (err) {
      if (window.console) console.error('[auth] 로그아웃 실패', err);
      setUser(null);
    });
  }

  /* ── 연결 ────────────────────────────────────────────────────────── */
  function bind() {
    slot = document.getElementById('site-auth');
    dialog = document.getElementById('auth-dialog');
    form = document.getElementById('auth-form');
    emailInput = document.getElementById('auth-email');
    passwordInput = document.getElementById('auth-password');
    statusEl = document.getElementById('auth-status');
    if (form) {
      submitBtn = form.querySelector('.auth-dialog__submit');
      signupBtn = form.querySelector('.auth-dialog__signup');
    }

    /* 위임으로 받는다. `.site-auth` 안은 auth.js가 다시 그리므로
       버튼에 직접 건 리스너는 다시 그릴 때마다 사라진다. */
    document.addEventListener('click', function (event) {
      var target = event.target.closest ? event.target.closest('[data-action]') : null;
      if (!target) return;
      var action = target.getAttribute('data-action');
      if (action === 'open-auth') { event.preventDefault(); open(); }
      else if (action === 'close-auth') { event.preventDefault(); close(); }
      else if (action === 'sign-out') { event.preventDefault(); signOut(); }
      else if (action === 'sign-up') { event.preventDefault(); signUp(); }
    });

    if (form) {
      form.addEventListener('submit', function (event) {
        event.preventDefault();
        signIn();
      });
    }

    /* 창을 닫을 때 입력을 지운다. 비밀번호를 DOM에 남겨두지 않는다. */
    if (dialog) {
      dialog.addEventListener('close', function () {
        if (form) form.reset();
        setStatus('');
        setBusy(false);
      });
    }
  }

  function start() {
    bind();

    if (!window.supabase || typeof window.supabase.createClient !== 'function') {
      /* CDN이 막힌 경우다. **나머지 기능은 그대로 돌아가야 한다** —
         검색·리뷰·분석은 로그인과 무관하다. 담기만 막힌다. */
      if (window.console) console.error('[auth] supabase-js를 불러오지 못했습니다');
      ready = true;
      renderSlot();
      notify();
      resolveReady();
      return;
    }

    client = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: {
        /* 셋 다 기본값이지만 **명시한다.** 새로고침해도 로그인이 유지되는 근거가
           이 세 줄이라, 기본값에 기대어 적지 않으면 나중에 왜 유지되는지 알 수 없다. */
        persistSession: true,      // localStorage에 세션을 남긴다
        autoRefreshToken: true,    // 만료 전에 조용히 갱신한다
        detectSessionInUrl: true,  // 메일 인증 링크로 돌아온 경우를 처리한다
      },
    });

    /* 세션 복원은 비동기다. 끝나기 전까지 getUser()는 null을 돌려준다 —
       그래서 UI는 onChange로 그리라고 계약서에 적어두었다. */
    client.auth.getSession()
      .then(function (res) {
        currentUser = toUser(res && res.data && res.data.session);
      })
      .catch(function (err) {
        if (window.console) console.error('[auth] 세션 복원 실패', err);
      })
      .then(function () {
        ready = true;
        renderSlot();
        notify();
        resolveReady();
      });

    /* 로그인·로그아웃·토큰 갱신이 전부 여기로 온다. 상태를 바꾸는 곳은 이 한 군데다. */
    client.auth.onAuthStateChange(function (event, session) {
      if (!ready) return;  // 복원 중에 오는 INITIAL_SESSION은 위에서 이미 처리한다
      setUser(toUser(session));
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }

  /* ── 공개 창구 (UI-CONTRACT 「window.Auth」) ──────────────────────── */
  return {
    ready: readyPromise,
    isReady: function () { return ready; },
    isAvailable: function () { return !!client; },
    getUser: function () { return currentUser; },
    isSignedIn: function () { return !!currentUser; },

    /* 등록 즉시 현재 상태로 한 번 호출한다. 구독자가 초기 렌더를 따로 하지 않아도 되게. */
    onChange: function (fn) {
      if (typeof fn !== 'function') return function () {};
      listeners.push(fn);
      try { fn(currentUser); } catch (err) {
        if (window.console) console.error('[auth] 구독자 오류', err);
      }
      return function () {
        var at = listeners.indexOf(fn);
        if (at >= 0) listeners.splice(at, 1);
      };
    },

    /* 로그인이 필요한 동작 앞에 세운다. 막았으면 창까지 띄운 뒤 false를 준다. */
    requireSignIn: function (reason) {
      if (currentUser) return true;
      open(reason || '로그인하면 이어서 쓸 수 있어요');
      return false;
    },

    open: open,
    close: close,
    signOut: signOut,

    /* 데이터 접근이 필요한 모듈(saved-places.js)이 여기서 클라이언트를 받아간다.
       「다른 파일이 window.supabase를 직접 만지지 않는다」는 규칙은 그대로다 —
       창구를 여기 하나로 유지하려고 새 전역을 만들지 않고 이 함수를 낸다.
       불러오기에 실패했으면 null이므로 **쓰는 쪽이 반드시 확인한다.** */
    client: function () { return client; },
  };
})();
