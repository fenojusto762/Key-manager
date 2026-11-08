import { get, post } from '../api.js';
import { esc, icon, fmtInt, fmtDate, toast, copyText, licenseBadge } from '../ui.js';

export async function generateView(root, ctx) {
  const plans = ctx.plans;
  const max = ctx.maxQuantity || 100;
  const st = { days: plans[1]?.days ?? plans[0]?.days, qty: 1, key: crypto.randomUUID(), busy: false, last: null };

  const planOf = (d) => plans.find((p) => p.days === d);
  const total = () => (planOf(st.days)?.credits ?? 0) * st.qty;

  root.innerHTML = `
    <div class="page-head"><div><h1>Gerar licença</h1><p>O custo é calculado antes da geração e debitado na mesma operação.</p></div></div>
    <div class="gen">
      <div class="card"><div class="card__head"><div class="card__title">Nova geração</div></div><div class="card__body">
        <div class="field"><span>Validade</span>
          <div class="seg" id="g-plans">${plans.map((p) => `<button type="button" data-days="${p.days}" class="${p.days === st.days ? 'is-active' : ''}"><b>${esc(p.label)}</b><span>${fmtInt(p.credits)} crédito${p.credits > 1 ? 's' : ''} / un.</span></button>`).join('')}</div>
        </div>
        <div class="field"><span>Quantidade de licenças</span>
          <div class="stepper">
            <button class="btn" type="button" id="g-minus" aria-label="Diminuir">${icon('minus')}</button>
            <input class="input" id="g-qty" type="number" inputmode="numeric" min="1" max="${max}" value="1" aria-label="Quantidade">
            <button class="btn" type="button" id="g-plus" aria-label="Aumentar">${icon('plus')}</button>
          </div><small>De 1 a ${max} por geração.</small>
        </div>
        <div id="g-alert"></div>
        <button class="btn btn--primary btn--block" type="button" id="g-submit">${icon('key')} GERAR LICENÇAS</button>
      </div></div>

      <div class="card"><div class="card__head"><div class="card__title">Resumo</div></div><div class="card__body">
        <div class="summary" id="g-summary"></div>
      </div></div>
    </div>

    <div class="card" id="g-result" hidden>
      <div class="card__head"><div><div class="card__title">Licenças geradas</div><div class="card__sub" id="g-result-sub"></div></div>
        <button class="btn btn--sm" type="button" id="g-copy-all">${icon('copy')} Copiar todas</button></div>
      <div class="card__body"><div class="license-list" id="g-list"></div></div>
    </div>

    <div class="card card--flush" style="margin-top:16px">
      <div class="card__head" style="padding-bottom:12px"><div class="card__title">Histórico de gerações</div><a href="#/licenses">Ver todas as licenças</a></div>
      <div class="card__body" id="g-history"></div>
    </div>`;

  const $ = (s) => root.querySelector(s);

  function paint() {
    const p = planOf(st.days);
    const bal = ctx.user.credits;
    const t = total();
    const short = t > bal;
    $('#g-qty').value = st.qty;
    $('#g-summary').innerHTML = `
      <div class="summary__row"><span>Validade</span><b>${esc(p?.label ?? '—')}</b></div>
      <div class="summary__row"><span>Custo por licença</span><b>${fmtInt(p?.credits)} crédito(s)</b></div>
      <div class="summary__row"><span>Quantidade</span><b>× ${fmtInt(st.qty)}</b></div>
      <div class="summary__row"><span>Seu saldo</span><b>${fmtInt(bal)} crédito(s)</b></div>
      <div class="summary__total"><span class="muted">Custo total</span><span><b>${fmtInt(t)}</b><small>crédito(s)</small></span></div>
      <div class="summary__row"><span>Saldo após gerar</span><b style="color:var(${short ? '--bad' : '--ok'})">${short ? 'insuficiente' : fmtInt(bal - t)}</b></div>`;
    $('#g-alert').innerHTML = short
      ? `<div class="alert alert--warn">Saldo insuficiente: faltam ${fmtInt(t - bal)} crédito(s). Peça ao administrador para adicionar créditos.</div>`
      : '';
    $('#g-submit').disabled = short || st.busy || bal <= 0;
    $('#g-plans').querySelectorAll('button').forEach((b) => b.classList.toggle('is-active', Number(b.dataset.days) === st.days));
  }

  const setQty = (v) => {
    const n = Math.max(1, Math.min(max, Math.floor(Number(v)) || 1));
    if (n !== st.qty) st.key = crypto.randomUUID();
    st.qty = n;
    paint();
  };

  $('#g-plans').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-days]');
    if (!b) return;
    st.days = Number(b.dataset.days);
    st.key = crypto.randomUUID();
    paint();
  });
  $('#g-minus').addEventListener('click', () => setQty(st.qty - 1));
  $('#g-plus').addEventListener('click', () => setQty(st.qty + 1));
  $('#g-qty').addEventListener('change', (e) => setQty(e.target.value));
  $('#g-qty').addEventListener('input', (e) => {
    const n = Math.floor(Number(e.target.value));
    if (n >= 1 && n <= max) { st.qty = n; st.key = crypto.randomUUID(); paint(); $('#g-qty').value = e.target.value; }
  });

  function showResult(r) {
    st.last = r;
    $('#g-result').hidden = false;
    $('#g-result-sub').textContent = `${fmtInt(r.quantity)} licença(s) de ${fmtInt(r.duration_days)} dia(s) · ${fmtInt(r.total_cost)} crédito(s) · válidas até ${fmtDate(r.licenses[0]?.expires_at)}`;
    $('#g-list').innerHTML = r.licenses.map((l, i) => `
      <div class="license-item" style="animation-delay:${Math.min(i, 12) * 30}ms">
        <div><span class="mono">${esc(l.code)}</span><small>expira em ${esc(fmtDate(l.expires_at))}</small></div>
        <button class="btn btn--sm" type="button" data-copy="${esc(l.code)}">${icon('copy')} Copiar</button>
      </div>`).join('');
    $('#g-result').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  $('#g-list').addEventListener('click', (e) => {
    const b = e.target.closest('[data-copy]');
    if (b) copyText(b.dataset.copy, 'Licença copiada!');
  });
  $('#g-copy-all').addEventListener('click', () => {
    if (st.last) copyText(st.last.licenses.map((l) => l.code).join('\n'), `${st.last.licenses.length} licença(s) copiada(s)!`);
  });

  async function loadHistory() {
    const el = $('#g-history');
    try {
      const { items } = await get('/me/transactions', { limit: 8 });
      el.innerHTML = items.length
        ? `<div class="table-wrap"><table class="table stack"><thead><tr><th>Data</th><th>Operação</th><th class="right">Créditos</th><th class="right">Saldo</th></tr></thead><tbody>${items.map((t) => `
            <tr><td data-label="Data" class="nowrap">${esc(fmtDate(t.created_at))}</td>
            <td data-label="Operação">${esc(t.description || { LICENSE_PURCHASE: 'Geração de licenças', ADMIN_ADD: 'Crédito adicionado', ADMIN_REMOVE: 'Crédito removido' }[t.type])}</td>
            <td data-label="Créditos" class="right num"><b style="color:var(${t.amount > 0 ? '--ok' : '--text'})">${t.amount > 0 ? '+' : ''}${fmtInt(t.amount)}</b></td>
            <td data-label="Saldo" class="right num">${fmtInt(t.balance_after)}</td></tr>`).join('')}</tbody></table></div>`
        : `<div class="empty">${icon('list')}<strong>Nenhuma movimentação ainda</strong></div>`;
    } catch (e) {
      el.innerHTML = `<div class="empty"><span>${esc(e.message)}</span></div>`;
    }
  }

  $('#g-submit').addEventListener('click', async () => {
    if (st.busy) return;
    st.busy = true;
    const btn = $('#g-submit');
    btn.classList.add('is-loading');
    btn.disabled = true;
    try {
      // A mesma idempotency_key é reenviada em caso de repetição: nunca há cobrança dupla.
      const r = await post('/licenses/generate', { quantity: st.qty, days: st.days, idempotency_key: st.key });
      st.key = crypto.randomUUID();
      showResult(r);
      ctx.setUser({ ...ctx.user, credits: r.balance });
      toast(`${fmtInt(r.quantity)} licença(s) gerada(s).`, 'ok');
      loadHistory();
    } catch (e) {
      toast(e.message, 'bad');
      if (e.code === 'INSUFFICIENT_CREDITS' || e.status === 403) await ctx.refreshUser().catch(() => {});
    } finally {
      st.busy = false;
      btn.classList.remove('is-loading');
      paint();
    }
  });

  paint();
  await loadHistory();
}
