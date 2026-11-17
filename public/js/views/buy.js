import { get, post } from '../api.js';
import { esc, icon, fmtInt, fmtBRL, fmtDateTime, relTime, toast, openModal, copyText, payBadge, pagerHtml } from '../ui.js';

const cpfMask = (v) => {
  const d = v.replace(/\D/g, '').slice(0, 11);
  return d.replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2');
};
const QUICK = [1, 5, 10, 25, 50, 100];

export async function buyView(root, ctx) {
  let page = 1;
  let seq = 0;
  const timers = new Set();
  const cfg = await get('/store/config');
  const price = cfg.price_cents;
  const st = { qty: 10 };

  root.innerHTML = `
    <div class="page-head"><div><h1>COMPRAR CRÉDITOS</h1><p>Escolha a quantidade, pague com Pix e receba os créditos automaticamente.</p></div></div>
    ${cfg.payments_enabled ? '' : `<div class="alert alert--warn" style="margin-bottom:16px">Os pagamentos estão temporariamente indisponíveis. Tente novamente mais tarde ou fale com o suporte.</div>`}
    <div class="buy">
      <div class="card buy__main">
        <div class="buy__balance"><span class="buy__lbl">Seu saldo atual</span><span class="buy__bal"><span class="num" id="b-balance">${fmtInt(cfg.balance)}</span> créditos</span></div>
        <label class="buy__lbl" for="b-qty">Quantos créditos você quer?</label>
        <div class="stepper buy__stepper">
          <button class="btn" type="button" id="b-minus" aria-label="Diminuir">${icon('minus')}</button>
          <input class="input" id="b-qty" type="number" inputmode="numeric" min="${cfg.min}" max="${cfg.max}" step="1" value="${st.qty}" aria-label="Quantidade de créditos">
          <button class="btn" type="button" id="b-plus" aria-label="Aumentar">${icon('plus')}</button>
        </div>
        <div class="buy__quick" id="b-quick">${QUICK.map((n) => `<button type="button" class="chip" data-q="${n}">${fmtInt(n)}</button>`).join('')}</div>
        <small class="muted">De ${fmtInt(cfg.min)} a ${fmtInt(cfg.max)} créditos por compra.</small>
      </div>
      <div class="card buy__sum">
        <div class="buy__row"><span>Quantidade selecionada</span><b class="num" id="s-qty">0</b></div>
        <div class="buy__row"><span>Preço por crédito</span><b class="num">${fmtBRL(price)}</b></div>
        <div class="buy__total"><span>Valor total</span><b class="num" id="s-total">R$ 0,00</b></div>
        <button class="btn btn--primary btn--lg btn--block" type="button" id="b-pay" ${cfg.payments_enabled ? '' : 'disabled'}>PAGAR AGORA</button>
        <p class="buy__note">${icon('lock')} Pagamento via Pix. Os créditos entram assim que o pagamento é confirmado.</p>
      </div>
    </div>
    <div class="card card--flush" style="margin-top:18px">
      <div class="card__head"><div class="card__title">Histórico de compras</div></div>
      <div id="s-hist"></div>
    </div>`;

  const qtyEl = root.querySelector('#b-qty');
  const histEl = root.querySelector('#s-hist');
  const clamp = (n) => Math.min(cfg.max, Math.max(cfg.min, Math.trunc(Number(n)) || cfg.min));
  const validQty = () => {
    const n = Number(qtyEl.value);
    return Number.isInteger(n) && n >= cfg.min && n <= cfg.max ? n : null;
  };
  function refresh() {
    const n = validQty();
    root.querySelector('#s-qty').textContent = n ? fmtInt(n) : '—';
    root.querySelector('#s-total').textContent = n ? fmtBRL(n * price) : '—';
    root.querySelector('#b-pay').disabled = !n || !cfg.payments_enabled;
    root.querySelectorAll('#b-quick .chip').forEach((c) => c.classList.toggle('is-active', Number(c.dataset.q) === n));
  }
  qtyEl.addEventListener('input', () => { qtyEl.value = qtyEl.value.replace(/[^\d]/g, '').slice(0, 5); refresh(); });
  qtyEl.addEventListener('blur', () => { qtyEl.value = clamp(qtyEl.value); refresh(); });
  root.querySelector('#b-minus').addEventListener('click', () => { qtyEl.value = clamp((validQty() || cfg.min) - 1); refresh(); });
  root.querySelector('#b-plus').addEventListener('click', () => { qtyEl.value = clamp((validQty() || cfg.min) + 1); refresh(); });
  root.querySelector('#b-quick').addEventListener('click', (e) => { const c = e.target.closest('[data-q]'); if (c) { qtyEl.value = c.dataset.q; refresh(); } });
  refresh();

  const setBalance = (n) => { root.querySelector('#b-balance').textContent = fmtInt(n); ctx.refreshUser().catch(() => {}); };

  async function loadHistory() {
    const my = ++seq;
    let data;
    try { data = await get('/store/payments', { page, limit: 10 }); } catch (e) {
      if (my === seq) histEl.innerHTML = `<div class="empty"><strong>Erro ao carregar</strong><span>${esc(e.message)}</span></div>`;
      return;
    }
    if (my !== seq) return;
    if (!data.items.length) { histEl.innerHTML = `<div class="empty">${icon('receipt')}<strong>Nenhuma compra ainda</strong><span>Suas compras aparecerão aqui.</span></div>`; return; }
    histEl.innerHTML = `<div class="table-wrap"><table class="table stack">
      <thead><tr><th>Data</th><th class="right">Créditos</th><th class="right">Valor</th><th>Método</th><th>Status</th></tr></thead>
      <tbody>${data.items.map((p) => `<tr>
        <td class="cell-main nowrap"><div class="num">${esc(fmtDateTime(p.created_at))}</div><div class="muted" style="font-size:12px">${esc(relTime(p.created_at))}</div></td>
        <td data-label="Créditos" class="right num">${fmtInt(p.credits)}</td>
        <td data-label="Valor" class="right num">${fmtBRL(p.amount_cents)}</td>
        <td data-label="Método">${esc(p.method)}</td>
        <td data-label="Status">${payBadge(p.status)}</td></tr>`).join('')}</tbody></table></div>${pagerHtml({ page: data.page, limit: data.limit, total: data.total })}`;
  }

  /* ---- pagamento ---- */
  function payerModal() {
    const n = validQty();
    if (!n) return;
    openModal({
      title: 'Dados do pagador',
      html: `<div class="alert" style="margin-bottom:14px"><b>${fmtInt(n)} crédito${n > 1 ? 's' : ''}</b> por <b>${fmtBRL(n * price)}</b> via Pix.</div>
        <form id="b-form" novalidate autocomplete="off">
          <label class="field"><span>Nome completo do pagador</span><input class="input" id="b-name" maxlength="80" autocomplete="name" value="${esc(ctx.user.display_name || '')}"></label>
          <label class="field"><span>CPF do pagador</span><input class="input" id="b-cpf" inputmode="numeric" maxlength="14" placeholder="000.000.000-00"><small>Exigido pelo Pix. Guardamos apenas os 2 últimos dígitos.</small></label>
        </form>`,
      actions: [
        { label: 'Cancelar' },
        {
          label: 'Continuar', kind: 'primary',
          onClick: async (c) => {
            c.setError('');
            try {
              // somente a QUANTIDADE vai ao servidor; o valor é calculado lá
              const { payment } = await post('/store/checkout', {
                credits: n,
                payer_name: c.body.querySelector('#b-name').value.trim(),
                payer_document: c.body.querySelector('#b-cpf').value,
              });
              c.close();
              payModal(payment);
              loadHistory();
            } catch (e) { c.setError(e.message); }
          },
        },
      ],
      onMount: (c) => {
        const cpf = c.body.querySelector('#b-cpf');
        cpf.addEventListener('input', () => { cpf.value = cpfMask(cpf.value); });
        c.body.querySelector('#b-form').addEventListener('submit', (e) => e.preventDefault());
      },
    });
  }

  function payModal(pay) {
    const qr = pay.qr_code_base64
      ? `<img class="pix__qr" alt="QR Code Pix" src="${esc(String(pay.qr_code_base64).startsWith('data:') ? pay.qr_code_base64 : `data:image/png;base64,${pay.qr_code_base64}`)}">`
      : `<div class="empty">${icon('qr')}<span>Use o Pix copia e cola abaixo.</span></div>`;
    const ctl = openModal({
      title: 'Pague com Pix', width: 460,
      html: `<div class="pix" id="pix-wait">
          <p class="muted" style="margin:0 0 10px">Abra o app do seu banco, escolha <b>Pix</b> e leia o QR Code ou cole o código. Valor: <b>${fmtBRL(pay.amount_cents)}</b>.</p>
          ${qr}
          ${pay.copy_paste ? `<label class="field" style="margin-top:12px"><span>Pix copia e cola</span><textarea class="input pix__code" id="pix-code" readonly rows="3">${esc(pay.copy_paste)}</textarea></label>
          <button class="btn btn--block" type="button" id="pix-copy">${icon('copy')} Copiar código Pix</button>` : ''}
          <p class="pix__status" id="pix-status"><span class="spinner"></span> Aguardando pagamento… a tela atualiza sozinha.</p>
        </div>`,
      actions: [{ label: 'Fechar' }],
      onMount: (c) => {
        c.body.querySelector('#pix-copy')?.addEventListener('click', () => copyText(pay.copy_paste, 'Código Pix copiado!'));
        c.body.querySelector('#pix-code')?.addEventListener('focus', (e) => e.target.select());
      },
    });

    let tries = 0;
    const timer = setInterval(async () => {
      if (!ctl.el.isConnected || !root.isConnected) { clearInterval(timer); timers.delete(timer); return; }
      if (++tries > 450) { clearInterval(timer); timers.delete(timer); return; }
      try {
        const r = await get(`/store/payments/${pay.id}`);
        const s = r.payment.status;
        if (s === 'APPROVED') {
          clearInterval(timer); timers.delete(timer);
          ctl.body.querySelector('#pix-wait').innerHTML = `<div class="pix__done">${icon('check')}<h3>Pagamento confirmado!</h3><p>${fmtInt(r.payment.credits)} créditos adicionados. Novo saldo: <b>${fmtInt(r.balance)}</b>.</p></div>`;
          setBalance(r.balance);
          loadHistory();
          toast('Pagamento confirmado! Créditos adicionados.', 'ok');
        } else if (s !== 'PENDING') {
          clearInterval(timer); timers.delete(timer);
          ctl.body.querySelector('#pix-status').innerHTML = `Pagamento ${s === 'REFUSED' ? 'recusado' : 'encerrado'}. Gere um novo Pix para tentar de novo.`;
          loadHistory();
        }
      } catch { /* tenta de novo no próximo ciclo */ }
    }, 4000);
    timers.add(timer);
  }

  root.querySelector('#b-pay').addEventListener('click', payerModal);
  histEl.addEventListener('click', (e) => {
    const pg = e.target.closest('[data-page]');
    if (pg && !pg.disabled) { page = Number(pg.dataset.page); loadHistory(); }
  });

  await loadHistory();
  return () => { timers.forEach(clearInterval); timers.clear(); };
}
