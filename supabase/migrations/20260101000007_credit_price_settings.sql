-- =============================================================================
-- KEY MANAGER — Migração 7: preço fixo por crédito, configurações de pagamento e Painel Créditos
-- =============================================================================

-- Preço fixo: R$ 2,00 por crédito, imposto também no banco
alter table public.payments drop column if exists package_id;
drop table if exists public.credit_packages cascade;
drop function if exists public.sales_summary(integer, text);
alter table public.payments alter column package_name set default 'Créditos';
alter table public.payments drop constraint if exists payments_credits_range_check;
alter table public.payments add constraint payments_credits_range_check check (credits between 1 and 10000);
alter table public.payments drop constraint if exists payments_price_check;
alter table public.payments add constraint payments_price_check check (amount_cents = credits * 200);

-- Credenciais da Mistic Pay: somente backend (service_role), criptografadas
create table if not exists public.payment_settings (
  id integer primary key default 1,
  client_id_enc text,
  client_secret_enc text,
  webhook_secret_enc text,
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now(),
  last_test_at timestamptz,
  last_test_ok boolean,
  last_test_message text,
  constraint payment_settings_singleton check (id = 1)
);
alter table public.payment_settings enable row level security;
revoke all on public.payment_settings from anon, authenticated;
grant all on public.payment_settings to service_role;

-- Painel Créditos -----------------------------------------------------------
create or replace function public.credits_summary(p_from date default null, p_to date default null, p_tz text default 'America/Sao_Paulo')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_today date := (now() at time zone p_tz)::date;
  v_to date := coalesce(p_to, (now() at time zone p_tz)::date);
  v_chart_from date;
  v_result jsonb;
begin
  v_chart_from := greatest(coalesce(p_from, v_to - 29), v_to - 89);
  with p as (
    select *,
      (p_from is null or (paid_at at time zone p_tz)::date >= p_from) and (paid_at at time zone p_tz)::date <= v_to as ok_paid,
      (p_from is null or (created_at at time zone p_tz)::date >= p_from) and (created_at at time zone p_tz)::date <= v_to as ok_created
    from public.payments
  )
  select jsonb_build_object(
    'revenue_cents', coalesce(sum(amount_cents) filter (where status = 'APPROVED' and ok_paid), 0),
    'credits_sold', coalesce(sum(credits) filter (where status = 'APPROVED' and ok_paid), 0),
    'sales_count', count(*) filter (where status = 'APPROVED' and ok_paid),
    'avg_ticket_cents', coalesce(round(avg(amount_cents) filter (where status = 'APPROVED' and ok_paid)), 0)::int,
    'buyers', count(distinct user_id) filter (where status = 'APPROVED' and ok_paid),
    'pending_count', count(*) filter (where status = 'PENDING' and ok_created),
    'refused_count', count(*) filter (where status in ('REFUSED', 'CANCELED') and ok_created),
    'refunded_count', count(*) filter (where status = 'REFUNDED' and ok_created),
    'flagged_count', count(*) filter (where flag is not null),
    'total_revenue_cents', coalesce(sum(amount_cents) filter (where status = 'APPROVED'), 0),
    'total_credits_sold', coalesce(sum(credits) filter (where status = 'APPROVED'), 0),
    'total_sales_count', count(*) filter (where status = 'APPROVED')
  ) into v_result from p;

  v_result := v_result || jsonb_build_object(
    'by_day', (
      select coalesce(jsonb_agg(jsonb_build_object('day', d::date, 'revenue_cents', coalesce(s.rev, 0), 'credits', coalesce(s.cr, 0), 'count', coalesce(s.n, 0)) order by d), '[]'::jsonb)
      from generate_series(v_chart_from, v_to, interval '1 day') d
      left join (
        select (paid_at at time zone p_tz)::date as day, sum(amount_cents) as rev, sum(credits) as cr, count(*) as n
        from public.payments where status = 'APPROVED' group by 1
      ) s on s.day = d::date
    ),
    'top_buyers', (
      select coalesce(jsonb_agg(t), '[]'::jsonb) from (
        select username, sum(credits)::int as credits, sum(amount_cents)::int as revenue_cents, count(*)::int as purchases
        from public.payments
        where status = 'APPROVED' and (p_from is null or (paid_at at time zone p_tz)::date >= p_from) and (paid_at at time zone p_tz)::date <= v_to
        group by username order by sum(amount_cents) desc limit 5
      ) t
    )
  );
  return v_result;
end;
$$;

create or replace function public.credits_buyers(p_search text default null, p_limit integer default 15, p_offset integer default 0)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_result jsonb;
begin
  with b as (
    select user_id, username,
      count(*) filter (where status = 'APPROVED')::int as purchases,
      count(*)::int as attempts,
      coalesce(sum(credits) filter (where status = 'APPROVED'), 0)::int as credits,
      coalesce(sum(amount_cents) filter (where status = 'APPROVED'), 0)::int as total_cents,
      max(paid_at) as last_purchase
    from public.payments
    where p_search is null or p_search = '' or username ilike '%' || p_search || '%' or payer_name ilike '%' || p_search || '%'
    group by user_id, username
  )
  select jsonb_build_object(
    'total', (select count(*) from b),
    'items', coalesce((select jsonb_agg(to_jsonb(x)) from (select * from b order by total_cents desc, username limit least(p_limit, 100) offset greatest(p_offset, 0)) x), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;

revoke all on function public.credits_summary(date, date, text) from public, anon, authenticated;
revoke all on function public.credits_buyers(text, integer, integer) from public, anon, authenticated;
grant execute on function public.credits_summary(date, date, text) to service_role;
grant execute on function public.credits_buyers(text, integer, integer) to service_role;

notify pgrst, 'reload schema';
