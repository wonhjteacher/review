-- ============================================================
-- 오늘은 여기 — 더미 데이터 100건 (인기 랭킹을 눈으로 확인하기 위한 것)
--
-- Supabase 대시보드 → SQL Editor 에 통째로 붙여넣고 Run.
-- 프로젝트: food (xrngvljbtffzdbywyjva)
--
-- **여러 번 실행해도 안전하다** (on conflict do nothing).
--
-- ── 왜 계정까지 만드는가 ─────────────────────────────────────
-- 인기 랭킹은 「몇 **명**이 담았는지」를 센다. 한 계정에 100건을 몰아넣으면
-- 그 숫자가 전부 1이 되어 랭킹이 서지 않는다. saved_places.user_id는
-- auth.users를 참조하므로 사람 수만큼 계정이 필요하다.
--
-- ── 지우는 법 ────────────────────────────────────────────────
-- 더미 계정만 지우면 saved_places 행은 on delete cascade로 함께 사라진다.
--   delete from auth.users where raw_user_meta_data->>'seed_data' = 'true';
--
-- ── 로그인해볼 수 있다 ───────────────────────────────────────
-- seed01@dummy.invalid ~ seed12@dummy.invalid / 비밀번호 dummy1234
-- RLS 검증에 쓴다 — 내 계정으로 담고 로그아웃한 뒤 seed01로 들어가면
-- **내가 담은 것이 보이지 않아야** 한다 (CLAUDE.md 검증 절).
-- `.invalid`는 예약 TLD라 실제로 메일이 나가지 않는다 (RFC 2606).
-- ============================================================

-- ── ① 더미 계정 12개 ─────────────────────────────────────────
-- id를 고정값으로 박아 둔다. 다시 실행해도 같은 사람이 되도록.
--
-- **토큰 칸 넷을 빈 문자열로 채우는 것이 핵심이다.**
-- confirmation_token · recovery_token · email_change_token_new · email_change 는
-- 컬럼 기본값이 없어서 손으로 넣으면 null이 된다. GoTrue는 이 넷을 Go의 string으로
-- 읽으므로 null을 만나면 조회가 통째로 실패한다:
--     AuthApiError: Database error querying schema
-- 계정은 멀쩡히 보이는데 **로그인만** 안 되는, 설명하기 어려운 상태가 된다.
-- 대시보드로 만든 계정에는 이미 ''이 들어 있어 이 함정이 없다.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data,
  confirmation_token, recovery_token, email_change_token_new, email_change
)
select
  '00000000-0000-0000-0000-000000000000',
  ('d0000000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid,
  'authenticated', 'authenticated',
  'seed' || lpad(g::text, 2, '0') || '@dummy.invalid',
  extensions.crypt('dummy1234', extensions.gen_salt('bf')),
  now(), now() - interval '70 days', now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"seed_data": true}'::jsonb,
  '', '', '', ''
from generate_series(1, 12) g
on conflict (id) do nothing;

-- 이 파일의 옛 판으로 이미 만들어 둔 계정이 있으면 여기서 고쳐진다.
update auth.users
   set confirmation_token     = coalesce(confirmation_token, ''),
       recovery_token         = coalesce(recovery_token, ''),
       email_change_token_new = coalesce(email_change_token_new, ''),
       email_change           = coalesce(email_change, '')
 where raw_user_meta_data->>'seed_data' = 'true';

-- GoTrue는 이메일 로그인에서 identities를 함께 본다.
-- 없으면 계정은 있는데 로그인만 안 되는, 설명하기 어려운 상태가 된다.
insert into auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at)
select
  u.id::text, u.id,
  jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
  'email', now() - interval '70 days', now()
from auth.users u
where u.raw_user_meta_data->>'seed_data' = 'true'
on conflict (provider, provider_id) do nothing;

-- ── ② 담은 기록 100건 ────────────────────────────────────────
-- 실제 카카오 장소다. place_id를 지어내면 place_url 링크가 죽고
-- 구글 리뷰 조회도 엉뚱한 가게를 물어온다.
--
-- 마지막 칸이 **담은 사람 수**다. 100줄을 나열하지 않고 lateral로 펼친다 —
-- 인기 순위가 어떻게 짜였는지 이 표 하나만 보면 된다.
-- 1위부터 12·11·10·9·8로 내려가 상위 5위에 동점이 없다.
--
-- **user_id를 직접 싣는다.** 앱 코드에서는 금지된 일이지만(CLAUDE.md ㉑),
-- 여기는 사람 대신 넣어주는 자리라 auth.uid()가 없다. 이 파일에서만 예외다.
insert into public.saved_places
  (user_id, place_id, place_name, category_name, road_address_name, x, y, place_url, created_at)
select
  ('d0000000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid,
  p.place_id, p.place_name, p.category_name, p.road_address_name, p.x, p.y, p.place_url,
  -- 담은 시각을 흩뿌린다. 한 시각에 100건이 몰리면 최신순 정렬이 의미를 잃는다.
  now() - (((p.ord * 7 + g * 3) % 60) * interval '1 day')
from (values
  ( 1, '26545925', '토속촌삼계탕', '음식점 > 한식 > 육류,고기 > 닭요리 > 삼계탕', '서울 종로구 자하문로5길 5', '126.971494461387', '37.5777229294346', 'http://place.map.kakao.com/26545925', 12),
  ( 2, '21326655', '광화문미진 본점', '음식점 > 한식', '서울 종로구 종로 19', '126.9799234417087', '37.570844667978704', 'http://place.map.kakao.com/21326655', 11),
  ( 3, '27306859', '정돈', '음식점 > 일식 > 돈까스,우동', '서울 종로구 대학로9길 12', '127.00109477184937', '37.58178894763119', 'http://place.map.kakao.com/27306859', 10),
  ( 4, '1949561591', '청년밥상문간', '음식점 > 한식 > 찌개,전골', '서울 성북구 보국문로11길 18-2', '127.00912148250727', '37.60874446546178', 'http://place.map.kakao.com/1949561591',  9),
  ( 5, '11553130', '커피 리브레 연남점', '음식점 > 카페 > 커피전문점', '서울 마포구 성미산로32길 20-5', '126.92372978384485', '37.56364350559978', 'http://place.map.kakao.com/11553130',  8),
  ( 6, '13559837', '삼청동수제비', '음식점 > 한식 > 수제비', '서울 종로구 삼청로 101-1', '126.98197124938', '37.5845977743306', 'http://place.map.kakao.com/13559837',  5),
  ( 7, '16050660', '스파카나폴리', '음식점 > 양식 > 이탈리안', '서울 마포구 양화로6길 28', '126.915602703838', '37.5488967594368', 'http://place.map.kakao.com/16050660',  5),
  ( 8, '12140312', '몽중헌 청담점', '음식점 > 중식 > 중국요리', '서울 강남구 도산대로 445', '127.04481610576194', '37.52429227164699', 'http://place.map.kakao.com/12140312',  5),
  ( 9, '27531028', '중앙해장', '음식점 > 한식 > 해장국', '서울 강남구 영동대로86길 17', '127.065472540919', '37.508273597184', 'http://place.map.kakao.com/27531028',  5),
  (10, '1959516004', '플리퍼스 익선점', '음식점 > 카페 > 테마카페 > 디저트카페', '서울 종로구 수표로28길 31', '126.990119900781', '37.5730804295386', 'http://place.map.kakao.com/1959516004',  5),
  (11, '27226419', '성북동면옥집', '음식점 > 한식 > 냉면', '서울 성북구 대사관로 40', '126.98863124751', '37.595893443325', 'http://place.map.kakao.com/27226419',  2),
  (12, '23300753', '쌍다리돼지불백 본점', '음식점 > 한식 > 육류,고기', '서울 성북구 성북로23길 4', '126.99568816509354', '37.593499076317705', 'http://place.map.kakao.com/23300753',  2),
  (13, '60259859', '이공김밥', '음식점 > 분식', '서울 성북구 안암로 61-6', '127.02846429973636', '37.582398196470585', 'http://place.map.kakao.com/60259859',  2),
  (14, '1192127749', '커피스토어', '음식점 > 카페', '서울 성북구 안암로5길 72', '127.022742400152', '37.5822111298985', 'http://place.map.kakao.com/1192127749',  2),
  (15, '24448306', '대성집', '음식점 > 한식 > 국밥', '서울 종로구 사직로 5', '126.96088845235445', '37.572704956161914', 'http://place.map.kakao.com/24448306',  2),
  (16, '1179567185', '오레노라멘 인사점', '음식점 > 일식 > 일본식라면', '서울 종로구 율곡로 49-4', '126.98455881787119', '37.576456761203985', 'http://place.map.kakao.com/1179567185',  2),
  (17, '8123221', '프리모바치오바치 홍대본점', '음식점 > 양식 > 이탈리안', '서울 마포구 와우산로23길 44', '126.923703730493', '37.5547839866237', 'http://place.map.kakao.com/8123221',  2),
  (18, '24855092', '빈브라더스 합정', '음식점 > 카페 > 커피전문점', '서울 마포구 토정로 35-1', '126.91498394229322', '37.54569416640838', 'http://place.map.kakao.com/24855092',  2),
  (19, '13575898', '갓덴스시 강남점', '음식점 > 일식 > 초밥,롤', '서울 강남구 테헤란로 109', '127.029090699483', '37.498777145173', 'http://place.map.kakao.com/13575898',  2),
  (20, '7815078', '대가방 본점', '음식점 > 중식 > 중국요리', '서울 강남구 봉은사로 333', '127.04292929250258', '37.51070223749141', 'http://place.map.kakao.com/7815078',  2),
  (21, '1755515956', '태조감자국', '음식점 > 한식 > 감자탕', '서울 성북구 보문로34길 43', '127.017681505368', '37.5907894486919', 'http://place.map.kakao.com/1755515956',  1),
  (22, '423978426', '수아당', '음식점 > 분식', '서울 성북구 동소문로20가길 33', '127.01802173601061', '37.59307070910963', 'http://place.map.kakao.com/423978426',  1),
  (23, '293334422', '카페루틴', '음식점 > 카페', '서울 성북구 보문로34가길 6', '127.02010933672284', '37.59170987401506', 'http://place.map.kakao.com/293334422',  1),
  (24, '1753129148', '상수냉장고', '음식점 > 한식 > 육류,고기', '서울 마포구 와우산로3길 3', '126.92273258090496', '37.546140980400246', 'http://place.map.kakao.com/1753129148',  1),
  (25, '10972091', '홍명', '음식점 > 중식', '서울 강남구 논현로131길 10', '127.029458772737', '37.5145374347634', 'http://place.map.kakao.com/10972091',  1)
) as p (ord, place_id, place_name, category_name, road_address_name, x, y, place_url, savers)
cross join lateral generate_series(1, p.savers) g
on conflict (user_id, place_id) do nothing;

-- ── 확인 ─────────────────────────────────────────────────────
-- select rank, place_name, save_count from public.popular_places(5);
--   → 담긴 수가 12 · 11 · 10 · 9 · 8 로 내려가야 한다.
