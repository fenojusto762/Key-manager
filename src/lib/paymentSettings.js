const crypto = require('crypto');
const config = require('../config');
const { getAdmin } = require('./supabase');
const { encrypt, decrypt, mask } = require('./secrets');
const { throwDb } = require('./errors');

const COLS = 'client_id_enc, client_secret_enc, webhook_secret_enc, updated_at, last_test_at, last_test_ok, last_test_message';

async function loadRow() {
  const { data, error } = await getAdmin().from('payment_settings').select(COLS).eq('id', 1).maybeSingle();
  if (error) throw error;
  return data;
}

/**
 * Credenciais efetivas (uso interno do backend): primeiro as salvas pelo Master (criptografadas no banco),
 * senão as variáveis de ambiente. NUNCA devolver este objeto ao cliente.
 */
async function getPaymentConfig() {
  let row = null;
  try { row = await loadRow(); } catch (e) { if (e?.message !== 'não configurado') console.error('[settings]', e?.message ?? e); }
  let clientId = '', clientSecret = '', webhookSecret = '', source = 'none';
  if (row?.client_id_enc && row?.client_secret_enc) {
    try {
      clientId = decrypt(row.client_id_enc);
      clientSecret = decrypt(row.client_secret_enc);
      webhookSecret = row.webhook_secret_enc ? decrypt(row.webhook_secret_enc) : '';
      source = 'database';
    } catch (e) {
      console.error('[settings] falha ao descriptografar (APP_ENCRYPTION_KEY mudou?)');
    }
  }
  if (source === 'none' && config.mistic.clientId && config.mistic.clientSecret) {
    ({ clientId, clientSecret, webhookSecret } = config.mistic);
    source = 'env';
  }
  return {
    clientId, clientSecret, webhookSecret, source,
    baseUrl: config.mistic.baseUrl, timeoutMs: config.mistic.timeoutMs,
    configured: Boolean(clientId && clientSecret && webhookSecret && config.appUrl),
    row,
  };
}

/** Visão segura para o frontend: nada secreto, só máscaras e estado. */
async function getPublicSettings() {
  const cfg = await getPaymentConfig();
  return {
    configured: cfg.configured,
    source: cfg.source,
    client_id_masked: mask(cfg.clientId),
    has_client_secret: Boolean(cfg.clientSecret),
    webhook_secret_set: Boolean(cfg.webhookSecret),
    webhook_url: config.appUrl ? `${config.appUrl}/api/webhooks/mistic` : null,
    app_url_set: Boolean(config.appUrl),
    encryption_ready: Boolean(config.encryptionKey && config.encryptionKey.length >= 32),
    environment: 'Produção (a Mistic Pay não possui ambiente de testes)',
    connection: {
      active: cfg.row?.last_test_ok === true,
      tested_at: cfg.row?.last_test_at ?? null,
      message: cfg.row?.last_test_message ?? null,
    },
    updated_at: cfg.row?.updated_at ?? null,
  };
}

const newWebhookSecret = () => crypto.randomBytes(32).toString('base64url');

async function saveCredentials({ clientId, clientSecret }, userId) {
  const cur = await getPaymentConfig();
  const id = clientId || cur.clientId;
  const secret = clientSecret || cur.clientSecret;
  if (!id || !secret) return { missing: true };
  const row = {
    id: 1,
    client_id_enc: encrypt(id),
    client_secret_enc: encrypt(secret),
    webhook_secret_enc: encrypt(cur.webhookSecret || newWebhookSecret()),
    updated_by: userId,
    updated_at: new Date().toISOString(),
    last_test_at: null, last_test_ok: null, last_test_message: null, // credenciais mudaram: precisa testar de novo
  };
  const { error } = await getAdmin().from('payment_settings').upsert(row);
  if (error) throwDb(error);
  return { ok: true };
}

async function rotateWebhookSecret(userId) {
  const cur = await getPaymentConfig();
  if (!cur.clientId || !cur.clientSecret) return { missing: true };
  const { error } = await getAdmin().from('payment_settings').upsert({
    id: 1, client_id_enc: encrypt(cur.clientId), client_secret_enc: encrypt(cur.clientSecret),
    webhook_secret_enc: encrypt(newWebhookSecret()), updated_by: userId, updated_at: new Date().toISOString(),
    last_test_at: cur.row?.last_test_at ?? null, last_test_ok: cur.row?.last_test_ok ?? null, last_test_message: cur.row?.last_test_message ?? null,
  });
  if (error) throwDb(error);
  return { ok: true };
}

async function recordTest(ok, message) {
  const { error } = await getAdmin().from('payment_settings')
    .update({ last_test_at: new Date().toISOString(), last_test_ok: ok, last_test_message: String(message).slice(0, 300) }).eq('id', 1);
  if (error) console.error('[settings] recordTest', error.message);
}

module.exports = { getPaymentConfig, getPublicSettings, saveCredentials, rotateWebhookSecret, recordTest };
