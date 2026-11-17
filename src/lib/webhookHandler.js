const crypto = require('crypto');
const config = require('../config');
const { getAdmin } = require('./supabase');
const { reconcilePayment } = require('./payments');
const { logActivity } = require('./activity');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function tokenOk(given) {
  const a = Buffer.from(String(given ?? ''));
  const b = Buffer.from(config.mistic.webhookSecret || '');
  return b.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * Webhook da Mistic Pay. A Mistic Pay não assina o webhook; por isso (1) exigimos um segredo na URL e
 * (2) NUNCA creditamos com base no corpo recebido: consultamos o estado real na API do provedor.
 * Duplicatas são seguras (confirm_payment é idempotente).
 */
async function handleMisticWebhook(req, res) {
  if (!tokenOk(req.query.token)) return res.status(401).json({ ok: false });
  const body = req.body || {};
  if (body.event === 'INFRACTION') return res.json({ ok: true, ignored: 'infraction' });

  const txId = String(body.transactionId ?? '').trim();
  if (!txId || txId.length > 100) return res.json({ ok: true, ignored: 'no_transaction' });

  try {
    const admin = getAdmin();
    let q = admin.from('payments').select('id, provider_tx_id, status, amount_cents, created_at');
    q = UUID.test(txId) ? q.or(`id.eq.${txId},provider_tx_id.eq.${txId}`) : q.eq('provider_tx_id', txId);
    const { data: pay, error } = await q.maybeSingle();
    if (error) throw error;
    if (!pay) return res.json({ ok: true, ignored: 'unknown_transaction' });

    const result = await reconcilePayment(pay, { e2e: body.e2e });
    if (result?.credited) await logActivity({ actorUsername: 'mistic', action: 'PAYMENT_CONFIRMED', details: { payment_id: pay.id }, ip: req.ip });
    return res.json({ ok: true });
  } catch (e) {
    console.error('[webhook]', e?.message ?? e);
    return res.status(500).json({ ok: false }); // o provedor tentará de novo
  }
}

module.exports = { handleMisticWebhook, tokenOk };
