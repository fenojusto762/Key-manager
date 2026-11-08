const { getAdmin } = require('./supabase');
const { throwDb } = require('./errors');
const { parse, schemas } = require('./validation');
const { sanitizeSearch } = require('./license');

const LICENSE_COLS =
  'id, code, user_id, owner_username, batch_id, duration_days, credit_cost, created_at, expires_at, revoked_at, validation_count, last_validated_at, status';

/**
 * Lista licenças com paginação, filtro por status e busca.
 * Para usuários comuns passe { userId } — o filtro é imposto no servidor e o parâmetro user_id é ignorado.
 */
async function listLicenses(query, { userId } = {}) {
  const { page, limit, status, search, user_id } = parse(schemas.licenseList, query);
  const from = (page - 1) * limit;

  let q = getAdmin()
    .from('licenses_view')
    .select(LICENSE_COLS, { count: 'exact' })
    .order('created_at', { ascending: false })
    .order('id', { ascending: true })
    .range(from, from + limit - 1);

  const owner = userId ?? user_id;
  if (owner) q = q.eq('user_id', owner);
  if (status) q = q.eq('status', status);

  const s = sanitizeSearch(search);
  if (s) {
    q = userId ? q.ilike('code', `%${s}%`) : q.or(`code.ilike.%${s}%,owner_username.ilike.%${s}%`);
  }

  const { data, error, count } = await q;
  if (error) throwDb(error);
  return { items: data, page, limit, total: count ?? 0 };
}

async function listTransactions(query, { userId }) {
  const { page, limit } = parse(schemas.list, query);
  const from = (page - 1) * limit;
  const { data, error, count } = await getAdmin()
    .from('credit_transactions')
    .select('id, type, amount, balance_after, description, batch_id, performed_by_username, created_at', {
      count: 'exact',
    })
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(from, from + limit - 1);
  if (error) throwDb(error);
  return { items: data, page, limit, total: count ?? 0 };
}

module.exports = { listLicenses, listTransactions, LICENSE_COLS };
