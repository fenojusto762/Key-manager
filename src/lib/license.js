const config = require('../config');

/**
 * Normaliza uma chave digitada: ignora espaços, hífens e caixa.
 * Retorna 'XXXX-XXXX-XXXX-XXXX' ou null se o formato for inválido.
 * Alfabeto das chaves geradas: A-Z e 2-9 (sem 0, 1, I, O).
 */
function normalizeKey(input) {
  if (typeof input !== 'string' || input.length > 64) return null;
  const raw = input.trim().toUpperCase().replace(/[\s-]/g, '');
  if (!/^[A-Z2-9]{16}$/.test(raw)) return null;
  return raw.match(/.{4}/g).join('-');
}

/** usuário -> e-mail técnico do Supabase Auth (nenhum e-mail é enviado). */
function toEmail(username) {
  return `${username}@${config.authEmailDomain}`;
}

/** Remove caracteres que poderiam quebrar filtros PostgREST (vírgula, parênteses, etc.). */
function sanitizeSearch(value) {
  if (typeof value !== 'string') return '';
  return value
    .normalize('NFC')
    .replace(/[^\p{L}\p{N} ._-]/gu, '')
    .trim()
    .slice(0, 40);
}

module.exports = { normalizeKey, toEmail, sanitizeSearch };
