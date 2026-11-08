-- =============================================================================
-- KEY MANAGER · Migração 1/3 — Esquema
-- Tabelas, restrições, índices, gatilhos de proteção e view de licenças.
--
-- Execute no SQL Editor do Supabase (na ordem 1 → 2 → 3) ou use `supabase db push`.
-- Todas as migrações são idempotentes (podem ser executadas mais de uma vez).
-- =============================================================================

create extension if not exists pgcrypto with schema extensions;

-- Mantém updated_at sempre atualizado.
create or replace function public.km_set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- license_plans — tabela de preços (fonte única da verdade para custo em créditos)
-- -----------------------------------------------------------------------------
create table if not exists public.license_plans (
  duration_days integer primary key,
  credits       integer not null,
  label         text    not null,
  active        boolean not null default true,
  constraint license_plans_days_check    check (duration_days > 0),
  constraint license_plans_credits_check check (credits > 0)
);

insert into public.license_plans (duration_days, credits, label) values
  (1,  1,  '1 dia'),
  (7,  4,  '7 dias'),
  (30, 10, '30 dias')
on conflict (duration_days) do nothing;

-- -----------------------------------------------------------------------------
-- profiles — 1:1 com auth.users (a senha fica SOMENTE no Supabase Auth, com hash)
-- -----------------------------------------------------------------------------
create table if not exists public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  username     text not null,
  display_name text,
  role         text not null default 'USER',
  status       text not null default 'ACTIVE',
  credits      integer not null default 0,
  created_by   uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint profiles_role_check         check (role in ('ADMIN', 'USER')),
  constraint profiles_status_check       check (status in ('ACTIVE', 'SUSPENDED')),
  constraint profiles_credits_check      check (credits >= 0 and credits <= 1000000000),
  constraint profiles_username_check     check (username ~ '^[a-z0-9][a-z0-9._-]{2,31}$'),
  constraint profiles_display_name_check check (display_name is null or char_length(display_name) <= 80)
);

create unique index if not exists profiles_username_key   on public.profiles (username);
create index        if not exists profiles_created_at_idx on public.profiles (created_at desc);
create index        if not exists profiles_role_status_idx on public.profiles (role, status);

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.km_set_updated_at();

-- Créditos só podem mudar dentro das funções atômicas (generate_licenses / adjust_credits),
-- que sinalizam a operação via configuração local de transação. Qualquer outro UPDATE
-- direto em profiles.credits (inclusive com a service_role) é rejeitado.
create or replace function public.protect_profile_columns()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.id is distinct from old.id then
    raise exception 'IMMUTABLE_COLUMN' using errcode = '42501';
  end if;
  if new.credits is distinct from old.credits
     and coalesce(current_setting('keymanager.credit_op', true), '') <> 'on' then
    raise exception 'CREDITS_PROTECTED' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_protect_columns on public.profiles;
create trigger profiles_protect_columns
  before update on public.profiles
  for each row execute function public.protect_profile_columns();

-- Nunca permite remover, rebaixar ou suspender o último ADMIN ativo.
create or replace function public.protect_last_admin()
returns trigger
language plpgsql
set search_path = public
declare
  v_losing_admin boolean;
begin
  if tg_op = 'DELETE' then
    v_losing_admin := true;
  else
    v_losing_admin := (new.role <> 'ADMIN' or new.status <> 'ACTIVE');
  end if;

  if old.role = 'ADMIN' and old.status = 'ACTIVE' and v_losing_admin then
    if not exists (
      select 1 from public.profiles
      where role = 'ADMIN' and status = 'ACTIVE' and id <> old.id
    ) then
      raise exception 'LAST_ADMIN';
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_protect_last_admin on public.profiles;
create trigger profiles_protect_last_admin
  before update of role, status or delete on public.profiles
  for each row execute function public.protect_last_admin();

-- -----------------------------------------------------------------------------
-- licenses
--   * status ATIVA/EXPIRADA/REVOGADA é calculado pela view licenses_view
--     (nunca fica desatualizado, não depende de jobs agendados).
--   * user_id vira NULL se o usuário for excluído; owner_username preserva o histórico.
-- -----------------------------------------------------------------------------
create table if not exists public.licenses (
  id               uuid primary key default gen_random_uuid(),
  code             text not null,
  user_id          uuid references public.profiles (id) on delete set null,
  owner_username   text not null,
  batch_id         uuid not null,
  duration_days    integer not null,
  credit_cost      integer not null,
  created_at       timestamptz not null default now(),
  expires_at       timestamptz not null,
  revoked_at       timestamptz,
  revoked_by       uuid references public.profiles (id) on delete set null,
  validation_count bigint not null default 0,
  last_validated_at timestamptz,
  constraint licenses_code_check     check (code ~ '^[A-Z2-9]{4}(-[A-Z2-9]{4}){3}$'),
  constraint licenses_days_check     check (duration_days > 0),
  constraint licenses_cost_check     check (credit_cost >= 0),
  constraint licenses_dates_check    check (expires_at > created_at)
);

create unique index if not exists licenses_code_key         on public.licenses (code);
create index        if not exists licenses_user_created_idx on public.licenses (user_id, created_at desc);
create index        if not exists licenses_created_idx      on public.licenses (created_at desc);
create index        if not exists licenses_batch_idx        on public.licenses (batch_id);
create index        if not exists licenses_expires_idx      on public.licenses (expires_at) where revoked_at is null;
create index        if not exists licenses_revoked_by_idx   on public.licenses (revoked_by);

create or replace view public.licenses_view
with (security_invoker = true) as
select
  l.id, l.code, l.user_id, l.owner_username, l.batch_id, l.duration_days, l.credit_cost,
  l.created_at, l.expires_at, l.revoked_at, l.revoked_by, l.validation_count, l.last_validated_at,
  case
    when l.revoked_at is not null then 'REVOKED'
    when l.expires_at <= now()    then 'EXPIRED'
    else 'ACTIVE'
  end as status
from public.licenses l;

-- -----------------------------------------------------------------------------
-- credit_transactions — livro-razão de créditos (toda mudança de saldo deixa rastro)
-- -----------------------------------------------------------------------------
create table if not exists public.credit_transactions (
  id                    bigint generated always as identity primary key,
  user_id               uuid references public.profiles (id) on delete set null,
  username              text not null,
  type                  text not null,
  amount                integer not null,
  balance_after         integer not null,
  description           text,
  batch_id              uuid,
  idempotency_key       uuid,
  performed_by          uuid references public.profiles (id) on delete set null,
  performed_by_username text,
  created_at            timestamptz not null default now(),
  constraint credit_tx_type_check    check (type in ('LICENSE_PURCHASE', 'ADMIN_ADD', 'ADMIN_REMOVE')),
  constraint credit_tx_amount_check  check (amount <> 0),
  constraint credit_tx_balance_check check (balance_after >= 0)
);

create index        if not exists credit_tx_user_created_idx on public.credit_transactions (user_id, created_at desc);
create index        if not exists credit_tx_created_idx      on public.credit_transactions (created_at desc);
create index        if not exists credit_tx_performed_by_idx on public.credit_transactions (performed_by);
-- Impede cobrança duplicada quando a mesma requisição de geração é reenviada.
create unique index if not exists credit_tx_idempotency_key
  on public.credit_transactions (user_id, idempotency_key) where idempotency_key is not null;

-- -----------------------------------------------------------------------------
-- activity_logs — trilha de auditoria
-- -----------------------------------------------------------------------------
create table if not exists public.activity_logs (
  id              bigint generated always as identity primary key,
  actor_id        uuid references public.profiles (id) on delete set null,
  actor_username  text,
  action          text not null,
  target_id       uuid references public.profiles (id) on delete set null,
  target_username text,
  details         jsonb not null default '{}'::jsonb,
  ip              text,
  created_at      timestamptz not null default now()
);

create index if not exists activity_created_idx        on public.activity_logs (created_at desc);
create index if not exists activity_actor_created_idx  on public.activity_logs (actor_id, created_at desc);
create index if not exists activity_target_created_idx on public.activity_logs (target_id, created_at desc);
create index if not exists activity_action_idx         on public.activity_logs (action);
create index if not exists profiles_created_by_idx     on public.profiles (created_by);
