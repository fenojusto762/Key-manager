const { getAdmin } = require('./supabase');
const { throwDb } = require('./errors');
const { checkTransaction } = require('./mistic');

const PAYMENT_COLS =
  'id, user_id, username, package_id, package_name, credits, amount_cents, method, status, provider_state, payer_name, payer_document_masked, fee_cents, e2e, flag, credited_at, paid_at, created_at';
const PUBLIC_COLS = 'id, package_name, credits, amount_cents, method, status, paid_at, created_at';

/** O valor pago pode vir em reais (19.9) ou centavos (1990): aceitamos o que bate com o preço. */
function paidCents(value, amountCents) {
  if (value == null || !Number.isFinite(value)) return null;
  if (Math.round(value * 100) === amountCents) return amountCents;
  if (Number.isInteger(value) && value === amountCents) return amountCents;
  return Math.round(value * 100);
}

/**
 * Confirma/atualiza um pagamento consultando o PROVEDOR (fonte da verdade) e aplicando
 * confirm_payment() no banco, que é idempotente. Usado pelo webhook, pela tela (polling) e pelo Master.
 */
async function reconcilePayment(payment, { e2e = null } = {}) {
  const txId = payment.provider_tx_id || payment.id;
  const tx = await checkTransaction(txId);
  if (tx.type && tx.type !== 'DEPOSITO') return { status: payment.status, credited: false, ignored: true };

  const { data, error } = await getAdmin().rpc('confirm_payment', {
    p_payment_id: payment.id,
    p_state: tx.state,
    p_value_cents: tx.state === 'COMPLETO' ? paidCents(tx.value, payment.amount_cents) : null,
    p_fee_cents: tx.fee != null ? paidCents(tx.fee, -1) : null,
    p_e2e: e2e ? String(e2e).slice(0, 64) : null,
    p_raw_value: tx.value,
  });
  if (error) throwDb(error);
  return data;
}

async function getPaymentRaw(id) {
  const { data, error } = await getAdmin().from('payments').select(`${PAYMENT_COLS}, provider_tx_id`).eq('id', id).maybeSingle();
  if (error) throwDb(error);
  return data;
}

module.exports = { reconcilePayment, getPaymentRaw, paidCents, PAYMENT_COLS, PUBLIC_COLS };
