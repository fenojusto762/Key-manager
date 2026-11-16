-- =============================================================================
-- KEY MANAGER — Migração 5: Dono Master (MASTER > ADMIN > USER)
-- A hierarquia é aplicada NO BANCO (gatilhos + funções), não só na interface/backend.
--   * Existe no máximo 1 MASTER; ele não pode ser excluído, suspenso, rebaixado ou renomeado.
--   * Papéis só mudam por set_user_role (somente MASTER) ou bootstrap_master (1ª vez).
--   * ADMIN só administra USER; só o MASTER administra ADMIN e a si mesmo.
-- =============================================================================

-- 1) Papel MASTER e unicidade ------------------------------------------------
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('MASTER', 'ADMIN', 'USER'));
create unique index if not exists profiles_single_master_idx on public.profiles ((true)) where role = 'MASTER';

-- 2) Gatilho de proteção do Master e dos papéis --------------------------------
create or replace function public.protect_master()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_mop text := coalesce(current_setting('keymanager.master_op', true), '');
  v_rop text := coalesce(current_setting('keymanager.role_op', true), '');
begin
  if tg_op = 'DELETE' then
    if old.role = 'MASTER' then raise exception 'MASTER_PROTECTED'; end if;
    return old;
  end if;

  if tg_op = 'INSERT' then
    if new.role = 'MASTER' and v_rop <> 'bootstrap' then raise exception 'ROLE_PROTECTED'; end if;
    if new.role = 'ADMIN' and v_rop not in ('on', 'bootstrap') then raise exception 'ROLE_PROTECTED'; end if;
    return new;
  end if;

  -- UPDATE
  if old.role = 'MASTER' then
    if new.role is distinct from old.role then raise exception 'MASTER_PROTECTED'; end if;
    if (new.username, new.status, new.display_name, new.created_by)
       is distinct from (old.username, old.status, old.display_name, old.created_by)
       and v_mop <> 'on' then
      raise exception 'MASTER_PROTECTED';
    end if;
  end if;

  if new.role is distinct from old.role then
    if new.role = 'MASTER' and v_rop <> 'bootstrap' then raise exception 'ROLE_PROTECTED'; end if;
    if v_rop not in ('on', 'bootstrap') then raise exception 'ROLE_PROTECTED'; end if;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_protect_master on public.profiles;
create trigger profiles_protect_master
  before insert or update or delete on public.profiles
  for each row execute function public.protect_master();

-- Último administrador: MASTER também conta como administrador ----------------
create or replace function public.protect_last_admin()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_losing boolean;
begin
  if tg_op = 'DELETE' then
    v_losing := true;
  else
    v_losing := (new.role not in ('ADMIN', 'MASTER') or new.status <> 'ACTIVE');
  end if;

  if old.role in ('ADMIN', 'MASTER') and old.status = 'ACTIVE' and v_losing then
    if not exists (
      select 1 from public.profiles
      where role in ('ADMIN', 'MASTER') and status = 'ACTIVE' and id <> old.id
    ) then
      raise exception 'LAST_ADMIN';
    end if;
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

-- 3) Regras de hierarquia ------------------------------------------------------
-- MASTER administra qualquer um, exceto a si mesmo; ADMIN administra somente USER.
create or replace function public.km_can_manage(p_actor uuid, p_target uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles a, public.profiles t
    where a.id = p_actor and t.id = p_target
      and a.status = 'ACTIVE' and a.id <> t.id
      and (a.role = 'MASTER' or (a.role = 'ADMIN' and t.role = 'USER'))
  );
$$;

create or replace function public.assert_manage(p_actor uuid, p_target uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  select role into v_role from public.profiles where id = p_target;
  if not found then raise exception 'USER_NOT_FOUND'; end if;
  if v_role = 'MASTER' then raise exception 'MASTER_PROTECTED'; end if;
  if not public.km_can_manage(p_actor, p_target) then raise exception 'HIERARCHY_FORBIDDEN'; end if;
end;
$$;

create or replace function public.set_user_status(p_actor uuid, p_target uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_status not in ('ACTIVE', 'SUSPENDED') then raise exception 'FORBIDDEN'; end if;
  perform public.assert_manage(p_actor, p_target);
  update public.profiles set status = p_status where id = p_target;
end;
$$;

-- Somente o MASTER altera papéis (ADMIN <-> USER). Nunca o dele mesmo.
create or replace function public.set_user_role(p_actor uuid, p_target uuid, p_role text, p_ip text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor  public.profiles%rowtype;
  v_target public.profiles%rowtype;
begin
  if p_role not in ('ADMIN', 'USER') then raise exception 'ROLE_PROTECTED'; end if;
  select * into v_actor from public.profiles where id = p_actor;
  if not found or v_actor.role <> 'MASTER' or v_actor.status <> 'ACTIVE' then raise exception 'FORBIDDEN'; end if;
  select * into v_target from public.profiles where id = p_target for update;
  if not found then raise exception 'USER_NOT_FOUND'; end if;
  if v_target.role = 'MASTER' then raise exception 'MASTER_PROTECTED'; end if;
  if v_target.role = p_role then
    return jsonb_build_object('id', p_target, 'role', p_role, 'changed', false);
  end if;

  perform set_config('keymanager.role_op', 'on', true);
  update public.profiles set role = p_role where id = p_target;
  perform set_config('keymanager.role_op', 'off', true);

  insert into public.activity_logs (actor_id, actor_username, action, target_id, target_username, details, ip)
  values (p_actor, v_actor.username, 'USER_ROLE_CHANGED', p_target, v_target.username,
          jsonb_build_object('from', v_target.role, 'to', p_role), p_ip);
  return jsonb_build_object('id', p_target, 'role', p_role, 'changed', true);
end;
$$;

-- Primeira (e única) designação do Master. Falha se já existir um.
create or replace function public.bootstrap_master(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_p public.profiles%rowtype;
begin
  if exists (select 1 from public.profiles where role = 'MASTER') then raise exception 'MASTER_EXISTS'; end if;
  select * into v_p from public.profiles where id = p_user_id for update;
  if not found then raise exception 'USER_NOT_FOUND'; end if;

  perform set_config('keymanager.role_op', 'bootstrap', true);
  perform set_config('keymanager.master_op', 'on', true);
  update public.profiles set role = 'MASTER', status = 'ACTIVE' where id = p_user_id;
  perform set_config('keymanager.role_op', 'off', true);
  perform set_config('keymanager.master_op', 'off', true);

  insert into public.activity_logs (actor_id, actor_username, action, target_id, target_username, details)
  values (p_user_id, v_p.username, 'MASTER_ASSIGNED', p_user_id, v_p.username, jsonb_build_object('from', v_p.role));
  return jsonb_build_object('id', p_user_id, 'username', v_p.username, 'role', 'MASTER');
end;
$$;

-- Dados do próprio Master: só ele, por esta função.
create or replace function public.master_update_profile(p_master_id uuid, p_display_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles where id = p_master_id and role = 'MASTER' and status = 'ACTIVE') then
    raise exception 'FORBIDDEN';
  end if;
  perform set_config('keymanager.master_op', 'on', true);
  update public.profiles set display_name = p_display_name where id = p_master_id;
  perform set_config('keymanager.master_op', 'off', true);
end;
$$;

-- 4) Créditos e licenças respeitam a hierarquia --------------------------------
create or replace function public.adjust_credits(
  p_user_id  uuid,
  p_amount   integer,
  p_admin_id uuid,
  p_note     text default null,
  p_ip       text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin   public.profiles%rowtype;
  v_target  public.profiles%rowtype;
  v_balance integer;
begin
  if p_amount is null or p_amount = 0 or abs(p_amount) > 1000000 then
    raise exception 'INVALID_AMOUNT';
  end if;

  select * into v_admin from public.profiles where id = p_admin_id;
  if not found or v_admin.role not in ('ADMIN', 'MASTER') or v_admin.status <> 'ACTIVE' then
    raise exception 'FORBIDDEN';
  end if;

  select * into v_target from public.profiles where id = p_user_id for update;
  if not found then
    raise exception 'USER_NOT_FOUND';
  end if;
  if v_target.role = 'MASTER' and v_admin.role <> 'MASTER' then
    raise exception 'MASTER_PROTECTED';
  end if;
  if v_admin.role = 'ADMIN' and v_target.role <> 'USER' then
    raise exception 'HIERARCHY_FORBIDDEN';
  end if;

  v_balance := v_target.credits + p_amount;
  if v_balance < 0 then
    raise exception 'INSUFFICIENT_CREDITS';
  end if;
  if v_balance > 1000000000 then
    raise exception 'INVALID_AMOUNT';
  end if;

  perform set_config('keymanager.credit_op', 'on', true);
  update public.profiles set credits = v_balance where id = p_user_id;
  perform set_config('keymanager.credit_op', 'off', true);

  insert into public.credit_transactions
    (user_id, username, type, amount, balance_after, description, performed_by, performed_by_username)
  values
    (p_user_id, v_target.username,
     case when p_amount > 0 then 'ADMIN_ADD' else 'ADMIN_REMOVE' end,
     p_amount, v_balance, nullif(trim(coalesce(p_note, '')), ''), p_admin_id, v_admin.username);

  insert into public.activity_logs
    (actor_id, actor_username, action, target_id, target_username, details, ip)
  values
    (p_admin_id, v_admin.username,
     case when p_amount > 0 then 'CREDITS_ADDED' else 'CREDITS_REMOVED' end,
     p_user_id, v_target.username,
     jsonb_build_object('amount', abs(p_amount), 'balance', v_balance,
                        'note', nullif(trim(coalesce(p_note, '')), '')),
     p_ip);

  return jsonb_build_object('user_id', p_user_id, 'username', v_target.username,
                            'amount', p_amount, 'balance', v_balance);
end;
$$;

create or replace function public.revoke_license(
  p_license_id uuid,
  p_admin_id   uuid,
  p_ip         text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin public.profiles%rowtype;
  v_lic   public.licenses%rowtype;
  v_owner text;
begin
  select * into v_admin from public.profiles where id = p_admin_id;
  if not found or v_admin.role not in ('ADMIN', 'MASTER') or v_admin.status <> 'ACTIVE' then
    raise exception 'FORBIDDEN';
  end if;

  select * into v_lic from public.licenses where id = p_license_id for update;
  if not found then
    raise exception 'LICENSE_NOT_FOUND';
  end if;
  if v_lic.revoked_at is not null then
    raise exception 'ALREADY_REVOKED';
  end if;

  select role into v_owner from public.profiles where id = v_lic.user_id;
  if v_owner = 'MASTER' and v_admin.role <> 'MASTER' then raise exception 'MASTER_PROTECTED'; end if;
  if v_owner = 'ADMIN' and v_admin.role <> 'MASTER' then raise exception 'HIERARCHY_FORBIDDEN'; end if;

  update public.licenses set revoked_at = now(), revoked_by = p_admin_id where id = p_license_id;

  insert into public.activity_logs
    (actor_id, actor_username, action, target_id, target_username, details, ip)
  values
    (p_admin_id, v_admin.username, 'LICENSE_REVOKED', v_lic.user_id, v_lic.owner_username,
     jsonb_build_object('license_id', v_lic.id, 'code', v_lic.code), p_ip);

  return jsonb_build_object('id', v_lic.id, 'code', v_lic.code, 'status', 'REVOKED');
end;
$$;

-- RLS: MASTER também lê tudo como administrador
create or replace function public.km_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('ADMIN', 'MASTER') and status = 'ACTIVE'
  );
$$;

-- 5) Permissões: só o backend (service_role) executa ---------------------------
revoke all on function public.km_can_manage(uuid, uuid)                    from public, anon, authenticated;
revoke all on function public.assert_manage(uuid, uuid)                    from public, anon, authenticated;
revoke all on function public.set_user_status(uuid, uuid, text)            from public, anon, authenticated;
revoke all on function public.set_user_role(uuid, uuid, text, text)       from public, anon, authenticated;
revoke all on function public.bootstrap_master(uuid)                       from public, anon, authenticated;
revoke all on function public.master_update_profile(uuid, text)            from public, anon, authenticated;
grant execute on function public.km_can_manage(uuid, uuid)                 to service_role;
grant execute on function public.assert_manage(uuid, uuid)                 to service_role;
grant execute on function public.set_user_status(uuid, uuid, text)         to service_role;
grant execute on function public.set_user_role(uuid, uuid, text, text)     to service_role;
grant execute on function public.bootstrap_master(uuid)                    to service_role;
grant execute on function public.master_update_profile(uuid, text)         to service_role;
grant execute on function public.adjust_credits(uuid, integer, uuid, text, text) to service_role;
grant execute on function public.revoke_license(uuid, uuid, text)         to service_role;

notify pgrst, 'reload schema';
