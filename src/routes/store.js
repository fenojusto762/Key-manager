const crypto = require('crypto');
const express = require('express');
const config = require('../config');
const { AppError, asyncHandler, throwDb } = require('../lib/errors');
const { getAdmin } = require('../lib/supabase');
const { parse, schemas } = require('../lib/validation');
const { normalizeCpf, maskCpf } = require('../lib/cpf');
const { createPixCharge } = require('../lib/mistic');
const { getPaymentConfig } = require('../lib/paymentSettings');
const { reconcilePayment, getPaymentRaw, PUBLIC_COLS } = require('../lib/payments');
const { logActivity } = require('../lib/activity');
const { checkoutLimiter } = require('../middleware/security');

const router = express.Router(); // COMPRAR CRÉDITOS
const MAX_OPEN_PENDING = 3;

// GET /api/store/config — preço fixo, limites, saldo e disponibilidade
router.get(
  '/config',
  asyncHandler(async (req, res) => {
    const cfg = await getPaymentConfig();
    res.json({
      price_cents: config.credits.priceCents,
      min: config.credits.min,
      max: config.credits.max,
      balance: req.user.credits,
      payments_enabled: cfg.configured,
    });
  })
);

// POST /api/store/checkout { credits, payer_name, payer_document } — gera a cobrança Pix
router.post(
  '/checkout',
  checkoutLimiter,
  asyncHandler(async (req, res) => {
    const body = parse(schemas.checkout, req.body); // preço enviado pelo navegador é ignorado
    const cfg = await getPaymentConfig();
    if (!cfg.configured) throw new AppError(503, 'PAYMENTS_NOT_CONFIGURED', 'Pagamentos temporariamente indisponíveis.');
    const cpf = normalizeCpf(body.payer_document);
    if (!cpf) throw new AppError(400, 'VALIDATION_ERROR', 'CPF inválido. Confira os números.');

    const admin = getAdmin();
    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count, error: cErr } = await admin
      .from('payments').select('id', { count: 'exact', head: true })
      .eq('user_id', req.user.id).eq('status', 'PENDING').gte('created_at', since);
    if (cErr) throwDb(cErr);
    if ((count ?? 0) >= MAX_OPEN_PENDING) {
      throw new AppError(429, 'TOO_MANY_PENDING', 'Você já tem pagamentos pendentes. Conclua ou aguarde-os expirar antes de gerar outro.');
    }

    // Valor calculado SOMENTE aqui (e conferido por CHECK no banco): créditos × R$ 2,00.
    const credits = body.credits;
    const amountCents = credits * config.credits.priceCents;
    const id = crypto.randomUUID(); // identificador único da transação (enviado como transactionId)
    const { error: insErr } = await admin.from('payments').insert({
      id, user_id: req.user.id, username: req.user.username,
      package_name: 'Créditos', credits, amount_cents: amountCents,
      payer_name: body.payer_name, payer_document_masked: maskCpf(cpf),
    });
    if (insErr) throwDb(insErr);

    let charge;
    try {
      charge = await createPixCharge({
        amount: amountCents / 100,
        payerName: body.payer_name,
        payerDocument: cpf,
        description: `${credits} creditos`,
        transactionId: id,
      });
    } catch (e) {
      await admin.from('payments').update({ status: 'REFUSED', provider_state: 'ERRO_CRIACAO' }).eq('id', id);
      throw e;
    }

    const { error: updErr } = await admin.from('payments').update({
      provider_tx_id: charge.providerTxId && charge.providerTxId !== id ? charge.providerTxId : null,
      qr_code_base64: charge.qrCodeBase64, qr_code_url: charge.qrCodeUrl, copy_paste: charge.copyPaste,
      provider_state: 'PENDENTE',
    }).eq('id', id);
    if (updErr) throwDb(updErr);

    await logActivity({
      actor: req.user, action: 'CHECKOUT_CREATED', target: req.user,
      details: { payment_id: id, credits, amount_cents: amountCents }, ip: req.ip,
    });
    res.status(201).json({
      payment: { id, status: 'PENDING', credits, amount_cents: amountCents, method: 'PIX', qr_code_base64: charge.qrCodeBase64, copy_paste: charge.copyPaste },
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

// GET /api/store/payments/:id — estado (confere no provedor se ainda pendente)
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
        if (!(e instanceof AppError)) throw e;
      }
    }
    let balance = null;
    if (pay.status === 'APPROVED') {
      const { data } = await getAdmin().from('profiles').select('credits').eq('id', req.user.id).single();
      balance = data?.credits ?? null;
    }
    res.json({ payment: { id: pay.id, status: pay.status, credits: pay.credits, amount_cents: pay.amount_cents }, balance });
  })
);

module.exports = router;
