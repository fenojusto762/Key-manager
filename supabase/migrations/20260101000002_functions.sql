-- =============================================================================
-- KEY MANAGER · Migração 2/3 — Funções (operações atômicas, validação, estatísticas)
--
-- Todas as funções abaixo são SECURITY DEFINER e só podem ser executadas pela
-- service_role (backend). O acesso é revogado de anon/authenticated na migração 3.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Código de licença: 16 caracteres aleatórios (80 bits) no formato XXXX-XXXX-XXXX-XXXX.
-- Alfabeto de 32 símbolos sem caracteres ambíguos (0, 1, I, O) — uniforme, pois 256 % 32 = 0.
-- -----------------------------------------------------------------------------
create or replace function public.generate_license_code()
returns text
language plpgsql
volatile
set search_path = public, extensions
as $$
declare
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_bytes    bytea := gen_random_bytes(16);
  v_result   text := '';
  i          integer;
begin
  for i in 0..15 loop
    v_result := v_result || substr(v_alphabet, (get_byte(v_bytes, i) & 31) + 1, 1);
    if i in (3, 7, 11) then
      v_result := v_result || '-';
    end if;
  end loop;
  return v_result;
end;
$$;

-- -----------------------------------------------------------------------------
-- generate_licenses — gera licenças E debita créditos na MESMA transação.
--   * A linha do usuário é travada (FOR UPDATE): requisições concorrentes são serializadas.
--   * Saldo insuficiente aborta tudo (nada é gerado, nada é cobrado).
--   * p_idempotency_key evita cobrança duplicada em reenvios da mesma requisição.
-- -----------------------------------------------------------------------------
create or replace function public.generate_licenses(
  p_user_id         uuid,
  p_quantity        integer,
  p_days            integer,
  p_idempotency_key uuid default null,
  p_ip              text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_profile   public.profiles%rowtype;
  v_unit_cost integer;
  v_total     integer;
  v_batch     uuid;
  v_now       timestamptz := now();
  v_balance   integer;
  v_replayed  boolean := false;
  v_attempts  integer;
  v_licenses  jsonb;
  v_count     integer;
  v_days      integer;
  i           integer;
begin
  if p_quantity is null or p_quantity < 1 or p_quantity > 100 then
    raise exception 'INVALID_QUANTITY';
  end if;

  select * into v_profile from public.profiles where id = p_user_id for update;
  if not found then
    raise exception 'USER_NOT_FOUND';
  end if;
  if v_profile.status <> 'ACTIVE' then
    raise exception 'ACCOUNT_SUSPENDED';
  end if;

  -- Reenvio da mesma requisição: devolve o lote já criado, sem cobrar de novo.
  if p_idempotency_key is not null then
    select t.batch_id into v_batch
    from public.credit_transactions t
    where t.user_id = p_user_id and t.idempotency_key = p_idempotency_key;
    if found then
      v_replayed := true;
    end if;
  end if;

  if not v_replayed then
    select p.credits into v_unit_cost
    from public.license_plans p
    where p.duration_days = p_days and p.active;
    if not found then
      raise exception 'INVALID_PLAN';
    end if;

    v_total := v_unit_cost * p_quantity;
    if v_profile.credits < v_total then
      raise exception 'INSUFFICIENT_CREDITS';
    end if;

    v_batch := gen_random_uuid();

    perform set_config('keymanager.credit_op', 'on', true);
    update public.profiles
       set credits = credits - v_total
     where id = p_user_id
    returning credits into v_balance;
    perform set_config('keymanager.credit_op', 'off', true);

    insert into public.credit_transactions
      (user_id, username, type, amount, balance_after, description, batch_id,
       idempotency_key, performed_by, performed_by_username)
    values
      (p_user_id, v_profile.username, 'LICENSE_PURCHASE', -v_total, v_balance,
       format('%s licença(s) de %s dia(s)', p_quantity, p_days), v_batch,
       p_idempotency_key, p_user_id, v_profile.username);

    for i in 1..p_quantity loop
      v_attempts := 0;
      loop
        begin
          insert into public.licenses
            (code, user_id, owner_username, batch_id, duration_days, credit_cost, created_at, expires_at)
          values
            (public.generate_license_code(), p_user_id, v_profile.username, v_batch,
             p_days, v_unit_cost, v_now, v_now + make_interval(days => p_days));
          exit;
        exception when unique_violation then
          v_attempts := v_attempts + 1;
          if v_attempts > 10 then
            raise exception 'CODE_GENERATION_FAILED';
          end if;
        end;
      end loop;
    end loop;

    insert into public.activity_logs
      (actor_id, actor_username, action, target_id, target_username, details, ip)
    values
      (p_user_id, v_profile.username, 'LICENSES_GENERATED', p_user_id, v_profile.username,
       jsonb_build_object('batch_id', v_batch, 'quantity', p_quantity, 'duration_days', p_days,
                          'total_cost', v_total, 'balance', v_balance),
       p_ip);
  else
    v_balance := v_profile.credits;
  end if;

  select
    jsonb_agg(jsonb_build_object(
      'id', l.id,
      'code', l.code,
      'duration_days', l.duration_days,
      'created_at', l.created_at,
      'expires_at', l.expires_at,
      'status', case when l.revoked_at is not null then 'REVOKED'
                     when l.expires_at <= now() then 'EXPIRED'
                     else 'ACTIVE' end
    ) order by l.code),
    count(*)::integer,
    min(l.duration_days),
    min(l.credit_cost)
  into v_licenses, v_count, v_days, v_unit_cost
  from public.licenses l
  where l.batch_id = v_batch;

  return jsonb_build_object(
    'batch_id', v_batch,
    'quantity', v_count,
    'duration_days', v_days,
    'unit_cost', v_unit_cost,
    'total_cost', v_count * v_unit_cost,
    'balance', v_balance,
    'replayed', v_replayed,
    'licenses', coalesce(v_licenses, '[]'::jsonb)
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- adjust_credits — adiciona (p_amount > 0) ou remove (p_amount < 0) créditos.
-- O próprio banco confirma que p_admin_id é um ADMIN ativo.
-- -----------------------------------------------------------------------------
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
  if not found or v_admin.role <> 'ADMIN' or v_admin.status <> 'ACTIVE' then
    raise exception 'FORBIDDEN';
  end if;

  select * into v_target from public.profiles where id = p_user_id for update;
  if not found then
    raise exception 'USER_NOT_FOUND';
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

  return jsonb_build_object(
    'user_id', p_user_id,
    'username', v_target.username,
    'amount', p_amount,
    'balance', v_balance
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- revoke_license — revoga uma licença (somente ADMIN ativo)
-- -----------------------------------------------------------------------------
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
begin
  select * into v_admin from public.profiles where id = p_admin_id;
  if not found or v_admin.role <> 'ADMIN' or v_admin.status <> 'ACTIVE' then
    raise exception 'FORBIDDEN';
  end if;

  select * into v_lic from public.licenses where id = p_license_id for update;
  if not found then
    raise exception 'LICENSE_NOT_FOUND';
  end if;
  if v_lic.revoked_at is not null then
    raise exception 'ALREADY_REVOKED';
  end if;

  update public.licenses
     set revoked_at = now(), revoked_by = p_admin_id
   where id = p_license_id;

  insert into public.activity_logs
    (actor_id, actor_username, action, target_id, target_username, details, ip)
  values
    (p_admin_id, v_admin.username, 'LICENSE_REVOKED', v_lic.user_id, v_lic.owner_username,
     jsonb_build_object('license_id', v_lic.id, 'code', v_lic.code), p_ip);

  return jsonb_build_object('id', v_lic.id, 'code', v_lic.code, 'status', 'REVOKED');
end;
$$;

-- -----------------------------------------------------------------------------
-- validate_license — consulta pública (via backend). Atualiza contador de consultas.
-- Não retorna nenhum dado do proprietário.
-- -----------------------------------------------------------------------------
create or replace function public.validate_license(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lic    public.licenses%rowtype;
  v_status text;
begin
  update public.licenses
     set validation_count = validation_count + 1,
         last_validated_at = now()
   where code = p_code
  returning * into v_lic;

  if not found then
    return jsonb_build_object('found', false);
  end if;

  v_status := case
    when v_lic.revoked_at is not null then 'REVOKED'
    when v_lic.expires_at <= now()    then 'EXPIRED'
    else 'ACTIVE'
  end;

  return jsonb_build_object('found', true, 'status', v_status, 'expires_at', v_lic.expires_at);
end;
$$;

-- -----------------------------------------------------------------------------
-- Estatísticas do dashboard administrativo
-- -----------------------------------------------------------------------------
create or replace function public.admin_dashboard_stats(
  p_days integer default 14,
  p_tz   text    default 'America/Sao_Paulo'
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with params as (
    select greatest(least(coalesce(p_days, 14), 90), 1) as d
  ),
  days as (
    select g::date as day
    from params,
         generate_series(
           ((now() at time zone p_tz)::date - (params.d - 1))::timestamp,
           (now() at time zone p_tz)::date::timestamp,
           interval '1 day'
         ) as g
  ),
  lic as (
    select (created_at at time zone p_tz)::date as day, count(*) as c
    from public.licenses
    group by 1
  ),
  spent as (
    select (created_at at time zone p_tz)::date as day, sum(-amount) as s
    from public.credit_transactions
    where type = 'LICENSE_PURCHASE'
    group by 1
  )
  select jsonb_build_object(
    'total_users',      (select count(*) from public.profiles),
    'active_users',     (select count(*) from public.profiles where status = 'ACTIVE'),
    'suspended_users',  (select count(*) from public.profiles where status = 'SUSPENDED'),
    'total_credits',    (select coalesce(sum(credits), 0) from public.profiles),
    'total_licenses',   (select count(*) from public.licenses),
    'active_licenses',  (select count(*) from public.licenses where revoked_at is null and expires_at > now()),
    'expired_licenses', (select count(*) from public.licenses where revoked_at is null and expires_at <= now()),
    'revoked_licenses', (select count(*) from public.licenses where revoked_at is not null),
    'by_duration', (
      select coalesce(jsonb_agg(jsonb_build_object('days', duration_days, 'count', c) order by duration_days), '[]'::jsonb)
      from (select duration_days, count(*) as c from public.licenses group by 1) x
    ),
    'daily', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'date', to_char(d.day, 'YYYY-MM-DD'),
               'licenses', coalesce(l.c, 0),
               'credits', coalesce(s.s, 0)
             ) order by d.day), '[]'::jsonb)
      from days d
      left join lic l   on l.day = d.day
      left join spent s on s.day = d.day
    )
  );
$$;

-- -----------------------------------------------------------------------------
-- Estatísticas de um único usuário (painel do usuário e detalhes no admin)
-- -----------------------------------------------------------------------------
create or replace function public.user_dashboard_stats(
  p_user_id uuid,
  p_days    integer default 14,
  p_tz      text    default 'America/Sao_Paulo'
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with params as (
    select greatest(least(coalesce(p_days, 14), 90), 1) as d
  ),
  days as (
    select g::date as day
    from params,
         generate_series(
           ((now() at time zone p_tz)::date - (params.d - 1))::timestamp,
           (now() at time zone p_tz)::date::timestamp,
           interval '1 day'
         ) as g
  ),
  lic as (
    select (created_at at time zone p_tz)::date as day, count(*) as c
    from public.licenses
    where user_id = p_user_id
    group by 1
  ),
  spent as (
    select (created_at at time zone p_tz)::date as day, sum(-amount) as s
    from public.credit_transactions
    where user_id = p_user_id and type = 'LICENSE_PURCHASE'
    group by 1
  )
  select jsonb_build_object(
    'credits',          (select credits from public.profiles where id = p_user_id),
    'total_licenses',   (select count(*) from public.licenses where user_id = p_user_id),
    'active_licenses',  (select count(*) from public.licenses where user_id = p_user_id and revoked_at is null and expires_at > now()),
    'expired_licenses', (select count(*) from public.licenses where user_id = p_user_id and revoked_at is null and expires_at <= now()),
    'revoked_licenses', (select count(*) from public.licenses where user_id = p_user_id and revoked_at is not null),
    'total_spent',      (select coalesce(sum(-amount), 0) from public.credit_transactions where user_id = p_user_id and type = 'LICENSE_PURCHASE'),
    'by_duration', (
      select coalesce(jsonb_agg(jsonb_build_object('days', duration_days, 'count', c) order by duration_days), '[]'::jsonb)
      from (select duration_days, count(*) as c from public.licenses where user_id = p_user_id group by 1) x
    ),
    'daily', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'date', to_char(d.day, 'YYYY-MM-DD'),
               'licenses', coalesce(l.c, 0),
               'credits', coalesce(s.s, 0)
             ) order by d.day), '[]'::jsonb)
      from days d
      left join lic l   on l.day = d.day
      left join spent s on s.day = d.day
    )
  );
$$;

-- -----------------------------------------------------------------------------
-- is_admin — usada pelas políticas RLS (lê o papel no banco, nunca no cliente)
-- -----------------------------------------------------------------------------
create or replace function public.km_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'ADMIN' and status = 'ACTIVE'
  );
$$;
