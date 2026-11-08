import { get, post } from '../api.js';
import { esc, icon, fmtInt, fmtDate, timeLeft, debounce, pagerHtml, toast, copyText, confirmDialog, licenseBadge } from '../ui.js';

const LIMIT = 20;

export async function licensesView(root, ctx) {
  const isAdmin = ctx.user.role === 'ADMIN';
  const q = { page: 1, search: '', status: '' };
  let seq = 0;

  root.innerHTML = `
    <div class="page-head"><div><h1>${isAdmin ? 'Todas as licenças' : 'Minhas licenças'}</h1>
      <p>${isAdmin ? 'Consulte e revogue licenças de qualquer usuário.' : 'Histórico das licenças que você gerou.'}</p></div>
      <div class="page-head__actions"><a class="btn btn--primary" href="#/generate">${icon('key')} Gerar licenças</a></div></div>
    <div class="card card--flush">
      <div class="toolbar">
        <label class="search">${icon('search')}<input class="input" id="l-search" type="search" placeholder="${isAdmin ? 'Buscar por código ou usuário' : 'Buscar por código'}" autocomplete="off" aria-label="Buscar licenças"></label>
        <select class="select" id="l-status" aria-label="Filtrar por status">
          <option value="">Todos os status</option><option value="ACTIVE">Ativas</option><option value="EXPIRED">Expiradas</option><option value="REVOKED">Revogadas</option>
        </select>
      </div>
      <div id="l-table"></div>
    </div>`;

  const holder = root.querySelector('#l-table');
  const base = isAdmin ? '/admin/licenses' : '/me/licenses';

  async function load() {
    const my = ++seq;
    holder.style.opacity = '.6';
    let data;
    try {
      data = await get(base, { page: q.page, limit: LIMIT, search: q.search, status: q.status });
    } catch (e) {
      if (my === seq) holder.innerHTML = `<div class="empty"><strong>Erro ao carregar</strong><span>${esc(e.message)}</span></div>`;
      holder.style.opacity = '1';
      return;
    }
    if (my !== seq) return;
    holder.style.opacity = '1';
    if (!data.items.length) {
      holder.innerHTML = `<div class="empty">${icon('key')}<strong>Nenhuma licença encontrada</strong></div>`;
      return;
    }
    holder.innerHTML = `<div class="table-wrap"><table class="table stack">
      <thead><tr><th>Código</th>${isAdmin ? '<th>Usuário</th>' : ''}<th>Validade</th><th>Criada em</th><th>Expira em</th><th>Status</th><th></th></tr></thead>
      <tbody>${data.items.map((l) => `<tr data-id="${esc(l.id)}" data-code="${esc(l.code)}">
        <td class="cell-main"><span class="code">${esc(l.code)}</span></td>
        ${isAdmin ? `<td data-label="Usuário">@${esc(l.owner_username)}</td>` : ''}
        <td data-label="Validade">${fmtInt(l.duration_days)} dia(s)</td>
        <td data-label="Criada em" class="nowrap">${esc(fmtDate(l.created_at))}</td>
        <td data-label="Expira em" class="nowrap">${esc(fmtDate(l.expires_at))}${l.status === 'ACTIVE' ? `<div class="muted" style="font-size:12px">${esc(timeLeft(l.expires_at))}</div>` : ''}</td>
        <td data-label="Status">${licenseBadge(l.status)}</td>
        <td><div class="actions">
          <button class="icon-btn" data-act="copy" title="Copiar código" aria-label="Copiar código">${icon('copy')}</button>
          ${isAdmin && l.status !== 'REVOKED' ? `<button class="icon-btn icon-btn--bad" data-act="revoke" title="Revogar" aria-label="Revogar licença">${icon('ban')}</button>` : ''}
        </div></td></tr>`).join('')}</tbody></table></div>${pagerHtml({ page: data.page, limit: data.limit, total: data.total })}`;
  }

  root.querySelector('#l-search').addEventListener('input', debounce((e) => { q.search = e.target.value.trim(); q.page = 1; load(); }, 300));
  root.querySelector('#l-status').addEventListener('change', (e) => { q.status = e.target.value; q.page = 1; load(); });
  holder.addEventListener('click', async (e) => {
    const pg = e.target.closest('[data-page]');
    if (pg && !pg.disabled) { q.page = Number(pg.dataset.page); load(); return; }
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const tr = btn.closest('tr');
    if (btn.dataset.act === 'copy') return copyText(tr.dataset.code, 'Licença copiada!');
    if (btn.dataset.act === 'revoke') {
      const ok = await confirmDialog({
        title: 'Revogar licença',
        message: `A licença ${tr.dataset.code} deixará de ser válida imediatamente. Esta ação não pode ser desfeita.`,
        confirmLabel: 'Revogar', danger: true,
      });
      if (!ok) return;
      try {
        await post(`/admin/licenses/${tr.dataset.id}/revoke`);
        toast('Licença revogada.', 'ok');
        load();
      } catch (err) { toast(err.message, 'bad'); }
    }
  });

  await load();
}
