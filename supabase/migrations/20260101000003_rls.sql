-- =============================================================================
-- KEY MANAGER · Migração 3/3 — Row Level Security e permissões
--
-- Modelo de segurança:
--   * Clientes (anon / authenticated) NÃO escrevem em nenhuma tabela: não há políticas
--     de INSERT/UPDATE/DELETE e os privilégios foram revogados.
--   * Clientes autenticados só LEEM: o próprio perfil, as próprias licenças/transações.
--   * ADMIN (verificado no banco por km_is_admin()) lê tudo.
--   * O backend usa a service_role (ignora RLS) e é o único que executa as funções.
-- =============================================================================

alter table public.profiles            enable row level security;
alter table public.licenses            enable row level security;
alter table public.credit_transactions enable row level security;
alter table public.activity_logs       enable row level security;
alter table public.license_plans       enable row level security;

-- profiles ---------------------------------------------------------------------
drop policy if exists profiles_select_own   on public.profiles;
drop policy if exists profiles_select_admin on public.profiles;
create policy profiles_select_own   on public.profiles
  for select to authenticated using (id = (select auth.uid()));
create policy profiles_select_admin on public.profiles
  for select to authenticated using ((select public.km_is_admin()));

-- licenses ---------------------------------------------------------------------
drop policy if exists licenses_select_own   on public.licenses;
drop policy if exists licenses_select_admin on public.licenses;
create policy licenses_select_own   on public.licenses
  for select to authenticated using (user_id = (select auth.uid()));
create policy licenses_select_admin on public.licenses
  for select to authenticated using ((select public.km_is_admin()));

-- credit_transactions ----------------------------------------------------------
drop policy if exists credit_tx_select_own   on public.credit_transactions;
drop policy if exists credit_tx_select_admin on public.credit_transactions;
create policy credit_tx_select_own   on public.credit_transactions
  for select to authenticated using (user_id = (select auth.uid()));
create policy credit_tx_select_admin on public.credit_transactions
  for select to authenticated using ((select public.km_is_admin()));

-- activity_logs ----------------------------------------------------------------
drop policy if exists activity_select_own   on public.activity_logs;
drop policy if exists activity_select_admin on public.activity_logs;
create policy activity_select_own   on public.activity_logs
  for select to authenticated using (actor_id = (select auth.uid()));
create policy activity_select_admin on public.activity_logs
  for select to authenticated using ((select public.km_is_admin()));

-- license_plans (tabela de preços é pública para usuários autenticados) --------
drop policy if exists plans_select_authenticated on public.license_plans;
create policy plans_select_authenticated on public.license_plans
  for select to authenticated using (true);

-- Privilégios de tabela --------------------------------------------------------
revoke all on public.profiles, public.licenses, public.credit_transactions,
              public.activity_logs, public.license_plans, public.licenses_view
  from anon, authenticated;

grant select on public.profiles, public.licenses, public.credit_transactions,
                public.activity_logs, public.license_plans, public.licenses_view
  to authenticated;

grant all on public.profiles, public.licenses, public.credit_transactions,
             public.activity_logs, public.license_plans, public.licenses_view
  to service_role;
grant usage, select on sequence public.credit_transactions_id_seq, public.activity_logs_id_seq to service_role;

-- Funções: somente o backend (service_role) executa ---------------------------
revoke all on function public.generate_license_code()                         from public, anon, authenticated;
revoke all on function public.generate_licenses(uuid, integer, integer, uuid, text) from public, anon, authenticated;
revoke all on function public.adjust_credits(uuid, integer, uuid, text, text)  from public, anon, authenticated;
revoke all on function public.revoke_license(uuid, uuid, text)                 from public, anon, authenticated;
revoke all on function public.validate_license(text)                           from public, anon, authenticated;
revoke all on function public.admin_dashboard_stats(integer, text)             from public, anon, authenticated;
revoke all on function public.user_dashboard_stats(uuid, integer, text)        from public, anon, authenticated;
revoke all on function public.km_is_admin()                                       from public, anon;

grant execute on function public.generate_license_code()                         to service_role;
grant execute on function public.generate_licenses(uuid, integer, integer, uuid, text) to service_role;
grant execute on function public.adjust_credits(uuid, integer, uuid, text, text)  to service_role;
grant execute on function public.revoke_license(uuid, uuid, text)                 to service_role;
grant execute on function public.validate_license(text)                           to service_role;
grant execute on function public.admin_dashboard_stats(integer, text)             to service_role;
grant execute on function public.user_dashboard_stats(uuid, integer, text)        to service_role;
grant execute on function public.km_is_admin()                                       to authenticated, service_role;

-- Atualiza o cache de esquema da API do Supabase
notify pgrst, 'reload schema';
