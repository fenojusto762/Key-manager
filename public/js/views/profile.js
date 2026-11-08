import { patch, post } from '../api.js';
import { esc, icon, fmtInt, fmtDate, initials, roleBadge, userStatusBadge, toast } from '../ui.js';

export async function profileView(root, ctx) {
  const u = ctx.user;
  root.innerHTML = `
    <div class="page-head"><div><h1>Perfil</h1><p>Seus dados e segurança da conta.</p></div></div>
    <div class="grid grid--2" style="align-items:start">
      <div class="card"><div class="card__body">
        <div class="user-cell" style="margin-bottom:20px"><span class="avatar avatar--lg">${esc(initials(u.username))}</span>
          <div><div style="font-size:18px;font-weight:700">${esc(u.display_name || u.username)}</div><div class="muted">@${esc(u.username)}</div></div></div>
        <dl class="kv" style="margin-bottom:20px">
          <dt>Função</dt><dd>${roleBadge(u.role)}</dd>
          <dt>Status</dt><dd>${userStatusBadge(u.status)}</dd>
          <dt>Créditos</dt><dd class="num"><b>${fmtInt(u.credits)}</b></dd>
          <dt>Membro desde</dt><dd>${esc(fmtDate(u.created_at))}</dd>
        </dl>
        <form id="f-name" novalidate>
          <label class="field"><span>Nome de exibição</span><input class="input" id="p-name" maxlength="80" value="${esc(u.display_name || '')}" placeholder="Como devemos chamar você?"></label>
          <button class="btn btn--primary" type="submit">Salvar nome</button>
        </form>
      </div></div>

      <div class="card"><div class="card__head"><div class="card__title">Alterar senha</div></div><div class="card__body">
        <form id="f-pass" novalidate>
          <div id="p-error" class="alert alert--bad" role="alert" hidden></div>
          <label class="field"><span>Senha atual</span><input class="input" id="p-cur" type="password" autocomplete="current-password" maxlength="200"></label>
          <label class="field"><span>Nova senha</span><input class="input" id="p-new" type="password" autocomplete="new-password" maxlength="72"><small>Mínimo de 8 caracteres.</small></label>
          <label class="field"><span>Confirmar nova senha</span><input class="input" id="p-conf" type="password" autocomplete="new-password" maxlength="72"></label>
          <button class="btn btn--primary" type="submit">${icon('lock')} Alterar senha</button>
        </form>
      </div></div>
    </div>`;

  const $ = (s) => root.querySelector(s);

  $('#f-name').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.submitter;
    btn.classList.add('is-loading');
    try {
      const { user } = await patch('/me', { display_name: $('#p-name').value.trim() });
      ctx.setUser(user);
      toast('Nome atualizado.', 'ok');
    } catch (err) { toast(err.message, 'bad'); } finally { btn.classList.remove('is-loading'); }
  });

  $('#f-pass').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('#p-error');
    err.hidden = true;
    const show = (m) => { err.textContent = m; err.hidden = false; };
    const cur = $('#p-cur').value, nw = $('#p-new').value, conf = $('#p-conf').value;
    if (!cur || !nw) return show('Preencha a senha atual e a nova senha.');
    if (nw.length < 8) return show('A nova senha deve ter no mínimo 8 caracteres.');
    if (nw !== conf) return show('A confirmação não confere com a nova senha.');
    const btn = e.submitter;
    btn.classList.add('is-loading');
    try {
      await post('/me/password', { current_password: cur, new_password: nw });
      $('#f-pass').reset();
      toast('Senha alterada com sucesso.', 'ok');
    } catch (ex) { show(ex.message); } finally { btn.classList.remove('is-loading'); }
  });
}
