const { createClient } = require('@supabase/supabase-js');
const config = require('../config');
const { AppError } = require('./errors');

const AUTH_OPTS = {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
};

function assertConfigured() {
  if (config.missing.length) {
    throw new AppError(500, 'SERVER_MISCONFIGURED', 'Servidor não configurado. Verifique as variáveis de ambiente.');
  }
}

let adminClient = null;

/** Cliente com a SERVICE_ROLE (ignora RLS). Existe apenas no backend. NUNCA use para login de usuários. */
function getAdmin() {
  assertConfigured();
  if (!adminClient) {
    adminClient = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, AUTH_OPTS);
  }
  return adminClient;
}

/**
 * Cliente descartável com a chave pública, usado para signInWithPassword / refreshSession.
 * Um cliente NOVO por operação: evita que a sessão de um usuário vaze para outra requisição.
 */
function newAnonClient() {
  assertConfigured();
  return createClient(config.supabaseUrl, config.supabaseAnonKey, AUTH_OPTS);
}

module.exports = { getAdmin, newAnonClient };
