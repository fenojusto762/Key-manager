import { get, post } from '../api.js';
import { esc, icon, fmtInt, fmtBRL, fmtDateTime, relTime, toast, openModal, copyText, payBadge, pagerHtml } from '../ui.js';

const cpfMask = (v) => {
  const d = v.replace(/\D/g, '').slice(0, 11);
  return d.replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2');
};

export async function storeView(root, ctx) {
  let page = 1;
  let seq = 0;
  const timers = new Set();

  root.innerHTML = `
    <div class="page-head"><div><h1>Loja de créditos</h1><p>Compre créditos com Pix. O saldo é liberado automaticamente após a confirmação do pagamento.</p></div>
      <div class="page-head__actions"><span class="credit-pill" style="cursor:default">${icon('coins')}<span class="num" id="s-balance">${fmtInt(ctx.user.credits)}</span> créditos</span></div></div>
    <div id="s-alert"></div>
    <div class="grid pkgs" id="s-pkgs"><div class="skeleton" style="height:190px"></div><div class="skeleton" style="height:190px"></div><div class="skeleton" style="height:190px"></div></div>
    <div class="card card--flush" style="margin-top:18px">
      <div class="card__head"><div class="card__title">Histórico de compras</div></div>
      <div id="s-hist"></div>
    </div>`;

  const pkgsEl = root.querySelector('#s-pkgs');
  const histEl = root.querySelector('#s-hist');
  const setBalance = (n) => { root.querySelector('#s-balance').textContent = fmtInt(n); ctx.refreshUser().catch(() => {}); };

  async function loadPackages() {
    const data = await get('/store/packages');
    if (!data.payments_enabled) {
      root.querySelector('#s-alert').innerHTML = `<div class="alert alert--warn" style="margin-bottom:16px">Os pagamentos estão temporariamente indisponíveis. Tente novamente mais tarde ou fale com o suporte.</div>`;
    }
    if (!data.packages.length) {
      pkgsEl.innerHTML = `<div class="card"><div class="empty">${icon('cart')}<strong>Nenhum pacote disponível</strong><span>Volte em breve.</span></div></div>`;
      return;
    }
    const best = Math.min(...data.packages.map((p) => p.price_cents / p.credits));
    pkgsEl.innerHTML = data.packages.map((p) => {
      const per = p.price_cents / p.credits;
      return `<div class="card pkg ${per === best && data.packages.length > 1 ? 'pkg--best' : ''}">
        ${per === best && data.packages.length > 1 ? '<span class="badge badge--ok badge--plain pkg__tag">Melhor custo</span>' : ''}
        <div class="pkg__name">${esc(p.name)}</div>
        <div class="pkg__credits"><span class="num">${fmtInt(p.credits)}</span> créditos</div>
        <div class="pkg__price">${fmtBRL(p.price_cents)}</div>
        <div class="muted pkg__per">${fmtBRL(Math.round(per))} por crédito</div>
        ${p.description ? `<p class="pkg__desc">${esc(p.description)}</p>` : ''}
        <button class="btn btn--primary btn--block" type="button" data-buy="${esc(p.id)}" ${data.payments_enabled ? '' : 'disabled'}>${icon('cart')} Comprar</button>
      </div>`;
    }).join('');
    pkgsEl._pkgs = new Map(data.packages.map((p) => [p.id, p]));
  }

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
      <thead><tr><th>Data</th><th>Pacote</th><th class="right">Créditos</th><th class="right">Valor</th><th>Método</th><th>Status</th></tr></thead>
      <tbody>${data.items.map((p) => `<tr>
        <td class="cell-main nowrap"><div class="num">${esc(fmtDateTime(p.created_at))}</div><div class="muted" style="font-size:12px">${esc(relTime(p.created_at))}</div></td>
        <td data-label="Pacote">${esc(p.package_name)}</td>
        <td data-label="Créditos" class="right num">${fmtInt(p.credits)}</td>
        <td data-label="Valor" class="right num">${fmtBRL(p.amount_cents)}</td>
        <td data-label="Método">${esc(p.method)}</td>
        <td data-label="Status">${payBadge(p.status)}</td></tr>`).join('')}</tbody></table></div>${pagerHtml({ page: data.page, limit: data.limit, total: data.total })}`;
  }

  /* ---- fluxo de compra ---- */
  function buyModal(pkg) {
    const ctl = openModal({
      title: `Comprar ${pkg.name}`,
      html: `<div class="alert" style="margin-bottom:14px"><b>${fmtInt(pkg.credits)} créditos</b> por <b>${fmtBRL(pkg.price_cents)}</b> via Pix.</div>
        <form id="b-form" novalidate autocomplete="off">
          <label class="field"><span>Nome completo do pagador</span><input class="input" id="b-name" maxlength="80" autocomplete="name"></label>
          <label class="field"><span>CPF do pagador</span><input class="input" id="b-cpf" inputmode="numeric" maxlength="14" placeholder="000.000.000-00"><small>Exigido pelo Pix. Guardamos apenas os 2 últimos dígitos.</small></label>
        </form>`,
      actions: [
        { label: 'Cancelar' },
        {
          label: 'Gerar Pix', kind: 'primary',
          onClick: async (c) => {
            c.setError('');
            try {
              const { payment } = await post('/store/checkout', {
                package_id: pkg.id,
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
      if (++tries > 450) { clearInterval(timer); timers.delete(timer); return; } // ~30 min
      try {
        const r = await get(`/store/payments/${pay.id}`);
        const st = r.payment.status;
        if (st === 'APPROVED') {
          clearInterval(timer); timers.delete(timer);
          ctl.body.querySelector('#pix-wait').innerHTML = `<div class="pix__done">${icon('check')}<h3>Pagamento confirmado!</h3><p>${fmtInt(r.payment.credits)} créditos adicionados. Novo saldo: <b>${fmtInt(r.balance)}</b>.</p></div>`;
          setBalance(r.balance);
          loadHistory();
          toast('Pagamento confirmado! Créditos adicionados.', 'ok');
        } else if (st !== 'PENDING') {
          clearInterval(timer); timers.delete(timer);
          ctl.body.querySelector('#pix-status').innerHTML = `Pagamento ${st === 'REFUSED' ? 'recusado' : 'encerrado'}. Gere um novo Pix para tentar de novo.`;
          loadHistory();
        }
      } catch { /* tenta de novo no próximo ciclo */ }
    }, 4000);
    timers.add(timer);
  }

  pkgsEl.addEventListener('click', (e) => {
    const b = e.target.closest('[data-buy]');
    if (!b) return;
    const pkg = pkgsEl._pkgs?.get(b.dataset.buy);
    if (pkg) buyModal(pkg);
  });
  histEl.addEventListener('click', (e) => {
    const pg = e.target.closest('[data-page]');
    if (pg && !pg.disabled) { page = Number(pg.dataset.page); loadHistory(); }
  });

  await Promise.all([loadPackages(), loadHistory()]);
  return () => { timers.forEach(clearInterval); timers.clear(); };
}
