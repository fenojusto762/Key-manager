const test = require('node:test');
const assert = require('node:assert/strict');

process.env.AUTH_EMAIL_DOMAIN = 'keymanager.app';
const { normalizeKey, toEmail, sanitizeSearch } = require('../src/lib/license');

test('normalizeKey aceita formatos equivalentes', () => {
  assert.equal(normalizeKey('abcd-efgh-jkmn-pqrs'), 'ABCD-EFGH-JKMN-PQRS');
  assert.equal(normalizeKey(' ABCDEFGHJKMNPQRS '), 'ABCD-EFGH-JKMN-PQRS');
  assert.equal(normalizeKey('ABCD EFGH JKMN PQRS'), 'ABCD-EFGH-JKMN-PQRS');
});

test('normalizeKey rejeita entradas inválidas', () => {
  assert.equal(normalizeKey(undefined), null);
  assert.equal(normalizeKey(123), null);
  assert.equal(normalizeKey('ABCD-EFGH'), null);
  assert.equal(normalizeKey('ABCD-EFGH-JKMN-PQR0'), null); // 0 não existe no alfabeto
  assert.equal(normalizeKey('A'.repeat(100)), null);
  assert.equal(normalizeKey("ABCD-EFGH-JKMN-PQ'; DROP"), null);
});

test('toEmail mapeia usuário para e-mail técnico', () => {
  assert.equal(toEmail('joao.silva'), 'joao.silva@keymanager.app');
});

test('sanitizeSearch remove caracteres que quebrariam filtros PostgREST', () => {
  assert.equal(sanitizeSearch('joão,silva)(*'), 'joãosilva');
  assert.equal(sanitizeSearch('a%b_c'), 'ab_c');
  assert.equal(sanitizeSearch('x'.repeat(100)).length, 40);
  assert.equal(sanitizeSearch(null), '');
});
