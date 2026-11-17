const crypto = require('crypto');
const express = require('express');
const config = require('../config');
const { AppError, asyncHandler, throwDb } = require('../lib/errors');
const { getAdmin } = require('../lib/supabase');
const { parse, schemas } = require('../lib/validation');
const { normalizeCpf, maskCpf } = require('../lib/cpf');
const { createPixCharge } = require('../lib/mistic');
const { reconcilePayment, getPaymentRaw, PUBLIC_COLS } = require('../lib/payments');
const { logActivity } = require('../lib/activity');
const { checkoutLimiter } = require('../middleware/security');

const router = express.Router();
const PKG_COLS = 'id, name, description, credits, price_cents, sort_order';
const MAX_OPEN_PENDING = 3;

// GET /api/store/packages — pacotes ativos + saldo
router.get(
  '/packages',
  asyncHandler(async (req, res) => {
    const { data, error } = await getAdmin()
      .from('credit_packages')
      .select(PKG_COLS)
      .eq('active', true)
      .order('sort_order', { ascending: true })
      .order('price_cents', { ascending: true });
    if (error) throwDb(error);
    res.json({ packages: data, balance: req.user.credits, payments_enabled: config.mistic.configured });
  })
);

// POST /api/store/checkout { package_id, payer_name, payer_document } — gera cobrança PIX
router.post(
  '/checkout',
  checkoutLimiter,
  asyncHandler(async (req, res) => {
    const body = parse(schemas.checkout, req.body);
    if (!config.mistic.configured) {
      throw new AppError(503, 'PAYMENTS_NOT_CONFIGURED', 'Pagamentos temporariamente indisponíveis.');
    }
    const cpf = normalizeCpf(body.payer_document);
    if (!cpf) throw new AppError(400, 'VALIDATION_ERROR', 'CPF inválido. Confira os números.');

    const admin = getAdmin();
    const { data: pkg, error: pkgErr } = await admin
      .from('credit_packages').select(`${PKG_COLS}, active`).eq('id', body.package_id).maybeSingle();
    if (pkgErr) throwDb(pkgErr);
    if (!pkg || !pkg.active) throw new AppError(404, 'PACKAGE_NOT_FOUND', 'Pacote indisponível.');

    // Limita cobranças abertas simultâneas (evita lotar o provedor/banco)
    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count, error: cErr } = await admin
      .from('payments').select('id', { count: 'exact', head: true })
      .eq('user_id', req.user.id).eq('status', 'PENDING').gte('created_at', since);
    if (cErr) throwDb(cErr);
    if ((count ?? 0) >= MAX_OPEN_PENDING) {
      throw new AppError(429, 'TOO_MANY_PENDING', 'Você já tem pagamentos pendentes. Conclua ou aguarde-os expirar antes de gerar outro.');
    }

    // O preço e a quantidade vêm SEMPRE do banco — nunca do navegador.
    const id = crypto.randomUUID();
    const { error: insErr } = await admin.from('payments').insert({
      id,
      user_id: req.user.id,
      username: req.user.username,
      package_id: pkg.id,
      package_name: pkg.name,
      credits: pkg.credits,
      amount_cents: pkg.price_cents,
      payer_name: body.payer_name,
      payer_document_masked: maskCpf(cpf),
    });
    if (insErr) throwDb(insErr);

    let charge;
    try {
      charge = await createPixCharge({
        amount: pkg.price_cents / 100,
        payerName: body.payer_name,
        payerDocument: cpf,
        description: `${pkg.credits} créditos - ${pkg.name}`.slice(0, 100),
        transactionId: id,
        webhookUrl: `${config.appUrl}/api/webhooks/mistic?token=${encodeURIComponent(config.mistic.webhookSecret)}`,
      });
    } catch (e) {
      await admin.from('payments').update({ status: 'REFUSED', provider_state: 'ERRO_CRIACAO' }).eq('id', id);
      throw e;
    }

    const { error: updErr } = await admin.from('payments').update({
      provider_tx_id: charge.providerTxId && charge.providerTxId !== id ? charge.providerTxId : null,
      qr_code_base64: charge.qrCodeBase64,
      qr_code_url: charge.qrCodeUrl,
      copy_paste: charge.copyPaste,
      provider_state: 'PENDENTE',
    }).eq('id', id);
    if (updErr) throwDb(updErr);

    await logActivity({
      actor: req.user, action: 'CHECKOUT_CREATED', target: req.user,
      details: { payment_id: id, package: pkg.name, amount_cents: pkg.price_cents }, ip: req.ip,
    });
    res.status(201).json({
      payment: {
        id, status: 'PENDING', package_name: pkg.name, credits: pkg.credits, amount_cents: pkg.price_cents,
        method: 'PIX', qr_code_base64: charge.qrCodeBase64, copy_paste: charge.copyPaste,
      },
    });
  })
);

// GET /api/store/payments?page&limit — histórico de compras do próprio usuário
router.get(
  '/payments',
  asyncHandler(async (req, res) => {
    const { page, limit } = parse(schemas.list, req.query);
    const from = (page - 1) * limit;
    const { data, error, count } = await getAdmin()
      .from('payments').select(PUBLIC_COLS, { count: 'exact' })
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false }).order('id', { ascending: false })
      .range(from, from + limit - 1);
    if (error) throwDb(error);
    res.json({ items: data, page, limit, total: count ?? 0 });
  })
);

// GET /api/store/payments/:id — estado do pagamento (confere no provedor se ainda pendente)
router.get(
  '/payments/:id',
  asyncHandler(async (req, res) => {
    const { id } = parse(schemas.idParam, req.params);
    let pay = await getPaymentRaw(id);
    if (!pay || pay.user_id !== req.user.id) throw new AppError(404, 'PAYMENT_NOT_FOUND', 'Pagamento não encontrado.');

    if (pay.status === 'PENDING' && Date.now() - new Date(pay.created_at).getTime() > 8000) {
      try {
        await reconcilePayment(pay);
        pay = await getPaymentRaw(id);
      } catch (e) {
        if (!(e instanceof AppError)) throw e; // falha temporária do provedor: segue com o estado atual
      }
    }
    let balance = null;
    if (pay.status === 'APPROVED') {
      const { data } = await getAdmin().from('profiles').select('credits').eq('id', req.user.id).single();
      balance = data?.credits ?? null;
    }
    res.json({ payment: { id: pay.id, status: pay.status, credits: pay.credits, amount_cents: pay.amount_cents, package_name: pay.package_name }, balance });
  })
);

module.exports = router;
