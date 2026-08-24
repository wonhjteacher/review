-- ============================================================
-- 오늘은 여기 — saved_places.category_name (F: 맞춤 추천)
--
-- Supabase 대시보드 → SQL Editor 에 통째로 붙여넣고 Run.
-- 프로젝트: food (xrngvljbtffzdbywyjva)
--
-- 여러 번 실행해도 안전하다 (add column if not exists).
-- ============================================================

-- ── 왜 필요한가 ──────────────────────────────────────────────
-- 맞춤 추천은 「내가 제일 자주 담는 카테고리」를 세서 그 카테고리의
-- 다른 가게를 찾아준다. 그러려면 담을 때 카테고리를 함께 남겨야 한다.
-- 초판 saved_places에는 이름·주소·좌표·URL만 있어서 셀 재료가 없었다.
--
-- **카카오 원본 문자열을 그대로 둔다** — "음식점 > 한식 > 국밥".
-- 마디를 잘라서 넣으면 어느 깊이로 자를지를 DB가 먼저 정해버린다.
-- 어느 마디를 쓸지는 읽는 쪽이 정한다:
--   · 카드의 작은 글씨  → 마지막 마디 ("국밥")
--   · 취향을 묶는 단위  → **두 번째 마디** ("한식")
-- 국밥·감자탕·해장국이 전부 한식으로 모여야 「자주 담는 카테고리」가 뜻을 갖는다.

alter table public.saved_places
  add column if not exists category_name text;

-- ── 이 컬럼이 생기기 전에 담긴 행 ────────────────────────────
-- null로 남는다. 지우거나 억지로 채우지 않는다 —
-- 추천 쪽이 null을 그냥 세지 않고 넘어가도록 되어 있다.
-- 손으로 채우려면 카카오에서 place_id로 조회해 넣는다:
--   update public.saved_places set category_name = '음식점 > 카페 > 테마카페 > 디저트카페'
--    where place_id = '2020991826' and category_name is null;

-- ── 확인 ─────────────────────────────────────────────────────
-- select count(*) filter (where category_name is null) as 빈칸, count(*) as 전체
--   from public.saved_places;
