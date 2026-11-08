import { get, post, patch, del } from '../api.js';
import {
  esc, icon, fmtInt, fmtDate, relTime, initials, debounce, pagerHtml, toast, openModal, confirmDialog,
  userStatusBadge, roleBadge, describeActivity, licenseBadge,
} from '../ui.js';

const LIMIT = 15;

export async function usersView(root, ctx) {
  const q = { page: 1, search: '', status: '' };
  let seq = 0;

  root.innerHTML = `
    <div class="page-head">
      <div><h1>Usuários</h1><p>Crie contas, ajuste créditos e controle o acesso.</p></div>
      <div class="page-head__actions"><button class="btn btn--primary" type="button" id="new-user">${icon('plus')} Novo usuário</button></div>
    </div>
    <div class="card card--flush">
      <div class="toolbar">
        <label class="search">${icon('search')}<input class="input" id="u-search" type="search" placeholder="Buscar por nome ou usuário" autocomplete="off" aria-label="Buscar usuários"></label>
        <select class="select" id="u-status" aria-label="Filtrar por status">
          <option value="">Todos os status</option><option value="ACTIVE">Ativos</option><option value="SUSPENDED">Suspensos</option>
        </select>
      </div>
      <div id="u-table"></div>
    </div>`;

  const holder = root.querySelector('#u-table');

  async function load() {
    const my = ++seq;
    holder.style.opacity = '.6';
    let data;
    try {
      data = await get('/admin/users', { page: q.page, limit: LIMIT, search: q.search, status: q.status });
    } catch (e) {
      if (my === seq) holder.innerHTML = `<div class="empty"><strong>Erro ao carregar</strong><span>${esc(e.message)}</span></div>`;
      holder.style.opacity = '1';
      return;
    }
    if (my !== seq) return;
    holder.style.opacity = '1';

    if (!data.items.length) {
      holder.innerHTML = `<div class="empty">${icon('users')}<strong>Nenhum usuário encontrado</strong><span>Ajuste a busca ou crie um novo usuário.</span></div>`;
      return;
    }
    holder.innerHTML = `<div class="table-wrap"><table class="table stack">
      <thead><tr><th>Usuário</th><th>Função</th><th>Status</th><th class="right">Créditos</th><th>Cadastro</th><th></th></tr></thead>
      <tbody>${data.items.map((u) => {
        const self = u.id === ctx.user.id;
        return `<tr data-id="${esc(u.id)}">
          <td class="cell-main"><div class="user-cell"><span class="avatar avatar--sm">${esc(initials(u.username))}</span>
            <div><div class="user-cell__name">${esc(u.display_name || u.username)}${self ? ' <span class="muted">(você)</span>' : ''}</div><div class="user-cell__sub">@${esc(u.username)}</div></div></div></td>
          <td data-label="Função">${roleBadge(u.role)}</td>
          <td data-label="Status">${userStatusBadge(u.status)}</td>
          <td data-label="Créditos" class="right num"><b>${fmtInt(u.credits)}</b></td>
          <td data-label="Cadastro" class="nowrap muted">${esc(relTime(u.created_at))}</td>
          <td><div class="actions">
            <button class="icon-btn" data-act="details" title="Detalhes e histórico" aria-label="Detalhes">${icon('eye')}</button>
            <button class="icon-btn icon-btn--ok" data-act="credits" title="Ajustar créditos" aria-label="Ajustar créditos">${icon('coins')}</button>
            <button class="icon-btn" data-act="password" title="Redefinir senha" aria-label="Redefinir senha">${icon('lock')}</button>
            ${self ? '' : u.status === 'ACTIVE'
              ? `<button class="icon-btn icon-btn--warn" data-act="suspend" title="Suspender" aria-label="Suspender">${icon('pause')}</button>`
              : `<button class="icon-btn icon-btn--ok" data-act="reactivate" title="Reativar" aria-label="Reativar">${icon('play')}</button>`}
            ${self ? '' : `<button class="icon-btn icon-btn--bad" data-act="delete" title="Excluir" aria-label="Excluir">${icon('trash')}</button>`}
          </div></td></tr>`;
      }).join('')}</tbody></table></div>${pagerHtml({ page: data.page, limit: data.limit, total: data.total })}`;
    holder._items = new Map(data.items.map((u) => [u.id, u]));
  }

  /* ---- ações ---- */
  const field = (id, label, attrs = '', hint = '') =>
    `<label class="field"><span>${label}</span><input class="input" id="${id}" ${attrs}>${hint ? `<small>${hint}</small>` : ''}</label>`;

  function createModal() {
    openModal({
      title: 'Novo usuário',
      html: `<form id="f-new" autocomplete="off" novalidate>
        ${field('n-username', 'Usuário', 'autocapitalize="none" spellcheck="false" maxlength="32"', '3–32 caracteres: letras minúsculas, números, ponto, hífen ou sublinhado.')}
        ${field('n-name', 'Nome de exibição (opcional)', 'maxlength="80"')}
        ${field('n-pass', 'Senha', 'type="password" autocomplete="new-password" maxlength="72"', 'Mínimo de 8 caracteres.')}
        <div class="field field--row">
          <label class="field" style="margin:0"><span>Função</span><select class="select" id="n-role"><option value="USER">USER</option><option value="ADMIN">ADMIN</option></select></label>
          <label class="field" style="margin:0"><span>Créditos iniciais</span><input class="input" id="n-credits" type="number" min="0" max="1000000" value="0"></label>
        </div></form>`,
      actions: [
        { label: 'Cancelar' },
        {
          label: 'Criar usuário', kind: 'primary',
          onClick: async (c) => {
            c.setError('');
            const el = (id) => c.body.querySelector(id);
            try {
              await post('/admin/users', {
                username: el('#n-username').value.trim().toLowerCase(),
                display_name: el('#n-name').value.trim() || undefined,
                password: el('#n-pass').value,
                role: el('#n-role').value,
                credits: Number(el('#n-credits').value) || 0,
              });
              c.close();
              toast('Usuário criado com sucesso.', 'ok');
              load();
            } catch (e) { c.setError(e.message); }
          },
        },
      ],
      onMount: (c) => c.body.querySelector('#f-new').addEventListener('submit', (e) => e.preventDefault()),
    });
  }

  function creditsModal(u) {
    openModal({
      title: `Créditos de @${u.username}`,
      html: `<p>Saldo atual: <b class="num">${fmtInt(u.credits)}</b> crédito(s).</p>
        <div class="seg" id="c-op" style="margin-bottom:14px">
          <button type="button" class="is-active" data-op="add"><b>Adicionar</b><span>aumenta o saldo</span></button>
          <button type="button" data-op="remove"><b>Remover</b><span>reduz o saldo</span></button>
        </div>
        ${field('c-amount', 'Quantidade', 'type="number" min="1" max="1000000" value="1" inputmode="numeric"')}
        ${field('c-note', 'Observação (opcional)', 'maxlength="200"')}`,
      actions: [
        { label: 'Cancelar' },
        {
          label: 'Confirmar', kind: 'primary',
          onClick: async (c) => {
            c.setError('');
            const op = c.body.querySelector('#c-op .is-active').dataset.op;
            try {
              const { result } = await post(`/admin/users/${u.id}/credits`, {
                operation: op,
                amount: Number(c.body.querySelector('#c-amount').value),
                note: c.body.querySelector('#c-note').value.trim() || undefined,
              });
              c.close();
              toast(`Saldo de @${u.username}: ${fmtInt(result.balance)} crédito(s).`, 'ok');
              if (u.id === ctx.user.id) ctx.refreshUser();
              load();
            } catch (e) { c.setError(e.message); }
          },
        },
      ],
      onMount: (c) => c.body.querySelector('#c-op').addEventListener('click', (e) => {
        const b = e.target.closest('button[data-op]');
        if (!b) return;
        c.body.querySelectorAll('#c-op button').forEach((x) => x.classList.toggle('is-active', x === b));
      }),
    });
  }

  function passwordModal(u) {
    openModal({
      title: `Redefinir senha de @${u.username}`,
      html: field('p-new', 'Nova senha', 'type="password" autocomplete="new-password" maxlength="72"', 'Mínimo de 8 caracteres. Informe a nova senha ao usuário por um canal seguro.'),
      actions: [
        { label: 'Cancelar' },
        {
          label: 'Redefinir', kind: 'primary',
          onClick: async (c) => {
            c.setError('');
            try {
              await post(`/admin/users/${u.id}/password`, { password: c.body.querySelector('#p-new').value });
              c.close();
              toast('Senha redefinida.', 'ok');
            } catch (e) { c.setError(e.message); }
          },
        },
      ],
    });
  }

  async function detailsModal(u) {
    const ctl = openModal({
      title: `@${u.username}`, width: 720,
      html: '<div class="skeleton" style="height:180px"></div>',
    });
    try {
      const [{ stats: s }, act, tx, lic] = await Promise.all([
        get(`/admin/users/${u.id}`),
        get(`/admin/users/${u.id}/activity`, { limit: 10 }),
        get(`/admin/users/${u.id}/transactions`, { limit: 10 }),
        get('/admin/licenses', { user_id: u.id, limit: 10 }),
      ]);
      const txRows = tx.items.map((t) => `<tr><td data-label="Data" class="nowrap">${esc(fmtDate(t.created_at))}</td><td data-label="Operação">${esc({ LICENSE_PURCHASE: 'Geração de licenças', ADMIN_ADD: 'Crédito adicionado', ADMIN_REMOVE: 'Crédito removido' }[t.type] || t.type)}</td><td data-label="Valor" class="num right"><b style="color:var(${t.amount > 0 ? '--ok' : '--bad'})">${t.amount > 0 ? '+' : ''}${fmtInt(t.amount)}</b></td><td data-label="Saldo" class="num right">${fmtInt(t.balance_after)}</td></tr>`).join('');
      ctl.body.innerHTML = `
        <dl class="kv" style="margin-bottom:18px">
          <dt>Nome</dt><dd>${esc(u.display_name || '—')}</dd>
          <dt>Função / status</dt><dd>${roleBadge(u.role)} ${userStatusBadge(u.status)}</dd>
          <dt>Créditos</dt><dd class="num"><b>${fmtInt(s.credits)}</b> (${fmtInt(s.total_spent)} utilizados)</dd>
          <dt>Licenças</dt><dd>${fmtInt(s.total_licenses)} geradas · ${fmtInt(s.active_licenses)} ativas · ${fmtInt(s.expired_licenses)} expiradas · ${fmtInt(s.revoked_licenses)} revogadas</dd>
          <dt>Cadastro</dt><dd>${esc(fmtDate(u.created_at))}</dd>
        </dl>
        <div class="tabs" id="d-tabs"><button class="is-active" data-t="act">Atividades</button><button data-t="tx">Créditos</button><button data-t="lic">Licenças</button></div>
        <div id="d-act">${act.items.length ? `<ul class="timeline" style="margin:-4px -18px">${act.items.map((a) => { const d = describeActivity(a); return `<li><span class="timeline__dot ${d.tone ? `timeline__dot--${d.tone}` : ''}"></span><div><div class="timeline__text">${d.html}</div><div class="timeline__time">${esc(fmtDate(a.created_at))}</div></div></li>`; }).join('')}</ul>` : '<div class="empty"><strong>Sem atividades</strong></div>'}</div>
        <div id="d-tx" hidden>${tx.items.length ? `<div class="table-wrap"><table class="table stack"><thead><tr><th>Data</th><th>Operação</th><th class="right">Valor</th><th class="right">Saldo</th></tr></thead><tbody>${txRows}</tbody></table></div>` : '<div class="empty"><strong>Sem movimentações</strong></div>'}</div>
        <div id="d-lic" hidden>${lic.items.length ? `<div class="table-wrap"><table class="table stack"><thead><tr><th>Código</th><th>Validade</th><th>Expira em</th><th>Status</th></tr></thead><tbody>${lic.items.map((l) => `<tr><td class="cell-main"><span class="code">${esc(l.code)}</span></td><td data-label="Validade">${fmtInt(l.duration_days)} dia(s)</td><td data-label="Expira em" class="nowrap">${esc(fmtDate(l.expires_at))}</td><td data-label="Status">${licenseBadge(l.status)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty"><strong>Sem licenças</strong></div>'}</div>`;
      ctl.body.querySelector('#d-tabs').addEventListener('click', (e) => {
        const b = e.target.closest('button[data-t]');
        if (!b) return;
        ctl.body.querySelectorAll('#d-tabs button').forEach((x) => x.classList.toggle('is-active', x === b));
        ['act', 'tx', 'lic'].forEach((k) => { ctl.body.querySelector(`#d-${k}`).hidden = k !== b.dataset.t; });
      });
    } catch (e) {
      ctl.body.innerHTML = `<div class="alert alert--bad">${esc(e.message)}</div>`;
    }
  }

  async function toggleStatus(u, status) {
    const ok = await confirmDialog({
      title: status === 'SUSPENDED' ? 'Suspender conta' : 'Reativar conta',
      message: status === 'SUSPENDED'
        ? `@${u.username} não conseguirá mais entrar nem gerar licenças. Licenças já geradas continuam válidas.`
        : `@${u.username} voltará a ter acesso ao sistema.`,
      confirmLabel: status === 'SUSPENDED' ? 'Suspender' : 'Reativar',
      danger: status === 'SUSPENDED',
    });
    if (!ok) return;
    try {
      await patch(`/admin/users/${u.id}/status`, { status });
      toast(status === 'SUSPENDED' ? 'Conta suspensa.' : 'Conta reativada.', 'ok');
      load();
    } catch (e) { toast(e.message, 'bad'); }
  }

  function deleteModal(u) {
    openModal({
      title: 'Excluir usuário',
      html: `<p>Excluir <b>@${esc(u.username)}</b> remove o acesso e o saldo de créditos permanentemente. O histórico de licenças e de auditoria é preservado.</p>
        <label class="check"><input type="checkbox" id="d-revoke"><span>Revogar também todas as licenças ativas deste usuário</span></label>`,
      actions: [
        { label: 'Cancelar' },
        {
          label: 'Excluir definitivamente', kind: 'danger',
          onClick: async (c) => {
            try {
              const r = await del(`/admin/users/${u.id}`, { revoke_licenses: c.body.querySelector('#d-revoke').checked ? 'true' : 'false' });
              c.close();
              toast(r.licenses_revoked ? `Usuário excluído. ${fmtInt(r.licenses_revoked)} licença(s) revogada(s).` : 'Usuário excluído.', 'ok');
              load();
            } catch (e) { c.setError(e.message); }
          },
        },
      ],
    });
  }

  /* ---- eventos ---- */
  root.querySelector('#new-user').addEventListener('click', createModal);
  root.querySelector('#u-search').addEventListener('input', debounce((e) => { q.search = e.target.value.trim(); q.page = 1; load(); }, 300));
  root.querySelector('#u-status').addEventListener('change', (e) => { q.status = e.target.value; q.page = 1; load(); });
  holder.addEventListener('click', (e) => {
    const pg = e.target.closest('[data-page]');
    if (pg && !pg.disabled) { q.page = Number(pg.dataset.page); load(); return; }
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const u = holder._items?.get(btn.closest('tr').dataset.id);
    if (!u) return;
    ({
      details: () => detailsModal(u),
      credits: () => creditsModal(u),
      password: () => passwordModal(u),
      suspend: () => toggleStatus(u, 'SUSPENDED'),
      reactivate: () => toggleStatus(u, 'ACTIVE'),
      delete: () => deleteModal(u),
    })[btn.dataset.act]?.();
  });

  await load();
}
