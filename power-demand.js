(() => {
  const SNAPSHOT_URL = 'data/demand-dashboard.json?v=48h-timestamp';
  const HOUR = 3600e3, DAY = 24 * HOUR, STEP = 15 * 60e3;
  const COLORS = ['#d64027', '#1b69a5', '#6b3fa0', '#0c7d5a', '#a6611a'];
  const NAIVE = 'seasonal_naive_1w';
  const ns = 'http://www.w3.org/2000/svg';

  const panel = document.querySelector('#demand-panel');
  const wrap = panel.querySelector('.chart-wrap');
  const svg = panel.querySelector('#demand-chart');
  const tip = panel.querySelector('.chart-tip');
  const status = panel.querySelector('#chart-status');
  const tabs = [...panel.querySelectorAll('.view-tabs button')];
  const slider = panel.querySelector('#window-slider');
  const windowLabel = panel.querySelector('#window-label');
  const legend = panel.querySelector('#demand-legend');
  const tbody = panel.querySelector('#model-table tbody');
  const statsNote = panel.querySelector('#stats-note');

  let actual;          // { start, values: Float64Array (MW, NaN = missing), end }
  let models = [];     // { key, label, color, dashed, map: Map(time -> MW), first, last, stats }
  let days = 2;
  let lastSize = '';

  const el = (tag, attrs = {}) => {
    const node = document.createElementNS(ns, tag);
    Object.entries(attrs).forEach(([k, v]) => node.setAttribute(k, v));
    return node;
  };
  const gw = (mw) => `${(mw / 1000).toFixed(1)} GW`;
  // Built from parts so every browser gives "19 NOV 11:00" (Safari would insert "at").
  const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const pad2 = (n) => String(n).padStart(2, '0');
  const fmt = (t, withTime = true) => {
    const d = new Date(t);
    const date = `${pad2(d.getUTCDate())} ${MONTHS[d.getUTCMonth()]}`;
    return withTime ? `${date} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}` : date;
  };
  const label = (key) => key.replaceAll('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  const actualAt = (t) => {
    const i = Math.round((t - actual.start) / STEP);
    return i >= 0 && i < actual.values.length ? actual.values[i] : NaN;
  };

  function prepare(data) {
    const values = Float64Array.from(data.actuals.values_mw, (v) => (v == null ? NaN : v));
    const start = Date.parse(data.actuals.start);
    let lastIndex = values.length - 1;
    while (lastIndex > 0 && Number.isNaN(values[lastIndex])) lastIndex -= 1;
    actual = { start, values, end: start + lastIndex * STEP };

    models = Object.entries(data.forecasts || {}).map(([key, points]) => ({
      key, label: label(key), map: new Map(points.map((p) => [Date.parse(p.timestamp), p.load_mw])),
    }));
    // Benchmark: the same quarter-hour one week earlier.
    const firstModelTime = Math.min(...models.flatMap((m) => [...m.map.keys()]), actual.end - 28 * DAY);
    const naive = new Map();
    for (let t = Math.max(firstModelTime, actual.start + 7 * DAY); t <= actual.end + 7 * DAY; t += STEP) {
      const v = actualAt(t - 7 * DAY);
      if (Number.isFinite(v)) naive.set(t, v);
    }
    models.push({ key: NAIVE, label: 'Seasonal Naive (1 Week)', map: naive, dashed: true });

    models.forEach((m, i) => {
      const times = [...m.map.keys()].sort((a, b) => a - b);
      m.color = COLORS[i % COLORS.length];
      m.first = times[0];
      m.last = times.at(-1);
      m.selected = true;
    });
    // Score every forecast on the same intervals (where all of them and the actual exist).
    const common = [...models[0].map.keys()].filter((t) => t <= actual.end && Number.isFinite(actualAt(t))
      && models.every((m) => m.map.has(t)));
    models.forEach((m) => { m.stats = score(common.map((t) => [m.map.get(t), actualAt(t)])); });
    statsNote.textContent = common.length
      ? `ACCURACY OVER ${fmt(common[0], false)} – ${fmt(common.at(-1), false)} · SAME ${common.length.toLocaleString('en-GB')} INTERVALS FOR EVERY FORECAST · LATEST FORECAST ISSUED BEFORE EACH INTERVAL · BENCHMARK = SAME TIME ONE WEEK EARLIER`
      : 'NO OVERLAP OF FORECASTS AND ACTUALS YET';
  }

  function score(pairs) {
    const n = pairs.length;
    if (!n) return null;
    let abs = 0, sq = 0, pct = 0, bias = 0, mean = 0;
    pairs.forEach(([, a]) => { mean += a / n; });
    let tot = 0;
    pairs.forEach(([f, a]) => {
      const e = f - a;
      abs += Math.abs(e); sq += e * e; pct += Math.abs(e) / a; bias += e; tot += (a - mean) ** 2;
    });
    return { n, r2: 1 - sq / tot, mae: abs / n, rmse: Math.sqrt(sq / n), mape: 100 * pct / n, bias: bias / n };
  }

  function buildTable() {
    tbody.replaceChildren();
    models.forEach((m) => {
      const s = m.stats;
      const row = document.createElement('tr');
      const cell = (text) => { const td = document.createElement('td'); td.textContent = text; row.append(td); };
      const name = document.createElement('td');
      name.innerHTML = `<label class="model-choice"><input type="checkbox" ${m.selected ? 'checked' : ''} />`
        + `<span class="legend-line${m.dashed ? ' is-dashed' : ''}" style="--line:${m.color}"></span>${m.label}</label>`;
      name.querySelector('input').addEventListener('change', (e) => { m.selected = e.target.checked; updateSlider(); draw(); });
      row.append(name);
      if (!s) { cell('–'); cell('–'); cell('–'); cell('–'); cell('–'); cell('0'); }
      else {
        cell(s.r2.toFixed(3)); cell(gw(s.mae)); cell(gw(s.rmse)); cell(`${s.mape.toFixed(1)}%`);
        cell(`${s.bias >= 0 ? '+' : '−'}${gw(Math.abs(s.bias))}`); cell(s.n.toLocaleString('en-GB'));
      }
      tbody.append(row);
    });
  }

  // Window: [end - days, end]. By default the last actual sits in the middle; the slider pans
  // in 1-hour steps between the earliest stored forecast and the last forecast.
  const selectedModels = () => models.filter((m) => m.selected);
  const centredEnd = () => actual.end + (days * DAY) / 2;
  const maxEnd = () => Math.max(centredEnd(), ...selectedModels().map((m) => m.last));
  const panStart = () => Math.max(actual.start, Math.min(actual.end - 28 * DAY, ...selectedModels().map((m) => m.first)));
  const minEnd = () => Math.min(panStart() + days * DAY, centredEnd());
  function updateSlider() {
    slider.max = Math.max(0, Math.round((maxEnd() - minEnd()) / HOUR));
    slider.value = Math.round((centredEnd() - minEnd()) / HOUR);
  }
  const windowEnd = () => maxEnd() - (Number(slider.max) - Number(slider.value)) * HOUR;

  function size() {
    return { w: Math.max(1, Math.round(wrap.clientWidth)), h: Math.max(1, Math.round(wrap.clientHeight)) };
  }

  function draw() {
    const { w, h } = size();
    if (w < 80 || h < 80) return;
    lastSize = `${w}x${h}`;
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    svg.replaceChildren();
    tip.hidden = true;

    const t1 = windowEnd(), t0 = t1 - days * DAY;
    windowLabel.textContent = `${fmt(t0)} – ${fmt(t1)}`;
    const shown = selectedModels();
    const pad = { l: 46, r: 12, t: 14, b: 28 };
    const pw = w - pad.l - pad.r, ph = h - pad.t - pad.b;

    const series = [];
    const actualPts = [];
    for (let t = Math.ceil((t0 - actual.start) / STEP) * STEP + actual.start; t <= Math.min(t1, actual.end); t += STEP) {
      actualPts.push([t, actualAt(t)]);
    }
    shown.forEach((m) => {
      const pts = [];
      for (let t = Math.ceil((t0 - actual.start) / STEP) * STEP + actual.start; t <= t1; t += STEP) {
        if (m.map.has(t)) pts.push([t, m.map.get(t)]);
      }
      series.push({ m, pts });
    });
    const vals = [...actualPts, ...series.flatMap((s) => s.pts)].map((p) => p[1]).filter(Number.isFinite);
    if (!vals.length) { status.textContent = 'No data in this window'; status.classList.remove('is-hidden'); return; }
    status.classList.add('is-hidden');
    const lo = Math.min(...vals), hi = Math.max(...vals), span = Math.max(hi - lo, 1000);
    const yMin = Math.floor((lo - span * 0.08) / 5000) * 5000, yMax = Math.ceil((hi + span * 0.08) / 5000) * 5000;
    const x = (t) => pad.l + ((t - t0) / (t1 - t0)) * pw;
    const y = (v) => pad.t + (1 - (v - yMin) / (yMax - yMin)) * ph;

    // Forecast region shading and "now" marker at the last actual.
    if (actual.end < t1) {
      const xs = Math.max(pad.l, x(actual.end));
      svg.append(el('rect', { x: xs, y: pad.t, width: pad.l + pw - xs, height: ph, fill: '#efefeb' }));
    }
    const gridStep = (yMax - yMin) / 5000 > 8 ? 10000 : 5000;
    for (let v = yMin; v <= yMax; v += gridStep) {
      svg.append(el('line', { x1: pad.l, x2: pad.l + pw, y1: y(v), y2: y(v), stroke: '#d2d2ce' }));
      const tx = el('text', { x: pad.l - 7, y: y(v) + 3, class: 'axis-text', 'text-anchor': 'end' });
      tx.textContent = `${v / 1000} GW`;
      svg.append(tx);
    }
    let tick = { 1: 3, 2: 6, 7: 24, 14: 48 }[days] * HOUR;
    while (pw / ((t1 - t0) / tick) < 70) tick *= 2;
    for (let t = Math.ceil(t0 / tick) * tick; t <= t1; t += tick) {
      svg.append(el('line', { x1: x(t), x2: x(t), y1: pad.t, y2: pad.t + ph, stroke: '#e3e3df' }));
      const tx = el('text', { x: x(t), y: h - 9, class: 'axis-text', 'text-anchor': 'middle' });
      tx.textContent = tick < DAY ? fmt(t).slice(-5) === '00:00' ? fmt(t, false) : fmt(t).slice(-5) : fmt(t, false);
      svg.append(tx);
    }
    if (actual.end >= t0 && actual.end <= t1) {
      svg.append(el('line', { x1: x(actual.end), x2: x(actual.end), y1: pad.t, y2: pad.t + ph, stroke: '#171717', 'stroke-dasharray': '2 3' }));
      const tx = el('text', { x: x(actual.end) + 5, y: pad.t + 10, class: 'axis-text' });
      tx.textContent = 'LAST ACTUAL';
      svg.append(tx);
    }

    const path = (pts) => {
      let d = '', prev = null;
      pts.forEach(([t, v]) => {
        if (!Number.isFinite(v)) { prev = null; return; }
        d += `${prev === null || t - prev > STEP ? 'M' : 'L'}${x(t).toFixed(1)},${y(v).toFixed(1)}`;
        prev = t;
      });
      return d;
    };
    series.forEach(({ m, pts }) => svg.append(el('path', {
      d: path(pts), fill: 'none', stroke: m.color, 'stroke-width': 1.6, 'stroke-dasharray': m.dashed ? '5 4' : 'none',
    })));
    svg.append(el('path', { d: path(actualPts), fill: 'none', stroke: '#111', 'stroke-width': 1.6 }));
    svg.append(el('rect', { x: pad.l, y: pad.t, width: pw, height: ph, fill: 'none', stroke: '#b8b8b4' }));

    // Hover read-out.
    const cross = el('line', { y1: pad.t, y2: pad.t + ph, stroke: '#171717', opacity: 0 });
    const hit = el('rect', { x: pad.l, y: pad.t, width: pw, height: ph, fill: 'transparent' });
    svg.append(cross, hit);
    hit.addEventListener('pointermove', (event) => {
      const box = svg.getBoundingClientRect();
      const px = (event.clientX - box.left) * (w / box.width);
      const t = Math.round((t0 + ((px - pad.l) / pw) * (t1 - t0) - actual.start) / STEP) * STEP + actual.start;
      cross.setAttribute('x1', x(t)); cross.setAttribute('x2', x(t)); cross.setAttribute('opacity', 0.5);
      const a = t <= actual.end ? actualAt(t) : NaN;
      const rows = [`<div class="tip-row"><span class="swatch" style="background:#111"></span>Actual<b>${Number.isFinite(a) ? gw(a) : '–'}</b></div>`]
        .concat(shown.map((m) => {
          const v = m.map.get(t);
          const err = v != null && Number.isFinite(a) ? ` <i>${v >= a ? '+' : '−'}${(Math.abs(v - a) / 1000).toFixed(1)}</i>` : '';
          return `<div class="tip-row"><span class="swatch" style="background:${m.color}"></span>${m.label}<b>${v == null ? '–' : gw(v)}${err}</b></div>`;
        }));
      tip.innerHTML = `<div class="tip-head">${fmt(t)} UTC${t > actual.end ? ' · FORECAST' : ''}</div>${rows.join('')}`;
      tip.hidden = false;
      const left = (x(t) / w) * box.width;
      tip.style.left = `${left > box.width / 2 ? left - tip.offsetWidth - 12 : left + 12}px`;
      tip.style.top = '8px';
    });
    hit.addEventListener('pointerleave', () => { cross.setAttribute('opacity', 0); tip.hidden = true; });

    legend.innerHTML = '<span class="legend-item"><span class="legend-line" style="--line:#111"></span>Actual demand</span>'
      + shown.map((m) => `<span class="legend-item"><span class="legend-line${m.dashed ? ' is-dashed' : ''}" style="--line:${m.color}"></span>${m.label}</span>`).join('')
      + '<span class="legend-item"><span class="legend-shade"></span>Forecast period</span>';
  }

  tabs.forEach((tab) => tab.addEventListener('click', () => {
    days = Number(tab.dataset.days);
    tabs.forEach((t) => t.setAttribute('aria-pressed', String(t === tab)));
    updateSlider();
    draw();
  }));
  slider.addEventListener('input', draw);
  new ResizeObserver(() => { const { w, h } = size(); if (`${w}x${h}` !== lastSize) draw(); }).observe(wrap);

  fetch(SNAPSHOT_URL, { cache: 'no-cache' })
    .then((r) => { if (!r.ok) throw new Error(`Could not load data (${r.status})`); return r.json(); })
    .then((data) => {
      if (!data.actuals?.values_mw?.length) throw new Error('The snapshot contains no demand data.');
      prepare(data);
      buildTable();
      updateSlider();
      draw();
      document.querySelector('#updated-on').textContent = `LAST UPDATED: ${fmt(Date.parse(data.generated_at), false)} ${new Date(data.generated_at).getUTCFullYear()}`;
    })
    .catch((error) => { status.textContent = `Data unavailable — ${error.message}`; console.error(error); });
})();
