import { get, post, put } from '../api.js';
import {
  esc, icon, fmtInt, fmtBRL, fmtDateTime, relTime, initials, debounce, pagerHtml, toast, openModal, copyText,
  payBadge, TX_LABELS, countUp,
} from '../ui.js';
import { barChart, COLORS } from '../charts.js';

const FLAGS = {
  AMOUNT_MISMATCH: ['Valor divergente', 'Valor pago diferente do cobrado. Nenhum crédito foi liberado — confira e reconsulte.'],
  PAID_AFTER_CLOSED: ['Pago após encerrado', 'Pagamento recebido depois de recusado/cancelado. Nenhum crédito foi liberado automaticamente.'],
  USER_MISSING: ['Usuário excluído', 'O comprador não existe mais; créditos não foram liberados.'],
  BALANCE_LIMIT: ['Limite de saldo', 'O saldo excederia o limite permitido.'],
  REFUNDED_REVIEW: ['Devolvido', 'Pagamento devolvido pelo provedor. Os créditos já liberados não são removidos automaticamente.'],
};
const flagBadge = (f) => (f ? `<span class="badge badge--warn badge--plain" title="${esc(FLAGS[f]?.[1] || '')}">${esc(FLAGS[f]?.[0] || f)}</span>` : '');
const stat = (label, value, sub, ic, tone = '', money = false) => `
  <div class="card stat ${tone}"><div class="stat__label"><span>${esc(label)}</span>${icon(ic)}</div>
  <div class="stat__value" ${money ? '' : `data-count="${Number(value) || 0}"`}>${money ? esc(value) : '0'}</div><div class="stat__sub">${esc(sub)}</div></div>`;

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const PRESETS = {
  today: () => { const t = iso(new Date()); return { from: t, to: t }; },
  '7d': () => ({ from: iso(new Date(Date.now() - 6 * 864e5)), to: iso(new Date()) }),
  '30d': () => ({ from: iso(new Date(Date.now() - 29 * 864e5)), to: iso(new Date()) }),
  all: () => ({ from: '', to: '' }),
};

export async function creditsPanelView(root) {
  const cleanups = [];
  const period = { preset: '30d', ...PRESETS['30d']() };

  root.innerHTML = `
    <div class="page-head"><div><h1>PAINEL CRÉDITOS</h1><p>Vendas de créditos, compradores, transações e configuração da Mistic Pay. Área exclusiva do Dono Master.</p></div>
      <div class="page-head__actions"><button class="btn" type="button" id="v-refresh">${icon('refresh')} Atualizar</button></div></div>
    <div class="tabs tabs--scroll" id="v-tabs"><button class="is-active" data-t="sum">Visão geral</button><button data-t="pay">Transações</button><button data-t="buy">Compradores</button><button data-t="tx">Extrato de créditos</button><button data-t="cfg">CONFIGURAÇÕES DE PAGAMENTO</button></div>
    <div id="v-period" class="period"></div>
    <div id="v-body"></div>`;
  const body = root.querySelector('#v-body');
  const periodEl = root.querySelector('#v-period');
  let tab = 'sum';

  function renderPeriod(show) {
    periodEl.hidden = !show;
    if (!show) return;
    periodEl.innerHTML = `<div class="seg seg--sm" id="pr-seg">${[['today', 'Hoje'], ['7d', '7 dias'], ['30d', '30 dias'], ['all', 'Tudo'], ['custom', 'Período']].map(([k, l]) => `<button type="button" data-p="${k}" class="${period.preset === k ? 'is-active' : ''}"><b>${l}</b></button>`).join('')}</div>
      <div class="period__custom" ${period.preset === 'custom' ? '' : 'hidden'}><input class="input" type="date" id="pr-from" value="${esc(period.from)}" aria-label="De"><span class="muted">até</span><input class="input" type="date" id="pr-to" value="${esc(period.to)}" aria-label="Até"></div>`;
  }
  periodEl.addEventListener('click', (e) => {
    const b = e.target.closest('[data-p]');
    if (!b) return;
    period.preset = b.dataset.p;
    if (PRESETS[b.dataset.p]) Object.assign(period, PRESETS[b.dataset.p]());
    show(tab);
  });
  periodEl.addEventListener('change', (e) => {
    if (e.target.id === 'pr-from' || e.target.id === 'pr-to') {
      period.from = periodEl.querySelector('#pr-from').value; period.to = periodEl.querySelector('#pr-to').value;
      if (period.from && period.to && period.from > period.to) { toast('A data inicial é maior que a final.', 'bad'); return; }
      show(tab);
    }
  });

  const tabs = {
    async sum() {
      const { summary: s, payments_enabled } = await get('/master/credits/summary', { from: period.from, to: period.to });
      body.innerHTML = `
        ${payments_enabled ? '' : `<div class="alert alert--warn" style="margin-bottom:16px">Mistic Pay ainda não configurada. Abra “CONFIGURAÇÕES DE PAGAMENTO” e informe as credenciais.</div>`}
        ${s.flagged_count ? `<div class="alert alert--warn" style="margin-bottom:16px">${fmtInt(s.flagged_count)} pagamento(s) pedem revisão (aba Transações → filtro “Em revisão”).</div>` : ''}
        <div class="grid grid--stats">
          ${stat('Faturamento (período)', fmtBRL(s.revenue_cents), `Total geral: ${fmtBRL(s.total_revenue_cents)}`, 'coins', 'stat--accent', true)}
          ${stat('Créditos vendidos', s.credits_sold, `Total geral: ${fmtInt(s.total_credits_sold)}`, 'key')}
          ${stat('Vendas realizadas', s.sales_count, `${fmtInt(s.buyers)} comprador(es) · ticket ${fmtBRL(s.avg_ticket_cents)}`, 'receipt')}
          ${stat('Pagamentos aprovados', s.sales_count, `Total geral: ${fmtInt(s.total_sales_count)}`, 'check')}
          ${stat('Pagamentos pendentes', s.pending_count, 'aguardando pagamento', 'clock')}
          ${stat('Recusados / devolvidos', s.refused_count + s.refunded_count, `${fmtInt(s.refused_count)} recusados · ${fmtInt(s.refunded_count)} devolvidos`, 'ban')}
        </div>
        <div class="grid grid--2">
          <div class="card"><div class="card__head"><div class="card__title">Faturamento por dia (R$)</div></div><div class="card__body"><div id="v-chart1"></div></div></div>
          <div class="card"><div class="card__head"><div class="card__title">Créditos vendidos por dia</div></div><div class="card__body"><div id="v-chart2"></div></div></div>
        </div>
        <div class="card"><div class="card__head"><div class="card__title">Maiores compradores do período</div></div><div class="card__body">
          ${s.top_buyers.length ? `<ul class="rank">${s.top_buyers.map((p) => `<li><span>${esc(p.username)}</span><b class="num">${fmtInt(p.credits)} créditos · ${fmtBRL(p.revenue_cents)}</b></li>`).join('')}</ul>` : '<div class="empty"><strong>Sem vendas no período</strong></div>'}</div></div>`;
      body.querySelectorAll('[data-count]').forEach((el) => countUp(el, el.dataset.count));
      const labels = s.by_day.map((d) => d.day);
      for (const [id, vals, col] of [['#v-chart1', s.by_day.map((d) => d.revenue_cents / 100), COLORS.accent2], ['#v-chart2', s.by_day.map((d) => d.credits), COLORS.accent]]) {
        const destroy = barChart(body.querySelector(id), { labels, values: vals, name: id === '#v-chart1' ? 'R$' : 'Créditos', color: col, height: 200 });
        if (typeof destroy === 'function') cleanups.push(destroy);
      }
    },

    async pay(extra = {}) {
      const q = { page: 1, status: '', search: '', user_id: extra.user_id || '' };
      let seq = 0;
      body.innerHTML = `<div class="card card--flush"><div class="toolbar">
        <label class="search">${icon('search')}<input class="input" id="p-search" type="search" placeholder="Usuário, pagador, ID da transação ou E2E" autocomplete="off"></label>
        <select class="select" id="p-status"><option value="">Todos os status</option><option value="approved">Aprovados</option><option value="pending">Pendentes</option><option value="refused">Recusados/cancelados</option><option value="refunded">Devolvidos</option><option value="flagged">Em revisão</option></select>
      </div><div id="p-table"></div></div>`;
      const holder = body.querySelector('#p-table');
      async function load() {
        const my = ++seq;
        let d;
        try { d = await get('/master/credits/payments', { page: q.page, limit: 15, status: q.status, search: q.search, user_id: q.user_id, from: period.from, to: period.to }); } catch (e) { holder.innerHTML = `<div class="empty"><strong>Erro</strong><span>${esc(e.message)}</span></div>`; return; }
        if (my !== seq) return;
        if (!d.items.length) { holder.innerHTML = `<div class="empty">${icon('receipt')}<strong>Nenhuma transação</strong><span>Ajuste os filtros ou o período.</span></div>`; return; }
        holder.innerHTML = `<div class="table-wrap"><table class="table stack"><thead><tr><th>Data e hora</th><th>Comprador</th><th class="right">Créditos</th><th class="right">Valor</th><th>ID Mistic Pay</th><th>Status</th><th></th></tr></thead>
          <tbody>${d.items.map((p) => `<tr>
            <td class="cell-main nowrap"><div class="num">${esc(fmtDateTime(p.created_at))}</div><div class="muted" style="font-size:12px">${p.paid_at ? `pago ${esc(relTime(p.paid_at))}` : esc(relTime(p.created_at))}</div></td>
            <td data-label="Comprador"><div class="user-cell"><span class="avatar avatar--sm">${esc(initials(p.username))}</span><div><div class="user-cell__name">${esc(p.username)}</div><div class="user-cell__sub">${esc(p.payer_name || '')} ${esc(p.payer_document_masked || '')}</div></div></div></td>
            <td data-label="Créditos" class="right num">${fmtInt(p.credits)}</td>
            <td data-label="Valor" class="right num"><b>${fmtBRL(p.amount_cents)}</b>${p.fee_cents != null ? `<div class="muted" style="font-size:11.5px">taxa ${fmtBRL(p.fee_cents)}</div>` : ''}</td>
            <td data-label="ID Mistic Pay"><button class="code code--btn" data-copy="${esc(p.provider_tx_id || p.id)}" title="Copiar">${esc((p.provider_tx_id || p.id).slice(0, 13))}…</button>${p.e2e ? `<div class="muted code" style="font-size:10.5px">${esc(p.e2e.slice(0, 16))}…</div>` : ''}</td>
            <td data-label="Status"><div class="status-cell">${payBadge(p.status)}${flagBadge(p.flag)}</div></td>
            <td>${p.status === 'PENDING' || p.flag ? `<button class="btn btn--sm" data-rec="${esc(p.id)}" title="Consulta o estado real na Mistic Pay">${icon('refresh')} Reconsultar</button>` : ''}</td></tr>`).join('')}</tbody></table></div>${pagerHtml({ page: d.page, limit: d.limit, total: d.total })}`;
      }
      if (extra.user_id) holder.insertAdjacentHTML('beforebegin', `<div class="alert" style="margin:12px"><b>${esc(extra.username)}</b> — histórico de compras <button class="btn btn--sm" id="p-clear" style="margin-left:8px">Ver todos</button></div>`);
      body.querySelector('#p-clear')?.addEventListener('click', () => show('pay'));
      body.querySelector('#p-search').addEventListener('input', debounce((e) => { q.search = e.target.value.trim(); q.page = 1; load(); }, 300));
      body.querySelector('#p-status').addEventListener('change', (e) => { q.status = e.target.value; q.page = 1; load(); });
      holder.addEventListener('click', async (e) => {
        const pg = e.target.closest('[data-page]');
        if (pg && !pg.disabled) { q.page = Number(pg.dataset.page); load(); return; }
        const c = e.target.closest('[data-copy]');
        if (c) { copyText(c.dataset.copy, 'ID da transação copiado!'); return; }
        const r = e.target.closest('[data-rec]');
        if (!r) return;
        r.disabled = true;
        try {
          const { result } = await post(`/master/credits/payments/${r.dataset.rec}/reconcile`);
          toast(result.credited ? 'Pagamento confirmado e créditos liberados.' : `Estado atual: ${result.status}.`, result.credited ? 'ok' : 'info');
        } catch (ex) { toast(ex.message, 'bad'); }
        load();
      });
      await load();
    },

    async buy() {
      const q = { page: 1, search: '' };
      let seq = 0;
      body.innerHTML = `<div class="card card--flush"><div class="toolbar"><label class="search">${icon('search')}<input class="input" id="b-search" type="search" placeholder="Pesquisar usuário comprador" autocomplete="off"></label></div><div id="b-table"></div></div>`;
      const holder = body.querySelector('#b-table');
      async function load() {
        const my = ++seq;
        let d;
        try { d = await get('/master/credits/buyers', { page: q.page, limit: 15, search: q.search }); } catch (e) { holder.innerHTML = `<div class="empty"><strong>Erro</strong><span>${esc(e.message)}</span></div>`; return; }
        if (my !== seq) return;
        if (!d.items.length) { holder.innerHTML = `<div class="empty">${icon('users')}<strong>Nenhum comprador</strong></div>`; return; }
        holder.innerHTML = `<div class="table-wrap"><table class="table stack"><thead><tr><th>Usuário</th><th class="right">Compras aprovadas</th><th class="right">Créditos</th><th class="right">Total pago</th><th>Última compra</th><th></th></tr></thead>
          <tbody>${d.items.map((b) => `<tr><td class="cell-main"><div class="user-cell"><span class="avatar avatar--sm">${esc(initials(b.username))}</span><div><div class="user-cell__name">${esc(b.username)}</div><div class="user-cell__sub">${fmtInt(b.attempts)} tentativa(s)</div></div></div></td>
            <td data-label="Compras" class="right num">${fmtInt(b.purchases)}</td><td data-label="Créditos" class="right num">${fmtInt(b.credits)}</td><td data-label="Total" class="right num"><b>${fmtBRL(b.total_cents)}</b></td>
            <td data-label="Última compra" class="nowrap muted">${b.last_purchase ? esc(relTime(b.last_purchase)) : '—'}</td>
            <td>${b.user_id ? `<button class="btn btn--sm" data-hist="${esc(b.user_id)}" data-name="${esc(b.username)}">${icon('receipt')} Histórico</button>` : '<span class="muted">excluído</span>'}</td></tr>`).join('')}</tbody></table></div>${pagerHtml({ page: d.page, limit: d.limit, total: d.total })}`;
      }
      body.querySelector('#b-search').addEventListener('input', debounce((e) => { q.search = e.target.value.trim(); q.page = 1; load(); }, 300));
      holder.addEventListener('click', (e) => {
        const pg = e.target.closest('[data-page]');
        if (pg && !pg.disabled) { q.page = Number(pg.dataset.page); load(); return; }
        const h = e.target.closest('[data-hist]');
        if (h) { tab = 'pay'; setTabUi('pay'); renderPeriod(true); period.preset = 'all'; Object.assign(period, PRESETS.all()); renderPeriod(true); tabs.pay({ user_id: h.dataset.hist, username: h.dataset.name }); }
      });
      await load();
    },

    async tx() {
      const q = { page: 1, type: '' };
      body.innerHTML = `<div class="card card--flush"><div class="toolbar"><select class="select" id="t-type"><option value="">Todos os tipos</option>${Object.entries(TX_LABELS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div><div id="t-table"></div></div>`;
      const holder = body.querySelector('#t-table');
      async function load() {
        const d = await get('/master/credits/transactions', { page: q.page, limit: 20, type: q.type });
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

    async cfg() {
      const { settings: s } = await get('/master/payment-settings');
      const dot = (ok, label) => `<span class="conn ${ok === true ? 'conn--on' : ok === false ? 'conn--off' : 'conn--idle'}"><i></i>${label}</span>`;
      const connLabel = s.connection.active ? 'Conexão ativa' : s.connection.tested_at ? 'Conexão inativa' : 'Não testada';
      body.innerHTML = `
        <div class="card"><div class="card__head"><div class="card__title">CONFIGURAÇÕES DE PAGAMENTO — Mistic Pay</div>${dot(s.connection.active ? true : s.connection.tested_at ? false : null, connLabel)}</div>
        <div class="card__body">
          ${!s.encryption_ready ? '<div class="alert alert--warn" style="margin-bottom:14px">O servidor não tem <code>APP_ENCRYPTION_KEY</code>. Sem ela não é possível salvar credenciais pelo painel.</div>' : ''}
          ${!s.app_url_set ? '<div class="alert alert--warn" style="margin-bottom:14px">Falta a variável <code>APP_URL</code> no servidor (necessária para o webhook).</div>' : ''}
          ${s.source === 'env' ? '<div class="alert" style="margin-bottom:14px">As credenciais atuais vêm das variáveis de ambiente do servidor. Salvar aqui passa a usar as do painel.</div>' : ''}
          ${s.connection.message ? `<div class="alert ${s.connection.active ? 'alert--ok' : 'alert--bad'}" style="margin-bottom:14px">${esc(s.connection.message)}</div>` : ''}
          <form id="c-form" novalidate autocomplete="off">
            <label class="field"><span>Client ID</span><input class="input" id="c-id" autocomplete="off" spellcheck="false" placeholder="${esc(s.client_id_masked || 'pk_… ou ci')}"><small>${s.client_id_masked ? `Salvo: ${esc(s.client_id_masked)}. Deixe em branco para manter.` : 'Chave pública (pk_…) ou ci da conta legada.'}</small></label>
            <label class="field"><span>Client Secret</span><input class="input" id="c-secret" type="password" autocomplete="new-password" placeholder="${s.has_client_secret ? '••••••••••••' : 'sk_… ou cs'}"><small>${s.has_client_secret ? 'Salvo e protegido. Deixe em branco para manter.' : 'Chave secreta (sk_…) ou cs. Nunca é exibida depois de salva.'}</small></label>
            <label class="field"><span>URL do webhook</span><input class="input" value="${esc(s.webhook_url || '')}" readonly><small>Enviada automaticamente em cada cobrança, com um segredo próprio ${s.webhook_secret_set ? '(já gerado)' : '(será gerado ao salvar)'}. Não é preciso cadastrar nada no painel da Mistic Pay.</small></label>
            <label class="field"><span>Ambiente</span><input class="input" value="${esc(s.environment)}" readonly><small>A API da Mistic Pay não oferece token adicional nem ambiente de testes: teste com um valor baixo.</small></label>
            <div class="cfg__actions">
              <button class="btn btn--primary" type="submit" id="c-save">SALVAR CONFIGURAÇÕES</button>
              <button class="btn" type="button" id="c-test" ${s.configured || s.has_client_secret ? '' : 'disabled'}>${icon('refresh')} TESTAR CONEXÃO</button>
              <button class="btn btn--ghost" type="button" id="c-rotate" ${s.has_client_secret ? '' : 'disabled'} title="Gera um novo segredo para o webhook">Gerar novo segredo do webhook</button>
            </div>
            ${s.connection.tested_at ? `<p class="muted" style="margin:12px 0 0;font-size:12.5px">Último teste: ${esc(fmtDateTime(s.connection.tested_at))}</p>` : ''}
          </form>
        </div></div>`;
      const form = body.querySelector('#c-form');
      const busy = (b, v) => { b.disabled = v; b.classList.toggle('is-loading', v); };
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = body.querySelector('#c-save'); busy(btn, true);
        try {
          await put('/master/payment-settings', { client_id: body.querySelector('#c-id').value.trim(), client_secret: body.querySelector('#c-secret').value.trim() });
          toast('Configurações salvas. Clique em TESTAR CONEXÃO.', 'ok');
          await tabs.cfg();
        } catch (ex) { toast(ex.message, 'bad'); busy(btn, false); }
      });
      body.querySelector('#c-test').addEventListener('click', async (e) => {
        const btn = e.currentTarget; busy(btn, true);
        try {
          const { result } = await post('/master/payment-settings/test');
          toast(result.message, result.ok ? 'ok' : 'bad');
          await tabs.cfg();
        } catch (ex) { toast(ex.message, 'bad'); busy(btn, false); }
      });
      body.querySelector('#c-rotate').addEventListener('click', async (e) => {
        const btn = e.currentTarget; busy(btn, true);
        try { await post('/master/payment-settings/rotate-webhook-secret'); toast('Novo segredo do webhook gerado.', 'ok'); await tabs.cfg(); } catch (ex) { toast(ex.message, 'bad'); busy(btn, false); }
      });
    },
  };

  function setTabUi(t) { root.querySelectorAll('#v-tabs button').forEach((b) => b.classList.toggle('is-active', b.dataset.t === t)); }
  async function show(t) {
    tab = t;
    cleanups.splice(0).forEach((f) => f());
    body.innerHTML = '<div class="skeleton" style="height:200px"></div>';
    setTabUi(t);
    renderPeriod(t === 'sum' || t === 'pay');
    try { await tabs[t](); } catch (e) { body.innerHTML = `<div class="card"><div class="empty"><strong>Erro ao carregar</strong><span>${esc(e.message)}</span></div></div>`; }
  }
  root.querySelector('#v-tabs').addEventListener('click', (e) => { const b = e.target.closest('button[data-t]'); if (b) show(b.dataset.t); });
  root.querySelector('#v-refresh').addEventListener('click', () => show(tab));
  await show('sum');
  return () => cleanups.forEach((f) => f());
}
