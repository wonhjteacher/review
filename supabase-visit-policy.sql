-- ============================================================
-- 오늘은 여기 — 방문 기록 (F: visited_at · note · would_return)
--
-- Supabase 대시보드 → SQL Editor 에 통째로 붙여넣고 Run.
-- 프로젝트: food (xrngvljbtffzdbywyjva)
--
-- **테이블 구조는 건드리지 않는다.** 칸 셋은 이미 대시보드에서 추가되어 있다.
-- 여기서 하는 일은 RLS 정책 하나를 더하는 것뿐이다.
--
-- 여러 번 실행해도 안전하다 (drop policy if exists).
-- ============================================================

-- ── 왜 필요한가 ──────────────────────────────────────────────
-- 방문 기록은 새 행을 넣는 것이 아니라 **담아둔 행을 고치는 일**이다.
-- 그런데 saved_places에는 select · insert · delete 정책만 있다
-- (담기가 넣기와 지우기뿐이라 최소 권한으로 만들어 두었다).
--
-- update 정책이 없으면 **에러가 나지 않는다.** 고칠 대상이 0건으로 보여서
-- PostgREST가 200 OK + 빈 배열을 돌려준다 — 거절이 아니라 「0건 고쳤다」다.
-- 화면에는 「저장했어요」가 뜨고 새로고침하면 기록이 사라져 있다.
-- 에러가 아니라 **그럴듯한 실패**라 놓치기 쉽다.

drop policy if exists "saved_places: 내 것만 고치기" on public.saved_places;

-- using  — 고칠 수 있는 행을 내 것으로 제한한다
-- with check — 고친 뒤에도 여전히 내 것이어야 한다
--              (없으면 user_id를 남의 것으로 바꿔 행을 넘겨줄 수 있다)
create policy "saved_places: 내 것만 고치기"
  on public.saved_places for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ── 확인 ─────────────────────────────────────────────────────
-- 실행 후 아래가 네 줄(select · insert · update · delete)이어야 한다.
select policyname, cmd from pg_policies
where schemaname = 'public' and tablename = 'saved_places'
order by cmd;
