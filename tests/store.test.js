const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

process.env.SUPABASE_URL = 'http://x';
// Sem rede para instalar dependências: substitui o módulo do Supabase por um simulado.
const supaPath = require.resolve('../src/lib/supabase');
const supa = { getAdmin: () => { throw new Error('não configurado'); }, newAnonClient: () => ({}) };
require.cache[supaPath] = { id: supaPath, filename: supaPath, loaded: true, exports: supa, children: [], paths: [] };
const config = require('../src/config');
Object.assign(config.mistic, { clientId: 'ci_test', clientSecret: 'cs_test', webhookSecret: 'segredo-123' });
config.encryptionKey = 'k'.repeat(40);
config.appUrl = 'https://app.test';

const { normalizeCpf, maskCpf } = require('../src/lib/cpf');
const mistic = require('../src/lib/mistic');
const { paidCents } = require('../src/lib/payments');

test('CPF: valida dígitos e rejeita inválidos', () => {
  assert.equal(normalizeCpf('529.982.247-25'), '52998224725');
  assert.equal(normalizeCpf('111.111.111-11'), null);
  assert.equal(normalizeCpf('529.982.247-24'), null);
  assert.equal(maskCpf('52998224725'), '***.***.***-25');
});

test('paidCents aceita reais ou centavos e rejeita valor diferente', () => {
  assert.equal(paidCents(19.9, 1990), 1990);
  assert.equal(paidCents(1990, 1990), 1990);
  assert.notEqual(paidCents(5, 1990), 1990);
  assert.equal(paidCents(null, 1990), null);
});

test('Mistic: cabeçalhos legados ci/cs e Basic para pk_/sk_', () => {
  assert.deepEqual(mistic.authHeaders({ clientId: 'ci_test', clientSecret: 'cs_test' }), { ci: 'ci_test', cs: 'cs_test' });
  assert.equal(mistic.authHeaders({ clientId: 'pk_abc', clientSecret: 'sk_def' }).Authorization, 'Basic ' + Buffer.from('pk_abc:sk_def').toString('base64'));
});

test('Criptografia das credenciais: ida e volta, falha com adulteração, máscara', () => {
  const { encrypt, decrypt, mask } = require('../src/lib/secrets');
  const blob = encrypt('sk_super_secreto');
  assert.ok(!blob.includes('sk_super_secreto'));
  assert.equal(decrypt(blob), 'sk_super_secreto');
  assert.notEqual(encrypt('x'), encrypt('x'), 'IV aleatório');
  const bad = blob.slice(0, -4) + 'AAAA';
  assert.throws(() => decrypt(bad));
  assert.equal(mask('pk_1234567890'), 'pk_1••••••90');
  assert.equal(mask('curto'), '••••••••');
  assert.ok(!mask('sk_super_secreto').includes('super'));
});

test('Mistic: cria cobrança com payload correto, webhook com segredo e QR normalizado', async () => {
  let seen;
  mistic.setFetch(async (url, opts) => {
    seen = { url, body: JSON.parse(opts.body), headers: opts.headers };
    return { ok: true, status: 200, json: async () => ({ data: { transactionId: 'T1', qrCodeBase64: 'AAA', copyPaste: '000201...' } }) };
  });
  const r = await mistic.createPixCharge({ amount: 20, payerName: 'Fulano', payerDocument: '52998224725', description: 'd', transactionId: 'id1' });
  assert.equal(seen.url, 'https://api.misticpay.com/api/transactions/create');
  assert.equal(seen.body.amount, 20);
  assert.equal(seen.body.projectWebhook, 'https://app.test/api/webhooks/mistic?token=segredo-123');
  assert.equal(seen.headers.ci, 'ci_test');
  assert.deepEqual(r, { providerTxId: 'T1', qrCodeBase64: 'AAA', qrCodeUrl: null, copyPaste: '000201...' });
});

test('Testar conexão: 404=ativa, 401=inválida, 403=sem escopo; sem vazar segredo', async () => {
  const cfg = { clientId: 'ci_test', clientSecret: 'cs_secreto', baseUrl: 'https://api.misticpay.com', timeoutMs: 1000 };
  const reply = (status, data = {}) => mistic.setFetch(async () => ({ ok: status < 400, status, json: async () => data }));
  reply(404, { code: 'TRANSACTION_NOT_FOUND' }); assert.equal((await mistic.testConnection(cfg)).ok, true);
  reply(401, { code: 'INVALID_API_CREDENTIAL' }); const bad = await mistic.testConnection(cfg);
  assert.equal(bad.ok, false); assert.ok(!JSON.stringify(bad).includes('cs_secreto'));
  reply(403, { code: 'API_SCOPE_DENIED' }); assert.match((await mistic.testConnection(cfg)).message, /escopo/);
  assert.equal((await mistic.testConnection({ ...cfg, clientSecret: '' })).ok, false);
});

test('Mistic: erro do provedor vira 502 sem vazar detalhes', async () => {
  mistic.setFetch(async () => ({ ok: false, status: 401, json: async () => ({ code: 'INVALID_API_CREDENTIAL', message: 'segredo' }) }));
  await assert.rejects(() => mistic.checkTransaction('x'), (e) => e.status === 502 && !/segredo/.test(e.message));
});

/* ---- Webhook ponta a ponta (rota real, banco e provedor simulados) ---- */
test('Webhook: segredo, ignora desconhecidos e credita via confirm_payment (verificando no provedor)', async () => {
  const rpcCalls = [];
  const PAY = { id: '11111111-1111-4111-8111-111111111111', provider_tx_id: null, status: 'PENDING', amount_cents: 1990, created_at: new Date().toISOString() };
  const fakeAdmin = {
    from: () => {
      const q = { select: () => q, or: () => q, eq: () => q, maybeSingle: async () => ({ data: q._id === PAY.id ? PAY : null }) };
      q.or = (s) => { q._id = s.includes(PAY.id) ? PAY.id : null; return q; };
      return q;
    },
    rpc: async (name, args) => { rpcCalls.push([name, args]); return { data: { status: 'APPROVED', credited: true }, error: null }; },
  };
  supa.getAdmin = () => fakeAdmin;
  delete require.cache[require.resolve('../src/lib/payments')];
  delete require.cache[require.resolve('../src/lib/webhookHandler')];
  const { handleMisticWebhook } = require('../src/lib/webhookHandler');
  const server = http.createServer((rq, rs) => {
    const url = new URL(rq.url, 'http://x');
    let raw = '';
    rq.on('data', (c) => { raw += c; });
    rq.on('end', () => {
      const req = { query: Object.fromEntries(url.searchParams), body: raw ? JSON.parse(raw) : {}, ip: '1.1.1.1' };
      const res = { status(c) { rs.statusCode = c; return this; }, json(o) { rs.setHeader('content-type', 'application/json'); rs.end(JSON.stringify(o)); } };
      handleMisticWebhook(req, res);
    });
  }).listen(0);
  const base = `http://127.0.0.1:${server.address().port}/api/webhooks/mistic`;
  const post = (qs, body) => fetch(`${base}${qs}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

  try {
    assert.equal((await post('', { transactionId: PAY.id })).status, 401);
    assert.equal((await post('?token=errado', { transactionId: PAY.id })).status, 401);
    assert.equal(rpcCalls.length, 0);

    mistic.setFetch(async () => ({ ok: true, status: 200, json: async () => ({ transaction: { transactionState: 'COMPLETO', value: 19.9, fee: 0.23, transactionType: 'DEPOSITO' } }) }));
    assert.equal((await post('?token=segredo-123', { transactionId: 'outro-id' })).status, 200);
    assert.equal(rpcCalls.length, 0, 'transação desconhecida não pode creditar');

    // Webhook diz "pago", mas o provedor diz PENDENTE → não credita
    mistic.setFetch(async () => ({ ok: true, status: 200, json: async () => ({ transaction: { transactionState: 'PENDENTE', value: 19.9, transactionType: 'DEPOSITO' } }) }));
    await post('?token=segredo-123', { transactionId: PAY.id, status: 'COMPLETO' });
    assert.equal(rpcCalls.at(-1)[1].p_state, 'PENDENTE');
    assert.equal(rpcCalls.at(-1)[1].p_value_cents, null);

    mistic.setFetch(async () => ({ ok: true, status: 200, json: async () => ({ transaction: { transactionState: 'COMPLETO', value: 19.9, fee: 0.23, transactionType: 'DEPOSITO' } }) }));
    const r = await post('?token=segredo-123', { transactionId: PAY.id, e2e: 'E123' });
    assert.equal(r.status, 200);
    const [name, args] = rpcCalls.at(-1);
    assert.equal(name, 'confirm_payment');
    assert.equal(args.p_state, 'COMPLETO');
    assert.equal(args.p_value_cents, 1990);
    assert.equal(args.p_e2e, 'E123');
  } finally { server.close(); }
});
