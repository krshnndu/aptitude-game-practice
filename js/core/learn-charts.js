// Small SVG charts for the learning pages, no libraries: sparkline, weekly stacked bars of coach tags
// and a pace histogram with a par line. Inline SVG, so the printed and exported report keep them.
// Every chart has a text alternative (aria-label plus a data table); hover detail uses focusable
// marks with <title>, which also works in the exported file.

import { el } from './dom.js';

const NS = 'http://www.w3.org/2000/svg';
function s(tag, attrs = {}, ...children) {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined && v !== false) node.setAttribute(k, String(v));
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return node;
}

// Rounded data end, square at the baseline.
function barPath(x0, top, bw, base) {
  const r = Math.min(4, (base - top) / 2, bw / 2);
  return `M${x0},${base}V${top + r}Q${x0},${top} ${x0 + r},${top}H${x0 + bw - r}Q${x0 + bw},${top} ${x0 + bw},${top + r}V${base}Z`;
}

function details(caption, columns, rows) {
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

// values: numbers or null (gaps). fmt: value -> text.
export function sparkline(values, { label = 'Trend', fmt = String, width = 120, height = 28 } = {}) {
  const pts = values.map((v, i) => [i, v]).filter(([, v]) => Number.isFinite(v));
  const svg = s('svg', { viewBox: `0 0 ${width} ${height}`, class: 'spark', width, height, role: 'img' });
  if (pts.length < 2) {
    svg.setAttribute('aria-label', `${label}: not enough data for a trend`);
    svg.append(s('line', { x1: 2, x2: width - 2, y1: height / 2, y2: height / 2, class: 'spark-empty' }));
    return svg;
  }
  const ys = pts.map(([, v]) => v);
  const lo = Math.min(...ys);
  const hi = Math.max(...ys);
  const x = (i) => 2 + (i * (width - 6)) / Math.max(1, values.length - 1);
  const y = (v) => height - 3 - ((v - lo) / (hi - lo || 1)) * (height - 6);
  let d = '';
  let pen = false;
  values.forEach((v, i) => {
    if (!Number.isFinite(v)) {
      pen = false;
      return;
    }
    d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
    pen = true;
  });
  const [li, lv] = pts[pts.length - 1];
  svg.setAttribute('aria-label', `${label}: from ${fmt(pts[0][1])} to ${fmt(lv)} over the last ${values.length} days`);
  svg.append(
    s('path', { d, class: 'spark-line' }),
    s('circle', { cx: x(li), cy: y(lv), r: 2.5, class: 'spark-dot' }, s('title', {}, `Latest: ${fmt(lv)}`)),
  );
  return svg;
}

// rows: [{ start, counts: { tag: n }, tagged }]; tags: top tags to colour (max 3), rest fold into Other.
export function stackedWeeks({ rows, top, labelOf = (t) => t, title, subtitle, resolved = [] }) {
  const W = 640;
  const H = 220;
  const m = { l: 40, r: 12, t: 14, b: 30 };
  const pw = W - m.l - m.r;
  const ph = H - m.t - m.b;
  const colours = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)'];
  const keys = top.slice(0, 3);
  const segs = rows.map((r) => {
    const parts = keys.map((k) => r.counts[k] ?? 0);
    const other = Object.entries(r.counts).filter(([k]) => !keys.includes(k)).reduce((a, [, v]) => a + v, 0);
    return [...parts, other];
  });
  const max = Math.max(1, ...segs.map((p) => p.reduce((a, b) => a + b, 0)));
  const step = Math.max(1, Math.ceil(max / 4));
  const yMax = step * Math.ceil(max / step);
  const y = (v) => m.t + ph - (v / yMax) * ph;
  const band = pw / rows.length;
  const bw = Math.min(26, band * 0.6);
  const date = (ts) => new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'viz-svg', role: 'img', 'aria-label': `${title}. ${subtitle}` });
  for (let v = 0; v <= yMax; v += step) {
    svg.append(
      s('line', { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v), class: v === 0 ? 'viz-axis' : 'viz-grid' }),
      s('text', { x: m.l - 8, y: y(v), class: 'viz-tick', 'text-anchor': 'end', 'dominant-baseline': 'middle' }, String(v)),
    );
  }
  const names = [...keys.map(labelOf), 'Other'];
  rows.forEach((r, i) => {
    const cx = m.l + band * (i + 0.5);
    svg.append(s('text', { x: cx, y: H - 8, class: 'viz-tick', 'text-anchor': 'middle' }, date(r.start)));
    const lastK = segs[i].reduce((last, v, k) => (v ? k : last), -1);
    let acc = 0;
    segs[i].forEach((v, k) => {
      if (!v) return;
      // 2px surface gap above every segment but the first; only the top segment is rounded.
      const base = y(acc) - (acc > 0 ? 2 : 0);
      acc += v;
      const top = y(acc);
      const seg = s('path', {
        d: k === lastK ? barPath(cx - bw / 2, top, bw, base) : `M${cx - bw / 2},${base}V${top}H${cx + bw / 2}V${base}Z`,
        class: k === keys.length ? 'viz-bar viz-bar-other' : 'viz-bar',
        style: k === keys.length ? null : `fill:${colours[k]}`,
        tabindex: '0',
      }, s('title', {}, `Week of ${date(r.start)}: ${names[k]} ${v}`));
      svg.append(seg);
    });
  });
  const legend = el('ul', { class: 'viz-legend', role: 'list' },
    names.map((n, k) => el('li', { class: k < keys.length && resolved.includes(keys[k]) ? 'is-resolved' : null },
      el('span', { class: `viz-key viz-key-dot${k === keys.length ? ' viz-key-other' : ''}`, style: k < keys.length ? { '--key': colours[k] } : null }), n)));
  return el('figure', { class: 'viz' },
    el('figcaption', {}, el('span', { class: 'viz-title', text: title }), el('span', { class: 'viz-sub', text: subtitle })),
    legend,
    el('div', { class: 'viz-plot' }, svg),
    details(title, ['Week of', ...names, 'Tagged attempts'], rows.map((r, i) => [date(r.start), ...segs[i], r.tagged])),
  );
}

// rows: [{ label, n, accuracy }]; parAfter: index of the bucket the par line follows.
export function paceHistogram({ rows, parAfter = 1, title, subtitle }) {
  const W = 640;
  const H = 220;
  const m = { l: 40, r: 12, t: 18, b: 44 };
  const pw = W - m.l - m.r;
  const ph = H - m.t - m.b;
  const max = Math.max(1, ...rows.map((r) => r.n));
  const step = Math.max(1, Math.ceil(max / 4));
  const yMax = step * Math.ceil(max / step);
  const y = (v) => m.t + ph - (v / yMax) * ph;
  const band = pw / rows.length;
  const bw = Math.min(56, band * 0.7);
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'viz-svg', role: 'img', 'aria-label': `${title}. ${subtitle}` });
  for (let v = 0; v <= yMax; v += step) {
    svg.append(
      s('line', { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v), class: v === 0 ? 'viz-axis' : 'viz-grid' }),
      s('text', { x: m.l - 8, y: y(v), class: 'viz-tick', 'text-anchor': 'end', 'dominant-baseline': 'middle' }, String(v)),
    );
  }
  rows.forEach((r, i) => {
    const cx = m.l + band * (i + 0.5);
    svg.append(
      s('text', { x: cx, y: H - 26, class: 'viz-tick', 'text-anchor': 'middle' }, r.label),
      s('text', { x: cx, y: H - 10, class: 'viz-tick', 'text-anchor': 'middle' }, r.accuracy === null ? `n=${r.n}` : `${Math.round(r.accuracy * 100)}% right, n=${r.n}`),
    );
    if (r.n) {
      svg.append(
        s('path', { d: barPath(cx - bw / 2, y(r.n), bw, m.t + ph), class: 'viz-bar', style: 'fill:var(--series-1)', tabindex: '0' },
          s('title', {}, `${r.label}: ${r.n} attempts${r.accuracy === null ? ' (too few to rate)' : `, ${Math.round(r.accuracy * 100)}% correct`}`)),
        s('text', { x: cx, y: y(r.n) - 5, class: 'viz-value', 'text-anchor': 'middle' }, String(r.n)),
      );
    }
  });
  const px = m.l + band * (parAfter + 1);
  svg.append(
    s('line', { x1: px, x2: px, y1: m.t - 6, y2: m.t + ph, class: 'viz-par' }),
    s('text', { x: px + 4, y: m.t + 2, class: 'viz-tick viz-par-label' }, 'par'),
  );
  return el('figure', { class: 'viz' },
    el('figcaption', {}, el('span', { class: 'viz-title', text: title }), el('span', { class: 'viz-sub', text: subtitle })),
    el('div', { class: 'viz-plot' }, svg),
    details(title, ['Time vs par', 'Attempts', 'Accuracy'], rows.map((r) => [r.label, r.n, r.accuracy === null ? `n under 5` : `${Math.round(r.accuracy * 100)}%`])),
  );
}

export function progressBar(progress, label) {
  const v = Math.max(0, Math.min(1, progress ?? 0));
  return el('div', { class: 'ach-progress' },
    el('progress', { max: '100', value: String(Math.round(v * 100)), 'aria-label': `${label}: ${Math.round(v * 100)}%` }),
    el('span', { class: 'ach-pct', text: `${Math.round(v * 100)}%` }));
}
