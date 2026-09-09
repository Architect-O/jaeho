-- ══════════════════════════════════════════════
-- JAEHO ERP Suite — Supabase 유저 관리 스키마
-- Supabase 대시보드 → SQL Editor → New query 에 붙여넣고 Run
-- ══════════════════════════════════════════════

-- 1) 유저 테이블
create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  username text unique not null,
  password text not null,
  role text not null default 'user' check (role in ('user','admin')),
  login_count integer not null default 0,
  created_at timestamptz not null default now(),
  last_login timestamptz
);

-- 2) RLS 활성화 (테이블 직접 접근은 전부 차단 — 아래 함수를 통해서만 접근 가능)
alter table public.users enable row level security;

-- 3) 회원가입 함수
create or replace function public.register_user(p_username text, p_password text)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_exists boolean;
begin
  if length(trim(p_username)) < 2 or length(p_password) < 4 then
    return jsonb_build_object('success', false, 'message', '아이디 2자·비밀번호 4자 이상 입력해주세요.');
  end if;

  select exists(select 1 from public.users where username = p_username) into v_exists;
  if v_exists then
    return jsonb_build_object('success', false, 'message', '이미 존재하는 아이디입니다.');
  end if;

  insert into public.users(username, password, role) values (p_username, p_password, 'user');
  return jsonb_build_object('success', true, 'message', '가입이 완료되었습니다. 로그인해주세요.');
end;
$$;

-- 4) 로그인 함수 (성공 시 role·누적 로그인 횟수 반환, 카운트 자동 증가)
create or replace function public.login_user(p_username text, p_password text)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_row public.users%rowtype;
begin
  select * into v_row from public.users where username = p_username and password = p_password;
  if not found then
    return jsonb_build_object('success', false, 'message', '아이디 또는 비밀번호가 일치하지 않습니다.');
  end if;

  update public.users
    set login_count = login_count + 1, last_login = now()
    where id = v_row.id;

  return jsonb_build_object(
    'success', true,
    'username', v_row.username,
    'role', v_row.role,
    'loginCount', v_row.login_count + 1
  );
end;
$$;

-- 5) 관리자 전용: 전체 유저 목록 + 로그인 횟수 조회
create or replace function public.admin_list_users(p_admin_username text, p_admin_password text)
returns table(username text, role text, login_count integer, created_at timestamptz, last_login timestamptz)
language plpgsql
security definer
as $$
declare
  v_is_admin boolean;
begin
  select exists(
    select 1 from public.users
    where username = p_admin_username and password = p_admin_password and role = 'admin'
  ) into v_is_admin;

  if not v_is_admin then
    raise exception '관리자 권한이 없습니다.';
  end if;

  return query
    select u.username, u.role, u.login_count, u.created_at, u.last_login
    from public.users u
    order by u.created_at asc;
end;
$$;

-- 6) 관리자 전용: 특정 유저의 역할 변경 (user ↔ admin)
create or replace function public.admin_set_role(
  p_admin_username text, p_admin_password text,
  p_target_username text, p_new_role text
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_is_admin boolean;
begin
  select exists(
    select 1 from public.users
    where username = p_admin_username and password = p_admin_password and role = 'admin'
  ) into v_is_admin;

  if not v_is_admin then
    return jsonb_build_object('success', false, 'message', '관리자 권한이 없습니다.');
  end if;

  if p_new_role not in ('user','admin') then
    return jsonb_build_object('success', false, 'message', '올바르지 않은 역할입니다.');
  end if;

  update public.users set role = p_new_role where username = p_target_username;
  return jsonb_build_object('success', true);
end;
$$;

-- 7) 최초 관리자 계정 (원하는 아이디/비번으로 수정해서 실행하세요)
insert into public.users (username, password, role)
values ('admin', 'admin123', 'admin')
on conflict (username) do nothing;
