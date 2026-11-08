#!/usr/bin/env node
/**
 * Cria (ou promove) o PRIMEIRO administrador do sistema.
 *
 *   npm run create-admin
 *
 * Lê ADMIN_USERNAME / ADMIN_PASSWORD do ambiente; se ausentes, pergunta no terminal.
 * Usa a SERVICE_ROLE (somente local) — rode no seu computador, nunca no navegador.
 */
const readline = require('readline');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,31}$/;

function ask(question, { hidden = false } = {}) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) {
      rl._writeToOutput = (s) => {
        if (s.includes(question)) process.stdout.write(s);
        else process.stdout.write('*'.repeat(Math.min(s.length, 1)));
      };
    }
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write('\n');
      resolve(answer);
    });
  });
}

async function main() {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const domain = (process.env.AUTH_EMAIL_DOMAIN || 'keymanager.app').toLowerCase();
  if (!url || !serviceKey) {
    console.error('Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no arquivo .env antes de continuar.');
    process.exit(1);
  }

  const username = (process.env.ADMIN_USERNAME || (await ask('Usuário do administrador: '))).trim().toLowerCase();
  if (!USERNAME_RE.test(username)) {
    console.error('Usuário inválido: use 3–32 caracteres (a-z, 0-9, ponto, hífen, sublinhado).');
    process.exit(1);
  }
  const password = process.env.ADMIN_PASSWORD || (await ask('Senha (mín. 8 caracteres): ', { hidden: true }));
  if (password.length < 8 || password.length > 72) {
    console.error('A senha deve ter de 8 a 72 caracteres.');
    process.exit(1);
  }

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const { data: existing, error: lookupErr } = await admin
    .from('profiles')
    .select('id, role')
    .eq('username', username)
    .maybeSingle();
  if (lookupErr) {
    console.error('Erro ao consultar o banco. As migrações SQL foram executadas?', lookupErr.message);
    process.exit(1);
  }
  if (existing) {
    if (existing.role === 'ADMIN') {
      console.log(`"${username}" já é administrador. Nada a fazer.`);
      return;
    }
    const { error } = await admin.from('profiles').update({ role: 'ADMIN', status: 'ACTIVE' }).eq('id', existing.id);
    if (error) throw error;
    console.log(`Usuário existente "${username}" promovido a ADMIN.`);
    return;
  }

  const { data: created, error: authErr } = await admin.auth.admin.createUser({
    email: `${username}@${domain}`,
    password,
    email_confirm: true,
    user_metadata: { username },
  });
  if (authErr || !created?.user) {
    console.error('Falha ao criar o usuário no Supabase Auth:', authErr?.message);
    process.exit(1);
  }

  const { error: profErr } = await admin.from('profiles').insert({
    id: created.user.id,
    username,
    display_name: 'Administrador',
    role: 'ADMIN',
    status: 'ACTIVE',
  });
  if (profErr) {
    await admin.auth.admin.deleteUser(created.user.id).catch(() => {});
    console.error('Falha ao criar o perfil:', profErr.message);
    process.exit(1);
  }

  console.log(`Administrador "${username}" criado com sucesso. Já é possível entrar no painel.`);
}

main().catch((e) => {
  console.error(e?.message ?? e);
  process.exit(1);
});
