// Small dependency-free chart primitives. SVG for the ring/donut (crisp at
// any pixel density, easy to theme with CSS), Canvas for time-series
// (line/bar), plain CSS grid for the consistency heatmap. All read colors
// from CSS custom properties so they follow the light/dark theme.

function cssVar(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
function svgEl(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

export function renderCalorieRing(container, { consumed, goal, size = 176 }) {
  container.innerHTML = '';
  const stroke = size * 0.1;
  const r = (size - stroke) / 2;
  const c = size / 2;
  const circumference = 2 * Math.PI * r;
  const pct = goal > 0 ? Math.min(consumed / goal, 1) : 0;
  const over = goal > 0 && consumed > goal;

  const svg = svgEl('svg', { width: size, height: size, viewBox: `0 0 ${size} ${size}`, class: 'ring-svg' });
  const track = svgEl('circle', {
    cx: c, cy: c, r, fill: 'none',
    stroke: cssVar('--ring-track', '#e5e7eb'), 'stroke-width': stroke,
  });
  const progress = svgEl('circle', {
    cx: c, cy: c, r, fill: 'none',
    stroke: over ? cssVar('--danger', '#ef4444') : cssVar('--accent', '#16a34a'),
    'stroke-width': stroke,
    'stroke-linecap': 'round',
    'stroke-dasharray': `${circumference}`,
    'stroke-dashoffset': `${circumference * (1 - pct)}`,
    transform: `rotate(-90 ${c} ${c})`,
    class: 'ring-progress',
  });
  svg.appendChild(track);
  svg.appendChild(progress);

  const label = document.createElement('div');
  label.className = 'ring-label';
  const remaining = Math.round(goal - consumed);
  label.innerHTML = `
    <span class="ring-value">${Math.round(consumed)}</span>
    <span class="ring-unit">kcal</span>
    <span class="ring-sub">${over ? `+${Math.abs(remaining)} au-dessus` : `${remaining} restantes`}</span>
  `;

  const wrap = document.createElement('div');
  wrap.className = 'ring-wrap';
  wrap.style.width = size + 'px';
  wrap.style.height = size + 'px';
  wrap.appendChild(svg);
  wrap.appendChild(label);
  container.appendChild(wrap);
}

export function renderMacroBars(container, macros) {
  // macros: [{label, value, goal, color}]
  container.innerHTML = '';
  for (const m of macros) {
    const pct = m.goal > 0 ? Math.min((m.value / m.goal) * 100, 100) : 0;
    const row = document.createElement('div');
    row.className = 'macro-row';
    row.innerHTML = `
      <div class="macro-row-top">
        <span class="macro-name">${m.label}</span>
        <span class="macro-val">${Math.round(m.value)} / ${Math.round(m.goal)} g</span>
      </div>
      <div class="macro-track"><div class="macro-fill" style="width:${pct}%;background:${m.color}"></div></div>
    `;
    container.appendChild(row);
  }
}

export function renderDonut(container, slices, { size = 160 } = {}) {
  container.innerHTML = '';
  const total = slices.reduce((s, x) => s + x.value, 0);
  const r = size / 2 - 4;
  const c = size / 2;
  const svg = svgEl('svg', { width: size, height: size, viewBox: `0 0 ${size} ${size}` });
  if (total <= 0) {
    svg.appendChild(svgEl('circle', { cx: c, cy: c, r, fill: 'none', stroke: cssVar('--ring-track', '#e5e7eb'), 'stroke-width': 20 }));
    container.appendChild(svg);
    return;
  }
  let angle = -90;
  const circumference = 2 * Math.PI * r;
  for (const s of slices) {
    if (s.value <= 0) continue;
    const frac = s.value / total;
    const dash = circumference * frac;
    const circle = svgEl('circle', {
      cx: c, cy: c, r, fill: 'none', stroke: s.color, 'stroke-width': 20,
      'stroke-dasharray': `${dash} ${circumference - dash}`,
      'stroke-dashoffset': `${-((angle + 90) / 360) * circumference}`,
      transform: `rotate(-90 ${c} ${c})`,
    });
    svg.appendChild(circle);
    angle += frac * 360;
  }
  container.appendChild(svg);
}

function setupCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(rect.width, 240);
  const h = Math.max(rect.height, 140);
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  return { ctx, w, h };
}

export function renderLineChart(canvas, points, { unit = '' } = {}) {
  const { ctx, w, h } = setupCanvas(canvas);
  ctx.clearRect(0, 0, w, h);
  if (!points.length) return;
  const pad = { top: 16, right: 12, bottom: 24, left: 40 };
  const values = points.map(p => p.y);
  const min = Math.min(...values), max = Math.max(...values);
  const span = max - min || 1;
  const plotW = w - pad.left - pad.right;
  const plotH = h - pad.top - pad.bottom;

  ctx.strokeStyle = cssVar('--border', '#e5e7eb');
  ctx.fillStyle = cssVar('--text-dim', '#6b7280');
  ctx.font = '11px system-ui, sans-serif';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 3; i++) {
    const y = pad.top + (plotH * i) / 3;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(w - pad.right, y);
    ctx.stroke();
    const val = max - (span * i) / 3;
    ctx.fillText(val.toFixed(1) + unit, 2, y + 4);
  }

  ctx.beginPath();
  ctx.strokeStyle = cssVar('--accent', '#16a34a');
  ctx.lineWidth = 2.5;
  points.forEach((p, i) => {
    const x = pad.left + (plotW * i) / Math.max(points.length - 1, 1);
    const y = pad.top + plotH * (1 - (p.y - min) / span);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.stroke();

  ctx.fillStyle = cssVar('--accent', '#16a34a');
  points.forEach((p, i) => {
    const x = pad.left + (plotW * i) / Math.max(points.length - 1, 1);
    const y = pad.top + plotH * (1 - (p.y - min) / span);
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fill();
  });

  ctx.fillStyle = cssVar('--text-dim', '#6b7280');
  const step = Math.ceil(points.length / 6) || 1;
  points.forEach((p, i) => {
    if (i % step !== 0 && i !== points.length - 1) return;
    const x = pad.left + (plotW * i) / Math.max(points.length - 1, 1);
    ctx.fillText(p.x, x - 10, h - 6);
  });
}

export function renderBarChart(canvas, points, { goal = null } = {}) {
  const { ctx, w, h } = setupCanvas(canvas);
  ctx.clearRect(0, 0, w, h);
  if (!points.length) return;
  const pad = { top: 16, right: 12, bottom: 24, left: 40 };
  const plotW = w - pad.left - pad.right;
  const plotH = h - pad.top - pad.bottom;
  const max = Math.max(...points.map(p => p.y), goal || 0) * 1.1 || 1;

  ctx.strokeStyle = cssVar('--border', '#e5e7eb');
  ctx.fillStyle = cssVar('--text-dim', '#6b7280');
  ctx.font = '11px system-ui, sans-serif';
  for (let i = 0; i <= 3; i++) {
    const y = pad.top + (plotH * i) / 3;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(w - pad.right, y);
    ctx.stroke();
    ctx.fillText(Math.round(max - (max * i) / 3), 2, y + 4);
  }

  const barW = (plotW / points.length) * 0.6;
  const gap = (plotW / points.length) * 0.4;
  points.forEach((p, i) => {
    const x = pad.left + i * (barW + gap) + gap / 2;
    const barH = plotH * (p.y / max);
    const y = pad.top + plotH - barH;
    ctx.fillStyle = goal && p.y > goal ? cssVar('--danger', '#ef4444') : cssVar('--accent', '#16a34a');
    ctx.fillRect(x, y, barW, barH);
  });

  if (goal) {
    const y = pad.top + plotH * (1 - goal / max);
    ctx.strokeStyle = cssVar('--warning', '#f59e0b');
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(w - pad.right, y);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  ctx.fillStyle = cssVar('--text-dim', '#6b7280');
  const step = Math.ceil(points.length / 7) || 1;
  points.forEach((p, i) => {
    if (i % step !== 0 && i !== points.length - 1) return;
    const x = pad.left + i * (barW + gap) + gap / 2;
    ctx.fillText(p.x, x, h - 6);
  });
}

export function renderHeatmap(container, days) {
  // days: [{date, value, goal}] oldest -> newest, expected ~last 12 weeks
  container.innerHTML = '';
  const grid = document.createElement('div');
  grid.className = 'heatmap-grid';
  for (const d of days) {
    const cell = document.createElement('div');
    cell.className = 'heatmap-cell';
    let level = 0;
    if (d.value > 0 && d.goal > 0) {
      const ratio = d.value / d.goal;
      if (ratio > 1.15) level = 5;
      else if (ratio > 0.9) level = 4;
      else if (ratio > 0.6) level = 3;
      else if (ratio > 0.3) level = 2;
      else level = 1;
    }
    cell.dataset.level = level;
    cell.title = `${d.date}: ${Math.round(d.value)} kcal`;
    grid.appendChild(cell);
  }
  container.appendChild(grid);
}
