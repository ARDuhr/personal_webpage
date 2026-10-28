const snapshotUrl = 'data/demand-dashboard.json';
const chart = document.querySelector('#demand-chart');
const statusText = document.querySelector('#chart-status');
const modelChoices = document.querySelector('#demand-model-choices');
const legend = document.querySelector('#demand-legend');
const updatedText = document.querySelector('#snapshot-updated');
const dataWindow = document.querySelector('#data-window');
const cursor = document.querySelector('.custom-cursor');
const ns = 'http://www.w3.org/2000/svg';
const palette = ['#d64027', '#1b69a5', '#6b3fa0', '#0c7d5a', '#a6611a'];
let dashboard;

function makeSvg(tag, attributes = {}) {
  const node = document.createElementNS(ns, tag);
  Object.entries(attributes).forEach(([key, value]) => node.setAttribute(key, value));
  return node;
}

function formatDate(value) {
  return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).format(value);
}

function formatModelName(name) {
  return name.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function buildActuals(actuals) {
  const start = new Date(actuals.start);
  const step = actuals.interval_minutes * 60 * 1000;
  return actuals.values_mw.map((value, index) => ({ timestamp: new Date(start.getTime() + index * step), value }));
}

function drawChart() {
  const allActuals = buildActuals(dashboard.actuals);
  const availableForecasts = Object.values(dashboard.forecasts).flat().map((point) => ({ timestamp: new Date(point.timestamp), value: point.load_mw }));
  const forecastEnd = Math.max(...availableForecasts.map((point) => point.timestamp.getTime()));
  const viewWindow = 24 * 60 * 60 * 1000;
  const viewStart = forecastEnd - viewWindow;
  const actuals = Number.isFinite(forecastEnd)
    ? allActuals.filter((point) => point.timestamp.getTime() >= viewStart && point.timestamp.getTime() <= forecastEnd)
    : allActuals;
  const actualSampleEvery = Math.max(1, Math.ceil(actuals.length / 1200));
  const visibleActuals = actuals.filter((_, index) => index % actualSampleEvery === 0 || index === actuals.length - 1);
  const selected = [...modelChoices.querySelectorAll('input:checked')].map((input) => input.value);
  const series = selected.map((name) => ({ name, points: dashboard.forecasts[name]
    .map((point) => ({ timestamp: new Date(point.timestamp), value: point.load_mw }))
    .filter((point) => point.timestamp.getTime() >= viewStart && point.timestamp.getTime() <= forecastEnd) }));
  const allPoints = [...visibleActuals, ...series.flatMap((item) => item.points)];
  const values = allPoints.map((point) => point.value).filter(Number.isFinite);
  const minTime = Math.min(...allPoints.map((point) => point.timestamp.getTime()));
  const maxTime = Math.max(...allPoints.map((point) => point.timestamp.getTime()));
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const range = Math.max(rawMax - rawMin, 1);
  const minValue = Math.floor((rawMin - range * .08) / 1000) * 1000;
  const maxValue = Math.ceil((rawMax + range * .08) / 1000) * 1000;
  const width = 640, height = 320, left = 57, right = 13, top = 16, bottom = 36;
  const plotWidth = width - left - right, plotHeight = height - top - bottom;
  const x = (time) => left + ((time - minTime) / Math.max(maxTime - minTime, 1)) * plotWidth;
  const y = (value) => top + (1 - (value - minValue) / Math.max(maxValue - minValue, 1)) * plotHeight;
  chart.replaceChildren();

  for (let i = 0; i <= 4; i += 1) {
    const value = minValue + (maxValue - minValue) * i / 4;
    const yPos = y(value);
    chart.append(makeSvg('line', { x1: left, x2: width - right, y1: yPos, y2: yPos, stroke: '#d2d2ce', 'stroke-width': '1' }));
    const label = makeSvg('text', { x: left - 8, y: yPos + 3, fill: '#777', 'font-size': '9', 'font-family': 'DM Mono, monospace', 'text-anchor': 'end' });
    label.textContent = `${Math.round(value / 1000)} GW`;
    chart.append(label);
  }
  [0, .5, 1].forEach((position) => {
    const date = new Date(minTime + (maxTime - minTime) * position);
    const label = makeSvg('text', { x: x(date.getTime()), y: height - 13, fill: '#777', 'font-size': '9', 'font-family': 'DM Mono, monospace', 'text-anchor': position === 0 ? 'start' : position === 1 ? 'middle' : 'end' });
    label.textContent = formatDate(date);
    chart.append(label);
  });
  const pathFor = (points) => points.filter((point) => Number.isFinite(point.value)).map((point, index) => `${index ? 'L' : 'M'}${x(point.timestamp.getTime()).toFixed(2)},${y(point.value).toFixed(2)}`).join(' ');
  chart.append(makeSvg('path', { d: pathFor(visibleActuals), fill: 'none', stroke: '#111', 'stroke-width': '1.35', 'vector-effect': 'non-scaling-stroke' }));
  series.forEach((item, index) => chart.append(makeSvg('path', { d: pathFor(item.points), fill: 'none', stroke: palette[index % palette.length], 'stroke-width': '1.7', 'vector-effect': 'non-scaling-stroke' })));

  if (Number.isFinite(forecastEnd)) dataWindow.textContent = `24H VIEW: ${formatDate(new Date(viewStart)).toUpperCase()} — ${formatDate(new Date(forecastEnd)).toUpperCase()}`;

  legend.replaceChildren();
  addLegendItem('Actual demand', '#111');
  series.forEach((item, index) => addLegendItem(formatModelName(item.name), palette[index % palette.length]));
}

function addLegendItem(label, color) {
  const item = document.createElement('span');
  item.className = 'legend-item';
  item.innerHTML = `<span class="legend-line" style="background:${color}"></span>${label}`;
  legend.append(item);
}

function prepareControls() {
  const names = Object.keys(dashboard.forecasts || {});
  names.forEach((name) => {
    const label = document.createElement('label');
    label.className = 'model-choice';
    const box = document.createElement('input');
    box.type = 'checkbox'; box.name = 'demand-model'; box.value = name; box.checked = true;
    box.addEventListener('change', drawChart);
    label.append(box, document.createTextNode(formatModelName(name)));
    modelChoices.append(label);
  });
  if (!names.length) modelChoices.insertAdjacentText('beforeend', 'No forecasting models available yet');
}

async function loadDashboard() {
  try {
    const response = await fetch(snapshotUrl, { cache: 'no-cache' });
    if (!response.ok) throw new Error(`Could not load data (${response.status})`);
    dashboard = await response.json();
    if (!dashboard.actuals?.values_mw?.length) throw new Error('The dashboard snapshot contains no demand data.');
    prepareControls();
    drawChart();
    statusText.classList.add('is-hidden');
    const updated = new Date(dashboard.generated_at);
    updatedText.textContent = `DATA UPDATED: ${formatDate(updated).toUpperCase()}`;
  } catch (error) {
    statusText.textContent = `Data unavailable — ${error.message}`;
    console.error(error);
  }
}

document.addEventListener('pointermove', (event) => { cursor.style.left = `${event.clientX}px`; cursor.style.top = `${event.clientY}px`; });
loadDashboard();
