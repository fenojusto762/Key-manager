const config = require('../config');
const { AppError } = require('./errors');

/**
 * Cliente da API Mistic Pay (https://docs.misticpay.com).
 * As credenciais vêm só de variáveis de ambiente e nunca saem do servidor.
 *  - Chave de acesso (pk_… / sk_…): Authorization: Basic base64(pk:sk)
 *  - Legado (ci / cs): cabeçalhos "ci" e "cs"
 */
function authHeaders() {
  const { clientId, clientSecret } = config.mistic;
  if (clientId.startsWith('pk_')) {
    return { Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}` };
  }
  return { ci: clientId, cs: clientSecret };
}

let fetchImpl = (...a) => fetch(...a);
const setFetch = (f) => { fetchImpl = f; }; // usado nos testes

async function call(path, body) {
  if (!config.mistic.configured) {
    throw new AppError(503, 'PAYMENTS_NOT_CONFIGURED', 'Pagamentos temporariamente indisponíveis.');
  }
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), config.mistic.timeoutMs);
  let res;
  try {
    res = await fetchImpl(`${config.mistic.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
  } catch (e) {
    console.error('[mistic] rede', e?.name || e);
    throw new AppError(502, 'PAYMENT_PROVIDER_UNAVAILABLE', 'Não foi possível falar com o provedor de pagamento. Tente novamente.');
  } finally {
    clearTimeout(timer);
  }
  let data = null;
  try { data = await res.json(); } catch { /* corpo inválido */ }
  if (!res.ok) {
    console.error('[mistic]', path, res.status, data?.code, data?.message, data?.requestId);
    if (res.status === 404) throw new AppError(404, 'PROVIDER_TX_NOT_FOUND', 'Transação não encontrada no provedor.');
    throw new AppError(502, 'PAYMENT_PROVIDER_ERROR', 'O provedor de pagamento recusou a operação. Tente novamente em instantes.');
  }
  return data;
}

/** Cria cobrança PIX. amount em reais (number). */
async function createPixCharge({ amount, payerName, payerDocument, description, transactionId, webhookUrl }) {
  const data = await call('/api/transactions/create', {
    amount,
    payerName,
    payerDocument,
    description,
    transactionId,
    projectWebhook: webhookUrl,
  });
  const d = data?.data;
  if (!d || !(d.copyPaste || d.qrCodeBase64 || d.qrcodeUrl)) {
    console.error('[mistic] resposta de criação sem QR', JSON.stringify(data)?.slice(0, 300));
    throw new AppError(502, 'PAYMENT_PROVIDER_ERROR', 'O provedor não retornou o QR Code. Tente novamente.');
  }
  return {
    providerTxId: d.transactionId != null ? String(d.transactionId) : null,
    qrCodeBase64: d.qrCodeBase64 || null,
    qrCodeUrl: d.qrcodeUrl || null,
    copyPaste: d.copyPaste || null,
  };
}

/** Consulta o estado real da transação (fonte da verdade; nunca confiamos só no webhook). */
async function checkTransaction(transactionId) {
  const data = await call('/api/transactions/check', { transactionId: String(transactionId) });
  const t = data?.transaction;
  if (!t) throw new AppError(502, 'PAYMENT_PROVIDER_ERROR', 'Resposta inválida do provedor.');
  return {
    state: String(t.transactionState || '').toUpperCase(),
    value: t.value != null ? Number(t.value) : null,
    fee: t.fee != null ? Number(t.fee) : null,
    type: t.transactionType,
  };
}

module.exports = { createPixCharge, checkTransaction, setFetch, authHeaders };
