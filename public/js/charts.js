// Gráficos em SVG puro (sem bibliotecas externas): linha/área, barras e rosca.
import { esc, fmtInt, fmtDay } from './ui.js';

export const COLORS = {
  accent: '#3d7bff',
  accent2: '#8db0ff',
  ok: '#2dd4a0',
  warn: '#f5b53d',
  bad: '#ff5d6c',
  muted: '#4a5365',
};

let uid = 0;

function niceStep(v) {
  const pow = 10 ** Math.floor(Math.log10(v));
  for (const c of [1, 2, 5, 10]) if (c * pow >= v) return c * pow;
  return 10 * pow;
}

function scaleFor(maxVal) {
  const step = Math.max(1, niceStep(Math.max(maxVal, 1) / 4));
  return { step, max: step * 4 };
}

const compact = (n) => (n >= 10000 ? `${Math.round(n / 1000)}k` : fmtInt(n));

function axes({ w, h, m, labels, max, step, n, xAt }) {
  const iw = w - m.l - m.r;
  const ih = h - m.t - m.b;
  let g = '';
  for (let t = 0; t <= 4; t++) {
    const v = t * step;
    const y = m.t + ih - (v / max) * ih;
    g += `<line class="gl" x1="${m.l}" x2="${w - m.r}" y1="${y}" y2="${y}"/>`;
    g += `<text class="tick" x="${m.l - 8}" y="${y + 3.5}" text-anchor="end">${compact(v)}</text>`;
  }
  const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(iw / 54))));
  for (let i = 0; i < n; i += every) {
    g += `<text class="tick" x="${xAt(i)}" y="${h - 6}" text-anchor="middle">${esc(fmtDay(labels[i]))}</text>`;
  }
  return g;
}

function mountTooltip(el, svg, { n, xAt, m, iw, w, rowsAt, onMove, onLeave }) {
  const tip = el.querySelector('.chart__tip');
  const move = (ev) => {
    const r = svg.getBoundingClientRect();
    const px = (ev.clientX - r.left) * (w / r.width);
    const i = n <= 1 ? 0 : Math.min(n - 1, Math.max(0, Math.round(((px - m.l) / iw) * (n - 1))));
    tip.innerHTML = rowsAt(i);
    tip.hidden = false;
    const left = Math.min(Math.max((xAt(i) / w) * r.width, 70), r.width - 70);
    tip.style.left = `${left}px`;
    onMove?.(i);
  };
  const leave = () => { tip.hidden = true; onLeave?.(); };
  const hit = svg.querySelector('.hit');
  hit.addEventListener('pointermove', move);
  hit.addEventListener('pointerdown', move);
  hit.addEventListener('pointerleave', leave);
}

/**
 * lineChart(el, { labels: ['YYYY-MM-DD'], series: [{ name, values, color }], height })
 * Retorna uma função destroy().
 */
export function lineChart(el, { labels, series, height = 240 }) {
  el.classList.add('chart');
  const id = ++uid;
  let lastW = 0;

  const render = () => {
    const w = Math.max(el.clientWidth, 260);
    lastW = el.clientWidth;
    const h = height;
    const m = { t: 14, r: 14, b: 26, l: 38 };
    const iw = w - m.l - m.r;
    const ih = h - m.t - m.b;
    const n = labels.length;
    const { max, step } = scaleFor(Math.max(0, ...series.flatMap((s) => s.values)));
    const xAt = (i) => m.l + (n <= 1 ? iw / 2 : (i * iw) / (n - 1));
    const yAt = (v) => m.t + ih - (v / max) * ih;

    let paths = '';
    series.forEach((s, si) => {
      const pts = s.values.map((v, i) => [xAt(i), yAt(v)]);
      let d = `M${pts[0][0]},${pts[0][1]}`;
      for (let i = 1; i < pts.length; i++) {
        const [x0, y0] = pts[i - 1];
        const [x1, y1] = pts[i];
        const mx = (x0 + x1) / 2;
        d += ` C${mx},${y0} ${mx},${y1} ${x1},${y1}`;
      }
      const area = `${d} L${pts[pts.length - 1][0]},${m.t + ih} L${pts[0][0]},${m.t + ih} Z`;
      paths += `<defs><linearGradient id="g${id}-${si}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="${s.color}" stop-opacity=".30"/><stop offset="1" stop-color="${s.color}" stop-opacity="0"/>
        </linearGradient></defs>
        <path class="area" d="${area}" fill="url(#g${id}-${si})"/>
        <path class="line" d="${d}" stroke="${s.color}" pathLength="1"/>`;
    });

    el.innerHTML = `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="Gráfico de linhas">
      ${axes({ w, h, m, labels, max, step, n, xAt })}${paths}
      <line class="guide" x1="0" x2="0" y1="${m.t}" y2="${m.t + ih}" opacity="0"/>
      <g class="dots"></g>
      <rect class="hit" x="${m.l}" y="${m.t}" width="${iw}" height="${ih}" fill="transparent"/>
    </svg><div class="chart__tip" hidden></div>`;

    const svg = el.querySelector('svg');
    const guide = svg.querySelector('.guide');
    const dots = svg.querySelector('.dots');
    mountTooltip(el, svg, {
      n, xAt, m, iw, w,
      rowsAt: (i) =>
        `<b>${esc(fmtDay(labels[i]))}</b>` +
        series.map((s) => `<span><i style="background:${s.color}"></i>${esc(s.name)}: <strong>${fmtInt(s.values[i])}</strong></span>`).join(''),
      onMove: (i) => {
        guide.setAttribute('x1', xAt(i));
        guide.setAttribute('x2', xAt(i));
        guide.setAttribute('opacity', '1');
        dots.innerHTML = series
          .map((s) => `<circle class="dot" cx="${xAt(i)}" cy="${yAt(s.values[i])}" r="4.5" fill="${s.color}"/>`)
          .join('');
      },
      onLeave: () => { guide.setAttribute('opacity', '0'); dots.innerHTML = ''; },
    });
  };

  render();
  const ro = new ResizeObserver(() => {
    if (Math.abs(el.clientWidth - lastW) > 2) render();
  });
  ro.observe(el);
  return () => ro.disconnect();
}

/** barChart(el, { labels, values, name, color, height }) */
export function barChart(el, { labels, values, name = 'Valor', color = COLORS.accent, height = 240 }) {
  el.classList.add('chart');
  let lastW = 0;

  const render = () => {
    const w = Math.max(el.clientWidth, 260);
    lastW = el.clientWidth;
    const h = height;
    const m = { t: 14, r: 14, b: 26, l: 38 };
    const iw = w - m.l - m.r;
    const ih = h - m.t - m.b;
    const n = labels.length;
    const { max, step } = scaleFor(Math.max(0, ...values));
    const slot = iw / n;
    const bw = Math.max(4, Math.min(28, slot * 0.58));
    const xAt = (i) => m.l + slot * i + slot / 2;
    const yAt = (v) => m.t + ih - (v / max) * ih;

    const bars = values
      .map((v, i) => {
        const bh = Math.max(v > 0 ? 2 : 0, (v / max) * ih);
        return `<rect class="bar" data-i="${i}" x="${xAt(i) - bw / 2}" y="${m.t + ih - bh}" width="${bw}" height="${bh}" rx="3" fill="${color}" opacity=".85" style="animation-delay:${i * 28}ms"/>`;
      })
      .join('');

    el.innerHTML = `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="Gráfico de barras">
      ${axes({ w, h, m, labels, max, step, n, xAt })}${bars}
      <rect class="hit" x="${m.l}" y="${m.t}" width="${iw}" height="${ih}" fill="transparent"/>
    </svg><div class="chart__tip" hidden></div>`;

    const svg = el.querySelector('svg');
    mountTooltip(el, svg, {
      n, xAt: (i) => xAt(i), m, iw: iw - slot, w,
      rowsAt: (i) => `<b>${esc(fmtDay(labels[i]))}</b><span><i style="background:${color}"></i>${esc(name)}: <strong>${fmtInt(values[i])}</strong></span>`,
      onMove: (i) => svg.querySelectorAll('.bar').forEach((b) => { b.style.opacity = Number(b.dataset.i) === i ? '1' : '.55'; }),
      onLeave: () => svg.querySelectorAll('.bar').forEach((b) => { b.style.opacity = '.85'; }),
    });
  };

  render();
  const ro = new ResizeObserver(() => {
    if (Math.abs(el.clientWidth - lastW) > 2) render();
  });
  ro.observe(el);
  return () => ro.disconnect();
}

/** donutChart(el, { segments: [{ label, value, color }], centerValue, centerLabel }) */
export function donutChart(el, { segments, centerValue, centerLabel }) {
  const total = segments.reduce((a, s) => a + s.value, 0);
  const R = 54;
  const C = 2 * Math.PI * R;
  const visible = segments.filter((s) => s.value > 0);
  let offset = 0;
  const arcs = visible
    .map((s) => {
      const len = (s.value / total) * C;
      const gap = visible.length > 1 ? 3 : 0;
      const arc = `<circle class="donut__arc" cx="70" cy="70" r="${R}" stroke="${s.color}" stroke-dasharray="${Math.max(len - gap, 0.5)} ${C}" stroke-dashoffset="${-offset}" transform="rotate(-90 70 70)"/>`;
      offset += len;
      return arc;
    })
    .join('');

  el.innerHTML = `<div class="donut">
    <div class="donut__svg">
      <svg viewBox="0 0 140 140" role="img" aria-label="Gráfico de rosca"><circle class="donut__ring" cx="70" cy="70" r="${R}"/>${arcs}</svg>
      <div class="donut__center"><b>${fmtInt(centerValue ?? total)}</b><span>${esc(centerLabel || 'total')}</span></div>
    </div>
    <div class="legend"><ul>${segments
      .map((s) => {
        const pct = total ? Math.round((s.value / total) * 100) : 0;
        return `<li><i style="background:${s.color}"></i>${esc(s.label)}<b>${fmtInt(s.value)}</b><em>${pct}%</em></li>`;
      })
      .join('')}</ul></div>
  </div>`;
}
