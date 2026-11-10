-- =============================================================================
-- KEY MANAGER · Migração 4 — Histórico de acessos (monitoramento de logins)
--
-- Registra cada tentativa de login (sucesso e falha) com IP, dispositivo, navegador
-- e localização aproximada. Somente ADMIN lê; somente o backend (service_role) grava.
-- =============================================================================

create table if not exists public.login_events (
  id          bigint generated always as identity primary key,
  user_id     uuid references public.profiles (id) on delete set null,
  username    text not null,
  success     boolean not null,
  reason      text not null default 'OK',
  ip          text,
  device      text,
  device_type text not null default 'OTHER',
  os          text,
  browser     text,
  user_agent  text,
  country     text,
  region      text,
  city        text,
  flags       text[] not null default '{}',
  suspicious  boolean not null default false,
  created_at  timestamptz not null default now(),
  constraint login_events_reason_check      check (reason in ('OK', 'INVALID_CREDENTIALS', 'SUSPENDED')),
  constraint login_events_device_type_check check (device_type in ('MOBILE', 'TABLET', 'DESKTOP', 'OTHER'))
);

create index if not exists login_events_created_idx      on public.login_events (created_at desc);
create index if not exists login_events_user_created_idx on public.login_events (user_id, created_at desc);
create index if not exists login_events_username_idx     on public.login_events (username, created_at desc);
create index if not exists login_events_ip_idx           on public.login_events (ip, created_at desc);
create index if not exists login_events_suspicious_idx   on public.login_events (created_at desc) where suspicious;

-- -----------------------------------------------------------------------------
-- record_login_event — grava o evento e calcula sinais de suspeita.
--   NEW_IP          IP nunca usado antes por este usuário
--   NEW_DEVICE      combinação dispositivo + navegador nunca usada antes
--   NEW_COUNTRY     país diferente de todos os acessos anteriores
--   AFTER_FAILURES  login bem-sucedido após 3+ falhas nos últimos 30 min
--   BRUTE_FORCE     5+ falhas em 15 min (mesmo usuário ou mesmo IP)
--   UNKNOWN_USER    tentativa com um usuário que não existe
-- Considera SUSPEITO: NEW_COUNTRY, AFTER_FAILURES, BRUTE_FORCE ou (NEW_IP + NEW_DEVICE).
-- O primeiro acesso de um usuário nunca é marcado (não há histórico para comparar).
-- -----------------------------------------------------------------------------
create or replace function public.record_login_event(
  p_user_id     uuid,
  p_username    text,
  p_success     boolean,
  p_reason      text,
  p_ip          text,
  p_device      text,
  p_device_type text,
  p_os          text,
  p_browser     text,
  p_user_agent  text,
  p_country     text,
  p_region      text,
  p_city        text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_username text := left(coalesce(nullif(trim(p_username), ''), '?'), 64);
  v_flags    text[] := '{}';
  v_prior    integer;
  v_failed   integer;
  v_susp     boolean;
begin
  if p_success and p_user_id is not null then
    select count(*) into v_prior
      from public.login_events where user_id = p_user_id and success;

    if v_prior > 0 then
      if p_ip is not null and not exists (
        select 1 from public.login_events
         where user_id = p_user_id and success and ip = p_ip) then
        v_flags := array_append(v_flags, 'NEW_IP'::text);
      end if;
      if p_device is not null and not exists (
        select 1 from public.login_events
         where user_id = p_user_id and success
           and device is not distinct from p_device and browser is not distinct from p_browser) then
        v_flags := array_append(v_flags, 'NEW_DEVICE'::text);
      end if;
      if p_country is not null and not exists (
        select 1 from public.login_events
         where user_id = p_user_id and success and country = p_country)
         and exists (select 1 from public.login_events
         where user_id = p_user_id and success and country is not null) then
        v_flags := array_append(v_flags, 'NEW_COUNTRY'::text);
      end if;
    end if;

    select count(*) into v_failed
      from public.login_events
     where username = v_username and not success
       and created_at > now() - interval '30 minutes';
    if v_failed >= 3 then
      v_flags := array_append(v_flags, 'AFTER_FAILURES'::text);
    end if;
  elsif not p_success then
    if p_user_id is null then
      v_flags := array_append(v_flags, 'UNKNOWN_USER'::text);
    end if;
    select count(*) into v_failed
      from public.login_events
     where not success and created_at > now() - interval '15 minutes'
       and (username = v_username or (p_ip is not null and ip = p_ip));
    if v_failed >= 4 then
      v_flags := array_append(v_flags, 'BRUTE_FORCE'::text);
    end if;
  end if;

  v_susp := ('NEW_COUNTRY' = any (v_flags))
         or ('AFTER_FAILURES' = any (v_flags))
         or ('BRUTE_FORCE' = any (v_flags))
         or ('NEW_IP' = any (v_flags) and 'NEW_DEVICE' = any (v_flags));

  insert into public.login_events
    (user_id, username, success, reason, ip, device, device_type, os, browser, user_agent,
     country, region, city, flags, suspicious)
  values
    (p_user_id, v_username, p_success,
     case when p_reason in ('OK', 'INVALID_CREDENTIALS', 'SUSPENDED') then p_reason else 'OK' end,
     left(p_ip, 64), left(p_device, 60),
     case when p_device_type in ('MOBILE', 'TABLET', 'DESKTOP') then p_device_type else 'OTHER' end,
     left(p_os, 60), left(p_browser, 60), left(p_user_agent, 300),
     left(p_country, 80), left(p_region, 80), left(p_city, 80), v_flags, v_susp);

  return jsonb_build_object('flags', to_jsonb(v_flags), 'suspicious', v_susp);
end;
$$;

-- -----------------------------------------------------------------------------
-- access_summary — números do topo da tela Histórico de Acessos
-- -----------------------------------------------------------------------------
create or replace function public.access_summary(p_tz text default 'America/Sao_Paulo')
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'logins_today',    count(*) filter (where success
                         and created_at >= (((now() at time zone p_tz)::date)::timestamp at time zone p_tz)),
    'logins_24h',      count(*) filter (where success),
    'failed_24h',      count(*) filter (where not success),
    'suspicious_24h',  count(*) filter (where suspicious),
    'unique_ips_24h',  count(distinct ip) filter (where ip is not null),
    'unique_users_24h',count(distinct user_id) filter (where success and user_id is not null)
  )
  from public.login_events
  where created_at >= now() - interval '24 hours';
$$;

-- RLS e permissões -------------------------------------------------------------
alter table public.login_events enable row level security;

drop policy if exists login_events_select_admin on public.login_events;
create policy login_events_select_admin on public.login_events
  for select to authenticated using ((select public.km_is_admin()));

revoke all on public.login_events from anon, authenticated;
grant select on public.login_events to authenticated;
grant all on public.login_events to service_role;
grant usage, select on sequence public.login_events_id_seq to service_role;

revoke all on function public.record_login_event(uuid, text, boolean, text, text, text, text, text, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.access_summary(text) from public, anon, authenticated;
grant execute on function public.record_login_event(uuid, text, boolean, text, text, text, text, text, text, text, text, text, text) to service_role;
grant execute on function public.access_summary(text) to service_role;

notify pgrst, 'reload schema';
