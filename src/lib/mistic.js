const config = require('../config');
const { AppError } = require('./errors');
const { getPaymentConfig } = require('./paymentSettings');

/**
 * Cliente da API Mistic Pay (https://docs.misticpay.com). Credenciais vêm de getPaymentConfig()
 * (banco criptografado ou ambiente) e nunca saem do servidor.
 *  - Chave de acesso (pk_… / sk_…): Authorization: Basic base64(pk:sk)
 *  - Legado (ci / cs): cabeçalhos "ci" e "cs"
 */
function authHeaders(cfg) {
  if (cfg.clientId.startsWith('pk_')) {
    return { Authorization: `Basic ${Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString('base64')}` };
  }
  return { ci: cfg.clientId, cs: cfg.clientSecret };
}

let fetchImpl = (...a) => fetch(...a);
const setFetch = (f) => { fetchImpl = f; }; // usado nos testes

/** Faz a chamada e devolve { res, data } sem interpretar o status. */
async function rawCall(cfg, path, body) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), cfg.timeoutMs);
  try {
    const res = await fetchImpl(`${cfg.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(cfg) },
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
    let data = null;
    try { data = await res.json(); } catch { /* corpo inválido */ }
    return { res, data };
  } catch (e) {
    console.error('[mistic] rede', e?.name || e);
    throw new AppError(502, 'PAYMENT_PROVIDER_UNAVAILABLE', 'Não foi possível falar com o provedor de pagamento. Tente novamente.');
  } finally {
    clearTimeout(timer);
  }
}

async function call(path, body) {
  const cfg = await getPaymentConfig();
  if (!cfg.configured) throw new AppError(503, 'PAYMENTS_NOT_CONFIGURED', 'Pagamentos temporariamente indisponíveis.');
  const { res, data } = await rawCall(cfg, path, body);
  if (!res.ok) {
    console.error('[mistic]', path, res.status, data?.code, data?.message, data?.requestId);
    if (res.status === 404) throw new AppError(404, 'PROVIDER_TX_NOT_FOUND', 'Transação não encontrada no provedor.');
    throw new AppError(502, 'PAYMENT_PROVIDER_ERROR', 'O provedor de pagamento recusou a operação. Tente novamente em instantes.');
  }
  return { data, cfg };
}

/** Cria cobrança PIX. amount em reais (number). */
async function createPixCharge({ amount, payerName, payerDocument, description, transactionId }) {
  const cfg0 = await getPaymentConfig();
  const webhookUrl = `${config.appUrl}/api/webhooks/mistic?token=${encodeURIComponent(cfg0.webhookSecret)}`;
  const { data } = await call('/api/transactions/create', {
    amount, payerName, payerDocument, description, transactionId, projectWebhook: webhookUrl,
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
  const { data } = await call('/api/transactions/check', { transactionId: String(transactionId) });
  const t = data?.transaction;
  if (!t) throw new AppError(502, 'PAYMENT_PROVIDER_ERROR', 'Resposta inválida do provedor.');
  return {
    state: String(t.transactionState || '').toUpperCase(),
    value: t.value != null ? Number(t.value) : null,
    fee: t.fee != null ? Number(t.fee) : null,
    type: t.transactionType,
  };
}

/**
 * Testa as credenciais sem criar cobrança: consulta uma transação inexistente.
 * 404 = credenciais aceitas; 401 = inválidas; 403 = sem escopo TRANSACTION_READ.
 */
async function testConnection(cfg) {
  if (!cfg.clientId || !cfg.clientSecret) return { ok: false, message: 'Informe o Client ID e o Client Secret.' };
  let out;
  try {
    out = await rawCall(cfg, '/api/transactions/check', { transactionId: `teste-conexao-${Date.now()}` });
  } catch {
    return { ok: false, message: 'Sem resposta da Mistic Pay (rede/tempo esgotado).' };
  }
  const { res, data } = out;
  if (res.ok || res.status === 404) return { ok: true, message: 'Conexão ativa: credenciais aceitas pela Mistic Pay.' };
  if (res.status === 401) {
    return { ok: false, message: data?.code === 'IP_NOT_ALLOWED' ? 'IP não autorizado na chave (remova a lista de IPs permitidos).' : 'Credenciais inválidas (Client ID/Secret).' };
  }
  if (res.status === 403) return { ok: false, message: 'A chave não tem o escopo TRANSACTION_READ/TRANSACTION_CREATE.' };
  if (res.status === 429) return { ok: false, message: 'Limite de requisições da Mistic Pay. Tente em instantes.' };
  return { ok: false, message: `A Mistic Pay respondeu com erro ${res.status}.` };
}

module.exports = { createPixCharge, checkTransaction, testConnection, setFetch, authHeaders };
