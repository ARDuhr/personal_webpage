// Power supply panel: generation mix over time + merit order at a selected moment.
// Generation and day-ahead forecasts: SMARD (DE-LU). Merit-order capacities and
// costs of dispatchable plants are illustrative assumptions.
(() => {
  const ns = 'http://www.w3.org/2000/svg';
  const CATS = [ // stack order = rough merit order, bottom to top
    { key: 'solar', label: 'Solar', color: '#eda100' },
    { key: 'wind', label: 'Wind', color: '#2a78d6' },
    { key: 'bio_hydro', label: 'Biomass & hydro', color: '#1baf7a' },
    { key: 'lignite', label: 'Lignite', color: '#a0612a' },
    { key: 'hard_coal', label: 'Hard coal', color: '#6250d6' },
    { key: 'gas', label: 'Gas', color: '#d95926' },
    { key: 'other', label: 'Other & storage', color: '#e87ba4' },
    { key: 'net_imports', label: 'Net imports', color: '#008300' },
  ];
  const COLOR = Object.fromEntries(CATS.map((c) => [c.key, c.color]));
  const LABEL = Object.fromEntries(CATS.map((c) => [c.key, c.label]));
  COLOR.other_all = '#c9c9c4'; LABEL.other_all = 'All other';
  const THERMAL = [ // illustrative available capacity (GW) and short-run cost (EUR/MWh)
    { key: 'lignite', gw: 8, cost: 78 }, { key: 'lignite', gw: 6, cost: 92 },
    { key: 'gas', gw: 10, cost: 88 }, { key: 'gas', gw: 8, cost: 102 }, { key: 'gas', gw: 7, cost: 140 },
    { key: 'hard_coal', gw: 5, cost: 96 }, { key: 'hard_coal', gw: 5, cost: 112 },
    { key: 'net_imports', gw: 12, cost: 108 },
    { key: 'other', gw: 5, cost: 130 }, { key: 'other', gw: 3, cost: 185 },
  ];
  const STEP = 15 * 60 * 1000;

  const panel = document.querySelector('#supply-panel');
  if (!panel) return;
  const svg = panel.querySelector('svg');
  const wrap = panel.querySelector('.chart-wrap');
  const tip = panel.querySelector('.chart-tip');
  const status = panel.querySelector('.chart-loading');
  const legend = panel.querySelector('.legend');
  const slider = panel.querySelector('input[type=range]');
  const momentLabel = panel.querySelector('.moment-label');
  const note = panel.querySelector('.supply-note');
  const tabs = [...panel.querySelectorAll('[data-view]')];
  let s, view = 'mix', selected = 0;

  const el = (tag, attrs = {}) => {
    const node = document.createElementNS(ns, tag);
    Object.entries(attrs).forEach(([k, v]) => node.setAttribute(k, v));
    svg.append(node); return node;
  };
  const text = (x, y, str, attrs = {}) => {
    const t = el('text', { x, y, fill: '#6b6b68', 'font-size': 10, 'font-family': 'DM Mono, monospace', ...attrs });
    t.textContent = str; return t;
  };
  const fmt = (d) => new Intl.DateTimeFormat('en-GB', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC',
  }).format(d).replace(',', ' ·');
  const gw = (mw) => (mw / 1000).toFixed(1);

  // Build the view model: same 48 h window as the demand chart (last actual demand +/- 24 h).
  function prepare(dashboard) {
    const sup = dashboard.supply;
    const supStart = new Date(sup.start).getTime();
    const d = dashboard.actuals;
    const dStart = new Date(d.start).getTime();
    let lastDemand = d.values_mw.length - 1;
    while (lastDemand > 0 && d.values_mw[lastDemand] == null) lastDemand -= 1;
    const demandNow = dStart + lastDemand * STEP;
    const t0 = demandNow - 24 * 3600 * 1000, t1 = demandNow + 24 * 3600 * 1000;
    const demandForecast = new Map();
    const firstModel = Object.values(dashboard.forecasts || {})[0] || [];
    firstModel.forEach((p) => demandForecast.set(new Date(p.timestamp).getTime(), p.load_mw));
    const actualEnd = new Date(sup.actual_end).getTime();

    const times = [];
    for (let t = t0; t <= t1; t += STEP) times.push(t);
    const at = (arr, t) => { const i = Math.round((t - supStart) / STEP); return i >= 0 && i < arr.length ? arr[i] : null; };
    const points = times.map((t) => {
      const actual = t <= actualEnd;
      const dIdx = Math.round((t - dStart) / STEP);
      const demand = t <= demandNow ? d.values_mw[dIdx] ?? null : demandForecast.get(t) ?? null;
      const stack = actual
        ? CATS.map((c) => ({ key: c.key, value: at(sup.actual_mw[c.key], t) }))
        : ['solar', 'wind', 'other_all'].map((k) => ({ key: k, value: at(sup.forecast_mw[k], t) }));
      const known = stack.every((p) => p.value != null) || (actual && stack.filter((p) => p.key !== 'net_imports').every((p) => p.value != null));
      return { t, actual, demand, demandForecast: t > demandNow, stack: known ? stack.map((p) => ({ ...p, value: p.value ?? 0 })) : null };
    });
    const lastBio = (() => { for (let t = actualEnd; t >= supStart; t -= STEP) { const v = at(sup.actual_mw.bio_hydro, t); if (v != null) return v; } return 0; })();
    const nowIndex = points.reduce((last, p, i) => (p.actual && p.stack ? i : last), 0);
    return { points, nowIndex, lastBio };
  }

  function size() {
    const { width, height } = wrap.getBoundingClientRect();
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    return { width, height };
  }

  function placeTip(ev) {
    const r = wrap.getBoundingClientRect(); const left = ev.clientX - r.left;
    tip.hidden = false;
    tip.style.left = `${left > r.width / 2 ? left - tip.offsetWidth - 12 : left + 12}px`;
    tip.style.top = '8px';
  }

  function drawMix() {
    const { width, height } = size();
    const L = 34, R = 8, T = 20, B = 24, P = s.points, n = P.length;
    const x = (i) => L + (i / (n - 1)) * (width - L - R);
    let max = 0, min = 0;
    P.forEach((p) => {
      if (p.stack) { max = Math.max(max, p.stack.filter((q) => q.value > 0).reduce((a, q) => a + q.value, 0)); min = Math.min(min, ...p.stack.map((q) => q.value)); }
      if (p.demand != null) max = Math.max(max, p.demand);
    });
    const top = Math.ceil(max / 10000) * 10000, bottom = Math.floor(min / 10000) * 10000;
    const y = (v) => T + (1 - (v - bottom) / Math.max(top - bottom, 1)) * (height - T - B);
    svg.replaceChildren();
    for (let v = bottom; v <= top; v += 10000) {
      el('line', { x1: L, x2: width - R, y1: y(v), y2: y(v), stroke: v === 0 ? '#9a9a96' : '#e3e3df', 'stroke-width': 1 });
      text(L - 6, y(v) + 3, `${v / 1000}`, { 'text-anchor': 'end' });
    }
    text(4, 10, 'GW', { 'font-size': 9 });
    // Three time labels need roughly 120px each; drop the middle one in narrow panels.
    const ticks = width - L - R >= 380 ? [[0, 'start'], [0.5, 'middle'], [1, 'end']] : [[0, 'start'], [1, 'end']];
    ticks.forEach(([f, anchor]) => {
      const i = Math.round(f * (n - 1)); text(x(i), height - 7, fmt(new Date(P[i].t)), { 'text-anchor': anchor });
    });

    // Stacked areas (positives up from zero, negatives down); one polygon per contiguous run.
    const runs = [];
    let current = null;
    const posBase = new Array(n).fill(0), negBase = new Array(n).fill(0);
    P.forEach((p, i) => {
      if (!p.stack) { current = null; return; }
      const signature = `${p.actual}`;
      if (!current || current.signature !== signature) { current = { signature, actual: p.actual, layers: {} }; runs.push(current); }
      p.stack.forEach((q) => {
        const base = q.value >= 0 ? posBase : negBase;
        const y0 = base[i], y1 = base[i] + q.value; base[i] = y1;
        (current.layers[q.key] ||= []).push([i, y0, y1]);
      });
    });
    runs.forEach((run) => Object.entries(run.layers).forEach(([key, pts]) => {
      const upper = pts.map(([i, , y1]) => `${x(i).toFixed(1)},${y(y1).toFixed(1)}`);
      const lower = pts.slice().reverse().map(([i, y0]) => `${x(i).toFixed(1)},${y(y0).toFixed(1)}`);
      el('polygon', { points: [...upper, ...lower].join(' '), fill: COLOR[key], 'fill-opacity': run.actual ? 0.92 : 0.45, stroke: '#fafaf8', 'stroke-width': 1, 'stroke-linejoin': 'round' });
    }));

    // Demand: solid actual, dashed forecast.
    [false, true].forEach((isForecast) => {
      const d = [];
      P.forEach((p, i) => { if (p.demand != null && p.demandForecast === isForecast) d.push(`${d.length ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.demand).toFixed(1)}`); });
      el('path', { d: d.join(' '), fill: 'none', stroke: '#111', 'stroke-width': 2, 'stroke-dasharray': isForecast ? '5 4' : 'none' });
    });
    el('line', { x1: x(s.nowIndex), x2: x(s.nowIndex), y1: T, y2: height - B, stroke: '#111', 'stroke-width': 1, 'stroke-dasharray': '2 3' });
    text(x(s.nowIndex) + 4, T + 9, 'NOW', { fill: '#111', 'font-size': 9 });
    el('line', { x1: x(selected), x2: x(selected), y1: T, y2: height - B, stroke: '#111', 'stroke-width': 1.5 });

    const hit = el('rect', { x: L, y: T, width: width - L - R, height: height - T - B, fill: 'transparent' });
    const cross = el('line', { y1: T, y2: height - B, stroke: '#111', 'stroke-width': 1, opacity: 0 });
    const indexFrom = (ev) => { const r = svg.getBoundingClientRect(); return Math.max(0, Math.min(n - 1, Math.round(((ev.clientX - r.left) - L) / (width - L - R) * (n - 1)))); };
    hit.addEventListener('pointermove', (ev) => {
      const i = indexFrom(ev); cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i)); cross.setAttribute('opacity', 0.5);
      const p = P[i];
      const rows = (p.stack || []).filter((q) => Math.abs(q.value) > 1).reverse()
        .map((q) => `<div class="tip-row"><span class="swatch" style="background:${COLOR[q.key]}"></span>${LABEL[q.key]}<b>${gw(q.value)}</b></div>`).join('');
      tip.innerHTML = `<div class="tip-head">${fmt(new Date(p.t))}${p.actual ? '' : ' · FORECAST'}</div>${rows || '<div class="tip-row">No data</div>'}<div class="tip-row tip-total">Demand<b>${p.demand == null ? '–' : gw(p.demand)}</b></div><div class="tip-foot">GW · click for merit order</div>`;
      placeTip(ev);
    });
    hit.addEventListener('pointerleave', () => { cross.setAttribute('opacity', 0); tip.hidden = true; });
    hit.addEventListener('click', (ev) => { select(indexFrom(ev)); view = 'merit'; render(); });
  }

  function meritBlocks(p) {
    const value = (k) => (p.stack?.find((q) => q.key === k)?.value ?? 0) / 1000;
    const renewables = [
      { key: 'solar', gw: value('solar'), cost: 0 },
      { key: 'wind', gw: value('wind'), cost: 0 },
      { key: 'bio_hydro', gw: (p.actual ? value('bio_hydro') * 1000 : s.lastBio) / 1000, cost: 12 },
    ];
    return [...renewables, ...THERMAL].filter((b) => b.gw > 0.05).sort((a, b) => a.cost - b.cost);
  }

  function drawMerit() {
    const { width, height } = size();
    const L = 34, R = 8, T = 20, B = 24;
    const p = s.points[selected];
    const blocks = meritBlocks(p);
    const total = blocks.reduce((a, b) => a + b.gw, 0);
    const maxX = Math.ceil(total / 10) * 10, maxY = 200;
    const x = (v) => L + (v / maxX) * (width - L - R);
    const y = (v) => T + (1 - v / maxY) * (height - T - B);
    svg.replaceChildren();
    for (let v = 0; v <= maxY; v += 50) { el('line', { x1: L, x2: width - R, y1: y(v), y2: y(v), stroke: v ? '#e3e3df' : '#9a9a96' }); text(L - 6, y(v) + 3, v, { 'text-anchor': 'end' }); }
    text(4, 10, '€/MWh', { 'font-size': 9 });
    for (let v = 0; v <= maxX; v += 20) text(x(v), height - 7, `${v}${v === maxX ? ' GW' : ''}`, { 'text-anchor': v === 0 ? 'start' : v === maxX ? 'end' : 'middle' });
    if (!p.stack) { text(width / 2, height / 2, 'No supply data for this moment', { 'text-anchor': 'middle' }); return; }

    const demand = (p.demand ?? 0) / 1000;
    let cum = 0, price = null;
    blocks.forEach((b) => {
      const x0 = x(cum), x1 = x(cum + b.gw), h = Math.max(y(0) - y(b.cost), 3);
      const r = el('rect', { x: x0, y: y(0) - h, width: Math.max(x1 - x0 - 1.5, 1), height: h, fill: COLOR[b.key], rx: 1.5 });
      r.addEventListener('pointermove', (ev) => {
        tip.innerHTML = `<div class="tip-head">${LABEL[b.key]}</div><div class="tip-row">Capacity<b>${b.gw.toFixed(1)} GW</b></div><div class="tip-row">Cost<b>${b.cost} €/MWh</b></div>`;
        placeTip(ev);
      });
      r.addEventListener('pointerleave', () => { tip.hidden = true; });
      if (price == null && cum + b.gw >= demand) price = b.cost;
      cum += b.gw;
    });
    if (p.demand == null) return;
    el('line', { x1: x(demand), x2: x(demand), y1: T, y2: y(0), stroke: '#111', 'stroke-width': 2, 'stroke-dasharray': p.demandForecast ? '5 4' : 'none' });
    text(x(demand) - 4, T + 10, `DEMAND ${demand.toFixed(1)} GW`, { fill: '#111', 'text-anchor': 'end' });
    if (price != null) {
      el('line', { x1: L, x2: x(demand), y1: y(price), y2: y(price), stroke: '#111', 'stroke-width': 1, 'stroke-dasharray': '2 3' });
      el('circle', { cx: x(demand), cy: y(price), r: 4.5, fill: '#111', stroke: '#fafaf8', 'stroke-width': 2 });
      text(L + 4, y(price) - 5, `≈ ${price} €/MWh`, { fill: '#111' });
    }
  }

  function drawLegend() {
    legend.replaceChildren();
    const items = CATS.map((c) => [c.label, c.color]);
    if (view === 'mix') items.push(['Forecast: all other', COLOR.other_all]);
    items.forEach(([label, color]) => {
      const item = document.createElement('span'); item.className = 'legend-item';
      item.innerHTML = `<span class="swatch" style="background:${color}"></span>${label}`; legend.append(item);
    });
    const d = document.createElement('span'); d.className = 'legend-item';
    d.innerHTML = '<span class="legend-line" style="background:#111"></span>Demand (dashed = forecast)';
    legend.append(d);
    note.textContent = view === 'mix'
      ? 'Faded = SMARD day-ahead forecast'
      : 'Illustrative capacities & costs for coal, gas, imports & other';
  }

  function select(i) {
    selected = i; slider.value = i;
    momentLabel.textContent = `${fmt(new Date(s.points[i].t))} UTC${s.points[i].actual ? '' : ' · FORECAST'}`;
  }
  function render() {
    tabs.forEach((t) => t.setAttribute('aria-pressed', String(t.dataset.view === view)));
    panel.classList.toggle('is-merit', view === 'merit');
    (view === 'mix' ? drawMix : drawMerit)();
    drawLegend();
  }

  tabs.forEach((t) => t.addEventListener('click', () => { view = t.dataset.view; tip.hidden = true; render(); }));
  slider.addEventListener('input', () => { select(Number(slider.value)); render(); });
  new ResizeObserver(() => s && render()).observe(wrap);

  fetch('data/demand-dashboard.json?v=48h-timestamp', { cache: 'no-cache' })
    .then((response) => { if (!response.ok) throw new Error(`Could not load data (${response.status})`); return response.json(); })
    .then((dashboard) => {
      if (!dashboard.supply) throw new Error('No supply data yet');
      s = prepare(dashboard);
      slider.max = s.points.length - 1;
      select(s.nowIndex);
      status.classList.add('is-hidden');
      render();
    })
    .catch((error) => { status.textContent = `Data unavailable — ${error.message}`; console.error(error); });
})();
