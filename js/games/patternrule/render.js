// SVG drawing of Pattern Rule panels (DOM only, no game logic).
// Shapes are drawn in one ink colour (the page text colour), so colour never carries meaning:
// type is the outline, fill is solid / outlined / striped, size and direction are geometry.
// Every panel also has a text description for screen readers and the "describe in words" view.

import { describePanel } from './rules.js';

const NS = 'http://www.w3.org/2000/svg';

// Paths point up, centred on (0, 0), about 40 units from the centre to the tip.
export const SHAPE_PATHS = {
  tri: 'M0,-40 L36,30 L-36,30 Z',
  dome: 'M-38,19 A38,38 0 0 1 38,19 Z',
  arrow: 'M0,-40 L31,-5 L12,-5 L12,38 L-12,38 L-12,-5 L-31,-5 Z',
  drop: 'M0,-42 C12,-26 28,-10 28,10 A28,28 0 0 1 -28,10 C-28,-10 -12,-26 0,-42 Z',
};

let seq = 0;

function svg(tag, attrs = {}, ...children) {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined) node.setAttribute(k, String(v));
  for (const c of children) if (c) node.append(c);
  return node;
}

// One shape on its own, for the shape key. Decorative: the caption next to it names it.
export function shapeIcon({ t = 'tri', f = 'outline', d = 'U', k = 1 } = {}) {
  const id = `pr-st-${++seq}`;
  const rot = { U: 0, R: 90, D: 180, L: 270 }[d];
  const attrs = { class: `pr-shape f-${f}`, d: SHAPE_PATHS[t], transform: `rotate(${rot}) scale(${k})`, 'vector-effect': 'non-scaling-stroke' };
  if (f === 'striped') attrs.fill = `url(#${id})`;
  return svg('svg', { class: 'pr-icon', viewBox: '-50 -50 100 100', 'aria-hidden': 'true', focusable: 'false' },
    svg('defs', {}, svg('pattern', { id, patternUnits: 'userSpaceOnUse', width: 12, height: 12 }, svg('rect', { x: 0, y: 0, width: 12, height: 5, fill: 'currentColor' }))),
    svg('path', attrs));
}

export function panelSvg(panel, { label = null } = {}) {
  const id = `pr-st-${++seq}`;
  const root = svg('svg', {
    class: 'pr-svg',
    viewBox: '0 0 300 300',
    role: 'img',
    'aria-label': label ? `${label}. ${describePanel(panel)}` : describePanel(panel),
    focusable: 'false',
  });
  root.append(
    svg('defs', {},
      svg('pattern', { id, patternUnits: 'userSpaceOnUse', width: 12, height: 12 },
        svg('rect', { x: 0, y: 0, width: 12, height: 5, fill: 'currentColor' }))),
    svg('rect', { class: 'pr-bg', x: 1, y: 1, width: 298, height: 298, rx: 14 }),
  );
  const grid = svg('g', { class: 'pr-gridlines', 'aria-hidden': 'true' });
  for (const k of [100, 200]) {
    grid.append(svg('line', { x1: k, y1: 8, x2: k, y2: 292 }), svg('line', { x1: 8, y1: k, x2: 292, y2: k }));
  }
  root.append(grid);
  for (const s of panel.shapes) {
    const attrs = {
      class: `pr-shape f-${s.f}`,
      d: SHAPE_PATHS[s.t],
      transform: `translate(${s.x} ${s.y}) rotate(${s.rot}) scale(${s.k})`,
      'vector-effect': 'non-scaling-stroke',
    };
    if (s.f === 'striped') attrs.fill = `url(#${id})`;
    root.append(svg('path', attrs));
  }
  return root;
}
