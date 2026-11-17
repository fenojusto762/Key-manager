-- =============================================================================
-- KEY MANAGER — Migração 6: Loja de créditos + pagamentos (Mistic Pay)
-- Créditos só entram por confirm_payment(), que é idempotente (1 crédito por pagamento).
-- =============================================================================

create table if not exists public.credit_packages (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text,
  credits     integer not null,
  price_cents integer not null,
  active      boolean not null default true,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint pkg_name_check    check (char_length(name) between 1 and 60),
  constraint pkg_desc_check    check (description is null or char_length(description) <= 200),
  constraint pkg_credits_check check (credits between 1 and 1000000),
  constraint pkg_price_check   check (price_cents between 100 and 100000000)
);

create table if not exists public.payments (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid references public.profiles (id) on delete set null,
  username              text not null,
  package_id            uuid references public.credit_packages (id) on delete set null,
  package_name          text not null,
  credits               integer not null,
  amount_cents          integer not null,
  method                text not null default 'PIX',
  status                text not null default 'PENDING',
  provider              text not null default 'MISTICPAY',
  provider_tx_id        text,
  provider_state        text,
  payer_name            text,
  payer_document_masked text,
  qr_code_base64        text,
  qr_code_url           text,
  copy_paste            text,
  fee_cents             integer,
  paid_amount_raw       numeric,
  e2e                   text,
  flag                  text,
  credited_at           timestamptz,
  paid_at               timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint payments_status_check check (status in ('PENDING', 'APPROVED', 'REFUSED', 'CANCELED', 'REFUNDED')),
  constraint payments_amount_check check (amount_cents > 0 and credits > 0)
);
create unique index if not exists payments_provider_tx_idx on public.payments (provider_tx_id) where provider_tx_id is not null;
create index if not exists payments_user_idx   on public.payments (user_id, created_at desc);
create index if not exists payments_status_idx on public.payments (status, created_at desc);
create index if not exists payments_created_idx on public.payments (created_at desc);

drop trigger if exists packages_set_updated_at on public.credit_packages;
create trigger packages_set_updated_at before update on public.credit_packages
  for each row execute function public.km_set_updated_at();
drop trigger if exists payments_set_updated_at on public.payments;
create trigger payments_set_updated_at before update on public.payments
  for each row execute function public.km_set_updated_at();

-- Extrato de créditos: novo tipo e vínculo único com o pagamento (barreira final contra duplicidade)
alter table public.credit_transactions add column if not exists payment_id uuid references public.payments (id) on delete set null;
alter table public.credit_transactions drop constraint if exists credit_tx_type_check;
alter table public.credit_transactions add constraint credit_tx_type_check
  check (type in ('LICENSE_PURCHASE', 'ADMIN_ADD', 'ADMIN_REMOVE', 'STORE_PURCHASE'));
create unique index if not exists credit_tx_payment_unique on public.credit_transactions (payment_id) where payment_id is not null;

-- Confirmação de pagamento (idempotente) ---------------------------------------
-- p_state: estado informado pelo provedor após VERIFICAÇÃO na API (PENDENTE/COMPLETO/FALHA/CANCELADO/DEVOLVIDO...)
-- p_value_cents: valor realmente pago (centavos); precisa bater com o preço do pacote.
create or replace function public.confirm_payment(
  p_payment_id  uuid,
  p_state       text,
  p_value_cents integer default null,
  p_fee_cents   integer default null,
  p_e2e         text default null,
  p_raw_value   numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pay     public.payments%rowtype;
  v_balance integer;
  v_user    public.profiles%rowtype;
  v_status  text;
begin
  select * into v_pay from public.payments where id = p_payment_id for update;
  if not found then raise exception 'PAYMENT_NOT_FOUND'; end if;

  update public.payments
     set provider_state = p_state,
         fee_cents = coalesce(p_fee_cents, fee_cents),
         e2e = coalesce(p_e2e, e2e),
         paid_amount_raw = coalesce(p_raw_value, paid_amount_raw)
   where id = p_payment_id;

  if p_state = 'COMPLETO' then
    if v_pay.credited_at is not null then
      return jsonb_build_object('status', v_pay.status, 'credited', false, 'duplicate', true);
    end if;
    if v_pay.status in ('REFUSED', 'CANCELED') then
      -- pagamento chegou depois de recusado/cancelado: não credita automaticamente; Master revisa
      update public.payments set flag = 'PAID_AFTER_CLOSED' where id = p_payment_id;
      return jsonb_build_object('status', v_pay.status, 'credited', false, 'flag', 'PAID_AFTER_CLOSED');
    end if;
    if p_value_cents is null or p_value_cents <> v_pay.amount_cents then
      update public.payments set flag = 'AMOUNT_MISMATCH' where id = p_payment_id;
      return jsonb_build_object('status', v_pay.status, 'credited', false, 'flag', 'AMOUNT_MISMATCH');
    end if;

    select * into v_user from public.profiles where id = v_pay.user_id for update;
    if not found then
      update public.payments set status = 'APPROVED', paid_at = now(), flag = 'USER_MISSING' where id = p_payment_id;
      return jsonb_build_object('status', 'APPROVED', 'credited', false, 'flag', 'USER_MISSING');
    end if;

    v_balance := v_user.credits + v_pay.credits;
    if v_balance > 1000000000 then
      update public.payments set flag = 'BALANCE_LIMIT' where id = p_payment_id;
      return jsonb_build_object('status', v_pay.status, 'credited', false, 'flag', 'BALANCE_LIMIT');
    end if;

    perform set_config('keymanager.credit_op', 'on', true);
    update public.profiles set credits = v_balance where id = v_user.id;
    perform set_config('keymanager.credit_op', 'off', true);

    insert into public.credit_transactions
      (user_id, username, type, amount, balance_after, description, payment_id)
    values
      (v_user.id, v_user.username, 'STORE_PURCHASE', v_pay.credits, v_balance,
       'Compra: ' || v_pay.package_name, p_payment_id);

    update public.payments
       set status = 'APPROVED', credited_at = now(), paid_at = now(), flag = null
     where id = p_payment_id;

    insert into public.activity_logs (actor_id, actor_username, action, target_id, target_username, details)
    values (v_user.id, v_user.username, 'CREDITS_PURCHASED', v_user.id, v_user.username,
            jsonb_build_object('payment_id', p_payment_id, 'package', v_pay.package_name,
                               'credits', v_pay.credits, 'amount_cents', v_pay.amount_cents, 'balance', v_balance));

    return jsonb_build_object('status', 'APPROVED', 'credited', true, 'balance', v_balance);

  elsif p_state = 'FALHA' then
    if v_pay.status = 'PENDING' then update public.payments set status = 'REFUSED' where id = p_payment_id; end if;
  elsif p_state = 'CANCELADO' then
    if v_pay.status = 'PENDING' then update public.payments set status = 'CANCELED' where id = p_payment_id; end if;
  elsif p_state in ('DEVOLVIDO', 'DEVOLVIDO_PARCIAL') then
    if v_pay.status = 'APPROVED' then
      update public.payments set status = 'REFUNDED', flag = 'REFUNDED_REVIEW' where id = p_payment_id;
      insert into public.activity_logs (actor_id, actor_username, action, target_id, target_username, details)
      values (null, 'mistic', 'PAYMENT_REFUNDED', v_pay.user_id, v_pay.username,
              jsonb_build_object('payment_id', p_payment_id, 'amount_cents', v_pay.amount_cents, 'state', p_state));
    end if;
  end if;

  select status into v_status from public.payments where id = p_payment_id;
  return jsonb_build_object('status', v_status, 'credited', false);
end;
$$;

-- Resumo de vendas (Master) ------------------------------------------------------
create or replace function public.sales_summary(p_days integer default 14, p_tz text default 'America/Sao_Paulo')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := (now() at time zone p_tz)::date;
  v_result jsonb;
begin
  select jsonb_build_object(
    'revenue_cents',  coalesce(sum(amount_cents) filter (where status = 'APPROVED'), 0),
    'revenue_today_cents', coalesce(sum(amount_cents) filter (where status = 'APPROVED' and (paid_at at time zone p_tz)::date = v_today), 0),
    'revenue_30d_cents', coalesce(sum(amount_cents) filter (where status = 'APPROVED' and paid_at >= now() - interval '30 days'), 0),
    'credits_sold',   coalesce(sum(credits) filter (where status = 'APPROVED'), 0),
    'approved_count', count(*) filter (where status = 'APPROVED'),
    'pending_count',  count(*) filter (where status = 'PENDING'),
    'refused_count',  count(*) filter (where status in ('REFUSED', 'CANCELED')),
    'refunded_count', count(*) filter (where status = 'REFUNDED'),
    'flagged_count',  count(*) filter (where flag is not null),
    'buyers',         count(distinct user_id) filter (where status = 'APPROVED')
  ) into v_result from public.payments;

  v_result := v_result || jsonb_build_object(
    'by_day', (
      select coalesce(jsonb_agg(jsonb_build_object('day', d::date, 'revenue_cents', coalesce(s.rev, 0), 'count', coalesce(s.n, 0)) order by d), '[]'::jsonb)
      from generate_series(v_today - (p_days - 1), v_today, interval '1 day') d
      left join (
        select (paid_at at time zone p_tz)::date as day, sum(amount_cents) as rev, count(*) as n
        from public.payments where status = 'APPROVED' group by 1
      ) s on s.day = d::date
    ),
    'top_packages', (
      select coalesce(jsonb_agg(t order by (t->>'revenue_cents')::bigint desc), '[]'::jsonb)
      from (
        select jsonb_build_object('name', package_name, 'count', count(*), 'revenue_cents', sum(amount_cents)) t
        from public.payments where status = 'APPROVED' group by package_name
      ) x
    )
  );
  return v_result;
end;
$$;

-- RLS e permissões --------------------------------------------------------------
create or replace function public.km_is_master()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'MASTER' and status = 'ACTIVE');
$$;

alter table public.credit_packages enable row level security;
alter table public.payments enable row level security;

drop policy if exists packages_select_active on public.credit_packages;
create policy packages_select_active on public.credit_packages for select to authenticated using (active or (select public.km_is_master()));
drop policy if exists payments_select_own on public.payments;
create policy payments_select_own on public.payments for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists payments_select_master on public.payments;
create policy payments_select_master on public.payments for select to authenticated using ((select public.km_is_master()));

revoke all on public.credit_packages, public.payments from anon, authenticated;
-- Dados do QR e do pagador nunca vão direto ao cliente: leitura só por colunas seguras
grant select (id, user_id, username, package_id, package_name, credits, amount_cents, method, status, created_at, paid_at) on public.payments to authenticated;
grant select on public.credit_packages to authenticated;
grant all on public.credit_packages, public.payments to service_role;

revoke all on function public.confirm_payment(uuid, text, integer, integer, text, numeric) from public, anon, authenticated;
revoke all on function public.sales_summary(integer, text) from public, anon, authenticated;
revoke all on function public.km_is_master() from public, anon;
grant execute on function public.confirm_payment(uuid, text, integer, integer, text, numeric) to service_role;
grant execute on function public.sales_summary(integer, text) to service_role;
grant execute on function public.km_is_master() to authenticated, service_role;

-- Pacotes iniciais (o Master edita/remove na tela Vendas → Pacotes) --------------
insert into public.credit_packages (name, description, credits, price_cents, sort_order)
select * from (values
  ('Starter',  'Ideal para começar',          10,  1990, 1),
  ('Pro',      'O mais escolhido',            30,  4990, 2),
  ('Business', 'Melhor custo por crédito',   100, 12990, 3)
) v(name, description, credits, price_cents, sort_order)
where not exists (select 1 from public.credit_packages);

notify pgrst, 'reload schema';
