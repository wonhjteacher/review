-- ============================================================
-- 오늘은 여기 — saved_places 테이블 (Phase 1, F1 계정 저장)
--
-- Supabase 대시보드 → SQL Editor 에 통째로 붙여넣고 Run.
-- 프로젝트: food (xrngvljbtffzdbywyjva) — auth.js의 SUPABASE_URL과 같은 곳이어야 한다.
--
-- 여러 번 실행해도 안전하다 (if not exists / drop policy if exists).
-- ============================================================

create table if not exists public.saved_places (
  -- 행 자체의 식별자. 카카오 id와 섞이지 않도록 따로 둔다.
  id uuid primary key default gen_random_uuid(),

  -- 누가 담았는지. 기본값이 auth.uid()라 **클라이언트가 보내지 않는다.**
  -- 코드에서 user_id를 만들어 넣지 않는 것이 규칙이고, 그 규칙을 DB가 강제한다.
  user_id uuid not null default auth.uid()
    references auth.users (id) on delete cascade,

  -- 카카오 로컬 API가 주는 값들. 이름을 그대로 쓴다 — 매핑 표가 생기지 않게.
  place_id          text not null,
  place_name        text not null,
  road_address_name text,

  -- 좌표. ⑬에 따라 x가 경도, y가 위도다.
  -- /api/search가 카카오 원본을 **문자열 그대로** 내려보내므로 text로 받는다.
  -- numeric으로 바꾸면 빈 문자열이 0(기니만 앞바다)으로 들어가는 ⑬의 함정이 DB까지 내려온다.
  x text,
  y text,

  place_url text,

  created_at timestamptz not null default now(),

  -- 같은 사람이 같은 가게를 두 번 담지 못하게. 담기 연타의 방어선이 여기다.
  unique (user_id, place_id)
);

-- 마이페이지는 "내 것 전부를 최신순"으로만 읽는다. 그 한 가지 질의에 맞춘 인덱스.
create index if not exists saved_places_user_created_idx
  on public.saved_places (user_id, created_at desc);

-- ── 보안 규칙 (RLS) ──────────────────────────────────────────
-- 이것을 켜지 않으면 publishable 키만 있는 누구나 남의 목록을 읽는다 (CLAUDE.md ⑯).
alter table public.saved_places enable row level security;

drop policy if exists "saved_places: 내 것만 읽기"   on public.saved_places;
drop policy if exists "saved_places: 내 것만 넣기"   on public.saved_places;
drop policy if exists "saved_places: 내 것만 지우기" on public.saved_places;

-- 읽기 — 클라이언트가 조건 없이 전체를 요청해도 서버가 자기 것만 돌려준다.
-- 거르는 일은 창고 담당이라 프론트에 .eq('user_id', ...)를 쓰지 않는다.
create policy "saved_places: 내 것만 읽기"
  on public.saved_places for select
  to authenticated
  using (auth.uid() = user_id);

-- 넣기 — user_id 기본값이 auth.uid()이므로 클라이언트가 보내지 않아도 통과한다.
-- 남의 id를 손으로 실어보내면 여기서 막힌다.
create policy "saved_places: 내 것만 넣기"
  on public.saved_places for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "saved_places: 내 것만 지우기"
  on public.saved_places for delete
  to authenticated
  using (auth.uid() = user_id);

-- update 정책은 일부러 만들지 않는다. 담기는 넣기와 지우기뿐이라
-- 없는 권한은 주지 않는다. 나중에 메모 같은 것이 붙으면 그때 추가한다.
