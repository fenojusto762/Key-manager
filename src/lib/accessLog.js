const { getAdmin } = require('./supabase');
const { parseUserAgent } = require('./useragent');
const { locate } = require('./geo');

/**
 * Registra uma tentativa de login em login_events (sucesso ou falha).
 * Nunca derruba o login: qualquer erro é apenas registrado no console.
 * Jamais grava senha ou tokens — somente metadados do acesso.
 *
 * user: perfil (quando o usuário existe) · username: o que foi digitado
 * reason: OK | INVALID_CREDENTIALS | SUSPENDED
 */
async function recordLogin(req, { user = null, username, success, reason = 'OK' }) {
  try {
    const ip = req.ip || null;
    const ua = req.get('user-agent') || '';
    const parsed = parseUserAgent(ua);
    const geo = await locate(req, ip);

    const { error } = await getAdmin().rpc('record_login_event', {
      p_user_id: user?.id ?? null,
      p_username: user?.username ?? String(username ?? '?').slice(0, 64),
      p_success: !!success,
      p_reason: reason,
      p_ip: ip,
      p_device: parsed.device,
      p_device_type: parsed.deviceType,
      p_os: parsed.os,
      p_browser: parsed.browser,
      p_user_agent: ua.slice(0, 300) || null,
      p_country: geo.country,
      p_region: geo.region,
      p_city: geo.city,
    });
    if (error) console.error('[access-log]', error.message);
  } catch (e) {
    console.error('[access-log]', e?.message ?? e);
  }
}

/** Dono de um username (para ligar tentativas falhas a uma conta existente). */
async function findProfileByUsername(username) {
  try {
    const { data } = await getAdmin()
      .from('profiles')
      .select('id, username')
      .eq('username', String(username).slice(0, 64))
      .maybeSingle();
    return data ?? null;
  } catch {
    return null;
  }
}

module.exports = { recordLogin, findProfileByUsername };
