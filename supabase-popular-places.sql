-- ============================================================
-- 오늘은 여기 — 인기 랭킹 (F: 지금 인기 맛집 TOP 5)
--
-- Supabase 대시보드 → SQL Editor 에 통째로 붙여넣고 Run.
-- 프로젝트: food (xrngvljbtffzdbywyjva)
--
-- 여러 번 실행해도 안전하다 (create index if not exists / drop function if exists).
-- ============================================================

-- ── 왜 함수인가 ──────────────────────────────────────────────
-- 랭킹은 「**모든 사람**이 담은 것」을 세는 일이다.
-- 그런데 saved_places의 select 정책은 `auth.uid() = user_id`라
-- 클라이언트가 무엇을 물어봐도 **내 것만** 돌아온다.
-- 브라우저에서 count를 세면 내 목록의 길이가 나올 뿐이다.
--
-- **RLS를 끄는 것은 답이 아니다.** 끄는 순간 publishable 키만 있는 누구나
-- 남의 담아둔 목록을 통째로 읽는다 — 키는 auth.js에 그대로 적혀 있다 (CLAUDE.md ⑯).
--
-- 그래서 **세는 일만 대신해 주는 창구**를 하나 판다.
-- 이 함수 안에서만 RLS를 넘어가고, 밖으로는 집계값만 내보낸다.

-- ── 새어나가지 않게 하는 장치 셋 ────────────────────────────
-- ① returns table에 user_id가 **아예 없다.** 실수로 흘릴 통로 자체를 만들지 않는다.
--    (select * 로 컬럼을 늘리는 대신 반환 컬럼을 손으로 적어둔 이유다)
-- ② 집계만 내보낸다. 「누가」는 count(distinct user_id) 안에서 숫자로 접힌다.
-- ③ set search_path — 호출자가 search_path를 바꿔 다른 saved_places를
--    가리키게 만드는 수법을 막는다. security definer에는 반드시 붙인다.

create index if not exists saved_places_place_user_idx
  on public.saved_places (place_id, user_id);
-- 랭킹은 place_id로 묶어 user_id를 세는 질의 하나뿐이다. 그 한 가지에 맞춘 인덱스라
-- 테이블을 읽지 않고 인덱스만으로 끝난다(index-only scan).

drop function if exists public.popular_places(integer);

create function public.popular_places(limit_count integer default 5)
returns table (
  rank              integer,
  place_id          text,
  place_name        text,
  category_name     text,
  road_address_name text,
  x                 text,
  y                 text,
  place_url         text,
  save_count        bigint
)
language sql
stable
security definer                      -- RLS를 우회하는 것은 이 함수 안에서만이다
set search_path = public, pg_temp     -- 호출자가 search_path를 바꿔치기해도 흔들리지 않게
as $$
  with counted as (
    select
      s.place_id,
      count(distinct s.user_id) as save_count,
      -- 같은 place_id인데 이름/주소가 미세하게 다른 행이 섞일 수 있다.
      -- 가장 흔한 값을 대표로 쓴다 (max()로 고르면 사전순 꼴찌가 뽑힌다).
      mode() within group (order by s.place_name)        as place_name,
      mode() within group (order by s.category_name)     as category_name,
      mode() within group (order by s.road_address_name) as road_address_name,
      mode() within group (order by s.x)                 as x,
      mode() within group (order by s.y)                 as y,
      mode() within group (order by s.place_url)         as place_url
    from public.saved_places s
    group by s.place_id
  )
  select
    (row_number() over (order by c.save_count desc, c.place_name asc))::integer,
    c.place_id, c.place_name, c.category_name, c.road_address_name,
    c.x, c.y, c.place_url, c.save_count
  from counted c
  order by c.save_count desc, c.place_name asc
  -- 인자를 그대로 믿지 않는다. null·0·10000 어느 것이 와도 1~20으로 접힌다.
  limit greatest(1, least(coalesce(limit_count, 5), 20));
$$;

comment on function public.popular_places(integer) is
  '담긴 횟수 상위 가게. 집계값만 내보내며 누가 담았는지는 반환하지 않는다.';

-- 함수의 기본 실행 권한은 PUBLIC이다. 걷어내고 필요한 역할에만 다시 준다.
-- **anon도 부를 수 있어야 한다** — 랜딩페이지의 인기 코너는 비로그인 방문자가 먼저 본다.
revoke all on function public.popular_places(integer) from public;
grant execute on function public.popular_places(integer) to anon, authenticated;

-- ── 확인 ─────────────────────────────────────────────────────
-- ① RLS는 여전히 켜져 있어야 한다 (t)
--    select relrowsecurity from pg_class where relname = 'saved_places';
--
-- ② 비로그인이 테이블을 직접 읽으면 0건, 함수로 물어보면 5건이어야 한다
--    set local role anon;
--    select (select count(*) from public.saved_places)      as 직접읽기,   -- 0
--           (select count(*) from public.popular_places(5)) as 함수로;     -- 5
--
-- ③ 반환 컬럼에 user_id가 없어야 한다
--    select string_agg(p.proargnames[i], ', ')
--    from pg_proc p, generate_subscripts(p.proargnames, 1) i
--    where p.proname = 'popular_places';
--
-- ── Supabase 보안 어드바이저에 대하여 ────────────────────────
-- 어드바이저가 이 함수에 대해 두 줄을 띄운다:
--   "Public Can Execute SECURITY DEFINER Function"
--   "Signed-In Users Can Execute SECURITY DEFINER Function"
-- **의도한 것이다.** 이 함수는 애초에 남의 집계를 보여주려고 만든 창구다.
-- 경고를 없애려고 grant를 걷어내면 랭킹 코너가 통째로 죽는다.
-- 진짜로 확인할 것은 「이 함수가 무엇을 내보내는가」이고, 그것이 위 ③이다.
