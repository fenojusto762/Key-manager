const express = require('express');
const config = require('../config');
const { AppError, asyncHandler, throwDb } = require('../lib/errors');
const { getAdmin } = require('../lib/supabase');
const { parse, schemas } = require('../lib/validation');
const { sanitizeSearch } = require('../lib/license');
const { logActivity } = require('../lib/activity');
const { reconcilePayment, getPaymentRaw, PAYMENT_COLS } = require('../lib/payments');
const settings = require('../lib/paymentSettings');
const { testConnection } = require('../lib/mistic');

const router = express.Router(); // PAINEL CRÉDITOS — montado atrás de authenticate + requireMaster

/* ----------------------------- Painel Créditos ---------------------------- */
router.get(
  '/credits/summary',
  asyncHandler(async (req, res) => {
    const { from, to } = parse(schemas.periodQuery, req.query);
    const { data, error } = await getAdmin().rpc('credits_summary', { p_from: from ?? null, p_to: to ?? null, p_tz: config.timezone });
    if (error) throwDb(error);
    const cfg = await settings.getPaymentConfig();
    res.json({ summary: data, payments_enabled: cfg.configured });
  })
);

// Transações: filtros por status, período, usuário e busca (usuário, pagador, id da transação, E2E)
router.get(
  '/credits/payments',
  asyncHandler(async (req, res) => {
    const { page, limit, status, search, user_id, from, to } = parse(schemas.salesList, req.query);
    const off = (page - 1) * limit;
    let q = getAdmin().from('payments').select(PAYMENT_COLS, { count: 'exact' })
      .order('created_at', { ascending: false }).order('id', { ascending: false })
      .range(off, off + limit - 1);
    if (status === 'approved') q = q.eq('status', 'APPROVED');
    if (status === 'pending') q = q.eq('status', 'PENDING');
    if (status === 'refused') q = q.in('status', ['REFUSED', 'CANCELED']);
    if (status === 'refunded') q = q.eq('status', 'REFUNDED');
    if (status === 'flagged') q = q.not('flag', 'is', null);
    if (user_id) q = q.eq('user_id', user_id);
    // período em horário de Brasília (UTC-3), pela data de criação
    if (from) q = q.gte('created_at', `${from}T00:00:00-03:00`);
    if (to) q = q.lt('created_at', new Date(new Date(`${to}T00:00:00-03:00`).getTime() + 86400000).toISOString());
    const s = sanitizeSearch(search);
    if (s) q = q.or(`username.ilike.%${s}%,payer_name.ilike.%${s}%,provider_tx_id.ilike.%${s}%,e2e.ilike.%${s}%`);
    const { data, error, count } = await q;
    if (error) throwDb(error);
    res.json({ items: data, page, limit, total: count ?? 0 });
  })
);

router.get(
  '/credits/buyers',
  asyncHandler(async (req, res) => {
    const { page, limit, search } = parse(schemas.salesList, req.query);
    const { data, error } = await getAdmin().rpc('credits_buyers', {
      p_search: sanitizeSearch(search) || null, p_limit: limit, p_offset: (page - 1) * limit,
    });
    if (error) throwDb(error);
    res.json({ items: data.items, total: data.total, page, limit });
  })
);

router.post(
  '/credits/payments/:id/reconcile',
  asyncHandler(async (req, res) => {
    const { id } = parse(schemas.idParam, req.params);
    const pay = await getPaymentRaw(id);
    if (!pay) throw new AppError(404, 'PAYMENT_NOT_FOUND', 'Pagamento não encontrado.');
    const result = await reconcilePayment(pay);
    await logActivity({ actor: req.user, action: 'PAYMENT_RECONCILED', details: { payment_id: id, result }, ip: req.ip });
    res.json({ result, payment: await getPaymentRaw(id) });
  })
);

router.get(
  '/credits/transactions',
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

/* ------------------------ Configurações de pagamento ----------------------- */
router.get(
  '/payment-settings',
  asyncHandler(async (req, res) => {
    res.json({ settings: await settings.getPublicSettings() });
  })
);

// PUT { client_id?, client_secret? } — campo vazio mantém o valor salvo; o segredo nunca volta nas respostas
router.put(
  '/payment-settings',
  asyncHandler(async (req, res) => {
    const body = parse(schemas.paymentSettings, req.body);
    const clientId = body.client_id || '';
    const clientSecret = body.client_secret || '';
    if (clientId && clientId.length < 6) throw new AppError(400, 'VALIDATION_ERROR', 'Client ID muito curto.');
    if (clientSecret && clientSecret.length < 6) throw new AppError(400, 'VALIDATION_ERROR', 'Client Secret muito curto.');
    if (!config.encryptionKey || config.encryptionKey.length < 32) {
      throw new AppError(503, 'ENCRYPTION_NOT_CONFIGURED', 'O servidor não tem APP_ENCRYPTION_KEY (mín. 32 caracteres). Cadastre na Vercel e faça redeploy.');
    }
    const r = await settings.saveCredentials({ clientId, clientSecret }, req.user.id);
    if (r.missing) throw new AppError(400, 'VALIDATION_ERROR', 'Informe o Client ID e o Client Secret.');
    await logActivity({
      actor: req.user, action: 'PAYMENT_SETTINGS_UPDATED',
      details: { client_id_changed: Boolean(clientId), client_secret_changed: Boolean(clientSecret) }, ip: req.ip,
    });
    res.json({ settings: await settings.getPublicSettings() });
  })
);

router.post(
  '/payment-settings/test',
  asyncHandler(async (req, res) => {
    const cfg = await settings.getPaymentConfig();
    const result = await testConnection(cfg);
    if (cfg.source === 'database') await settings.recordTest(result.ok, result.message);
    await logActivity({ actor: req.user, action: 'PAYMENT_SETTINGS_TESTED', details: { ok: result.ok }, ip: req.ip });
    res.json({ result, settings: await settings.getPublicSettings() });
  })
);

router.post(
  '/payment-settings/rotate-webhook-secret',
  asyncHandler(async (req, res) => {
    const r = await settings.rotateWebhookSecret(req.user.id);
    if (r.missing) throw new AppError(400, 'VALIDATION_ERROR', 'Salve o Client ID e o Client Secret antes.');
    await logActivity({ actor: req.user, action: 'PAYMENT_WEBHOOK_SECRET_ROTATED', ip: req.ip });
    res.json({ settings: await settings.getPublicSettings() });
  })
);

module.exports = router;
