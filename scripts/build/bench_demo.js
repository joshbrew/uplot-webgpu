import uPlot, { defaultUPlot, WebGPURenderer, WebGPURendererInternals, runWebGPURendererSmokeTests } from './index.bench.js';
import css from '../uPlot.css';

if (uPlot.paths?.spline2 && defaultUPlot.paths && !defaultUPlot.paths.spline2)
  defaultUPlot.paths.spline2 = uPlot.paths.spline2;

const BENCH_SCHEMA_VERSION = 57;

function makeRunId() {
  let stamp = new Date().toISOString().replace(/[:.]/g, '-');
  let random = Math.random().toString(36).slice(2, 8);
  return `uplot-webgpu-v${BENCH_SCHEMA_VERSION}-${stamp}-${random}`;
}

function safeFilePart(value) {
  return String(value || 'run').replace(/[^a-z0-9._-]+/gi, '_').slice(0, 120);
}


const DEMO_NAMES = [
  'add-del-series', 'align-data', 'annotations', 'arcsinh-scales', 'area-fill', 'axis-autosize', 'axis-control',
  'axis-indicators', 'bars-grouped-stacked', 'bars-values-autosize', 'box-whisker', 'candlestick-ohlc', 'cursor-bind',
  'cursor-snap', 'cursor-tooltip', 'custom-scales', 'data-smoothing', 'dependent-scale', 'draw-hooks', 'focus-cursor',
  'gradients', 'grid-over-series', 'high-low-bands', 'latency-heatmap', 'line-paths', 'log-scales', 'log-scales2',
  'mass-spectrum', 'measure-datums', 'missing-data', 'months-ru', 'months', 'multi-bars', 'nearest-non-null',
  'nice-scale', 'no-data', 'path-gap-clip', 'pixel-align', 'points', 'resize', 'scale-padding', 'scales-dir-ori',
  'scatter', 'scroll-sync', 'sine-stream', 'soft-minmax', 'sparklines-bars', 'sparklines', 'sparse', 'stacked-series',
  'stream-data', 'svg-image', 'sync-cursor', 'sync-y-zero', 'thin-bars-stroke-fill', 'time-periods', 'timeline-discrete',
  'timeseries-discrete', 'timezones-dst', 'tooltips-closest', 'tooltips', 'trendlines', 'update-cursor-select-resize',
  'wind-direction', 'y-scale-drag', 'y-shifted-series', 'zoom-fetch', 'zoom-ranger-grips', 'zoom-ranger-xy',
  'zoom-ranger', 'zoom-touch', 'zoom-variations', 'zoom-wheel',
];

const BENCH_NAMES = [
  'uPlot', 'uPlot-10M', 'uPlot-600-series', 'Chart.js4', 'Chart.js4-sine-stream', 'ECharts5', 'ECharts5-sine-stream',
  'ApexCharts', 'CanvasJS', 'Flot', 'Highcharts', 'LightningChart', 'Plotly.js', 'ZingChart', 'amCharts5', 'dvxCharts',
  'dygraphs', 'lightweight-charts',
];

const SERIES_COLORS = [
  '#276ef1', '#e4572e', '#23a455', '#8a63d2', '#d39200', '#008a8a', '#cc3377', '#667085',
];

function now() {
  return performance.now();
}

function ms(value) {
  return Number.isFinite(value) ? value.toFixed(2) : '';
}

function summarizeSamples(values) {
  let nums = values.filter(Number.isFinite).slice().sort((a, b) => a - b);
  if (nums.length == 0)
    return {count: 0, min: NaN, median: NaN, p95: NaN, max: NaN, avg: NaN};

  let pick = q => nums[Math.min(nums.length - 1, Math.max(0, Math.floor((nums.length - 1) * q)))];
  let sum = nums.reduce((acc, v) => acc + v, 0);
  return {
    count: nums.length,
    min: nums[0],
    median: pick(0.5),
    p95: pick(0.95),
    max: nums[nums.length - 1],
    avg: sum / nums.length,
  };
}

function sampleText(values) {
  let s = summarizeSamples(values);
  return s.count ? `${ms(s.median)} med / ${ms(s.p95)} p95` : '';
}

function sumSamples(values) {
  return values.filter(Number.isFinite).reduce((acc, v) => acc + v, 0);
}

function safeNumber(value, fallback = 0) {
  let num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function clampNumber(value, min, max, fallback) {
  let num = safeNumber(value, fallback);
  return Math.max(min, Math.min(max, num));
}

function rowResults(ui) {
  return Array.from(ui.results.querySelectorAll('tr')).map(row => {
    try { return row.dataset.result ? JSON.parse(row.dataset.result) : null; }
    catch (err) { return null; }
  }).filter(Boolean);
}

function groupRunResults(results) {
  let groups = {
    chart: [],
    raw: [],
    animation: [],
    api: [],
    errors: [],
  };

  for (let r of results) {
    if (r.error)
      groups.errors.push(r);
    else if (r.animation?.mode)
      groups.raw.push(r);
    else if (r.animation)
      groups.animation.push(r);
    else if (r.spec?.id?.startsWith('api:'))
      groups.api.push(r);
    else
      groups.chart.push(r);
  }

  return groups;
}

function aggregateRunResults(results) {
  let groups = groupRunResults(results);
  let updateVals = groups.chart.map(r => safeNumber(r.updateAvg, NaN)).filter(Number.isFinite);
  let createVals = groups.chart.map(r => safeNumber(r.createMs, NaN)).filter(Number.isFinite);
  let rawFpsVals = groups.raw.map(r => safeNumber(r.animation?.fps, NaN)).filter(Number.isFinite);
  let rawUpdateVals = groups.raw.map(r => safeNumber(r.animation?.updateAvg, NaN)).filter(Number.isFinite);
  let rawBandwidthVals = groups.raw.map(r => safeNumber(r.animation?.bandwidthMbSec, NaN)).filter(Number.isFinite);

  return {
    counts: Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, v.length])),
    chartCreate: summarizeSamples(createVals),
    chartUpdate: summarizeSamples(updateVals),
    rawFps: summarizeSamples(rawFpsVals),
    rawUpdate: summarizeSamples(rawUpdateVals),
    rawBandwidth: summarizeSamples(rawBandwidthVals),
  };
}


function resultCompareKey(result) {
  let spec = result?.spec || {};
  let engine = spec.engineKey || spec.engineLabel || result.engine || '';
  let id = spec.id || result.id || spec.title || result.Case || '';
  return `${engine}::${id}`;
}

function comparableScore(result) {
  let anim = result?.animation;
  if (anim?.mode)
    return safeNumber(anim.updateAvg, NaN);
  if (anim)
    return safeNumber(anim.updateAvg, NaN);
  if (Number.isFinite(result?.medianScore))
    return result.medianScore;
  if (Number.isFinite(result?.updateAvg))
    return result.updateAvg;
  if (result?.updateSummary?.median)
    return result.updateSummary.median;
  if (Array.isArray(result?.updateValues))
    return summarizeSamples(result.updateValues).median;
  return NaN;
}

function baselineRowsFromPayload(payload) {
  if (Array.isArray(payload))
    return payload;
  if (Array.isArray(payload?.rawRows))
    return payload.rawRows;
  if (payload?.groups && typeof payload.groups == 'object')
    return Object.values(payload.groups).flat().filter(Boolean);
  return [];
}

function buildBaselineMap(payload) {
  let rows = baselineRowsFromPayload(payload);
  let map = new Map();
  for (let row of rows) {
    let key = resultCompareKey(row);
    let score = comparableScore(row);
    if (key && Number.isFinite(score))
      map.set(key, {row, score});
  }
  return map;
}

function compareAgainstBaseline(result, baselineMap, settings = {}) {
  if (!baselineMap || baselineMap.size == 0)
    return null;
  let key = resultCompareKey(result);
  let score = comparableScore(result);
  let base = baselineMap.get(key);
  if (!base || !Number.isFinite(score) || !Number.isFinite(base.score) || base.score <= 0)
    return null;
  let ratio = score / base.score;
  let pct = (ratio - 1) * 100;
  let threshold = safeNumber(settings.regressionPct, 12);
  let status = pct > threshold ? 'regression' : pct < -threshold ? 'improved' : 'flat';
  return {key, score, baseline: base.score, ratio, pct, status};
}

function applyBaselineComparison(row, result, baselineState, settings = {}) {
  let cmp = compareAgainstBaseline(result, baselineState?.map, settings);
  if (!cmp)
    return null;

  let sign = cmp.pct > 0 ? '+' : '';
  let cell = row?.querySelector?.('[data-cell="baseline"]');
  if (cell)
    cell.textContent = `${sign}${cmp.pct.toFixed(1)}%`;
  appendRowNote(row, `baseline ${sign}${cmp.pct.toFixed(1)}%`);
  if (cmp.status == 'regression')
    row.dataset.regression = 'warn';
  else if (cmp.status == 'improved')
    row.dataset.regression = 'good';

  result.baselineComparison = cmp;
  return cmp;
}


function refreshBaselineComparisons(ui, baselineState, settings = {}) {
  let updated = 0;
  for (let row of ui.results.querySelectorAll('tr')) {
    let result = null;
    try { result = row.dataset.result ? JSON.parse(row.dataset.result) : null; }
    catch (err) { result = null; }
    if (!result || result.error)
      continue;
    delete row.dataset.regression;
    let baselineCell = row.querySelector('[data-cell="baseline"]');
    if (baselineCell)
      baselineCell.textContent = '';
    delete result.baselineComparison;
    let cmp = applyBaselineComparison(row, result, baselineState, settings);
    if (cmp)
      updated++;
    attachRowResult(row, result);
  }
  updateComparisonMetrics(ui);
  return updated;
}

function summarizeBaselineComparisons(results) {
  let comparisons = results.map(r => r.baselineComparison).filter(Boolean);
  if (!comparisons.length)
    return {count: 0, improved: 0, regressed: 0, flat: 0, pct: summarizeSamples([])};
  let improved = comparisons.filter(c => c.status == 'improved').length;
  let regressed = comparisons.filter(c => c.status == 'regression').length;
  let flat = comparisons.length - improved - regressed;
  return {count: comparisons.length, improved, regressed, flat, pct: summarizeSamples(comparisons.map(c => c.pct))};
}

function summarizeEngineSpeedups(results) {
  let gpu = new Map();
  let ratios = [];
  for (let r of results) {
    if (r?.spec?.engineKey == 'webgpu') {
      let score = comparableScore(r);
      if (Number.isFinite(score) && score > 0)
        gpu.set(r.spec.id, score);
    }
  }
  for (let r of results) {
    if (r?.spec?.engineKey != 'canvas2d')
      continue;
    let score = comparableScore(r);
    let gpuScore = gpu.get(r.spec.id);
    if (Number.isFinite(score) && Number.isFinite(gpuScore) && gpuScore > 0)
      ratios.push(score / gpuScore);
  }
  let summary = summarizeSamples(ratios);
  return {count: ratios.length, ratios, summary, faster: ratios.filter(v => v > 1).length, slower: ratios.filter(v => v < 1).length};
}

function updateComparisonMetrics(ui) {
  let results = rowResults(ui);
  let baseline = summarizeBaselineComparisons(results);
  let speed = summarizeEngineSpeedups(results);
  if (baseline.count) {
    let sign = baseline.pct.median > 0 ? '+' : '';
    ui.metric('baselineDiff').textContent = `${baseline.regressed} reg / ${baseline.improved} better / ${sign}${ms(baseline.pct.median)}% med`;
  }
  if (speed.count)
    ui.metric('speedup').textContent = `${ms(speed.summary.median)}x med / ${ms(speed.summary.p95)}x p95, ${speed.faster}/${speed.count} faster`;
}

function budgetForResult(result, settings = {}) {
  let spec = result?.spec || {};
  let updateBudget = safeNumber(settings.updateBudgetMs, 16.7);
  let rawFpsBudget = safeNumber(settings.rawFpsBudget, 55);
  let profile = settings.budgetProfile || 'interactive';

  if (profile == 'regression') {
    updateBudget *= 1.5;
    rawFpsBudget = Math.max(24, rawFpsBudget * 0.85);
  }
  else if (profile == 'stress') {
    updateBudget *= 2.25;
    rawFpsBudget = Math.max(18, rawFpsBudget * 0.65);
  }
  else if (profile == 'strict') {
    updateBudget *= 0.65;
    rawFpsBudget = Math.min(120, rawFpsBudget * 1.10);
  }

  if (spec.kind == 'animation')
    updateBudget *= 1.25;
  if (spec.kind == 'bench' && spec.points > 10000)
    updateBudget *= 2.0;
  if (spec.kind == 'raw-animation')
    updateBudget *= 1.5;

  return {updateBudget, rawFpsBudget, profile};
}

function budgetFlagsForResult(result, settings = {}) {
  let flags = [];
  let {updateBudget, rawFpsBudget, profile} = budgetForResult(result, settings);
  let score = comparableScore(result);
  let anim = result?.animation;

  if (Number.isFinite(score) && score > updateBudget)
    flags.push(`update>${ms(updateBudget)}ms:${ms(score)}ms`);
  if (anim?.fps && anim.fps < rawFpsBudget)
    flags.push(`fps<${ms(rawFpsBudget)}:${ms(anim.fps)}`);
  if (anim?.dropped)
    flags.push(`drops:${anim.dropped}`);
  if (anim?.mode == 'full' && anim.bandwidthMbSec > 1000)
    flags.push(`high-upload:${ms(anim.bandwidthMbSec)}MB/s`);
  return flags;
}

function updateBudgetCell(row, result, settings = {}) {
  let cell = row?.querySelector?.('[data-cell="budget"]');
  let flags = budgetFlagsForResult(result, settings);
  if (cell)
    cell.textContent = flags.length ? flags.join(', ') : 'ok';
  if (flags.length)
    row.dataset.budget = 'warn';
  else
    delete row.dataset.budget;
  result.budgetFlags = flags;
  return flags;
}

function diagnoseRawResult(result, settings = {}) {
  let anim = result?.animation;
  if (!anim?.mode)
    return '';

  let parts = [];
  if (anim.mode == 'partial')
    parts.push(`partial writes ${(anim.chunk || 0).toLocaleString()} verts`);
  if (anim.mode == 'full')
    parts.push('full upload comparator');
  if (anim.mode == 'draw-only')
    parts.push('draw/submit baseline');

  if (Number.isFinite(anim.mutateAvg) && anim.mutateAvg > anim.writeAvg && anim.mutateAvg > anim.submitAvg)
    parts.push('CPU mutation dominates');
  else if (Number.isFinite(anim.writeAvg) && anim.writeAvg > anim.mutateAvg && anim.writeAvg > anim.submitAvg)
    parts.push('writeBuffer dominates');
  else if (Number.isFinite(anim.submitAvg) && anim.submitAvg > anim.mutateAvg && anim.submitAvg > anim.writeAvg)
    parts.push('submit/draw dominates');

  let flags = budgetFlagsForResult(result, settings);
  if (flags.length)
    parts.push(`flags ${flags.join('|')}`);

  return parts.join('; ');
}

function updateDiagnostics(ui, settings = {}) {
  let results = rowResults(ui);
  let aggregate = aggregateRunResults(results);
  let chartUpdate = aggregate.chartUpdate;
  let rawFps = aggregate.rawFps;
  let rawBandwidth = aggregate.rawBandwidth;
  let showPerfWarnings = settings.budgetFlags !== false;
  let budgeted = showPerfWarnings ? results.filter(r => budgetFlagsForResult(r, settings).length) : [];
  let rawModes = results.filter(r => r.animation?.mode).map(r => `${r.animation.mode}:${ms(r.animation.fps)}fps`).join(', ');

  let chartText = chartUpdate.count ? `${ms(chartUpdate.median)} med / ${ms(chartUpdate.p95)} p95` : 'pending';
  let rawText = rawFps.count ? `${ms(rawFps.median)} med fps, ${ms(rawBandwidth.median)} MB/s` : 'pending';
  let flagsText = showPerfWarnings ? (budgeted.length ? `${budgeted.length} warning${budgeted.length == 1 ? '' : 's'}` : 'none') : 'off';

  ui.metric('chartDiag').textContent = chartText;
  ui.metric('rawDiag').textContent = rawModes || rawText;
  ui.metric('budget').textContent = flagsText;
  updateComparisonMetrics(ui);

  return aggregate;
}

function repeatText(values, repeats) {
  if (repeats <= 1)
    return ms(values[0]);
  return sampleText(values);
}

function nextFrame() {
  return new Promise(resolve => requestAnimationFrame(() => resolve()));
}

function idle(timeout = 250) {
  if (typeof requestIdleCallback == 'function')
    return new Promise(resolve => requestIdleCallback(resolve, {timeout}));
  return new Promise(resolve => setTimeout(resolve, 0));
}

async function settleForTiming() {
  await nextFrame();
  await nextFrame();
  await idle(80);
}

function isCanvas2DChart(chart) {
  let ctx = chart?.ctx;
  return !!ctx && typeof ctx.present != 'function' && typeof ctx.getLastFrameStats != 'function';
}

function withBenchDrawTimingHooks(hooks = {}) {
  let out = {};
  for (let [name, handlers] of Object.entries(hooks || {}))
    out[name] = Array.isArray(handlers) ? handlers.slice() : [handlers].filter(Boolean);

  let drawClearStart = u => {
    u._benchDrawStart = now();
  };
  let drawEnd = u => {
    let t0 = Number(u._benchDrawStart);
    if (Number.isFinite(t0))
      u._benchLastDrawMs = Math.max(0, now() - t0);
    u._benchLastDrawAt = now();
  };

  out.drawClear = [drawClearStart, ...(out.drawClear || [])];
  out.draw = [...(out.draw || []), drawEnd];
  return out;
}

function canvasDrawFrameStats(chart, drawMs) {
  return {
    renderPath: 'canvas2d',
    cpuFrameMs: drawMs,
    drawMs,
  };
}

async function measureCanvasDrawFrame(chart) {
  if (!chart)
    return {submitMs: 0, frameStats: null};

  await Promise.resolve();
  let t0 = now();
  chart.redraw?.(false, false);
  let elapsed = now() - t0;
  let drawMs = Number(chart._benchLastDrawMs);
  if (!Number.isFinite(drawMs) || drawMs <= 0)
    drawMs = elapsed;
  return {submitMs: drawMs, frameStats: canvasDrawFrameStats(chart, drawMs)};
}

async function submitChartFrame(chart, {forceCanvasDraw = false} = {}) {
  if (!chart?.ctx)
    return {submitMs: 0, frameStats: null};

  if (isCanvas2DChart(chart)) {
    if (forceCanvasDraw)
      return measureCanvasDrawFrame(chart);
    let drawMs = Number(chart._benchLastDrawMs);
    if (!Number.isFinite(drawMs) || drawMs < 0)
      drawMs = 0;
    return {submitMs: drawMs, frameStats: canvasDrawFrameStats(chart, drawMs)};
  }

  await Promise.resolve();
  let t0 = now();
  chart.ctx.present?.();
  let frameStats = chart.ctx.getLastFrameStats?.() || null;
  let submitMs = Number.isFinite(frameStats?.cpuFrameMs) && frameStats.cpuFrameMs > 0
    ? frameStats.cpuFrameMs
    : now() - t0;
  return {submitMs, frameStats};
}

async function flushChart(chart, {wait = true} = {}) {
  let submitted = await submitChartFrame(chart);
  if (wait && chart?.ctx?.flush)
    await chart.ctx.flush();
  return submitted;
}

function addStyle() {
  let style = document.createElement('style');
  style.textContent = `
    :root {
      color-scheme: only light;
      --bench-bg: #e7e4dd;
      --bench-surface: #f1efea;
      --bench-ink: #111827;
      --bench-muted: rgba(17,24,39,0.72);
    }
    html, body, .bench-page, .bench-page * { forced-color-adjust: none; }
    html { background: var(--bench-bg); color: var(--bench-ink); }
    body { margin: 0; font: 14px/1.4 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: radial-gradient(circle at top left, rgba(39,110,241,0.10), var(--bench-bg) 48%); color: var(--bench-ink); }
    .bench-page { padding: 20px; display: grid; gap: 18px; max-width: 1680px; margin: 0 auto; }
    .bench-page, .bench-top, .bench-results-wrap, .bench-grid, .bench-card { contain: layout style paint; }
    .bench-top { display: grid; gap: 12px; padding: 18px; border: 1px solid color-mix(in srgb, CanvasText 12%, transparent); border-radius: 16px; background: color-mix(in srgb, Canvas 92%, CanvasText 2%); box-shadow: 0 12px 38px color-mix(in srgb, CanvasText 10%, transparent); }
    .bench-top h1 { margin: 0; font-size: clamp(24px, 3vw, 40px); letter-spacing: -0.035em; line-height: 1.05; }
    .bench-intro { margin: 0; max-width: 1060px; opacity: 0.82; font-size: 15px; }
    .bench-options { border: 1px solid color-mix(in srgb, CanvasText 16%, transparent); border-radius: 8px; padding: 8px 10px; }
    .bench-options summary { cursor: pointer; font-weight: 700; }
    .bench-controls { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; } .bench-primary-controls { padding-top: 4px; } .bench-primary-controls button[data-action="run"], .bench-primary-controls button[data-action="runLiveDashboardWebGPU"], .bench-primary-controls button[data-action="runLiveDashboardCanvas2D"] { font-weight: 800; }
    .bench-controls label { display: inline-flex; gap: 6px; align-items: center; }
    .bench-controls input[type="number"] { width: 90px; }
    .bench-controls select { max-width: 180px; }
    .bench-controls button { padding: 7px 11px; cursor: pointer; border-radius: 8px; border: 1px solid color-mix(in srgb, CanvasText 18%, transparent); background: color-mix(in srgb, Canvas 94%, CanvasText 4%); color: CanvasText; } .bench-controls button:hover { background: color-mix(in srgb, #276ef1 10%, Canvas); }
    .bench-controls button, .bench-controls input, .bench-controls select, .bench-controls textarea { color-scheme: only light; forced-color-adjust: none; }
    .bench-perf-launcher { display: grid; gap: 12px; margin: 12px 0; padding: 14px; border: 1px solid color-mix(in srgb, #276ef1 30%, CanvasText 12%); border-radius: 14px; background: linear-gradient(135deg, color-mix(in srgb, #276ef1 9%, Canvas), color-mix(in srgb, #23a455 5%, Canvas)); }
    .bench-perf-launcher h2 { margin: 0; font-size: 16px; }
    .bench-perf-launcher p { margin: 0; color: color-mix(in srgb, CanvasText 74%, transparent); }
    .bench-perf-launcher-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 10px; }
    .bench-perf-card { display: grid; gap: 7px; align-content: start; padding: 13px; border: 1px solid color-mix(in srgb, CanvasText 15%, transparent); border-radius: 12px; background: color-mix(in srgb, Canvas 94%, CanvasText 3%); min-height: 150px; box-shadow: inset 0 1px 0 color-mix(in srgb, white 28%, transparent); }
    .bench-perf-card strong { font-size: 14px; }
    .bench-perf-card span { font-size: 12px; line-height: 1.35; color: color-mix(in srgb, CanvasText 72%, transparent); }
    .bench-perf-card button { justify-self: start; padding: 7px 10px; cursor: pointer; }
    .bench-coverage-map { display: grid; gap: 8px; margin: 10px 0 14px; padding: 12px 14px; border-radius: 12px; background: color-mix(in srgb, CanvasText 5%, transparent); font-size: 12px; line-height: 1.45; } .bench-pill-row { display: flex; flex-wrap: wrap; gap: 7px; } .bench-pill { display: inline-flex; align-items: center; padding: 4px 8px; border-radius: 999px; background: color-mix(in srgb, #276ef1 9%, Canvas); border: 1px solid color-mix(in srgb, #276ef1 16%, transparent); }
    .bench-coverage-map b { font-size: 13px; }
    .bench-summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 8px; }
    .bench-summary-simple { grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); }
    .bench-wide { grid-column: span 2; }
    .bench-hidden-options, .bench-hidden-metrics { display: none !important; }
    .bench-metric { border: 1px solid color-mix(in srgb, CanvasText 18%, transparent); border-radius: 8px; padding: 8px 10px; }
    .bench-metric b { display: block; font-size: 18px; }
    .bench-log { max-height: 150px; overflow: auto; padding: 8px; border-radius: 8px; background: color-mix(in srgb, CanvasText 8%, transparent); font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; white-space: pre-wrap; }
    .bench-results-wrap { overflow: auto; border: 1px solid color-mix(in srgb, CanvasText 18%, transparent); border-radius: 8px; }
    .bench-results { border-collapse: collapse; width: 100%; min-width: 980px; }
    .bench-results th, .bench-results td { padding: 6px 8px; border-bottom: 1px solid color-mix(in srgb, CanvasText 14%, transparent); text-align: left; vertical-align: top; }
    .bench-results th { position: sticky; top: 0; background: Canvas; z-index: 1; }
    .bench-results tr[data-status="error"] { background: color-mix(in srgb, red 12%, transparent); }
    .bench-results tr[data-budget="warn"] { outline: 2px solid color-mix(in srgb, orange 70%, transparent); outline-offset: -2px; }
    .bench-results tr[data-regression="warn"] { box-shadow: inset 4px 0 0 color-mix(in srgb, red 70%, transparent); }
    .bench-results tr[data-regression="good"] { box-shadow: inset 4px 0 0 color-mix(in srgb, green 70%, transparent); }
    .bench-results tr[data-status="done"] { background: color-mix(in srgb, green 6%, transparent); }
    .bench-results tr[data-engine="canvas2d"] { background-image: linear-gradient(90deg, color-mix(in srgb, orange 7%, transparent), transparent 34%); }
    .bench-results tr[data-engine="webgpu"] { background-image: linear-gradient(90deg, color-mix(in srgb, #276ef1 7%, transparent), transparent 34%); }
    .bench-results tr[data-engine="webgpu-raw"] { background-image: linear-gradient(90deg, color-mix(in srgb, #7c3aed 9%, transparent), transparent 34%); }
    .bench-grid { display: grid; gap: 18px; content-visibility: auto; contain-intrinsic-size: 920px 390px; }
    .bench-stage { position: fixed; left: 0; top: 0; width: 720px; height: 420px; overflow: hidden; opacity: 0; pointer-events: none; z-index: -1; contain: strict; }
    .bench-pair { display: grid; grid-template-columns: minmax(260px, 1fr) minmax(260px, 1fr); gap: 14px; align-items: stretch; contain: layout style paint; }
    .bench-pair-title { grid-column: 1 / -1; margin: 2px 0 -6px; font-size: 16px; font-weight: 850; opacity: 0.88; letter-spacing: -0.01em; }
    .bench-card { border: 1px solid color-mix(in srgb, CanvasText 18%, transparent); border-radius: 12px; padding: 11px; min-width: 0; min-height: 336px; contain: layout style paint; overflow: visible; box-sizing: border-box; background: color-mix(in srgb, Canvas 96%, CanvasText 2%); }
    .bench-card[data-engine="webgpu"] { border-color: color-mix(in srgb, #276ef1 55%, CanvasText 18%); }
    .bench-card[data-engine="canvas2d"] { border-color: color-mix(in srgb, #d39200 55%, CanvasText 18%); }
    .bench-card h3 { margin: 0 0 6px; font-size: 14px; display: flex; justify-content: space-between; gap: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .bench-card small { font-weight: 400; opacity: 0.75; }
    .bench-card-load { display: none; flex-wrap: wrap; gap: 6px 10px; align-items: center; min-height: 0; margin: 0 0 6px; font-size: 11px; line-height: 1.15; color: rgba(15,23,42,0.72); }
    .bench-card-load b { font-size: 11px; color: rgba(15,23,42,0.92); }
    .bench-card-load.is-running, .bench-card-load.is-error, .bench-card-load.is-live, .bench-card-load.is-done { display: flex; min-height: 18px; }
    .bench-card-load.is-running { color: rgba(15,23,42,0.54); }
    .bench-card-load.is-error { color: #b42318; }
    .bench-card-load.is-live { color: rgba(15,23,42,0.62); }
    .bench-card-load.is-done { color: rgba(15,23,42,0.72); }
    .bench-chart { height: 340px; min-height: 340px; overflow: visible; contain: layout paint; }
    .bench-chart .uplot, .bench-chart canvas { max-width: 100%; }
    .bench-chart .uplot { overflow: visible; }
    .bench-chart .u-legend { margin-top: 8px; }
    .bench-chart .u-axis-label { fill: rgba(15,23,42,0.76); font-weight: 800; letter-spacing: 0.01em; }
    .bench-value-tooltip { position: absolute; z-index: 40; pointer-events: none; min-width: 150px; max-width: 260px; padding: 10px 12px; border: 1px solid rgba(15,23,42,0.26); border-radius: 7px; background: rgba(255,255,255,0.98); box-shadow: 0 8px 22px rgba(15,23,42,0.18); color: rgba(15,23,42,0.96); font: 700 14px/1.28 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; text-align: left; white-space: nowrap; }
    .bench-value-tooltip.is-hidden { display: none; }
    .bench-value-tooltip-row { display: grid; grid-template-columns: 14px auto; gap: 8px; align-items: center; margin: 3px 0; }
    .bench-value-tooltip-row.is-x { grid-template-columns: auto; font-weight: 800; border-bottom: 1px solid rgba(15,23,42,0.12); padding-bottom: 5px; margin-bottom: 6px; }
    .bench-value-tooltip-swatch { width: 11px; height: 11px; border-radius: 2px; background: currentColor; box-shadow: inset 0 0 0 1px rgba(255,255,255,0.65); }
    .bench-chart .u-select, .bench-chart .u-select * { pointer-events: none; }
    .bench-chart .u-select { border: 1px solid rgba(39,110,241,0.72) !important; background: rgba(39,110,241,0.13) !important; box-shadow: none !important; }
    .bench-chart .u-select::before, .bench-chart .u-select::after { display: none !important; }
    .bench-legend { display: flex; flex-wrap: wrap; gap: 10px 18px; align-items: center; margin-top: 10px; font-size: 12px; line-height: 1.25; }
    .bench-legend.is-hidden { display: none; }
    .bench-legend-item { display: inline-flex; align-items: center; gap: 7px; opacity: 0.95; color: rgba(20,20,20,0.88); }
    .bench-legend-swatch { width: 12px; height: 12px; border: 2px solid currentColor; background: transparent; display: inline-block; box-sizing: border-box; }
    .bench-legend-swatch.is-dashed { width: 16px; height: 0; border: 0; border-top: 3px dashed currentColor; }
    .bench-legend-swatch.is-band { border: 1px solid currentColor; background: currentColor; opacity: 0.24; border-radius: 2px; }
    .bench-live-stats { margin-top: 10px; padding: 8px 10px; border-radius: 8px; background: color-mix(in srgb, CanvasText 7%, transparent); font: 12px/1.35 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; white-space: pre-wrap; }
    .bench-worker-canvas { display: block; width: 100%; height: 100%; border-radius: 8px; touch-action: none; cursor: crosshair; background: #fff; color-scheme: only light; forced-color-adjust: none; }
    .bench-worker-badge { position: absolute; left: 64px; top: 34px; z-index: 3; pointer-events: none; min-width: 190px; padding: 8px 12px; border: 1px solid rgba(39,110,241,0.42); background: rgba(39,110,241,0.11); color: rgba(20,24,30,0.92); font: 12px/1.2 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; box-sizing: border-box; }
    .bench-worker-badge[data-engine="canvas2d"] { border-color: rgba(228,87,46,0.46); background: rgba(228,87,46,0.12); }
    .bench-live-stats b { font-family: inherit; font-size: 13px; }
    .bench-live-demo-note { margin: 8px 0 0; padding: 8px 10px; border-radius: 8px; background: color-mix(in srgb, #276ef1 8%, transparent); font-size: 13px; line-height: 1.35; }
    .bench-page[data-mode="live-demo"] { max-width: none; width: 100vw; height: 100vh; min-height: 100vh; padding: 8px; gap: 8px; box-sizing: border-box; overflow: hidden; }
    .bench-page[data-mode="live-demo"] .bench-top { padding: 10px; gap: 8px; }
    .bench-page[data-mode="live-demo"] .bench-top h1 { font-size: 20px; }
    .bench-page[data-mode="live-demo"] .bench-intro, .bench-page[data-mode="live-demo"] .bench-perf-launcher, .bench-page[data-mode="live-demo"] .bench-coverage-map, .bench-page[data-mode="live-demo"] .bench-options, .bench-page[data-mode="live-demo"] .bench-log, .bench-page[data-mode="live-demo"] .bench-results-wrap { display: none; }
    .bench-page[data-mode="live-demo"] .bench-primary-controls { gap: 6px; padding-top: 0; }
    .bench-page[data-mode="live-demo"] .bench-primary-controls button { padding: 5px 8px; font-size: 12px; }
    .bench-page[data-mode="live-demo"] .bench-summary { grid-template-columns: repeat(8, minmax(92px, 1fr)); gap: 6px; }
    .bench-page[data-mode="live-demo"] .bench-metric { padding: 5px 7px; font-size: 11px; }
    .bench-page[data-mode="live-demo"] .bench-metric b { font-size: 13px; }
    .bench-page[data-mode="live-demo"] .bench-grid { grid-template-columns: repeat(4, minmax(220px, 1fr)); gap: 8px; content-visibility: visible; contain-intrinsic-size: auto; }
    .bench-page[data-mode="live-demo"] .bench-card { min-height: 0; padding: 7px; border-radius: 9px; }
    .bench-page[data-mode="live-demo"] .bench-card h3 { margin-bottom: 4px; font-size: 12px; }
    .bench-page[data-mode="live-demo"] .bench-card-load, .bench-page[data-mode="live-demo"] .bench-legend { display: none; }
    .bench-page[data-mode="live-demo"] .bench-chart { height: 170px; min-height: 170px; }
    .bench-page[data-mode="live-demo"] .bench-live-stats { margin-top: 4px; padding: 4px 6px; font-size: 10px; line-height: 1.18; max-height: 38px; overflow: hidden; }
    .bench-page[data-mode="live-demo"] .bench-worker-badge { left: 46px; top: 22px; min-width: 0; max-width: calc(100% - 58px); padding: 4px 6px; font-size: 10px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .bench-page[data-mode="live-demo"] .bench-live-demo-note { display: none; }
    @media (max-width: 1200px) { .bench-page[data-mode="live-demo"] .bench-grid { grid-template-columns: repeat(2, minmax(220px, 1fr)); } .bench-page[data-mode="live-demo"] .bench-summary { grid-template-columns: repeat(4, minmax(92px, 1fr)); } }
    .bench-zoom-note { margin-top: 8px; font-size: 12px; opacity: 0.78; }
    .bench-chart canvas.bench-raw-webgpu { display: block; width: 100%; height: 100%; min-height: 170px; border-radius: 6px; }
    .bench-sparkline-row { display: grid; grid-template-columns: repeat(2, minmax(120px, 1fr)); gap: 6px; }
    .bench-error { color: #b42318; white-space: pre-wrap; }
    .bench-page[data-mode="gallery"] .bench-results-wrap { display: none; }
    .bench-page[data-mode="gallery"] .bench-summary { grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); }
    .bench-page[data-mode="benchmark"] .bench-grid { grid-template-columns: repeat(auto-fit, minmax(360px, 1fr)); gap: 14px; }
    .bench-page[data-mode="benchmark"] .bench-card { min-height: 220px; }
    .bench-page[data-mode="benchmark"] .bench-chart { height: 260px; min-height: 260px; }
    @media (max-width: 900px) { .bench-pair { grid-template-columns: 1fr; } .bench-pair-title { grid-column: auto; } }
  `;
  document.head.appendChild(style);
}

function createPage() {
  addStyle();

  let page = document.createElement('main');
  page.className = 'bench-page';
  page.dataset.mode = 'gallery';
  page.innerHTML = `
    <section class="bench-top">
      <h1>uPlot WebGPU drop-in port</h1>
      <p class="bench-intro">A direct constructor-compatible uPlot build with a WebGPU renderer underneath. The page starts with visual parity proof: WebGPU on the left, the preserved Canvas2D uPlot from <code>./old</code> on the right. Performance tests are opt-in and focus on the cases where WebGPU starts to matter, around hundreds of thousands of points and many simultaneous animated charts.</p>
      <div class="bench-controls bench-primary-controls">
        <button data-action="run">Run visual parity gallery</button>
        <button data-action="runLiveDashboardWebGPU">Run live demo WebGPU</button>
        <button data-action="runLiveDashboardCanvas2D">Run live demo Canvas2D</button>
        <button data-action="runWorkerFps">Run 500K worker FPS</button>
        <button data-action="runStylePerf">Run animated style suite</button>
        <button data-action="runCapacitySweep">Run capacity sweep</button>
        <button data-action="stop">Stop</button>
        <button data-action="clear">Clear charts</button>
        <button data-action="exportCsv">Export CSV</button>
        <button data-action="exportJson">Export JSON</button>
        <button data-action="exportMarkdown">Export Markdown report</button>
        <button data-action="loadBaseline">Load baseline JSON</button>
        <button data-action="clearBaseline">Clear baseline</button>
        <input type="file" data-key="baselineFile" accept="application/json,.json" hidden />
      </div>
      <section class="bench-perf-launcher" aria-label="performance proof tests">
        <h2>Performance and live proof tests</h2>
        <p>Use the gallery for 1:1 visual parity. Use these cards when you want to prove the speed story with worker-rendered charts and reload the same dashboard under each backend.</p>
        <div class="bench-perf-launcher-grid">
          <div class="bench-perf-card">
            <strong>1. Live dashboard reload</strong>
            <span>Runs many simultaneous worker-rendered charts. Reload the exact same dashboard with WebGPU or Canvas2D for a direct cumulative comparison.</span>
            <div class="bench-controls">
              <button data-action="runLiveDashboardWebGPU">Run WebGPU dashboard</button>
              <button data-action="runLiveDashboardCanvas2D">Run Canvas2D dashboard</button>
            </div>
          </div>
          <div class="bench-perf-card">
            <strong>2. 500K live worker FPS</strong>
            <span>One lane at a time. WebGPU uses a storage-buffer vertex shader. Canvas2D uses a separate OffscreenCanvas worker with visible-frame FPS reporting.</span>
            <button data-action="runWorkerFps">Run 500K worker FPS</button>
          </div>
          <div class="bench-perf-card">
            <strong>3. Animated style suite</strong>
            <span>Scrolling worker-rendered style proofs for line, gradient area, high/low band, bars, heatmap, and multi-buffer line charts.</span>
            <button data-action="runStylePerf">Run animated style suite</button>
          </div>
          <div class="bench-perf-card">
            <strong>4. Capacity sweep</strong>
            <span>WebGPU-only escalating point counts and multiple buffers on the same chart to find where the backend starts to max out.</span>
            <button data-action="runCapacitySweep">Run capacity sweep</button>
          </div>
        </div>
      </section>
      <section class="bench-coverage-map" aria-label="uPlot style coverage map">
        <b>Visual parity gallery coverage:</b>
        <div class="bench-pill-row">
          <span class="bench-pill">lines</span>
          <span class="bench-pill">dash/dot styles</span>
          <span class="bench-pill">area gradients</span>
          <span class="bench-pill">stroke gradients</span>
          <span class="bench-pill">bands</span>
          <span class="bench-pill">bars</span>
          <span class="bench-pill">heatmaps</span>
          <span class="bench-pill">sparklines</span>
          <span class="bench-pill">candles</span>
          <span class="bench-pill">box plots</span>
          <span class="bench-pill">log scales</span>
          <span class="bench-pill">dual axes</span>
          <span class="bench-pill">plugins</span>
          <span class="bench-pill">cursor values</span>
          <span class="bench-pill">zoom/select</span>
        </div>
        <span>Coverage is cross-checked against the old uPlot demos in <code>./old</code>: path interpolation, fill/stroke styles, points, missing data, plugins, axes, cursor/select behavior, and high-volume benchmark cases. The old-demo references are now covered by the curated visual parity gallery so the page avoids redundant or brittle legacy sweeps.</span>
        <b>Animation coverage:</b>
        <span>500K line, 500K gradient area, 300K high/low band, 120K bars, 1024x1024 heatmap, 4 x 250K multi-buffer lines, plus a live mixed-style dashboard and a WebGPU capacity sweep through high-volume style workloads.</span>
      </section>
      <details class="bench-options">
        <summary>Advanced run settings</summary>
        <div class="bench-controls">
          <label><input type="checkbox" data-key="compareDefault" checked /> compare Canvas2D lane</label>
          <label><input type="checkbox" data-key="heavy" /> heavy sizes</label>
          <label>animation seconds <input type="number" data-key="animationSeconds" min="1" max="30" value="10" /></label>
          <label>case repeats <input type="number" data-key="repeats" min="1" max="7" value="3" /></label>
          <label title="Optional threshold hints, not correctness failures"><input type="checkbox" data-key="budgetFlags" /> perf warnings</label>
        </div>
        <div class="bench-hidden-options" aria-hidden="true">
          <input type="checkbox" data-key="largeAnimation" checked />
          <input type="checkbox" data-key="rawGpuRing" checked />
          <input type="checkbox" data-key="rawGpuFullCompare" checked />
          <input type="checkbox" data-key="rawDrawBaseline" checked />
          <input type="checkbox" data-key="legacyCases" />
          <input type="checkbox" data-key="shared" checked />
          <input type="checkbox" data-key="warmup" checked />
          <input type="checkbox" data-key="isolate" checked />
          <input type="checkbox" data-key="keep" checked />
          <input type="checkbox" data-key="deferVisible" checked />
          <input type="checkbox" data-key="reuse" checked />
          <input type="checkbox" data-key="validate" checked />
          <input type="number" data-key="updates" value="8" />
          <input type="number" data-key="rawPointScale" value="1" />
          <input type="number" data-key="rawChunkDivisor" value="64" />
          <select data-key="budgetProfile"><option value="interactive" selected>interactive</option><option value="strict">strict</option><option value="regression">regression</option><option value="stress">stress</option></select>
          <input type="number" data-key="updateBudgetMs" value="16.7" />
          <input type="number" data-key="rawFpsBudget" value="55" />
          <input type="number" data-key="regressionPct" value="12" />
          <input type="number" data-key="visibleBatch" value="12" />
          <input type="number" data-key="delay" value="0" />
        </div>
      </details>
      <div class="bench-summary bench-summary-simple">
        <div class="bench-metric">Cases <b data-metric="cases">0 / 0</b></div>
        <div class="bench-metric">Mode <b data-metric="mode">pending</b></div>
        <div class="bench-metric">Errors <b data-metric="errors">0</b></div>
        <div class="bench-metric bench-wide">Comparison <b data-metric="comparison">pending</b></div>
      </div>
      <div class="bench-hidden-metrics" style="display:none !important; visibility:hidden !important;" aria-hidden="true">
        <b data-metric="webgpuTotal">0 ms</b>
        <b data-metric="canvas2dTotal">0 ms</b>
        <b data-metric="create">0 ms</b>
        <b data-metric="first">0 ms</b>
        <b data-metric="update">0 ms</b>
        <b data-metric="runtime">pending</b>
        <b data-metric="warmup">pending</b>
        <b data-metric="longTasks">0</b>
        <b data-metric="slowest">pending</b>
        <b data-metric="baseline">pending</b>
        <b data-metric="quality">pending</b>
        <b data-metric="frameStats">pending</b>
        <b data-metric="smoke">pending</b>
        <b data-metric="rawRing">pending</b>
        <b data-metric="chartDiag">pending</b>
        <b data-metric="rawDiag">pending</b>
        <b data-metric="budget">off</b>
        <b data-metric="baselineDiff">none loaded</b>
        <b data-metric="speedup">pending</b>
      </div>
      <div class="bench-log" data-log></div>
    </section>
    <section class="bench-results-wrap">
      <table class="bench-results">
        <thead>
          <tr>
            <th>#</th><th>Engine</th><th>Status</th><th>Case</th><th>Kind</th><th>Points</th><th>Series</th>
            <th>Create ms</th><th>Draw / Submit ms</th><th>Update avg ms</th><th>Destroy ms</th><th>Perf flag</th><th>Baseline Δ</th><th>Notes</th>
          </tr>
        </thead>
        <tbody data-results></tbody>
      </table>
    </section>
    <section class="bench-grid" data-grid></section>
    <section class="bench-stage" data-stage aria-hidden="true"></section>
  `;
  document.body.textContent = '';
  document.body.appendChild(page);

  return {
    page,
    grid: page.querySelector('[data-grid]'),
    stage: page.querySelector('[data-stage]'),
    results: page.querySelector('[data-results]'),
    log: page.querySelector('[data-log]'),
    metric(name) {
      let el = page.querySelector(`[data-metric="${name}"]`);
      if (el)
        return el;
      let fallback = document.createElement('b');
      fallback.dataset.metric = name;
      fallback.hidden = true;
      page.appendChild(fallback);
      return fallback;
    },
    control(key) { return page.querySelector(`[data-key="${key}"]`); },
    action(name) {
      let el = page.querySelector(`[data-action="${name}"]`);
      if (el)
        return el;
      let fallback = document.createElement('button');
      fallback.dataset.action = name;
      fallback.hidden = true;
      fallback.disabled = false;
      page.appendChild(fallback);
      return fallback;
    },
    actions(name) { return Array.from(page.querySelectorAll(`[data-action="${name}"]`)); },
  };
}

function logLine(ui, text) {
  let stamp = new Date().toLocaleTimeString();
  ui.log.textContent += `[${stamp}] ${text}\n`;
  ui.log.scrollTop = ui.log.scrollHeight;
}

function createLongTaskTracker(ui) {
  let state = {count: 0, ms: 0, observer: null};

  if (typeof PerformanceObserver != 'function')
    return state;

  try {
    let observer = new PerformanceObserver(list => {
      for (let entry of list.getEntries()) {
        state.count++;
        state.ms += entry.duration || 0;
      }
      ui.metric('longTasks').textContent = `${state.count} / ${ms(state.ms)} ms`;
    });
    observer.observe({entryTypes: ['longtask']});
    state.observer = observer;
  }
  catch (err) {}

  return state;
}

function resetLongTaskTracker(ui, tracker) {
  if (!tracker)
    return;
  tracker.count = 0;
  tracker.ms = 0;
  ui.metric('longTasks').textContent = '0 / 0.00 ms';
}

function tableRecords(ui) {
  let headers = Array.from(ui.page.querySelectorAll('.bench-results thead th')).map(th => th.textContent.trim());
  return Array.from(ui.results.querySelectorAll('tr')).map(row => {
    let record = {};
    Array.from(row.children).forEach((cell, i) => {
      record[headers[i] || `col${i}`] = cell.textContent.trim();
    });
    return record;
  });
}

function downloadText(name, type, text) {
  let blob = new Blob([text], {type});
  let url = URL.createObjectURL(blob);
  let a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportCsv(ui, currentRun = null) {
  let records = tableRecords(ui);
  if (records.length == 0)
    return;
  let keys = Object.keys(records[0]);
  let esc = v => `"${String(v ?? '').replaceAll('\"', '\"\"')}"`;
  let csv = [keys.map(esc).join(','), ...records.map(r => keys.map(k => esc(r[k])).join(','))].join('\n');
  downloadText(`${safeFilePart(currentRun?.id || 'uplot-webgpu-bench-results')}.csv`, 'text/csv', csv);
}

function exportJson(ui, baselineState = null, currentRun = null) {
  let rows = tableRecords(ui);
  let runtime = WebGPURenderer.getSharedRuntimeStats?.() || WebGPURendererInternals.getSharedRuntimeStats?.() || {};
  let rawRows = Array.from(ui.results.querySelectorAll('tr')).map(row => {
    try { return row.dataset.result ? JSON.parse(row.dataset.result) : null; }
    catch (err) { return null; }
  }).filter(Boolean);
  let groups = groupRunResults(rawRows);
  let payload = {
    schemaVersion: BENCH_SCHEMA_VERSION,
    run: currentRun || null,
    generatedAt: new Date().toISOString(),
    environment: {
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      hardwareConcurrency: navigator.hardwareConcurrency || null,
      deviceMemory: navigator.deviceMemory || null,
      devicePixelRatio: window.devicePixelRatio || 1,
      webgpu: !!navigator.gpu,
      webgpuRuntime: runtime,
    },
    summary: Object.fromEntries(Array.from(ui.page.querySelectorAll('[data-metric]')).map(el => [el.dataset.metric, el.textContent.trim()])),
    aggregates: aggregateRunResults(rawRows),
    loadedBaseline: baselineState?.name ? {name: baselineState.name, rows: baselineState.map?.size || 0} : null,
    baselineComparisons: summarizeBaselineComparisons(rawRows),
    engineSpeedups: summarizeEngineSpeedups(rawRows),
    groups,
    rows,
    rawRows,
  };
  downloadText(`${safeFilePart(currentRun?.id || 'uplot-webgpu-bench-results')}.json`, 'application/json', JSON.stringify(payload, null, 2));
}

function exportMarkdownSummary(ui, baselineState = null, currentRun = null) {
  let results = rowResults(ui);
  let aggregate = aggregateRunResults(results);
  let baseline = summarizeBaselineComparisons(results);
  let speed = summarizeEngineSpeedups(results);
  let budgeted = results.filter(r => Array.isArray(r.budgetFlags) && r.budgetFlags.length);
  let lines = [];
  lines.push(`# uPlot WebGPU bench report`);
  lines.push('');
  lines.push(`Run: ${currentRun?.id || 'ad hoc'}`);
  lines.push(`Generated: ${new Date().toISOString()}`);
  if (baselineState?.name)
    lines.push(`Baseline: ${baselineState.name}`);
  lines.push('');
  lines.push(`Rows: ${results.length}`);
  lines.push(`Chart update median: ${ms(aggregate.chartUpdate.median)} ms, p95 ${ms(aggregate.chartUpdate.p95)} ms`);
  lines.push(`Raw FPS median: ${ms(aggregate.rawFps.median)}, p95 ${ms(aggregate.rawFps.p95)}`);
  if (speed.count)
    lines.push(`Canvas/WebGPU median speed ratio: ${ms(speed.summary.median)}x across ${speed.count} matched rows`);
  if (baseline.count)
    lines.push(`Baseline diff: ${baseline.regressed} regressed, ${baseline.improved} improved, median ${ms(baseline.pct.median)}%`);
  if (budgeted.length)
    lines.push(`Perf warnings: ${budgeted.length}`);
  lines.push('');
  lines.push(`## Slow or flagged rows`);
  lines.push('');
  lines.push('| Engine | Case | Score ms | Flags | Baseline |');
  lines.push('| --- | --- | ---: | --- | --- |');
  let flagged = results
    .filter(r => r.error || r.baselineComparison?.status == 'regression' || (Array.isArray(r.budgetFlags) && r.budgetFlags.length))
    .slice(0, 80);
  for (let r of flagged) {
    let engine = r.spec?.engineLabel || r.spec?.engineKey || '';
    let title = r.spec?.title || r.spec?.id || '';
    let flags = r.error ? 'error' : (r.budgetFlags || []).join(', ');
    let base = r.baselineComparison ? `${r.baselineComparison.pct > 0 ? '+' : ''}${r.baselineComparison.pct.toFixed(1)}%` : '';
    lines.push(`| ${engine} | ${title.replace(/\|/g, '/')} | ${ms(comparableScore(r))} | ${flags.replace(/\|/g, '/')} | ${base} |`);
  }
  if (flagged.length == 0)
    lines.push('| all | no flagged rows |  |  |  |');
  downloadText(`${safeFilePart(currentRun?.id || 'uplot-webgpu-bench-report')}.md`, 'text/markdown', lines.join('\n'));
}

function frameStatsText(stats) {
  if (!stats)
    return 'pending';
  let verts = (stats.solidVertices || 0) + (stats.imageVertices || 0);
  let kb = (stats.uploadBytes || (stats.solidBytes || 0) + (stats.imageBytes || 0)) / 1024;
  let cpu = Number.isFinite(stats.cpuFrameMs) ? ` / cpu ${ms(stats.cpuFrameMs)} ms` : '';
  let prep = Number.isFinite(stats.prepareMs) ? ` / prep ${ms(stats.prepareMs)} ms` : '';
  let writes = Number.isFinite(stats.writeCalls) ? ` / writes ${stats.writeCalls}` : '';
  let cpuMem = Number.isFinite(stats.retainedCPUBytes) ? ` / cpu mem ${ms(stats.retainedCPUBytes / 1024)} KB` : '';
  let gpuMem = Number.isFinite(stats.retainedGPUBytes) ? ` / gpu mem ${ms(stats.retainedGPUBytes / 1048576)} MB` : '';
  let released = stats.commandsReleased ? ' / commands released' : '';
  return `${verts.toLocaleString()} verts / ${ms(kb)} KB${writes}${cpu}${prep}${cpuMem}${gpuMem}${released}`;
}

function makeX(count, start = 0, step = 1) {
  let x = new Float64Array(count);
  for (let i = 0; i < count; i++)
    x[i] = start + i * step;
  return x;
}

function interpAnchors(i, s, anchorsA, anchorsB, period = 240) {
  let anchors = s == 1 ? anchorsA : anchorsB;
  let u = ((i % period) + period) % period / period;
  let pos = u * (anchors.length - 1);
  let idx = Math.max(0, Math.min(anchors.length - 2, Math.floor(pos)));
  let f = pos - idx;
  let a = anchors[idx];
  let b = anchors[idx + 1];
  return a + (b - a) * f;
}

function waveValue(i, s, variant) {
  let t = i / 20;
  if (variant == 'spline-shape') return interpAnchors(i, s, [8, 34, 18, 46, 20, 30, 52, 22, 44, 36], [45, 22, 26, 12, 38, 16, 50, 31, 48, 20]) + s * 2;
  if (variant == 'catmull-shape') return interpAnchors(i, s, [30, 44, 12, 18, 54, 28, 34, 4, 42, 20, 47], [18, 28, 8, 40, 22, 56, 18, 38, 12, 50, 34]) + s * 4;
  if (variant == 'gradient-strokes') return 42 + Math.sin(i / (24 + s * 5) + s * 0.85) * (12 + s * 2) + Math.cos(i / (57 + s * 8) - s) * 7 + s * 5;
  if (variant == 'trend') return Math.sin(t + s) * 18 + i * 0.018 + s * 14;
  if (variant == 'spike') return Math.sin(t * 0.7 + s) * 12 + (i % 53 == 0 ? 60 : 0) + s * 8;
  if (variant == 'bar') return Math.max(0, Math.sin(t + s) * 18 + 28 + s * 4);
  if (variant == 'flat') return 0;
  if (variant == 'scatter') return Math.sin(t * 1.9 + s) * Math.cos(t * 0.17) * 35 + s * 8;
  if (variant == 'sparse') return i % (s + 4) == 0 ? null : Math.sin(t + s) * 20 + s * 6;
  if (variant == 'missing') return i % 23 == 0 || i % 47 == 0 ? null : Math.sin(t + s) * 20 + s * 6;
  if (variant == 'stepped') return Math.round(Math.sin(t * 0.28 + s) * 8) * 6 + s * 10;
  return Math.sin(t + s) * 20 + Math.cos(i / 9 + s * 0.2) * 4 + s * 9;
}

class DataPool {
  constructor() {
    this.map = new Map();
  }

  key(parts) {
    return JSON.stringify(parts);
  }

  get(parts, factory, reuse) {
    let key = this.key(parts);
    if (reuse && this.map.has(key))
      return this.map.get(key);
    let value = factory();
    if (reuse)
      this.map.set(key, value);
    return value;
  }
}


function anchorVariantData(variant) {
  if (variant == 'spline-shape') {
    return [
      [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
      [10, 36, 20, 48, 22, 32, 54, 24, 46, 38],
      [49, 26, 30, 16, 42, 20, 53, 35, 51, 25],
    ];
  }
  if (variant == 'catmull-shape') {
    return [
      [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
      [34, 48, 16, 22, 58, 32, 38, 8, 46, 24, 50],
      [26, 36, 16, 48, 30, 64, 26, 46, 20, 58, 43],
    ];
  }
  return null;
}

function makeData({points = 240, series = 2, variant = 'line', start = 0, step = 1, nulls = false}) {
  let anchorData = anchorVariantData(variant);
  if (anchorData) {
    let xVals = anchorData[0];
    let data = [Float64Array.from(xVals)];
    for (let s = 1; s <= series; s++) {
      let vals = anchorData[Math.min(s, anchorData.length - 1)];
      data.push(Float64Array.from(vals));
    }
    return data;
  }

  let data = [makeX(points, start, step)];
  if (variant == 'hidden') {
    for (let s = 1; s <= series; s++)
      data.push(Array(points).fill(null));
    return data;
  }
  for (let s = 1; s <= series; s++) {
    let arr = new Float64Array(points);
    let sparse = [];
    for (let i = 0; i < points; i++) {
      let v = waveValue(i + start, s, nulls ? 'missing' : variant);
      if (v == null)
        sparse[i] = null;
      else {
        arr[i] = v;
        sparse[i] = v;
      }
    }
    data.push(nulls || variant == 'sparse' || variant == 'missing' ? sparse : arr);
  }
  return data;
}

function mutateData(data, tick, variant = 'line') {
  let x = data[0];
  for (let i = 0; i < x.length; i++)
    x[i] = tick + i;

  for (let s = 1; s < data.length; s++) {
    let arr = data[s];
    for (let i = 0; i < arr.length; i++) {
      if (arr[i] == null)
        continue;
      arr[i] = waveValue(i + tick, s, variant);
    }
  }
}


function makeBoxScaleData(points) {
  let x = makeX(points);
  let y = new Float64Array(points);
  for (let i = 0; i < points; i++)
    y[i] = 24 + i * 0.12 + Math.sin(i * 0.43) * 4;
  return [x, y];
}

function makeBandData(points) {
  let x = makeX(points);
  let lo = new Float64Array(points);
  let mid = new Float64Array(points);
  let hi = new Float64Array(points);
  for (let i = 0; i < points; i++) {
    let base = Math.sin(i / 18) * 15 + Math.cos(i / 47) * 9;
    mid[i] = base;
    lo[i] = base - 12 - Math.sin(i / 9) * 3;
    hi[i] = base + 12 + Math.cos(i / 11) * 3;
  }
  return [x, lo, mid, hi];
}

function makeTemperatureData(points) {
  let x = makeX(points);
  let lo = new Float64Array(points);
  let avg = new Float64Array(points);
  let hi = new Float64Array(points);
  for (let i = 0; i < points; i++) {
    let t = i / Math.max(1, points - 1);
    let season = 46 + 24 * Math.sin(t * Math.PI * 2 - Math.PI / 2);
    let low = season - 9 - 3 * Math.cos(t * Math.PI * 4);
    let high = season + 9 + 4 * Math.sin(t * Math.PI * 3 + 0.6);
    lo[i] = low;
    avg[i] = season;
    hi[i] = high;
  }
  return [x, lo, avg, hi];
}


function makeLogScaleData(points = 220) {
  let x = makeX(points);
  let a = new Float64Array(points);
  let b = new Float64Array(points);
  let c = new Float64Array(points);
  for (let i = 0; i < points; i++) {
    let t = i / Math.max(1, points - 1);
    a[i] = 0.12 + Math.exp(t * 5.2) * (0.28 + 0.08 * Math.sin(i * 0.17));
    b[i] = 0.08 + Math.exp(t * 3.8) * (0.45 + 0.10 * Math.cos(i * 0.11 + 1.2));
    c[i] = 0.16 + Math.exp(t * 4.5) * (0.20 + 0.06 * Math.sin(i * 0.23 + 0.8));
  }
  return [x, a, b, c];
}

function makeDualAxisData(points = 260) {
  let x = makeX(points);
  let visits = new Float64Array(points);
  let latency = new Float64Array(points);
  for (let i = 0; i < points; i++) {
    visits[i] = 180 + Math.sin(i / 18) * 52 + Math.cos(i / 41) * 26 + (hash01(i, 71) - 0.5) * 12;
    latency[i] = 38 + Math.sin(i / 25 + 1.4) * 10 + Math.cos(i / 9) * 3 + (hash01(i, 77) - 0.5) * 4;
  }
  return [x, visits, latency];
}

function makeArcsinhScaleData(points = 260) {
  let x = makeX(points);
  let a = new Float64Array(points);
  let b = new Float64Array(points);
  for (let i = 0; i < points; i++) {
    let t = (i / Math.max(1, points - 1) - 0.5) * 2;
    let envelope = Math.pow(Math.abs(t), 1.65) * 900;
    a[i] = Math.sign(t) * envelope + Math.sin(i / 9) * 48;
    b[i] = Math.sin(t * Math.PI * 2.7) * 180 + Math.sign(Math.sin(i / 23)) * Math.pow(Math.abs(Math.sin(i / 31)), 2.2) * 520;
  }
  return [x, a, b];
}

function makeDependentScaleData(points = 260) {
  let x = makeX(points);
  let dollars = new Float64Array(points);
  let normalized = new Float64Array(points);
  for (let i = 0; i < points; i++) {
    let v = 120 + Math.sin(i / 17) * 42 + Math.cos(i / 39) * 18 + (hash01(i, 91) - 0.5) * 8;
    dollars[i] = v;
    normalized[i] = v / 2;
  }
  return [x, dollars, normalized];
}

function makeCustomScaleData(points = 240) {
  let x = makeX(points);
  let a = new Float64Array(points);
  let b = new Float64Array(points);
  for (let i = 0; i < points; i++) {
    let t = i / Math.max(1, points - 1);
    a[i] = 4 + Math.pow(t * 18, 2) + Math.sin(i / 12) * 12;
    b[i] = 9 + Math.pow(t * 13, 2) + Math.cos(i / 15 + 1.2) * 9;
  }
  return [x, a, b];
}

function makeTimeDstData(points = 180) {
  let start = Date.UTC(2024, 1, 1) / 1000;
  let day = 86400;
  let x = new Float64Array(points);
  let a = new Float64Array(points);
  let b = new Float64Array(points);
  for (let i = 0; i < points; i++) {
    x[i] = start + i * day;
    let t = i / Math.max(1, points - 1);
    a[i] = 30 + Math.sin(t * Math.PI * 4 - 0.5) * 18 + Math.cos(i / 11) * 4;
    b[i] = 24 + Math.cos(t * Math.PI * 3 + 0.8) * 14 + Math.sin(i / 7) * 3;
  }
  return [x, a, b];
}

function makeStackedSeriesData(points = 180) {
  let x = makeX(points);
  let a = new Float64Array(points);
  let b = new Float64Array(points);
  let c = new Float64Array(points);
  for (let i = 0; i < points; i++) {
    a[i] = 18 + Math.max(0, Math.sin(i / 19) * 8 + Math.cos(i / 37) * 5);
    b[i] = a[i] + 15 + Math.max(0, Math.sin(i / 23 + 1.2) * 9);
    c[i] = b[i] + 12 + Math.max(0, Math.cos(i / 29 + 0.7) * 7);
  }
  return [x, a, b, c];
}

function makeSoftMinMaxData(points = 220) {
  let x = makeX(points);
  let y = new Float64Array(points);
  let shifted = new Float64Array(points);
  for (let i = 0; i < points; i++) {
    let v = 50 + Math.sin(i / 18) * 16 + Math.cos(i / 41) * 7 + (hash01(i, 143) - 0.5) * 3;
    y[i] = v;
    shifted[i] = v + 18;
  }
  return [x, y, shifted];
}

function makeAlignedGappedData(points = 260) {
  let x = makeX(points);
  let a = new Array(points);
  let b = new Array(points);
  let c = new Array(points);
  for (let i = 0; i < points; i++) {
    let base = Math.sin(i / 16) * 16 + Math.cos(i / 31) * 8 + 40;
    a[i] = i % 41 < 7 ? null : base;
    b[i] = i % 53 < 10 ? null : base + Math.sin(i / 9) * 8 + 12;
    c[i] = i % 37 < 5 ? null : base - Math.cos(i / 11) * 6 - 10;
  }
  return [x, a, b, c];
}

function makeWindDirectionData(points = 96) {
  let x = makeX(points);
  let speed = new Float64Array(points);
  let direction = new Float64Array(points);
  for (let i = 0; i < points; i++) {
    speed[i] = 12 + Math.sin(i / 8) * 7 + Math.cos(i / 17) * 4;
    direction[i] = (i * 19 + Math.sin(i / 7) * 45 + 360) % 360;
  }
  return [x, speed, direction];
}

function makeMassSpectrumData(points = 220) {
  let x = new Float64Array(points);
  let y = new Float64Array(points);
  for (let i = 0; i < points; i++) {
    x[i] = 50 + i * 1.35;
    let peak = 0;
    for (let center of [72, 118, 151, 203, 287]) {
      let d = x[i] - center;
      peak += Math.exp(-(d * d) / (2 * 7.5 * 7.5)) * (38 + (center % 5) * 9);
    }
    y[i] = peak + (hash01(i, 117) - 0.5) * 4;
  }
  return [x, y];
}

function makeNoData() {
  return [[], []];
}

function hash01(i, seed = 1) {
  let x = Math.sin(i * 127.1 + seed * 311.7) * 43758.5453123;
  return x - Math.floor(x);
}

function makeHourlyUsersData(points = 32768) {
  let x = new Float64Array(points);
  let y2019 = new Float64Array(points);
  let y2018 = new Float64Array(points);
  let y2017 = new Float64Array(points);
  let days = 12;

  for (let i = 0; i < points; i++) {
    let t = i / Math.max(1, points - 1);
    let dayTime = (t * days) % 1;
    let day = Math.floor(t * days);
    let rush = Math.pow(Math.max(0, Math.sin(dayTime * Math.PI)), 1.7);
    let nightDip = Math.pow(Math.max(0, Math.sin((dayTime - 0.16) * Math.PI * 2)), 2) * 8;
    let week = 0.86 + 0.22 * Math.sin(day * 0.95 + 0.2);
    let noiseA = (hash01(i, 11) - 0.5) * 13;
    let noiseB = (hash01(i, 17) - 0.5) * 11;
    let noiseC = (hash01(i, 23) - 0.5) * 15;
    let spikeA = hash01(i, 31) > 0.993 ? 18 + hash01(i, 32) * 30 : 0;
    let spikeB = hash01(i, 41) > 0.996 ? 12 + hash01(i, 42) * 25 : 0;
    let spikeC = hash01(i, 51) > 0.992 ? 15 + hash01(i, 52) * 35 : 0;

    x[i] = t * days;
    y2019[i] = Math.max(0, 6 + rush * 34 * week - nightDip + noiseA + spikeA);
    y2018[i] = Math.max(0, 8 + rush * 28 * (0.94 + 0.13 * Math.sin(day * 0.7)) - nightDip * 0.65 + noiseB + spikeB);
    y2017[i] = Math.max(0, 10 + rush * 38 * (0.88 + 0.2 * Math.cos(day * 0.55)) - nightDip * 0.45 + noiseC + spikeC);
  }

  return [x, y2019, y2018, y2017];
}

function makeOhlcData(points) {
  let x = makeX(points);
  let open = new Float64Array(points);
  let high = new Float64Array(points);
  let low = new Float64Array(points);
  let close = new Float64Array(points);
  let prev = 1350;
  for (let i = 0; i < points; i++) {
    let drift = Math.sin(i / 8) * 6 + Math.cos(i / 21) * 10;
    open[i] = prev;
    close[i] = prev + drift;
    high[i] = Math.max(open[i], close[i]) + 10 + Math.sin(i) * 3;
    low[i] = Math.min(open[i], close[i]) - 10 - Math.cos(i) * 3;
    prev = close[i];
  }
  return [x, open, high, low, close];
}

function axisLabelsForSpec(spec) {
  if (spec.axesShow === false)
    return [null, null];
  if (spec.axisLabels)
    return spec.axisLabels;

  switch (spec.id) {
    case 'visual:events-spikes':
      return ['time', 'load / MB'];
    case 'visual:cursor-focus':
      return ['x position', 'value'];
    case 'visual:trendlines':
      return ['sample', 'score'];
    case 'visual:hourly-users':
      return ['day', 'users'];
    case 'visual:temperature-range':
      return ['day of year', 'temperature °F'];
    case 'visual:candlestick':
      return ['day', 'gold price USD'];
    case 'visual:heatmap':
      return ['time bin', 'latency ms'];
    case 'visual:line':
      return ['sample', 'styled value'];
    case 'visual:dash-palette':
      return ['sample', 'dash style value'];
    case 'visual:stacked-areas':
      return ['sample', 'layer value'];
    case 'visual:log-scale':
      return ['sample', 'log value'];
    case 'visual:arcsinh-scale':
      return ['sample', 'signed arcsinh value'];
    case 'visual:custom-scale':
      return ['sample', 'sqrt-transformed value'];
    case 'visual:dependent-scale':
      return ['sample', 'base / dependent scale'];
    case 'visual:time-dst':
      return ['date', 'seasonal metric'];
    case 'visual:dual-axis':
      return ['sample', 'visits / latency'];
    case 'visual:threshold-zones':
      return ['sample', 'threshold score'];
    case 'visual:wheel-zoom':
      return ['wheel x/y zoom', 'value'];
    case 'visual:y-scale-drag':
      return ['sample', 'draggable y value'];
    case 'visual:sparse-nearest':
      return ['sample', 'sparse nearest value'];
    case 'visual:scales-dir-ori-matrix':
      return ['orientation x', 'orientation y'];
    case 'visual:fill-stroke-clip-pathology':
      return ['path x', 'path y'];
    case 'visual:bar-stack-values':
      return ['group', 'stacked value'];
    case 'visual:soft-minmax-shift':
      return ['sample', 'soft range'];
    case 'visual:alignment-gap-clip':
      return ['aligned x', 'gapped value'];
    case 'visual:wind-direction':
      return ['sample', 'speed / direction'];
    case 'visual:touch-zoom':
      return ['touch x/y zoom', 'value'];
    case 'visual:readback-composite':
      return ['api x', 'api y'];
    case 'visual:axis-scale-compat':
      return ['axis sample', 'axis value'];
    case 'visual:cursor-bind-snap':
      return ['bound cursor x', 'snap value'];
    case 'visual:sync-ranger':
      return ['sync sample', 'sync value'];
    case 'visual:time-localized-discrete':
      return ['date', 'localized/discrete'];
    case 'visual:image-clip-gradient':
      return ['api x', 'api y'];
    case 'visual:dynamic-series':
      return ['sample', 'dynamic value'];
    case 'visual:stacked-series':
      return ['sample', 'stacked total'];
    case 'visual:bar-stroke-fill':
      return ['category', 'bar style'];
    case 'visual:mass-spectrum':
      return ['m/z', 'intensity'];
    case 'visual:no-data':
      return ['x', 'y'];
    case 'visual:annotations':
      return ['sample', 'annotated value'];
    case 'visual:drag-zoom':
      return ['drag x to zoom', 'zoom value'];
    case 'worker:live-circular':
      return ['rotating sample', 'signal'];
    case 'visual:canvas-api-coverage':
      return ['api x', 'api y'];
    case 'visual:text-image-composite':
      return ['api x', 'api y'];
    case 'visual:area-gradient':
      return ['sample', 'area value'];
    case 'visual:bands':
      return ['sample', 'range'];
    case 'visual:bars':
    case 'visual:grouped-bars':
      return ['category', 'amount'];
    case 'visual:scatter':
      return ['x value', 'y value'];
    case 'visual:missing':
      return ['sample', 'value'];
    case 'visual:plugin-facade':
      return ['x position', 'value'];
    default:
      if (spec.kind == 'ohlc')
        return ['x', 'price'];
      if (spec.kind == 'heatmap')
        return ['x bin', 'y bin'];
      if (spec.kind == 'bars')
        return ['category', 'value'];
      if (spec.kind == 'points')
        return ['x', 'y'];
      if (spec.kind == 'bands')
        return ['x', 'range'];
      return ['x', 'value'];
  }
}

function selectZoomEnabled(spec) {
  if (!spec || spec.mouse === false || spec.axesShow === false)
    return false;
  if (spec.selectZoom === false)
    return false;
  return spec.selectZoom === true || spec.dragZoom === true || spec.visualTitle != null || spec.id?.startsWith?.('visual:');
}

function lowerBoundNumeric(values, target) {
  let lo = 0;
  let hi = values?.length || 0;
  while (lo < hi) {
    let mid = (lo + hi) >> 1;
    if (Number(values[mid]) < target)
      lo = mid + 1;
    else
      hi = mid;
  }
  return lo;
}

function cloneWindowArray(values, start, end, step = 1) {
  let len = Math.max(0, Math.ceil((end - start) / Math.max(1, step)));
  if (ArrayBuffer.isView(values)) {
    if (step === 1)
      return values.slice(start, end);
    let out = new values.constructor(len);
    let j = 0;
    for (let i = start; i < end && j < len; i += step)
      out[j++] = values[i];
    return j === len ? out : out.slice(0, j);
  }
  let out = new Array(len);
  let j = 0;
  for (let i = start; i < end && j < len; i += step)
    out[j++] = values[i];
  out.length = j;
  return out;
}

function windowDataByXRange(sourceData, min, max, maxPoints = 6000) {
  let xs = sourceData?.[0];
  if (!xs?.length || !Number.isFinite(min) || !Number.isFinite(max) || max <= min)
    return sourceData;

  let n = xs.length;
  let lo = Math.max(0, lowerBoundNumeric(xs, min) - 2);
  let hi = Math.min(n, lowerBoundNumeric(xs, max) + 3);
  if (hi <= lo)
    return sourceData;

  let count = hi - lo;
  let step = Math.max(1, Math.ceil(count / Math.max(64, maxPoints)));
  let view = [];
  for (let s = 0; s < sourceData.length; s++)
    view.push(cloneWindowArray(sourceData[s], lo, hi, step));

  return view;
}

function findYScaleKeys(u) {
  let keys = new Set();
  let series = u.series || [];
  for (let i = 1; i < series.length; i++) {
    let key = series[i]?.scale || 'y';
    if (key)
      keys.add(key);
  }
  if (!keys.size)
    keys.add('y');
  return Array.from(keys);
}

function dataRangeForScale(u, data, scaleKey = 'y') {
  let min = Infinity;
  let max = -Infinity;
  let series = u.series || [];
  for (let i = 1; i < data.length; i++) {
    let s = series[i] || {};
    let key = s.scale || 'y';
    if (key !== scaleKey)
      continue;
    let values = data[i];
    if (!values)
      continue;
    for (let j = 0; j < values.length; j++) {
      let v = Number(values[j]);
      if (!Number.isFinite(v))
        continue;
      if (v < min)
        min = v;
      if (v > max)
        max = v;
    }
  }
  if (!Number.isFinite(min) || !Number.isFinite(max))
    return null;
  if (min === max) {
    min -= 1;
    max += 1;
  }
  let pad = (max - min) * 0.06;
  return {min: min - pad, max: max + pad};
}

function installLargeDataZoomWindow(u, spec, originalData) {
  let data = spec.largeDataZoomSourceData || originalData || u.data;
  let xs = data?.[0];
  if (!xs?.length)
    return null;

  let fullMin = Number(xs[0]);
  let fullMax = Number(xs[xs.length - 1]);
  if (!Number.isFinite(fullMin) || !Number.isFinite(fullMax) || fullMax <= fullMin)
    return null;

  let initialScales = {};
  for (let key of Object.keys(u.scales || {})) {
    initialScales[key] = {min: u.scales[key]?.min, max: u.scales[key]?.max};
  }

  let maxPoints = spec.largeDataZoomMaxPoints || 4500;
  let applyWindow = (min, max, yRanges = null) => {
    min = Math.max(fullMin, Math.min(fullMax, min));
    max = Math.max(fullMin, Math.min(fullMax, max));
    if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min)
      return;

    let next = windowDataByXRange(data, min, max, maxPoints);
    let nextXs = next?.[0];
    if (!nextXs?.length)
      return;

    let update = () => {
      u.setData(next, false);
      u.setScale('x', {min, max});

      for (let key of findYScaleKeys(u)) {
        let requested = yRanges?.[key];
        if (requested && Number.isFinite(requested.min) && Number.isFinite(requested.max) && requested.max > requested.min) {
          u.setScale(key, requested);
          continue;
        }
        let range = dataRangeForScale(u, next, key);
        if (range)
          u.setScale(key, range);
      }
    };

    if (typeof u.batch == 'function')
      u.batch(update, true);
    else
      update();
  };

  let setWindow = (min, max, yRanges = null) => {
    applyWindow(min, max, yRanges);
  };

  let reset = () => {
    let min = Number.isFinite(initialScales.x?.min) ? initialScales.x.min : fullMin;
    let max = Number.isFinite(initialScales.x?.max) ? initialScales.x.max : fullMax;
    let yRanges = {};

    for (let key of findYScaleKeys(u)) {
      let initial = initialScales[key];
      if (initial && Number.isFinite(initial.min) && Number.isFinite(initial.max))
        yRanges[key] = {min: initial.min, max: initial.max};
    }

    applyWindow(min, max, yRanges);
  };

  return {setWindow, reset, fullMin, fullMax, data};
}

function makeSelectZoomPlugin(spec = {}) {
  let cleanup = new WeakMap();

  return {
    hooks: {
      ready: [u => {
        let originalData = u.data;
        let largeWindow = spec.largeDataZoom ? installLargeDataZoomWindow(u, spec, originalData) : null;
        let xs = originalData?.[0];
        let xScale = u.scales?.x || {};
        let firstX = xs?.length ? Number(xs[0]) : xScale.min;
        let lastX = xs?.length ? Number(xs[xs.length - 1]) : xScale.max;
        let initial = Number.isFinite(firstX) && Number.isFinite(lastX)
          ? {min: firstX, max: lastX}
          : {min: xScale.min, max: xScale.max};

        let reset = () => {
          if (largeWindow) {
            largeWindow.reset();
            return;
          }

          if (Number.isFinite(initial.min) && Number.isFinite(initial.max))
            u.setScale('x', {min: initial.min, max: initial.max});
          else
            u.setScale('x', {min: null, max: null});
        };

        u.root?.addEventListener?.('dblclick', reset);

        let removers = [() => u.root?.removeEventListener?.('dblclick', reset)];

        if (spec.largeDataZoom && u.over) {
          let dragStart = null;
          let select = document.createElement('div');
          select.className = 'bench-manual-select';
          select.style.position = 'absolute';
          select.style.border = '1px solid rgba(39,110,241,0.72)';
          select.style.background = 'rgba(39,110,241,0.12)';
          select.style.pointerEvents = 'none';
          select.style.display = 'none';
          u.over.appendChild(select);

          let pointFromEvent = event => {
            let rect = u.over.getBoundingClientRect();
            let x = Math.max(0, Math.min(1, (event.clientX - rect.left) / Math.max(1, rect.width)));
            let y = Math.max(0, Math.min(1, (event.clientY - rect.top) / Math.max(1, rect.height)));
            return {x, y};
          };
          let valFromXFrac = frac => {
            let scale = u.scales?.x || {};
            let min = Number(scale.min);
            let max = Number(scale.max);
            return Number.isFinite(min) && Number.isFinite(max) ? min + frac * (max - min) : NaN;
          };
          let valFromYFrac = (frac, scaleKey = 'y') => {
            let scale = u.scales?.[scaleKey] || u.scales?.y || {};
            let min = Number(scale.min);
            let max = Number(scale.max);
            return Number.isFinite(min) && Number.isFinite(max) ? max - frac * (max - min) : NaN;
          };
          let drawSelect = (a, b) => {
            let left = Math.min(a.x, b.x);
            let right = Math.max(a.x, b.x);
            let top = Math.min(a.y, b.y);
            let bottom = Math.max(a.y, b.y);
            select.style.left = `${left * 100}%`;
            select.style.top = `${top * 100}%`;
            select.style.width = `${Math.max(0, right - left) * 100}%`;
            select.style.height = `${Math.max(0, bottom - top) * 100}%`;
          };
          let down = event => {
            if (event.button != null && event.button !== 0)
              return;
            dragStart = pointFromEvent(event);
            u.over.setPointerCapture?.(event.pointerId);
            select.style.display = 'block';
            drawSelect(dragStart, dragStart);
            event.preventDefault?.();
          };
          let move = event => {
            if (dragStart == null)
              return;
            drawSelect(dragStart, pointFromEvent(event));
            event.preventDefault?.();
          };
          let up = event => {
            if (dragStart == null)
              return;
            let cur = pointFromEvent(event);
            let a = dragStart;
            dragStart = null;
            select.style.display = 'none';

            let xLo = Math.min(a.x, cur.x);
            let xHi = Math.max(a.x, cur.x);
            let yLo = Math.min(a.y, cur.y);
            let yHi = Math.max(a.y, cur.y);
            let hasX = xHi - xLo > 0.012;
            let hasY = yHi - yLo > 0.012;
            if (!hasX && !hasY)
              return;

            let min = hasX ? valFromXFrac(xLo) : u.scales?.x?.min;
            let max = hasX ? valFromXFrac(xHi) : u.scales?.x?.max;
            let yRanges = null;
            if (hasY) {
              yRanges = {};
              for (let key of findYScaleKeys(u)) {
                let yMax = valFromYFrac(yLo, key);
                let yMin = valFromYFrac(yHi, key);
                if (Number.isFinite(yMin) && Number.isFinite(yMax) && yMax > yMin)
                  yRanges[key] = {min: yMin, max: yMax};
              }
            }

            if (Number.isFinite(min) && Number.isFinite(max) && max > min) {
              if (largeWindow)
                largeWindow.setWindow(min, max, yRanges);
              else {
                u.setScale('x', {min, max});
                if (yRanges) {
                  for (let [key, range] of Object.entries(yRanges))
                    u.setScale(key, range);
                }
              }
            }
          };
          let cancel = () => {
            dragStart = null;
            select.style.display = 'none';
          };
          u.over.addEventListener('pointerdown', down);
          u.over.addEventListener('pointermove', move);
          u.over.addEventListener('pointerup', up);
          u.over.addEventListener('pointercancel', cancel);
          removers.push(() => {
            u.over.removeEventListener('pointerdown', down);
            u.over.removeEventListener('pointermove', move);
            u.over.removeEventListener('pointerup', up);
            u.over.removeEventListener('pointercancel', cancel);
            select.remove();
          });
        }

        cleanup.set(u, removers);
      }],
      destroy: [u => {
        let removers = cleanup.get(u) || [];
        for (let remove of removers) {
          try { remove(); }
          catch (err) {}
        }
        cleanup.delete(u);
      }],
    },
  };
}

function makeBaseOpts(uPlot, spec, width, height) {
  let series = [{label: 'x'}];
  for (let i = 1; i <= spec.series; i++) {
    let hidden = !!spec.hideSeries;
    let keepHiddenSeries = hidden && !!spec.keepHiddenSeries;
    let s = {
      label: `s${i}`,
      show: hidden ? keepHiddenSeries : true,
      stroke: hidden ? 'rgba(0,0,0,0)' : SERIES_COLORS[(i - 1) % SERIES_COLORS.length],
      width: hidden ? 0 : (spec.width ?? 1.5),
      points: {show: !hidden && !!spec.showPoints, size: spec.showPoints ? 4 : 0},
    };

    let style = spec.seriesStyles?.[i - 1];
    if (style) {
      if (style.label != null)
        s.label = style.label;
      if (style.stroke != null)
        s.stroke = style.stroke;
      if (style.width != null)
        s.width = style.width;
      if (style.dash)
        s.dash = style.dash;
      if (style.points)
        s.points = {...s.points, ...style.points};
      if (style.fill != null)
        s.fill = style.fill;
      if (style.scale != null)
        s.scale = style.scale;
    }

    if (spec.strokeGradient && !hidden) {
      s.stroke = u => {
        let {left, top, width, height} = u.bbox;
        let grad = u.ctx.createLinearGradient(left, top + height, left + width, top);
        grad.addColorStop(0, SERIES_COLORS[(i - 1) % SERIES_COLORS.length]);
        grad.addColorStop(0.55, '#f59e0b');
        grad.addColorStop(1, SERIES_COLORS[i % SERIES_COLORS.length]);
        return grad;
      };
    }

    if (spec.fill) {
      if (spec.gradientFill && !hidden) {
        s.fill = u => {
          let {left, top, height} = u.bbox;
          let grad = u.ctx.createLinearGradient(left, top, left, top + height);
          grad.addColorStop(0, `rgba(${44 + i * 26}, ${116 + i * 12}, 241, 0.34)`);
          grad.addColorStop(0.62, `rgba(${44 + i * 26}, ${116 + i * 12}, 241, 0.16)`);
          grad.addColorStop(1, 'rgba(39, 110, 241, 0.02)');
          return grad;
        };
      }
      else {
        s.fill = `rgba(${40 + i * 23}, ${90 + i * 17}, ${170 - i * 9}, 0.18)`;
      }
    }
    if (spec.dash)
      s.dash = [8, 5];
    if (spec.stepped && uPlot.paths?.stepped)
      s.paths = uPlot.paths.stepped({align: 1});
    if (spec.spline && uPlot.paths?.spline)
      s.paths = uPlot.paths.spline();
    if (spec.spline2 && uPlot.paths?.spline2)
      s.paths = uPlot.paths.spline2();
    if (spec.bars && uPlot.paths?.bars)
      s.paths = uPlot.paths.bars({size: spec.barSize || [0.72, Infinity, 1], align: spec.barAlign ?? 0, radius: spec.roundRadius ?? (spec.rounded ? 0.10 : 0)});

    series.push(s);
  }

  let [xAxisLabel, yAxisLabel] = axisLabelsForSpec(spec);
  let showAxes = spec.axesShow !== false;
  let axisGrid = {show: spec.grid !== false};

  return {
    title: spec.chartTitle === false ? null : (spec.chartTitle || spec.visualTitle || spec.title),
    width,
    height,
    pxAlign: 1,
    scales: spec.scales || {x: {time: false}},
    axes: spec.axes || [
      {show: showAxes, grid: axisGrid, label: showAxes ? xAxisLabel : null, labelGap: 4, labelSize: xAxisLabel ? 28 : 0},
      {show: showAxes, grid: axisGrid, label: showAxes ? yAxisLabel : null, labelGap: 6, labelSize: yAxisLabel ? 34 : 0},
    ],
    legend: {show: spec.nativeLegend === true, live: true},
    cursor: spec.cursor ?? (spec.mouse === false
      ? {show: false, drag: {setScale: false, x: false, y: false}}
      : {show: true, drag: {
        setScale: selectZoomEnabled(spec) && !spec.largeDataZoom,
        x: selectZoomEnabled(spec) && !spec.largeDataZoom,
        y: selectZoomEnabled(spec) && !spec.largeDataZoom && spec.dragZoomY !== false,
      }}),
    select: {show: selectZoomEnabled(spec) && !spec.largeDataZoom},
    series,
    bands: spec.bands,
    hooks: selectZoomEnabled(spec) ? mergeHooks(spec.hooks || {}, makeSelectZoomPlugin(spec).hooks) : (spec.hooks || {}),
    plugins: spec.plugins || [],
  };
}

function mergeHooks(...sets) {
  let out = {};
  for (let set of sets) {
    if (!set)
      continue;
    for (let [name, handlers] of Object.entries(set)) {
      if (!out[name])
        out[name] = [];
      out[name].push(...handlers);
    }
  }
  return out;
}

function pluginDrawCase() {
  return {
    hooks: {
      draw: [u => {
        let ctx = u.ctx;
        let {left, top, width, height} = u.bbox;
        ctx.save();
        ctx.globalAlpha = 0.16;
        ctx.fillStyle = 'rgba(255, 180, 0, 0.35)';
        ctx.beginPath();
        ctx.roundRect(left + width * 0.18, top + height * 0.18, width * 0.22, height * 0.42, 8);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.strokeStyle = 'rgba(20,20,20,0.35)';
        ctx.lineWidth = 1;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.moveTo(left + width * 0.62, top);
        ctx.lineTo(left + width * 0.62, top + height);
        ctx.stroke();
        ctx.restore();
      }],
    },
  };
}

function facadePluginCase() {
  return overlayCanvasPlugin((u, ctx) => {
    let {left, top, width, height} = u.bbox;
    let panelX = left + width * 0.14;
    let panelY = top + height * 0.16;
    let panelW = width * 0.72;
    let panelH = height * 0.66;

    ctx.save();
    ctx.beginPath();
    ctx.rect(left, top, width, height);
    ctx.clip();

    ctx.fillStyle = 'rgba(39,110,241,0.14)';
    ctx.fillRect(panelX, panelY, panelW * 0.54, panelH);
    ctx.fillStyle = 'rgba(228,87,46,0.13)';
    ctx.fillRect(panelX + panelW * 0.42, panelY, panelW * 0.58, panelH);

    ctx.strokeStyle = 'rgba(20,20,20,0.42)';
    ctx.lineWidth = 1.8;
    ctx.setLineDash([8, 4, 2, 4]);
    ctx.beginPath();
    ctx.moveTo(left + width * 0.16, top + height * 0.72);
    ctx.bezierCurveTo(left + width * 0.32, top + height * 0.20, left + width * 0.60, top + height * 0.95, left + width * 0.88, top + height * 0.28);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = 'rgba(10,10,10,0.70)';
    ctx.font = `${Math.max(13, Math.round(height * 0.062))}px system-ui, sans-serif`;
    ctx.textBaseline = 'middle';
    ctx.fillText('facade', left + width * 0.06, top + height * 0.30);
    ctx.restore();
  });
}



function sparklineGridPlugin() {
  const labels = ['AAPL', 'MSFT', 'AMD', 'QCOM', 'AMZN', 'SBUX', 'CSCO', 'TSLA'];
  return overlayCanvasPlugin((u, ctx) => {
    let {left, top, width, height} = u.bbox;
    let cols = 2;
    let rows = Math.ceil(labels.length / cols);
    let cellW = width / cols;
    let cellH = height / rows;

    ctx.save();
    ctx.beginPath();
    ctx.rect(left, top, width, height);
    ctx.clip();
    ctx.font = `${Math.max(12, Math.round(cellH * 0.22))}px system-ui, sans-serif`;
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    for (let i = 0; i < labels.length; i++) {
      let col = i % cols;
      let row = Math.floor(i / cols);
      let x0 = left + col * cellW;
      let y0 = top + row * cellH;
      let labelX = x0 + cellW * 0.045;
      let chartX = x0 + cellW * 0.28;
      let chartY = y0 + cellH * 0.14;
      let chartW = cellW * 0.66;
      let chartH = cellH * 0.68;
      let baseY = chartY + chartH;
      let pts = [];
      for (let j = 0; j < 72; j++) {
        let t = j / 71;
        let wave = 0.54 - 0.26 * Math.sin(t * Math.PI * 2.0 + i * 0.55) - 0.11 * Math.cos(t * Math.PI * 3.2 + i * 0.65);
        let px = chartX + chartW * t;
        let py = chartY + chartH * Math.max(0.06, Math.min(0.94, wave));
        pts.push([px, py]);
      }

      ctx.fillStyle = 'rgba(91, 182, 234, 0.22)';
      fillAreaWithStrips(ctx, pts, baseY, ctx.fillStyle);

      ctx.strokeStyle = '#8ed0ff';
      ctx.lineWidth = 1.7;
      ctx.beginPath();
      for (let j = 0; j < pts.length; j++) {
        let [px, py] = pts[j];
        if (j == 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();

      ctx.fillStyle = 'rgba(20,20,20,0.84)';
      ctx.fillText(labels[i], labelX, y0 + cellH * 0.50);
    }

    ctx.restore();
  });
}


function heatmapPlugin({cols = 32, rows = 18, alpha = 0.72} = {}) {
  return {
    hooks: {
      drawClear: [u => {
        let ctx = u.ctx;
        let {left, top, width, height} = u.bbox;
        let cellW = width / cols;
        let cellH = height / rows;
        ctx.save();
        ctx.beginPath();
        ctx.rect(left, top, width, height);
        ctx.clip();
        ctx.fillStyle = 'rgba(26, 31, 38, 0.88)';
        ctx.fillRect(left, top, width, height);
        for (let y = 0; y < rows; y++) {
          for (let x = 0; x < cols; x++) {
            let wave = 0.5 + 0.5 * Math.sin(x * 0.42 + y * 0.70);
            let ridge = 0.5 + 0.5 * Math.cos((x - cols * 0.62) * 0.28);
            let hot = Math.max(0, Math.min(1, wave * 0.58 + ridge * 0.42));
            let r = Math.round(70 + hot * 190);
            let g = Math.round(42 + hot * 82);
            let b = Math.round(34 + hot * 22);
            ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${0.16 + hot * alpha})`;
            ctx.fillRect(left + x * cellW, top + y * cellH, cellW + 1, cellH + 1);
          }
        }
        ctx.restore();
      }],
    },
  };
}

function trendlinePlugin() {
  return overlayCanvasPlugin((u, ctx) => {
    let {left, top, width, height} = u.bbox;
    ctx.save();
    ctx.beginPath();
    ctx.rect(left, top, width, height);
    ctx.clip();
    ctx.lineWidth = 3.0;
    ctx.lineCap = 'round';
    ctx.setLineDash([12, 8]);

    ctx.strokeStyle = 'rgba(39, 110, 241, 0.72)';
    ctx.beginPath();
    ctx.moveTo(left, top + height * 0.64);
    ctx.lineTo(left + width, top + height * 0.22);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(228, 87, 46, 0.72)';
    ctx.beginPath();
    ctx.moveTo(left, top + height * 0.28);
    ctx.lineTo(left + width, top + height * 0.72);
    ctx.stroke();
    ctx.restore();
  });
}

function dragZoomResetPlugin() {
  let cleanup = new WeakMap();
  return {
    hooks: {
      ready: [u => {
        let full = {
          x: {...u.scales.x},
          y: {...u.scales.y},
        };
        let reset = () => {
          if (Number.isFinite(full.x.min) && Number.isFinite(full.x.max))
            u.setScale('x', {min: full.x.min, max: full.x.max});
          if (Number.isFinite(full.y.min) && Number.isFinite(full.y.max))
            u.setScale('y', {min: full.y.min, max: full.y.max});
        };
        u.over?.addEventListener?.('dblclick', reset);
        cleanup.set(u, reset);
      }],
      destroy: [u => {
        let reset = cleanup.get(u);
        if (reset)
          u.over?.removeEventListener?.('dblclick', reset);
        cleanup.delete(u);
      }],
    },
  };
}

function cursorFocusPlugin() {
  return overlayCanvasPlugin((u, ctx) => {
    let {left, top, width, height} = u.bbox;
    ctx.save();
    ctx.beginPath();
    ctx.rect(left, top, width, height);
    ctx.clip();
    ctx.fillStyle = 'rgba(39, 110, 241, 0.11)';
    ctx.fillRect(left + width * 0.42, top, width * 0.24, height);
    ctx.restore();
  });
}




function thresholdZonesPlugin() {
  return overlayCanvasPlugin((u, ctx) => {
    let {left, top, width, height} = u.bbox;
    let zones = [
      {lo: 0.00, hi: 0.33, fill: 'rgba(35,164,85,0.10)', label: 'safe'},
      {lo: 0.33, hi: 0.66, fill: 'rgba(245,158,11,0.12)', label: 'watch'},
      {lo: 0.66, hi: 1.00, fill: 'rgba(228,87,46,0.10)', label: 'alert'},
    ];

    ctx.save();
    ctx.beginPath();
    ctx.rect(left, top, width, height);
    ctx.clip();

    ctx.font = `${Math.max(11, Math.round(height * 0.045))}px system-ui, sans-serif`;
    ctx.textBaseline = 'middle';
    for (let zone of zones) {
      let y0 = top + height * (1 - zone.hi);
      let y1 = top + height * (1 - zone.lo);
      ctx.fillStyle = zone.fill;
      ctx.fillRect(left, y0, width, y1 - y0);
      ctx.fillStyle = 'rgba(20,20,20,0.42)';
      ctx.fillText(zone.label, left + 8, (y0 + y1) / 2);
    }

    ctx.strokeStyle = 'rgba(20,20,20,0.34)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([7, 5]);
    for (let frac of [0.33, 0.66]) {
      let y = top + height * (1 - frac);
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(left + width, y);
      ctx.stroke();
    }
    ctx.restore();
  });
}

function annotationCalloutsPlugin() {
  return overlayCanvasPlugin((u, ctx) => {
    let {left, top, width, height} = u.bbox;
    let callouts = [
      {x: 0.18, y: 0.34, label: 'deploy', color: '#276ef1'},
      {x: 0.52, y: 0.24, label: 'spike', color: '#e4572e'},
      {x: 0.78, y: 0.60, label: 'recovery', color: '#23a455'},
    ];

    ctx.save();
    ctx.beginPath();
    ctx.rect(left, top, width, height);
    ctx.clip();
    ctx.font = `${Math.max(12, Math.round(height * 0.052))}px system-ui, sans-serif`;
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    for (let item of callouts) {
      let x = left + width * item.x;
      let y = top + height * item.y;
      ctx.strokeStyle = item.color;
      ctx.fillStyle = item.color;
      ctx.lineWidth = 2.0;
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.fill();

      let labelX = Math.min(left + width - 92, x + 16);
      let labelY = Math.max(top + 18, y - 28);
      ctx.beginPath();
      ctx.moveTo(x + 6, y - 4);
      ctx.lineTo(labelX, labelY);
      ctx.stroke();

      let textW = ctx.measureText(item.label).width + 18;
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.strokeStyle = item.color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.rect(labelX, labelY - 12, textW, 24);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = 'rgba(20,20,20,0.82)';
      ctx.fillText(item.label, labelX + 9, labelY);
    }
    ctx.restore();
  });
}

function boxWhiskerPlugin() {
  return overlayCanvasPlugin((u, ctx) => {
    let xs = u.data[0];
    let {left, top, width, height} = u.bbox;
    let xScale = u.series[0].scale;
    let yScale = 'y';
    let visible = Math.max(1, xs.length - 1);
    let boxW = Math.max(5, Math.min(15, width / visible * 0.52));
    ctx.save();
    ctx.beginPath();
    ctx.rect(left, top, width, height);
    ctx.clip();
    ctx.lineWidth = 1.35;
    ctx.strokeStyle = 'rgba(20, 24, 30, 0.78)';
    ctx.fillStyle = 'rgba(245, 245, 245, 0.82)';
    for (let i = 0; i < xs.length; i += 5) {
      let x = Math.round(u.valToPos(xs[i], xScale, true));
      if (x < left - boxW || x > left + width + boxW)
        continue;
      let center = 18 + i * 0.16 + Math.sin(i * 0.43) * 3;
      let low = center - 3.5 - (i % 4);
      let q1 = center - 1.8;
      let med = center + Math.sin(i) * 0.8;
      let q3 = center + 2.2;
      let high = center + 4.2 + (i % 3);
      let yLow = u.valToPos(low, yScale, true);
      let yQ1 = u.valToPos(q1, yScale, true);
      let yMed = u.valToPos(med, yScale, true);
      let yQ3 = u.valToPos(q3, yScale, true);
      let yHigh = u.valToPos(high, yScale, true);
      ctx.beginPath();
      ctx.moveTo(x, yHigh);
      ctx.lineTo(x, yLow);
      ctx.moveTo(x - boxW * 0.35, yHigh);
      ctx.lineTo(x + boxW * 0.35, yHigh);
      ctx.moveTo(x - boxW * 0.35, yLow);
      ctx.lineTo(x + boxW * 0.35, yLow);
      ctx.stroke();
      let yTop = Math.min(yQ1, yQ3);
      let h = Math.max(1, Math.abs(yQ3 - yQ1));
      ctx.beginPath();
      ctx.rect(x - boxW / 2, yTop, boxW, h);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x - boxW / 2, yMed);
      ctx.lineTo(x + boxW / 2, yMed);
      ctx.stroke();
    }
    ctx.restore();
  });
}


function verticalStripFill(ctx, x0, x1, top0, top1, bottom0, bottom1, fillStyle) {
  let left = Math.round(Math.min(x0, x1));
  let right = Math.round(Math.max(x0, x1));
  let span = Math.max(1, right - left);
  ctx.fillStyle = fillStyle;
  for (let px = 0; px < span; px++) {
    let t = span == 1 ? 0 : px / (span - 1);
    let ya = top0 + (top1 - top0) * t;
    let yb = bottom0 + (bottom1 - bottom0) * t;
    let y = Math.min(ya, yb);
    let h = Math.max(1, Math.abs(yb - ya));
    ctx.fillRect(left + px, y, 1, h);
  }
}

function fillAreaWithStrips(ctx, pts, baseY, fillStyle) {
  if (!pts || pts.length < 2)
    return;
  for (let i = 0; i < pts.length - 1; i++) {
    verticalStripFill(ctx, pts[i][0], pts[i + 1][0], pts[i][1], pts[i + 1][1], baseY, baseY, fillStyle);
  }
}


function overlayCanvasPlugin(drawOverlay, {className = 'bench-overlay-canvas'} = {}) {
  let overlays = new WeakMap();
  let rafs = new WeakMap();

  function ensure(u) {
    if (!u?.root)
      return null;
    let canvas = overlays.get(u);
    if (canvas?.isConnected)
      return canvas;
    canvas = document.createElement('canvas');
    canvas.className = className;
    canvas.style.position = 'absolute';
    canvas.style.inset = '0';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.pointerEvents = 'none';
    canvas.style.zIndex = '3';
    u.root.style.position = u.root.style.position || 'relative';
    u.root.appendChild(canvas);
    overlays.set(u, canvas);
    return canvas;
  }

  function syncSize(u, canvas) {
    let base = u.ctx?.canvas || u.root?.querySelector?.('canvas');
    let cssW = Math.max(1, Math.round(base?.clientWidth || u.root?.clientWidth || u.width || 1));
    let cssH = Math.max(1, Math.round(base?.clientHeight || u.root?.clientHeight || u.height || 1));
    let pxW = Math.max(1, Math.round(base?.width || cssW * (u.pxRatio || devicePixelRatio || 1)));
    let pxH = Math.max(1, Math.round(base?.height || cssH * (u.pxRatio || devicePixelRatio || 1)));
    if (canvas.width !== pxW)
      canvas.width = pxW;
    if (canvas.height !== pxH)
      canvas.height = pxH;
    canvas.style.width = cssW + 'px';
    canvas.style.height = cssH + 'px';
  }

  function render(u) {
    let canvas = ensure(u);
    if (!canvas)
      return;
    syncSize(u, canvas);
    let ctx = canvas.getContext('2d');
    if (!ctx)
      return;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    try {
      drawOverlay(u, ctx, canvas);
    }
    finally {
      ctx.restore();
    }
  }

  function schedule(u) {
    let old = rafs.get(u);
    if (old)
      cancelAnimationFrame(old);
    let id = requestAnimationFrame(() => {
      rafs.delete(u);
      render(u);
    });
    rafs.set(u, id);
  }

  return {
    hooks: {
      ready: [u => schedule(u)],
      draw: [u => schedule(u)],
      setSize: [u => schedule(u)],
      destroy: [u => {
        let id = rafs.get(u);
        if (id)
          cancelAnimationFrame(id);
        rafs.delete(u);
        let canvas = overlays.get(u);
        canvas?.remove?.();
        overlays.delete(u);
      }],
    },
  };
}

function decimatedAreaPlugin({seriesIdx = 1, fill = 'rgba(91,182,234,0.10)', maxSegments = 1200} = {}) {
  return {
    hooks: {
      drawClear: [u => {
        let xs = u.data[0];
        let ys = u.data[seriesIdx];
        if (!xs || !ys || xs.length < 2)
          return;
        let step = Math.max(1, Math.ceil(xs.length / maxSegments));
        let ctx = u.ctx;
        let {left, top, width, height} = u.bbox;
        let xScale = u.series[0].scale;
        let yScale = u.series[seriesIdx]?.scale || 'y';
        let scale = u.scales[yScale];
        let baseVal = scale.min <= 0 && scale.max >= 0 ? 0 : scale.min;
        let baseY = u.valToPos(baseVal, yScale, true);
        let xy = [];
        for (let i = 0; i < xs.length; i += step)
          xy.push([u.valToPos(xs[i], xScale, true), u.valToPos(ys[i], yScale, true)]);
        if ((xs.length - 1) % step != 0)
          xy.push([u.valToPos(xs[xs.length - 1], xScale, true), u.valToPos(ys[ys.length - 1], yScale, true)]);
        ctx.save();
        ctx.beginPath();
        ctx.rect(left, top, width, height);
        ctx.clip();
        ctx.fillStyle = fill;
        fillAreaWithStrips(ctx, xy, baseY, fill);
        ctx.restore();
      }],
    },
  };
}


function canvasApiCoveragePlugin() {
  return overlayCanvasPlugin((u, ctx) => {
    let {left, top, width, height} = u.bbox;

    ctx.save();
    ctx.beginPath();
    ctx.rect(left, top, width, height);
    ctx.clip();

    let pad = Math.max(12, width * 0.035);
    let cardW = (width - pad * 4) / 3;
    let cardH = height * 0.34;
    let y0 = top + height * 0.12;

    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    let grad = ctx.createLinearGradient(left, y0, left + width, y0 + cardH);
    grad.addColorStop(0, 'rgba(39,110,241,0.28)');
    grad.addColorStop(0.5, 'rgba(35,164,85,0.16)');
    grad.addColorStop(1, 'rgba(228,87,46,0.18)');

    ctx.fillStyle = grad;
    ctx.strokeStyle = '#276ef1';
    ctx.beginPath();
    ctx.roundRect(left + pad, y0, cardW, cardH, [18, 8, 18, 8]);
    ctx.fill();
    ctx.stroke();

    let cx = left + pad * 2 + cardW * 1.5;
    let cy = y0 + cardH * 0.52;
    let rgrad = ctx.createRadialGradient(cx, cy, 4, cx, cy, cardH * 0.58);
    rgrad.addColorStop(0, 'rgba(255,255,255,0.94)');
    rgrad.addColorStop(0.45, 'rgba(228,87,46,0.30)');
    rgrad.addColorStop(1, 'rgba(124,58,237,0.08)');
    ctx.fillStyle = rgrad;
    ctx.strokeStyle = '#e4572e';
    ctx.beginPath();
    ctx.ellipse(cx, cy, cardW * 0.38, cardH * 0.33, -0.24, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    let x3 = left + pad * 3 + cardW * 2;
    ctx.fillStyle = 'rgba(35,164,85,0.10)';
    ctx.strokeStyle = '#23a455';
    ctx.beginPath();
    ctx.moveTo(x3 + cardW * 0.08, y0 + cardH * 0.82);
    ctx.arcTo(x3 + cardW * 0.50, y0 - cardH * 0.08, x3 + cardW * 0.92, y0 + cardH * 0.82, cardH * 0.42);
    ctx.lineTo(x3 + cardW * 0.92, y0 + cardH * 0.82);
    ctx.stroke();

    let donutX = left + pad + cardW * 0.50;
    let donutY = top + height * 0.72;
    let outerR = Math.min(cardW, height) * 0.16;
    let innerR = Math.min(cardW, height) * 0.075;

    ctx.fillStyle = 'rgba(124,58,237,0.18)';
    ctx.strokeStyle = '#7c3aed';
    ctx.beginPath();
    ctx.arc(donutX, donutY, outerR, 0, Math.PI * 2, false);
    ctx.moveTo(donutX + innerR, donutY);
    ctx.arc(donutX, donutY, innerR, 0, Math.PI * 2, true);
    ctx.fill('evenodd');
    ctx.stroke();

    let patternCanvas = document.createElement('canvas');
    patternCanvas.width = 16;
    patternCanvas.height = 16;
    let pctx = patternCanvas.getContext('2d');
    pctx.fillStyle = '#fff4d7';
    pctx.fillRect(0, 0, 16, 16);
    pctx.fillStyle = '#d39200';
    pctx.fillRect(0, 0, 8, 8);
    pctx.fillRect(8, 8, 8, 8);
    let pattern = ctx.createPattern?.(patternCanvas, 'repeat');

    let px = left + pad * 2 + cardW * 1.05;
    let py = top + height * 0.62;
    ctx.fillStyle = pattern || 'rgba(211,146,0,0.16)';
    ctx.strokeStyle = '#d39200';
    ctx.beginPath();
    ctx.roundRect(px, py, cardW * 1.35, height * 0.18, 14);
    ctx.fill();
    ctx.stroke();

    ctx.font = '13px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(15,23,42,0.78)';
    ctx.textBaseline = 'middle';
    ctx.fillText('Canvas API smoke: roundRect, ellipse, arcTo, evenodd, radial gradient, pattern', left + pad, top + height - 18);

    ctx.restore();
  });
}



function textImageCompositeApiPlugin() {
  return {
    hooks: {
      drawClear: [u => {
        let ctx = u.ctx;
        let {left, top, width, height} = u.bbox;
        ctx.save();
        ctx.beginPath();
        ctx.rect(left, top, width, height);
        ctx.clip();

        let pad = Math.max(12, width * 0.035);
        let rowY = top + height * 0.18;
        let boxW = (width - pad * 4) / 3;
        let boxH = height * 0.32;

        ctx.fillStyle = 'rgba(255,255,255,0.88)';
        ctx.fillRect(left + pad, rowY, width - pad * 2, height * 0.64);

        ctx.shadowColor = 'rgba(15,23,42,0.30)';
        ctx.shadowBlur = 12;
        ctx.shadowOffsetX = 4;
        ctx.shadowOffsetY = 5;
        ctx.fillStyle = 'rgba(39,110,241,0.70)';
        ctx.fillRect(left + pad, rowY, boxW, boxH);
        ctx.shadowColor = 'rgba(0,0,0,0)';
        ctx.shadowBlur = 0;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 0;

        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = 'rgba(228,87,46,0.70)';
        ctx.beginPath();
        ctx.arc(left + pad + boxW * 0.68, rowY + boxH * 0.52, boxH * 0.34, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalCompositeOperation = 'source-over';

        let source = document.createElement('canvas');
        source.width = 48;
        source.height = 48;
        let sctx = source.getContext('2d');
        sctx.fillStyle = '#fef3c7';
        sctx.fillRect(0, 0, 48, 48);
        sctx.fillStyle = '#276ef1';
        sctx.fillRect(4, 4, 18, 18);
        sctx.fillStyle = '#e4572e';
        sctx.beginPath();
        sctx.arc(32, 31, 12, 0, Math.PI * 2);
        sctx.fill();
        sctx.strokeStyle = '#111827';
        sctx.lineWidth = 3;
        sctx.beginPath();
        sctx.moveTo(7, 40);
        sctx.lineTo(42, 7);
        sctx.stroke();

        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(source, left + pad * 2 + boxW, rowY, boxW, boxH);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';

        ctx.globalAlpha = 0.92;
        ctx.fillStyle = 'rgba(35,164,85,0.72)';
        ctx.fillRect(left + pad * 3 + boxW * 2, rowY, boxW, boxH);
        ctx.globalCompositeOperation = 'destination-out';
        ctx.beginPath();
        ctx.arc(left + pad * 3 + boxW * 2 + boxW * 0.50, rowY + boxH * 0.50, boxH * 0.28, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;

        ctx.font = '700 15px system-ui, sans-serif';
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'left';
        ctx.direction = 'ltr';
        ctx.letterSpacing = '1px';
        ctx.wordSpacing = '2px';
        ctx.fontKerning = 'normal';
        ctx.fillStyle = 'rgba(15,23,42,0.88)';
        ctx.fillText('Text spacing + image + composite smoke', left + pad, top + height * 0.74);

        ctx.direction = 'rtl';
        ctx.textAlign = 'right';
        ctx.fontVariantCaps = 'small-caps';
        ctx.fillStyle = 'rgba(124,58,237,0.88)';
        ctx.fillText('RTL text probe', left + width - pad, top + height * 0.84);

        ctx.direction = 'inherit';
        ctx.textAlign = 'left';
        ctx.letterSpacing = '0px';
        ctx.wordSpacing = '0px';
        ctx.fontVariantCaps = 'normal';
        ctx.restore();
      }],
    },
  };
}






function scalesDirOriMatrixPlugin() {
  return {
    hooks: {
      drawClear: [u => {
        let ctx = u.ctx;
        let {left, top, width, height} = u.bbox;
        ctx.save();
        ctx.beginPath();
        ctx.rect(left, top, width, height);
        ctx.clip();

        let panels = [
          {label: 'x dir +1 / y dir +1', x: 0.07, y: 0.12, w: 0.38, h: 0.30, flipX: false, flipY: false},
          {label: 'x dir -1 / y dir +1', x: 0.55, y: 0.12, w: 0.38, h: 0.30, flipX: true, flipY: false},
          {label: 'x dir +1 / y dir -1', x: 0.07, y: 0.56, w: 0.38, h: 0.30, flipX: false, flipY: true},
          {label: 'side/orientation probe', x: 0.55, y: 0.56, w: 0.38, h: 0.30, flipX: true, flipY: true},
        ];

        for (let p of panels) {
          let x = left + width * p.x;
          let y = top + height * p.y;
          let w = width * p.w;
          let h = height * p.h;
          ctx.fillStyle = 'rgba(255,255,255,0.90)';
          ctx.strokeStyle = 'rgba(15,23,42,0.20)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.roundRect(x, y, w, h, 8);
          ctx.fill();
          ctx.stroke();

          ctx.strokeStyle = 'rgba(15,23,42,0.16)';
          for (let i = 1; i < 4; i++) {
            ctx.beginPath();
            ctx.moveTo(x + w * i / 4, y + 8);
            ctx.lineTo(x + w * i / 4, y + h - 8);
            ctx.moveTo(x + 8, y + h * i / 4);
            ctx.lineTo(x + w - 8, y + h * i / 4);
            ctx.stroke();
          }

          ctx.strokeStyle = '#276ef1';
          ctx.lineWidth = 2;
          ctx.beginPath();
          for (let i = 0; i <= 48; i++) {
            let t = i / 48;
            let tx = p.flipX ? 1 - t : t;
            let wave = 0.5 - Math.sin(t * Math.PI * 2.0) * 0.28;
            let ty = p.flipY ? 1 - wave : wave;
            let px = x + 12 + tx * (w - 24);
            let py = y + 12 + ty * (h - 24);
            if (i == 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          }
          ctx.stroke();

          ctx.fillStyle = 'rgba(15,23,42,0.76)';
          ctx.font = '11px system-ui, sans-serif';
          ctx.textBaseline = 'top';
          ctx.textAlign = 'left';
          ctx.fillText(p.label, x + 8, y + 8);

          ctx.fillStyle = '#e4572e';
          ctx.beginPath();
          ctx.moveTo(x + (p.flipX ? 14 : w - 14), y + h - 12);
          ctx.lineTo(x + (p.flipX ? 28 : w - 28), y + h - 18);
          ctx.lineTo(x + (p.flipX ? 28 : w - 28), y + h - 6);
          ctx.closePath();
          ctx.fill();
        }

        ctx.restore();
      }],
    },
  };
}

function fillStrokeClipPathologyPlugin() {
  return overlayCanvasPlugin((u, ctx) => {
    let {left, top, width, height} = u.bbox;

    ctx.save();
    ctx.beginPath();
    ctx.rect(left, top, width, height);
    ctx.clip();

    let cx = left + width * 0.24;
    let cy = top + height * 0.48;
    let r = Math.min(width, height) * 0.16;
    let grad = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
    grad.addColorStop(0, 'rgba(39,110,241,0.42)');
    grad.addColorStop(0.5, 'rgba(35,164,85,0.24)');
    grad.addColorStop(1, 'rgba(228,87,46,0.36)');

    ctx.fillStyle = grad;
    ctx.strokeStyle = '#276ef1';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      let a = -Math.PI / 2 + i * Math.PI * 2 / 10;
      let rr = i % 2 ? r * 0.42 : r;
      let x = cx + Math.cos(a) * rr;
      let y = cy + Math.sin(a) * rr;
      if (i == 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill('evenodd');
    ctx.stroke();

    let hx = left + width * 0.55;
    let hy = top + height * 0.22;
    let hw = width * 0.32;
    let hh = height * 0.54;

    ctx.save();
    ctx.beginPath();
    ctx.roundRect(hx, hy, hw, hh, 24);
    ctx.clip();

    ctx.fillStyle = 'rgba(124,58,237,0.10)';
    ctx.fillRect(hx, hy, hw, hh);

    ctx.strokeStyle = '#7c3aed';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(hx - hw * 0.10, hy + hh * 0.80);
    ctx.bezierCurveTo(hx + hw * 0.20, hy - hh * 0.10, hx + hw * 0.72, hy + hh * 1.12, hx + hw * 1.12, hy + hh * 0.10);
    ctx.stroke();

    ctx.fillStyle = 'rgba(228,87,46,0.18)';
    ctx.beginPath();
    ctx.arc(hx + hw * 0.52, hy + hh * 0.50, hh * 0.24, 0, Math.PI * 2);
    ctx.arc(hx + hw * 0.52, hy + hh * 0.50, hh * 0.10, 0, Math.PI * 2);
    ctx.fill('evenodd');
    ctx.restore();

    ctx.strokeStyle = 'rgba(15,23,42,0.32)';
    ctx.setLineDash([6, 5]);
    ctx.strokeRect(hx, hy, hw, hh);
    ctx.setLineDash([]);

    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.fillRect(left + 12, top + 10, width - 24, 28);
    ctx.fillStyle = 'rgba(15,23,42,0.80)';
    ctx.font = '13px system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText('self-intersect even-odd star, clipped bezier stroke, nested even-odd hole', left + 22, top + 24);

    ctx.restore();
  });
}


function barStackValueAutosizePlugin() {
  return {
    hooks: {
      drawClear: [u => {
        let ctx = u.ctx;
        let {left, top, width, height} = u.bbox;
        ctx.save();
        ctx.beginPath();
        ctx.rect(left, top, width, height);
        ctx.clip();

        let groups = [
          [28, 18, 10],
          [18, 26, 16],
          [34, 20, 22],
          [22, 32, 18],
          [30, 24, 14],
        ];
        let colors = ['#276ef1', '#23a455', '#e4572e'];
        let gap = width * 0.045;
        let barW = (width - gap * (groups.length + 1)) / groups.length;
        let maxTotal = Math.max(...groups.map(g => g.reduce((a, b) => a + b, 0)));
        let base = top + height * 0.86;
        let plotH = height * 0.64;

        ctx.font = '11px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        for (let g = 0; g < groups.length; g++) {
          let x = left + gap + g * (barW + gap);
          let y = base;
          let total = 0;
          for (let s = 0; s < groups[g].length; s++) {
            let v = groups[g][s];
            let h = plotH * v / maxTotal;
            y -= h;
            ctx.fillStyle = colors[s];
            ctx.globalAlpha = 0.22 + s * 0.08;
            ctx.fillRect(x, y, barW, h);
            ctx.globalAlpha = 1;
            ctx.strokeStyle = colors[s];
            ctx.lineWidth = 1.2;
            ctx.strokeRect(x, y, barW, h);
            if (h > 14) {
              ctx.fillStyle = 'rgba(15,23,42,0.72)';
              ctx.fillText(String(v), x + barW / 2, y + h / 2);
            }
            total += v;
          }
          ctx.fillStyle = 'rgba(15,23,42,0.78)';
          ctx.font = '700 12px system-ui, sans-serif';
          ctx.fillText(String(total), x + barW / 2, y - 10);
          ctx.font = '11px system-ui, sans-serif';
          ctx.fillText(`G${g + 1}`, x + barW / 2, base + 14);
        }

        ctx.restore();
      }],
    },
  };
}

function softMinMaxShiftPlugin() {
  return overlayCanvasPlugin((u, ctx) => {
    let {left, top, width, height} = u.bbox;

    ctx.save();
    ctx.beginPath();
    ctx.rect(left, top, width, height);
    ctx.clip();

    let y0 = u.valToPos(45, 'y', true);
    let y1 = u.valToPos(75, 'y', true);
    ctx.fillStyle = 'rgba(39,110,241,0.10)';
    ctx.fillRect(left, Math.min(y0, y1), width, Math.abs(y1 - y0));
    ctx.strokeStyle = 'rgba(39,110,241,0.42)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([8, 5]);
    ctx.beginPath();
    ctx.moveTo(left, y0);
    ctx.lineTo(left + width, y0);
    ctx.moveTo(left, y1);
    ctx.lineTo(left + width, y1);
    ctx.stroke();
    ctx.setLineDash([]);

    let zero = u.valToPos(0, 'y', true);
    if (Number.isFinite(zero)) {
      ctx.strokeStyle = 'rgba(228,87,46,0.44)';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(left, zero);
      ctx.lineTo(left + width, zero);
      ctx.stroke();
    }

    ctx.fillStyle = 'rgba(255,255,255,0.94)';
    ctx.strokeStyle = 'rgba(15,23,42,0.18)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(left + 12, top + 12, 230, 54, 8);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = 'rgba(15,23,42,0.78)';
    ctx.font = '13px system-ui, sans-serif';
    ctx.textBaseline = 'top';
    ctx.fillText('soft min/max band', left + 24, top + 22);
    ctx.fillText('shifted series + y zero guide', left + 24, top + 42);

    ctx.restore();
  });
}

function alignmentGapClipPlugin() {
  return overlayCanvasPlugin((u, ctx) => {
    let xs = u.data[0];
    let {left, top, width, height} = u.bbox;

    ctx.save();
    ctx.beginPath();
    ctx.roundRect(left + width * 0.10, top + height * 0.14, width * 0.78, height * 0.68, 18);
    ctx.clip();

    ctx.fillStyle = 'rgba(39,110,241,0.045)';
    ctx.fillRect(left, top, width, height);

    for (let s = 1; s < u.data.length; s++) {
      let ys = u.data[s];
      ctx.strokeStyle = ['#276ef1', '#e4572e', '#23a455'][s - 1] || '#7c3aed';
      ctx.lineWidth = 2.3;
      ctx.beginPath();
      let open = false;
      for (let i = 0; i < xs.length; i++) {
        let v = ys[i];
        if (v == null || !Number.isFinite(Number(v))) {
          open = false;
          continue;
        }
        let x = u.valToPos(xs[i], 'x', true);
        let y = u.valToPos(v, 'y', true);
        if (!open) {
          ctx.moveTo(x, y);
          open = true;
        }
        else
          ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    ctx.restore();

    ctx.save();
    ctx.strokeStyle = 'rgba(15,23,42,0.35)';
    ctx.lineWidth = 1.6;
    ctx.setLineDash([7, 5]);
    ctx.strokeRect(left + width * 0.10, top + height * 0.14, width * 0.78, height * 0.68);
    ctx.setLineDash([]);

    ctx.fillStyle = 'rgba(255,255,255,0.94)';
    ctx.fillRect(left + 10, top + 10, 238, 26);
    ctx.fillStyle = 'rgba(15,23,42,0.78)';
    ctx.font = '13px system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText('aligned x, null gaps, rounded clip', left + 20, top + 23);
    ctx.restore();
  });
}

function windDirectionCompatibilityPlugin() {
  return overlayCanvasPlugin((u, ctx) => {
    let xs = u.data[0];
    let speed = u.data[1];
    let dir = u.data[2];
    let {left, top, width, height} = u.bbox;

    ctx.save();
    ctx.beginPath();
    ctx.rect(left, top, width, height);
    ctx.clip();

    for (let i = 0; i < xs.length; i += 5) {
      let x = u.valToPos(xs[i], 'x', true);
      let y = u.valToPos(speed[i], 'y', true);
      let angle = (dir[i] - 90) * Math.PI / 180;
      let len = 14 + Math.max(0, speed[i]) * 0.70;
      let x2 = x + Math.cos(angle) * len;
      let y2 = y + Math.sin(angle) * len;

      ctx.strokeStyle = '#276ef1';
      ctx.fillStyle = '#276ef1';
      ctx.lineWidth = 2.0;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x2, y2);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(x2, y2);
      ctx.lineTo(x2 - Math.cos(angle - 0.55) * 8, y2 - Math.sin(angle - 0.55) * 8);
      ctx.lineTo(x2 - Math.cos(angle + 0.55) * 8, y2 - Math.sin(angle + 0.55) * 8);
      ctx.closePath();
      ctx.fill();
    }

    ctx.fillStyle = 'rgba(255,255,255,0.94)';
    ctx.fillRect(left + width - 162, top + 10, 152, 26);
    ctx.fillStyle = 'rgba(15,23,42,0.78)';
    ctx.font = '13px system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText('wind direction arrows', left + width - 152, top + 23);

    ctx.restore();
  });
}

function touchZoomCompatibilityPlugin() {
  let cleanup = new WeakMap();

  return {
    hooks: {
      ready: [u => {
        let over = u.over;
        if (!over)
          return;
        let pointers = new Map();
        let start = null;

        let badge = document.createElement('div');
        badge.className = 'bench-interaction-badge';
        badge.textContent = 'touch pinch / pointer zoom probe';
        badge.style.position = 'absolute';
        badge.style.left = '8px';
        badge.style.bottom = '8px';
        badge.style.zIndex = '4';
        badge.style.padding = '4px 7px';
        badge.style.borderRadius = '999px';
        badge.style.background = 'rgba(255,255,255,0.88)';
        badge.style.border = '1px solid rgba(15,23,42,0.16)';
        badge.style.font = '11px system-ui, sans-serif';
        badge.style.pointerEvents = 'none';
        over.appendChild(badge);

        let dist = pts => {
          let a = pts[0], b = pts[1];
          return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
        };

        let down = e => {
          pointers.set(e.pointerId, e);
          if (pointers.size == 2) {
            let pts = Array.from(pointers.values());
            start = {d: dist(pts), x: {...u.scales.x}, y: {...u.scales.y}};
          }
        };
        let move = e => {
          if (!pointers.has(e.pointerId))
            return;
          pointers.set(e.pointerId, e);
          if (start && pointers.size >= 2) {
            let pts = Array.from(pointers.values()).slice(0, 2);
            let d = dist(pts);
            let ratio = start.d / Math.max(8, d);
            for (let key of ['x', 'y']) {
              let sc = start[key];
              if (!Number.isFinite(sc.min) || !Number.isFinite(sc.max))
                continue;
              let mid = (sc.min + sc.max) / 2;
              let span = (sc.max - sc.min) * ratio;
              u.setScale(key, {min: mid - span / 2, max: mid + span / 2});
            }
            badge.textContent = `pinch ratio ${Math.round((1 / ratio) * 100)}%`;
          }
        };
        let up = e => {
          pointers.delete(e.pointerId);
          if (pointers.size < 2)
            start = null;
        };

        over.addEventListener('pointerdown', down);
        over.addEventListener('pointermove', move);
        over.addEventListener('pointerup', up);
        over.addEventListener('pointercancel', up);
        cleanup.set(u, () => {
          over.removeEventListener('pointerdown', down);
          over.removeEventListener('pointermove', move);
          over.removeEventListener('pointerup', up);
          over.removeEventListener('pointercancel', up);
          badge.remove();
        });
      }],
      destroy: [u => {
        cleanup.get(u)?.();
        cleanup.delete(u);
      }],
    },
  };
}

function readbackCompositeMatrixPlugin() {
  return overlayCanvasPlugin((u, ctx) => {
    let {left, top, width, height} = u.bbox;

    ctx.save();
    ctx.beginPath();
    ctx.rect(left, top, width, height);
    ctx.clip();

    let modes = ['source-over', 'multiply', 'screen', 'lighter', 'destination-out'];
    let r = Math.min(width / modes.length, height) * 0.15;

    for (let i = 0; i < modes.length; i++) {
      let cx = left + width * (0.10 + i * 0.19);
      let cy = top + height * 0.46;

      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = 'rgba(39,110,241,0.70)';
      ctx.beginPath();
      ctx.arc(cx - r * 0.45, cy, r, 0, Math.PI * 2);
      ctx.fill();

      ctx.globalCompositeOperation = modes[i];
      ctx.fillStyle = 'rgba(228,87,46,0.66)';
      ctx.beginPath();
      ctx.arc(cx + r * 0.45, cy, r, 0, Math.PI * 2);
      ctx.fill();

      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = 'rgba(15,23,42,0.74)';
      ctx.font = '12px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(modes[i], cx, cy + r + 18);
    }

    ctx.fillStyle = 'rgba(255,255,255,0.94)';
    ctx.fillRect(left + 12, top + 12, 138, 28);
    ctx.fillStyle = 'rgba(15,23,42,0.78)';
    ctx.font = '13px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('readback probe ok', left + 22, top + 26);

    ctx.restore();
  });
}


function axisScaleCompatibilityPlugin() {
  return overlayCanvasPlugin((u, ctx) => {
    let {left, top, width, height} = u.bbox;

    ctx.save();
    ctx.beginPath();
    ctx.rect(left, top, width, height);
    ctx.clip();

    for (let i = 0; i <= 10; i++) {
      let x = Math.round(left + width * i / 10) + 0.5;
      ctx.strokeStyle = i % 5 == 0 ? 'rgba(39,110,241,0.34)' : 'rgba(39,110,241,0.13)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x, top + height);
      ctx.stroke();
    }

    for (let i = 0; i <= 8; i++) {
      let y = Math.round(top + height * i / 8) + 0.5;
      ctx.strokeStyle = i % 4 == 0 ? 'rgba(228,87,46,0.30)' : 'rgba(15,23,42,0.11)';
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(left + width, y);
      ctx.stroke();
    }

    ctx.strokeStyle = 'rgba(15,23,42,0.52)';
    ctx.lineWidth = 1.2;
    ctx.setLineDash([6, 5]);
    ctx.beginPath();
    ctx.moveTo(left + width * 0.08, top + height * 0.20);
    ctx.lineTo(left + width * 0.92, top + height * 0.20);
    ctx.moveTo(left + width * 0.08, top + height * 0.80);
    ctx.lineTo(left + width * 0.92, top + height * 0.80);
    ctx.stroke();
    ctx.setLineDash([]);

    let badges = [
      ['axis autosize', left + 12, top + 16, '#276ef1'],
      ['axis controls', left + width - 118, top + 16, '#e4572e'],
      ['pixel align 0.5', left + 12, top + height - 28, '#23a455'],
      ['scale padding', left + width - 118, top + height - 28, '#7c3aed'],
    ];

    ctx.font = '13px system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    for (let [text, x, y, color] of badges) {
      let tw = ctx.measureText(text).width + 18;
      ctx.fillStyle = 'rgba(255,255,255,0.94)';
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.roundRect(x, y - 13, tw, 26, 12);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.fillText(text, x + 9, y);
    }

    ctx.restore();
  });
}

function cursorBindSnapTooltipPlugin() {
  return overlayCanvasPlugin((u, ctx) => {
    let xs = u.data?.[0];
    let ys = u.data?.[1];
    if (!xs || !ys)
      return;

    let idx = Math.floor(xs.length * 0.56);
    while (idx < ys.length && ys[idx] == null)
      idx++;
    if (idx >= ys.length)
      idx = Math.floor(xs.length * 0.56);

    let x = u.valToPos(xs[idx], u.series[0].scale, true);
    let y = u.valToPos(ys[idx], u.series[1]?.scale || 'y', true);
    let {left, top, width, height} = u.bbox;

    ctx.save();
    ctx.beginPath();
    ctx.rect(left, top, width, height);
    ctx.clip();

    ctx.strokeStyle = 'rgba(228,87,46,0.58)';
    ctx.lineWidth = 2;
    ctx.strokeRect(left + width * 0.12, top + height * 0.18, width * 0.72, height * 0.62);

    ctx.strokeStyle = 'rgba(39,110,241,0.60)';
    ctx.lineWidth = 1.8;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, top + height);
    ctx.moveTo(left, y);
    ctx.lineTo(left + width, y);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = '#276ef1';
    ctx.beginPath();
    ctx.arc(x, y, 6, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = 'rgba(255,255,255,0.94)';
    ctx.strokeStyle = 'rgba(15,23,42,0.22)';
    ctx.lineWidth = 1.4;
    let boxX = Math.min(left + width - 300, Math.max(left + 12, x + 18));
    let boxY = Math.max(top + 12, y - 42);
    ctx.beginPath();
    ctx.roundRect(boxX, boxY, 280, 70, 10);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = 'rgba(15,23,42,0.88)';
    ctx.font = '700 15px system-ui, sans-serif';
    ctx.textBaseline = 'top';
    ctx.fillText('snap + bound cursor', boxX + 14, boxY + 10);
    ctx.font = '12px system-ui, sans-serif';
    ctx.fillText('locked to nearest non-null datum', boxX + 14, boxY + 34);
    ctx.fillStyle = 'rgba(71,84,103,0.82)';
    ctx.fillText(`x: ${Math.round(xs[idx])}   y: ${Number(ys[idx]).toFixed(1)}`, boxX + 14, boxY + 51);

    ctx.fillStyle = 'rgba(255,255,255,0.90)';
    ctx.fillRect(left + width * 0.13, top + height * 0.19, 136, 22);
    ctx.fillStyle = 'rgba(15,23,42,0.76)';
    ctx.font = '12px system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText('bound cursor area', left + width * 0.145, top + height * 0.205);

    ctx.restore();
  });
}

function syncRangerCompatibilityPlugin() {
  return overlayCanvasPlugin((u, ctx) => {
    let {left, top, width, height} = u.bbox;

    ctx.save();
    ctx.beginPath();
    ctx.rect(left, top, width, height);
    ctx.clip();

    let miniH = height * 0.24;
    let gap = height * 0.06;
    let y0 = top + height * 0.11;
    let labels = ['synced chart A', 'synced chart B', 'ranger + grips'];

    for (let row = 0; row < 3; row++) {
      let y = y0 + row * (miniH + gap);
      ctx.fillStyle = row == 2 ? 'rgba(15,23,42,0.06)' : 'rgba(39,110,241,0.055)';
      ctx.strokeStyle = 'rgba(15,23,42,0.18)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(left + width * 0.08, y, width * 0.84, miniH, 8);
      ctx.fill();
      ctx.stroke();

      ctx.font = '13px system-ui, sans-serif';
      ctx.fillStyle = 'rgba(15,23,42,0.70)';
      ctx.textBaseline = 'top';
      ctx.fillText(labels[row], left + width * 0.095, y + 7);

      if (row < 2) {
        ctx.strokeStyle = row == 0 ? '#276ef1' : '#e4572e';
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        for (let i = 0; i <= 96; i++) {
          let t = i / 96;
          let px = left + width * (0.12 + t * 0.76);
          let py = y + miniH * (0.66 - Math.sin(t * Math.PI * 4 + row) * 0.22 - Math.cos(i / 9) * 0.04);
          if (i == 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.stroke();
      }
      else {
        let rx = left + width * 0.24;
        let rw = width * 0.36;
        ctx.fillStyle = 'rgba(39,110,241,0.18)';
        ctx.fillRect(rx, y + miniH * 0.28, rw, miniH * 0.42);
        ctx.strokeStyle = '#276ef1';
        ctx.lineWidth = 2;
        ctx.strokeRect(rx, y + miniH * 0.28, rw, miniH * 0.42);
        ctx.fillStyle = '#276ef1';
        ctx.fillRect(rx - 5, y + miniH * 0.20, 10, miniH * 0.58);
        ctx.fillRect(rx + rw - 5, y + miniH * 0.20, 10, miniH * 0.58);
      }
    }

    let cx = left + width * 0.46;
    ctx.strokeStyle = 'rgba(71,84,103,0.58)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 5]);
    ctx.beginPath();
    ctx.moveTo(cx, top + height * 0.10);
    ctx.lineTo(cx, top + height * 0.90);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.restore();
  });
}

function timeLocalizationDiscretePlugin() {
  return overlayCanvasPlugin((u, ctx) => {
    let {left, top, width, height} = u.bbox;
    let monthsRu = ['фев', 'мар', 'апр', 'май', 'июн'];

    ctx.save();
    ctx.beginPath();
    ctx.rect(left, top, width, height);
    ctx.clip();

    for (let i = 0; i < monthsRu.length; i++) {
      let x0 = left + width * i / monthsRu.length;
      let x1 = left + width * (i + 1) / monthsRu.length;
      ctx.fillStyle = i % 2 ? 'rgba(39,110,241,0.075)' : 'rgba(35,164,85,0.075)';
      ctx.fillRect(x0, top, x1 - x0, height);
      ctx.fillStyle = 'rgba(15,23,42,0.78)';
      ctx.font = '700 15px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(monthsRu[i], (x0 + x1) / 2, top + 12);
    }

    let rows = [
      {y: 0.36, color: '#276ef1', label: 'timeline discrete'},
      {y: 0.58, color: '#e4572e', label: 'time periods'},
      {y: 0.76, color: '#23a455', label: 'DST span'},
    ];

    for (let row of rows) {
      let y = top + height * row.y;
      ctx.strokeStyle = row.color;
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(left + width * 0.08, y);
      ctx.lineTo(left + width * 0.92, y);
      ctx.stroke();

      for (let i = 0; i < 8; i++) {
        let x = left + width * (0.10 + i * 0.11);
        ctx.fillStyle = row.color;
        ctx.beginPath();
        ctx.arc(x, y, 4.5, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.fillStyle = 'rgba(15,23,42,0.76)';
      ctx.font = '13px system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(row.label, left + 14, y - 17);
    }

    ctx.restore();
  });
}

function imageClipGradientCompatibilityPlugin() {
  return overlayCanvasPlugin((u, ctx) => {
    let {left, top, width, height} = u.bbox;

    ctx.save();
    ctx.beginPath();
    ctx.rect(left, top, width, height);
    ctx.clip();

    let cx = left + width * 0.30;
    let cy = top + height * 0.48;
    let r = Math.min(width, height) * 0.22;
    let conic = ctx.createConicGradient ? ctx.createConicGradient(-Math.PI / 2, cx, cy) : ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
    conic.addColorStop(0.00, 'rgba(39,110,241,0.34)');
    conic.addColorStop(0.34, 'rgba(35,164,85,0.25)');
    conic.addColorStop(0.67, 'rgba(228,87,46,0.28)');
    conic.addColorStop(1.00, 'rgba(39,110,241,0.34)');

    ctx.fillStyle = conic;
    ctx.strokeStyle = 'rgba(15,23,42,0.44)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.arc(cx, cy, r * 0.38, 0, Math.PI * 2);
    ctx.fill('evenodd');
    ctx.stroke();

    let ix = left + width * 0.58;
    let iy = top + height * 0.20;
    let iw = width * 0.30;
    let ih = height * 0.56;

    ctx.save();
    ctx.beginPath();
    ctx.roundRect(ix, iy, iw, ih, 28);
    ctx.clip();

    ctx.fillStyle = '#fef3c7';
    ctx.fillRect(ix, iy, iw, ih);

    ctx.fillStyle = '#276ef1';
    ctx.beginPath();
    ctx.arc(ix + iw * 0.35, iy + ih * 0.43, Math.min(iw, ih) * 0.20, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = '#e4572e';
    ctx.lineWidth = Math.max(8, Math.min(iw, ih) * 0.07);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(ix + iw * 0.18, iy + ih * 0.74);
    ctx.bezierCurveTo(ix + iw * 0.34, iy + ih * 0.34, ix + iw * 0.62, iy + ih * 0.70, ix + iw * 0.82, iy + ih * 0.26);
    ctx.stroke();

    ctx.restore();

    ctx.strokeStyle = 'rgba(39,110,241,0.60)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([7, 5]);
    ctx.beginPath();
    ctx.roundRect(ix, iy, iw, ih, 28);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.restore();
  });
}


function noDataPanelPlugin() {
  return {
    hooks: {
      draw: [u => {
        let ctx = u.ctx;
        let {left, top, width, height} = u.bbox;
        ctx.save();
        ctx.fillStyle = 'rgba(248,250,252,0.92)';
        ctx.fillRect(left, top, width, height);
        ctx.strokeStyle = 'rgba(71,84,103,0.25)';
        ctx.setLineDash([8, 6]);
        ctx.strokeRect(left + width * 0.12, top + height * 0.20, width * 0.76, height * 0.52);
        ctx.setLineDash([]);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = '700 18px system-ui, sans-serif';
        ctx.fillStyle = 'rgba(15,23,42,0.82)';
        ctx.fillText('No data', left + width / 2, top + height * 0.45);
        ctx.font = '12px system-ui, sans-serif';
        ctx.fillStyle = 'rgba(71,84,103,0.78)';
        ctx.fillText('empty series renders cleanly without crashing', left + width / 2, top + height * 0.56);
        ctx.restore();
      }],
    },
  };
}

function stackedAreaCompatPlugin() {
  return {
    hooks: {
      drawClear: [u => {
        let ctx = u.ctx;
        let xs = u.data[0];
        if (!xs?.length)
          return;
        let {left, top, width, height} = u.bbox;
        let xScale = u.series[0].scale;
        ctx.save();
        ctx.beginPath();
        ctx.rect(left, top, width, height);
        ctx.clip();

        let fills = ['rgba(39,110,241,0.18)', 'rgba(35,164,85,0.16)', 'rgba(228,87,46,0.14)'];
        for (let s = 3; s >= 1; s--) {
          let ys = u.data[s];
          if (!ys)
            continue;
          ctx.fillStyle = fills[s - 1];
          ctx.beginPath();
          for (let i = 0; i < xs.length; i++) {
            let x = u.valToPos(xs[i], xScale, true);
            let y = u.valToPos(ys[i], 'y', true);
            if (i == 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          for (let i = xs.length - 1; i >= 0; i--) {
            let x = u.valToPos(xs[i], xScale, true);
            let base = s == 1 ? 0 : u.data[s - 1][i];
            let y = u.valToPos(base, 'y', true);
            ctx.lineTo(x, y);
          }
          ctx.closePath();
          ctx.fill();
        }
        ctx.restore();
      }],
    },
  };
}

function barStrokeFillCompatPlugin() {
  return {
    hooks: {
      drawClear: [u => {
        let ctx = u.ctx;
        let {left, top, width, height} = u.bbox;
        ctx.save();
        ctx.beginPath();
        ctx.rect(left, top, width, height);
        ctx.clip();
        let labels = ['stroke', 'fill', 'thin', 'rounded'];
        let vals = [0.84, 0.62, 0.48, 0.72];
        let gap = width * 0.07;
        let barW = (width - gap * 5) / 4;
        let base = top + height * 0.88;
        for (let i = 0; i < vals.length; i++) {
          let x = left + gap + i * (barW + gap);
          let h = height * 0.68 * vals[i];
          let y = base - h;
          ctx.fillStyle = i == 1 ? 'rgba(228,87,46,0.22)' : 'rgba(39,110,241,0.18)';
          ctx.strokeStyle = i == 2 ? '#23a455' : '#276ef1';
          ctx.lineWidth = i == 2 ? 1 : 2.5;
          ctx.beginPath();
          if (i == 3)
            ctx.roundRect(x, y, barW, h, 10);
          else
            ctx.rect(x, y, barW, h);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = 'rgba(15,23,42,0.74)';
          ctx.font = '11px system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'top';
          ctx.fillText(labels[i], x + barW / 2, base + 8);
        }
        ctx.restore();
      }],
    },
  };
}

function dynamicSeriesCompatPlugin() {
  let timers = new WeakMap();

  return {
    hooks: {
      ready: [u => {
        let label = document.createElement('div');
        label.className = 'bench-interaction-badge';
        label.textContent = 'add/remove series + setData pulses';
        label.style.position = 'absolute';
        label.style.right = '8px';
        label.style.top = '8px';
        label.style.zIndex = '4';
        label.style.padding = '4px 7px';
        label.style.borderRadius = '999px';
        label.style.background = 'rgba(255,255,255,0.88)';
        label.style.border = '1px solid rgba(15,23,42,0.16)';
        label.style.font = '11px system-ui, sans-serif';
        label.style.pointerEvents = 'none';
        u.over?.appendChild?.(label);

        let data = u.data.map(arr => ArrayBuffer.isView(arr) ? Float64Array.from(arr) : arr.slice());
        let tick = 0;
        let id = setInterval(() => {
          tick++;
          for (let s = 1; s < data.length; s++) {
            for (let i = 0; i < data[s].length; i++)
              data[s][i] = waveValue(i + tick * 2, s, 'line');
          }
          u.setData(data, false);
          if (tick == 3 && u.series.length < 4) {
            let extra = Float64Array.from(data[1], (v, i) => v * 0.72 + Math.sin(i / 10) * 8);
            data.push(extra);
            u.addSeries({label: 'added series', stroke: '#23a455', width: 1.8, points: {show: false}}, data.length - 1);
            u.setData(data, false);
          }
          if (tick == 7 && u.series.length > 3) {
            u.delSeries(u.series.length - 1);
            data.pop();
            u.setData(data, false);
          }
          if (tick > 10) {
            clearInterval(id);
            label.textContent = 'dynamic series complete';
          }
        }, 180);

        timers.set(u, () => {
          clearInterval(id);
          label.remove();
        });
      }],
      destroy: [u => {
        timers.get(u)?.();
        timers.delete(u);
      }],
    },
  };
}


function gradientAreaPlugin({seriesIdx = 1} = {}) {
  return {
    hooks: {
      drawClear: [u => {
        let ctx = u.ctx;
        let xs = u.data[0];
        let ys = u.data[seriesIdx];
        if (!xs || !ys || xs.length < 2)
          return;
        let xScale = u.series[0].scale;
        let yScale = u.series[seriesIdx]?.scale || 'y';
        let scale = u.scales[yScale];
        let baseVal = scale.min <= 0 && scale.max >= 0 ? 0 : scale.min;
        let {left, top, width, height} = u.bbox;
        let grad = ctx.createLinearGradient(left, top, left, top + height);
        grad.addColorStop(0, 'rgba(70, 128, 241, 0.34)');
        grad.addColorStop(0.55, 'rgba(70, 128, 241, 0.16)');
        grad.addColorStop(1, 'rgba(39, 110, 241, 0.03)');
        ctx.save();
        ctx.beginPath();
        ctx.rect(left, top, width, height);
        ctx.clip();
        for (let i = 0; i < xs.length - 1; i++) {
          let x0 = u.valToPos(xs[i], xScale, true);
          let x1 = u.valToPos(xs[i + 1], xScale, true);
          let y0 = u.valToPos(ys[i], yScale, true);
          let y1 = u.valToPos(ys[i + 1], yScale, true);
          let b0 = u.valToPos(baseVal, yScale, true);
          let b1 = b0;
          verticalStripFill(ctx, x0, x1, y0, y1, b0, b1, grad);
        }
        ctx.restore();
      }],
    },
  };
}



function strokeGradientProofPlugin({seriesCount = 3} = {}) {
  function mixColor(a, b, t) {
    return [
      Math.round(a[0] + (b[0] - a[0]) * t),
      Math.round(a[1] + (b[1] - a[1]) * t),
      Math.round(a[2] + (b[2] - a[2]) * t),
    ];
  }
  function stopColor(stops, t) {
    for (let i = 0; i < stops.length - 1; i++) {
      let a = stops[i];
      let b = stops[i + 1];
      if (t <= b[0]) {
        let k = (t - a[0]) / Math.max(1e-6, b[0] - a[0]);
        let c = mixColor(a[1], b[1], Math.max(0, Math.min(1, k)));
        return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
      }
    }
    let c = stops[stops.length - 1][1];
    return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
  }
  const palettes = [
    [[0.00, [39, 110, 241]], [0.42, [245, 158, 11]], [0.76, [35, 164, 85]], [1.00, [124, 58, 237]]],
    [[0.00, [228, 87, 46]], [0.40, [247, 47, 165]], [0.72, [124, 58, 237]], [1.00, [39, 110, 241]]],
    [[0.00, [0, 138, 138]], [0.44, [35, 164, 85]], [0.72, [245, 158, 11]], [1.00, [228, 87, 46]]],
  ];

  return overlayCanvasPlugin((u, ctx) => {
    let xs = u.data[0];
    if (!xs || xs.length < 2)
      return;
    let xScale = u.series[0].scale;
    let {left, top, width, height} = u.bbox;
    ctx.save();
    ctx.beginPath();
    ctx.rect(left, top, width, height);
    ctx.clip();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (let seriesIdx = 1; seriesIdx <= seriesCount; seriesIdx++) {
      let ys = u.data[seriesIdx];
      if (!ys || ys.length < 2)
        continue;
      let yScale = u.series[seriesIdx]?.scale || 'y';
      let palette = palettes[(seriesIdx - 1) % palettes.length];
      ctx.lineWidth = 2.6 + seriesIdx * 0.45;
      for (let i = 0; i < xs.length - 1; i++) {
        let t = i / Math.max(1, xs.length - 2);
        ctx.strokeStyle = stopColor(palette, t);
        ctx.beginPath();
        ctx.moveTo(u.valToPos(xs[i], xScale, true), u.valToPos(ys[i], yScale, true));
        ctx.lineTo(u.valToPos(xs[i + 1], xScale, true), u.valToPos(ys[i + 1], yScale, true));
        ctx.stroke();
      }
    }
    ctx.restore();
  });
}


function bandShadePlugin({upperIdx = 3, lowerIdx = 1, fill = 'rgba(39,110,241,0.16)'} = {}) {
  return {
    hooks: {
      drawClear: [u => {
        let ctx = u.ctx;
        let xs = u.data[0];
        let upper = u.data[upperIdx];
        let lower = u.data[lowerIdx];
        if (!xs || !upper || !lower || xs.length < 2)
          return;
        let xScale = u.series[0].scale;
        let yScale = u.series[upperIdx]?.scale || u.series[lowerIdx]?.scale || 'y';
        let {left, top, width, height} = u.bbox;
        ctx.save();
        ctx.beginPath();
        ctx.rect(left, top, width, height);
        ctx.clip();
        for (let i = 0; i < xs.length - 1; i++) {
          let x0 = u.valToPos(xs[i], xScale, true);
          let x1 = u.valToPos(xs[i + 1], xScale, true);
          let y0u = u.valToPos(upper[i], yScale, true);
          let y1u = u.valToPos(upper[i + 1], yScale, true);
          let y0l = u.valToPos(lower[i], yScale, true);
          let y1l = u.valToPos(lower[i + 1], yScale, true);
          verticalStripFill(ctx, x0, x1, y0u, y1u, y0l, y1l, fill);
        }
        ctx.restore();
      }],
    },
  };
}

function drawSeriesAreaPlugin({seriesIdx = 1, fill = 'rgba(91, 182, 234, 0.16)'} = {}) {
  return {
    hooks: {
      drawClear: [u => {
        let ctx = u.ctx;
        let xs = u.data[0];
        let ys = u.data[seriesIdx];
        if (!xs || !ys || xs.length < 2)
          return;

        let xScale = u.series[0].scale;
        let yScale = u.series[seriesIdx]?.scale || 'y';
        let scale = u.scales[yScale];
        let baseVal = scale.min <= 0 && scale.max >= 0 ? 0 : scale.min;
        let {left, top, width, height} = u.bbox;

        ctx.save();
        ctx.beginPath();
        ctx.rect(left, top, width, height);
        ctx.clip();
        for (let i = 0; i < xs.length - 1; i++) {
          verticalStripFill(
            ctx,
            u.valToPos(xs[i], xScale, true),
            u.valToPos(xs[i + 1], xScale, true),
            u.valToPos(ys[i], yScale, true),
            u.valToPos(ys[i + 1], yScale, true),
            u.valToPos(baseVal, yScale, true),
            u.valToPos(baseVal, yScale, true),
            fill,
          );
        }
        ctx.restore();
      }],
    },
  };
}


function ctxCssScale(ctx) {
  let scale = Number(ctx?.pixelRatio);
  return Number.isFinite(scale) && scale > 0 ? scale : 1;
}

function setOverlayFont(ctx, cssPx = 18, weight = 800) {
  let scale = ctxCssScale(ctx);
  let px = Math.max(12, Math.round(cssPx * scale));
  ctx.font = `${weight} ${px}px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
}

function drawOverlayPanel(ctx, rows, x, y, bounds, color = 'rgba(69, 112, 140, 0.72)') {
  if (!rows?.length)
    return;

  let scale = ctxCssScale(ctx);
  let padX = 14 * scale;
  let padY = 10 * scale;
  let swatch = 12 * scale;
  let gap = 10 * scale;
  let rowH = 28 * scale;
  let edge = 8 * scale;
  let offset = 16 * scale;

  setOverlayFont(ctx, 18, 800);

  let textW = Math.max(...rows.map(row => ctx.measureText(row.text).width));
  let boxW = Math.ceil(textW + padX * 2 + swatch + gap + 4 * scale);
  let boxH = Math.ceil(rows.length * rowH + padY * 2);
  let boxX = x + offset;
  if (boxX + boxW > bounds.left + bounds.width - edge)
    boxX = x - boxW - offset;
  boxX = Math.max(bounds.left + edge, Math.min(bounds.left + bounds.width - boxW - edge, boxX));
  let boxY = Math.max(bounds.top + edge, Math.min(bounds.top + bounds.height - boxH - edge, y - boxH * 0.5));

  ctx.save();
  ctx.shadowColor = 'rgba(15,23,42,0.24)';
  ctx.shadowBlur = 10 * scale;
  ctx.shadowOffsetY = 2 * scale;
  ctx.fillStyle = 'rgba(255,255,255,0.995)';
  ctx.fillRect(boxX, boxY, boxW, boxH);
  ctx.shadowColor = 'rgba(0,0,0,0)';
  ctx.strokeStyle = 'rgba(15, 23, 42, 0.34)';
  ctx.lineWidth = Math.max(1, scale);
  ctx.strokeRect(boxX + 0.5 * scale, boxY + 0.5 * scale, boxW - scale, boxH - scale);

  setOverlayFont(ctx, 18, 800);
  for (let i = 0; i < rows.length; i++) {
    let row = rows[i];
    let cy = boxY + padY + i * rowH + rowH / 2;
    ctx.fillStyle = row.color || color;
    ctx.fillRect(boxX + padX, cy - swatch / 2, swatch, swatch);
    ctx.fillStyle = 'rgba(5, 10, 20, 0.98)';
    ctx.fillText(row.text, boxX + padX + swatch + gap, cy);
  }
  ctx.restore();
}

function cursorGuidePlugin({
  xFrac = 0.58,
  yFrac = 0.36,
  color = 'rgba(69, 112, 140, 0.72)',
  points = [],
  badges = [],
  label = '',
} = {}) {
  return {
    hooks: {
      draw: [u => {
        let ctx = u.ctx;
        let {left, top, width, height} = u.bbox;
        let x = left + width * xFrac;
        let y = top + height * yFrac;

        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.2;
        ctx.setLineDash([4, 4]);

        ctx.beginPath();
        ctx.moveTo(x, top);
        ctx.lineTo(x, top + height);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(left, y);
        ctx.lineTo(left + width, y);
        ctx.stroke();

        ctx.setLineDash([]);
        for (let point of points) {
          let px = left + width * point.x;
          let py = top + height * point.y;
          ctx.fillStyle = point.color || color;
          ctx.beginPath();
          ctx.arc(px, py, point.r || 4, 0, Math.PI * 2);
          ctx.fill();
        }

        let rows = [];
        if (label)
          rows.push({text: label, color});
        rows.push(...badges);
        if (rows.length)
          drawOverlayPanel(ctx, rows, x, y, {left, top, width, height}, color);
        ctx.restore();
      }],
    },
  };
}

function lineStyleBackplatePlugin() {
  return {
    hooks: {
      drawClear: [u => {
        let ctx = u.ctx;
        let {left, top, width, height} = u.bbox;
        ctx.save();
        ctx.fillStyle = 'rgba(39, 110, 241, 0.04)';
        ctx.fillRect(left, top + height * 0.12, width, height * 0.18);
        ctx.fillStyle = 'rgba(35, 164, 85, 0.04)';
        ctx.fillRect(left, top + height * 0.58, width, height * 0.20);
        ctx.restore();
      }],
    },
  };
}


function benchmarkBarsPlugin() {
  const labels = ['Flot', 'CanvasJS', 'Lightning', 'jqChart', 'Highcharts', 'Chart.js', 'ECharts'];
  const metrics = [
    {label: 'Lib Size', color: '#3fba58', values: [404, 448, 883, 273, 285, 278, 734]},
    {label: 'Render', color: '#9b59b6', values: [40.0, 51.0, 49.0, 63.7, 47.9, 87.4, 108.8]},
    {label: 'Heap', color: '#c8173f', values: [23.4, 34.9, 38.0, 88.9, 23.5, 94.0, 111.0]},
    {label: 'Final Heap', color: '#f1a22d', values: [11.2, 24.8, 10.4, 52.4, 210.0, 75.0, 75.0]},
    {label: 'Interact', color: '#4e8ab8', values: [0, 4395, 9903, 162, 2463, 9020, 9704]},
    {label: 'Toggle', color: '#f0d05a', values: [0, 11.9, 119.0, 150.0, 0, 4536.0, 0]},
  ];
  return {
    hooks: {
      drawClear: [u => {
        let ctx = u.ctx;
        let {left, top, width, height} = u.bbox;
        ctx.save();
        ctx.beginPath();
        ctx.rect(left, top, width, height);
        ctx.clip();
        ctx.fillStyle = 'rgba(255,255,255,0)';
        ctx.fillRect(left, top, width, height);

        let maxVal = 10000;
        let groupW = width / labels.length;
        let barGap = Math.max(1, groupW * 0.035);
        let barW = Math.max(3, (groupW * 0.70 - barGap * (metrics.length - 1)) / metrics.length);
        let baseline = top + height * 0.90;
        let usableH = height * 0.70;

        ctx.font = '10px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        for (let gi = 0; gi < labels.length; gi++) {
          let gx = left + gi * groupW + groupW * 0.15;
          for (let mi = 0; mi < metrics.length; mi++) {
            let raw = metrics[mi].values[gi] || 0;
            let v = Math.max(0, Math.min(1, raw / maxVal));
            let h = Math.max(raw > 0 ? 3 : 0, usableH * v);
            let x = gx + mi * (barW + barGap);
            let y = baseline - h;
            ctx.fillStyle = metrics[mi].color;
            ctx.fillRect(x, y, barW, h);
            if (raw > 0 && (raw >= 250 || mi < 4)) {
              ctx.fillStyle = 'rgba(25,25,25,0.75)';
              ctx.fillText(String(Math.round(raw * 10) / 10), x + barW / 2, y - 2);
            }
          }
          ctx.fillStyle = 'rgba(25,25,25,0.85)';
          ctx.save();
          ctx.translate(left + gi * groupW + groupW * 0.50, baseline + 16);
          ctx.rotate(-0.25);
          ctx.fillText(labels[gi], 0, 0);
          ctx.restore();
        }
        ctx.restore();
      }],
    },
  };
}


function sparklineCardPlugin() {
  return overlayCanvasPlugin((u, ctx) => {
    let {left, top, width, height} = u.bbox;
    let pts = 128;
    let values = [];
    for (let i = 0; i < pts; i++) {
      let t = i / (pts - 1);
      values.push(0.54 + 0.28 * Math.sin(t * Math.PI * 2 + 0.25) + 0.08 * Math.cos(t * Math.PI * 3.1));
    }
    let min = Math.min(...values);
    let max = Math.max(...values);
    let padX = width * 0.035;
    let padY = height * 0.18;
    let x0 = left + padX;
    let yBase = top + height - padY;
    let w = width - padX * 2;
    let h = height - padY * 2;
    let xy = values.map((v, i) => [x0 + w * i / (pts - 1), yBase - ((v - min) / Math.max(1e-6, max - min)) * h]);
    ctx.save();
    ctx.beginPath();
    ctx.rect(left, top, width, height);
    ctx.clip();
    ctx.fillStyle = 'rgba(91, 182, 234, 0.18)';
    fillAreaWithStrips(ctx, xy, yBase, ctx.fillStyle);
    ctx.strokeStyle = '#276ef1';
    ctx.lineWidth = 3;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (let i = 0; i < xy.length; i++) {
      let p = xy[i];
      if (i == 0) ctx.moveTo(p[0], p[1]);
      else ctx.lineTo(p[0], p[1]);
    }
    ctx.stroke();
    ctx.restore();
  });
}



function heatmapBinsPlugin({cols = 90, rows = 55} = {}) {
  function mix(a, b, t) {
    return [
      Math.round(a[0] + (b[0] - a[0]) * t),
      Math.round(a[1] + (b[1] - a[1]) * t),
      Math.round(a[2] + (b[2] - a[2]) * t),
    ];
  }
  function colorFor(v) {
    let c1 = [57, 206, 234];
    let c2 = [38, 151, 237];
    let c3 = [60, 84, 241];
    let c4 = [169, 66, 245];
    let c5 = [247, 47, 165];
    let c6 = [255, 56, 56];
    let c;
    if (v < 0.22) c = mix(c1, c2, v / 0.22);
    else if (v < 0.42) c = mix(c2, c3, (v - 0.22) / 0.20);
    else if (v < 0.64) c = mix(c3, c4, (v - 0.42) / 0.22);
    else if (v < 0.84) c = mix(c4, c5, (v - 0.64) / 0.20);
    else c = mix(c5, c6, (v - 0.84) / 0.16);
    return `rgba(${c[0]}, ${c[1]}, ${c[2]}, 0.92)`;
  }
  return overlayCanvasPlugin((u, ctx) => {
    let {left, top, width, height} = u.bbox;
    let cellW = width / cols;
    let cellH = height / rows;
    ctx.save();
    ctx.beginPath();
    ctx.rect(left, top, width, height);
    ctx.clip();
    for (let y = 0; y < rows; y++) {
      let yNorm = y / (rows - 1);
      let center = Math.exp(-Math.pow((yNorm - 0.28) / 0.11, 2)) * 1.0;
      let shoulder = Math.exp(-Math.pow((yNorm - 0.42) / 0.15, 2)) * 0.55;
      let tail = Math.exp(-Math.pow((yNorm - 0.58) / 0.16, 2)) * 0.18;
      for (let x = 0; x < cols; x++) {
        let xNorm = x / (cols - 1);
        let drift = 0.06 * Math.sin(xNorm * Math.PI * 8.5 + y * 0.14);
        let ripple = 0.05 * Math.sin(x * 0.33 + y * 0.26) + 0.03 * Math.cos(x * 0.19 - y * 0.08);
        let dropout = 0.09 * (Math.sin(x * 1.77 + y * 0.91) > 0.83 ? 1 : 0);
        let v = Math.max(0, Math.min(1, center + shoulder + tail + drift + ripple - dropout));
        if (v < 0.17)
          continue;
        let rx = left + x * cellW;
        let ry = top + height - (y + 1) * cellH;
        ctx.fillStyle = colorFor(v);
        ctx.fillRect(rx, ry, Math.max(1, cellW), Math.max(1, cellH));
      }
    }
    ctx.restore();
  });
}



function wheelZoomCompatibilityPlugin({factor = 0.82} = {}) {
  let cleanup = new WeakMap();

  return {
    hooks: {
      ready: [u => {
        let over = u.over;
        if (!over)
          return;

        let resetState = {
          x: {min: u.scales.x?.min, max: u.scales.x?.max},
          y: {min: u.scales.y?.min, max: u.scales.y?.max},
        };

        let hint = document.createElement('div');
        hint.className = 'bench-interaction-badge';
        hint.textContent = 'wheel zoom / double-click reset';
        hint.style.position = 'absolute';
        hint.style.right = '8px';
        hint.style.top = '8px';
        hint.style.zIndex = '4';
        hint.style.padding = '4px 7px';
        hint.style.borderRadius = '999px';
        hint.style.background = 'rgba(255,255,255,0.88)';
        hint.style.border = '1px solid rgba(15,23,42,0.16)';
        hint.style.font = '11px system-ui, sans-serif';
        hint.style.pointerEvents = 'none';
        over.appendChild(hint);

        let zoomScale = (key, frac, mult) => {
          let sc = u.scales?.[key];
          if (!sc || !Number.isFinite(sc.min) || !Number.isFinite(sc.max) || sc.max <= sc.min)
            return;
          let span = sc.max - sc.min;
          let nextSpan = Math.max(span * 0.02, span * mult);
          let center = sc.min + span * frac;
          let min = center - nextSpan * frac;
          let max = min + nextSpan;
          u.setScale(key, {min, max});
        };

        let wheel = event => {
          let rect = over.getBoundingClientRect();
          let xFrac = Math.max(0, Math.min(1, (event.clientX - rect.left) / Math.max(1, rect.width)));
          let yFrac = Math.max(0, Math.min(1, 1 - (event.clientY - rect.top) / Math.max(1, rect.height)));
          let mult = event.deltaY < 0 ? factor : 1 / factor;
          zoomScale('x', xFrac, mult);
          if (event.shiftKey || event.altKey)
            zoomScale('y', yFrac, mult);
          event.preventDefault?.();
        };

        let reset = () => {
          if (Number.isFinite(resetState.x.min) && Number.isFinite(resetState.x.max))
            u.setScale('x', resetState.x);
          if (Number.isFinite(resetState.y.min) && Number.isFinite(resetState.y.max))
            u.setScale('y', resetState.y);
        };

        over.addEventListener('wheel', wheel, {passive: false});
        over.addEventListener('dblclick', reset);
        cleanup.set(u, () => {
          over.removeEventListener('wheel', wheel);
          over.removeEventListener('dblclick', reset);
          hint.remove();
        });
      }],
      destroy: [u => {
        cleanup.get(u)?.();
        cleanup.delete(u);
      }],
    },
  };
}

function yScaleDragCompatibilityPlugin() {
  let cleanup = new WeakMap();

  return {
    hooks: {
      ready: [u => {
        let over = u.over;
        if (!over)
          return;

        let badge = document.createElement('div');
        badge.className = 'bench-interaction-badge';
        badge.textContent = 'drag vertically to pan y / alt-drag zoom y';
        badge.style.position = 'absolute';
        badge.style.left = '8px';
        badge.style.top = '8px';
        badge.style.zIndex = '4';
        badge.style.padding = '4px 7px';
        badge.style.borderRadius = '999px';
        badge.style.background = 'rgba(255,255,255,0.88)';
        badge.style.border = '1px solid rgba(15,23,42,0.16)';
        badge.style.font = '11px system-ui, sans-serif';
        badge.style.pointerEvents = 'none';
        over.appendChild(badge);

        let drag = null;

        let start = event => {
          if (event.button != null && event.button !== 0)
            return;
          let sc = u.scales?.y;
          if (!sc || !Number.isFinite(sc.min) || !Number.isFinite(sc.max) || sc.max <= sc.min)
            return;
          drag = {y: event.clientY, min: sc.min, max: sc.max, alt: !!event.altKey};
          over.setPointerCapture?.(event.pointerId);
          event.preventDefault?.();
        };

        let move = event => {
          if (drag == null)
            return;
          let rect = over.getBoundingClientRect();
          let span = drag.max - drag.min;
          let dy = (event.clientY - drag.y) / Math.max(1, rect.height);
          if (drag.alt || event.altKey) {
            let mult = Math.exp(dy * 2.4);
            let center = (drag.min + drag.max) / 2;
            let nextSpan = Math.max(span * 0.02, span * mult);
            u.setScale('y', {min: center - nextSpan / 2, max: center + nextSpan / 2});
          }
          else {
            let delta = dy * span;
            u.setScale('y', {min: drag.min + delta, max: drag.max + delta});
          }
          event.preventDefault?.();
        };

        let end = event => {
          if (drag == null)
            return;
          drag = null;
          try { over.releasePointerCapture?.(event.pointerId); }
          catch (err) {}
        };

        over.addEventListener('pointerdown', start);
        over.addEventListener('pointermove', move);
        over.addEventListener('pointerup', end);
        over.addEventListener('pointercancel', end);

        cleanup.set(u, () => {
          over.removeEventListener('pointerdown', start);
          over.removeEventListener('pointermove', move);
          over.removeEventListener('pointerup', end);
          over.removeEventListener('pointercancel', end);
          badge.remove();
        });
      }],
      destroy: [u => {
        cleanup.get(u)?.();
        cleanup.delete(u);
      }],
    },
  };
}

function sparseNearestMarkerPlugin({seriesIdx = 1} = {}) {
  return {
    hooks: {
      draw: [u => {
        let xs = u.data?.[0];
        let ys = u.data?.[seriesIdx];
        if (!xs || !ys)
          return;
        let ctx = u.ctx;
        let {left, top, width, height} = u.bbox;
        let xScale = u.series[0].scale;
        let yScale = u.series[seriesIdx]?.scale || 'y';

        ctx.save();
        ctx.beginPath();
        ctx.rect(left, top, width, height);
        ctx.clip();
        ctx.fillStyle = 'rgba(39,110,241,0.80)';
        ctx.strokeStyle = 'rgba(39,110,241,0.35)';
        ctx.lineWidth = 1;

        let drawn = 0;
        for (let i = 0; i < xs.length; i++) {
          let yv = ys[i];
          if (yv == null || !Number.isFinite(Number(yv)))
            continue;
          if (i % 8 != 0)
            continue;
          let x = u.valToPos(xs[i], xScale, true);
          let y = u.valToPos(yv, yScale, true);
          ctx.beginPath();
          ctx.arc(x, y, 3.5, 0, Math.PI * 2);
          ctx.fill();
          drawn++;
        }

        ctx.fillStyle = 'rgba(255,255,255,0.88)';
        ctx.fillRect(left + 8, top + 8, 174, 25);
        ctx.strokeStyle = 'rgba(39,110,241,0.38)';
        ctx.strokeRect(left + 8, top + 8, 174, 25);
        ctx.fillStyle = 'rgba(15,23,42,0.78)';
        ctx.font = '11px system-ui, sans-serif';
        ctx.textBaseline = 'middle';
        ctx.fillText(`${drawn} sampled non-null markers`, left + 16, top + 21);
        ctx.restore();
      }],
    },
  };
}


function interactiveCursorPlugin({
  items = [],
  xLabel = 'x',
  color = 'rgba(69, 112, 140, 0.72)',
  valueFormatter = v => Number.isFinite(v) ? String(Math.round(v * 10) / 10) : '',
  xFormatter = (v, idx) => Number.isFinite(v) ? String(Math.round(v * 10) / 10) : String(idx),
  defaultIdxFrac = 0.58,
} = {}) {
  let tips = new WeakMap();

  function ensureTip(u) {
    if (!u?.over)
      return null;

    let tip = tips.get(u);
    if (tip?.isConnected)
      return tip;

    tip = document.createElement('div');
    tip.className = 'bench-value-tooltip is-hidden';
    u.over.appendChild(tip);
    tips.set(u, tip);
    return tip;
  }

  function renderRows(tip, rows) {
    tip.textContent = '';
    for (let i = 0; i < rows.length; i++) {
      let row = rows[i];
      let el = document.createElement('div');
      el.className = 'bench-value-tooltip-row' + (i == 0 ? ' is-x' : '');
      if (i == 0) {
        el.textContent = row.text;
      }
      else {
        let swatch = document.createElement('span');
        swatch.className = 'bench-value-tooltip-swatch';
        swatch.style.color = row.color || color;
        let text = document.createElement('span');
        text.textContent = row.text;
        el.append(swatch, text);
      }
      tip.appendChild(el);
    }
  }

  function update(u, useDefault = false) {
    let tip = ensureTip(u);
    if (!tip)
      return;

    let xs = u.data[0];
    if (!xs?.length) {
      tip.classList.add('is-hidden');
      return;
    }

    let idx = Number.isInteger(u.cursor?.idx) ? u.cursor.idx : null;
    let x = Number.isFinite(u.cursor?.left) ? u.cursor.left : null;

    if ((idx == null || x == null) && (useDefault || defaultIdxFrac != null)) {
      idx = Math.max(0, Math.min(xs.length - 1, Math.round((xs.length - 1) * (defaultIdxFrac ?? 0.5))));
      x = u.valToPos(xs[idx], u.series[0].scale, false);
    }

    if (idx == null || x == null || !Number.isFinite(x)) {
      tip.classList.add('is-hidden');
      return;
    }

    idx = Math.max(0, Math.min(xs.length - 1, idx));
    let xVal = xs[idx];
    let rows = [{text: `${xLabel}: ${xFormatter(xVal, idx)}`, color}];
    let ySum = 0;
    let yCount = 0;

    for (let item of items) {
      let seriesIdx = item.seriesIdx;
      let ys = u.data[seriesIdx];
      let value = ys?.[idx];
      if (!Number.isFinite(value))
        continue;
      let yScale = u.series[seriesIdx]?.scale || 'y';
      let y = u.valToPos(value, yScale, false);
      if (Number.isFinite(y)) {
        ySum += y;
        yCount++;
      }
      rows.push({
        text: `${item.label || u.series[seriesIdx]?.label || `s${seriesIdx}`}: ${valueFormatter(value)}`,
        color: item.color || u.series[seriesIdx]?.stroke || color,
      });
    }

    if (rows.length <= 1) {
      tip.classList.add('is-hidden');
      return;
    }

    renderRows(tip, rows);
    tip.classList.remove('is-hidden');

    let overW = u.over.clientWidth || u.bbox.width || 1;
    let overH = u.over.clientHeight || u.bbox.height || 1;
    let anchorY = Number.isFinite(u.cursor?.top) ? u.cursor.top : (yCount ? ySum / yCount : overH * 0.25);
    let boxW = tip.offsetWidth || 220;
    let boxH = tip.offsetHeight || 120;
    let edge = 10;
    let offset = 18;
    let left = x + offset;
    if (left + boxW > overW - edge)
      left = x - boxW - offset;
    left = Math.max(edge, Math.min(overW - boxW - edge, left));
    let top = Math.max(edge, Math.min(overH - boxH - edge, anchorY - boxH * 0.5));

    tip.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
  }

  return {
    hooks: {
      init: [u => {
        ensureTip(u);
      }],
      ready: [u => {
        update(u, true);
      }],
      setCursor: [u => {
        update(u, false);
      }],
      setSize: [u => {
        update(u, true);
      }],
      destroy: [u => {
        let tip = tips.get(u);
        tip?.remove();
        tips.delete(u);
      }],
    },
  };
}

function classifyDemo(name) {
  if (name.includes('bar')) return 'bars';
  if (name.includes('box')) return 'box';
  if (name.includes('candlestick') || name.includes('ohlc')) return 'ohlc';
  if (name.includes('heatmap')) return 'heatmap';
  if (name.includes('band') || name.includes('high-low') || name.includes('temp')) return 'bands';
  if (name.includes('scatter') || name.includes('points')) return 'points';
  if (name.includes('sparse') || name.includes('missing') || name.includes('nearest')) return 'missing';
  if (name.includes('stream') || name.includes('sine')) return 'stream';
  if (name.includes('trendline')) return 'trendline';
  if (name.includes('cursor') || name.includes('focus')) return 'cursor';
  if (name.includes('hook') || name.includes('annotation') || name.includes('tooltip')) return 'plugin';
  if (name.includes('log') || name.includes('arcsinh')) return 'scale';
  if (name.includes('zoom') || name.includes('sync') || name.includes('resize') || name.includes('scale') || name.includes('axis')) return 'interaction';
  if (name.includes('gradient') || name.includes('fill')) return 'area';
  if (name.includes('sparkline')) return 'sparkline';
  return 'line';
}

function specForName(name, origin, index, heavy) {
  let kind = origin == 'bench' ? 'bench' : classifyDemo(name);
  let points = 260 + (index % 8) * 40;
  let series = 2 + (index % 3);
  let variant = 'line';
  let extra = {};

  if (kind == 'bars') {
    points = 80;
    series = name.includes('stack') || name.includes('multi') || name.includes('grouped') ? 4 : 2;
    variant = 'bar';
    extra.bars = true;
    extra.fill = true;
    extra.rounded = false;
  }
  else if (kind == 'ohlc') {
    points = 140;
    series = 4;
    variant = 'ohlc';
    extra.showPoints = false;
    extra.width = 1;
    extra.hideSeries = true;
    Object.assign(extra, candlestickPlugin());
  }
  else if (kind == 'box') {
    points = 120;
    series = 1;
    variant = 'trend';
    extra.showPoints = false;
    extra.width = 0;
    extra.hideSeries = true;
    Object.assign(extra, boxWhiskerPlugin());
  }
  else if (kind == 'heatmap') {
    points = 160;
    series = 1;
    variant = 'hidden';
    extra.hideSeries = true;
    extra.legend = false;
    extra.grid = false;
    extra.axesShow = false;
    extra.hooks = heatmapPlugin().hooks;
  }
  else if (kind == 'bands') {
    points = 240;
    series = 3;
    extra.fill = false;
    extra.bands = [{series: [1, 3], fill: 'rgba(39,110,241,0.12)'}];
  }
  else if (kind == 'points') {
    points = 320;
    series = 2;
    variant = 'scatter';
    extra.showPoints = true;
    extra.width = 0;
  }
  else if (kind == 'missing') {
    points = 360;
    series = 3;
    variant = 'missing';
  }
  else if (kind == 'stream') {
    points = 420;
    series = 3;
    variant = 'trend';
    extra.stream = true;
  }
  else if (kind == 'trendline') {
    points = 280;
    series = 2;
    variant = 'trend';
    extra.fill = true;
    Object.assign(extra, trendlinePlugin());
  }
  else if (kind == 'cursor') {
    points = 260;
    series = 3;
    variant = 'trend';
    extra.fill = true;
    extra.cursorFocus = true;
    Object.assign(extra, cursorFocusPlugin());
  }
  else if (kind == 'plugin') {
    points = 260;
    series = 2;
    Object.assign(extra, pluginDrawCase());
  }
  else if (kind == 'scale') {
    points = 240;
    series = 2;
    variant = name.includes('log') ? 'bar' : 'spike';
    extra.scales = {x: {time: false}, y: {distr: name.includes('log') ? 3 : 4}};
  }
  else if (kind == 'interaction') {
    points = 280;
    series = 2;
    variant = 'trend';
  }
  else if (kind == 'area') {
    points = 340;
    series = 2;
    variant = 'trend';
    extra.fill = true;
    extra.gradientFill = name.includes('gradient');
    extra.strokeGradient = name.includes('gradient');
  }
  else if (kind == 'sparkline') {
    points = 80;
    series = 1;
    extra.axesShow = false;
    extra.legend = false;
    if (name.includes('bars')) {
      extra.bars = true;
      variant = 'bar';
    }
  }

  if (origin == 'bench') {
    kind = 'bench';
    points = heavy ? 2500 : 700;
    series = 3;
    variant = name.includes('sine-stream') ? 'trend' : 'line';
    if (name.includes('10M'))
      points = heavy ? 1000000 : 50000;
    if (name.includes('600-series')) {
      points = heavy ? 900 : 220;
      series = heavy ? 160 : 40;
    }
    if (name.includes('stream'))
      extra.stream = true;
  }

  return {
    id: `${origin}:${name}`,
    title: `${origin} / ${name}`,
    kind,
    points,
    series,
    variant,
    ...extra,
  };
}



function candlestickPlugin() {
  return overlayCanvasPlugin((u, ctx) => {
    let data = u.data;
    let xs = data[0];
    let open = data[1];
    let high = data[2];
    let low = data[3];
    let close = data[4];
    let {left, top, width, height} = u.bbox;
    let xScale = u.series[0].scale;
    let yScale = u.series[1]?.scale || 'y';
    let visible = Math.max(1, xs.length - 1);
    let bodyW = Math.max(3, Math.min(10, width / visible * 0.58));

    ctx.save();
    ctx.beginPath();
    ctx.rect(left, top, width, height);
    ctx.clip();
    ctx.lineWidth = 1.35;
    for (let i = 0; i < xs.length; i++) {
      let x = Math.round(u.valToPos(xs[i], xScale, true));
      if (x < left - bodyW || x > left + width + bodyW)
        continue;
      let yOpen = u.valToPos(open[i], yScale, true);
      let yHigh = u.valToPos(high[i], yScale, true);
      let yLow = u.valToPos(low[i], yScale, true);
      let yClose = u.valToPos(close[i], yScale, true);
      let up = close[i] >= open[i];
      let stroke = up ? '#23a455' : '#e4572e';
      let fill = up ? 'rgba(35,164,85,0.42)' : 'rgba(228,87,46,0.42)';
      let bodyTop = Math.min(yOpen, yClose);
      let bodyH = Math.max(1, Math.abs(yOpen - yClose));

      ctx.strokeStyle = stroke;
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.moveTo(x, yHigh);
      ctx.lineTo(x, yLow);
      ctx.stroke();

      ctx.beginPath();
      ctx.rect(x - bodyW / 2, bodyTop, bodyW, bodyH);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  });
}


function makeCircularLiveData(points = 500000) {
  let x = new Float64Array(points);
  let yA = new Float64Array(points);
  let yB = new Float64Array(points);
  let source = new Float64Array(points);
  let tau = Math.PI * 2;
  for (let i = 0; i < points; i++) {
    x[i] = i;
    let t = i / Math.max(1, points - 1);
    let mean = 130 + 42 * Math.sin(tau * t * 2.15) + 18 * Math.sin(tau * t * 0.37 + 0.7);
    let amp = 10 + 46 * Math.pow(0.5 + 0.5 * Math.sin(tau * t * 6.5 - 0.8), 1.35);
    let carrier = Math.sin(i / 1850) + 0.48 * Math.sin(i / 530 + 1.7) + 0.22 * Math.cos(i / 137 + 0.2);
    let slowNoise = 4.5 * Math.sin(i / 73) + 2.4 * Math.cos(i / 41);
    let spike = (i % 17389 == 0 ? 84 : 0) + (i % 31847 == 0 ? -62 : 0) + (i % 48109 == 0 ? 45 : 0);
    source[i] = mean + amp * carrier + slowNoise + spike;
    yA[i] = source[i];
    yB[i] = source[i];
  }
  return {x, y: yA, yA, yB, source, swap: false, data: [x, yA]};
}

function rotateInto(dst, src, offset) {
  let n = src.length;
  if (!n)
    return;
  offset = ((offset % n) + n) % n;
  if (offset == 0) {
    dst.set(src);
    return;
  }
  let first = n - offset;
  dst.set(src.subarray(offset), 0);
  dst.set(src.subarray(0, offset), first);
}

function createCircularOffsetWorker() {
  let code = `
let running = false;
let points = 500000;
let step = 8192;
let offset = 0;
let seq = 0;
let timer = 0;
let targetMs = 16;
let last = 0;
function tick() {
  if (!running)
    return;
  let now = performance.now();
  let elapsed = last ? Math.max(1, now - last) : targetMs;
  last = now;
  let frames = Math.max(1, elapsed / Math.max(1, targetMs));
  offset = (offset + Math.max(1, Math.round(step * frames))) % points;
  postMessage({type: 'tick', offset, seq: ++seq, now});
  timer = setTimeout(tick, targetMs);
}
onmessage = event => {
  let msg = event.data || {};
  if (msg.type == 'start') {
    points = Math.max(1, msg.points || points);
    step = Math.max(1, msg.step || step);
    targetMs = Math.max(1, msg.targetMs ?? targetMs);
    offset = msg.offset || 0;
    seq = 0;
    last = 0;
    running = true;
    clearTimeout(timer);
    tick();
  }
  else if (msg.type == 'stop') {
    running = false;
    clearTimeout(timer);
  }
};
`;
  let blob = new Blob([code], {type: 'text/javascript'});
  return new Worker(URL.createObjectURL(blob));
}


function createOffscreenRendererWorker() {
  let code = `
let canvas = null;
let ctx = null;
let gpu = null;
let engineKey = 'canvas2d';
let rendererPath = 'worker';
let width = 1;
let height = 1;
let pixelRatio = 1;
let points = 500000;
let step = 8192;
let offset = 0;
let durationMs = 10000;
let running = false;
let source = null;
let yMin = 0;
let yMax = 1;
let startedAt = 0;
let frames = 0;
let updateMs = 0;
let maxUpdateMs = 0;
let initMs = 0;
let firstMs = 0;
let zoomMin = 0;
let zoomMax = 1;
let timerId = 0;
let rafId = 0;
let targetFrameMs = 16.6667;
let framePacing = 'timeout-16ms';
let lastFrameAt = 0;
let lastStatsAt = 0;
let scrollSamplesPerSecond = 8192 * 60;
let presentationMode = 'direct';
let postedBitmaps = 0;
let styleMode = 'line';
let bufferCount = 1;
let heatmapCols = 256;
let heatmapRows = 128;

function now() {
  return performance.now();
}

function scheduleFrame() {
  cancelFrame();
  if (typeof self.requestAnimationFrame == 'function') {
    framePacing = 'worker-requestAnimationFrame';
    rafId = self.requestAnimationFrame(() => {
      rafId = 0;
      drawFrame();
    });
    return;
  }
  let delay = Math.max(1, Number(targetFrameMs) || 16.6667);
  framePacing = 'worker-timeout-' + delay.toFixed(1) + 'ms';
  timerId = setTimeout(drawFrame, delay);
}

function cancelFrame() {
  if (rafId && typeof self.cancelAnimationFrame == 'function') {
    try { self.cancelAnimationFrame(rafId); }
    catch (err) {}
  }
  rafId = 0;
  clearTimeout(timerId);
  timerId = 0;
}

function makeSignal(n, buffers) {
  buffers = Math.max(1, buffers || 1);
  let out = new Float32Array(n * buffers);
  let tau = Math.PI * 2;
  let lo = Infinity;
  let hi = -Infinity;
  for (let b = 0; b < buffers; b++) {
    let phase = b * 0.37;
    let base = b * n;
    for (let i = 0; i < n; i++) {
      let t = i / Math.max(1, n - 1);
      let average = 128 + 56 * Math.sin(tau * (t * 1.2 + phase * 0.17)) + 28 * Math.sin(tau * t * 0.19 + 1.2 + phase);
      let amp = 14 + 82 * Math.pow(0.5 + 0.5 * Math.sin(tau * t * 5.0 - 0.4 + phase), 1.55);
      let carrier = Math.sin(i / (1480 - b * 67)) + 0.58 * Math.sin(i / (341 + b * 29) + 1.1 + phase) + 0.25 * Math.cos(i / 79 + 0.2 + phase);
      let texture = 5.5 * Math.sin(i / 23 + phase) + 2.0 * Math.cos(i / 11 + phase * 1.9);
      let spike = (i % (12103 + b * 307) == 0 ? 130 : 0) + (i % (28181 + b * 503) == 0 ? -95 : 0) + (i % (53377 + b * 701) == 0 ? 68 : 0);
      let v = average + amp * carrier + texture + spike + b * 9;
      out[base + i] = v;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  }
  yMin = lo;
  yMax = hi;
  return out;
}

function visibleWindow() {
  let n = Math.max(2, points);
  let visibleMin = Math.max(0, Math.min(1, zoomMin));
  let visibleMax = Math.max(visibleMin + 1 / n, Math.min(1, zoomMax));
  let startIndex = Math.max(0, Math.floor(visibleMin * (n - 1)));
  let endIndex = Math.min(n - 1, Math.ceil(visibleMax * (n - 1)));
  return {startIndex, endIndex, count: Math.max(2, endIndex - startIndex + 1)};
}

function plotBox() {
  let marginL = 52 * pixelRatio;
  let marginR = 18 * pixelRatio;
  let marginT = 20 * pixelRatio;
  let marginB = 38 * pixelRatio;
  return {
    left: marginL,
    top: marginT,
    width: Math.max(16, width - marginL - marginR),
    height: Math.max(16, height - marginT - marginB),
  };
}

function drawBackground2d(plot) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = 'rgba(39, 110, 241, 0.055)';
  ctx.fillRect(plot.left, plot.top, plot.width, plot.height);
  ctx.strokeStyle = 'rgba(102, 112, 133, 0.23)';
  ctx.lineWidth = Math.max(1, pixelRatio);
  ctx.beginPath();
  for (let i = 0; i <= 6; i++) {
    let x = plot.left + plot.width * i / 6;
    ctx.moveTo(x, plot.top);
    ctx.lineTo(x, plot.top + plot.height);
  }
  for (let i = 0; i <= 4; i++) {
    let y = plot.top + plot.height * i / 4;
    ctx.moveTo(plot.left, y);
    ctx.lineTo(plot.left + plot.width, y);
  }
  ctx.stroke();
  ctx.strokeStyle = 'rgba(20, 24, 30, 0.72)';
  ctx.lineWidth = Math.max(1, pixelRatio * 1.15);
  ctx.beginPath();
  ctx.moveTo(plot.left, plot.top);
  ctx.lineTo(plot.left, plot.top + plot.height);
  ctx.lineTo(plot.left + plot.width, plot.top + plot.height);
  ctx.stroke();
}

function drawWorkerBadge2d(plot) {
  let w = Math.max(190 * pixelRatio, plot.width * 0.27);
  let h = 30 * pixelRatio;
  let x = plot.left + 10 * pixelRatio;
  let y = plot.top + 10 * pixelRatio;
  let isGpu = engineKey == 'webgpu';
  ctx.fillStyle = isGpu ? 'rgba(39, 110, 241, 0.15)' : 'rgba(228, 87, 46, 0.14)';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = isGpu ? 'rgba(39, 110, 241, 0.52)' : 'rgba(228, 87, 46, 0.48)';
  ctx.lineWidth = Math.max(1, pixelRatio);
  ctx.strokeRect(x, y, w, h);
  ctx.fillStyle = '#1d2939';
  ctx.font = String(Math.max(11, 12 * pixelRatio)) + 'px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
  ctx.textBaseline = 'middle';
  ctx.fillText((isGpu ? 'WebGPU worker' : 'Canvas2D worker') + ' ' + points.toLocaleString() + ' ' + styleMode, x + 8 * pixelRatio, y + h / 2);
}

function sampleSourceValue(seriesIndex, logicalIndex) {
  let n = Math.max(1, points);
  let b = Math.max(0, Math.min(bufferCount - 1, seriesIndex || 0));
  let srcIndex = (Math.floor(logicalIndex) + Math.floor(offset) + b * Math.floor(n * 0.071)) % n;
  return source[b * n + srcIndex];
}

function projectY(plot, v) {
  let lo = yMin;
  let hi = yMax;
  let range = Math.max(1e-9, hi - lo);
  return plot.top + plot.height - ((v - lo) / range) * plot.height;
}

function drawSignalLine2d(plot, seriesIndex, stroke, widthMul, dash) {
  let win = visibleWindow();
  let maxDraw = Math.min(win.count, styleMode == 'multi-line' ? 90000 : 140000);
  let stride = Math.max(1, Math.floor(win.count / maxDraw));
  let drawCount = Math.max(2, Math.ceil(win.count / stride));
  let xStep = plot.width / Math.max(1, drawCount - 1);
  ctx.strokeStyle = stroke;
  ctx.lineWidth = Math.max(1, widthMul * pixelRatio);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.setLineDash(dash ? dash.map(v => v * pixelRatio) : []);
  ctx.beginPath();
  for (let j = 0, d = 0; j < win.count; j += stride, d++) {
    let i = win.startIndex + j;
    let v = sampleSourceValue(seriesIndex, i);
    let x = plot.left + d * xStep;
    let y = projectY(plot, v);
    if (d == 0)
      ctx.moveTo(x, y);
    else
      ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawArea2d(plot) {
  let win = visibleWindow();
  let maxDraw = Math.min(win.count, 90000);
  let stride = Math.max(1, Math.floor(win.count / maxDraw));
  let drawCount = Math.max(2, Math.ceil(win.count / stride));
  let xStep = plot.width / Math.max(1, drawCount - 1);
  let grad = ctx.createLinearGradient(0, plot.top, 0, plot.top + plot.height);
  grad.addColorStop(0, 'rgba(39,110,241,0.36)');
  grad.addColorStop(0.55, 'rgba(91,182,234,0.18)');
  grad.addColorStop(1, 'rgba(39,110,241,0.02)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(plot.left, plot.top + plot.height);
  for (let j = 0, d = 0; j < win.count; j += stride, d++) {
    let i = win.startIndex + j;
    let x = plot.left + d * xStep;
    let y = projectY(plot, sampleSourceValue(0, i));
    ctx.lineTo(x, y);
  }
  ctx.lineTo(plot.left + plot.width, plot.top + plot.height);
  ctx.closePath();
  ctx.fill();
  drawSignalLine2d(plot, 0, '#276ef1', 1.2, null);
}

function drawBand2d(plot) {
  let win = visibleWindow();
  let maxDraw = Math.min(win.count, 80000);
  let stride = Math.max(1, Math.floor(win.count / maxDraw));
  let drawCount = Math.max(2, Math.ceil(win.count / stride));
  let xStep = plot.width / Math.max(1, drawCount - 1);
  let upper = [];
  let lower = [];
  for (let j = 0, d = 0; j < win.count; j += stride, d++) {
    let i = win.startIndex + j;
    let x = plot.left + d * xStep;
    let v = sampleSourceValue(0, i);
    let spread = 18 + 16 * (0.5 + 0.5 * Math.sin((i + offset) / 1300));
    upper.push([x, projectY(plot, v + spread)]);
    lower.push([x, projectY(plot, v - spread)]);
  }
  ctx.fillStyle = 'rgba(39,110,241,0.18)';
  ctx.beginPath();
  for (let i = 0; i < upper.length; i++) {
    let p = upper[i];
    if (i == 0) ctx.moveTo(p[0], p[1]); else ctx.lineTo(p[0], p[1]);
  }
  for (let i = lower.length - 1; i >= 0; i--) {
    let p = lower[i];
    ctx.lineTo(p[0], p[1]);
  }
  ctx.closePath();
  ctx.fill();
  drawSignalLine2d(plot, 0, '#e4572e', 1.4, [10, 7]);
}

function drawBars2d(plot) {
  let win = visibleWindow();
  let maxDraw = Math.min(win.count, 24000);
  let stride = Math.max(1, Math.floor(win.count / maxDraw));
  let drawCount = Math.max(2, Math.ceil(win.count / stride));
  let xStep = plot.width / Math.max(1, drawCount);
  ctx.fillStyle = engineKey == 'webgpu' ? 'rgba(39,110,241,0.66)' : 'rgba(228,87,46,0.62)';
  for (let j = 0, d = 0; j < win.count; j += stride, d++) {
    let i = win.startIndex + j;
    let v = sampleSourceValue(0, i);
    let x = plot.left + d * xStep;
    let y = projectY(plot, v);
    let barW = Math.max(1, xStep * 0.78);
    ctx.fillRect(x, y, barW, plot.top + plot.height - y);
  }
}

function drawHeatmap2d(plot) {
  let cols = Math.max(16, heatmapCols | 0);
  let rows = Math.max(8, heatmapRows | 0);
  let cellW = plot.width / cols;
  let cellH = plot.height / rows;
  let off = Math.floor(offset / 160) % cols;
  for (let x = 0; x < cols; x++) {
    for (let y = 0; y < rows; y++) {
      let wave = 0.5 + 0.5 * Math.sin((x + off) * 0.18 + y * 0.31);
      let ridge = Math.exp(-Math.pow((y - rows * (0.28 + 0.20 * Math.sin((x + off) * 0.035))) / Math.max(1, rows * 0.10), 2));
      let v = Math.max(0, Math.min(1, wave * 0.34 + ridge * 0.86));
      let r = Math.round(35 + v * 215);
      let g = Math.round(64 + Math.pow(v, 0.65) * 168);
      let b = Math.round(150 - v * 88);
      ctx.fillStyle = 'rgb(' + r + ',' + g + ',' + b + ')';
      ctx.fillRect(plot.left + x * cellW, plot.top + y * cellH, Math.ceil(cellW), Math.ceil(cellH));
    }
  }
}

function drawSignal2d(plot) {
  if (styleMode == 'heatmap') {
    drawHeatmap2d(plot);
  }
  else if (styleMode == 'bars') {
    drawBars2d(plot);
  }
  else if (styleMode == 'area-gradient') {
    drawArea2d(plot);
  }
  else if (styleMode == 'bands') {
    drawBand2d(plot);
  }
  else {
    let colors = engineKey == 'webgpu'
      ? ['#276ef1', '#23a455', '#7c3aed', '#d39200']
      : ['#e4572e', '#9b59b6', '#008a8a', '#d39200'];
    let count = Math.max(1, styleMode == 'multi-line' ? bufferCount : 1);
    for (let b = 0; b < count; b++)
      drawSignalLine2d(plot, b, colors[b % colors.length], b == 0 ? 1.12 : 0.95, b == 2 ? [5, 5] : null);
  }
  if (typeof ctx.commit == 'function')
    ctx.commit();
}

function presentCanvas2dBitmap() {
  if (presentationMode != 'bitmap' || !canvas || typeof canvas.transferToImageBitmap != 'function')
    return;
  try {
    let bitmap = canvas.transferToImageBitmap();
    postedBitmaps++;
    postMessage({
      type: 'bitmap',
      bitmap,
      frame: frames + 1,
      postedBitmaps,
      offset: Math.floor(offset),
      at: now(),
    }, [bitmap]);
  }
  catch (err) {
    presentationMode = 'direct';
    postMessage({type: 'warning', message: 'Canvas2D bitmap presentation failed, continuing direct worker draw only: ' + (err && err.message || String(err))});
  }
}

function drawCanvas2dFrame(plot) {
  drawBackground2d(plot);
  drawSignal2d(plot);
  presentCanvas2dBitmap();
}

function webgpuShader() {
  return [
    'struct Params {',
    '  count: u32,',
    '  offset: u32,',
    '  points: u32,',
    '  bufferCount: u32,',
    '  yMin: f32,',
    '  yRange: f32,',
    '  zoomMin: f32,',
    '  zoomMax: f32,',
    '  plotLeft: f32,',
    '  plotRight: f32,',
    '  plotTop: f32,',
    '  plotBottom: f32,',
    '};',
    'struct VsOut {',
    '  @builtin(position) pos: vec4<f32>,',
    '  @location(0) color: vec4<f32>,',
    '};',
    '@group(0) @binding(0) var<storage, read> source: array<f32>;',
    '@group(0) @binding(1) var<uniform> params: Params;',
    'fn colorFor(i: u32) -> vec4<f32> {',
    '  if (i == 1u) { return vec4<f32>(0.137, 0.643, 0.333, 0.95); }',
    '  if (i == 2u) { return vec4<f32>(0.486, 0.227, 0.929, 0.22); }',
    '  if (i == 3u) { return vec4<f32>(0.827, 0.573, 0.0, 0.95); }',
    '  return vec4<f32>(0.153, 0.431, 0.945, 1.0);',
    '}',
    'fn valueAt(frac: f32, series: u32) -> f32 {',
    '  let span = max(1.0 / f32(max(params.points, 2u)), params.zoomMax - params.zoomMin);',
    '  let srcF = (params.zoomMin + frac * span) * f32(max(params.points, 2u) - 1u);',
    '  let logicalIndex = min(params.points - 1u, u32(srcF + 0.5));',
    '  let shifted = (logicalIndex + params.offset + series * u32(f32(params.points) * 0.071)) % params.points;',
    '  return source[min(arrayLength(&source) - 1u, series * params.points + shifted)];',
    '}',
    '@vertex',
    'fn vsMain(@builtin(vertex_index) vertexIndex: u32, @builtin(instance_index) instanceIndex: u32) -> VsOut {',
    '  var out: VsOut;',
    '  let denom = max(1.0, f32(max(params.count, 2u) - 1u));',
    '  let frac = f32(vertexIndex) / denom;',
    '  let v = valueAt(frac, min(instanceIndex, max(1u, params.bufferCount) - 1u));',
    '  let x = params.plotLeft + (params.plotRight - params.plotLeft) * frac;',
    '  let y01 = clamp((v - params.yMin) / params.yRange, 0.0, 1.0);',
    '  let y = params.plotBottom + (params.plotTop - params.plotBottom) * y01;',
    '  out.pos = vec4<f32>(x, y, 0.0, 1.0);',
    '  out.color = colorFor(instanceIndex);',
    '  return out;',
    '}',
        'fn dashPos(frac: f32, series: u32) -> vec2<f32> {',
    '  let v = valueAt(frac, min(series, max(1u, params.bufferCount) - 1u));',
    '  let x = params.plotLeft + (params.plotRight - params.plotLeft) * frac;',
    '  let y01 = clamp((v - params.yMin) / params.yRange, 0.0, 1.0);',
    '  let y = params.plotBottom + (params.plotTop - params.plotBottom) * y01;',
    '  return vec2<f32>(x, y);',
    '}',
    'fn dashQuad(series: u32, vertexIndex: u32, color: vec4<f32>) -> VsOut {',
    '  var out: VsOut;',
    '  let dashIndex = vertexIndex / 6u;',
    '  let corner = vertexIndex % 6u;',
    '  let dashPeriod = 92.0;',
    '  let dashLength = 54.0;',
    '  let denom = max(1.0, f32(max(params.count, 2u) - 1u));',
    '  let sample0 = f32(dashIndex) * dashPeriod;',
    '  let sample1 = min(sample0 + dashLength, denom);',
    '  let f0 = clamp(sample0 / denom, 0.0, 1.0);',
    '  let f1 = clamp(sample1 / denom, 0.0, 1.0);',
    '  let p0 = dashPos(f0, series);',
    '  let p1 = dashPos(f1, series);',
    '  let d = p1 - p0;',
    '  let len = max(0.000001, length(d));',
    '  let n = vec2<f32>(-d.y, d.x) / len * 0.0052;',
    '  var p = p0 + n;',
    '  if (corner == 1u) { p = p1 + n; }',
    '  if (corner == 2u) { p = p0 - n; }',
    '  if (corner == 3u) { p = p0 - n; }',
    '  if (corner == 4u) { p = p1 + n; }',
    '  if (corner == 5u) { p = p1 - n; }',
    '  out.pos = vec4<f32>(p, 0.0, 1.0);',
    '  out.color = color;',
    '  return out;',
    '}',
    '@vertex',
    'fn vsDashMedian(@builtin(vertex_index) vertexIndex: u32) -> VsOut {',
    '  return dashQuad(0u, vertexIndex, vec4<f32>(0.894, 0.341, 0.180, 1.0));',
    '}',
    '@vertex',
    'fn vsDashSeries2(@builtin(vertex_index) vertexIndex: u32) -> VsOut {',
    '  return dashQuad(2u, vertexIndex, vec4<f32>(0.486, 0.227, 0.929, 1.0));',
    '}',
    '@fragment',
    'fn fsMain(in: VsOut) -> @location(0) vec4<f32> {',
    '  return in.color;',
    '}',
  ].join('\\n');
}

function webgpuAreaShader() {
  return [
    'struct Params {',
    '  count: u32,',
    '  offset: u32,',
    '  points: u32,',
    '  bufferCount: u32,',
    '  yMin: f32,',
    '  yRange: f32,',
    '  zoomMin: f32,',
    '  zoomMax: f32,',
    '  plotLeft: f32,',
    '  plotRight: f32,',
    '  plotTop: f32,',
    '  plotBottom: f32,',
    '};',
    'struct VsOut {',
    '  @builtin(position) pos: vec4<f32>,',
    '  @location(0) alpha: f32,',
    '};',
    '@group(0) @binding(0) var<storage, read> source: array<f32>;',
    '@group(0) @binding(1) var<uniform> params: Params;',
    'fn valueAt(frac: f32) -> f32 {',
    '  let span = max(1.0 / f32(max(params.points, 2u)), params.zoomMax - params.zoomMin);',
    '  let srcF = (params.zoomMin + frac * span) * f32(max(params.points, 2u) - 1u);',
    '  let logicalIndex = min(params.points - 1u, u32(srcF + 0.5));',
    '  let shifted = (logicalIndex + params.offset) % params.points;',
    '  return source[shifted];',
    '}',
    '@vertex',
    'fn vsArea(@builtin(vertex_index) vertexIndex: u32) -> VsOut {',
    '  var out: VsOut;',
    '  let pointIndex = vertexIndex / 2u;',
    '  let isBottom = (vertexIndex & 1u) == 1u;',
    '  let denom = max(1.0, f32(max(params.count, 2u) - 1u));',
    '  let frac = f32(pointIndex) / denom;',
    '  let v = valueAt(frac);',
    '  let y01 = clamp((v - params.yMin) / params.yRange, 0.0, 1.0);',
    '  let x = params.plotLeft + (params.plotRight - params.plotLeft) * frac;',
    '  let y = select(params.plotBottom + (params.plotTop - params.plotBottom) * y01, params.plotBottom, isBottom);',
    '  out.pos = vec4<f32>(x, y, 0.0, 1.0);',
    '  out.alpha = select(0.30, 0.02, isBottom);',
    '  return out;',
    '}',
    '@fragment',
    'fn fsArea(in: VsOut) -> @location(0) vec4<f32> {',
    '  return vec4<f32>(0.153, 0.431, 0.945, in.alpha);',
    '}',
  ].join('\\n');
}

function webgpuBandShader() {
  return [
    'struct Params {',
    '  count: u32,',
    '  offset: u32,',
    '  points: u32,',
    '  bufferCount: u32,',
    '  yMin: f32,',
    '  yRange: f32,',
    '  zoomMin: f32,',
    '  zoomMax: f32,',
    '  plotLeft: f32,',
    '  plotRight: f32,',
    '  plotTop: f32,',
    '  plotBottom: f32,',
    '};',
    'struct VsOut {',
    '  @builtin(position) pos: vec4<f32>,',
    '};',
    '@group(0) @binding(0) var<storage, read> source: array<f32>;',
    '@group(0) @binding(1) var<uniform> params: Params;',
    '@vertex',
    'fn vsBand(@builtin(vertex_index) vertexIndex: u32) -> VsOut {',
    '  var out: VsOut;',
    '  let pointIndex = vertexIndex / 2u;',
    '  let isLower = (vertexIndex & 1u) == 1u;',
    '  let denom = max(1.0, f32(max(params.count, 2u) - 1u));',
    '  let frac = f32(pointIndex) / denom;',
    '  let span = max(1.0 / f32(max(params.points, 2u)), params.zoomMax - params.zoomMin);',
    '  let srcF = (params.zoomMin + frac * span) * f32(max(params.points, 2u) - 1u);',
    '  let logicalIndex = min(params.points - 1u, u32(srcF + 0.5));',
    '  let shifted = (logicalIndex + params.offset) % params.points;',
    '  let spread = 24.0 + 14.0 * sin(f32(shifted) / 1300.0);',
    '  let v = source[shifted] + select(spread, -spread, isLower);',
    '  let y01 = clamp((v - params.yMin) / params.yRange, 0.0, 1.0);',
    '  let x = params.plotLeft + (params.plotRight - params.plotLeft) * frac;',
    '  let y = params.plotBottom + (params.plotTop - params.plotBottom) * y01;',
    '  out.pos = vec4<f32>(x, y, 0.0, 1.0);',
    '  return out;',
    '}',
    '@fragment',
    'fn fsBand() -> @location(0) vec4<f32> {',
    '  return vec4<f32>(0.153, 0.431, 0.945, 0.18);',
    '}',
  ].join('\\n');
}

function webgpuBarsShader() {
  return [
    'struct Params {',
    '  count: u32,',
    '  offset: u32,',
    '  points: u32,',
    '  bufferCount: u32,',
    '  yMin: f32,',
    '  yRange: f32,',
    '  zoomMin: f32,',
    '  zoomMax: f32,',
    '  plotLeft: f32,',
    '  plotRight: f32,',
    '  plotTop: f32,',
    '  plotBottom: f32,',
    '};',
    'struct VsOut {',
    '  @builtin(position) pos: vec4<f32>,',
    '};',
    '@group(0) @binding(0) var<storage, read> source: array<f32>;',
    '@group(0) @binding(1) var<uniform> params: Params;',
    '@vertex',
    'fn vsBars(@builtin(vertex_index) vertexIndex: u32) -> VsOut {',
    '  var out: VsOut;',
    '  let barIndex = vertexIndex / 6u;',
    '  let corner = vertexIndex % 6u;',
    '  let denom = max(1.0, f32(max(params.count, 2u)));',
    '  let frac0 = f32(barIndex) / denom;',
    '  let frac1 = f32(barIndex + 1u) / denom;',
    '  let x0 = params.plotLeft + (params.plotRight - params.plotLeft) * (frac0 + 0.10 / denom);',
    '  let x1 = params.plotLeft + (params.plotRight - params.plotLeft) * (frac1 - 0.10 / denom);',
    '  let span = max(1.0 / f32(max(params.points, 2u)), params.zoomMax - params.zoomMin);',
    '  let srcF = (params.zoomMin + frac0 * span) * f32(max(params.points, 2u) - 1u);',
    '  let logicalIndex = min(params.points - 1u, u32(srcF + 0.5));',
    '  let shifted = (logicalIndex + params.offset) % params.points;',
    '  let v = source[shifted];',
    '  let y01 = clamp((v - params.yMin) / params.yRange, 0.0, 1.0);',
    '  let y = params.plotBottom + (params.plotTop - params.plotBottom) * y01;',
    '  var x = x0;',
    '  var yy = params.plotBottom;',
    '  if (corner == 1u || corner == 3u || corner == 4u) { x = x1; }',
    '  if (corner == 2u || corner == 4u || corner == 5u) { yy = y; }',
    '  out.pos = vec4<f32>(x, yy, 0.0, 1.0);',
    '  return out;',
    '}',
    '@fragment',
    'fn fsBars() -> @location(0) vec4<f32> {',
    '  return vec4<f32>(0.153, 0.431, 0.945, 0.68);',
    '}',
  ].join('\\n');
}

function webgpuHeatmapShader() {
  return [
    'struct Params {',
    '  count: u32,',
    '  offset: u32,',
    '  points: u32,',
    '  bufferCount: u32,',
    '  yMin: f32,',
    '  yRange: f32,',
    '  zoomMin: f32,',
    '  zoomMax: f32,',
    '  plotLeft: f32,',
    '  plotRight: f32,',
    '  plotTop: f32,',
    '  plotBottom: f32,',
    '};',
    'struct VsOut {',
    '  @builtin(position) pos: vec4<f32>,',
    '  @location(0) v: f32,',
    '};',
    '@group(0) @binding(1) var<uniform> params: Params;',
    '@vertex',
    'fn vsHeat(@builtin(vertex_index) vertexIndex: u32) -> VsOut {',
    '  var out: VsOut;',
    '  let cols = max(16u, params.count);',
    '  let rows = max(8u, params.points);',
    '  let cell = vertexIndex / 6u;',
    '  let corner = vertexIndex % 6u;',
    '  let cx = cell % cols;',
    '  let cy = cell / cols;',
    '  var fx = f32(cx) / f32(cols);',
    '  var fy = f32(cy) / f32(rows);',
    '  if (corner == 1u || corner == 3u || corner == 4u) { fx = f32(cx + 1u) / f32(cols); }',
    '  if (corner == 2u || corner == 4u || corner == 5u) { fy = f32(cy + 1u) / f32(rows); }',
    '  let x = params.plotLeft + (params.plotRight - params.plotLeft) * fx;',
    '  let y = params.plotTop + (params.plotBottom - params.plotTop) * fy;',
    '  let xo = f32((cx + (params.offset / 160u)) % cols);',
    '  let wave = 0.5 + 0.5 * sin(xo * 0.18 + f32(cy) * 0.31);',
    '  let center = f32(rows) * (0.28 + 0.20 * sin(xo * 0.035));',
    '  let ridge = exp(-pow((f32(cy) - center) / max(1.0, f32(rows) * 0.10), 2.0));',
    '  out.v = clamp(wave * 0.34 + ridge * 0.86, 0.0, 1.0);',
    '  out.pos = vec4<f32>(x, y, 0.0, 1.0);',
    '  return out;',
    '}',
    '@fragment',
    'fn fsHeat(in: VsOut) -> @location(0) vec4<f32> {',
    '  let v = in.v;',
    '  return vec4<f32>(0.14 + 0.82 * v, 0.25 + 0.58 * pow(v, 0.65), 0.58 - 0.32 * v, 1.0);',
    '}',
  ].join('\\n');
}

function webgpuGridShader() {
  return [
    'struct GridOut {',
    '  @builtin(position) pos: vec4<f32>,',
    '  @location(0) color: vec4<f32>,',
    '};',
    '@vertex',
    'fn vsGrid(@location(0) pos: vec2<f32>, @location(1) color: vec4<f32>) -> GridOut {',
    '  var out: GridOut;',
    '  out.pos = vec4<f32>(pos, 0.0, 1.0);',
    '  out.color = color;',
    '  return out;',
    '}',
    '@fragment',
    'fn fsGrid(in: GridOut) -> @location(0) vec4<f32> {',
    '  return in.color;',
    '}',
  ].join('\\n');
}

function ndcX(px) {
  return px / Math.max(1, width) * 2 - 1;
}

function ndcY(px) {
  return 1 - px / Math.max(1, height) * 2;
}

function pushGridLine(out, x1, y1, x2, y2, color) {
  out.push(x1, y1, color[0], color[1], color[2], color[3]);
  out.push(x2, y2, color[0], color[1], color[2], color[3]);
}

function makeWebGPUGridVertices(plot) {
  let out = [];
  let grid = [0.68, 0.72, 0.78, 0.34];
  let axis = [0.12, 0.15, 0.19, 0.72];
  let left = ndcX(plot.left);
  let right = ndcX(plot.left + plot.width);
  let top = ndcY(plot.top);
  let bottom = ndcY(plot.top + plot.height);

  for (let i = 0; i <= 6; i++) {
    let x = ndcX(plot.left + plot.width * i / 6);
    pushGridLine(out, x, top, x, bottom, grid);
  }
  for (let i = 0; i <= 4; i++) {
    let y = ndcY(plot.top + plot.height * i / 4);
    pushGridLine(out, left, y, right, y, grid);
  }

  pushGridLine(out, left, top, left, bottom, axis);
  pushGridLine(out, left, bottom, right, bottom, axis);
  return new Float32Array(out);
}

function pushShapeVertex(out, x, y, color) {
  out.push(x, y, color[0], color[1], color[2], color[3]);
}

function makeWebGPUPlotFillVertices(plot) {
  let fill = [0.947, 0.968, 0.997, 1.0];
  let left = ndcX(plot.left);
  let right = ndcX(plot.left + plot.width);
  let top = ndcY(plot.top);
  let bottom = ndcY(plot.top + plot.height);
  let out = [];
  pushShapeVertex(out, left, top, fill);
  pushShapeVertex(out, right, top, fill);
  pushShapeVertex(out, right, bottom, fill);
  pushShapeVertex(out, left, top, fill);
  pushShapeVertex(out, right, bottom, fill);
  pushShapeVertex(out, left, bottom, fill);
  return new Float32Array(out);
}

async function initWebGPU() {
  if (typeof navigator == 'undefined' || navigator.gpu == null)
    throw new Error('WebGPU is not available inside this worker.');
  let adapter = await navigator.gpu.requestAdapter({powerPreference: 'high-performance'});
  if (!adapter)
    throw new Error('No WebGPU adapter was returned inside the worker.');
  let device = await adapter.requestDevice();
  device.addEventListener?.('uncapturederror', event => {
    postMessage({type: 'warning', message: 'WebGPU validation: ' + (event.error?.message || String(event.error || event))});
  });
  device.lost.then?.(info => {
    postMessage({type: 'warning', message: 'WebGPU device lost: ' + (info?.message || info?.reason || 'unknown')});
  });
  let context = canvas.getContext('webgpu');
  if (!context)
    throw new Error('OffscreenCanvas webgpu context unavailable.');
  let format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({
    device,
    format,
    alphaMode: 'premultiplied',
    usage: GPUTextureUsage.RENDER_ATTACHMENT,
  });
  let module = device.createShaderModule({code: webgpuShader()});
  let areaModule = device.createShaderModule({code: webgpuAreaShader()});
  let bandModule = device.createShaderModule({code: webgpuBandShader()});
  let barsModule = device.createShaderModule({code: webgpuBarsShader()});
  let heatmapModule = device.createShaderModule({code: webgpuHeatmapShader()});
  let gridModule = device.createShaderModule({code: webgpuGridShader()});
  let pipelineDesc = {
    layout: 'auto',
    vertex: {
      module,
      entryPoint: 'vsMain',
    },
    fragment: {
      module,
      entryPoint: 'fsMain',
      targets: [{format}],
    },
    primitive: {topology: 'line-strip'},
  };
  let dashMedianPipelineDesc = {
    layout: 'auto',
    vertex: {module, entryPoint: 'vsDashMedian'},
    fragment: {module, entryPoint: 'fsMain', targets: [{format}]},
    primitive: {topology: 'triangle-list'},
  };
  let dashSeriesPipelineDesc = {
    layout: 'auto',
    vertex: {module, entryPoint: 'vsDashSeries2'},
    fragment: {module, entryPoint: 'fsMain', targets: [{format}]},
    primitive: {topology: 'triangle-list'},
  };
  let gridPipelineDesc = {
    layout: 'auto',
    vertex: {
      module: gridModule,
      entryPoint: 'vsGrid',
      buffers: [{
        arrayStride: 24,
        attributes: [
          {shaderLocation: 0, offset: 0, format: 'float32x2'},
          {shaderLocation: 1, offset: 8, format: 'float32x4'},
        ],
      }],
    },
    fragment: {
      module: gridModule,
      entryPoint: 'fsGrid',
      targets: [{format}],
    },
    primitive: {topology: 'line-list'},
  };
  let fillPipelineDesc = {
    ...gridPipelineDesc,
    primitive: {topology: 'triangle-list'},
  };
  let areaPipelineDesc = {
    layout: 'auto',
    vertex: {module: areaModule, entryPoint: 'vsArea'},
    fragment: {module: areaModule, entryPoint: 'fsArea', targets: [{format, blend: {color: {srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add'}, alpha: {srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add'}}}]},
    primitive: {topology: 'triangle-strip'},
  };
  let bandPipelineDesc = {
    layout: 'auto',
    vertex: {module: bandModule, entryPoint: 'vsBand'},
    fragment: {module: bandModule, entryPoint: 'fsBand', targets: [{format, blend: {color: {srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add'}, alpha: {srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add'}}}]},
    primitive: {topology: 'triangle-strip'},
  };
  let barsPipelineDesc = {
    layout: 'auto',
    vertex: {module: barsModule, entryPoint: 'vsBars'},
    fragment: {module: barsModule, entryPoint: 'fsBars', targets: [{format, blend: {color: {srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add'}, alpha: {srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add'}}}]},
    primitive: {topology: 'triangle-list'},
  };
  let heatmapPipelineDesc = {
    layout: 'auto',
    vertex: {module: heatmapModule, entryPoint: 'vsHeat'},
    fragment: {module: heatmapModule, entryPoint: 'fsHeat', targets: [{format}]},
    primitive: {topology: 'triangle-list'},
  };
  let pipelineDescs = [
    pipelineDesc,
    dashMedianPipelineDesc,
    dashSeriesPipelineDesc,
    gridPipelineDesc,
    fillPipelineDesc,
    areaPipelineDesc,
    bandPipelineDesc,
    barsPipelineDesc,
    heatmapPipelineDesc,
  ];
  let pipelines = device.createRenderPipelineAsync
    ? await Promise.all(pipelineDescs.map(desc => device.createRenderPipelineAsync(desc)))
    : pipelineDescs.map(desc => device.createRenderPipeline(desc));
  let [
    renderPipeline,
    dashMedianPipeline,
    dashSeriesPipeline,
    gridPipeline,
    fillPipeline,
    areaPipeline,
    bandPipeline,
    barsPipeline,
    heatmapPipeline,
  ] = pipelines;
  let sourceBuffer = device.createBuffer({
    size: Math.max(4, source.byteLength),
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(sourceBuffer, 0, source.buffer, source.byteOffset, source.byteLength);
  let uniformBuffer = device.createBuffer({
    size: 256,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  let gridBuffer = device.createBuffer({
    size: 8192,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  let fillBuffer = device.createBuffer({
    size: 1024,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  let bindEntries = [
    {binding: 0, resource: {buffer: sourceBuffer}},
    {binding: 1, resource: {buffer: uniformBuffer}},
  ];
  let uniformOnlyEntries = [
    {binding: 1, resource: {buffer: uniformBuffer}},
  ];
  let bindGroup = device.createBindGroup({layout: renderPipeline.getBindGroupLayout(0), entries: bindEntries});
  let dashMedianBindGroup = device.createBindGroup({layout: dashMedianPipeline.getBindGroupLayout(0), entries: bindEntries});
  let dashSeriesBindGroup = device.createBindGroup({layout: dashSeriesPipeline.getBindGroupLayout(0), entries: bindEntries});
  let areaBindGroup = device.createBindGroup({layout: areaPipeline.getBindGroupLayout(0), entries: bindEntries});
  let bandBindGroup = device.createBindGroup({layout: bandPipeline.getBindGroupLayout(0), entries: bindEntries});
  let barsBindGroup = device.createBindGroup({layout: barsPipeline.getBindGroupLayout(0), entries: bindEntries});
  let heatmapBindGroup = device.createBindGroup({layout: heatmapPipeline.getBindGroupLayout(0), entries: uniformOnlyEntries});
  gpu = {
    device,
    context,
    format,
    renderPipeline,
    dashMedianPipeline,
    dashSeriesPipeline,
    gridPipeline,
    fillPipeline,
    areaPipeline,
    bandPipeline,
    barsPipeline,
    heatmapPipeline,
    sourceBuffer,
    uniformBuffer,
    gridBuffer,
    fillBuffer,
    bindGroup,
    dashMedianBindGroup,
    dashSeriesBindGroup,
    areaBindGroup,
    bandBindGroup,
    barsBindGroup,
    heatmapBindGroup,
    uniformBytes: new ArrayBuffer(256),
  };
  await drawWebGPUFrame(plotBox());
  await device.queue.onSubmittedWorkDone?.();
  rendererPath = 'direct-offscreen-webgpu-storage-vertex-' + styleMode;
}

async function drawWebGPUFrame(plot) {
  let lo = yMin;
  let range = Math.max(1e-9, yMax - yMin);
  let win = visibleWindow();
  let count = Math.max(2, win.count);
  let u32 = new Uint32Array(gpu.uniformBytes);
  let f32 = new Float32Array(gpu.uniformBytes);
  u32[0] = styleMode == 'heatmap' ? Math.max(16, heatmapCols | 0) : count;
  u32[1] = Math.floor(offset) % points;
  u32[2] = styleMode == 'heatmap' ? Math.max(8, heatmapRows | 0) : points;
  u32[3] = Math.max(1, bufferCount | 0);
  f32[4] = lo;
  f32[5] = range;
  f32[6] = Math.max(0, Math.min(1, zoomMin));
  f32[7] = Math.max(f32[6] + 1 / Math.max(2, points), Math.min(1, zoomMax));
  f32[8] = ndcX(plot.left);
  f32[9] = ndcX(plot.left + plot.width);
  f32[10] = ndcY(plot.top);
  f32[11] = ndcY(plot.top + plot.height);
  gpu.device.queue.writeBuffer(gpu.uniformBuffer, 0, gpu.uniformBytes, 0, 48);

  let fillVertices = makeWebGPUPlotFillVertices(plot);
  let gridVertices = makeWebGPUGridVertices(plot);
  gpu.device.queue.writeBuffer(gpu.fillBuffer, 0, fillVertices.buffer, fillVertices.byteOffset, fillVertices.byteLength);
  gpu.device.queue.writeBuffer(gpu.gridBuffer, 0, gridVertices.buffer, gridVertices.byteOffset, gridVertices.byteLength);

  let encoder = gpu.device.createCommandEncoder();
  let pass = encoder.beginRenderPass({
    colorAttachments: [{
      view: gpu.context.getCurrentTexture().createView(),
      clearValue: {r: 1, g: 1, b: 1, a: 1},
      loadOp: 'clear',
      storeOp: 'store',
    }],
  });
  pass.setPipeline(gpu.fillPipeline);
  pass.setVertexBuffer(0, gpu.fillBuffer);
  pass.draw(fillVertices.length / 6, 1, 0, 0);
  pass.setPipeline(gpu.gridPipeline);
  pass.setVertexBuffer(0, gpu.gridBuffer);
  pass.draw(gridVertices.length / 6, 1, 0, 0);

  if (styleMode == 'heatmap') {
    pass.setPipeline(gpu.heatmapPipeline);
    pass.setBindGroup(0, gpu.heatmapBindGroup);
    pass.draw(Math.max(16, heatmapCols | 0) * Math.max(8, heatmapRows | 0) * 6, 1, 0, 0);
  }
  else if (styleMode == 'bars') {
    let barCount = Math.min(count, 160000);
    pass.setPipeline(gpu.barsPipeline);
    pass.setBindGroup(0, gpu.barsBindGroup);
    pass.draw(barCount * 6, 1, 0, 0);
  }
  else if (styleMode == 'area-gradient') {
    pass.setPipeline(gpu.areaPipeline);
    pass.setBindGroup(0, gpu.areaBindGroup);
    pass.draw(count * 2, 1, 0, 0);
    pass.setPipeline(gpu.renderPipeline);
    pass.setBindGroup(0, gpu.bindGroup);
    pass.draw(count, 1, 0, 0);
  }
  else if (styleMode == 'bands') {
    let dashSegments = Math.max(4, Math.min(16000, Math.floor(count / 92)));
    pass.setPipeline(gpu.bandPipeline);
    pass.setBindGroup(0, gpu.bandBindGroup);
    pass.draw(count * 2, 1, 0, 0);
    pass.setPipeline(gpu.dashMedianPipeline);
    pass.setBindGroup(0, gpu.dashMedianBindGroup);
    pass.draw(dashSegments * 6, 1, 0, 0);
  }
  else {
    pass.setPipeline(gpu.renderPipeline);
    pass.setBindGroup(0, gpu.bindGroup);
    pass.draw(count, Math.max(1, styleMode == 'multi-line' ? bufferCount : 1), 0, 0);
    if (styleMode == 'multi-line' && bufferCount >= 3) {
      let dashSegments = Math.max(4, Math.min(16000, Math.floor(count / 92)));
      pass.setPipeline(gpu.dashSeriesPipeline);
      pass.setBindGroup(0, gpu.dashSeriesBindGroup);
      pass.draw(dashSegments * 6, 1, 0, 0);
    }
  }
  pass.end();
  gpu.device.queue.submit([encoder.finish()]);
}

function postFrameStats(type, completedAt) {
  let endAt = completedAt || now();
  let renderElapsedMs = Math.max(1, endAt - startedAt);
  let wallFps = frames * 1000 / renderElapsedMs;
  let win = visibleWindow();
  postMessage({
    type,
    frames,
    updateMs,
    maxUpdateMs,
    firstMs,
    offset: Math.floor(offset),
    points,
    step,
    initMs,
    visiblePoints: win.count,
    startedAt,
    completedAt: completedAt || 0,
    renderElapsedMs,
    fps: wallFps,
    loopHz: wallFps,
    framePacing,
    displayPaced: true,
    renderThread: 'worker',
    engineKey,
    rendererPath,
    presentationMode,
    postedBitmaps,
    styleMode,
    bufferCount,
  });
}

async function drawFrame() {
  if (!running)
    return;
  try {
    let frameNow = now();
    let dt = lastFrameAt ? Math.max(1, Math.min(100, frameNow - lastFrameAt)) : 16.6667;
    lastFrameAt = frameNow;
    offset = (offset + scrollSamplesPerSecond * dt / 1000) % points;

    let t0 = now();
    let plot = plotBox();
    if (engineKey == 'webgpu')
      await drawWebGPUFrame(plot);
    else
      drawCanvas2dFrame(plot);

    let dtRender = now() - t0;
    frames++;
    updateMs += dtRender;
    if (dtRender > maxUpdateMs)
      maxUpdateMs = dtRender;
    if (frames == 1)
      firstMs = dtRender;

    if (frames == 1 || frameNow - lastStatsAt >= 250) {
      lastStatsAt = frameNow;
      postFrameStats('stats', 0);
    }

    if (now() - startedAt >= durationMs) {
      running = false;
      postFrameStats('done', now());
      return;
    }

    scheduleFrame();
  }
  catch (err) {
    if (engineKey == 'webgpu') {
      try {
        ctx = canvas.getContext('2d', {alpha: true, desynchronized: true});
        if (ctx) {
          engineKey = 'webgpu-fallback-2d';
          rendererPath = 'webgpu-worker-fallback-2d-after-render-error';
          postMessage({type: 'warning', message: 'WebGPU render path failed, continuing with worker 2D fallback: ' + (err && err.message || String(err))});
          drawCanvas2dFrame(plotBox());
          frames++;
          postFrameStats('stats', 0);
          scheduleFrame();
          return;
        }
      }
      catch (fallbackErr) {}
    }
    running = false;
    postMessage({type: 'error', message: err && err.stack || err && err.message || String(err), frames, engineKey});
  }
}

async function redrawStillFrame() {
  if (!canvas || !source)
    return;
  let plot = plotBox();
  if (engineKey == 'webgpu' && gpu && gpu.context) {
    gpu.context.configure({device: gpu.device, format: gpu.format, alphaMode: 'premultiplied', usage: GPUTextureUsage.RENDER_ATTACHMENT});
    await drawWebGPUFrame(plot);
  }
  else if (ctx) {
    drawCanvas2dFrame(plot);
  }
}

async function initRenderer(msg) {
  engineKey = msg.engineKey || engineKey;
  presentationMode = msg.presentationMode || 'direct';
  styleMode = msg.styleMode || styleMode || 'line';
  bufferCount = Math.max(1, Math.min(8, msg.bufferCount || bufferCount || 1));
  heatmapCols = Math.max(16, msg.heatmapCols || heatmapCols || 256);
  heatmapRows = Math.max(8, msg.heatmapRows || heatmapRows || 128);
  rendererPath = engineKey == 'webgpu' ? 'direct-offscreen-webgpu-storage-vertex-' + styleMode : (presentationMode == 'bitmap' ? 'worker-2d-bitmap-presented-on-main-raf' : 'direct-offscreen-2d');
  width = Math.max(1, msg.width || msg.canvas?.width || 1);
  height = Math.max(1, msg.height || msg.canvas?.height || 1);
  canvas = presentationMode == 'bitmap' && engineKey != 'webgpu'
    ? new OffscreenCanvas(width, height)
    : msg.canvas;
  if (!canvas)
    throw new Error('OffscreenCanvas unavailable for worker renderer');
  pixelRatio = Math.max(1, msg.pixelRatio || 1);
  points = Math.max(2, msg.points || points);
  step = Math.max(1, msg.step || step);
  scrollSamplesPerSecond = Math.max(1, Number(msg.scrollSamplesPerSecond) || step * 60);
  targetFrameMs = Math.max(1, Number(msg.targetFrameMs ?? targetFrameMs) || 16.6667);
  durationMs = Math.max(1000, msg.durationMs || durationMs);
  canvas.width = width;
  canvas.height = height;

  let t0 = now();
  source = makeSignal(points, bufferCount);
  if (engineKey == 'webgpu') {
    try {
      await initWebGPU();
    }
    catch (err) {
      ctx = canvas.getContext('2d', {alpha: true, desynchronized: true});
      if (!ctx)
        throw err;
      engineKey = 'webgpu-fallback-2d';
      rendererPath = 'webgpu-worker-fallback-2d-init';
      postMessage({type: 'warning', message: 'WebGPU worker path failed, drawing worker 2D fallback: ' + (err && err.message || String(err))});
    }
  }
  else {
    ctx = canvas.getContext('2d', {alpha: true, desynchronized: true});
    if (!ctx)
      throw new Error('2D OffscreenCanvas context unavailable');
  }
  initMs = now() - t0;
}

self.onmessage = async event => {
  let msg = event.data || {};
  try {
    if (msg.type == 'start') {
      running = false;
      cancelFrame();
      await initRenderer(msg);
      frames = 0;
      updateMs = 0;
      maxUpdateMs = 0;
      firstMs = 0;
      offset = msg.offset || 0;
      zoomMin = 0;
      zoomMax = 1;
      startedAt = now();
      lastFrameAt = 0;
      lastStatsAt = 0;
      running = true;
      postMessage({
        type: 'ready',
        initMs,
        points,
        step,
        renderThread: 'worker',
        engineKey,
        rendererPath,
        presentationMode,
      });
      drawFrame();
    }
    else if (msg.type == 'stop') {
      running = false;
      cancelFrame();
      try { if (gpu && gpu.sourceBuffer) gpu.sourceBuffer.destroy(); }
      catch (err) {}
      try { if (gpu && gpu.uniformBuffer) gpu.uniformBuffer.destroy(); }
      catch (err) {}
      try { if (gpu && gpu.gridBuffer) gpu.gridBuffer.destroy(); }
      catch (err) {}
      try { if (gpu && gpu.fillBuffer) gpu.fillBuffer.destroy(); }
      catch (err) {}
    }
    else if (msg.type == 'zoom') {
      let a = Math.max(0, Math.min(1, Number(msg.min) || 0));
      let b = Math.max(0, Math.min(1, Number(msg.max) || 1));
      if (b - a > 0.00001) {
        zoomMin = a;
        zoomMax = b;
        if (!running)
          await redrawStillFrame();
      }
    }
    else if (msg.type == 'resetZoom') {
      zoomMin = 0;
      zoomMax = 1;
      if (!running)
        await redrawStillFrame();
    }
    else if (msg.type == 'resize') {
      width = Math.max(1, msg.width || width);
      height = Math.max(1, msg.height || height);
      pixelRatio = Math.max(1, msg.pixelRatio || pixelRatio);
      if (canvas) {
        canvas.width = width;
        canvas.height = height;
      }
      if (engineKey == 'webgpu' && gpu && gpu.context)
        gpu.context.configure({device: gpu.device, format: gpu.format, alphaMode: 'premultiplied', usage: GPUTextureUsage.RENDER_ATTACHMENT});
      if (!running)
        await redrawStillFrame();
    }
    else if (msg.type == 'resume' || msg.type == 'redraw') {
      if (running) {
        lastFrameAt = 0;
        cancelFrame();
        scheduleFrame();
      }
      else {
        await redrawStillFrame();
      }
    }
  }
  catch (err) {
    postMessage({type: 'error', message: err && err.stack || err && err.message || String(err), frames, engineKey});
  }
};
`;
  let blob = new Blob([code], {type: 'text/javascript'});
  let url = URL.createObjectURL(blob);
  let worker = new Worker(url);
  worker._benchBlobUrl = url;
  return worker;
}


function startOffscreenRendererWorkerChart({spec, slot, engineKey, engineLabel, points, durationMs, step, stopRef}) {
    slot.mount.textContent = '';
    let size = chartSizeForMount(slot.mount, spec);
    let pixelRatio = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    let canvas = document.createElement('canvas');
    canvas.className = 'bench-worker-canvas';
    canvas.style.width = `${size.width}px`;
    canvas.style.height = `${size.height}px`;
    canvas.width = Math.max(1, Math.floor(size.width * pixelRatio));
    canvas.height = Math.max(1, Math.floor(size.height * pixelRatio));
    slot.mount.appendChild(canvas);
    let badge = document.createElement('div');
    badge.className = 'bench-worker-badge';
    badge.dataset.engine = engineKey == 'canvas2d' ? 'canvas2d' : 'webgpu';
    badge.textContent = `${engineLabel} worker ${Number(points || 0).toLocaleString()} ${spec.styleMode || 'line'}`;
    slot.mount.appendChild(badge);
    populateLegend(slot.legend, spec);

    let statsEl = document.createElement('div');
    statsEl.className = 'bench-live-stats';
    slot.card.appendChild(statsEl);

    let stats = {
      points,
      step,
      frames: 0,
      workerTicks: 0,
      fallbackFrames: 0,
      offset: 0,
      bytesCopied: 0,
      updateMs: 0,
      maxUpdateMs: 0,
      startedAt: performance.now(),
      createMs: 0,
      firstMs: 0,
      initMs: 0,
      visiblePoints: points,
      renderThread: 'worker',
    };
    statsEl.textContent = formatLiveStats(engineLabel, stats, true);

    let worker = createOffscreenRendererWorker();
    let handle = {
      root: canvas,
      _benchWorker: worker,
      _benchWorkerStop: stopWorker,
      destroy: stopWorker,
    };
    let stopped = false;
    let resolved = false;
    let done;
    let promise = new Promise(resolve => { done = resolve; });
    let dragStart = null;
    let bitmapRenderer = null;
    let bitmapPresentation = false;
    let pendingBitmap = null;
    let pendingBitmapMeta = null;
    let bitmapPresentRaf = 0;
    let displayFrames = 0;
    let displayStartedAt = 0;
    let selection = document.createElement('div');
    selection.style.position = 'absolute';
    selection.style.top = '0';
    selection.style.bottom = '0';
    selection.style.border = '1px solid rgba(39,110,241,0.72)';
    selection.style.background = 'rgba(39,110,241,0.12)';
    selection.style.pointerEvents = 'none';
    selection.style.display = 'none';
    slot.mount.style.position = 'relative';
    slot.mount.appendChild(selection);

    function closePendingBitmap() {
      if (!pendingBitmap)
        return;
      try { pendingBitmap.close?.(); }
      catch (err) {}
      pendingBitmap = null;
      pendingBitmapMeta = null;
    }

    function scheduleBitmapPresentation() {
      if (!bitmapPresentation || bitmapPresentRaf)
        return;
      bitmapPresentRaf = requestAnimationFrame(presentLatestBitmap);
    }

    function presentLatestBitmap() {
      bitmapPresentRaf = 0;
      if (stopped && !pendingBitmap)
        return;
      if (pendingBitmap && bitmapRenderer) {
        let bitmap = pendingBitmap;
        let meta = pendingBitmapMeta || {};
        pendingBitmap = null;
        pendingBitmapMeta = null;
        try {
          bitmapRenderer.transferFromImageBitmap(bitmap);
          let t = performance.now();
          if (!displayStartedAt)
            displayStartedAt = stats.startedAt || t;
          displayFrames++;
          stats.displayFrames = displayFrames;
          stats.displayElapsedMs = Math.max(1, t - displayStartedAt);
          stats.displayFps = displayFrames * 1000 / stats.displayElapsedMs;
          stats.presentedFrame = meta.frame || displayFrames;
          if (Number.isFinite(Number(meta.offset)))
            stats.offset = Number(meta.offset);
          statsEl.textContent = formatLiveStats(engineLabel, stats, !stats.completedAt && !stopped);
        }
        catch (err) {
          try { bitmap.close?.(); }
          catch (closeErr) {}
          stats.warning = err?.message || String(err);
        }
      }
      if (!stopped || pendingBitmap)
        bitmapPresentRaf = requestAnimationFrame(presentLatestBitmap);
    }

    function complete(finalStats = stats) {
      if (resolved)
        return;
      resolved = true;
      finalStats.completedAt = finalStats.completedAt || performance.now();
      if (displayFrames) {
        finalStats.displayFrames = displayFrames;
        finalStats.displayElapsedMs = Math.max(1, finalStats.completedAt - (displayStartedAt || stats.startedAt || finalStats.completedAt));
        finalStats.displayFps = displayFrames * 1000 / finalStats.displayElapsedMs;
      }
      statsEl.textContent = formatLiveStats(engineLabel, finalStats, false);
      done({chart: handle, worker, stats: finalStats});
    }

    function stopWorker() {
      if (stopped)
        return;
      stopped = true;
      try { worker.postMessage({type: 'stop'}); }
      catch (err) {}
      try { worker.terminate(); }
      catch (err) {}
      if (bitmapPresentRaf)
        cancelAnimationFrame(bitmapPresentRaf);
      bitmapPresentRaf = 0;
      closePendingBitmap();
      selection.remove?.();
      badge.remove?.();
      try { handle._benchWorkerResumeCleanup?.(); }
      catch (err) {}
      complete(stats);
    }

    function mergeStats(msg) {
      stats = {
        ...stats,
        ...msg,
        createMs: msg.initMs ?? stats.createMs,
        firstMs: msg.firstMs ?? stats.firstMs,
        workerTicks: msg.frames ?? stats.workerTicks,
        completedAt: msg.completedAt || stats.completedAt,
      };
      if (displayFrames) {
        stats.displayFrames = displayFrames;
        stats.displayElapsedMs = Math.max(1, performance.now() - (displayStartedAt || stats.startedAt || performance.now()));
        stats.displayFps = displayFrames * 1000 / stats.displayElapsedMs;
      }
      statsEl.textContent = formatLiveStats(engineLabel, stats, !msg.completedAt && !stopped);
    }

    worker.onmessage = event => {
      let msg = event.data || {};
      if (msg.type == 'bitmap') {
        if (bitmapRenderer && msg.bitmap) {
          if (pendingBitmap) {
            try { pendingBitmap.close?.(); }
            catch (err) {}
          }
          pendingBitmap = msg.bitmap;
          pendingBitmapMeta = msg;
          scheduleBitmapPresentation();
        }
        else if (msg.bitmap) {
          try { msg.bitmap.close?.(); }
          catch (err) {}
        }
      }
      else if (msg.type == 'ready') {
        stats.initMs = msg.initMs || 0;
        stats.createMs = stats.initMs;
        stats.points = msg.points || points;
        stats.step = msg.step || step;
        stats.renderThread = 'worker';
        stats.presentationMode = msg.presentationMode || stats.presentationMode;
        stats.rendererPath = msg.rendererPath || stats.rendererPath;
        statsEl.textContent = formatLiveStats(engineLabel, stats, true);
      }
      else if (msg.type == 'stats') {
        mergeStats(msg);
      }
      else if (msg.type == 'warning') {
        stats.warning = msg.message || 'worker warning';
        statsEl.textContent = `${engineLabel} warning\n${stats.warning}\n\n` + formatLiveStats(engineLabel, stats, true);
      }
      else if (msg.type == 'done') {
        mergeStats(msg);
        complete(stats);
      }
      else if (msg.type == 'error') {
        stats.error = msg.message || 'worker renderer error';
        statsEl.textContent = `${engineLabel} worker renderer error\n${stats.error}`;
        stopped = true;
        try { worker.terminate(); }
        catch (err) {}
        complete(stats);
      }
    };

    worker.onerror = event => {
      stats.error = event.message || 'worker renderer error';
      statsEl.textContent = `${engineLabel} worker renderer error\n${stats.error}`;
      stopped = true;
      try { worker.terminate(); }
      catch (err) {}
      complete(stats);
    };

    function pointerFrac(event) {
      let rect = canvas.getBoundingClientRect();
      return Math.max(0, Math.min(1, (event.clientX - rect.left) / Math.max(1, rect.width)));
    }

    canvas.addEventListener('pointerdown', event => {
      dragStart = pointerFrac(event);
      canvas.setPointerCapture?.(event.pointerId);
      selection.style.display = 'block';
      selection.style.left = `${dragStart * 100}%`;
      selection.style.width = '0%';
    });
    canvas.addEventListener('pointermove', event => {
      if (dragStart == null)
        return;
      let cur = pointerFrac(event);
      let a = Math.min(dragStart, cur);
      let b = Math.max(dragStart, cur);
      selection.style.left = `${a * 100}%`;
      selection.style.width = `${Math.max(0, b - a) * 100}%`;
    });
    canvas.addEventListener('pointerup', event => {
      if (dragStart == null)
        return;
      let cur = pointerFrac(event);
      let a = Math.min(dragStart, cur);
      let b = Math.max(dragStart, cur);
      dragStart = null;
      selection.style.display = 'none';
      if (b - a > 0.015)
        worker.postMessage({type: 'zoom', min: a, max: b});
    });
    canvas.addEventListener('pointercancel', () => {
      dragStart = null;
      selection.style.display = 'none';
    });
    canvas.addEventListener('dblclick', () => {
      worker.postMessage({type: 'resetZoom'});
    });

    function postWorkerResize(redraw = true) {
      if (stopped)
        return;
      let next = chartSizeForMount(slot.mount, spec);
      let pr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
      canvas.style.width = `${next.width}px`;
      canvas.style.height = `${next.height}px`;
      try {
        worker.postMessage({
          type: 'resize',
          width: Math.max(1, Math.floor(next.width * pr)),
          height: Math.max(1, Math.floor(next.height * pr)),
          pixelRatio: pr,
        });
        if (redraw)
          worker.postMessage({type: 'resume'});
      }
      catch (err) {}
    }

    function resumeWorkerCanvas() {
      if (stopped)
        return;
      postWorkerResize(true);
    }

    document.addEventListener('visibilitychange', resumeWorkerCanvas);
    window.addEventListener('pageshow', resumeWorkerCanvas);
    window.addEventListener('focus', resumeWorkerCanvas);
    handle._benchWorkerResumeCleanup = () => {
      document.removeEventListener('visibilitychange', resumeWorkerCanvas);
      window.removeEventListener('pageshow', resumeWorkerCanvas);
      window.removeEventListener('focus', resumeWorkerCanvas);
    };

    let ro = typeof ResizeObserver == 'undefined' ? null : new ResizeObserver(() => {
      postWorkerResize(true);
    });
    ro?.observe?.(slot.mount);
    handle._benchResizeObserver = ro;

    let offscreen = null;
    let transferList = [];
    let presentationMode = 'direct';
    if (engineKey == 'canvas2d' && 'ImageBitmapRenderingContext' in window) {
      try {
        bitmapRenderer = canvas.getContext('bitmaprenderer');
      }
      catch (err) {
        bitmapRenderer = null;
      }
      if (bitmapRenderer) {
        bitmapPresentation = true;
        presentationMode = 'bitmap';
        stats.presentationMode = presentationMode;
        stats.rendererPath = 'worker-2d-bitmap-presented-on-main-raf';
        scheduleBitmapPresentation();
      }
    }
    if (!bitmapPresentation) {
      try {
        offscreen = canvas.transferControlToOffscreen();
        transferList.push(offscreen);
      }
      catch (err) {
        stats.error = err?.message || String(err);
        statsEl.textContent = `${engineLabel} OffscreenCanvas error
${stats.error}`;
        complete(stats);
        return;
      }
    }

    let rendererUrl = new URL('./webgpu/WebGPURenderer.js', window.location.href).href;
    let startMessage = {
      type: 'start',
      engineKey,
      presentationMode,
      width: canvas.width,
      height: canvas.height,
      pixelRatio,
      points,
      step,
      durationMs,
      targetFrameMs: 16.6667,
      scrollSamplesPerSecond: step * 60,
      styleMode: spec.styleMode || 'line',
      bufferCount: spec.bufferCount || 1,
      heatmapCols: spec.heatmapCols || 256,
      heatmapRows: spec.heatmapRows || 128,
      rendererUrl,
    };
    if (offscreen)
      startMessage.canvas = offscreen;
    worker.postMessage(startMessage, transferList);

    let guard = () => {
      if (stopped || resolved)
        return;
      if (stopRef?.()) {
        stopWorker();
        return;
      }
      requestAnimationFrame(guard);
    };
    requestAnimationFrame(guard);
    return {chart: handle, worker, stats, promise};
}

function formatLiveStats(label, stats, running = true) {
  let elapsed = Math.max(1, Number(stats.renderElapsedMs) || ((stats.completedAt || performance.now()) - stats.startedAt));
  let fps = Number.isFinite(Number(stats.fps)) ? Number(stats.fps) : (Number(stats.frames || 0) * 1000 / elapsed);
  let visibleFps = Number.isFinite(Number(stats.displayFps)) && Number(stats.displayFrames || 0) > 0
    ? Number(stats.displayFps)
    : fps;
  let avg = Number(stats.frames || 0) ? Number(stats.updateMs || 0) / Number(stats.frames || 1) : 0;
  let frames = Number(stats.displayFrames || stats.frames || 0);
  let points = Number(stats.visiblePoints || stats.points || 0);
  let buffers = Math.max(1, Number(stats.bufferCount || 1));
  let status = running ? 'live' : 'done';

  if (stats.renderThread == 'worker') {
    return `${label} ${status} fps ${visibleFps.toFixed(1)}
frame avg ${avg.toFixed(2)}ms / max ${Number(stats.maxUpdateMs || 0).toFixed(2)}ms
frames ${frames.toLocaleString()} / points ${(points * buffers).toLocaleString()}`;
  }

  let workerHz = Number.isFinite(Number(stats.loopHz)) ? Number(stats.loopHz) : (Number(stats.workerTicks || stats.frames || 0) * 1000 / elapsed);
  return `${label} ${status} fps ${fps.toFixed(1)}
update avg ${avg.toFixed(2)}ms / max ${Number(stats.maxUpdateMs || 0).toFixed(2)}ms
worker hz ${workerHz.toFixed(1)} / points ${Number(stats.points || 0).toLocaleString()}`;
}
function startCircularWorkerChart({uPlotCtor, spec, slot, engineLabel, points, durationMs, step, stopRef}) {
  return (async () => {
    slot.mount.textContent = '';
    let live = makeCircularLiveData(points);
    let size = chartSizeForMount(slot.mount, spec);
    let created = await createChart(uPlotCtor, spec, live.data, slot.mount, size);
    attachResponsiveResize(created.chart, slot.mount, spec);
    populateLegend(slot.legend, spec);

    let statsEl = document.createElement('div');
    statsEl.className = 'bench-live-stats';
    slot.card.appendChild(statsEl);

    let stats = {
      points,
      step,
      frames: 0,
      workerTicks: 0,
      fallbackFrames: 0,
      offset: 0,
      bytesCopied: 0,
      updateMs: 0,
      maxUpdateMs: 0,
      startedAt: performance.now(),
      createMs: created.createMs,
      firstMs: created.firstMs,
    };
    statsEl.textContent = formatLiveStats(engineLabel, stats, true);

    let worker = createCircularOffsetWorker();
    let latestOffset = 0;
    let lastWorkerAt = 0;
    let stopped = false;
    let rendering = false;
    let rafId = 0;
    let done;
    let promise = new Promise(resolve => { done = resolve; });

    function finish() {
      if (stopped)
        return;
      stopped = true;
      if (rafId)
        cancelAnimationFrame(rafId);
      try { worker.postMessage({type: 'stop'}); }
      catch (err) {}
      try { worker.terminate(); }
      catch (err) {}
      stats.completedAt = performance.now();
      statsEl.textContent = formatLiveStats(engineLabel, stats, false);
      done({chart: created.chart, worker, stats});
    }

    async function renderFrame() {
      if (stopped || rendering)
        return;
      rendering = true;
      if (stopRef?.()) {
        rendering = false;
        finish();
        return;
      }
      let nowTime = performance.now();
      if (!lastWorkerAt || nowTime - lastWorkerAt > 90) {
        latestOffset = (latestOffset + step) % points;
        stats.fallbackFrames++;
      }
      let t0 = performance.now();
      live.swap = !live.swap;
      let y = live.swap ? live.yA : live.yB;
      rotateInto(y, live.source, latestOffset);
      live.y = y;
      live.data = [live.x, y];
      try {
        created.chart.setData(live.data, false);
        created.chart.redraw(true, false);
        await submitChartFrame(created.chart);
      }
      catch (err) {
        stats.error = err?.message || String(err);
        statsEl.textContent = `${engineLabel} error
${stats.error}`;
        rendering = false;
        finish();
        return;
      }
      let dt = performance.now() - t0;
      stats.frames++;
      stats.offset = latestOffset;
      stats.bytesCopied += y.byteLength;
      stats.updateMs += dt;
      stats.maxUpdateMs = Math.max(stats.maxUpdateMs, dt);
      if (stats.frames % 4 == 0)
        statsEl.textContent = formatLiveStats(engineLabel, stats, true);
      rendering = false;
      if (performance.now() - stats.startedAt >= durationMs) {
        finish();
        return;
      }
      rafId = requestAnimationFrame(renderFrame);
    }

    worker.onmessage = event => {
      if (stopped)
        return;
      let msg = event.data || {};
      if (msg.type != 'tick')
        return;
      latestOffset = msg.offset || 0;
      lastWorkerAt = performance.now();
      stats.workerTicks++;
    };

    worker.onerror = event => {
      stats.error = event.message || 'worker error';
      statsEl.textContent = `${engineLabel} worker error
${stats.error}`;
      finish();
    };

    worker.postMessage({type: 'start', points, step, targetMs: 16});
    rafId = requestAnimationFrame(renderFrame);
    created.chart._benchWorker = worker;
    created.chart._benchWorkerStop = finish;
    return {chart: created.chart, worker, stats, promise};
  })();
}


function makeVisualCases() {
  return [
    {id: 'visual:events-spikes', title: 'visual / server events spikes', visualTitle: 'Server Events', cardTitle: 'Server Events', kind: 'events', points: 360, series: 3, variant: 'spike', width: 1, chartTitle: false, legend: true, visualHeight: 420},
    {id: 'visual:cursor-focus', title: 'visual / cursor focus', visualTitle: 'Cursor Focus', cardTitle: 'Cursor Focus', kind: 'cursor', points: 260, series: 3, variant: 'trend', fill: false, chartTitle: false, legend: true, hooks: mergeHooks(cursorFocusPlugin().hooks, interactiveCursorPlugin({xLabel: 'x', defaultIdxFrac: 0.58, items: [{seriesIdx: 1, label: 'blue', color: '#276ef1'}, {seriesIdx: 2, label: 'red', color: '#ff5330'}, {seriesIdx: 3, label: 'green', color: '#23a455'}]}).hooks)},
    {id: 'visual:trendlines', title: 'visual / trendlines', visualTitle: 'Trendlines', cardTitle: 'Trendlines', kind: 'trendline', points: 260, series: 2, variant: 'trend', fill: false, chartTitle: false, legend: true, visualHeight: 420, ...trendlinePlugin()},
    {id: 'visual:hourly-users', title: 'visual / hourly users noisy', visualTitle: 'Hourly Users', cardTitle: 'Hourly Users', kind: 'line', points: 32768, series: 3, variant: 'hourly-users', fill: false, chartTitle: false, legend: true, visualHeight: 430, largeDataZoom: true, largeDataZoomMaxPoints: 3600, largeDataZoomInitialMaxPoints: 3600, hooks: mergeHooks(decimatedAreaPlugin({seriesIdx: 1, fill: 'rgba(91,182,234,0.10)', maxSegments: 900}).hooks, interactiveCursorPlugin({xLabel: 'day', defaultIdxFrac: 0.58, xFormatter: v => Number.isFinite(v) ? `${Math.round(v * 100) / 100}` : '', items: [{seriesIdx: 1, label: '2019', color: '#5bb6ea'}, {seriesIdx: 2, label: '2018', color: '#e6a24d'}, {seriesIdx: 3, label: '2017', color: '#ff5330'}]}).hooks), seriesStyles: [{label: '2019', stroke: '#5bb6ea', width: 1.3}, {label: '2018', stroke: '#e6a24d', width: 1.1}, {label: '2017', stroke: '#ff5330', width: 1.25}]},
    {id: 'visual:temperature-range', title: 'visual / seasonal temperature style', visualTitle: 'Temps', cardTitle: 'Temps', kind: 'bands', points: 220, series: 3, variant: 'line', chartTitle: false, legend: true, visualHeight: 430, hooks: mergeHooks(bandShadePlugin({upperIdx: 3, lowerIdx: 1, fill: 'rgba(102,112,133,0.18)'}).hooks, interactiveCursorPlugin({xLabel: 'day', defaultIdxFrac: 0.58, valueFormatter: v => `${Math.round(v * 10) / 10}°F`, items: [{seriesIdx: 1, label: 'low', color: '#9ca3af'}, {seriesIdx: 2, label: 'avg', color: '#ff4d32'}, {seriesIdx: 3, label: 'high', color: '#9ca3af'}]}).hooks)},
    {id: 'visual:sparkline-grid', title: 'visual / sparkline grid', visualTitle: 'Market Sparklines', cardTitle: 'Market Sparklines', kind: 'plugin', points: 1, series: 0, variant: 'hidden', hideSeries: true, axesShow: false, grid: false, chartTitle: false, legend: true, visualHeight: 260, mouse: false, ...sparklineGridPlugin()},
    {id: 'visual:candlestick', title: 'visual / candlestick ohlc', visualTitle: 'Gold', cardTitle: 'Gold', kind: 'ohlc', points: 80, series: 4, variant: 'ohlc', hideSeries: true, keepHiddenSeries: true, hooks: mergeHooks(candlestickPlugin().hooks, interactiveCursorPlugin({xLabel: 'day', defaultIdxFrac: 0.62, valueFormatter: v => `$${Math.round(v).toLocaleString()}`, items: [{seriesIdx: 1, label: 'open', color: '#667085'}, {seriesIdx: 2, label: 'high', color: '#23a455'}, {seriesIdx: 3, label: 'low', color: '#e4572e'}, {seriesIdx: 4, label: 'close', color: '#276ef1'}]}).hooks), chartTitle: false, legend: true, visualHeight: 390},
    {id: 'visual:line-benchmark-bars', title: 'visual / chart benchmark bars', visualTitle: 'Chart Benchmarks', cardTitle: 'Chart Benchmarks', kind: 'bars', points: 2, series: 1, variant: 'hidden', hideSeries: true, axesShow: false, grid: false, chartTitle: false, legend: true, visualHeight: 320, hooks: benchmarkBarsPlugin().hooks},
    {id: 'visual:box-whisker', title: 'visual / box whisker', visualTitle: 'Box / whisker', cardTitle: 'Box / whisker', kind: 'box', points: 120, series: 1, variant: 'trend', hideSeries: true, keepHiddenSeries: true, hooks: boxWhiskerPlugin().hooks, chartTitle: false, legend: false, scales: {x: {time: false}, y: {range: [8, 44]}}},
    {id: 'visual:heatmap', title: 'visual / latency heatmap', visualTitle: 'Latency Heatmap Aggregated 10ms (~20k)', cardTitle: 'Latency Heatmap Aggregated 10ms (~20k)', kind: 'heatmap', points: 160, series: 1, variant: 'hidden', hideSeries: true, hooks: heatmapBinsPlugin().hooks, axesShow: true, grid: true, chartTitle: false, legend: false, visualHeight: 420},
    {id: 'visual:path-stepped', title: 'visual / stepped path', visualTitle: 'Stepped path', cardTitle: 'Stepped path', kind: 'line-path', points: 220, series: 2, variant: 'stepped', stepped: true, chartTitle: false, legend: true, visualHeight: 360, seriesStyles: [{label: 'step before/after', stroke: '#276ef1', width: 2.4}, {label: 'comparison', stroke: '#e4572e', width: 1.7, dash: [7, 5]}]},
    {id: 'visual:path-spline', title: 'visual / monotone cubic interpolation path', visualTitle: 'Path interpolation / monotone cubic', cardTitle: 'Monotone cubic interpolation', kind: 'line-path', points: 10, series: 2, variant: 'spline-shape', spline: true, chartTitle: false, legend: true, visualHeight: 360, showPoints: true, seriesStyles: [{label: 'monotone cubic path', stroke: '#23a455', width: 2.8, points: {show: true, size: 7, stroke: '#23a455', fill: '#fff'}}, {label: 'second monotone path', stroke: '#7c3aed', width: 1.8, points: {show: true, size: 5, stroke: '#7c3aed', fill: '#fff'}}]},
    {id: 'visual:path-catmull', title: 'visual / Catmull-Rom interpolation path', visualTitle: 'Path interpolation / Catmull-Rom', cardTitle: 'Catmull-Rom interpolation', kind: 'line-path', points: 11, series: 2, variant: 'catmull-shape', spline2: true, chartTitle: false, legend: true, visualHeight: 360, showPoints: true, seriesStyles: [{label: 'centripetal Catmull-Rom path', stroke: '#d39200', width: 2.8, points: {show: true, size: 7, stroke: '#d39200', fill: '#fff'}}, {label: 'second Catmull-Rom path', stroke: '#008a8a', width: 1.8, points: {show: true, size: 5, stroke: '#008a8a', fill: '#fff'}}]},
    {id: 'visual:stroke-gradient', title: 'visual / multiple stroke gradients', visualTitle: 'Color-changing stroke gradients', cardTitle: 'Color-changing stroke gradients', kind: 'line-gradient', points: 260, series: 3, variant: 'gradient-strokes', hideSeries: true, keepHiddenSeries: true, strokeGradient: false, fill: false, gradientFill: false, chartTitle: false, legend: true, visualHeight: 380, hooks: strokeGradientProofPlugin({seriesCount: 3}).hooks, seriesStyles: [{label: 'line 1 color shifts blue → gold → green', stroke: '#276ef1', width: 0}, {label: 'line 2 color shifts red → pink → violet', stroke: '#e4572e', width: 0}, {label: 'line 3 color shifts teal → green → orange', stroke: '#008a8a', width: 0}]},
    {id: 'visual:points-sized', title: 'visual / styled point markers', visualTitle: 'Styled points', cardTitle: 'Styled points', kind: 'points', points: 180, series: 2, variant: 'scatter', showPoints: true, width: 0, chartTitle: false, legend: true, visualHeight: 360, seriesStyles: [{label: 'large hollow', stroke: '#276ef1', width: 0, points: {show: true, size: 9, stroke: '#276ef1', fill: '#fff'}}, {label: 'small filled', stroke: '#e4572e', width: 0, points: {show: true, size: 5, stroke: '#e4572e', fill: '#e4572e'}}]},

    {id: 'visual:line', title: 'visual / line styling', visualTitle: 'Line styling', cardTitle: 'Line styling', kind: 'line', points: 280, series: 3, variant: 'line', chartTitle: false, legend: true, visualHeight: 390, showPoints: true, hooks: lineStyleBackplatePlugin().hooks, seriesStyles: [{label: 'thick solid', stroke: '#276ef1', width: 3.6, points: {show: false}}, {label: 'medium dashed', stroke: '#e4572e', width: 2.4, dash: [12, 7], points: {show: false}}, {label: 'thin dotted + points', stroke: '#23a455', width: 1.4, dash: [2, 6], points: {show: true, size: 5, stroke: '#23a455', fill: '#fff'}}]},
    {id: 'visual:dash-palette', title: 'visual / dash and marker palette', visualTitle: 'Dash / marker palette', cardTitle: 'Dash / marker palette', kind: 'line', points: 280, series: 4, variant: 'line', chartTitle: false, legend: true, visualHeight: 390, showPoints: true, seriesStyles: [{label: 'wide solid no points', stroke: '#1d4ed8', width: 4.0, points: {show: false}}, {label: 'long dash', stroke: '#e4572e', width: 2.7, dash: [16, 8], points: {show: false}}, {label: 'dot dash + hollow', stroke: '#23a455', width: 1.8, dash: [3, 5, 12, 5], points: {show: true, size: 6, stroke: '#23a455', fill: '#fff'}}, {label: 'thin dotted', stroke: '#7c3aed', width: 1.3, dash: [1, 6], points: {show: false}}]},
    {id: 'visual:stacked-areas', title: 'visual / translucent layered areas', visualTitle: 'Layered translucent areas', cardTitle: 'Layered translucent areas', kind: 'area', points: 300, series: 4, variant: 'trend', fill: true, gradientFill: true, chartTitle: false, legend: true, visualHeight: 410, seriesStyles: [{label: 'north region', stroke: '#276ef1', width: 1.7, fill: 'rgba(39,110,241,0.20)'}, {label: 'south region', stroke: '#e4572e', width: 1.5, fill: 'rgba(228,87,46,0.16)'}, {label: 'west region', stroke: '#23a455', width: 1.4, fill: 'rgba(35,164,85,0.14)'}, {label: 'east region', stroke: '#7c3aed', width: 1.3, fill: 'rgba(124,58,237,0.12)'}]},
    {id: 'visual:log-scale', title: 'visual / positive log scale', visualTitle: 'Log scale positive values', cardTitle: 'Log scale positive values', kind: 'line', points: 220, series: 3, variant: 'log-positive', scales: {x: {time: false}, y: {distr: 3}}, chartTitle: false, legend: true, visualHeight: 390, seriesStyles: [{label: 'exp signal A', stroke: '#276ef1', width: 2.2}, {label: 'exp signal B', stroke: '#e4572e', width: 2.0, dash: [10, 6]}, {label: 'exp signal C', stroke: '#23a455', width: 1.8}]},
    {id: 'visual:arcsinh-scale', title: 'visual / arcsinh signed scale', visualTitle: 'Arcsinh signed scale', cardTitle: 'Arcsinh signed scale', kind: 'line', points: 260, series: 2, variant: 'arcsinh', scales: {x: {time: false}, y: {distr: 4, asinh: 40}}, chartTitle: false, legend: true, visualHeight: 390, seriesStyles: [{label: 'signed sweep', stroke: '#276ef1', width: 2.4}, {label: 'oscillation', stroke: '#e4572e', width: 2.0, dash: [10, 6]}]},
    {id: 'visual:custom-scale', title: 'visual / custom sqrt scale', visualTitle: 'Custom distr=100 scale', cardTitle: 'Custom distr=100 scale', kind: 'line', points: 240, series: 2, variant: 'custom-scale', scales: {x: {time: false}, y: {distr: 100, fwd: v => Math.sqrt(Math.max(0, v)), bwd: v => v * v, range: (u, min, max) => [0, Math.max(1, Math.ceil(max || 1))]}}, chartTitle: false, legend: true, visualHeight: 390, seriesStyles: [{label: 'custom scale A', stroke: '#276ef1', width: 2.2}, {label: 'custom scale B', stroke: '#23a455', width: 2.0}]},
    {id: 'visual:dependent-scale', title: 'visual / dependent scale', visualTitle: 'Dependent scale', cardTitle: 'Dependent scale', kind: 'line', points: 260, series: 2, variant: 'dependent-scale', scales: {x: {time: false}, y: {}, pct: {from: 'y', range: (u, min, max) => [min / 2, max / 2]}}, axes: [{show: true, grid: {show: true}, label: 'sample', labelGap: 4, labelSize: 28}, {show: true, scale: 'y', side: 3, grid: {show: true}, label: 'base dollars', labelGap: 6, labelSize: 36}, {show: true, scale: 'pct', side: 1, grid: {show: false}, label: 'dependent / 2', labelGap: 6, labelSize: 42}], chartTitle: false, legend: true, visualHeight: 410, seriesStyles: [{label: 'base dollars', stroke: '#276ef1', width: 2.4}, {label: 'dependent scale', stroke: '#e4572e', width: 2.2, dash: [12, 7], scale: 'pct'}]},
    {id: 'visual:time-dst', title: 'visual / time axis DST span', visualTitle: 'Time axis / DST span', cardTitle: 'Time axis / DST span', kind: 'line', points: 180, series: 2, variant: 'time-dst', scales: {x: {time: true}, y: {}}, chartTitle: false, legend: true, visualHeight: 390, seriesStyles: [{label: 'season A', stroke: '#276ef1', width: 2.2}, {label: 'season B', stroke: '#7c3aed', width: 2.0, dash: [9, 6]}]},
    {id: 'visual:dual-axis', title: 'visual / dual y-axis scales', visualTitle: 'Dual y axes', cardTitle: 'Dual y axes', kind: 'line', points: 260, series: 2, variant: 'dual-axis', scales: {x: {time: false}, y: {}, y2: {}}, axes: [{show: true, grid: {show: true}, label: 'sample', labelGap: 4, labelSize: 28}, {show: true, scale: 'y', side: 3, grid: {show: true}, label: 'visits', labelGap: 6, labelSize: 34}, {show: true, scale: 'y2', side: 1, grid: {show: false}, label: 'latency ms', labelGap: 6, labelSize: 42}], chartTitle: false, legend: true, visualHeight: 410, seriesStyles: [{label: 'visits', stroke: '#276ef1', width: 2.4}, {label: 'latency ms', stroke: '#e4572e', width: 2.4, dash: [12, 7], scale: 'y2'}]},
    {id: 'visual:threshold-zones', title: 'visual / threshold zones and guides', visualTitle: 'Threshold zones', cardTitle: 'Threshold zones', kind: 'line', points: 260, series: 2, variant: 'trend', chartTitle: false, legend: true, visualHeight: 390, hooks: thresholdZonesPlugin().hooks, seriesStyles: [{label: 'actual', stroke: '#276ef1', width: 2.3}, {label: 'forecast', stroke: '#e4572e', width: 2.1, dash: [9, 6]}]},
    {id: 'visual:wheel-zoom', title: 'visual / wheel zoom compatibility', visualTitle: 'Wheel zoom interaction', cardTitle: 'Wheel zoom interaction', kind: 'line', points: 280, series: 2, variant: 'trend', chartTitle: false, legend: true, visualHeight: 390, hooks: mergeHooks(wheelZoomCompatibilityPlugin().hooks, interactiveCursorPlugin({xLabel: 'x', defaultIdxFrac: 0.50, items: [{seriesIdx: 1, label: 'primary', color: '#276ef1'}, {seriesIdx: 2, label: 'secondary', color: '#e4572e'}]}).hooks), seriesStyles: [{label: 'wheel target A', stroke: '#276ef1', width: 2.3}, {label: 'wheel target B', stroke: '#e4572e', width: 2.0, dash: [9, 6]}]},
    {id: 'visual:y-scale-drag', title: 'visual / y scale drag compatibility', visualTitle: 'Y-scale drag interaction', cardTitle: 'Y-scale drag interaction', kind: 'line', points: 280, series: 2, variant: 'line', chartTitle: false, legend: true, visualHeight: 390, hooks: mergeHooks(yScaleDragCompatibilityPlugin().hooks, interactiveCursorPlugin({xLabel: 'x', defaultIdxFrac: 0.50, items: [{seriesIdx: 1, label: 'drag A', color: '#276ef1'}, {seriesIdx: 2, label: 'drag B', color: '#e4572e'}]}).hooks), seriesStyles: [{label: 'drag target A', stroke: '#276ef1', width: 2.3}, {label: 'drag target B', stroke: '#e4572e', width: 2.0, dash: [9, 6]}]},
    {id: 'visual:sparse-nearest', title: 'visual / sparse nearest non-null cursor', visualTitle: 'Sparse nearest non-null', cardTitle: 'Sparse nearest non-null', kind: 'line', points: 260, series: 3, variant: 'missing', nulls: true, chartTitle: false, legend: true, visualHeight: 390, showPoints: true, hooks: mergeHooks(sparseNearestMarkerPlugin({seriesIdx: 1}).hooks, interactiveCursorPlugin({xLabel: 'x', defaultIdxFrac: 0.58, items: [{seriesIdx: 1, label: 'sparse A', color: '#276ef1'}, {seriesIdx: 2, label: 'sparse B', color: '#e4572e'}, {seriesIdx: 3, label: 'sparse C', color: '#23a455'}]}).hooks), seriesStyles: [{label: 'sparse A', stroke: '#276ef1', width: 2.1, points: {show: true, size: 4, stroke: '#276ef1', fill: '#fff'}}, {label: 'sparse B', stroke: '#e4572e', width: 1.9, dash: [9, 6], points: {show: true, size: 3, stroke: '#e4572e', fill: '#fff'}}, {label: 'sparse C', stroke: '#23a455', width: 1.8, points: {show: true, size: 3, stroke: '#23a455', fill: '#fff'}}]},
    {id: 'visual:annotations', title: 'visual / annotations and callouts', visualTitle: 'Annotations / callouts', cardTitle: 'Annotations / callouts', kind: 'line', points: 240, series: 2, variant: 'spike', chartTitle: false, legend: true, visualHeight: 390, hooks: annotationCalloutsPlugin().hooks, seriesStyles: [{label: 'primary metric', stroke: '#276ef1', width: 2.2}, {label: 'secondary metric', stroke: '#23a455', width: 1.8, dash: [8, 5]}]},
    {id: 'visual:canvas-api-coverage', title: 'visual / Canvas2D API coverage', visualTitle: 'Canvas2D API coverage', cardTitle: 'Canvas2D API coverage', kind: 'plugin', points: 64, series: 1, variant: 'hidden', hideSeries: true, keepHiddenSeries: true, axesShow: false, grid: false, chartTitle: false, legend: true, visualHeight: 330, hooks: canvasApiCoveragePlugin().hooks},
    {id: 'visual:text-image-composite', title: 'visual / text image composite API coverage', visualTitle: 'Text / image / composite API', cardTitle: 'Text / image / composite API', kind: 'plugin', points: 64, series: 1, variant: 'hidden', hideSeries: true, keepHiddenSeries: true, axesShow: false, grid: false, chartTitle: false, legend: true, visualHeight: 330, hooks: textImageCompositeApiPlugin().hooks},
    {id: 'visual:area-gradient', title: 'visual / gradient area fill', visualTitle: 'Gradient area fill', cardTitle: 'Gradient area fill', kind: 'area', points: 300, series: 1, variant: 'trend', fill: false, gradientFill: false, strokeGradient: false, chartTitle: false, legend: true, visualHeight: 410, hooks: gradientAreaPlugin({seriesIdx: 1}).hooks},
    {id: 'visual:bands', title: 'visual / ribbon median style', visualTitle: 'Ribbon + dashed median', cardTitle: 'Ribbon + dashed median', kind: 'bands', points: 220, series: 3, variant: 'line', chartTitle: false, legend: true, visualHeight: 410, hooks: mergeHooks(bandShadePlugin({upperIdx: 3, lowerIdx: 1, fill: 'rgba(39,110,241,0.20)'}).hooks, cursorGuidePlugin({xFrac: 0.72, yFrac: 0.50, color: 'rgba(71,84,103,0.55)'}).hooks), seriesStyles: [{label: 'lower bound', stroke: 'rgba(39,110,241,0.16)', width: 1.0}, {label: 'dashed median', stroke: '#e4572e', width: 2.5, dash: [10, 7]}, {label: 'upper bound', stroke: 'rgba(39,110,241,0.16)', width: 1.0}]},
    {id: 'visual:bars', title: 'visual / bars', visualTitle: 'Bars', cardTitle: 'Bars', kind: 'bars', points: 54, series: 2, variant: 'bar', bars: true, fill: true, rounded: false, chartTitle: false, legend: true},
    {id: 'visual:grouped-bars', title: 'visual / grouped bars', visualTitle: 'Grouped bars', cardTitle: 'Grouped bars', kind: 'bars', points: 36, series: 4, variant: 'bar', bars: true, fill: true, rounded: false, chartTitle: false, legend: true},
    {id: 'visual:scatter', title: 'visual / point scatter', visualTitle: 'Point / scatter', cardTitle: 'Point / scatter', kind: 'points', points: 260, series: 2, variant: 'scatter', showPoints: true, width: 0, chartTitle: false, legend: true},
    {id: 'visual:missing', title: 'visual / missing data', visualTitle: 'Missing data', cardTitle: 'Missing data', kind: 'missing', points: 300, series: 3, variant: 'missing', nulls: true, chartTitle: false, legend: true},
    {id: 'visual:sparkline', title: 'visual / sparkline', visualTitle: 'Sparkline', cardTitle: 'Sparkline', kind: 'sparkline', points: 2, series: 1, variant: 'hidden', hideSeries: true, axesShow: false, grid: false, chartTitle: false, legend: false, visualHeight: 120, mouse: false, hooks: sparklineCardPlugin().hooks},
    {id: 'visual:sparklines-bars', title: 'visual / sparkline bars', visualTitle: 'Sparkline bars', cardTitle: 'Sparkline bars', kind: 'plugin', points: 2, series: 1, variant: 'hidden', hideSeries: true, axesShow: false, grid: false, chartTitle: false, legend: false, visualHeight: 130, mouse: false, hooks: benchmarkBarsPlugin().hooks},
    {id: 'visual:scales-dir-ori-matrix', title: 'visual / scales dir orientation matrix', visualTitle: 'Scales dir / orientation matrix', cardTitle: 'Scales dir / orientation matrix', kind: 'plugin', points: 2, series: 1, variant: 'hidden', hideSeries: true, axesShow: false, grid: false, chartTitle: false, legend: true, visualHeight: 360, hooks: scalesDirOriMatrixPlugin().hooks},
    {id: 'visual:fill-stroke-clip-pathology', title: 'visual / fill stroke clip pathology', visualTitle: 'Fill / stroke / clip pathology', cardTitle: 'Fill / stroke / clip pathology', kind: 'plugin', points: 2, series: 1, variant: 'hidden', hideSeries: true, axesShow: false, grid: false, chartTitle: false, legend: true, visualHeight: 340, hooks: fillStrokeClipPathologyPlugin().hooks},
    {id: 'visual:bar-stack-values', title: 'visual / grouped stacked bar values', visualTitle: 'Grouped stacked bar values', cardTitle: 'Grouped stacked bar values', kind: 'plugin', points: 2, series: 1, variant: 'hidden', hideSeries: true, axesShow: false, grid: false, chartTitle: false, legend: true, visualHeight: 330, hooks: barStackValueAutosizePlugin().hooks},
    {id: 'visual:soft-minmax-shift', title: 'visual / soft minmax y-shift sync zero', visualTitle: 'Soft min/max + y shift', cardTitle: 'Soft min/max + y shift', kind: 'line', points: 220, series: 2, variant: 'soft-minmax', scales: {x: {time: false}, y: {range: (u, min, max) => [Math.min(0, min - 8), Math.max(95, max + 8)]}}, chartTitle: false, legend: true, visualHeight: 390, hooks: softMinMaxShiftPlugin().hooks, seriesStyles: [{label: 'soft range series', stroke: '#276ef1', width: 2.2}, {label: 'y-shifted series', stroke: '#e4572e', width: 2.0, dash: [9, 6]}]},
    {id: 'visual:alignment-gap-clip', title: 'visual / aligned gaps clip', visualTitle: 'Aligned data + gap clip', cardTitle: 'Aligned data + gap clip', kind: 'line', points: 260, series: 3, variant: 'aligned-gapped', chartTitle: false, legend: true, visualHeight: 390, hooks: mergeHooks(alignmentGapClipPlugin().hooks, interactiveCursorPlugin({xLabel: 'x', defaultIdxFrac: 0.60, items: [{seriesIdx: 1, label: 'gap A', color: '#276ef1'}, {seriesIdx: 2, label: 'gap B', color: '#e4572e'}, {seriesIdx: 3, label: 'gap C', color: '#23a455'}]}).hooks), seriesStyles: [{label: 'aligned A', stroke: '#276ef1', width: 0}, {label: 'aligned B', stroke: '#e4572e', width: 0}, {label: 'aligned C', stroke: '#23a455', width: 0}]},
    {id: 'visual:wind-direction', title: 'visual / wind direction arrows', visualTitle: 'Wind direction arrows', cardTitle: 'Wind direction arrows', kind: 'line', points: 96, series: 2, variant: 'wind', chartTitle: false, legend: true, visualHeight: 390, hooks: windDirectionCompatibilityPlugin().hooks, seriesStyles: [{label: 'wind speed', stroke: '#276ef1', width: 1.8}, {label: 'direction degrees', stroke: 'rgba(0,0,0,0)', width: 0}]},
    {id: 'visual:touch-zoom', title: 'visual / touch zoom compatibility', visualTitle: 'Touch zoom compatibility', cardTitle: 'Touch zoom compatibility', kind: 'line', points: 260, series: 2, variant: 'line', chartTitle: false, legend: true, visualHeight: 390, hooks: mergeHooks(touchZoomCompatibilityPlugin().hooks, interactiveCursorPlugin({xLabel: 'x', defaultIdxFrac: 0.55, items: [{seriesIdx: 1, label: 'touch A', color: '#276ef1'}, {seriesIdx: 2, label: 'touch B', color: '#e4572e'}]}).hooks), seriesStyles: [{label: 'touch target A', stroke: '#276ef1', width: 2.2}, {label: 'touch target B', stroke: '#e4572e', width: 2.0, dash: [9, 6]}]},
    {id: 'visual:readback-composite', title: 'visual / readback composite matrix', visualTitle: 'Readback + composite matrix', cardTitle: 'Readback + composite matrix', kind: 'plugin', points: 2, series: 1, variant: 'hidden', hideSeries: true, axesShow: false, grid: false, chartTitle: false, legend: true, visualHeight: 330, hooks: readbackCompositeMatrixPlugin().hooks},
    {id: 'visual:axis-scale-compat', title: 'visual / axis scale compatibility', visualTitle: 'Axis / scale compatibility', cardTitle: 'Axis / scale compatibility', kind: 'line', points: 220, series: 2, variant: 'line', chartTitle: false, legend: true, visualHeight: 390, hooks: axisScaleCompatibilityPlugin().hooks, pxAlign: 1, seriesStyles: [{label: 'axis signal A', stroke: '#276ef1', width: 2.2}, {label: 'axis signal B', stroke: '#e4572e', width: 2.0, dash: [9, 6]}]},
    {id: 'visual:cursor-bind-snap', title: 'visual / cursor bind snap tooltip', visualTitle: 'Cursor bind / snap / tooltip', cardTitle: 'Cursor bind / snap / tooltip', kind: 'line', points: 240, series: 2, variant: 'missing', nulls: true, chartTitle: false, legend: true, visualHeight: 390, hooks: cursorBindSnapTooltipPlugin().hooks, seriesStyles: [{label: 'snap series A', stroke: '#276ef1', width: 2.2}, {label: 'snap series B', stroke: '#e4572e', width: 2.0, dash: [9, 6]}]},
    {id: 'visual:sync-ranger', title: 'visual / sync ranger zoom', visualTitle: 'Sync / ranger / zoom fetch', cardTitle: 'Sync / ranger / zoom fetch', kind: 'plugin', points: 160, series: 1, variant: 'hidden', hideSeries: true, axesShow: false, grid: false, chartTitle: false, legend: true, visualHeight: 360, hooks: syncRangerCompatibilityPlugin().hooks},
    {id: 'visual:time-localized-discrete', title: 'visual / localized timeline discrete', visualTitle: 'Localized timeline / discrete', cardTitle: 'Localized timeline / discrete', kind: 'plugin', points: 180, series: 1, variant: 'hidden', hideSeries: true, axesShow: false, grid: false, chartTitle: false, legend: true, visualHeight: 340, hooks: timeLocalizationDiscretePlugin().hooks},
    {id: 'visual:image-clip-gradient', title: 'visual / image clip gradient stress', visualTitle: 'Image / clip / gradient stress', cardTitle: 'Image / clip / gradient stress', kind: 'plugin', points: 80, series: 1, variant: 'hidden', hideSeries: true, axesShow: false, grid: false, chartTitle: false, legend: true, visualHeight: 340, hooks: imageClipGradientCompatibilityPlugin().hooks},
    {id: 'visual:no-data', title: 'visual / no data', visualTitle: 'No data', cardTitle: 'No data', kind: 'empty', points: 0, series: 1, variant: 'hidden', chartTitle: false, legend: true, visualHeight: 260, hooks: noDataPanelPlugin().hooks},
    {id: 'visual:dynamic-series', title: 'visual / dynamic add remove series', visualTitle: 'Dynamic series lifecycle', cardTitle: 'Dynamic series lifecycle', kind: 'line', points: 180, series: 2, variant: 'line', chartTitle: false, legend: true, visualHeight: 390, hooks: mergeHooks(dynamicSeriesCompatPlugin().hooks, interactiveCursorPlugin({xLabel: 'x', defaultIdxFrac: 0.52, items: [{seriesIdx: 1, label: 's1', color: '#276ef1'}, {seriesIdx: 2, label: 's2', color: '#e4572e'}]}).hooks), seriesStyles: [{label: 'base A', stroke: '#276ef1', width: 2.2}, {label: 'base B', stroke: '#e4572e', width: 2.0, dash: [9, 6]}]},
    {id: 'visual:stacked-series', title: 'visual / stacked series', visualTitle: 'Stacked series', cardTitle: 'Stacked series', kind: 'area', points: 180, series: 3, variant: 'stacked-series', fill: false, chartTitle: false, legend: true, visualHeight: 390, hooks: stackedAreaCompatPlugin().hooks, seriesStyles: [{label: 'layer A edge', stroke: '#276ef1', width: 1.7}, {label: 'layer B edge', stroke: '#23a455', width: 1.6}, {label: 'layer C edge', stroke: '#e4572e', width: 1.5}]},
    {id: 'visual:bar-stroke-fill', title: 'visual / thin bars stroke fill', visualTitle: 'Thin bars stroke/fill', cardTitle: 'Thin bars stroke/fill', kind: 'plugin', points: 2, series: 1, variant: 'hidden', hideSeries: true, axesShow: false, grid: false, chartTitle: false, legend: true, visualHeight: 300, hooks: barStrokeFillCompatPlugin().hooks},
    {id: 'visual:mass-spectrum', title: 'visual / mass spectrum datums', visualTitle: 'Mass spectrum', cardTitle: 'Mass spectrum', kind: 'line', points: 220, series: 1, variant: 'mass-spectrum', bars: true, barSize: [0.18, Infinity, 1], fill: true, chartTitle: false, legend: true, visualHeight: 380, seriesStyles: [{label: 'intensity peaks', stroke: '#276ef1', width: 1.2, fill: 'rgba(39,110,241,0.24)'}]},
    {id: 'visual:plugin-facade', title: 'visual / plugin draw hooks', visualTitle: 'Plugin drawing', cardTitle: 'Plugin draw hooks', kind: 'plugin', points: 180, series: 2, variant: 'line', fill: false, chartTitle: false, legend: true, visualHeight: 410, ...facadePluginCase()},
  ];
}

function chartSizeForMount(mount, spec) {
  let rect = mount.getBoundingClientRect();
  let parentRect = mount.parentElement?.getBoundingClientRect?.() || {width: 0};
  let cssWidth = rect.width || mount.clientWidth || Math.max(0, parentRect.width - 20) || 360;
  let width = Math.max(240, Math.floor(cssWidth));
  let height = chartMountHeight(spec);
  return {width, height};
}

function makePairRow(spec) {
  let row = document.createElement('section');
  row.className = 'bench-pair';
  row.dataset.caseId = spec.id;

  let label = document.createElement('div');
  label.className = 'bench-pair-title';
  label.textContent = spec.visualTitle || spec.cardTitle || spec.title;
  row.appendChild(label);

  let gpu = makeCard({...spec, engineKey: 'webgpu', engineLabel: 'WebGPU'});
  let canvas = makeCard({...spec, engineKey: 'canvas2d', engineLabel: 'Canvas2D'});
  row.append(gpu.card, canvas.card);

  return {row, webgpu: gpu, canvas};
}

async function renderVisualChart(Chart, spec, slot, pool, settings) {
  slot.mount.textContent = '';
  setCardLoad(slot, {live: 'loading chart'});
  let fullData = dataForSpec(pool, spec, settings.reuse);
  let renderSpec = spec;
  let data = fullData;
  if (spec.largeDataZoom && fullData?.[0]?.length) {
    let xs = fullData[0];
    let min = Number(xs[0]);
    let max = Number(xs[xs.length - 1]);
    let maxPoints = spec.largeDataZoomInitialMaxPoints || spec.largeDataZoomMaxPoints || 4500;
    if (Number.isFinite(min) && Number.isFinite(max) && max > min) {
      data = windowDataByXRange(fullData, min, max, maxPoints);
      renderSpec = {...spec, largeDataZoomSourceData: fullData, largeDataZoomMaxPoints: maxPoints};
    }
  }
  let size = chartSizeForMount(slot.mount, renderSpec);
  let created = await createChart(Chart, renderSpec, data, slot.mount, size);
  attachResponsiveResize(created.chart, slot.mount, renderSpec);
  populateLegend(slot.legend, renderSpec);
  setCardLoad(slot, {createMs: created.createMs, firstMs: created.firstMs, initMs: created.initMs, gpuWaitMs: created.gpuWaitMs});
  return created;
}

function attachResponsiveResize(chart, mount, spec) {
  if (!chart || !mount || typeof ResizeObserver == 'undefined')
    return;
  let lastW = 0;
  let raf = 0;
  let pending = false;
  let resize = () => {
    raf = 0;
    pending = false;
    if (!chart.root || !mount.isConnected)
      return;
    let size = chartSizeForMount(mount, spec);
    if (!Number.isFinite(size.width) || size.width < 32)
      return;
    let lastH = chart._benchLastResizeHeight || 0;
    if (Math.abs(size.width - lastW) < 2 && Math.abs(size.height - lastH) < 2)
      return;
    lastW = size.width;
    chart._benchLastResizeHeight = size.height;
    try {
      chart.setSize(size);
      chart.redraw?.(true, false);
      submitChartFrame(chart);
      requestAnimationFrame(() => {
        try {
          chart.redraw?.(false, false);
          submitChartFrame(chart);
        }
        catch (err) {}
      });
    }
    catch (err) {}
  };
  let ro = new ResizeObserver(() => {
    if (pending)
      return;
    pending = true;
    raf = requestAnimationFrame(resize);
  });
  try {
    lastW = chartSizeForMount(mount, spec).width;
    ro.observe(mount);
    chart._benchResizeObserver = ro;
    chart._benchResizeRAF = () => raf && cancelAnimationFrame(raf);
  }
  catch (err) {}
}

function dataForSpec(pool, spec, reuse) {
  if (spec.kind == 'heatmap')
    return pool.get(['heatmap-hidden', spec.points, spec.series], () => makeData({...spec, variant: 'hidden'}), reuse);
  if (spec.variant == 'ohlc')
    return pool.get(['ohlc', spec.points], () => makeOhlcData(spec.points), reuse);
  if (spec.id == 'visual:hourly-users')
    return pool.get(['hourly-users-1mb', spec.points], () => makeHourlyUsersData(spec.points), reuse);
  if (spec.id == 'visual:temperature-range')
    return pool.get(['temps', spec.points], () => makeTemperatureData(spec.points), reuse);
  if (spec.id == 'visual:log-scale')
    return pool.get(['log-scale', spec.points], () => makeLogScaleData(spec.points), reuse);
  if (spec.id == 'visual:arcsinh-scale')
    return pool.get(['arcsinh-scale', spec.points], () => makeArcsinhScaleData(spec.points), reuse);
  if (spec.id == 'visual:custom-scale')
    return pool.get(['custom-scale', spec.points], () => makeCustomScaleData(spec.points), reuse);
  if (spec.id == 'visual:dependent-scale')
    return pool.get(['dependent-scale', spec.points], () => makeDependentScaleData(spec.points), reuse);
  if (spec.id == 'visual:time-dst')
    return pool.get(['time-dst', spec.points], () => makeTimeDstData(spec.points), reuse);
  if (spec.id == 'visual:soft-minmax-shift')
    return pool.get(['soft-minmax', spec.points], () => makeSoftMinMaxData(spec.points), reuse);
  if (spec.id == 'visual:alignment-gap-clip')
    return pool.get(['aligned-gapped', spec.points], () => makeAlignedGappedData(spec.points), reuse);
  if (spec.id == 'visual:wind-direction')
    return pool.get(['wind-direction', spec.points], () => makeWindDirectionData(spec.points), reuse);
  if (spec.id == 'visual:stacked-series')
    return pool.get(['stacked-series', spec.points], () => makeStackedSeriesData(spec.points), reuse);
  if (spec.id == 'visual:mass-spectrum')
    return pool.get(['mass-spectrum', spec.points], () => makeMassSpectrumData(spec.points), reuse);
  if (spec.id == 'visual:no-data')
    return pool.get(['no-data'], () => makeNoData(), reuse);
  if (spec.id == 'visual:dual-axis')
    return pool.get(['dual-axis', spec.points], () => makeDualAxisData(spec.points), reuse);
  if (spec.kind == 'bands')
    return pool.get(['bands', spec.points], () => makeBandData(spec.points), reuse);
  if (spec.kind == 'box')
    return pool.get(['box-scale', spec.points], () => makeBoxScaleData(spec.points), reuse);
  return pool.get([spec.variant, spec.points, spec.series, !!spec.nulls], () => makeData(spec), reuse);
}

function chartMountHeight(spec) {
  if (spec.visualHeight)
    return spec.visualHeight;
  if (spec.kind == 'sparkline')
    return spec.legend === false ? 90 : 130;
  let base = 320;
  if (spec.legend !== false)
    base += 92;
  if (spec.axesShow === false)
    base -= 24;
  return Math.max(120, base);
}


function legendItemsForSpec(spec) {
  if (spec.legend === false)
    return [];
  if (spec.legendItems)
    return spec.legendItems;
  if (spec.id == 'visual:events-spikes')
    return [
      {label: 'CPU', color: '#276ef1'},
      {label: 'RAM', color: '#7c3aed'},
      {label: 'TCP Out', color: '#23a455'},
    ];
  if (spec.id == 'visual:hourly-users')
    return [
      {label: '2019 noisy users', color: '#5bb6ea'},
      {label: '2018 noisy users', color: '#e6a24d'},
      {label: '2017 noisy users', color: '#ff5330'},
      {label: '32,768 samples / ~1 MB arrays', color: '#45708c', dashed: true},
    ];
  if (spec.id == 'visual:cursor-focus')
    return [
      {label: 'focus window', color: '#276ef1', type: 'band'},
      {label: 'cursor x=58%', color: '#276ef1', dashed: true},
      {label: 'red: 37', color: '#ff5330'},
      {label: 'blue: 45', color: '#276ef1'},
    ];
  if (spec.id == 'visual:sparkline-grid')
    return [
      {label: 'mini area fill', color: '#5bb6ea', type: 'band'},
      {label: 'mini close line', color: '#8ed0ff'},
    ];
  if (spec.id == 'visual:candlestick')
    return [
      {label: 'up candle', color: '#23a455', type: 'band'},
      {label: 'down candle', color: '#e4572e', type: 'band'},
      {label: 'hover OHLC values', color: '#607d8b', dashed: true},
    ];
  if (spec.id == 'visual:temperature-range')
    return [
      {label: 'seasonal range', color: '#a8a8a8', type: 'band'},
      {label: 'dashed avg', color: '#ff4d32', dashed: true},
      {label: 'hover cursor values', color: '#607d8b', dashed: true},
    ];
  if (spec.id == 'visual:trendlines')
    return [
      {label: 'Data 1', color: '#e4572e'},
      {label: 'Data 2', color: '#276ef1'},
      {label: 'Trend 1', color: '#e4572e', dashed: true},
      {label: 'Trend 2', color: '#276ef1', dashed: true},
    ];
  if (spec.id == 'visual:canvas-api-coverage')
    return [
      {label: 'roundRect', color: '#276ef1', type: 'band'},
      {label: 'ellipse/radial gradient', color: '#e4572e', type: 'band'},
      {label: 'arcTo', color: '#23a455'},
      {label: 'evenodd + pattern', color: '#7c3aed', type: 'band'},
    ];
  if (spec.id == 'visual:text-image-composite')
    return [
      {label: 'shadow + lighter composite', color: '#276ef1', type: 'band'},
      {label: 'drawImage smoothing probe', color: '#d39200', type: 'band'},
      {label: 'destination-out cutout', color: '#23a455', type: 'band'},
      {label: 'text spacing / RTL', color: '#7c3aed'},
    ];
  if (spec.id == 'visual:arcsinh-scale')
    return [
      {label: 'negative/positive signed values', color: '#276ef1'},
      {label: 'cross-zero oscillation', color: '#e4572e', dashed: true},
      {label: 'arcsinh distribution', color: '#475467', dashed: true},
    ];
  if (spec.id == 'visual:custom-scale')
    return [
      {label: 'sqrt custom distr=100 A', color: '#276ef1'},
      {label: 'sqrt custom distr=100 B', color: '#23a455'},
    ];
  if (spec.id == 'visual:dependent-scale')
    return [
      {label: 'base dollars scale', color: '#276ef1'},
      {label: 'dependent half-scale', color: '#e4572e', dashed: true},
    ];
  if (spec.id == 'visual:time-dst')
    return [
      {label: 'spring season signal', color: '#276ef1'},
      {label: 'secondary date signal', color: '#7c3aed', dashed: true},
      {label: 'time axis / DST span', color: '#475467', dashed: true},
    ];
  if (spec.id == 'visual:wheel-zoom')
    return [
      {label: 'wheel zoom x', color: '#276ef1'},
      {label: 'shift/alt wheel zoom y', color: '#e4572e', dashed: true},
      {label: 'double-click reset', color: '#475467', dashed: true},
    ];
  if (spec.id == 'visual:y-scale-drag')
    return [
      {label: 'vertical drag pans y', color: '#276ef1'},
      {label: 'alt-drag zooms y', color: '#e4572e', dashed: true},
    ];
  if (spec.id == 'visual:sparse-nearest')
    return [
      {label: 'sparse series with null gaps', color: '#276ef1'},
      {label: 'sampled non-null markers', color: '#276ef1', type: 'band'},
      {label: 'cursor readout skips null gaps', color: '#475467', dashed: true},
    ];
  if (spec.id == 'visual:scales-dir-ori-matrix')
    return [
      {label: 'x/y dir matrix', color: '#276ef1'},
      {label: 'axis side/orientation probe', color: '#e4572e', type: 'band'},
    ];
  if (spec.id == 'visual:fill-stroke-clip-pathology')
    return [
      {label: 'self-intersect even-odd fill', color: '#276ef1', type: 'band'},
      {label: 'clipped bezier stroke', color: '#7c3aed'},
      {label: 'nested hole fill', color: '#e4572e', type: 'band'},
    ];
  if (spec.id == 'visual:bar-stack-values')
    return [
      {label: 'grouped + stacked bars', color: '#276ef1', type: 'band'},
      {label: 'autosized value labels', color: '#475467', dashed: true},
    ];
  if (spec.id == 'visual:soft-minmax-shift')
    return [
      {label: 'soft min/max band', color: '#276ef1', type: 'band'},
      {label: 'y-shifted series', color: '#e4572e', dashed: true},
      {label: 'sync y zero guide', color: '#475467', dashed: true},
    ];
  if (spec.id == 'visual:alignment-gap-clip')
    return [
      {label: 'aligned x data', color: '#276ef1'},
      {label: 'null gap clipping', color: '#e4572e', dashed: true},
      {label: 'rounded clip path', color: '#23a455', type: 'band'},
    ];
  if (spec.id == 'visual:wind-direction')
    return [
      {label: 'wind speed line', color: '#276ef1'},
      {label: 'direction arrows', color: '#276ef1', type: 'band'},
    ];
  if (spec.id == 'visual:touch-zoom')
    return [
      {label: 'pinch pointer tracking', color: '#276ef1', type: 'band'},
      {label: 'x/y zoom response', color: '#e4572e', dashed: true},
    ];
  if (spec.id == 'visual:readback-composite')
    return [
      {label: 'composite mode matrix', color: '#276ef1', type: 'band'},
      {label: 'readback probe', color: '#475467', dashed: true},
    ];
  if (spec.id == 'visual:axis-scale-compat')
    return [
      {label: 'axis autosize/control/indicators', color: '#276ef1', type: 'band'},
      {label: 'grid over series + pixel align', color: '#e4572e', dashed: true},
      {label: 'nice scale + scale padding', color: '#23a455', dashed: true},
    ];
  if (spec.id == 'visual:cursor-bind-snap')
    return [
      {label: 'bound cursor area', color: '#e4572e', type: 'band'},
      {label: 'snapped non-null point', color: '#276ef1'},
      {label: 'closest tooltip', color: '#475467', dashed: true},
    ];
  if (spec.id == 'visual:sync-ranger')
    return [
      {label: 'synced cursor line', color: '#475467', dashed: true},
      {label: 'ranger grips', color: '#276ef1', type: 'band'},
      {label: 'zoom fetch window', color: '#23a455', type: 'band'},
    ];
  if (spec.id == 'visual:time-localized-discrete')
    return [
      {label: 'localized month labels', color: '#276ef1', type: 'band'},
      {label: 'timeline discrete markers', color: '#e4572e'},
      {label: 'time periods', color: '#23a455'},
    ];
  if (spec.id == 'visual:image-clip-gradient')
    return [
      {label: 'conic gradient even-odd clip', color: '#7c3aed', type: 'band'},
      {label: 'inline SVG image draw', color: '#e4572e', type: 'band'},
      {label: 'rounded clipping path', color: '#276ef1', dashed: true},
    ];
  if (spec.id == 'visual:dynamic-series')
    return [
      {label: 'setData pulse', color: '#276ef1'},
      {label: 'temporary added series', color: '#23a455'},
      {label: 'addSeries/delSeries lifecycle', color: '#475467', dashed: true},
    ];
  if (spec.id == 'visual:stacked-series')
    return [
      {label: 'layer A', color: '#276ef1', type: 'band'},
      {label: 'layer B', color: '#23a455', type: 'band'},
      {label: 'layer C', color: '#e4572e', type: 'band'},
    ];
  if (spec.id == 'visual:bar-stroke-fill')
    return [
      {label: 'stroke/fill bar variants', color: '#276ef1', type: 'band'},
      {label: 'rounded bar variant', color: '#e4572e', type: 'band'},
    ];
  if (spec.id == 'visual:mass-spectrum')
    return [
      {label: 'vertical spectral peaks', color: '#276ef1'},
      {label: 'dense datum measurement', color: '#475467', dashed: true},
    ];
  if (spec.id == 'visual:no-data')
    return [
      {label: 'empty x/y arrays', color: '#475467', dashed: true},
      {label: 'plugin no-data panel', color: '#276ef1', type: 'band'},
    ];
  if (spec.id == 'visual:area-gradient')
    return [{label: 'Series', color: '#276ef1'}];
  if (spec.id == 'visual:bands')
    return [
      {label: 'transparent bounds', color: '#276ef1', type: 'band'},
      {label: 'thick dashed median', color: '#e4572e', dashed: true},
      {label: 'target guide', color: '#475467', dashed: true},
    ];
  if (spec.id == 'visual:line')
    return [
      {label: 'thick solid', color: '#276ef1'},
      {label: 'medium dashed', color: '#e4572e', dashed: true},
      {label: 'thin dotted + points', color: '#23a455', dashed: true},
    ];
  if (spec.id == 'visual:line-benchmark-bars')
    return [
      {label: 'Lib Size', color: '#3fba58'},
      {label: 'Render', color: '#9b59b6'},
      {label: 'Heap', color: '#c8173f'},
      {label: 'Final', color: '#f1a22d'},
      {label: 'Interact', color: '#4e8ab8'},
      {label: 'Toggle', color: '#f0d05a'},
    ];
  if (spec.id == 'visual:bars')
    return [{label: 'Series 1', color: '#276ef1'}, {label: 'Series 2', color: '#e4572e'}];
  if (spec.id == 'visual:grouped-bars')
    return [
      {label: 'A', color: '#276ef1'},
      {label: 'B', color: '#e4572e'},
      {label: 'C', color: '#23a455'},
      {label: 'D', color: '#7c3aed'},
    ];
  if (spec.id == 'visual:scatter')
    return [{label: 'Series 1', color: '#276ef1'}, {label: 'Series 2', color: '#e4572e'}];
  if (spec.id == 'visual:missing')
    return [
      {label: 'Series 1', color: '#276ef1'},
      {label: 'Series 2', color: '#e4572e'},
      {label: 'Series 3', color: '#23a455'},
    ];
  if (spec.id == 'visual:plugin-facade')
    return [
      {label: 'Facade A', color: '#276ef1', type: 'band'},
      {label: 'Facade B', color: '#e4572e', type: 'band'},
      {label: 'Guide', color: '#666666', dashed: true},
    ];
  if (spec.id?.startsWith?.('worker-style:') || spec.id?.startsWith?.('capacity:') || spec.id?.startsWith?.('live-demo:')) {
    if (spec.styleMode == 'area-gradient')
      return [{label: 'shader fill', color: '#276ef1', type: 'band'}, {label: 'rotating line', color: '#276ef1'}];
    if (spec.styleMode == 'bands')
      return [{label: 'shader band fill', color: '#276ef1', type: 'band'}, {label: 'dashed median / source', color: '#e4572e', dashed: true}];
    if (spec.styleMode == 'heatmap')
      return [{label: 'animated heat cells', color: '#d6653a', type: 'band'}];
    if (spec.styleMode == 'bars')
      return [{label: 'animated bars', color: '#276ef1', type: 'band'}];
    if (spec.styleMode == 'multi-line')
      return [
        {label: `${spec.bufferCount || 1} rotating buffers`, color: '#276ef1'},
        {label: `${Number(spec.points || 0).toLocaleString()} points per buffer`, color: '#23a455', dashed: true},
      ];
    return [{label: `${Number(spec.points || 0).toLocaleString()} rotating samples`, color: '#276ef1'}];
  }
  if (Array.isArray(spec.seriesStyles) && spec.seriesStyles.length) {
    return spec.seriesStyles.map((style, i) => ({
      label: style.label || `series ${i + 1}`,
      color: style.stroke || SERIES_COLORS[i % SERIES_COLORS.length],
      dashed: !!style.dash,
    }));
  }
  return [];
}

function populateLegend(legendEl, spec) {
  if (!legendEl)
    return;
  let items = legendItemsForSpec(spec);
  legendEl.textContent = '';
  if (!items.length) {
    legendEl.classList.add('is-hidden');
    return;
  }
  legendEl.classList.remove('is-hidden');
  for (let item of items) {
    let row = document.createElement('div');
    row.className = 'bench-legend-item';
    let swatchColor = item.color || '#444';
    row.style.color = 'rgba(24,24,24,0.9)';
    let sw = document.createElement('span');
    sw.className = 'bench-legend-swatch';
    sw.style.color = swatchColor;
    if (item.dashed)
      sw.classList.add('is-dashed');
    if (item.type == 'band')
      sw.classList.add('is-band');
    let label = document.createElement('span');
    label.textContent = item.label;
    row.append(sw, label);
    legendEl.appendChild(row);
  }
}

function makeCard(spec) {
  let card = document.createElement('article');
  card.className = 'bench-card';
  if (spec.engineKey)
    card.dataset.engine = spec.engineKey;

  let header = document.createElement('h3');
  let title = document.createElement('span');
  title.textContent = `${spec.engineLabel ? spec.engineLabel + ' / ' : ''}${spec.cardTitle || spec.visualTitle || spec.title}`;
  let kind = document.createElement('small');
  kind.textContent = spec.kind;
  header.append(title, kind);

  let load = document.createElement('div');
  load.className = 'bench-card-load is-running';
  load.textContent = 'rendering';

  let chart = document.createElement('div');
  chart.className = 'bench-chart';
  let chartH = chartMountHeight(spec);
  chart.style.height = `${chartH}px`;
  chart.style.minHeight = `${chartH}px`;
  let legend = document.createElement('div');
  legend.className = 'bench-legend is-hidden';
  card.style.minHeight = `${chartH + 108}px`;
  card.append(header, load, chart, legend);
  return {card, mount: chart, legend, load};
}

function setCardLoad(slot, timing) {
  let el = slot?.load || slot?.card?.querySelector?.('.bench-card-load');
  if (!el)
    return;

  if (timing?.error) {
    el.className = 'bench-card-load is-error';
    el.textContent = timing.error;
    return;
  }

  if (timing?.live) {
    el.className = 'bench-card-load is-live';
    el.textContent = timing.live;
    return;
  }

  let card = slot?.card || el.closest?.('.bench-card');
  let engineKey = slot?.engineKey || card?.dataset?.engine || '';
  let firstLabel = engineKey == 'canvas2d' ? 'draw' : 'submit';
  let loadMs = Number(timing?.loadMs);
  if (!Number.isFinite(loadMs))
    loadMs = (Number.isFinite(timing?.createMs) ? timing.createMs : 0) + (Number.isFinite(timing?.firstMs) ? timing.firstMs : 0);

  let parts = [];
  if (Number.isFinite(loadMs) && loadMs > 0)
    parts.push(['load', loadMs]);
  if (Number.isFinite(timing?.createMs))
    parts.push(['create', timing.createMs]);
  if (Number.isFinite(timing?.firstMs))
    parts.push([firstLabel, timing.firstMs]);
  if (Number.isFinite(timing?.updateMs) && timing.updateMs > 0)
    parts.push(['update', timing.updateMs]);
  if (Number.isFinite(timing?.initMs) && timing.initMs > 0)
    parts.push(['init', timing.initMs]);

  el.className = parts.length ? 'bench-card-load is-done' : 'bench-card-load';
  el.textContent = '';

  for (let [label, value] of parts) {
    let item = document.createElement('span');
    let strong = document.createElement('b');
    strong.textContent = ms(value);
    item.append(`${label} `, strong, ' ms');
    el.appendChild(item);
  }
}

function makeResultRow(index, spec, engineLabel = '') {
  let tr = document.createElement('tr');
  tr.dataset.status = 'pending';
  tr.dataset.engine = spec.engineKey || '';
  tr.innerHTML = `
    <td>${index + 1}</td><td>${engineLabel}</td><td data-cell="status">pending</td><td>${spec.title}</td><td>${spec.kind}</td>
    <td>${spec.points.toLocaleString()}</td><td>${spec.series}</td>
    <td data-cell="create"></td><td data-cell="first"></td><td data-cell="update"></td><td data-cell="destroy"></td><td data-cell="budget"></td><td data-cell="baseline"></td><td data-cell="notes"></td>
  `;
  return tr;
}

function setRow(row, patch) {
  for (let [key, value] of Object.entries(patch)) {
    let cell = row.querySelector(`[data-cell="${key}"]`);
    if (cell)
      cell.textContent = value;
  }
  if (patch.status)
    row.dataset.status = patch.status == 'done' ? 'done' : patch.status == 'error' ? 'error' : 'running';
}

function appendRowNote(row, note) {
  let cell = row?.querySelector?.('[data-cell="notes"]');
  if (!cell || !note)
    return;
  let existing = cell.textContent || '';
  if (existing.includes(note))
    return;
  cell.textContent = existing ? `${existing}, ${note}` : note;
}

function attachRowResult(row, result) {
  if (!row || result == null)
    return;

  try {
    row.dataset.result = JSON.stringify(result, (key, value) => {
      if (key == 'chart' || key == 'card' || key == 'mount')
        return undefined;
      if (value instanceof Float32Array || value instanceof Float64Array || value instanceof Uint8Array)
        return {typedArray: value.constructor.name, length: value.length};
      return value;
    });
  }
  catch (err) {
    row.dataset.result = JSON.stringify({error: 'could not serialize result', message: String(err?.message || err)});
  }
}

async function createChart(uPlot, spec, data, mount, size) {
  let opts = makeBaseOpts(uPlot, spec, size.width, size.height);
  if (spec.variant == 'ohlc') {
    let keepSeries = !!spec.keepHiddenSeries || !spec.hideSeries;
    let lineWidth = spec.hideSeries ? 0 : 1;
    let lineStroke = spec.hideSeries ? 'rgba(0,0,0,0)' : undefined;
    opts.series = [
      {label: 'x'},
      {label: 'open', show: keepSeries, stroke: lineStroke || '#667085', width: lineWidth, points: {show: false}},
      {label: 'high', show: keepSeries, stroke: lineStroke || '#23a455', width: lineWidth, points: {show: false}},
      {label: 'low', show: keepSeries, stroke: lineStroke || '#e4572e', width: lineWidth, points: {show: false}},
      {label: 'close', show: keepSeries, stroke: lineStroke || '#276ef1', width: spec.hideSeries ? 0 : 1.5, points: {show: false}},
    ];
  }
  if (spec.id == 'visual:bands') {
    opts.series[1].stroke = 'rgba(39,110,241,0)';
    opts.series[1].width = 0;
    opts.series[1].points = {show: false};
    opts.series[2].stroke = '#e4572e';
    opts.series[2].dash = [10, 7];
    opts.series[2].width = 3.2;
    opts.series[3].stroke = 'rgba(35,164,85,0)';
    opts.series[3].width = 0;
    opts.series[3].points = {show: false};
  }
  if (spec.id == 'visual:temperature-range') {
    opts.series[1].stroke = 'rgba(150,150,150,0)';
    opts.series[1].width = 0;
    opts.series[1].points = {show: false};
    opts.series[2].stroke = '#ff4d32';
    opts.series[2].dash = [11, 8];
    opts.series[2].width = 3.0;
    opts.series[2].points = {show: false};
    opts.series[3].stroke = 'rgba(150,150,150,0)';
    opts.series[3].width = 0;
    opts.series[3].points = {show: false};
  }

  opts.hooks = withBenchDrawTimingHooks(opts.hooks || {});

  let createStart = now();
  let chart = new uPlot(opts, data, mount);
  let createMs = now() - createStart;

  let initStart = now();
  if (chart.ctx?.initPromise)
    await chart.ctx.initPromise;
  let initMs = now() - initStart;

  let firstStart = now();
  let submitted = isCanvas2DChart(chart)
    ? await submitChartFrame(chart, {forceCanvasDraw: !Number.isFinite(Number(chart._benchLastDrawMs)) || Number(chart._benchLastDrawMs) <= 0})
    : await submitChartFrame(chart);
  let firstMs = Number.isFinite(submitted.submitMs) ? submitted.submitMs : now() - firstStart;
  let gpuWaitMs = 0;
  if (spec.measureGpuWait === true && chart.ctx?.flush) {
    let waitStart = now();
    await chart.ctx.flush();
    gpuWaitMs = now() - waitStart;
  }
  await nextFrame();

  return {chart, createMs, firstMs, initMs, gpuWaitMs, frameStats: submitted.frameStats || chart.ctx?.getLastFrameStats?.() || null};
}

async function runUpdates(chart, data, spec, frames) {
  if (!frames)
    return 0;
  let total = 0;
  for (let i = 0; i < frames; i++) {
    mutateData(data, i * 5 + 1, spec.variant == 'bar' ? 'bar' : spec.variant);
    await settleForTiming();
    let t0 = now();
    chart.setData(data, false);
    await submitChartFrame(chart);
    total += now() - t0;
    await nextFrame();
  }
  return total / frames;
}

function queueVisibleCard(ui, settings, card) {
  if (!settings.keep) {
    card.remove();
    return;
  }

  if (!settings.isolate || !settings.deferVisible) {
    ui.grid.appendChild(card);
    return;
  }

  settings.visibleFragment.appendChild(card);
  settings.visiblePending++;
}

function flushVisibleCards(ui, settings) {
  if (!settings?.visibleFragment || settings.visibleFragment.childNodes.length == 0)
    return 0;

  let count = settings.visibleFragment.childNodes.length;
  ui.grid.appendChild(settings.visibleFragment);
  settings.visibleFragment = document.createDocumentFragment();
  settings.visiblePending = 0;
  return count;
}

async function runManyCharts(uPlot, spec, sharedData, mount, settings, slot = null) {
  let count = spec.id.includes('many-small') ? 18 : 8;
  let charts = [];
  let createMs = 0;
  let firstMs = 0;
  let updateMs = 0;

  mount.classList.add('bench-sparkline-row');

  for (let i = 0; i < count; i++) {
    let child = document.createElement('div');
    mount.appendChild(child);
    let childSpec = {...spec, title: `${spec.title} #${i + 1}`, legend: false, axesShow: spec.id.includes('many-small') ? false : spec.axesShow};
    let size = spec.id.includes('many-small') ? {width: 220, height: 82} : {width: 260, height: 145};
    await settleForTiming();
    let created = await createChart(uPlot, childSpec, sharedData, child, size);
    charts.push(created.chart);
    createMs += created.createMs;
    firstMs += created.firstMs;
  }

  if (settings.updates) {
    let total = 0;
    for (let frame = 0; frame < settings.updates; frame++) {
      mutateData(sharedData, frame * 5 + 1, spec.variant);
      await settleForTiming();
      let t0 = now();
      for (let chart of charts) {
        chart.setData(sharedData, false);
        await submitChartFrame(chart);
      }
      total += now() - t0;
      await nextFrame();
    }
    updateMs = total / settings.updates;
  }

  let destroyMs = 0;
  if (!settings.keep) {
    let t0 = now();
    for (let chart of charts)
      chart.destroy();
    mount.textContent = '';
    destroyMs = now() - t0;
  }

  setCardLoad(slot, {createMs, firstMs, updateMs, destroyMs});
  return {count, createMs, firstMs, updateMs, destroyMs, frameStats: charts[charts.length - 1]?.ctx?.getLastFrameStats?.() || null};
}



const RAW_RING_WGSL = `
struct VSOut {
  @builtin(position) position: vec4<f32>,
  @location(0) color: vec4<f32>,
};

@vertex
fn vs(@location(0) pos: vec2<f32>) -> VSOut {
  var out: VSOut;
  out.position = vec4<f32>(pos, 0.0, 1.0);
  out.color = vec4<f32>(0.18, 0.43, 0.95, 1.0);
  return out;
}

@fragment
fn fs(in: VSOut) -> @location(0) vec4<f32> {
  return in.color;
}
`;

function makeRawRingVertexData(points) {
  let vertices = new Float32Array(points * 2);
  let denom = Math.max(1, points - 1);
  for (let i = 0; i < points; i++) {
    vertices[i * 2 + 0] = -1 + 2 * i / denom;
    vertices[i * 2 + 1] = Math.sin(i * 0.01) * 0.42;
  }
  return vertices;
}

function mutateRawRingChunk(vertices, head, chunk, tick) {
  let points = vertices.length >> 1;
  for (let j = 0; j < chunk; j++) {
    let i = (head + j) % points;
    vertices[i * 2 + 1] = Math.sin((tick + j) * 0.035) * 0.46 + Math.cos(i * 0.002 + tick * 0.015) * 0.16;
  }
  return (head + chunk) % points;
}

async function createRawRingRuntime(canvas, points, width, height) {
  if (!navigator?.gpu)
    throw new Error('WebGPU is not available for the raw ring upload test');

  let dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
  canvas.width = Math.max(1, Math.round(width * dpr));
  canvas.height = Math.max(1, Math.round(height * dpr));
  canvas.style.width = width + 'px';
  canvas.style.height = height + 'px';

  let adapter = await navigator.gpu.requestAdapter();
  if (!adapter)
    throw new Error('No WebGPU adapter available');
  let device = await adapter.requestDevice();
  let context = canvas.getContext('webgpu');
  let format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({device, format, alphaMode: 'premultiplied'});

  let module = device.createShaderModule({code: RAW_RING_WGSL});
  let pipeline = device.createRenderPipeline({
    layout: 'auto',
    vertex: {
      module,
      entryPoint: 'vs',
      buffers: [{
        arrayStride: 8,
        attributes: [{shaderLocation: 0, offset: 0, format: 'float32x2'}],
      }],
    },
    fragment: {
      module,
      entryPoint: 'fs',
      targets: [{format}],
    },
    primitive: {
      topology: 'line-strip',
    },
  });
  let vertexBuffer = device.createBuffer({
    size: points * 2 * 4,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });

  return {device, context, format, pipeline, vertexBuffer, width: canvas.width, height: canvas.height};
}

function rawRingWriteChunk(runtime, vertices, start, count) {
  let points = vertices.length >> 1;
  if (count <= 0)
    return 0;

  if (start + count <= points) {
    let slice = vertices.subarray(start * 2, (start + count) * 2);
    runtime.device.queue.writeBuffer(runtime.vertexBuffer, start * 8, slice, 0, slice.length);
    return slice.byteLength;
  }

  let firstCount = points - start;
  let first = vertices.subarray(start * 2, points * 2);
  let secondCount = count - firstCount;
  let second = vertices.subarray(0, secondCount * 2);
  runtime.device.queue.writeBuffer(runtime.vertexBuffer, start * 8, first, 0, first.length);
  runtime.device.queue.writeBuffer(runtime.vertexBuffer, 0, second, 0, second.length);
  return first.byteLength + second.byteLength;
}

function rawRingWriteFull(runtime, vertices) {
  runtime.device.queue.writeBuffer(runtime.vertexBuffer, 0, vertices, 0, vertices.length);
  return vertices.byteLength;
}

function rawRingModeLabel(mode) {
  if (mode == 'full')
    return 'full-buffer upload';
  if (mode == 'draw-only')
    return 'draw-only baseline';
  return 'partial circular upload';
}

function rawRingDraw(runtime, points, loadOp = 'clear') {
  let encoder = runtime.device.createCommandEncoder();
  let view = runtime.context.getCurrentTexture().createView();
  let pass = encoder.beginRenderPass({
    colorAttachments: [{
      view,
      clearValue: {r: 0, g: 0, b: 0, a: 0},
      loadOp,
      storeOp: 'store',
    }],
  });
  pass.setPipeline(runtime.pipeline);
  pass.setVertexBuffer(0, runtime.vertexBuffer);
  pass.draw(points, 1, 0, 0);
  pass.end();
  runtime.device.queue.submit([encoder.finish()]);
}

async function runRawGpuRingAnimation(ui, pool, spec, row, settings, totals) {
  let mode = spec.rawMode || 'partial';
  setRow(row, {status: 'running', notes: `creating raw WebGPU ring upload animation (${rawRingModeLabel(mode)})`});
  let {card, mount} = makeCard(spec);
  let timedHost = settings.isolate ? ui.stage : ui.grid;
  timedHost.appendChild(card);
  let canvas = document.createElement('canvas');
  canvas.className = 'bench-raw-webgpu';
  mount.textContent = '';
  mount.appendChild(canvas);
  await settleForTiming();

  let dataKey = ['raw-gpu-ring', spec.points, mode];
  let vertices = pool.get(dataKey, () => makeRawRingVertexData(spec.points), settings.reuse);
  let durationMs = Math.max(1000, (settings.animationSeconds || 10) * 1000);
  let divisor = Math.max(4, Math.min(512, settings.rawChunkDivisor || 64));
  let chunk = Math.max(1024, Math.min(262144, Math.floor(spec.points / divisor)));
  let head = 0;
  let frames = 0;
  let dropped = 0;
  let wraps = 0;
  let totalUpdate = 0;
  let totalMutate = 0;
  let totalWrite = 0;
  let totalSubmit = 0;
  let worstUpdate = 0;
  let uploadedBytes = 0;
  let samples = [];
  let sampleEveryMs = 500;
  let nextSampleAt = 0;

  let createStart = now();
  let runtime = await createRawRingRuntime(canvas, spec.points, 720, 280);
  let createMs = now() - createStart;
  let firstStart = now();
  runtime.device.queue.writeBuffer(runtime.vertexBuffer, 0, vertices, 0, vertices.length);
  rawRingDraw(runtime, spec.points, 'clear');
  await runtime.device.queue.onSubmittedWorkDone();
  let firstMs = now() - firstStart;
  uploadedBytes += vertices.byteLength;
  await nextFrame();

  setRow(row, {status: 'running', notes: `${Math.round(durationMs / 1000)}s raw GPU ring, ${spec.points.toLocaleString()} points, ${rawRingModeLabel(mode)}, chunk ${chunk.toLocaleString()}`});

  let start = now();
  let last = start;
  nextSampleAt = start + sampleEveryMs;
  while (now() - start < durationMs) {
    let before = now();
    let oldHead = head;
    let mutateMs = 0;
    let written = 0;

    if (mode != 'draw-only') {
      let mutateStart = now();
      head = mutateRawRingChunk(vertices, head, chunk, frames);
      mutateMs = now() - mutateStart;
      if (oldHead + chunk > spec.points)
        wraps++;
    }

    let writeStart = now();
    if (mode == 'partial')
      written = rawRingWriteChunk(runtime, vertices, oldHead, chunk);
    else if (mode == 'full')
      written = rawRingWriteFull(runtime, vertices);
    let writeMs = now() - writeStart;

    let submitStart = now();
    rawRingDraw(runtime, spec.points, 'clear');
    await runtime.device.queue.onSubmittedWorkDone();
    let submitMs = now() - submitStart;
    let updateMs = now() - before;

    totalMutate += mutateMs;
    totalWrite += writeMs;
    totalSubmit += submitMs;
    totalUpdate += updateMs;
    worstUpdate = Math.max(worstUpdate, updateMs);
    uploadedBytes += written;
    frames++;

    let t = now();
    if (t - last > 34)
      dropped++;
    last = t;

    if (t >= nextSampleAt) {
      samples.push({
        tMs: Math.round(t - start),
        frame: frames,
        head,
        updateMs,
        mutateMs,
        writeMs,
        submitMs,
        writtenBytes: written,
        uploadedBytes,
      });
      nextSampleAt += sampleEveryMs;
    }

    await nextFrame();
  }

  let elapsed = now() - start;
  let fps = frames / (elapsed / 1000);
  let updateAvg = frames ? totalUpdate / frames : 0;
  let mutateAvg = frames ? totalMutate / frames : 0;
  let writeAvg = frames ? totalWrite / frames : 0;
  let submitAvg = frames ? totalSubmit / frames : 0;
  let uploadMb = uploadedBytes / (1024 * 1024);
  let bandwidthMbSec = elapsed > 0 ? uploadMb / (elapsed / 1000) : 0;
  let destroyStart = now();
  try { runtime.vertexBuffer.destroy(); } catch (err) {}
  try { runtime.context.unconfigure?.(); } catch (err) {}
  try { runtime.device.destroy?.(); } catch (err) {}
  let destroyMs = now() - destroyStart;

  if (!settings.keep)
    card.remove();
  else
    queueVisibleCard(ui, settings, card);

  totals.create += createMs;
  totals.first += firstMs;
  totals.update += totalUpdate;
  totals.done++;

  let fullUploadMbPerFrame = vertices.byteLength / (1024 * 1024);
  let partialUploadKb = mode == 'partial' ? (chunk * 2 * 4) / 1024 : mode == 'full' ? vertices.byteLength / 1024 : 0;
  let uploadModeText = mode == 'partial' ? `${ms(partialUploadKb)} KB/frame vs full ${ms(fullUploadMbPerFrame)} MB/frame` : mode == 'full' ? `${ms(fullUploadMbPerFrame)} MB/frame` : '0 KB/frame';
  let provisionalResult = {animation: {mode, frames, fps, updateAvg, mutateAvg, writeAvg, submitAvg, worstUpdate, dropped, wraps, uploadedBytes, bandwidthMbSec, chunk}};
  let diagnosis = diagnoseRawResult(provisionalResult, settings);
  let notes = `${frames} frames, ${ms(fps)} fps, avg update ${ms(updateAvg)} ms, mutate ${ms(mutateAvg)} ms, write ${ms(writeAvg)} ms, submit ${ms(submitAvg)} ms, worst ${ms(worstUpdate)} ms, dropped-ish ${dropped}, wraps ${wraps}, ${uploadModeText}, total upload ${ms(uploadMb)} MB, ${ms(bandwidthMbSec)} MB/s${diagnosis ? ', ' + diagnosis : ''}`;
  ui.metric('frameStats').textContent = `${spec.points.toLocaleString()} raw verts / ${uploadModeText}`;
  ui.metric('rawRing').textContent = `${mode}: ${ms(fps)} fps, ${ms(bandwidthMbSec)} MB/s`;
  setRow(row, {
    status: 'done',
    create: ms(createMs),
    first: ms(firstMs),
    update: ms(updateAvg),
    destroy: ms(destroyMs),
    notes,
  });
  return {
    createMs,
    firstMs,
    updateAvg,
    updateTotal: totalUpdate,
    destroyMs,
    medianScore: updateAvg,
    frameStats: {solidVertices: spec.points, solidBytes: mode == 'full' ? vertices.byteLength : mode == 'partial' ? chunk * 2 * 4 : 0, imageVertices: 0, imageBytes: 0},
    notes,
    animation: {
      mode,
      frames,
      fps,
      updateAvg,
      mutateAvg,
      writeAvg,
      submitAvg,
      worstUpdate,
      dropped,
      wraps,
      uploadedBytes,
      bandwidthMbSec,
      chunk,
      samples,
      diagnosis,
    },
    diagnosis,
  };
}

function makeCircularAnimationData(points, series) {
  let data = [makeX(points)];
  for (let s = 1; s <= series; s++) {
    let arr = new Float64Array(points);
    for (let i = 0; i < points; i++)
      arr[i] = waveValue(i, s, 'trend');
    data.push(arr);
  }
  return data;
}

function mutateCircularChunk(data, head, chunk, tick) {
  let points = data[0].length;
  for (let s = 1; s < data.length; s++) {
    let arr = data[s];
    for (let j = 0; j < chunk; j++) {
      let i = (head + j) % points;
      arr[i] = Math.sin((tick + j) * 0.035 + s) * 22 + Math.cos(i * 0.002 + tick * 0.015) * 8 + s * 12;
    }
  }
  return (head + chunk) % points;
}

async function runCircularAnimation(uPlot, ui, pool, spec, row, settings, totals) {
  setRow(row, {status: 'running', notes: 'creating large circular animation'});
  let {card, mount} = makeCard(spec);
  let timedHost = settings.isolate ? ui.stage : ui.grid;
  timedHost.appendChild(card);
  await settleForTiming();

  let data = pool.get(['circular-animation', spec.points, spec.series], () => makeCircularAnimationData(spec.points, spec.series), settings.reuse);
  let size = {width: 720, height: 280};
  let created = await createChart(uPlot, spec, data, mount, size);
  let chart = created.chart;
  let durationMs = Math.max(1000, (settings.animationSeconds || 10) * 1000);
  let chunk = Math.max(512, Math.min(65536, Math.floor(spec.points / 48)));
  let head = 0;
  let frames = 0;
  let dropped = 0;
  let totalUpdate = 0;
  let worstUpdate = 0;
  let uploadedBytes = 0;
  let start = now();
  let last = start;

  setRow(row, {status: 'running', notes: `${Math.round(durationMs / 1000)}s circular animation, ${spec.points.toLocaleString()} points, chunk ${chunk.toLocaleString()}`});

  while (now() - start < durationMs) {
    let before = now();
    head = mutateCircularChunk(data, head, chunk, frames);
    chart.setData(data, false);
    await submitChartFrame(chart);
    let updateMs = now() - before;
    totalUpdate += updateMs;
    worstUpdate = Math.max(worstUpdate, updateMs);
    frames++;

    let stats = chart.ctx?.getLastFrameStats?.();
    if (stats)
      uploadedBytes += (stats.solidBytes || 0) + (stats.imageBytes || 0);

    let t = now();
    if (t - last > 34)
      dropped++;
    last = t;
    await nextFrame();
  }

  let elapsed = now() - start;
  let fps = frames / (elapsed / 1000);
  let updateAvg = frames ? totalUpdate / frames : 0;
  let frameStats = chart.ctx?.getLastFrameStats?.() || null;
  let destroyMs = 0;

  if (!settings.keep) {
    let t0 = now();
    chart.destroy();
    card.remove();
    destroyMs = now() - t0;
  }
  else {
    queueVisibleCard(ui, settings, card);
  }

  totals.create += created.createMs;
  totals.first += created.firstMs;
  totals.update += totalUpdate;
  totals.done++;

  let mbUploaded = uploadedBytes / (1024 * 1024);
  let notes = `${frames} frames, ${ms(fps)} fps, avg update ${ms(updateAvg)} ms, worst ${ms(worstUpdate)} ms, dropped-ish ${dropped}, circular chunk ${chunk.toLocaleString()}, upload ${ms(mbUploaded)} MB, ${frameStatsText(frameStats)}`;
  ui.metric('frameStats').textContent = frameStatsText(frameStats);
  setRow(row, {
    status: 'done',
    create: ms(created.createMs),
    first: ms(created.firstMs),
    update: ms(updateAvg),
    destroy: ms(destroyMs),
    notes,
  });

  return {createMs: created.createMs, firstMs: created.firstMs, updateAvg, updateTotal: totalUpdate, destroyMs, frameStats, notes, animation: {frames, fps, updateAvg, worstUpdate, dropped, uploadedBytes}};
}

async function runOneSingle(uPlot, ui, pool, spec, row, settings, totals) {
  setRow(row, {status: 'running', notes: 'creating'});
  if (spec.kind == 'raw-animation')
    return runRawGpuRingAnimation(ui, pool, spec, row, settings, totals);
  let {card, mount} = makeCard(spec);
  let timedHost = settings.isolate ? ui.stage : ui.grid;
  timedHost.appendChild(card);
  await settleForTiming();

  let data = dataForSpec(pool, spec, settings.reuse);
  let size = spec.kind == 'sparkline' ? {width: 340, height: 90} : {width: 540, height: 260};
  let chart = null;

  if (spec.kind == 'animation')
    return runCircularAnimation(uPlot, ui, pool, spec, row, settings, totals);

  if (spec.kind == 'reuse' || spec.id.includes('many-small')) {
    let multi = await runManyCharts(uPlot, spec, data, mount, settings, {card, mount, load: card.querySelector('.bench-card-load')});
    totals.create += multi.createMs;
    totals.first += multi.firstMs;
    totals.update += multi.updateMs * settings.updates;
    totals.done++;
    let runtime = WebGPURenderer.getSharedRuntimeStats?.() || WebGPURendererInternals.getSharedRuntimeStats?.() || {};
    queueVisibleCard(ui, settings, card);
    ui.metric('frameStats').textContent = frameStatsText(multi.frameStats);
    let notes = `${multi.count} charts, ${frameStatsText(multi.frameStats)}, isolated ${settings.isolate ? 'yes' : 'no'}, runtime refs ${runtime.refs ?? ''}`;
    setRow(row, {
      status: 'done',
      create: ms(multi.createMs),
      first: ms(multi.firstMs),
      update: ms(multi.updateMs),
      destroy: ms(multi.destroyMs),
      notes,
    });
    return {createMs: multi.createMs, firstMs: multi.firstMs, updateAvg: multi.updateMs, destroyMs: multi.destroyMs, frameStats: multi.frameStats, notes};
  }

  await settleForTiming();
  let created = await createChart(uPlot, spec, data, mount, size);
  chart = created.chart;
  let createMs = created.createMs;
  let firstMs = created.firstMs;

  let updateAvg = await runUpdates(chart, data, spec, settings.updates);

  if (spec.kind == 'interaction') {
    let min = data[0][Math.floor(data[0].length * 0.15)];
    let max = data[0][Math.floor(data[0].length * 0.85)];
    chart.setScale('x', {min, max});
    chart.setSelect({left: 30, top: 30, width: 120, height: 80}, false);
    await nextFrame();
  }

  if (spec.id.includes('add-del-series')) {
    chart.addSeries({label: 'added', stroke: '#8a63d2', width: 1}, chart.series.length);
    let added = new Float64Array(data[0].length);
    for (let i = 0; i < added.length; i++)
      added[i] = Math.cos(i / 13) * 18;
    data.push(added);
    chart.setData(data, true);
    await nextFrame();
    chart.delSeries(chart.series.length - 1);
    data.pop();
  }

  if (spec.id.includes('resize')) {
    chart.setSize({width: Math.max(360, size.width - 80), height: size.height});
    await nextFrame();
    chart.setSize(size);
  }

  let validationNotes = [];
  if (settings.validate && shouldValidateCase(spec))
    validationNotes = await validateChartSurface(chart, spec);

  let destroyMs = 0;
  if (!settings.keep) {
    let t0 = now();
    chart.destroy();
    card.remove();
    destroyMs = now() - t0;
  }
  else {
    queueVisibleCard(ui, settings, card);
  }

  totals.create += createMs;
  totals.first += firstMs;
  totals.update += updateAvg * settings.updates;
  totals.done++;

  let runtime = WebGPURenderer.getSharedRuntimeStats?.() || WebGPURendererInternals.getSharedRuntimeStats?.() || {};
  let frameStats = chart?.ctx?.getLastFrameStats?.() || null;
  setCardLoad({card}, {createMs, firstMs, updateMs: updateAvg, destroyMs});
  ui.metric('frameStats').textContent = frameStatsText(frameStats);
  let notes = `${frameStatsText(frameStats)}, isolated ${settings.isolate ? 'yes' : 'no'}, runtime refs ${runtime.refs ?? ''}${validationNotes.length ? ', ' + validationNotes.join(', ') : ''}`;
  setRow(row, {
    status: 'done',
    create: ms(createMs),
    first: ms(firstMs),
    update: ms(updateAvg),
    destroy: ms(destroyMs),
    notes,
  });
  return {createMs, firstMs, updateAvg, destroyMs, frameStats, notes};
}

async function runOne(uPlot, ui, pool, spec, row, settings, totals) {
  let repeats = spec.kind == 'animation' || spec.kind == 'raw-animation' ? 1 : Math.max(1, Math.min(7, settings.repeats || 1));
  let results = [];
  let lastError = null;

  for (let repeat = 0; repeat < repeats; repeat++) {
    let keepThisRun = settings.keep && repeat == repeats - 1;
    let repeatSettings = {...settings, keep: keepThisRun, repeats: 1};
    let localTotals = {done: 0, errors: 0, create: 0, first: 0, update: 0};

    if (repeats > 1)
      setRow(row, {status: 'running', notes: `repeat ${repeat + 1} / ${repeats}`});

    try {
      let result = await runOneSingle(uPlot, ui, pool, spec, row, repeatSettings, localTotals);
      results.push(result || {
        createMs: localTotals.create,
        firstMs: localTotals.first,
        updateAvg: settings.updates ? localTotals.update / settings.updates : 0,
        destroyMs: 0,
      });
    }
    catch (err) {
      lastError = err;
      break;
    }

    if (repeat < repeats - 1)
      await idle(40);
  }

  if (lastError)
    throw lastError;

  let createValues = results.map(r => r.createMs);
  let firstValues = results.map(r => r.firstMs);
  let updateValues = results.map(r => r.updateAvg);
  let destroyValues = results.map(r => r.destroyMs);
  let createSum = sumSamples(createValues);
  let firstSum = sumSamples(firstValues);
  let updateTotals = results.map(r => r.updateTotal).filter(Number.isFinite);
  let updateSum = updateTotals.length ? sumSamples(updateTotals) : sumSamples(updateValues) * settings.updates;
  let destroySum = sumSamples(destroyValues);
  let createSummary = summarizeSamples(createValues);
  let firstSummary = summarizeSamples(firstValues);
  let updateSummary = summarizeSamples(updateValues);
  let frameStats = results[results.length - 1]?.frameStats || null;
  let runtime = WebGPURenderer.getSharedRuntimeStats?.() || WebGPURendererInternals.getSharedRuntimeStats?.() || {};

  totals.create += createSum;
  totals.first += firstSum;
  totals.update += updateSum;
  totals.done++;
  let engineKey = spec.engineKey || spec.engineLabel || 'other';
  let engineTotals = totals.byEngine || (totals.byEngine = {});
  let engineTotal = engineTotals[engineKey] || (engineTotals[engineKey] = {create: 0, first: 0, update: 0, count: 0});
  engineTotal.create += createSum;
  engineTotal.first += firstSum;
  engineTotal.update += updateSum;
  engineTotal.count++;

  let totalScore = (createSummary.median || 0) + (firstSummary.median || 0) + (updateTotals.length ? summarizeSamples(updateTotals).median || 0 : (updateSummary.median || 0) * settings.updates);
  if (!totals.slowest || totalScore > totals.slowest.score) {
    totals.slowest = {score: totalScore, title: spec.title};
    ui.metric('slowest').textContent = `${spec.title} / ${ms(totalScore)} ms`;
  }

  if (repeats > 1) {
    let notes = `repeats ${repeats}, ${frameStatsText(frameStats)}, isolated ${settings.isolate ? 'yes' : 'no'}, runtime refs ${runtime.refs ?? ''}`;
    setRow(row, {
      status: 'done',
      create: repeatText(createValues, repeats),
      first: repeatText(firstValues, repeats),
      update: repeatText(updateValues, repeats),
      destroy: repeatText(destroyValues, repeats),
      notes,
    });
  }

  return {createValues, firstValues, updateValues, destroyValues, frameStats, createSummary, firstSummary, updateSummary, medianScore: totalScore};
}

async function measureUiBaseline(ui) {
  let samples = [];
  for (let i = 0; i < 8; i++) {
    await settleForTiming();
    let t0 = now();
    let card = document.createElement('article');
    card.className = 'bench-card';
    card.innerHTML = '<h3><span>baseline</span><small>noop</small></h3><div class="bench-chart"></div>';
    ui.stage.appendChild(card);
    card.querySelector('.bench-chart').textContent = String(i);
    card.remove();
    samples.push(now() - t0);
  }
  let summary = summarizeSamples(samples);
  ui.metric('baseline').textContent = `${ms(summary.median)} med / ${ms(summary.p95)} p95`;
  return summary;
}

async function validateChartSurface(chart, spec) {
  let notes = [];
  let ctx = chart?.ctx;
  if (!ctx)
    return notes;

  if (typeof ctx.getImageDataAsync == 'function') {
    let img = await ctx.getImageDataAsync(0, 0, Math.min(8, ctx.frameWidth || 8), Math.min(8, ctx.frameHeight || 8));
    if (!img || img.width <= 0 || img.height <= 0 || !img.data)
      throw new Error('getImageDataAsync returned invalid data');
    notes.push(`readback ${img.width}x${img.height}`);
  }

  if (spec.id.includes('export') || spec.id.includes('svg') || spec.id.includes('png')) {
    if (typeof ctx.convertToBlob == 'function') {
      let blob = await ctx.convertToBlob({type: 'image/png'});
      if (!blob || blob.size <= 0)
        throw new Error('PNG export returned an empty blob');
      notes.push(`png ${Math.round(blob.size / 1024)}KB`);
    }
    if (typeof ctx.toSVGStringAsync == 'function') {
      let svg = await ctx.toSVGStringAsync();
      if (!String(svg).includes('<svg'))
        throw new Error('SVG export did not return SVG text');
      notes.push('svg ok');
    }
  }

  if (spec.id.includes('image-data') && typeof ctx.createImageData == 'function' && typeof ctx.putImageData == 'function') {
    let img = ctx.createImageData(4, 4);
    for (let i = 0; i < img.data.length; i += 4) {
      img.data[i + 0] = 255;
      img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 2, 2);
    await flushChart(chart);
    notes.push('imageData ok');
  }

  return notes;
}

function shouldValidateCase(spec) {
  if (spec.engineKey && spec.engineKey != 'webgpu')
    return false;
  return spec.id.includes('api:') || spec.id.includes('svg-image') || spec.id.includes('path-gap-clip') || spec.kind == 'bands' || spec.kind == 'plugin';
}

function runSmokeCoverage(ui) {
  let t0 = now();
  try {
    let ok = runWebGPURendererSmokeTests();
    let dt = now() - t0;
    ui.metric('smoke').textContent = ok ? `passed ${ms(dt)} ms` : `returned ${String(ok)}`;
    logLine(ui, `renderer smoke tests passed in ${ms(dt)} ms`);
    return {ok: !!ok, ms: dt};
  }
  catch (err) {
    let dt = now() - t0;
    ui.metric('smoke').textContent = `failed ${ms(dt)} ms`;
    logLine(ui, `renderer smoke tests failed: ${err?.message || err}`);
    return {ok: false, ms: dt, error: err};
  }
}

function collectSettings(ui) {
  return {
    compareDefault: ui.control('compareDefault').checked,
    largeAnimation: ui.control('largeAnimation').checked,
    rawGpuRing: ui.control('rawGpuRing').checked,
    rawGpuFullCompare: ui.control('rawGpuFullCompare').checked,
    rawDrawBaseline: ui.control('rawDrawBaseline').checked,
    legacyCases: ui.control('legacyCases')?.checked || false,
    shared: ui.control('shared').checked,
    warmup: ui.control('warmup').checked,
    isolate: ui.control('isolate').checked,
    keep: ui.control('keep').checked,
    deferVisible: ui.control('deferVisible').checked,
    reuse: ui.control('reuse').checked,
    validate: ui.control('validate').checked,
    heavy: ui.control('heavy').checked,
    updates: Math.max(0, Math.min(240, Number(ui.control('updates').value) || 0)),
    animationSeconds: Math.max(1, Math.min(30, Number(ui.control('animationSeconds').value) || 10)),
    rawPointScale: clampNumber(ui.control('rawPointScale').value, 0.25, 4, 1),
    rawChunkDivisor: Math.max(4, Math.min(512, Number(ui.control('rawChunkDivisor').value) || 64)),
    updateBudgetMs: clampNumber(ui.control('updateBudgetMs').value, 1, 100, 16.7),
    rawFpsBudget: clampNumber(ui.control('rawFpsBudget').value, 1, 240, 55),
    budgetProfile: ui.control('budgetProfile')?.value || 'interactive',
    regressionPct: clampNumber(ui.control('regressionPct').value, 1, 200, 12),
    budgetFlags: ui.control('budgetFlags').checked,
    repeats: Math.max(1, Math.min(7, Number(ui.control('repeats').value) || 1)),
    visibleBatch: Math.max(1, Math.min(128, Number(ui.control('visibleBatch').value) || 12)),
    delay: Math.max(0, Math.min(250, Number(ui.control('delay').value) || 0)),
  };
}

function makeCases(heavy, settings = {}) {
  let cases = makeVisualCases().map((spec, i) => ({
    ...spec,
    id: `coverage:${spec.id.slice('visual:'.length)}`,
    title: `coverage / ${spec.visualTitle || spec.cardTitle || spec.title}`,
    coverageIndex: i,
  }));
  if (settings.legacyCases) {
    for (let i = 0; i < DEMO_NAMES.length; i++)
      cases.push(specForName(DEMO_NAMES[i], 'old-demo-coverage', i, heavy));
    for (let i = 0; i < BENCH_NAMES.length; i++)
      cases.push(specForName(BENCH_NAMES[i], 'public-bench-coverage', i, heavy));
  }

  cases.push({id: 'perf:same-data-grid', title: 'perf / same data reused across charts', kind: 'reuse', points: heavy ? 4000 : 800, series: 3, variant: 'trend', fill: true});
  cases.push({id: 'perf:rolling-buffer', title: 'perf / in-place rolling buffer update', kind: 'rolling', points: heavy ? 10000 : 1200, series: 4, variant: 'trend', stream: true});
  cases.push({id: 'perf:shared-runtime-many-small', title: 'perf / many small charts shared runtime', kind: 'sparkline', points: 96, series: 1, variant: 'line', axesShow: false, legend: false});
  cases.push({id: 'api:readback-export-png-svg', title: 'api / readback plus PNG and SVG export', kind: 'line', points: 180, series: 2, variant: 'line', fill: true});
  cases.push({id: 'api:image-data-put-readback', title: 'api / ImageData put and readback', kind: 'line', points: 128, series: 1, variant: 'line', showPoints: true});
  cases.push({...facadePluginCase(), id: 'api:plugin-facade-composite-shadow', title: 'api / plugin facade composite shadow clip image pattern text', kind: 'plugin', points: 180, series: 2, variant: 'line', fill: true});
  if (settings.largeAnimation !== false)
    cases.push({id: 'perf:large-circular-animation', title: 'perf / 10s large circular buffer animation', kind: 'animation', points: heavy ? 1000000 : 250000, series: 3, variant: 'trend', stream: true, animation: true, axesShow: false, legend: false, width: 1});
  if (settings.rawGpuRing !== false) {
    let rawPoints = Math.round((heavy ? 1000000 : 500000) * (settings.rawPointScale || 1));
    cases.push({id: 'perf:raw-gpu-ring-upload-partial', title: 'perf / raw WebGPU circular buffer partial upload', kind: 'raw-animation', points: rawPoints, series: 1, variant: 'raw', rawMode: 'partial', axesShow: false, legend: false, width: 1});
    if (settings.rawGpuFullCompare !== false)
      cases.push({id: 'perf:raw-gpu-ring-upload-full', title: 'perf / raw WebGPU full-buffer upload comparator', kind: 'raw-animation', points: rawPoints, series: 1, variant: 'raw', rawMode: 'full', axesShow: false, legend: false, width: 1});
    if (settings.rawDrawBaseline !== false)
      cases.push({id: 'perf:raw-gpu-ring-draw-only', title: 'perf / raw WebGPU draw-only submit baseline', kind: 'raw-animation', points: rawPoints, series: 1, variant: 'raw', rawMode: 'draw-only', axesShow: false, legend: false, width: 1});
  }
  return cases;
}


async function warmRuntime(Chart, ui, settings) {
  if (!settings.warmup) {
    ui.metric('warmup').textContent = 'off';
    return 0;
  }

  let totalWarmMs = 0;
  let gpuWarm = null;
  if (typeof WebGPURenderer.prewarm == 'function') {
    gpuWarm = await WebGPURenderer.prewarm({sharedRuntime: settings.shared, width: 32, height: 32});
    totalWarmMs += Number(gpuWarm.ms || 0);
    if (gpuWarm.ok)
      logLine(ui, `WebGPU pipeline prewarm completed in ${ms(gpuWarm.ms)} ms`);
    else
      logLine(ui, `WebGPU pipeline prewarm failed: ${gpuWarm.error || 'unknown error'}`);
  }

  let spec = {id: 'warmup:runtime', title: 'warmup / runtime compile', kind: 'warmup', points: 64, series: 1, variant: 'line', legend: false, axesShow: false};
  let {card, mount} = makeCard(spec);
  ui.stage.appendChild(card);
  let data = makeData(spec);
  await settleForTiming();
  let t0 = now();
  let created = await createChart(Chart, spec, data, mount, {width: 320, height: 120});
  let chartWarmMs = now() - t0;
  totalWarmMs += chartWarmMs;
  created.chart.destroy();
  card.remove();
  ui.metric('warmup').textContent = gpuWarm?.ok === false ? `partial ${ms(totalWarmMs)} ms` : `${ms(totalWarmMs)} ms`;
  logLine(ui, `uPlot renderer warmup completed in ${ms(chartWarmMs)} ms`);
  await settleForTiming();
  return totalWarmMs;
}

function updateMetrics(ui, totals, totalCases) {
  ui.metric('cases').textContent = `${totals.done} / ${totalCases}`;
  ui.metric('create').textContent = `${ms(totals.create)} ms`;
  ui.metric('first').textContent = `${ms(totals.first)} ms`;
  ui.metric('update').textContent = `${ms(totals.update)} ms`;
  let webgpu = totals.byEngine?.webgpu;
  let canvas = totals.byEngine?.canvas2d || totals.byEngine?.['Canvas2D default'];
  let totalOf = v => v ? v.create + v.first + v.update : 0;
  ui.metric('webgpuTotal').textContent = `${ms(totalOf(webgpu))} ms${webgpu ? ` / ${webgpu.count} rows` : ''}`;
  ui.metric('canvas2dTotal').textContent = `${ms(totalOf(canvas))} ms${canvas ? ` / ${canvas.count} rows` : ''}`;
  if (totals.mode)
    ui.metric('mode').textContent = totals.mode;
  ui.metric('errors').textContent = String(totals.errors || 0);
  ui.metric('quality').textContent = totals.errors ? 'failed cases' : 'clean so far';
  let runtime = WebGPURenderer.getSharedRuntimeStats?.() || WebGPURendererInternals.getSharedRuntimeStats?.() || {};
  let adapter = runtime.adapterInfo?.description || runtime.adapterInfo?.device || runtime.adapterInfo?.architecture || '';
  ui.metric('runtime').textContent = runtime.active ? `shared ${runtime.refs} refs${adapter ? ' / ' + adapter : ''}` : runtime.enabled === false ? 'isolated' : 'pending';
  updateDiagnostics(ui, totals.settings || {});
}

export async function runBenchDemo(Chart = uPlot) {
  if (typeof document == 'undefined')
    return;

  let ui = createPage();
  ui.currentCharts = [];
  let pool = new DataPool();
  let longTasks = createLongTaskTracker(ui);
  let stop = false;
  let running = false;
  let baselineState = {name: '', map: new Map(), payload: null};
  let currentRun = null;
  let liveDashboardHistory = {webgpu: null, canvas2d: null};


  function destroyCurrentCharts() {
    if (!Array.isArray(ui.currentCharts))
      return;
    for (let chart of ui.currentCharts) {
      try { chart?._benchResizeObserver?.disconnect?.(); }
      catch (err) {}
      try { chart?._benchResizeRAF?.(); }
      catch (err) {}
      try { chart?._benchWorkerResumeCleanup?.(); }
      catch (err) {}
      try { chart?._benchWorkerStop?.(); }
      catch (err) {}
      try { chart?._benchWorker?.terminate?.(); }
      catch (err) {}
      try { chart?.destroy?.(); }
      catch (err) {}
    }
    ui.currentCharts = [];
  }

  async function runVisualGallery() {
    if (running)
      return;

    running = true;
    ui.action('run').disabled = true;
    ui.action('runWorkerFps').disabled = true;
    ui.action('runStylePerf').disabled = true;
    ui.action('runCapacitySweep').disabled = true;
    stop = false;
    destroyCurrentCharts();
    ui.page.dataset.mode = 'gallery';
    ui.results.textContent = '';
    ui.grid.textContent = '';
    ui.stage.textContent = '';
    ui.log.textContent = '';
    pool = new DataPool();

    let settings = collectSettings(ui);
    settings.reuse = true;
    settings.keep = true;
    settings.isolate = false;
    settings.deferVisible = false;
    settings.visibleFragment = document.createDocumentFragment();
    settings.visiblePending = 0;
    settings.compareScores = new Map();
    settings.baselineState = baselineState;

    currentRun = {
      id: makeRunId(),
      schemaVersion: BENCH_SCHEMA_VERSION,
      mode: 'visual-gallery',
      startedAt: new Date().toISOString(),
      settings: {...settings},
    };

    resetLongTaskTracker(ui, longTasks);
    runSmokeCoverage(ui);
    WebGPURenderer.setSharedRuntimeEnabled?.(settings.shared);
    await warmRuntime(Chart, ui, settings);

    let cases = makeVisualCases();
    let totalRows = cases.length * 2;
    let totals = {done: 0, errors: 0, create: 0, first: 0, update: 0, mode: 'visual side-by-side', slowest: null, settings};
    updateMetrics(ui, totals, totalRows);
    ui.metric('comparison').textContent = 'visual gallery';
    ui.metric('quality').textContent = 'rendering visual pairs';
    logLine(ui, `visual gallery ${currentRun.id}`);
    logLine(ui, `rendering ${cases.length} representative plot/style types as WebGPU / Canvas2D pairs`);
    logLine(ui, 'visual proof coverage includes old uPlot path/style examples: bars, stepped paths, spline paths, Catmull-Rom paths, points, gradients, bands, heatmaps, sparklines, candles, box/whisker, cursor values, and plugin draw hooks');

    let frag = document.createDocumentFragment();
    let pairs = cases.map(spec => {
      let pair = makePairRow(spec);
      frag.appendChild(pair.row);
      return {spec, pair};
    });
    ui.grid.appendChild(frag);
    await settleForTiming();

    let rowIndex = 0;
    for (let {spec, pair} of pairs) {
      if (stop)
        break;

      let gpuSpec = {...spec, engineKey: 'webgpu', engineLabel: 'WebGPU'};
      let canvasSpec = {...spec, engineKey: 'canvas2d', engineLabel: 'Canvas2D'};
      let gpuRow = makeResultRow(rowIndex++, gpuSpec, 'WebGPU');
      let canvasRow = makeResultRow(rowIndex++, canvasSpec, 'Canvas2D');
      ui.results.append(gpuRow, canvasRow);

      try {
        setRow(gpuRow, {status: 'running', notes: 'rendering WebGPU'});
        let gpuCreated = await renderVisualChart(Chart, gpuSpec, pair.webgpu, pool, settings);
        ui.currentCharts.push(gpuCreated.chart);
        let gpuStats = gpuCreated.chart.ctx?.getLastFrameStats?.() || null;
        totals.create += gpuCreated.createMs;
        totals.first += gpuCreated.firstMs;
        totals.done++;
        setRow(gpuRow, {
          status: 'done',
          create: ms(gpuCreated.createMs),
          first: ms(gpuCreated.firstMs),
          update: '',
          destroy: '',
          notes: frameStatsText(gpuStats),
        });
        attachRowResult(gpuRow, {createMs: gpuCreated.createMs, firstMs: gpuCreated.firstMs, medianScore: gpuCreated.firstMs, frameStats: gpuStats, spec: {id: gpuSpec.id, title: gpuSpec.title, kind: gpuSpec.kind, engineKey: gpuSpec.engineKey, engineLabel: gpuSpec.engineLabel}});
        ui.metric('frameStats').textContent = frameStatsText(gpuStats);
      }
      catch (err) {
        totals.done++;
        totals.errors++;
        setRow(gpuRow, {status: 'error', notes: err?.stack || err?.message || String(err)});
        attachRowResult(gpuRow, {error: true, message: String(err?.message || err), spec: {id: gpuSpec.id, title: gpuSpec.title, kind: gpuSpec.kind, engineKey: gpuSpec.engineKey, engineLabel: gpuSpec.engineLabel}});
      }

      try {
        setRow(canvasRow, {status: 'running', notes: 'rendering Canvas2D'});
        let canvasCreated = await renderVisualChart(defaultUPlot, canvasSpec, pair.canvas, pool, settings);
        ui.currentCharts.push(canvasCreated.chart);
        totals.create += canvasCreated.createMs;
        totals.first += canvasCreated.firstMs;
        totals.done++;
        setRow(canvasRow, {
          status: 'done',
          create: ms(canvasCreated.createMs),
          first: ms(canvasCreated.firstMs),
          update: '',
          destroy: '',
          notes: 'Canvas2D reference from ./old',
        });
        attachRowResult(canvasRow, {createMs: canvasCreated.createMs, firstMs: canvasCreated.firstMs, medianScore: canvasCreated.firstMs, spec: {id: canvasSpec.id, title: canvasSpec.title, kind: canvasSpec.kind, engineKey: canvasSpec.engineKey, engineLabel: canvasSpec.engineLabel}});
      }
      catch (err) {
        totals.done++;
        totals.errors++;
        setRow(canvasRow, {status: 'error', notes: err?.stack || err?.message || String(err)});
        attachRowResult(canvasRow, {error: true, message: String(err?.message || err), spec: {id: canvasSpec.id, title: canvasSpec.title, kind: canvasSpec.kind, engineKey: canvasSpec.engineKey, engineLabel: canvasSpec.engineLabel}});
      }

      updateMetrics(ui, totals, totalRows);
      await idle(30);
    }

    currentRun.completedAt = new Date().toISOString();
    currentRun.stopped = !!stop;
    currentRun.errors = totals.errors || 0;
    currentRun.rows = rowResults(ui).length;
    ui.metric('quality').textContent = totals.errors ? `${totals.errors} visual failures` : 'visual gallery complete';
    logLine(ui, stop ? 'visual gallery stopped' : `visual gallery complete with ${totals.errors || 0} errors`);
    running = false;
    ui.action('run').disabled = false;
    ui.action('runWorkerFps').disabled = false;
    ui.action('runStylePerf').disabled = false;
    ui.action('runCapacitySweep').disabled = false;
  }

  async function runWorkerFpsBench() {
    if (running)
      return;

    running = true;
    ui.action('run').disabled = true;
    ui.action('runWorkerFps').disabled = true;
    ui.action('runStylePerf').disabled = true;
    ui.action('runCapacitySweep').disabled = true;
    stop = false;
    destroyCurrentCharts();
    ui.page.dataset.mode = 'gallery';
    ui.results.textContent = '';
    ui.grid.textContent = '';
    ui.stage.textContent = '';
    ui.log.textContent = '';
    pool = new DataPool();

    let settings = collectSettings(ui);
    let durationMs = Math.max(1000, Math.min(30000, Number(settings.animationSeconds || 10) * 1000));
    let points = 500000;
    let step = 8192;
    let spec = {
      id: 'worker:live-circular',
      title: 'worker fps / live 500k circular buffer',
      visualTitle: 'Worker FPS: 500k circular buffer',
      cardTitle: 'Worker FPS: 500k circular buffer',
      kind: 'line',
      points,
      series: 1,
      variant: 'line',
      chartTitle: false,
      legend: true,
      visualHeight: 420,
      width: 1,
      dragZoom: true,
      seriesStyles: [{label: '500k rotating amplitude signal', stroke: '#276ef1', width: 1.1}],
    };

    currentRun = {
      id: makeRunId(),
      schemaVersion: BENCH_SCHEMA_VERSION,
      mode: 'worker-fps',
      startedAt: new Date().toISOString(),
      settings: {...settings, points, durationMs, step},
    };

    resetLongTaskTracker(ui, longTasks);
    WebGPURenderer.setSharedRuntimeEnabled?.(settings.shared);
    await warmRuntime(Chart, ui, settings);
    ui.metric('mode').textContent = 'worker fps';
    ui.metric('comparison').textContent = 'worker-driven WebGPU vs Canvas2D';
    ui.metric('cases').textContent = '0 / 2';
    ui.metric('quality').textContent = 'running worker fps test';
    logLine(ui, `worker fps run ${currentRun.id}`);
    logLine(ui, `each chart is rendered inside its own worker with OffscreenCanvas, one lane at a time, ${points.toLocaleString()} visible samples, step ${step.toLocaleString()}, ${durationMs / 1000}s`);
    logLine(ui, 'WebGPU worker renders in an OffscreenCanvas worker with a storage-buffer vertex shader, so the source signal uploads once and each frame only updates uniforms; Canvas2D worker uses OffscreenCanvas 2D directly');
    logLine(ui, 'worker FPS now separates worker-loop throughput from visible FPS; the Canvas2D lane presents ImageBitmaps on the main requestAnimationFrame loop so its visible FPS is not just worker submit throughput');
    logLine(ui, 'drag across either live chart to zoom; double-click the dedicated drag zoom gallery card to reset');

    let pair = makePairRow(spec);
    ui.grid.appendChild(pair.row);
    await settleForTiming();

    let gpuRow = makeResultRow(0, {...spec, engineKey: 'webgpu', engineLabel: 'WebGPU'}, 'WebGPU');
    let canvasRow = makeResultRow(1, {...spec, engineKey: 'canvas2d', engineLabel: 'Canvas2D'}, 'Canvas2D');
    ui.results.append(gpuRow, canvasRow);

    let totals = {done: 0, errors: 0, create: 0, first: 0, update: 0, mode: 'worker fps', settings};
    updateMetrics(ui, totals, 2);

    async function runLane({lane, row, slot, engineKey, engineLabel}) {
      if (stop)
        return;
      let started;
      try {
        setRow(row, {status: 'running', notes: `worker-rendered ${engineLabel} live scroll, isolated lane`});
        started = await startOffscreenRendererWorkerChart({
          spec: {...spec, engineKey, engineLabel},
          slot,
          engineKey,
          engineLabel,
          points,
          durationMs,
          step,
          stopRef: () => stop,
        });
        ui.currentCharts.push(started.chart);
      }
      catch (err) {
        totals.done++;
        totals.errors++;
        setRow(row, {status: 'error', notes: err?.stack || err?.message || String(err)});
        updateMetrics(ui, totals, 2);
        return;
      }

      let finish = {lane, row, result: await started.promise};
      let st = finish.result.stats;
      let elapsed = Math.max(1, Number(st.renderElapsedMs) || ((st.completedAt || performance.now()) - st.startedAt));
      let fps = Number.isFinite(Number(st.fps)) ? Number(st.fps) : st.frames * 1000 / elapsed;
      let avgUpdate = st.frames ? st.updateMs / st.frames : 0;
      totals.done++;
      totals.create += st.createMs || 0;
      totals.first += st.firstMs || 0;
      totals.update += avgUpdate;
      setRow(finish.row, {
        status: st.error ? 'error' : 'done',
        create: ms(st.createMs || 0),
        first: ms(st.firstMs || 0),
        update: ms(avgUpdate),
        destroy: '',
        notes: st.error || `${fps.toFixed(1)} display-paced fps, submit avg ${avgUpdate.toFixed(2)}ms, max ${Number(st.maxUpdateMs || 0).toFixed(2)}ms`,
      });
      if (st.error)
        totals.errors++;
      attachRowResult(finish.row, {
        createMs: st.createMs || 0,
        firstMs: st.firstMs || 0,
        updateMs: avgUpdate,
        medianScore: avgUpdate,
        animation: {mode: 'worker-circular-renderer-isolated', fps, frames: st.frames, points, step, maxUpdateMs: st.maxUpdateMs, renderElapsedMs: elapsed},
        spec: {id: spec.id, title: spec.title, kind: spec.kind, engineKey: finish.lane},
      });
      updateMetrics(ui, totals, 2);
    }

    setRow(canvasRow, {status: 'waiting', notes: 'runs after WebGPU so lanes do not steal CPU/GPU time from each other'});
    await runLane({lane: 'webgpu', row: gpuRow, slot: pair.webgpu, engineKey: 'webgpu', engineLabel: 'WebGPU'});
    await runLane({lane: 'canvas2d', row: canvasRow, slot: pair.canvas, engineKey: 'canvas2d', engineLabel: 'Canvas2D'});

    currentRun.completedAt = new Date().toISOString();
    currentRun.stopped = !!stop;
    currentRun.errors = totals.errors || 0;
    currentRun.rows = rowResults(ui).length;
    ui.metric('cases').textContent = `${totals.done} / 2`;
    ui.metric('quality').textContent = totals.errors ? `${totals.errors} worker fps failures` : (stop ? 'worker fps stopped' : 'worker fps complete');
    logLine(ui, stop ? 'worker fps test stopped' : `worker fps test complete with ${totals.errors || 0} errors`);

    running = false;
    ui.action('run').disabled = false;
    ui.action('runWorkerFps').disabled = false;
    ui.action('runStylePerf').disabled = false;
    ui.action('runCapacitySweep').disabled = false;
  }


  function makeWorkerStylePerfCases() {
    return [
      {id: 'worker-style:line-500k', title: 'worker style / 500k line scroll', visualTitle: 'Style perf: 500k line', cardTitle: '500k line', kind: 'worker-style-line', points: 500000, series: 1, styleMode: 'line', bufferCount: 1, step: 8192, visualHeight: 360, legend: true},
      {id: 'worker-style:area-gradient-500k', title: 'worker style / 500k gradient area scroll', visualTitle: 'Style perf: 500k gradient area', cardTitle: '500k gradient area', kind: 'worker-style-area', points: 500000, series: 1, styleMode: 'area-gradient', bufferCount: 1, step: 8192, visualHeight: 360, legend: true},
      {id: 'worker-style:band-300k', title: 'worker style / 300k high-low band scroll', visualTitle: 'Style perf: 300k high-low band', cardTitle: '300k band', kind: 'worker-style-band', points: 300000, series: 1, styleMode: 'bands', bufferCount: 1, step: 6144, visualHeight: 360, legend: true},
      {id: 'worker-style:bars-120k', title: 'worker style / 120k animated bars', visualTitle: 'Style perf: 120k bars', cardTitle: '120k bars', kind: 'worker-style-bars', points: 120000, series: 1, styleMode: 'bars', bufferCount: 1, step: 2048, visualHeight: 360, legend: true},
      {id: 'worker-style:heatmap-1024x1024', title: 'worker style / animated heatmap shader', visualTitle: 'Style perf: 1024x1024 heatmap', cardTitle: '1024x1024 heatmap', kind: 'worker-style-heatmap', points: 1048576, series: 1, styleMode: 'heatmap', bufferCount: 1, step: 7680, heatmapCols: 1024, heatmapRows: 1024, visualHeight: 420, legend: true},
      {id: 'worker-style:multi-buffer-4x250k', title: 'worker style / 4 buffers x 250k lines', visualTitle: 'Style perf: 4 x 250k buffers', cardTitle: '4 x 250k buffers', kind: 'worker-style-multi', points: 250000, series: 4, styleMode: 'multi-line', bufferCount: 4, step: 6144, visualHeight: 380, legend: true},
    ];
  }

  function makeCapacitySweepCases(settings) {
    let heavy = !!settings.heavy;
    let single = heavy ? [500000, 1000000, 2000000, 4000000] : [250000, 500000, 1000000, 2000000];
    let multi = heavy ? [2, 4, 8] : [2, 4];
    let cases = [];
    for (let points of single) {
      cases.push({
        id: `capacity:webgpu-line-${points}`,
        title: `capacity / WebGPU ${points.toLocaleString()} point line`,
        visualTitle: `Capacity: ${points.toLocaleString()} line`,
        cardTitle: `${points.toLocaleString()} line`,
        kind: 'capacity-line',
        points,
        series: 1,
        styleMode: 'line',
        bufferCount: 1,
        step: Math.max(4096, Math.round(points / 80)),
        visualHeight: 340,
        legend: true,
      });
    }
    for (let buffers of multi) {
      let points = heavy ? 1000000 : 500000;
      cases.push({
        id: `capacity:webgpu-${buffers}buffers-${points}`,
        title: `capacity / WebGPU ${buffers} buffers x ${points.toLocaleString()}`,
        visualTitle: `Capacity: ${buffers} x ${points.toLocaleString()} buffers`,
        cardTitle: `${buffers} x ${points.toLocaleString()}`,
        kind: 'capacity-multi-buffer',
        points,
        series: buffers,
        styleMode: 'multi-line',
        bufferCount: buffers,
        step: Math.max(4096, Math.round(points / 100)),
        visualHeight: 360,
        legend: true,
      });
    }
    return cases;
  }

  function makeLiveDashboardCases(settings = {}) {
    let heavy = !!settings.heavy;
    let heatSide = heavy ? 1024 : 768;
    return [
      {id: 'live-demo:line-500k', title: 'live demo / 500k scrolling line', visualTitle: 'Live dashboard / 500K scrolling line', cardTitle: '500K scrolling line', kind: 'live-line', points: 500000, series: 1, styleMode: 'line', bufferCount: 1, step: 8192, visualHeight: 170, legend: true},
      {id: 'live-demo:area-500k', title: 'live demo / 500k gradient area', visualTitle: 'Live dashboard / 500K gradient area', cardTitle: '500K gradient area', kind: 'live-area', points: 500000, series: 1, styleMode: 'area-gradient', bufferCount: 1, step: 8192, visualHeight: 170, legend: true},
      {id: 'live-demo:band-350k', title: 'live demo / 350k high-low band', visualTitle: 'Live dashboard / 350K high-low ribbon', cardTitle: '350K high-low ribbon', kind: 'live-band', points: 350000, series: 1, styleMode: 'bands', bufferCount: 1, step: 6144, visualHeight: 170, legend: true},
      {id: 'live-demo:bars-160k', title: 'live demo / 160k animated bars', visualTitle: 'Live dashboard / 160K bars', cardTitle: '160K animated bars', kind: 'live-bars', points: 160000, series: 1, styleMode: 'bars', bufferCount: 1, step: 3072, visualHeight: 170, legend: true},
      {id: 'live-demo:heatmap', title: 'live demo / animated heatmap', visualTitle: `Live dashboard / ${heatSide}x${heatSide} heatmap`, cardTitle: `${heatSide}x${heatSide} heatmap`, kind: 'live-heatmap', points: heatSide * heatSide, series: 1, styleMode: 'heatmap', bufferCount: 1, step: 7680, heatmapCols: heatSide, heatmapRows: heatSide, visualHeight: 170, legend: true},
      {id: 'live-demo:multi-4x250k', title: 'live demo / 4 x 250k lines', visualTitle: 'Live dashboard / 4 x 250K lines', cardTitle: '4 x 250K multi-buffer lines', kind: 'live-multi-line', points: 250000, series: 4, styleMode: 'multi-line', bufferCount: 4, step: 6144, visualHeight: 170, legend: true},
      {id: 'live-demo:thin-line-750k', title: 'live demo / 750k long signal', visualTitle: 'Live dashboard / 750K long signal', cardTitle: '750K long signal', kind: 'live-line', points: heavy ? 1000000 : 750000, series: 1, styleMode: 'line', bufferCount: 1, step: 12288, visualHeight: 170, legend: true},
      {id: 'live-demo:multi-8x125k', title: 'live demo / 8 x 125k dense buffers', visualTitle: 'Live dashboard / 8 dense buffers', cardTitle: '8 x 125K dense buffers', kind: 'live-multi-line', points: 125000, series: 8, styleMode: 'multi-line', bufferCount: 8, step: 4096, visualHeight: 170, legend: true},
    ];
  }

  function liveDashboardSummaryText(engineKey, statsList, durationMs) {
    let usable = statsList.filter(Boolean);
    let frames = sumSamples(usable.map(s => Number(s.frames || 0)));
    let submit = sumSamples(usable.map(s => Number(s.updateMs || 0)));
    let maxFrame = Math.max(0, ...usable.map(s => Number(s.maxUpdateMs || 0)).filter(Number.isFinite));
    let visibleFps = usable
      .map(s => Number(s.displayFps || s.fps || 0))
      .filter(v => Number.isFinite(v) && v > 0);
    let avgFps = visibleFps.length ? visibleFps.reduce((a, b) => a + b, 0) / visibleFps.length : 0;
    let totalPoints = sumSamples(usable.map(s => Number(s.points || 0) * Number(s.bufferCount || 1)));
    return {
      engineKey,
      cases: usable.length,
      frames,
      submit,
      maxFrame,
      avgFps,
      totalPoints,
      durationMs,
      text: `${engineKey == 'webgpu' ? 'WebGPU' : 'Canvas2D'} live demo: ${usable.length} animated charts, ${Number(totalPoints).toLocaleString()} samples across active buffers, avg visible fps ${avgFps.toFixed(1)}, cumulative submit ${submit.toFixed(1)} ms, max frame ${maxFrame.toFixed(1)} ms`,
    };
  }

  function updateLiveDashboardComparison(ui) {
    let gpu = liveDashboardHistory.webgpu;
    let canvas = liveDashboardHistory.canvas2d;
    if (!gpu && !canvas) {
      ui.metric('comparison').textContent = 'run WebGPU or Canvas2D live demo';
      return;
    }
    if (gpu && canvas && gpu.submit > 0 && canvas.submit > 0) {
      let ratio = canvas.submit / gpu.submit;
      let fpsRatio = gpu.avgFps && canvas.avgFps ? gpu.avgFps / canvas.avgFps : 0;
      ui.metric('comparison').textContent = `live demo Canvas/WebGPU submit ${ratio.toFixed(2)}x, FPS ${fpsRatio.toFixed(2)}x`;
      return;
    }
    ui.metric('comparison').textContent = gpu ? 'WebGPU live demo saved, run Canvas2D next' : 'Canvas2D live demo saved, run WebGPU next';
  }

  async function runLiveDashboard(engineKey) {
    if (running)
      return;

    running = true;
    ui.action('run').disabled = true;
    ui.action('runWorkerFps').disabled = true;
    ui.action('runStylePerf').disabled = true;
    ui.action('runCapacitySweep').disabled = true;
    ui.actions('runLiveDashboardWebGPU').forEach(button => button.disabled = true);
    ui.actions('runLiveDashboardCanvas2D').forEach(button => button.disabled = true);
    stop = false;
    destroyCurrentCharts();
    ui.page.dataset.mode = 'live-demo';
    ui.results.textContent = '';
    ui.grid.textContent = '';
    ui.stage.textContent = '';
    ui.log.textContent = '';
    pool = new DataPool();

    let settings = collectSettings(ui);
    WebGPURenderer.setSharedRuntimeEnabled?.(settings.shared);
    if (engineKey == 'webgpu')
      await warmRuntime(Chart, ui, settings);
    else
      ui.metric('warmup').textContent = 'Canvas2D dashboard';
    let durationMs = Math.max(3000, Math.min(60000, Number(settings.animationSeconds || 10) * 1000));
    let cases = makeLiveDashboardCases(settings);
    let engineLabel = engineKey == 'webgpu' ? 'WebGPU' : 'Canvas2D';
    let totalRows = cases.length;
    let totals = {done: 0, errors: 0, create: 0, first: 0, update: 0, byEngine: {}, mode: `live dashboard ${engineLabel}`, settings};

    currentRun = {
      id: makeRunId(),
      schemaVersion: BENCH_SCHEMA_VERSION,
      startedAt: new Date().toISOString(),
      settings: {...settings, mode: 'live-dashboard', engineKey, durationMs, cases: cases.map(c => ({id: c.id, points: c.points, styleMode: c.styleMode, bufferCount: c.bufferCount}))},
    };

    resetLongTaskTracker(ui, longTasks);
    updateMetrics(ui, totals, totalRows);
    ui.metric('mode').textContent = `live dashboard ${engineLabel}`;
    ui.metric('quality').textContent = 'running';
    logLine(ui, `live dashboard ${engineLabel}: ${cases.length} simultaneous worker animations for ${(durationMs / 1000).toFixed(1)}s`);
    logLine(ui, 'reload the same dashboard with the other backend to compare cumulative submit time and visible FPS');

    let note = document.createElement('div');
    note.className = 'bench-live-demo-note';
    note.textContent = `${engineLabel} backend active. This dashboard intentionally stacks many moving styles at once: 500K+ lines, gradient area, high/low ribbon, bars, heatmap, and multi-buffer lines. Use the Canvas2D/WebGPU live demo buttons to reload the same workload with the other backend.`;
    ui.grid.appendChild(note);

    let promises = [];
    let rowIndex = 0;
    for (let spec of cases) {
      let cardSpec = {...spec, engineKey, engineLabel};
      let slot = makeCard(cardSpec);
      ui.grid.appendChild(slot.card);
      let row = makeResultRow(rowIndex++, cardSpec, engineLabel);
      ui.results.appendChild(row);
      setRow(row, {status: 'running', notes: `${engineLabel} live worker ${spec.styleMode}`});
      try {
        let handle = startOffscreenRendererWorkerChart({
          spec: cardSpec,
          slot,
          engineKey,
          engineLabel,
          points: spec.points,
          durationMs,
          step: spec.step || 8192,
          stopRef: () => stop,
        });
        ui.currentCharts.push(handle.chart);
        promises.push(handle.promise.then(({stats}) => {
          totals.done++;
          totals.update += Number(stats.updateMs || 0);
          totals.byEngine[engineKey] ||= {create: 0, first: 0, update: 0, count: 0};
          totals.byEngine[engineKey].update += Number(stats.updateMs || 0);
          totals.byEngine[engineKey].count++;
          setRow(row, {
            status: stats.error ? 'error' : 'done',
            create: ms(stats.createMs || stats.initMs || 0),
            first: ms(stats.firstMs || 0),
            update: `${ms(stats.updateMs || 0)} total`,
            notes: stats.error || `fps ${Number(stats.displayFps || stats.fps || 0).toFixed(1)}, frames ${Number(stats.displayFrames || stats.frames || 0).toLocaleString()}`,
          });
          attachRowResult(row, {stats, spec: {id: spec.id, title: spec.title, kind: spec.kind, engineKey, engineLabel, styleMode: spec.styleMode, bufferCount: spec.bufferCount}});
          updateMetrics(ui, totals, totalRows);
          return stats;
        }).catch(err => {
          totals.done++;
          totals.errors++;
          setRow(row, {status: 'error', notes: err?.stack || err?.message || String(err)});
          updateMetrics(ui, totals, totalRows);
          return {error: err?.message || String(err), points: spec.points, bufferCount: spec.bufferCount};
        }));
      }
      catch (err) {
        totals.done++;
        totals.errors++;
        setRow(row, {status: 'error', notes: err?.stack || err?.message || String(err)});
      }
    }

    let settled = await Promise.all(promises);
    let summary = liveDashboardSummaryText(engineKey, settled, durationMs);
    liveDashboardHistory[engineKey] = summary;
    currentRun.completedAt = new Date().toISOString();
    currentRun.stopped = !!stop;
    currentRun.errors = totals.errors || 0;
    currentRun.rows = rowResults(ui).length;
    ui.metric('quality').textContent = totals.errors ? `${totals.errors} live demo failures` : (stop ? 'live demo stopped' : 'live demo complete');
    ui.metric('update').textContent = `${ms(summary.submit)} ms`;
    ui.metric(engineKey == 'webgpu' ? 'webgpuTotal' : 'canvas2dTotal').textContent = `${ms(summary.submit)} ms`;
    updateLiveDashboardComparison(ui);
    logLine(ui, summary.text);
    if (stop)
      logLine(ui, 'live dashboard stopped');

    running = false;
    ui.action('run').disabled = false;
    ui.action('runWorkerFps').disabled = false;
    ui.action('runStylePerf').disabled = false;
    ui.action('runCapacitySweep').disabled = false;
    ui.actions('runLiveDashboardWebGPU').forEach(button => button.disabled = false);
    ui.actions('runLiveDashboardCanvas2D').forEach(button => button.disabled = false);
  }

  async function runStylePerfSuite() {
    if (running)
      return;
    let settings = collectSettings(ui);
    let cases = makeWorkerStylePerfCases();
    await runWorkerPerfCaseSequence({
      mode: 'worker-style-animation-suite',
      cases,
      durationMs: Math.max(1000, Math.min(30000, Number(settings.animationSeconds || 10) * 1000)),
      compareCanvas: true,
      webgpuOnlyLog: 'Style animation suite: line, gradient area, high/low band, bars, heatmap, and multi-buffer lines are rendered as live scrolling worker animations for visual proof and perf comparison.',
    });
  }

  async function runCapacitySweep() {
    if (running)
      return;
    let settings = collectSettings(ui);
    let cases = makeCapacitySweepCases(settings);
    await runWorkerPerfCaseSequence({
      mode: 'webgpu-capacity-sweep',
      cases,
      durationMs: Math.max(1000, Math.min(12000, Number(settings.animationSeconds || 6) * 1000)),
      compareCanvas: false,
      webgpuOnlyLog: 'Capacity sweep: increasing WebGPU worker-side point counts and multiple storage-buffer-sized series rendered on one chart. Heavy mode extends the sweep toward larger buffer budgets.',
    });
  }

  function bindAction(name, handler) {
    ui.actions(name).forEach(button => button.addEventListener('click', handler));
  }

  bindAction('run', runVisualGallery);
  bindAction('runWorkerFps', runWorkerFpsBench);
  bindAction('runStylePerf', runStylePerfSuite);
  bindAction('runCapacitySweep', runCapacitySweep);
  bindAction('runLiveDashboardWebGPU', () => runLiveDashboard('webgpu'));
  bindAction('runLiveDashboardCanvas2D', () => runLiveDashboard('canvas2d'));
  bindAction('stop', () => { stop = true; });
  bindAction('clear', () => { destroyCurrentCharts(); ui.grid.textContent = ''; ui.stage.textContent = ''; });
  bindAction('exportCsv', () => exportCsv(ui, currentRun));
  bindAction('exportJson', () => exportJson(ui, baselineState, currentRun));
  bindAction('exportMarkdown', () => exportMarkdownSummary(ui, baselineState, currentRun));
  bindAction('loadBaseline', () => ui.control('baselineFile').click());
  bindAction('clearBaseline', () => {
    baselineState = {name: '', map: new Map(), payload: null};
    for (let row of ui.results.querySelectorAll('tr')) {
      delete row.dataset.regression;
      let baselineCell = row.querySelector('[data-cell="baseline"]');
      if (baselineCell)
        baselineCell.textContent = '';
      try {
        let result = row.dataset.result ? JSON.parse(row.dataset.result) : null;
        if (result?.baselineComparison) {
          delete result.baselineComparison;
          attachRowResult(row, result);
        }
      }
      catch (err) {}
    }
    ui.metric('baselineDiff').textContent = 'none loaded';
    logLine(ui, 'baseline cleared');
  });
  ui.control('baselineFile').addEventListener('change', async event => {
    let file = event.target.files?.[0];
    event.target.value = '';
    if (!file)
      return;
    try {
      let text = await file.text();
      let payload = JSON.parse(text);
      let map = buildBaselineMap(payload);
      baselineState = {name: file.name, map, payload};
      ui.metric('baselineDiff').textContent = `${map.size} rows loaded`;
      let settings = collectSettings(ui);
      let matched = refreshBaselineComparisons(ui, baselineState, settings);
      logLine(ui, `loaded baseline ${file.name} with ${map.size} comparable rows, matched ${matched} current rows`);
      updateComparisonMetrics(ui);
    }
    catch (err) {
      ui.metric('baselineDiff').textContent = 'load failed';
      logLine(ui, `baseline load failed: ${err?.message || err}`);
    }
  });


  ui.control('budgetProfile')?.addEventListener('change', () => {
    let profile = ui.control('budgetProfile').value;
    if (profile == 'strict') {
      ui.control('updateBudgetMs').value = '10.8';
      ui.control('rawFpsBudget').value = '58';
      ui.control('regressionPct').value = '8';
    }
    else if (profile == 'regression') {
      ui.control('updateBudgetMs').value = '16.7';
      ui.control('rawFpsBudget').value = '50';
      ui.control('regressionPct').value = '12';
    }
    else if (profile == 'stress') {
      ui.control('updateBudgetMs').value = '33.3';
      ui.control('rawFpsBudget').value = '30';
      ui.control('regressionPct').value = '20';
    }
    else {
      ui.control('updateBudgetMs').value = '16.7';
      ui.control('rawFpsBudget').value = '55';
      ui.control('regressionPct').value = '12';
    }
    updateDiagnostics(ui, collectSettings(ui));
  });

  if (!navigator.gpu)
    logLine(ui, 'WebGPU was not detected. The harness can compile, but charts require a WebGPU-capable browser.');
  else
    logLine(ui, 'ready');
  logLine(ui, 'perf warnings are optional threshold hints only; they are off by default and are not correctness failures.');

  await nextFrame();
  runVisualGallery();
}

export default runBenchDemo;

if (typeof document != 'undefined')
  queueMicrotask(() => runBenchDemo());

