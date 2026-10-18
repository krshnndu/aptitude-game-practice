// Plain SVG charts, no libraries: a line chart with crosshair tooltip and a bar chart with per-bar
// tooltips. Each chart ships a legend (2+ series) and a data table view, so no value is reachable
// only by hovering. Colours come from CSS custom properties (--series-1..3) set per theme.

import { el } from './dom.js';

const NS = 'http://www.w3.org/2000/svg';
const W = 640;

function s(tag, attrs = {}, ...children) {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined && v !== false) node.setAttribute(k, String(v));
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return node;
}

// Clean axis ticks from min to max.
export function niceTicks(min, max, count = 4) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1];
  if (min === max) {
    const pad = Math.abs(min) * 0.1 || 1;
    min -= pad;
    max += pad;
  }
  const raw = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((x) => x >= raw) ?? 10 * mag;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v / step) * step);
  return ticks;
}

function frame(height) {
  const m = { l: 46, r: 18, t: 18, b: 30 };
  return { m, pw: W - m.l - m.r, ph: height - m.t - m.b, h: height };
}

function legend(series) {
  if (series.length < 2) return null;
  return el('ul', { class: 'viz-legend', role: 'list' },
    series.map((sr) => el('li', {}, el('span', { class: `viz-key viz-key-${sr.mode === 'dots' ? 'dot' : 'line'}`, style: { '--key': sr.color } }), sr.name)));
}

function dataTable(caption, columns, rows) {
  return el('details', { class: 'viz-table' },
    el('summary', {}, 'Data table'),
    el('div', { class: 'table-wrap' },
      el('table', { class: 'results' },
        el('caption', { class: 'sr-only', text: caption }),
        el('thead', {}, el('tr', {}, columns.map((c) => el('th', { scope: 'col', text: c })))),
        el('tbody', {}, rows.map((r) => el('tr', {}, r.map((v) => el('td', { text: v === null || v === undefined ? '' : String(v) }))))),
      ),
    ),
  );
}

// opts: { title, subtitle, xLabels: string[], series: [{ name, values, color, mode: 'line'|'dots'|'both' }],
//         yFormat, yMin, yMax, markers: [{ index, label }], height, tableColumns, tableRows }
export function lineChart(opts) {
  const { title, subtitle = '', xLabels, series, yFormat = (v) => String(v), markers = [], height = 230 } = opts;
  const n = xLabels.length;
  const { m, pw, ph, h } = frame(height);
  const all = series.flatMap((sr) => sr.values).filter(Number.isFinite);
  const ticks = niceTicks(opts.yMin ?? Math.min(...all, 0), opts.yMax ?? Math.max(...all, 0.0001));
  const y0 = ticks[0];
  const y1 = ticks[ticks.length - 1];
  const x = (i) => m.l + (n <= 1 ? pw / 2 : (i * pw) / (n - 1));
  const y = (v) => m.t + ph - ((v - y0) / (y1 - y0 || 1)) * ph;

  const svg = s('svg', { viewBox: `0 0 ${W} ${h}`, class: 'viz-svg', role: 'img', 'aria-label': `${title}. ${subtitle}`, tabindex: '0' });
  for (const t of ticks) {
    svg.append(
      s('line', { x1: m.l, x2: W - m.r, y1: y(t), y2: y(t), class: t === y0 ? 'viz-axis' : 'viz-grid' }),
      s('text', { x: m.l - 8, y: y(t), class: 'viz-tick', 'text-anchor': 'end', 'dominant-baseline': 'middle' }, yFormat(t)),
    );
  }
  const every = Math.max(1, Math.ceil(n / 8));
  xLabels.forEach((lab, i) => {
    if (i % every && i !== n - 1) return;
    svg.append(s('text', { x: x(i), y: h - 8, class: 'viz-tick', 'text-anchor': 'middle' }, lab));
  });

  for (const sr of series) {
    if (sr.mode !== 'dots') {
      // Break the line at missing values.
      let d = '';
      let pen = false;
      sr.values.forEach((v, i) => {
        if (!Number.isFinite(v)) {
          pen = false;
          return;
        }
        d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
        pen = true;
      });
      if (d) svg.append(s('path', { d, class: 'viz-line', style: `stroke:${sr.color}` }));
    }
    if (sr.mode !== 'line') {
      sr.values.forEach((v, i) => {
        if (Number.isFinite(v)) svg.append(s('circle', { cx: x(i), cy: y(v), r: 4.5, class: 'viz-dot', style: `fill:${sr.color}` }));
      });
    }
  }
  const base = series[0];
  for (const mk of markers) {
    const v = base.values[mk.index];
    if (!Number.isFinite(v)) continue;
    svg.append(
      s('circle', { cx: x(mk.index), cy: y(v), r: 9, class: 'viz-jump-ring' }),
      s('text', { x: x(mk.index), y: Math.max(12, y(v) - 14), class: 'viz-jump-label', 'text-anchor': 'middle' }, mk.label),
    );
  }

  // Crosshair and tooltip, by pointer or arrow keys.
  const cross = s('line', { y1: m.t, y2: m.t + ph, class: 'viz-cross', visibility: 'hidden' });
  const hot = series.map((sr) => s('circle', { r: 6, class: 'viz-hot', style: `fill:${sr.color}`, visibility: 'hidden' }));
  svg.append(cross, ...hot);
  const overlay = s('rect', { x: m.l - 10, y: m.t, width: pw + 20, height: ph, fill: 'transparent' });
  svg.append(overlay);
  const tip = el('div', { class: 'viz-tip', hidden: true, role: 'status' });
  let cur = -1;
  function show(i) {
    if (i < 0 || i >= n) return hide();
    cur = i;
    cross.setAttribute('x1', x(i));
    cross.setAttribute('x2', x(i));
    cross.setAttribute('visibility', 'visible');
    series.forEach((sr, k) => {
      const v = sr.values[i];
      if (Number.isFinite(v)) {
        hot[k].setAttribute('cx', x(i));
        hot[k].setAttribute('cy', y(v));
        hot[k].setAttribute('visibility', 'visible');
      } else hot[k].setAttribute('visibility', 'hidden');
    });
    const mk = markers.find((q) => q.index === i);
    // replaceChildren would print a null as text, so build the list without it.
    const rows = [
      el('strong', { text: xLabels[i] + (opts.xDetail ? ` ${opts.xDetail(i)}` : '') }),
      ...series.map((sr) => el('span', {}, el('span', { class: 'viz-key viz-key-line', style: { '--key': sr.color } }), `${sr.name}: ${Number.isFinite(sr.values[i]) ? yFormat(sr.values[i]) : 'none'}`)),
    ];
    if (mk) rows.push(el('span', { class: 'viz-tip-flag', text: mk.detail ?? mk.label }));
    tip.replaceChildren(...rows);
    tip.hidden = false;
    const frac = x(i) / W;
    tip.style.left = `${Math.min(78, Math.max(2, frac * 100 - 10))}%`;
  }
  function hide() {
    cur = -1;
    cross.setAttribute('visibility', 'hidden');
    hot.forEach((d) => d.setAttribute('visibility', 'hidden'));
    tip.hidden = true;
  }
  overlay.addEventListener('pointermove', (e) => {
    const r = svg.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    show(n <= 1 ? 0 : Math.round(((px - m.l) / pw) * (n - 1)));
  });
  overlay.addEventListener('pointerleave', hide);
  svg.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      show(Math.max(0, Math.min(n - 1, (cur < 0 ? (e.key === 'ArrowRight' ? -1 : n) : cur) + (e.key === 'ArrowRight' ? 1 : -1))));
    } else if (e.key === 'Escape') hide();
  });
  svg.addEventListener('blur', hide);

  return el('figure', { class: 'viz' },
    el('figcaption', {}, el('span', { class: 'viz-title', text: title }), subtitle ? el('span', { class: 'viz-sub', text: subtitle }) : null),
    legend(series),
    el('div', { class: 'viz-plot' }, svg, tip),
    dataTable(title, opts.tableColumns ?? ['Point', ...series.map((sr) => sr.name)],
      opts.tableRows ?? xLabels.map((lab, i) => [lab, ...series.map((sr) => (Number.isFinite(sr.values[i]) ? yFormat(sr.values[i]) : ''))])),
  );
}

// opts: { title, subtitle, bars: [{ label, value, detail }], yFormat, yMax, height, color }
export function barChart(opts) {
  const { title, subtitle = '', bars, yFormat = (v) => String(v), height = 220, color = 'var(--series-1)' } = opts;
  const { m, pw, ph, h } = frame(height);
  const vals = bars.map((b) => b.value).filter(Number.isFinite);
  const ticks = niceTicks(0, opts.yMax ?? Math.max(...vals, 0.0001));
  const y1 = ticks[ticks.length - 1];
  const band = pw / Math.max(1, bars.length);
  const bw = Math.min(24, band * 0.6);
  const y = (v) => m.t + ph - (v / (y1 || 1)) * ph;
  const svg = s('svg', { viewBox: `0 0 ${W} ${h}`, class: 'viz-svg', role: 'img', 'aria-label': `${title}. ${subtitle}` });
  for (const t of ticks) {
    svg.append(
      s('line', { x1: m.l, x2: W - m.r, y1: y(t), y2: y(t), class: t === 0 ? 'viz-axis' : 'viz-grid' }),
      s('text', { x: m.l - 8, y: y(t), class: 'viz-tick', 'text-anchor': 'end', 'dominant-baseline': 'middle' }, yFormat(t)),
    );
  }
  const tip = el('div', { class: 'viz-tip', hidden: true, role: 'status' });
  bars.forEach((b, i) => {
    const cx = m.l + band * (i + 0.5);
    svg.append(s('text', { x: cx, y: h - 8, class: 'viz-tick', 'text-anchor': 'middle' }, b.label));
    if (!Number.isFinite(b.value)) {
      svg.append(s('text', { x: cx, y: m.t + ph - 6, class: 'viz-tick', 'text-anchor': 'middle' }, 'none'));
      return;
    }
    const top = y(b.value);
    const bh = m.t + ph - top;
    const r = Math.min(4, bh / 2, bw / 2);
    const x0 = cx - bw / 2;
    // Rounded data end, square at the baseline.
    const d = `M${x0},${m.t + ph}V${top + r}Q${x0},${top} ${x0 + r},${top}H${x0 + bw - r}Q${x0 + bw},${top} ${x0 + bw},${top + r}V${m.t + ph}Z`;
    const bar = s('path', { d, class: 'viz-bar', style: `fill:${color}`, tabindex: '0' }, s('title', {}, `${b.label}: ${yFormat(b.value)}`));
    const hit = s('rect', { x: cx - band / 2, y: m.t, width: band, height: ph, fill: 'transparent' });
    const on = () => {
      tip.replaceChildren(el('strong', { text: b.label }), el('span', { text: `${yFormat(b.value)}${b.detail ? `, ${b.detail}` : ''}` }));
      tip.hidden = false;
      tip.style.left = `${Math.min(78, Math.max(2, (cx / W) * 100 - 10))}%`;
    };
    const off = () => (tip.hidden = true);
    for (const node of [bar, hit]) {
      node.addEventListener('pointerenter', on);
      node.addEventListener('pointerleave', off);
    }
    bar.addEventListener('focus', on);
    bar.addEventListener('blur', off);
    svg.append(hit, bar, s('text', { x: cx, y: top - 6, class: 'viz-value', 'text-anchor': 'middle' }, yFormat(b.value)));
  });
  return el('figure', { class: 'viz' },
    el('figcaption', {}, el('span', { class: 'viz-title', text: title }), subtitle ? el('span', { class: 'viz-sub', text: subtitle }) : null),
    el('div', { class: 'viz-plot' }, svg, tip),
    dataTable(title, opts.tableColumns ?? ['Item', 'Value'], opts.tableRows ?? bars.map((b) => [b.label, Number.isFinite(b.value) ? yFormat(b.value) : 'none'])),
  );
}
