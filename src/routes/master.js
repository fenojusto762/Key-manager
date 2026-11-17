const express = require('express');
const config = require('../config');
const { AppError, asyncHandler, throwDb } = require('../lib/errors');
const { getAdmin } = require('../lib/supabase');
const { parse, schemas } = require('../lib/validation');
const { sanitizeSearch } = require('../lib/license');
const { logActivity } = require('../lib/activity');
const { reconcilePayment, getPaymentRaw, PAYMENT_COLS } = require('../lib/payments');

const router = express.Router(); // montado atrás de authenticate + requireMaster
const PKG_ALL = 'id, name, description, credits, price_cents, active, sort_order, created_at, updated_at';

/* -------------------------------- Vendas ---------------------------------- */
router.get(
  '/sales/summary',
  asyncHandler(async (req, res) => {
    const { data, error } = await getAdmin().rpc('sales_summary', { p_days: 14, p_tz: config.timezone });
    if (error) throwDb(error);
    res.json({ summary: data, payments_enabled: config.mistic.configured });
  })
);

router.get(
  '/sales',
  asyncHandler(async (req, res) => {
    const { page, limit, status, search } = parse(schemas.salesList, req.query);
    const from = (page - 1) * limit;
    let q = getAdmin().from('payments').select(PAYMENT_COLS, { count: 'exact' })
      .order('created_at', { ascending: false }).order('id', { ascending: false })
      .range(from, from + limit - 1);
    if (status === 'approved') q = q.eq('status', 'APPROVED');
    if (status === 'pending') q = q.eq('status', 'PENDING');
    if (status === 'refused') q = q.in('status', ['REFUSED', 'CANCELED']);
    if (status === 'refunded') q = q.eq('status', 'REFUNDED');
    if (status === 'flagged') q = q.not('flag', 'is', null);
    const s = sanitizeSearch(search);
    if (s) q = q.or(`username.ilike.%${s}%,package_name.ilike.%${s}%,payer_name.ilike.%${s}%`);
    const { data, error, count } = await q;
    if (error) throwDb(error);
    res.json({ items: data, page, limit, total: count ?? 0 });
  })
);

// POST /api/master/sales/:id/reconcile — reconsulta o provedor (idempotente)
router.post(
  '/sales/:id/reconcile',
  asyncHandler(async (req, res) => {
    const { id } = parse(schemas.idParam, req.params);
    const pay = await getPaymentRaw(id);
    if (!pay) throw new AppError(404, 'PAYMENT_NOT_FOUND', 'Pagamento não encontrado.');
    const result = await reconcilePayment(pay);
    await logActivity({ actor: req.user, action: 'PAYMENT_RECONCILED', details: { payment_id: id, result }, ip: req.ip });
    res.json({ result, payment: await getPaymentRaw(id) });
  })
);

// GET /api/master/transactions?type&page&limit — extrato de créditos de TODOS os usuários
router.get(
  '/transactions',
  asyncHandler(async (req, res) => {
    const { page, limit } = parse(schemas.list, req.query);
    const type = ['LICENSE_PURCHASE', 'ADMIN_ADD', 'ADMIN_REMOVE', 'STORE_PURCHASE'].includes(req.query.type) ? req.query.type : null;
    const from = (page - 1) * limit;
    let q = getAdmin().from('credit_transactions')
      .select('id, username, type, amount, balance_after, description, performed_by_username, payment_id, created_at', { count: 'exact' })
      .order('created_at', { ascending: false }).order('id', { ascending: false })
      .range(from, from + limit - 1);
    if (type) q = q.eq('type', type);
    const { data, error, count } = await q;
    if (error) throwDb(error);
    res.json({ items: data, page, limit, total: count ?? 0 });
  })
);

/* -------------------------------- Pacotes --------------------------------- */
router.get(
  '/packages',
  asyncHandler(async (req, res) => {
    const { data, error } = await getAdmin().from('credit_packages').select(PKG_ALL)
      .order('sort_order', { ascending: true }).order('price_cents', { ascending: true });
    if (error) throwDb(error);
    res.json({ packages: data });
  })
);

router.post(
  '/packages',
  asyncHandler(async (req, res) => {
    const body = parse(schemas.packageBody, req.body);
    const { data, error } = await getAdmin().from('credit_packages')
      .insert({ ...body, description: body.description || null }).select(PKG_ALL).single();
    if (error) throwDb(error);
    await logActivity({ actor: req.user, action: 'PACKAGE_CREATED', details: { name: data.name, credits: data.credits, price_cents: data.price_cents }, ip: req.ip });
    res.status(201).json({ package: data });
  })
);

router.patch(
  '/packages/:id',
  asyncHandler(async (req, res) => {
    const { id } = parse(schemas.idParam, req.params);
    const body = parse(schemas.packageBody, req.body);
    const { data, error } = await getAdmin().from('credit_packages')
      .update({ ...body, description: body.description || null }).eq('id', id).select(PKG_ALL).maybeSingle();
    if (error) throwDb(error);
    if (!data) throw new AppError(404, 'PACKAGE_NOT_FOUND', 'Pacote não encontrado.');
    await logActivity({ actor: req.user, action: 'PACKAGE_UPDATED', details: { name: data.name, credits: data.credits, price_cents: data.price_cents, active: data.active }, ip: req.ip });
    res.json({ package: data });
  })
);

// Pagamentos antigos guardam o nome/valor do pacote (snapshot), então excluir é seguro.
router.delete(
  '/packages/:id',
  asyncHandler(async (req, res) => {
    const { id } = parse(schemas.idParam, req.params);
    const { data, error } = await getAdmin().from('credit_packages').delete().eq('id', id).select('name').maybeSingle();
    if (error) throwDb(error);
    if (!data) throw new AppError(404, 'PACKAGE_NOT_FOUND', 'Pacote não encontrado.');
    await logActivity({ actor: req.user, action: 'PACKAGE_DELETED', details: { name: data.name }, ip: req.ip });
    res.json({ ok: true });
  })
);

module.exports = router;
