const { getAdmin } = require('./supabase');

/**
 * Registra uma operação na trilha de auditoria (activity_logs).
 * Nunca derruba a requisição principal: falhas são apenas registradas no console.
 */
async function logActivity({ actor = null, action, target = null, details = {}, ip = null, actorUsername = null }) {
  try {
    const { error } = await getAdmin()
      .from('activity_logs')
      .insert({
        actor_id: actor?.id ?? null,
        actor_username: actor?.username ?? actorUsername,
        action,
        target_id: target?.id ?? null,
        target_username: target?.username ?? null,
        details,
        ip,
      });
    if (error) console.error('[activity]', error.message);
  } catch (e) {
    console.error('[activity]', e?.message ?? e);
  }
}

module.exports = { logActivity };
