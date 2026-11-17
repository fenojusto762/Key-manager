import { get, post, patch, del } from '../api.js';
import {
  esc, icon, fmtInt, fmtBRL, fmtDateTime, relTime, initials, debounce, pagerHtml, toast, openModal, confirmDialog,
  payBadge, TX_LABELS, countUp,
} from '../ui.js';
import { barChart, COLORS } from '../charts.js';

const FLAGS = {
  AMOUNT_MISMATCH: ['Valor divergente', 'Valor pago diferente do preço do pacote. Nenhum crédito foi liberado — confira e reconsulte.'],
  PAID_AFTER_CLOSED: ['Pago após encerrado', 'Pagamento recebido depois de recusado/cancelado. Nenhum crédito foi liberado automaticamente.'],
  USER_MISSING: ['Usuário excluído', 'O comprador não existe mais; créditos não foram liberados.'],
  BALANCE_LIMIT: ['Limite de saldo', 'O saldo excederia o limite permitido.'],
  REFUNDED_REVIEW: ['Devolvido', 'Pagamento devolvido pelo provedor. Os créditos já liberados não são removidos automaticamente.'],
};
const flagBadge = (f) => (f ? `<span class="badge badge--warn badge--plain" title="${esc(FLAGS[f]?.[1] || '')}">${esc(FLAGS[f]?.[0] || f)}</span>` : '');
const stat = (label, value, sub, ic, tone = '', money = false) => `
  <div class="card stat ${tone}"><div class="stat__label"><span>${esc(label)}</span>${icon(ic)}</div>
  <div class="stat__value" ${money ? '' : `data-count="${Number(value) || 0}"`}>${money ? esc(value) : '0'}</div><div class="stat__sub">${esc(sub)}</div></div>`;

export async function salesView(root) {
  const cleanups = [];
  root.innerHTML = `
    <div class="page-head"><div><h1>Vendas</h1><p>Faturamento, pagamentos, pacotes de créditos e transações. Área exclusiva do Master.</p></div>
      <div class="page-head__actions"><button class="btn" type="button" id="v-refresh">${icon('refresh')} Atualizar</button></div></div>
    <div class="tabs" id="v-tabs"><button class="is-active" data-t="sum">Visão geral</button><button data-t="pay">Pagamentos</button><button data-t="pkg">Pacotes</button><button data-t="tx">Transações</button></div>
    <div id="v-body"></div>`;
  const body = root.querySelector('#v-body');
  let tab = 'sum';

  const tabs = {
    async sum() {
      const { summary: s, payments_enabled } = await get('/master/sales/summary');
      body.innerHTML = `
        ${payments_enabled ? '' : `<div class="alert alert--warn" style="margin-bottom:16px">Mistic Pay não configurada neste servidor (variáveis <code>MISTICPAY_CLIENT_ID</code>, <code>MISTICPAY_CLIENT_SECRET</code>, <code>MISTICPAY_WEBHOOK_SECRET</code> e <code>APP_URL</code>). A loja fica bloqueada até configurar.</div>`}
        ${s.flagged_count ? `<div class="alert alert--warn" style="margin-bottom:16px">${fmtInt(s.flagged_count)} pagamento(s) pedem revisão (veja “Pagamentos”).</div>` : ''}
        <div class="grid grid--stats">
          ${stat('Faturamento total', fmtBRL(s.revenue_cents), `${fmtBRL(s.revenue_30d_cents)} nos últimos 30 dias`, 'coins', 'stat--accent', true)}
          ${stat('Hoje', fmtBRL(s.revenue_today_cents), 'aprovado hoje', 'receipt', '', true)}
          ${stat('Créditos vendidos', s.credits_sold, `${fmtInt(s.buyers)} comprador(es)`, 'key')}
          ${stat('Aprovados', s.approved_count, 'pagamentos confirmados', 'check')}
          ${stat('Pendentes', s.pending_count, 'aguardando pagamento', 'clock')}
          ${stat('Recusados', s.refused_count, 'recusados ou cancelados', 'ban')}
        </div>
        <div class="grid grid--32">
          <div class="card"><div class="card__head"><div class="card__title">Faturamento diário (14 dias)</div></div><div class="card__body"><div id="v-chart"></div></div></div>
          <div class="card"><div class="card__head"><div class="card__title">Pacotes mais vendidos</div></div><div class="card__body">
            ${s.top_packages.length ? `<ul class="rank">${s.top_packages.map((p) => `<li><span>${esc(p.name)}</span><b class="num">${fmtInt(p.count)}× · ${fmtBRL(p.revenue_cents)}</b></li>`).join('')}</ul>` : '<div class="empty"><strong>Sem vendas ainda</strong></div>'}
          </div></div>
        </div>`;
      body.querySelectorAll('[data-count]').forEach((el) => countUp(el, el.dataset.count));
      const destroy = barChart(body.querySelector('#v-chart'), {
        labels: s.by_day.map((d) => d.day), values: s.by_day.map((d) => d.revenue_cents / 100), name: 'R$', color: COLORS.accent2, height: 220,
      });
      if (typeof destroy === 'function') cleanups.push(destroy);
    },

    async pay() {
      const q = { page: 1, status: '', search: '' };
      let seq = 0;
      body.innerHTML = `<div class="card card--flush"><div class="toolbar">
        <label class="search">${icon('search')}<input class="input" id="p-search" type="search" placeholder="Usuário, pacote ou pagador" autocomplete="off"></label>
        <select class="select" id="p-status"><option value="">Todos</option><option value="approved">Aprovados</option><option value="pending">Pendentes</option><option value="refused">Recusados/cancelados</option><option value="refunded">Devolvidos</option><option value="flagged">Em revisão</option></select>
      </div><div id="p-table"></div></div>`;
      const holder = body.querySelector('#p-table');
      async function load() {
        const my = ++seq;
        let d;
        try { d = await get('/master/sales', { page: q.page, limit: 15, status: q.status, search: q.search }); } catch (e) { holder.innerHTML = `<div class="empty"><strong>Erro</strong><span>${esc(e.message)}</span></div>`; return; }
        if (my !== seq) return;
        if (!d.items.length) { holder.innerHTML = `<div class="empty">${icon('receipt')}<strong>Nenhum pagamento</strong></div>`; return; }
        holder.innerHTML = `<div class="table-wrap"><table class="table stack"><thead><tr><th>Data</th><th>Usuário</th><th>Pacote</th><th class="right">Créditos</th><th class="right">Valor</th><th>Status</th><th></th></tr></thead>
          <tbody>${d.items.map((p) => `<tr>
            <td class="cell-main nowrap"><div class="num">${esc(fmtDateTime(p.created_at))}</div><div class="muted" style="font-size:12px">${p.paid_at ? `pago ${esc(relTime(p.paid_at))}` : esc(relTime(p.created_at))}</div></td>
            <td data-label="Usuário"><div class="user-cell"><span class="avatar avatar--sm">${esc(initials(p.username))}</span><div><div class="user-cell__name">${esc(p.username)}</div><div class="user-cell__sub">${esc(p.payer_name || '')} ${esc(p.payer_document_masked || '')}</div></div></div></td>
            <td data-label="Pacote">${esc(p.package_name)}</td>
            <td data-label="Créditos" class="right num">${fmtInt(p.credits)}</td>
            <td data-label="Valor" class="right num"><b>${fmtBRL(p.amount_cents)}</b>${p.fee_cents != null ? `<div class="muted" style="font-size:11.5px">taxa ${fmtBRL(p.fee_cents)}</div>` : ''}</td>
            <td data-label="Status"><div class="status-cell">${payBadge(p.status)}${flagBadge(p.flag)}${p.e2e ? `<small class="muted code">${esc(p.e2e)}</small>` : ''}</div></td>
            <td>${p.status === 'PENDING' || p.flag ? `<button class="btn btn--sm" data-rec="${esc(p.id)}" title="Consulta o estado real no provedor">${icon('refresh')} Reconsultar</button>` : ''}</td></tr>`).join('')}</tbody></table></div>${pagerHtml({ page: d.page, limit: d.limit, total: d.total })}`;
      }
      body.querySelector('#p-search').addEventListener('input', debounce((e) => { q.search = e.target.value.trim(); q.page = 1; load(); }, 300));
      body.querySelector('#p-status').addEventListener('change', (e) => { q.status = e.target.value; q.page = 1; load(); });
      holder.addEventListener('click', async (e) => {
        const pg = e.target.closest('[data-page]');
        if (pg && !pg.disabled) { q.page = Number(pg.dataset.page); load(); return; }
        const r = e.target.closest('[data-rec]');
        if (!r) return;
        r.disabled = true;
        try {
          const { result } = await post(`/master/sales/${r.dataset.rec}/reconcile`);
          toast(result.credited ? 'Pagamento confirmado e créditos liberados.' : `Estado atual: ${result.status}.`, result.credited ? 'ok' : 'info');
        } catch (ex) { toast(ex.message, 'bad'); }
        load();
      });
      await load();
    },

    async pkg() {
      const { packages } = await get('/master/packages');
      body.innerHTML = `<div class="card card--flush"><div class="card__head"><div class="card__title">Pacotes de créditos</div>
        <button class="btn btn--primary btn--sm" id="k-new">${icon('plus')} Novo pacote</button></div>
        ${packages.length ? `<div class="table-wrap"><table class="table stack"><thead><tr><th>Ordem</th><th>Nome</th><th class="right">Créditos</th><th class="right">Preço</th><th>Status</th><th></th></tr></thead>
        <tbody>${packages.map((p) => `<tr data-id="${esc(p.id)}"><td data-label="Ordem" class="num">${fmtInt(p.sort_order)}</td>
          <td class="cell-main"><b>${esc(p.name)}</b><div class="muted" style="font-size:12px">${esc(p.description || '')}</div></td>
          <td data-label="Créditos" class="right num">${fmtInt(p.credits)}</td><td data-label="Preço" class="right num"><b>${fmtBRL(p.price_cents)}</b></td>
          <td data-label="Status">${p.active ? '<span class="badge badge--ok">Ativo</span>' : '<span class="badge badge--muted">Oculto</span>'}</td>
          <td><div class="actions"><button class="icon-btn" data-edit title="Editar" aria-label="Editar">${icon('edit')}</button><button class="icon-btn icon-btn--bad" data-del title="Remover" aria-label="Remover">${icon('trash')}</button></div></td></tr>`).join('')}</tbody></table></div>`
        : `<div class="empty">${icon('cart')}<strong>Nenhum pacote</strong><span>Crie o primeiro pacote para abrir a loja.</span></div>`}</div>`;
      const map = new Map(packages.map((p) => [p.id, p]));

      function form(p) {
        const f = (id, label, val, attrs = '') => `<label class="field"><span>${label}</span><input class="input" id="${id}" value="${esc(val)}" ${attrs}></label>`;
        openModal({
          title: p ? `Editar ${p.name}` : 'Novo pacote',
          html: `<form novalidate autocomplete="off">${f('k-name', 'Nome', p?.name ?? '', 'maxlength="60"')}${f('k-desc', 'Descrição (opcional)', p?.description ?? '', 'maxlength="200"')}
            <div class="field field--row">${f('k-credits', 'Créditos', p?.credits ?? '', 'type="number" min="1" max="1000000" inputmode="numeric"')}${f('k-price', 'Preço (R$)', p ? (p.price_cents / 100).toFixed(2) : '', 'inputmode="decimal" placeholder="19,90"')}</div>
            <div class="field field--row">${f('k-order', 'Ordem de exibição', p?.sort_order ?? 0, 'type="number" min="0" max="9999"')}
            <label class="check" style="margin-top:22px"><input type="checkbox" id="k-active" ${p?.active ?? true ? 'checked' : ''}><span>Ativo na loja</span></label></div></form>`,
          actions: [{ label: 'Cancelar' }, {
            label: 'Salvar', kind: 'primary',
            onClick: async (c) => {
              c.setError('');
              const g = (id) => c.body.querySelector(id);
              const price = Math.round(parseFloat(String(g('#k-price').value).replace(/\./g, '').replace(',', '.')) * 100);
              const payload = { name: g('#k-name').value.trim(), description: g('#k-desc').value.trim(), credits: Number(g('#k-credits').value), price_cents: price, sort_order: Number(g('#k-order').value) || 0, active: g('#k-active').checked };
              try {
                if (!Number.isFinite(price)) throw new Error('Informe um preço válido (ex.: 19,90).');
                if (p) await patch(`/master/packages/${p.id}`, payload); else await post('/master/packages', payload);
                c.close(); toast('Pacote salvo.', 'ok'); tabs.pkg();
              } catch (e) { c.setError(e.message); }
            },
          }],
        });
      }
      body.querySelector('#k-new').addEventListener('click', () => form(null));
      body.addEventListener('click', async (e) => {
        const tr = e.target.closest('tr[data-id]');
        if (!tr) return;
        const p = map.get(tr.dataset.id);
        if (e.target.closest('[data-edit]')) form(p);
        if (e.target.closest('[data-del]')) {
          if (!(await confirmDialog({ title: 'Remover pacote', message: `Remover “${p.name}” da loja? Compras já feitas continuam no histórico.`, confirmLabel: 'Remover', danger: true }))) return;
          try { await del(`/master/packages/${p.id}`); toast('Pacote removido.', 'ok'); tabs.pkg(); } catch (ex) { toast(ex.message, 'bad'); }
        }
      });
    },

    async tx() {
      const q = { page: 1, type: '' };
      body.innerHTML = `<div class="card card--flush"><div class="toolbar"><select class="select" id="t-type"><option value="">Todos os tipos</option>${Object.entries(TX_LABELS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div><div id="t-table"></div></div>`;
      const holder = body.querySelector('#t-table');
      async function load() {
        const d = await get('/master/transactions', { page: q.page, limit: 20, type: q.type });
        holder.innerHTML = d.items.length ? `<div class="table-wrap"><table class="table stack"><thead><tr><th>Data</th><th>Usuário</th><th>Operação</th><th class="right">Valor</th><th class="right">Saldo</th><th>Por</th></tr></thead>
          <tbody>${d.items.map((t) => `<tr><td class="cell-main nowrap">${esc(fmtDateTime(t.created_at))}</td><td data-label="Usuário">${esc(t.username)}</td>
            <td data-label="Operação">${esc(t.description || TX_LABELS[t.type] || t.type)}</td>
            <td data-label="Valor" class="right num"><b style="color:var(${t.amount > 0 ? '--ok' : '--bad'})">${t.amount > 0 ? '+' : ''}${fmtInt(t.amount)}</b></td>
            <td data-label="Saldo" class="right num">${fmtInt(t.balance_after)}</td><td data-label="Por">${esc(t.performed_by_username || (t.payment_id ? 'Pix' : 'próprio'))}</td></tr>`).join('')}</tbody></table></div>${pagerHtml({ page: d.page, limit: d.limit, total: d.total })}`
          : '<div class="empty"><strong>Sem transações</strong></div>';
      }
      body.querySelector('#t-type').addEventListener('change', (e) => { q.type = e.target.value; q.page = 1; load(); });
      holder.addEventListener('click', (e) => { const pg = e.target.closest('[data-page]'); if (pg && !pg.disabled) { q.page = Number(pg.dataset.page); load(); } });
      await load();
    },
  };

  async function show(t) {
    tab = t;
    cleanups.splice(0).forEach((f) => f());
    body.innerHTML = '<div class="skeleton" style="height:200px"></div>';
    root.querySelectorAll('#v-tabs button').forEach((b) => b.classList.toggle('is-active', b.dataset.t === t));
    try { await tabs[t](); } catch (e) { body.innerHTML = `<div class="card"><div class="empty"><strong>Erro ao carregar</strong><span>${esc(e.message)}</span></div></div>`; }
  }
  root.querySelector('#v-tabs').addEventListener('click', (e) => { const b = e.target.closest('button[data-t]'); if (b) show(b.dataset.t); });
  root.querySelector('#v-refresh').addEventListener('click', () => show(tab));
  await show('sum');
  return () => cleanups.forEach((f) => f());
}
