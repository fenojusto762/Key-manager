const crypto = require('crypto');
const config = require('../config');
const { AppError } = require('./errors');

/** Criptografia AES-256-GCM para credenciais guardadas no banco. A chave vem só do ambiente. */
function key() {
  const k = config.encryptionKey;
  if (!k || k.length < 32) {
    throw new AppError(503, 'ENCRYPTION_NOT_CONFIGURED', 'Defina APP_ENCRYPTION_KEY (mín. 32 caracteres) no servidor para salvar credenciais.');
  }
  return crypto.createHash('sha256').update(k).digest();
}

function encrypt(plain) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const ct = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return `v1:${iv.toString('base64')}:${c.getAuthTag().toString('base64')}:${ct.toString('base64')}`;
}

function decrypt(blob) {
  if (!blob) return '';
  const [v, iv, tag, ct] = String(blob).split(':');
  if (v !== 'v1' || !iv || !tag || !ct) throw new Error('formato inválido');
  const d = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(ct, 'base64')), d.final()]).toString('utf8');
}

const mask = (s) => (s && s.length > 8 ? `${s.slice(0, 4)}••••••${s.slice(-2)}` : s ? '••••••••' : '');

module.exports = { encrypt, decrypt, mask };
