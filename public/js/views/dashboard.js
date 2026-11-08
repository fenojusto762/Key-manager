import { get } from '../api.js';
import { esc, icon, fmtInt, fmtDate, relTime, countUp, licenseBadge, userStatusBadge, roleBadge, describeActivity, initials } from '../ui.js';
import { lineChart, barChart, donutChart, COLORS } from '../charts.js';

const statCard = (label, value, sub, ic, accent = false) => `
  <div class="card stat ${accent ? 'stat--accent' : ''}">
    <div class="stat__label"><span>${esc(label)}</span>${icon(ic)}</div>
    <div class="stat__value" data-count="${Number(value) || 0}">0</div>
    <div class="stat__sub">${sub}</div>
  </div>`;

function runCounters(root) {
  root.querySelectorAll('[data-count]').forEach((el) => countUp(el, el.dataset.count));
}

const statusSegments = (s) => [
  { label: 'Ativas', value: s.active_licenses, color: COLORS.ok },
  { label: 'Expiradas', value: s.expired_licenses, color: COLORS.warn },
  { label: 'Revogadas', value: s.revoked_licenses, color: COLORS.bad },
];

/* ------------------------------- ADMIN ----------------------------------- */
async function adminDashboard(root) {
  const { stats: s, latest_users, recent_activity } = await get('/admin/stats');
  const labels = s.daily.map((d) => d.date);

  root.innerHTML = `
    <div class="page-head">
      <div><h1>Visão geral</h1><p>Resumo de usuários, créditos e licenças do sistema.</p></div>
      <div class="page-head__actions"><button class="btn" type="button" id="refresh">${icon('refresh')} Atualizar</button></div>
    </div>

    <div class="grid grid--stats">
      ${statCard('Usuários', s.total_users, `${fmtInt(s.active_users)} ativos · ${fmtInt(s.suspended_users)} suspensos`, 'users')}
      ${statCard('Créditos disponíveis', s.total_credits, 'soma do saldo de todos os usuários', 'coins', true)}
      ${statCard('Licenças geradas', s.total_licenses, 'total histórico', 'key')}
      ${statCard('Licenças ativas', s.active_licenses, 'válidas neste momento', 'shield')}
      ${statCard('Licenças expiradas', s.expired_licenses, `${fmtInt(s.revoked_licenses)} revogadas`, 'ban')}
    </div>

    <div class="grid grid--32">
      <div class="card"><div class="card__head"><div><div class="card__title">Licenças geradas por dia</div><div class="card__sub">Últimos 14 dias</div></div></div>
        <div class="card__body"><div id="ch-lic"></div></div></div>
      <div class="card"><div class="card__head"><div><div class="card__title">Situação das licenças</div><div class="card__sub">Distribuição atual</div></div></div>
        <div class="card__body"><div id="ch-status"></div></div></div>
    </div>

    <div class="grid grid--32">
      <div class="card"><div class="card__head"><div><div class="card__title">Créditos consumidos por dia</div><div class="card__sub">Débitos de geração, últimos 14 dias</div></div></div>
        <div class="card__body"><div id="ch-credits"></div></div></div>
      <div class="card"><div class="card__head"><div><div class="card__title">Licenças por validade</div><div class="card__sub">Quantidade gerada</div></div></div>
        <div class="card__body"><div id="ch-duration"></div></div></div>
    </div>

    <div class="grid grid--2">
      <div class="card card--flush"><div class="card__head" style="padding-bottom:6px"><div class="card__title">Últimos usuários cadastrados</div><a href="#/users">Ver todos</a></div>
        <div class="card__body">${
          latest_users.length
            ? `<ul class="mini-list">${latest_users.map((u) => `
              <li><div class="user-cell"><span class="avatar avatar--sm">${esc(initials(u.username))}</span>
                <div><div class="user-cell__name">${esc(u.display_name || u.username)}</div><div class="user-cell__sub">@${esc(u.username)} · ${esc(relTime(u.created_at))}</div></div></div>
                <div>${roleBadge(u.role)} ${userStatusBadge(u.status)}</div></li>`).join('')}</ul>`
            : '<div class="empty"><strong>Nenhum usuário ainda</strong></div>'
        }</div></div>
      <div class="card card--flush"><div class="card__head" style="padding-bottom:6px"><div class="card__title">Atividades recentes</div><a href="#/activity">Ver tudo</a></div>
        <div class="card__body">${
          recent_activity.length
            ? `<ul class="timeline">${recent_activity.map((a) => {
                const d = describeActivity(a);
                return `<li><span class="timeline__dot ${d.tone ? `timeline__dot--${d.tone}` : ''}"></span><div><div class="timeline__text">${d.html}</div><div class="timeline__time">${esc(fmtDate(a.created_at))}</div></div></li>`;
              }).join('')}</ul>`
            : '<div class="empty"><strong>Nenhuma atividade registrada</strong></div>'
        }</div></div>
    </div>`;

  runCounters(root);
  const destroyers = [
    lineChart(root.querySelector('#ch-lic'), { labels, series: [{ name: 'Licenças', values: s.daily.map((d) => d.licenses), color: COLORS.accent }] }),
    barChart(root.querySelector('#ch-credits'), { labels, values: s.daily.map((d) => d.credits), name: 'Créditos', color: COLORS.accent2, height: 220 }),
  ];
  donutChart(root.querySelector('#ch-status'), { segments: statusSegments(s), centerValue: s.total_licenses, centerLabel: 'licenças' });

  const palette = [COLORS.accent2, COLORS.accent, '#7c5cff', COLORS.ok, COLORS.warn];
  donutChart(root.querySelector('#ch-duration'), {
    segments: s.by_duration.length
      ? s.by_duration.map((d, i) => ({ label: `${d.days} dia${d.days > 1 ? 's' : ''}`, value: d.count, color: palette[i % palette.length] }))
      : [{ label: 'Sem licenças', value: 0, color: COLORS.muted }],
    centerValue: s.total_licenses,
    centerLabel: 'licenças',
  });

  root.querySelector('#refresh').addEventListener('click', () => {
    destroyers.forEach((d) => d());
    adminDashboard(root);
  });
  return () => destroyers.forEach((d) => d());
}

/* -------------------------------- USER ----------------------------------- */
async function userDashboard(root, ctx) {
  const [{ stats: s }, recent] = await Promise.all([get('/me/stats'), get('/me/licenses', { limit: 8 })]);
  const labels = s.daily.map((d) => d.date);

  root.innerHTML = `
    <div class="page-head">
      <div><h1>Olá, ${esc(ctx.user.display_name || ctx.user.username)}</h1><p>Seu saldo e suas licenças em um só lugar.</p></div>
      <div class="page-head__actions"><a class="btn btn--primary" href="#/generate">${icon('key')} Gerar licenças</a></div>
    </div>

    <div class="grid grid--stats">
      ${statCard('Créditos disponíveis', s.credits, 'saldo atual', 'coins', true)}
      ${statCard('Licenças geradas', s.total_licenses, `${fmtInt(s.total_spent)} crédito(s) utilizados`, 'key')}
      ${statCard('Licenças ativas', s.active_licenses, 'válidas neste momento', 'shield')}
      ${statCard('Licenças expiradas', s.expired_licenses, `${fmtInt(s.revoked_licenses)} revogadas`, 'ban')}
    </div>

    <div class="grid grid--32">
      <div class="card"><div class="card__head"><div><div class="card__title">Licenças geradas por dia</div><div class="card__sub">Últimos 14 dias</div></div></div>
        <div class="card__body"><div id="ch-lic"></div></div></div>
      <div class="card"><div class="card__head"><div><div class="card__title">Situação das licenças</div><div class="card__sub">Distribuição atual</div></div></div>
        <div class="card__body"><div id="ch-status"></div></div></div>
    </div>

    <div class="card card--flush">
      <div class="card__head" style="padding-bottom:12px"><div class="card__title">Histórico de geração</div><a href="#/licenses">Ver todas</a></div>
      <div class="card__body">${
        recent.items.length
          ? `<div class="table-wrap"><table class="table stack"><thead><tr><th>Código</th><th>Validade</th><th>Criada em</th><th>Expira em</th><th>Status</th></tr></thead><tbody>${recent.items.map((l) => `
            <tr><td class="cell-main" data-label="Código"><span class="code">${esc(l.code)}</span></td><td data-label="Validade">${fmtInt(l.duration_days)} dia(s)</td>
            <td data-label="Criada em" class="nowrap">${esc(fmtDate(l.created_at))}</td><td data-label="Expira em" class="nowrap">${esc(fmtDate(l.expires_at))}</td>
            <td data-label="Status">${licenseBadge(l.status)}</td></tr>`).join('')}</tbody></table></div>`
          : `<div class="empty">${icon('key')}<strong>Você ainda não gerou licenças</strong><a class="btn btn--sm btn--primary" href="#/generate">Gerar a primeira</a></div>`
      }</div>
    </div>`;

  runCounters(root);
  const destroy = lineChart(root.querySelector('#ch-lic'), {
    labels,
    series: [{ name: 'Licenças', values: s.daily.map((d) => d.licenses), color: COLORS.accent }],
    height: 220,
  });
  donutChart(root.querySelector('#ch-status'), { segments: statusSegments(s), centerValue: s.total_licenses, centerLabel: 'licenças' });
  return destroy;
}

export function dashboardView(root, ctx) {
  return ctx.user.role === 'ADMIN' ? adminDashboard(root, ctx) : userDashboard(root, ctx);
}
