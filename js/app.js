// Wiring layer: reads inputs, runs the engine on every keystroke, paints the
// UI, handles IndexedDB persistence, sliders and export.

import { compute, health } from './calc.js';
import { tiers, profitCurve, probeScenario, scenarioMaxSpend, solveSpend,
  marginalRoasAt, saturationSpend } from './scenarios.js';
import * as fmt from './format.js';
import * as db from './storage.js';

const $ = id => document.getElementById(id);
const PRODUCT_IDS = ['price', 'cogs', 'shipping', 'processing', 'refund', 'otherFees', 'targetProfit', 'ordersPerYear', 'retentionM'];
const AD_IDS = ['spend', 'cpm', 'ctr', 'cpc', 'cvr', 'aov', 'upsell',
  'newPct', 'newVisPct', 'attrCapture', 'otherSpend', 'otherRevenue', 'tierMax',
  'alertProfitMin', 'alertRoasMin', 'alertCpoMax'];

let mode = 'cpm';
let sliderOverride = null; // {ctr,cvr,cpm} when sliders are touched
let channels = [];         // [{name,spend,roas}] — multi-channel mix
let skuMix = { on: false, weights: {} }; // multi-SKU blended product
let skuBlend = null;       // weighted product fields when blend is active
let activeTab = 'all';     // persisted Live-results filter
const zeroBtns = [];       // [{inp,b}] — quiet per-field "zero" affordances
let curveDrawn = false;    // draw-in animation runs once per page load
let curveBound = false;    // chart hover listeners attached once
let curveCtx = null;       // last chart geometry for the hover read-out

function syncZeroBtns() {
  for (const { inp, b } of zeroBtns) {
    const v = inp.value.trim();
    b.hidden = v === '' || parseFloat(v) === 0;
  }
}

function applyTab(sel) {
  activeTab = sel || 'all';
  document.querySelectorAll('#resultTabs .tab').forEach(b =>
    b.classList.toggle('on', b.dataset.tab === activeTab));
  document.querySelectorAll('#outputCard .msection').forEach(s => {
    s.hidden = !(activeTab === 'all' || s.dataset.section === activeTab);
  });
}

// The typed values only — never the slider override. This is what gets
// persisted as the draft so a refresh restores the real inputs, not whatever
// the sensitivity sliders were dragged to.
function readBase() {
  const n = id => parseFloat($(id).value) || 0;
  return {
    price: n('price'), cogs: n('cogs'), shipping: n('shipping'),
    processing: n('processing'), refund: n('refund'), otherFees: n('otherFees'),
    spend: n('spend'), mode,
    cpm: n('cpm'), ctr: n('ctr'), cpc: n('cpc'), cvr: n('cvr'),
    aov: parseFloat($('aov').value) || 0, upsell: n('upsell'),
    targetProfit: n('targetProfit'), ordersPerYear: n('ordersPerYear'),
    retentionM: n('retentionM'), tierMax: n('tierMax'),
      alertProfitMin: $('alertProfitMin').value, alertRoasMin: $('alertRoasMin').value,
    alertCpoMax: $('alertCpoMax').value,
    newPct: n('newPct'), newVisPct: n('newVisPct'), attrCapture: n('attrCapture'),
    otherSpend: n('otherSpend'), otherRevenue: n('otherRevenue'),
  };
}

function readInputs() {
  const base = readBase();
  if (skuBlend) Object.assign(base, skuBlend);          // weighted product mix
  if (channels.length) {                                // channel mix → MER
    base.otherSpend = channels.reduce((s, c) => s + (+c.spend || 0), 0);
    base.otherRevenue = channels.reduce((s, c) => s + (+c.spend || 0) * (+c.roas || 0), 0);
  }
  if (sliderOverride) Object.assign(base, sliderOverride);
  return base;
}

function paintMetric(elId, value, state) {
  const el = $(elId);
  el.textContent = value;
  const cell = el.closest('.metric');
  if (!cell) return;
  cell.classList.remove('is-green', 'is-amber', 'is-red');
  if (state) cell.classList.add('is-' + state);
}

// Hero cards: render the currency symbol at a smaller, baseline-dropped size
// so the figure itself reads as the display element.
function paintHero(elId, str, state) {
  const el = $(elId);
  const sym = fmt.getCurrency();
  const i = str.indexOf(sym);
  el.innerHTML = i >= 0
    ? `${str.slice(0, i)}<span class="msym">${sym}</span>${str.slice(i + sym.length)}`
    : str;
  const cell = el.closest('.metric');
  if (!cell) return;
  cell.classList.remove('is-green', 'is-amber', 'is-red');
  if (state) cell.classList.add('is-' + state);
}

function render() {
  const inp = readInputs();
  const r = compute(inp);
  const hs = health(r);
  document.documentElement.dataset.health = hs; // recolors the parallax field

  paintMetric('o_cpc', fmt.money(r.cpc));
  paintMetric('o_clicks', fmt.num(r.clicks, 0));
  paintMetric('o_orders', fmt.num(r.orders, 1));
  paintMetric('o_cac', fmt.money(r.cac));
  paintMetric('o_gross', fmt.money(r.grossMargin), r.grossMargin > 0 ? 'green' : 'red');
  paintMetric('o_net', fmt.money(r.netProfitPerOrder), r.netProfitPerOrder > 0 ? 'green' : 'red');
  paintHero('o_daily', fmt.money(r.dailyProfit), hs);
  paintMetric('o_roas', fmt.roas(r.roas), hs);
  paintMetric('o_beroas', fmt.roas(r.breakevenRoas));
  paintMetric('o_becvr', fmt.pct(r.breakevenCvr));
  renderCvrNote(inp.cvr, r);
  renderCallouts(r);
  renderSliderRef(r);
  paintMetric('o_troas', fmt.roas(r.targetRoas),
    isFinite(r.targetRoas) && r.roas >= r.targetRoas ? 'green' : 'red');
  paintMetric('o_tcpo', fmt.money(r.targetCpo),
    r.targetCpo > 0 && r.cac <= r.targetCpo ? 'green' : 'red');
  paintMetric('o_contrib', fmt.money(r.contributionMargin),
    r.contributionMargin > r.cac ? 'green' : 'red');
  paintMetric('o_beaov', fmt.money(r.breakevenAov),
    isFinite(r.breakevenAov) && r.revenuePerOrder >= r.breakevenAov ? 'green' : 'red');
  const mroas = marginalRoasAt(inp, inp.spend);
  const sat = saturationSpend(inp);
  paintMetric('o_mroas', fmt.roas(mroas),
    mroas >= r.breakevenRoas ? 'green' : 'red');
  const mn = $('mroasNote');
  if (mn) {
    if (!isFinite(r.breakevenRoas)) { mn.textContent = ''; mn.className = 'm-note'; }
    else if (mroas >= r.breakevenRoas) {
      mn.textContent = `Next $ still profitable — room to scale`;
      mn.className = 'm-note is-green';
    } else {
      mn.textContent = `Next $ below breakeven — at the ceiling`;
      mn.className = 'm-note is-red';
    }
  }
  paintMetric('o_sat',
    sat.spend == null ? 'beyond range' : fmt.money0(sat.spend) + '/day',
    sat.spend == null ? 'green'
      : inp.spend < sat.spend ? 'amber' : 'red');
  paintMetric('o_ncac', fmt.money(r.newCustomerCac));
  paintMetric('o_nroas', fmt.roas(r.newCustomerRoas));
  paintMetric('o_ltv', fmt.money(r.effectiveLtv), r.effectiveLtv > 0 ? 'green' : 'red');
  paintMetric('o_payback', isFinite(r.effectivePayback)
    ? fmt.num(r.effectivePayback, r.effectivePayback < 1 ? 1 : 0) + ' mo' : '—',
    isFinite(r.effectivePayback) && r.effectivePayback <= 12 ? 'green'
      : isFinite(r.effectivePayback) ? 'amber' : 'red');
  paintMetric('o_cpv', fmt.money(r.cpv));
  paintMetric('o_rpv', fmt.money(r.rpvAll));
  paintMetric('o_rpvn', fmt.money(r.rpvNew));
  paintMetric('o_rpvr', fmt.money(r.rpvReturning));
  paintMetric('o_mer', fmt.roas(r.mer));
  paintMetric('o_rroas', fmt.roas(r.reportedRoas));
  paintMetric('o_mrev', fmt.money0(r.monthlyRevenue));
  paintMetric('o_mspend', fmt.money0(r.monthlySpend));
  paintHero('o_mnet', fmt.money0(r.monthlyNetProfit), hs);

  renderGauge(r, hs);
  renderStickybar(r, hs);
  renderCurve(inp, r);
  renderTiers(inp);
  renderProbe(inp);
  renderAlerts(r);
  renderChannelBlend(inp, r);
  syncZeroBtns();
  persistDraft();
}

/* ---------- hero gauge ---------- */

function renderGauge(r, hs) {
  const be = r.breakevenRoas;
  const tg = isFinite(r.targetRoas) ? r.targetRoas : be * 1.3;
  // Scale runs 0 → a bit past the highest of the reference points.
  const scaleMax = Math.max(r.roas, tg, be) * 1.25 || 1;
  const pct = v => Math.max(0, Math.min(100, (v / scaleMax) * 100));
  const redW = pct(be);
  const amberW = pct(tg) - redW;
  const greenW = 100 - pct(tg);
  $('gauge').querySelector('.gz-red').style.width = redW + '%';
  $('gauge').querySelector('.gz-amber').style.width = Math.max(0, amberW) + '%';
  $('gauge').querySelector('.gz-green').style.width = Math.max(0, greenW) + '%';
  const needle = $('gaugeNeedle');
  needle.style.left = pct(r.roas) + '%';
  // "You are here" tag with the live ROAS value.
  needle.innerHTML = `<span class="gauge-tag">${fmt.roas(r.roas)}</span>`;
  needle.querySelector('.gauge-tag').classList.add('is-' + hs);

  const verdict = hs === 'green' ? 'On target'
    : hs === 'amber' ? 'Profitable — below target' : 'Losing money';
  // Status glyph: check (on target) / flag (below target) / alert (losing).
  const icons = {
    green: '<path d="M20 6 9 17l-5-5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>',
    amber: '<path d="M5 3v18M5 4h11l-2 4 2 4H5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>',
    red: '<path d="M12 3 2 21h20L12 3zM12 10v5M12 18h.01" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>',
  };
  const v = $('gaugeVerdict');
  v.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[hs]}</svg>${verdict}`;
  v.className = 'gauge-verdict is-' + hs;
  $('gaugeDetail').textContent =
    `ROAS ${fmt.roas(r.roas)} · breakeven ${fmt.roas(be)} · target ${fmt.roas(r.targetRoas)}`;
}

/* ---------- breakeven-CVR headroom note ---------- */

function renderCvrNote(cvr, r) {
  const el = $('becvrNote');
  if (!el) return;
  const h = r.cvrHeadroom;
  if (!isFinite(h) || !cvr) { el.textContent = ''; el.className = 'm-note'; return; }
  if (h >= 0) {
    el.textContent = `Your CVR ${fmt.pct(cvr)} — ${fmt.pct(h)} of headroom`;
    el.className = 'm-note is-green';
  } else {
    el.textContent = `Your CVR ${fmt.pct(cvr)} — ${fmt.pct(-h)} short`;
    el.className = 'm-note is-red';
  }
}

// Reference line under the sensitivity sliders — anchors the drag against
// the user's real typed inputs and the live breakeven CVR (educational).
function renderSliderRef(r) {
  const el = $('sliderRef');
  if (!el) return;
  const b = readBase();
  const parts = [`CTR ${fmt.pct(b.ctr)}`,
    `CVR ${fmt.pct(b.cvr)} (breakeven ${fmt.pct(r.breakevenCvr)})`,
    `CPM ${fmt.money(b.cpm)}`, `Spend ${fmt.money0(b.spend)}/day`];
  el.textContent = 'Your inputs — ' + parts.join('  ·  ');
}

/* ---------- contextual story callouts on benchmark cards ---------- */
// Cheap "perceived intelligence": each benchmark gets a one-line story
// relating it to the user's actual numbers, like the CVR-headroom note.
function renderCallouts(r) {
  const set = (id, txt, st) => {
    const el = $(id);
    if (!el) return;
    el.textContent = txt || '';
    el.className = 'm-note' + (txt && st ? ' is-' + st : '');
  };

  // ROAS vs breakeven — multiple above/below the line.
  if (isFinite(r.breakevenRoas) && r.breakevenRoas > 0 && r.roas > 0) {
    const mult = r.roas / r.breakevenRoas;
    set('beroasNote',
      mult >= 1
        ? `Your ROAS ${fmt.roas(r.roas)} — ${mult.toFixed(2)}x above breakeven`
        : `Your ROAS ${fmt.roas(r.roas)} — below breakeven`,
      mult >= 1 ? 'green' : 'red');
  } else set('beroasNote', '');

  // ROAS vs target.
  if (isFinite(r.targetRoas) && r.targetRoas > 0 && r.roas > 0) {
    const m = r.roas / r.targetRoas;
    set('troasNote',
      m >= 1 ? `Beating target by ${m.toFixed(2)}x`
        : `${(m * 100).toFixed(0)}% of the way to target`,
      m >= 1 ? 'green' : 'amber');
  } else set('troasNote', '');

  // LTV as a multiple of new-customer CAC.
  if (r.newCustomerCac > 0 && r.effectiveLtv > 0) {
    const x = r.effectiveLtv / r.newCustomerCac;
    set('ltvNote', `${x.toFixed(1)}x your new-customer CAC`,
      x >= 3 ? 'green' : x >= 1 ? 'amber' : 'red');
  } else set('ltvNote', '');

  // CAC payback vs a stated healthy rule-of-thumb (~12 mo DTC).
  if (isFinite(r.effectivePayback)) {
    const mo = r.effectivePayback;
    set('paybackNote',
      mo <= 12 ? `Under the ~12-mo healthy rule of thumb`
        : `Above the ~12-mo healthy rule of thumb`,
      mo <= 6 ? 'green' : mo <= 12 ? 'amber' : 'red');
  } else set('paybackNote', 'Never recovers at these inputs', 'red');
}

/* ---------- sticky summary bar ---------- */

function renderStickybar(r, hs) {
  const set = (id, txt, st) => {
    const el = $(id);
    el.textContent = txt;
    el.className = 'sb-val' + (st ? ' is-' + st : '');
  };
  set('sb_daily', fmt.money(r.dailyProfit), hs);
  set('sb_roas', fmt.roas(r.roas), hs);
  set('sb_mnet', fmt.money0(r.monthlyNetProfit), hs);
}

/* ---------- profit-curve chart (hand-rolled SVG, no deps) ---------- */

function renderCurve(inp, r) {
  const svg = $('curve');
  if (!svg) return;
  const W = 800, H = 320, padL = 64, padR = 26, padT = 22, padB = 30;
  const { points, maxSpend } = profitCurve(inp);
  const profits = points.map(p => p.profit);
  const target = r.targetDailyProfit;
  let lo = Math.min(0, ...profits, isFinite(target) ? target : 0);
  let hi = Math.max(0, ...profits, isFinite(target) ? target : 0);
  if (hi === lo) hi = lo + 1;
  const pad = (hi - lo) * 0.14;
  lo -= pad; hi += pad;

  const X = s => padL + (maxSpend > 0 ? s / maxSpend : 0) * (W - padL - padR);
  // Clamp into the plot box so an extreme spike can never draw outside it.
  const Y = v => {
    const y = padT + (1 - (v - lo) / (hi - lo)) * (H - padT - padB);
    return Math.max(padT, Math.min(H - padB, y));
  };

  const line = points.map((p, i) =>
    (i ? 'L' : 'M') + X(p.spend).toFixed(1) + ' ' + Y(p.profit).toFixed(1)).join(' ');
  const area = `M${X(0).toFixed(1)} ${Y(lo).toFixed(1)} `
    + points.map(p => 'L' + X(p.spend).toFixed(1) + ' ' + Y(p.profit).toFixed(1)).join(' ')
    + ` L${X(maxSpend).toFixed(1)} ${Y(lo).toFixed(1)} Z`;

  const ax = (x1, y1, x2, y2, cls) =>
    `<line class="${cls}" x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}"/>`;
  const txt = (x, y, s, anchor = 'middle') =>
    `<text class="curve-axis" x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="${anchor}">${s}</text>`;

  // Stops are styled via CSS classes — a CSS var in a `stop-color` attribute
  // is invalid SVG and made the area fill solid (broken on screen & in print).
  let g = '<defs><linearGradient id="cg" x1="0" y1="0" x2="0" y2="1">'
    + '<stop class="cg-top" offset="0%"/>'
    + '<stop class="cg-bot" offset="100%"/>'
    + '</linearGradient></defs>';
  const lineCls = curveDrawn ? 'curve-line' : 'curve-line draw';
  curveDrawn = true; // animate the draw-in only on the first paint
  g += `<path class="curve-area" d="${area}"/><path class="${lineCls}" d="${line}"/>`;
  g += ax(padL, Y(0), W - padR, Y(0), 'curve-zero');
  if (isFinite(target) && target > lo && target < hi) {
    g += ax(padL, Y(target), W - padR, Y(target), 'curve-target');
    g += txt(W - padR, Y(target) - 5, 'target ' + fmt.money0(target), 'end');
  }
  const nx = X(Math.min(inp.spend, maxSpend));
  g += ax(nx, padT, nx, H - padB, 'curve-now');
  g += `<circle class="curve-now-cap" cx="${nx.toFixed(1)}" cy="${padT.toFixed(1)}" r="3.5"/>`;
  g += `<circle class="curve-dot" cx="${nx.toFixed(1)}" cy="${Y(r.dailyProfit).toFixed(1)}" r="5.5"/>`;
  // Saturation / scaling-ceiling annotation: where the next $ drops below
  // breakeven ROAS — the single number every operator wants.
  const sat = saturationSpend(inp);
  if (sat.spend != null && sat.spend > 0 && sat.spend <= maxSpend) {
    const sx = X(sat.spend);
    g += ax(sx, padT, sx, H - padB, 'curve-sat');
    g += `<text class="curve-sat-lbl" x="${(sx + 6).toFixed(1)}" y="${(padT + 12).toFixed(1)}" text-anchor="start">scaling ceiling ≈ ${fmt.money0(sat.spend)}/day</text>`;
  }
  // Axis ticks
  g += txt(padL, H - padB + 18, fmt.money0(0), 'start');
  g += txt(W - padR, H - padB + 18, fmt.money0(maxSpend) + '/day', 'end');
  g += txt(nx, H - padB + 18, 'now');
  g += txt(padL - 8, Y(hi) + 4, fmt.money0(hi), 'end');
  g += txt(padL - 8, Y(lo) + 4, fmt.money0(lo), 'end');
  // Transparent hit area for the hover read-out.
  g += `<rect class="curve-hit" x="${padL}" y="${padT}" `
    + `width="${(W - padL - padR).toFixed(1)}" height="${(H - padT - padB).toFixed(1)}"/>`;
  svg.innerHTML = g;

  curveCtx = { points, maxSpend, W, padL, padR };
  if (!curveBound) {
    curveBound = true;
    const tip = $('curveTip');
    const wrap = svg.closest('.chart-wrap');
    const move = e => {
      if (!curveCtx || !curveCtx.points.length) return;
      const sr = svg.getBoundingClientRect();
      const vbX = ((e.clientX - sr.left) / sr.width) * curveCtx.W;
      const span = curveCtx.W - curveCtx.padL - curveCtx.padR;
      let f = (vbX - curveCtx.padL) / span;
      f = Math.max(0, Math.min(1, f));
      const pts = curveCtx.points;
      const pos = f * (pts.length - 1);
      const i = Math.round(pos);
      const p = pts[i];
      tip.textContent =
        `${fmt.money0(p.spend)}/day → ${fmt.money0(p.profit)} profit`;
      tip.classList.toggle('neg', p.profit < 0);
      const wr = wrap.getBoundingClientRect();
      let x = e.clientX - wr.left;
      x = Math.max(8, Math.min(x, wr.width - tip.offsetWidth - 8));
      tip.style.left = x + 'px';
      tip.hidden = false;
    };
    svg.addEventListener('pointermove', move);
    svg.addEventListener('pointerleave', () => { $('curveTip').hidden = true; });
  }
}

function renderTiers(inp) {
  const wrap = $('tiers');
  wrap.innerHTML = '';
  for (const t of tiers(inp)) {
    const div = document.createElement('div');
    div.className = 'tier'
      + (t.isCurrent ? ' cur' : '')
      + (t.state === 'amber' ? ' warn' : '')
      + (t.state === 'red' ? ' bad' : '');
    const delta = t.isCurrent
      ? '<div class="tier-delta">current</div>'
      : `<div class="tier-delta ${t.deltaVsCurrent >= 0 ? 'up' : 'down'}">`
        + `${fmt.moneySigned(t.deltaVsCurrent)} vs current</div>`;
    div.innerHTML =
      `<div class="tier-spend">${fmt.money0(t.spend)}/day</div>` +
      `<div class="tier-profit">${fmt.money0(t.profit)}</div>` +
      delta +
      `<div class="tier-sub">ROAS ${t.roas.toFixed(2)}x · marg ${t.marginalRoas.toFixed(2)}x · CPM ${fmt.money(t.cpmUsed)}</div>`;
    wrap.appendChild(div);
  }
}

/* ---------- logged history (IndexedDB snapshots) + trend ---------- */

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-`
    + `${String(d.getDate()).padStart(2, '0')}`;
}

async function logToday() {
  const r = compute(readInputs());
  await db.put('snapshots', {
    date: todayKey(),
    profit: r.dailyProfit, roas: r.roas, mnet: r.monthlyNetProfit,
  });
  renderTrend();
}

async function clearHistory() {
  const all = await db.all('snapshots');
  await Promise.all(all.map(s => db.del('snapshots', s.date)));
  renderTrend();
}

async function renderTrend() {
  const svg = $('trend');
  const note = $('histNote');
  if (!svg) return;
  const rows = (await db.all('snapshots')).sort((a, b) => a.date < b.date ? -1 : 1);
  if (rows.length === 0) {
    svg.innerHTML = '';
    note.textContent = 'No snapshots yet — log today to start the trend.';
    return;
  }
  const W = 800, H = 220, padL = 60, padR = 14, padT = 14, padB = 26;
  const profits = rows.map(r => r.profit);
  let lo = Math.min(0, ...profits), hi = Math.max(0, ...profits);
  if (hi === lo) hi = lo + 1;
  const padv = (hi - lo) * 0.1; lo -= padv; hi += padv;
  const X = i => padL + (rows.length === 1 ? 0.5 : i / (rows.length - 1)) * (W - padL - padR);
  const Y = v => padT + (1 - (v - lo) / (hi - lo)) * (H - padT - padB);
  const line = rows.map((r, i) => (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(r.profit).toFixed(1)).join(' ');
  const area = `M${X(0).toFixed(1)} ${Y(lo).toFixed(1)} `
    + rows.map((r, i) => 'L' + X(i).toFixed(1) + ' ' + Y(r.profit).toFixed(1)).join(' ')
    + ` L${X(rows.length - 1).toFixed(1)} ${Y(lo).toFixed(1)} Z`;
  let g = `<path class="trend-area" d="${area}"/>`;
  g += `<line class="trend-zero" x1="${padL}" y1="${Y(0).toFixed(1)}" x2="${W - padR}" y2="${Y(0).toFixed(1)}"/>`;
  g += `<path class="trend-line" d="${line}"/>`;
  rows.forEach((r, i) => {
    g += `<circle class="trend-dot" cx="${X(i).toFixed(1)}" cy="${Y(r.profit).toFixed(1)}" r="3.5"/>`;
  });
  g += `<text class="trend-axis" x="${padL}" y="${H - 8}" text-anchor="start">${rows[0].date}</text>`;
  g += `<text class="trend-axis" x="${W - padR}" y="${H - 8}" text-anchor="end">${rows[rows.length - 1].date}</text>`;
  g += `<text class="trend-axis" x="${padL - 8}" y="${Y(hi).toFixed(1) + 4}" text-anchor="end">${fmt.money0(hi)}</text>`;
  g += `<text class="trend-axis" x="${padL - 8}" y="${Y(lo).toFixed(1)}" text-anchor="end">${fmt.money0(lo)}</text>`;
  svg.innerHTML = g;
  const first = rows[0].profit, last = rows[rows.length - 1].profit;
  const drift = last - first;
  note.textContent = `${rows.length} snapshot${rows.length > 1 ? 's' : ''} · `
    + `${fmt.moneySigned(drift)} since ${rows[0].date}`;
}

// In-browser alert rules. Blank input = rule off. No backend; this just
// surfaces a banner when the live scenario crosses a user-set threshold.
function renderAlerts(r) {
  const bar = $('alertBar');
  const num = id => { const v = parseFloat($(id).value); return isFinite(v) ? v : null; };
  const pMin = num('alertProfitMin'), roMin = num('alertRoasMin'), cMax = num('alertCpoMax');
  const hits = [];
  if (pMin != null && r.dailyProfit < pMin)
    hits.push(`Daily profit <b>${fmt.money(r.dailyProfit)}</b> is below ${fmt.money(pMin)}`);
  if (roMin != null && r.roas < roMin)
    hits.push(`ROAS <b>${r.roas.toFixed(2)}x</b> is below ${roMin.toFixed(2)}x`);
  if (cMax != null && isFinite(r.cac) && r.cac > cMax)
    hits.push(`CPO <b>${fmt.money(r.cac)}</b> is above ${fmt.money(cMax)}`);
  bar.innerHTML = hits.join(' &nbsp;·&nbsp; ');
  bar.hidden = hits.length === 0;
}

// Factory reset: every input back to its HTML default, all state cleared,
// share param + filter cleared. Saved products/scenarios/history are kept.
function resetAll() {
  if (!confirm(
    'Reset everything to defaults?\n\nThis clears all inputs, the sensitivity '
    + 'sliders, channel mix, product blend, alert rules, the shared-link URL '
    + 'and the results filter. Your saved products, scenarios and logged '
    + 'history are NOT deleted.')) return;
  document.querySelectorAll(
    '#productCard input, #adCard input, #monitorCard input, '
    + '#scenarioCard input, #sliderCard input').forEach(el => {
    el.value = el.defaultValue;
  });
  mode = 'cpm';
  document.querySelectorAll('.mode-toggle .toggle').forEach(b =>
    b.classList.toggle('on', b.dataset.mode === 'cpm'));
  document.querySelectorAll('[data-modefield]').forEach(d =>
    d.hidden = d.dataset.modefield !== 'cpm');
  sliderOverride = null;
  channels = [];
  skuMix = { on: false, weights: {} };
  skuBlend = null;
  fmt.setCurrency('$');
  $('currency').value = '$';
  document.querySelectorAll('.ip .cur').forEach(i => i.textContent = '$');
  history.replaceState(null, '', location.pathname);
  applyTab('all');
  renderChannels();
  renderSku();
  setProbeToCurrent(readInputs());
  $('solverOut').textContent = 'Type a target and press Solve spend';
  $('solverOut').className = 'solver-out';
  syncSlidersToInputs();
  render();
  persistDraft();
  document.querySelectorAll('details.more[open]').forEach(d => d.removeAttribute('open'));
}

/* ---------- multi-SKU blended product ---------- */

let skuProducts = []; // cached saved products for the blend editor

function recomputeSku() {
  const weighted = skuProducts
    .map(p => ({ p, w: Math.max(0, +(skuMix.weights[p.id] || 0)) }))
    .filter(x => x.w > 0);
  const total = weighted.reduce((s, x) => s + x.w, 0);
  if (!skuMix.on || total <= 0) { skuBlend = null; return; }
  skuBlend = {};
  for (const f of PRODUCT_IDS) {
    skuBlend[f] = weighted.reduce((s, x) =>
      s + (x.w / total) * (parseFloat(x.p[f]) || 0), 0);
  }
}

async function renderSku() {
  const wrap = $('skuRows');
  if (!wrap) return;
  skuProducts = await db.all('products');
  $('skuOn').checked = !!skuMix.on;
  wrap.innerHTML = '';
  if (!skuProducts.length) {
    $('skuNote').textContent = 'Sell multiple products? Save each one in the '
      + 'Product panel, then weight them here to model one weighted-average '
      + 'view across your real product mix. No saved products yet.';
    skuBlend = null;
    return;
  }
  skuProducts.forEach(p => {
    const row = document.createElement('div');
    row.className = 'sku-row';
    row.innerHTML =
      `<span>${p.name}</span>`
      + `<input class="w" type="number" min="0" step="1" placeholder="weight" `
      + `value="${skuMix.weights[p.id] ?? ''}">`
      + `<span class="muted">price ${fmt.money(p.price || 0)}</span>`;
    row.querySelector('.w').addEventListener('input', e => {
      skuMix.weights[p.id] = parseFloat(e.target.value) || 0;
      recomputeSku(); render();
    });
    wrap.appendChild(row);
  });
  recomputeSku();
  const used = skuProducts.filter(p => (+skuMix.weights[p.id] || 0) > 0).length;
  $('skuNote').textContent = skuMix.on
    ? `Blending ${used} product${used === 1 ? '' : 's'} by weight — product inputs are overridden`
    : `${used} weighted · enable to override product inputs with the blend`;
}

/* ---------- multi-channel mix ---------- */

function renderChannels() {
  const wrap = $('chanRows');
  if (!wrap) return;
  wrap.innerHTML = '';
  channels.forEach((c, i) => {
    const row = document.createElement('div');
    row.className = 'chan-row';
    row.innerHTML =
      `<input data-k="name" placeholder="Channel (e.g. TikTok)" value="${c.name || ''}">`
      + `<input data-k="spend" type="number" step="1" placeholder="daily spend" value="${c.spend ?? ''}">`
      + `<input data-k="roas" type="number" step="0.01" placeholder="ROAS" value="${c.roas ?? ''}">`
      + `<button class="chan-x" title="Remove" aria-label="Remove channel">×</button>`;
    row.querySelectorAll('input').forEach(inp =>
      inp.addEventListener('input', () => {
        const k = inp.dataset.k;
        channels[i][k] = k === 'name' ? inp.value : (parseFloat(inp.value) || 0);
        sliderOverride = null; render();
      }));
    row.querySelector('.chan-x').addEventListener('click', () => {
      channels.splice(i, 1); renderChannels(); render();
    });
    wrap.appendChild(row);
  });
}

function renderChannelBlend(inp, r) {
  const el = $('chanBlend');
  if (!el) return;
  if (!channels.length) {
    el.textContent = 'Running more than one channel? Add each channel’s '
      + 'daily spend and ROAS (e.g. Meta + Google + TikTok) to see a true '
      + 'blended MER across all of them — it overrides the simple '
      + '“Other channels” fields above.';
    return;
  }
  const cSpend = channels.reduce((s, c) => s + (+c.spend || 0), 0);
  const totalSpend = inp.spend + cSpend;
  const totalRev = r.dailyRevenue + channels.reduce((s, c) => s + (+c.spend || 0) * (+c.roas || 0), 0);
  el.textContent =
    `Blended MER ${fmt.roas(r.mer)} · total spend ${fmt.money0(totalSpend)}/day · `
    + `total revenue ${fmt.money0(totalRev)}/day across ${channels.length + 1} channels`;
}

// Open the probe at the user's CURRENT spend, not $0 — a dead "$0 → $0"
// reading looks broken. Called on load and reset, never mid-drag.
function setProbeToCurrent(inp) {
  const sl = $('probeSlider');
  if (!sl) return;
  const maxS = scenarioMaxSpend(inp);
  const pct = maxS > 0 ? Math.min(100, Math.max(0, (inp.spend / maxS) * 100)) : 10;
  sl.value = pct;
}

// Draggable "what-if" probe: slider 0–100% of the scenario max spend.
function renderProbe(inp) {
  const sl = $('probeSlider');
  const out = $('probeRead');
  if (!sl || !out) return;
  const maxS = scenarioMaxSpend(inp);
  const spend = maxS * ((+sl.value) / 100);
  const p = probeScenario(inp, spend);
  const dv = p.deltaVsCurrent >= 0
    ? '+' + fmt.money0(p.deltaVsCurrent) : fmt.money0(p.deltaVsCurrent);
  const tag = spend <= 0 ? ' · no spend modelled'
    : p.profit < 0 ? ' · loses money at this budget' : '';
  out.textContent =
    `${fmt.money0(spend)}/day → ${fmt.money0(p.profit)} profit · `
    + `ROAS ${p.roas.toFixed(2)}x · ${dv} vs current${tag}`;
  out.className = 'probe-read is-' + p.state;
}

let draftTimer;
function persistDraft() {
  clearTimeout(draftTimer);
  draftTimer = setTimeout(() => db.saveSettings({
    currency: fmt.getCurrency(), mode,
    draft: readBase(),
    slider: sliderOverride, // persists the sensitivity state across refresh
    channels, skuMix,       // multi-channel mix + multi-SKU blend config
    tab: activeTab,         // persists the Live-results filter across refresh
  }), 400);
}

/* ---------- persistence: products / campaigns / scenarios ---------- */

function collectProduct() {
  const o = {};
  PRODUCT_IDS.forEach(id => o[id] = parseFloat($(id).value) || 0);
  return o;
}
function collectCampaign() {
  const o = { mode };
  AD_IDS.forEach(id => o[id] = parseFloat($(id).value) || 0);
  return o;
}
// Single source of truth for the CPM+CTR / Direct-CPC mode: updates the
// variable, the segmented toggle, and which fields the engine reads.
function setMode(m) {
  mode = (m === 'cpc') ? 'cpc' : 'cpm';
  document.querySelectorAll('.mode-toggle .toggle').forEach(b =>
    b.classList.toggle('on', b.dataset.mode === mode));
  document.querySelectorAll('[data-modefield]').forEach(d =>
    d.hidden = d.dataset.modefield !== mode);
}

function applyValues(obj) {
  if (obj && obj.mode) setMode(obj.mode); // restore the saved input mode
  Object.entries(obj).forEach(([k, v]) => { if ($(k)) $(k).value = v; });
  render();
}

async function refreshProductList() {
  const list = await db.all('products');
  const sel = $('productSelect');
  sel.innerHTML = '<option value="">Current (unsaved)</option>'
    + list.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
}
async function refreshCampaignList() {
  const list = await db.all('campaigns');
  const sel = $('campaignSelect');
  sel.innerHTML = '<option value="">Saved campaigns…</option>'
    + list.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
}
async function refreshScenarioList() {
  const list = await db.all('scenarios');
  const sel = $('scenarioSelect');
  sel.innerHTML = '<option value="">Recall…</option>'
    + list.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
}

/* ---------- export ---------- */

function download(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}
function snapshot() {
  const inp = readInputs();
  return { savedAt: new Date().toISOString(), inputs: inp, results: compute(inp) };
}

/* ---------- print: financial-statement document ---------- */
// Builds a real income-statement-style report from compute(), rendered only
// in print (screen keeps the dashboard). Regenerated on every print.
function buildPrintDoc() {
  const host = $('printDoc');
  if (!host) return;
  const inp = readInputs();
  const r = compute(inp);
  const M = fmt.money, M0 = fmt.money0, RX = fmt.roas, PC = fmt.pct, NU = fmt.num;
  const cur = fmt.getCurrency();
  const modeLabel = inp.mode === 'cpc' ? 'Direct CPC' : 'CPM + CTR';
  const today = new Date().toLocaleDateString(undefined,
    { year: 'numeric', month: 'long', day: 'numeric' });
  const profitable = r.dailyProfit >= 0;
  const heroCls = profitable ? 'pos' : 'neg';

  // Fixed report palette (brand-consistent regardless of screen theme).
  const C = { acc: '#1f6feb', ink: '#14181f', mut: '#5b6470',
    pos: '#137a43', neg: '#b42318', line: '#d7dbe0' };

  // Two-column key/value table (no "Sr." noise).
  const kv = (rows) => `<table class="pd-kv">` + rows.map(([k, v, c]) =>
    `<tr><td class="pd-k">${k}</td>`
    + `<td class="pd-v${c ? ' ' + c : ''}">${v}</td></tr>`).join('')
    + `</table>`;

  /* ---- embedded profit-curve chart (self-contained, fixed colors) ---- */
  const W = 760, H = 250, pL = 60, pR = 16, pT = 14, pB = 26;
  const cv = profitCurve(inp);
  const pts = cv.points, maxS = cv.maxSpend;
  const tgt = r.targetDailyProfit;
  let lo = Math.min(0, ...pts.map(p => p.profit), isFinite(tgt) ? tgt : 0);
  let hi = Math.max(0, ...pts.map(p => p.profit), isFinite(tgt) ? tgt : 0);
  if (hi === lo) hi = lo + 1;
  const padv = (hi - lo) * 0.08; lo -= padv; hi += padv;
  const X = s => pL + (maxS > 0 ? s / maxS : 0) * (W - pL - pR);
  const Y = v => pT + (1 - (v - lo) / (hi - lo)) * (H - pT - pB);
  const ln = pts.map((p, i) => (i ? 'L' : 'M')
    + X(p.spend).toFixed(1) + ' ' + Y(p.profit).toFixed(1)).join(' ');
  const ar = `M${X(0).toFixed(1)} ${Y(lo).toFixed(1)} `
    + pts.map(p => 'L' + X(p.spend).toFixed(1) + ' ' + Y(p.profit).toFixed(1)).join(' ')
    + ` L${X(maxS).toFixed(1)} ${Y(lo).toFixed(1)} Z`;
  const nx = X(Math.min(inp.spend, maxS));
  const tx = (x, y, s, a) => `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" `
    + `font-family="sans-serif" font-size="13" fill="${C.mut}" `
    + `text-anchor="${a}">${s}</text>`;
  let chart = `<svg viewBox="0 0 ${W} ${H}" class="pd-chart" `
    + `preserveAspectRatio="xMidYMid meet" role="img" aria-label="Profit curve">`
    + `<path d="${ar}" fill="${C.acc}" fill-opacity="0.10"/>`
    + `<line x1="${pL}" y1="${Y(0).toFixed(1)}" x2="${W - pR}" `
    + `y2="${Y(0).toFixed(1)}" stroke="${C.neg}" stroke-width="1.5"/>`;
  if (isFinite(tgt) && tgt > lo && tgt < hi) {
    chart += `<line x1="${pL}" y1="${Y(tgt).toFixed(1)}" x2="${W - pR}" `
      + `y2="${Y(tgt).toFixed(1)}" stroke="${C.pos}" stroke-width="1.5" `
      + `stroke-dasharray="6 5"/>`
      + tx(W - pR, Y(tgt) - 5, 'target ' + M0(tgt), 'end');
  }
  chart += `<line x1="${nx.toFixed(1)}" y1="${pT}" x2="${nx.toFixed(1)}" `
    + `y2="${H - pB}" stroke="${C.ink}" stroke-width="1.5" `
    + `stroke-dasharray="3 4" opacity="0.5"/>`
    + `<path d="${ln}" fill="none" stroke="${C.acc}" stroke-width="3.5" `
    + `stroke-linejoin="round" stroke-linecap="round"/>`
    + `<circle cx="${nx.toFixed(1)}" cy="${Y(r.dailyProfit).toFixed(1)}" `
    + `r="5" fill="${C.acc}" stroke="#fff" stroke-width="2"/>`;
  const pdSat = saturationSpend(inp);
  if (pdSat.spend != null && pdSat.spend > 0 && pdSat.spend <= maxS) {
    const sx = X(pdSat.spend);
    chart += `<line x1="${sx.toFixed(1)}" y1="${pT}" x2="${sx.toFixed(1)}" `
      + `y2="${H - pB}" stroke="#b26a00" stroke-width="2" `
      + `stroke-dasharray="5 4"/>`
      + `<text x="${(sx + 6).toFixed(1)}" y="${(pT + 12).toFixed(1)}" `
      + `font-family="sans-serif" font-size="13" font-weight="700" `
      + `fill="#b26a00" text-anchor="start">scaling ceiling `
      + `${M0(pdSat.spend)}/day</text>`;
  }
  chart += tx(pL, H - pB + 18, M0(0), 'start')
    + tx(W - pR, H - pB + 18, M0(maxS) + '/day', 'end')
    + tx(nx, H - pB + 18, 'now', 'middle')
    + tx(pL - 8, Y(hi) + 4, M0(hi), 'end')
    + tx(pL - 8, Y(lo) + 4, M0(lo), 'end')
    + `</svg>`;

  /* ---- scaling scenarios with inline bars ---- */
  const ts = tiers(inp);
  const maxP = Math.max(1, ...ts.map(t => Math.max(0, t.profit)));
  const scaleRows = ts.map(t => {
    const w = Math.max(0, Math.min(100, (t.profit / maxP) * 100));
    const pc = t.profit >= 0 ? 'pos' : 'neg';
    return `<tr${t.isCurrent ? ' class="cur"' : ''}>`
      + `<td class="pd-k">${M0(t.spend)}/day${t.isCurrent ? ' &middot; current' : ''}</td>`
      + `<td class="pd-bar"><span style="width:${w.toFixed(1)}%"></span></td>`
      + `<td class="pd-v ${pc}">${M0(t.profit)}</td>`
      + `<td class="pd-v">${RX(t.roas)}</td></tr>`;
  }).join('');

  /* ---- what-if ---- */
  const wAt = mult => {
    const p = probeScenario(inp, inp.spend * mult);
    return `<li><b>${M0(inp.spend * mult)}/day</b> &rarr; `
      + `<span class="${p.profit >= 0 ? 'pos' : 'neg'}">${M0(p.profit)}/day `
      + `profit</span> (ROAS ${RX(p.roas)})</li>`;
  };
  const goalTarget = Math.max(100,
    Math.ceil((r.dailyProfit > 0 ? r.dailyProfit * 1.5 : 200) / 50) * 50);
  const gs = solveSpend(inp, goalTarget);
  const gsLine = gs.reachable
    ? `<li>To net <b>${M0(goalTarget)}/day</b>, spend about `
      + `<b>${M0(gs.spend)}/day</b> (ROAS ${RX(gs.roas)})</li>`
    : `<li>Netting <b>${M0(goalTarget)}/day</b> is beyond reach at these `
      + `inputs — peak is ${M0(gs.peakProfit)}/day at ${M0(gs.peakSpend)}/day</li>`;

  /* ---- interpreted ratio cards ---- */
  const ok = '<svg class="pd-ic" viewBox="0 0 16 16"><path d="M3 8.5l3.2 3'
    + ' 6.8-7" fill="none" stroke="currentColor" stroke-width="2.4"'
    + ' stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const warn = '<svg class="pd-ic" viewBox="0 0 16 16"><path d="M8 2l6.5 12'
    + 'H1.5L8 2zM8 6.5v3.5M8 12h.01" fill="none" stroke="currentColor"'
    + ' stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const roasMult = r.breakevenRoas > 0 && isFinite(r.breakevenRoas)
    ? r.roas / r.breakevenRoas : 0;
  const ltvX = r.newCustomerCac > 0 ? r.effectiveLtv / r.newCustomerCac : 0;
  const card = (label, value, note, good) =>
    `<div class="pd-card"><div class="pd-card-l">${label}</div>`
    + `<div class="pd-card-v">${value}</div>`
    + `<div class="pd-card-n ${good ? 'pos' : 'neg'}">`
    + `${good ? ok : warn}${note}</div></div>`;
  const cards = [
    card('ROAS', RX(r.roas),
      roasMult >= 1 ? `${roasMult.toFixed(1)}x above breakeven (${RX(r.breakevenRoas)})`
        : `below breakeven (${RX(r.breakevenRoas)})`, roasMult >= 1),
    card('Breakeven CVR', PC(r.breakevenCvr),
      r.cvrHeadroom >= 0
        ? `your CVR ${PC(inp.cvr)} — ${PC(r.cvrHeadroom)} of headroom`
        : `your CVR ${PC(inp.cvr)} — ${PC(-r.cvrHeadroom)} short`,
      r.cvrHeadroom >= 0),
    card('Target ROAS', RX(r.targetRoas),
      isFinite(r.targetRoas) && r.roas >= r.targetRoas
        ? 'profit target is being met' : 'below profit target',
      isFinite(r.targetRoas) && r.roas >= r.targetRoas),
    card('Customer LTV', M(r.effectiveLtv),
      ltvX > 0 ? `${ltvX.toFixed(1)}x new-customer CAC (${M(r.newCustomerCac)})`
        : 'set repeat rate / orders per year', ltvX >= 3),
    card('CAC payback', isFinite(r.effectivePayback)
      ? NU(r.effectivePayback, 1) + ' mo' : 'never',
      isFinite(r.effectivePayback)
        ? (r.effectivePayback <= 12 ? 'under the ~12-mo healthy rule of thumb'
          : 'above the ~12-mo healthy rule of thumb')
        : 'does not recover at these inputs',
      isFinite(r.effectivePayback) && r.effectivePayback <= 12),
    card('MER (blended)', RX(r.mer),
      'total revenue ÷ total spend across channels', r.mer >= r.breakevenRoas),
    card('Marginal ROAS', RX(marginalRoasAt(inp, inp.spend)),
      marginalRoasAt(inp, inp.spend) >= r.breakevenRoas
        ? 'next dollar still above breakeven — room to scale'
        : 'next dollar below breakeven — at the ceiling',
      marginalRoasAt(inp, inp.spend) >= r.breakevenRoas),
    card('Scaling ceiling',
      pdSat.spend == null ? 'beyond range' : M0(pdSat.spend) + '/day',
      pdSat.spend == null ? 'no ceiling within the modelled range'
        : 'do-not-exceed budget at these inputs',
      pdSat.spend == null || inp.spend < pdSat.spend),
    card('Breakeven AOV',
      isFinite(r.breakevenAov) ? M(r.breakevenAov) : '—',
      isFinite(r.breakevenAov) && r.revenuePerOrder >= r.breakevenAov
        ? `your rev/order ${M(r.revenuePerOrder)} clears it`
        : `your rev/order ${M(r.revenuePerOrder)} is below it`,
      isFinite(r.breakevenAov) && r.revenuePerOrder >= r.breakevenAov),
  ].join('');

  /* ---- P&L per order (fully filled, no sparse columns) ---- */
  const proc = r.revenuePerOrder * inp.processing / 100;
  const refc = r.grossMargin * inp.refund / 100;
  const pnl = kv([
    ['Revenue / order', M(r.revenuePerOrder)],
    ['less COGS', '−' + M(inp.cogs)],
    ['less Shipping', '−' + M(inp.shipping)],
    ['less Payment processing', '−' + M(proc)],
    ['= Gross profit / order', M(r.grossMargin), 'tot'],
    ['less Refund cost', '−' + M(refc)],
    ['less Other fixed fees', '−' + M(inp.otherFees)],
    ['= Net margin / order', M(r.netMargin), 'tot'],
    ['less Ad cost / order (CPO)', '−' + M(r.cac)],
    ['= Net profit / order', M(r.netProfitPerOrder), heroCls],
  ]);
  const horizon = kv([
    ['Orders / day', NU(r.orders, 1)],
    ['Daily revenue', M0(r.dailyRevenue)],
    ['Daily ad spend', M0(inp.spend)],
    ['Daily net profit', M0(r.dailyProfit), heroCls],
    ['Monthly revenue', M0(r.monthlyRevenue)],
    ['Monthly ad spend', M0(r.monthlySpend)],
    ['Monthly net profit', M0(r.monthlyNetProfit), heroCls],
  ]);

  const assumptions = kv([
    ['Selling price', M(inp.price)],
    ...(inp.aov > 0 ? [['AOV override', M(inp.aov)]] : []),
    ...(inp.upsell > 0 ? [['Upsell / AOV bump', M(inp.upsell)]] : []),
    ['COGS', M(inp.cogs)], ['Shipping', M(inp.shipping)],
    ['Payment processing', PC(inp.processing)],
    ['Returns / refund rate', PC(inp.refund)],
    ['Other fixed fees / order', M(inp.otherFees)],
    ['Daily ad spend', M0(inp.spend)],
    ...(inp.mode === 'cpc' ? [['CPC (direct)', M(inp.cpc)]]
      : [['CPM', M(inp.cpm)], ['CTR', PC(inp.ctr)]]),
    ['CVR (store conversion)', PC(inp.cvr)],
    ['New customers (of orders)', PC(inp.newPct)],
    ['New visitors (of clicks)', PC(inp.newVisPct)],
    ['Attribution capture', PC(inp.attrCapture)],
    ['Target net profit', PC(inp.targetProfit)],
    ['Avg orders / customer / yr', NU(inp.ordersPerYear, 2)],
    ['Monthly repeat-purchase rate', PC(inp.retentionM)],
  ]);
  const visitors = kv([
    ['New customers / day', NU(r.newOrders, 1)],
    ['Returning / day', NU(r.returningOrders, 1)],
    ['New-customer CAC', M(r.newCustomerCac)],
    ['New-customer ROAS', RX(r.newCustomerRoas)],
    ['CPC (cost / click)', M(r.cpc)],
    ['CPV (cost / visitor)', M(r.cpv)],
    ['RPV — all / new / returning',
      `${M(r.rpvAll)} / ${M(r.rpvNew)} / ${M(r.rpvReturning)}`],
  ]);

  const methodology = kv([
    ['CPC', 'CPM ÷ 1000 × (1 ÷ CTR), or entered directly'],
    ['Orders / day', '(Ad spend ÷ CPC) × CVR'],
    ['Gross profit', 'Rev/order − COGS − Shipping − Rev×Processing%'],
    ['Net margin', 'Gross − Gross×Refund% − Other fees'],
    ['CPO', 'Ad spend ÷ Orders'],
    ['Breakeven ROAS', 'Rev/order ÷ Net margin'],
    ['Target ROAS', 'Rev/order ÷ (Net margin − Rev×Target%)'],
    ['LTV (cohort)', 'Gross margin × Σ retention^k, k=0..11'],
    ['CPM creep', 'CPM × (1 + 0.06 × log2(spend ratio)) when scaling up'],
  ]);

  host.innerHTML =
    `<header class="pd-cover">`
    + `<div class="pd-brand">AdCalc</div>`
    + `<h1>Unit Economics Report</h1>`
    + `<div class="pd-meta">${today} &nbsp;&middot;&nbsp; ${cur} `
    + `&nbsp;&middot;&nbsp; ${modeLabel} mode</div>`
    + `<div class="pd-hero">`
    + `<div class="pd-hero-c"><span>Daily net profit</span>`
    + `<b class="${heroCls}">${M(r.dailyProfit)}</b></div>`
    + `<div class="pd-hero-c"><span>Monthly net profit</span>`
    + `<b class="${heroCls}">${M0(r.monthlyNetProfit)}</b></div>`
    + `<div class="pd-hero-c"><span>ROAS</span><b>${RX(r.roas)}</b></div>`
    + `</div>`
    + `<p class="pd-summary">At ${M0(inp.spend)}/day with CVR ${PC(inp.cvr)} `
    + `and CPO ${M(r.cac)}, this configuration nets `
    + `<b class="${heroCls}">${M(r.dailyProfit)}/day</b> &mdash; ROAS `
    + `${RX(r.roas)}, ${roasMult >= 1 ? roasMult.toFixed(1) + 'x above'
      : 'below'} breakeven.</p>`
    + `</header>`
    + `<section class="pd-sec"><h2>Profit curve</h2>${chart}`
    + `<div class="pd-leg"><span><i style="background:${C.acc}"></i>`
    + `Daily profit</span><span><i style="background:${C.neg}"></i>Breakeven`
    + `</span><span><i style="background:${C.pos}"></i>Target</span>`
    + `<span><i style="background:${C.ink}"></i>Current spend</span></div>`
    + `</section>`
    + `<section class="pd-sec"><h2>Scaling scenarios</h2>`
    + `<table class="pd-scale"><tbody>${scaleRows}</tbody></table></section>`
    + `<section class="pd-sec"><h2>What if?</h2><ul class="pd-list">`
    + `<li>At your current <b>${M0(inp.spend)}/day</b> &rarr; `
    + `<span class="${heroCls}">${M0(r.dailyProfit)}/day profit</span></li>`
    + wAt(2) + wAt(5) + gsLine + `</ul></section>`
    + `<section class="pd-sec"><h2>Profit &amp; loss</h2>`
    + `<div class="pd-2col"><div>${pnl}</div><div>${horizon}</div></div></section>`
    + `<section class="pd-sec"><h2>Ratios &amp; benchmarks</h2>`
    + `<div class="pd-cards">${cards}</div></section>`
    + `<section class="pd-sec"><h2>Customers &amp; per-visitor</h2>`
    + visitors + `</section>`
    + `<section class="pd-sec pd-compact"><h2>Assumptions</h2>`
    + assumptions + `</section>`
    + `<section class="pd-sec pd-compact"><h2>Methodology</h2>`
    + methodology + `</section>`
    + `<div class="pd-disclaimer"><b>Generated locally on this device.</b> `
    + `No data was uploaded, transmitted, or stored on any server. `
    + `AdCalc by Artivicolab &mdash; adcalc.artivicolab.com &middot; `
    + `Figures are forward projections from the assumptions above, `
    + `not booked actuals.</div>`;
}
function exportJson() {
  download('adcalc-scenario.json', JSON.stringify(snapshot(), null, 2), 'application/json');
}
function exportCsv() {
  const s = snapshot();
  const rows = [['metric', 'value']];
  Object.entries(s.inputs).forEach(([k, v]) => rows.push(['input.' + k, v]));
  Object.entries(s.results).forEach(([k, v]) => rows.push(['result.' + k, v]));
  download('adcalc-scenario.csv', rows.map(r => r.join(',')).join('\n'), 'text/csv');
}

/* ---------- sliders ---------- */

function syncSlidersToInputs() {
  $('ctrSlider').value = $('ctr').value || 2.2;
  $('cvrSlider').value = $('cvr').value || 3.6;
  $('cpmSlider').value = $('cpm').value || 14;
  $('spendSlider').value = 1;
  sliderOverride = null;
  updateSliderOutputs();
  render();
}
function updateSliderOutputs() {
  $('ctrOut').textContent = (+$('ctrSlider').value).toFixed(2) + '%';
  $('cvrOut').textContent = (+$('cvrSlider').value).toFixed(2) + '%';
  $('cpmOut').textContent = fmt.money(+$('cpmSlider').value);
  const mult = +$('spendSlider').value;
  const base = parseFloat($('spend').value) || 0;
  $('spendOut').textContent = mult.toFixed(2) + '× · ' + fmt.money0(mult * base);
}
function onSlider() {
  const mult = +$('spendSlider').value;
  const base = parseFloat($('spend').value) || 0;
  sliderOverride = {
    ctr: +$('ctrSlider').value,
    cvr: +$('cvrSlider').value,
    cpm: +$('cpmSlider').value,
    spend: mult * base,
    spendMult: mult, // for slider-position restore after refresh
    mode: 'cpm',
  };
  updateSliderOutputs();
  render();
}

/* ---------- init ---------- */

function bindInputs() {
  [...PRODUCT_IDS, ...AD_IDS].forEach(id =>
    $(id).addEventListener('input', () => { sliderOverride = null; render(); }));

  // Quiet "zero" affordance on optional adjustment fields (not core drivers
  // like price/spend/cpm/ctr/cpc/cvr, where zeroing only breaks the model).
  // Only shown when the field actually holds a non-zero value to clear.
  ['shipping', 'processing', 'refund', 'otherFees', 'upsell', 'aov',
    'targetProfit', 'otherSpend', 'otherRevenue'].forEach(id => {
    const inp = $(id);
    const wrap = inp && inp.closest('.ip');
    if (!wrap) return;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'zero';
    b.textContent = 'zero';
    b.title = 'Set this field to zero';
    b.tabIndex = -1;
    b.hidden = true;
    b.addEventListener('click', () => {
      inp.value = '0';
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      inp.focus();
    });
    wrap.appendChild(b);
    zeroBtns.push({ inp, b });
  });
  syncZeroBtns();

  document.querySelectorAll('.mode-toggle .toggle').forEach(btn =>
    btn.addEventListener('click', () => { setMode(btn.dataset.mode); render(); }));

  // Live-results tabs: filter which metric groups are visible.
  document.querySelectorAll('#resultTabs .tab').forEach(t =>
    t.addEventListener('click', () => { applyTab(t.dataset.tab); persistDraft(); }));

  $('currency').addEventListener('change', e => {
    fmt.setCurrency(e.target.value);
    document.querySelectorAll('.ip .cur').forEach(i => i.textContent = e.target.value);
    render();
  });

  $('saveProductBtn').addEventListener('click', async () => {
    const name = prompt('Name this product:');
    if (!name) return;
    await db.put('products', { name, ...collectProduct() });
    refreshProductList();
    renderSku();
  });
  $('skuOn').addEventListener('change', e => {
    skuMix.on = e.target.checked;
    recomputeSku(); renderSku(); render();
  });
  $('productSelect').addEventListener('change', async e => {
    if (!e.target.value) return;
    applyValues(await db.get('products', +e.target.value));
  });
  $('saveCampaignBtn').addEventListener('click', async () => {
    const name = $('campaignName').value.trim() || 'Campaign ' + new Date().toLocaleDateString();
    await db.put('campaigns', { name, ts: Date.now(), ...collectCampaign() });
    $('campaignName').value = '';
    refreshCampaignList();
  });
  $('campaignSelect').addEventListener('change', async e => {
    if (!e.target.value) return;
    applyValues(await db.get('campaigns', +e.target.value));
  });
  $('saveScenarioBtn').addEventListener('click', async () => {
    const name = $('scenarioName').value.trim() || 'Scenario ' + new Date().toLocaleString();
    const note = $('scenarioNote').value.trim();
    await db.put('scenarios', { name, note, ...snapshot() });
    $('scenarioName').value = '';
    $('scenarioNote').value = '';
    refreshScenarioList();
  });
  $('scenarioSelect').addEventListener('change', async e => {
    if (!e.target.value) return;
    const s = await db.get('scenarios', +e.target.value);
    if (s?.inputs) applyValues(s.inputs);
    $('scenarioNote').value = s?.note || '';
  });
  $('exportJsonBtn').addEventListener('click', exportJson);
  $('exportCsvBtn').addEventListener('click', exportCsv);
  $('printBtn').addEventListener('click', () => { buildPrintDoc(); window.print(); });
  // Cmd/Ctrl-P or browser print menu: regenerate the statement first.
  addEventListener('beforeprint', buildPrintDoc);
  $('resetBtn').addEventListener('click', resetAll);
  $('logBtn').addEventListener('click', logToday);
  $('clearHistBtn').addEventListener('click', clearHistory);
  $('addChanBtn').addEventListener('click', () => {
    channels.push({ name: '', spend: 0, roas: 0 });
    renderChannels(); render();
  });

  // Goal-seek solver — always explains WHY, and what to change.
  $('solverBtn').addEventListener('click', () => {
    const out = $('solverOut');
    const target = parseFloat($('solverTarget').value);
    if (!isFinite(target) || target <= 0) {
      out.className = 'solver-out no';
      out.innerHTML = 'Enter a target daily profit above 0 first.';
      return;
    }
    const inp = readInputs();
    const r = compute(inp);
    const res = solveSpend(inp, target);

    if (res.reachable) {
      out.className = 'solver-out ok';
      out.innerHTML =
        `Spend <b>${fmt.money0(res.spend)}/day</b> to make `
        + `<b>${fmt.money0(target)}/day</b> profit (ROAS ${res.roas.toFixed(2)}x). `
        + `That is ${(res.spend / (inp.spend || res.spend)).toFixed(2)}× your `
        + `current spend.`;
      return;
    }

    // Not reachable — diagnose the real reason and prescribe a fix.
    out.className = 'solver-out no';
    if (res.peakProfit <= 0) {
      // Loses money at every budget: acquisition costs exceed margin.
      out.innerHTML =
        `<b>Not possible at any budget.</b> These inputs lose money on every `
        + `order — cost per order (<b>${fmt.money(r.cac)}</b>) is above your `
        + `net margin (<b>${fmt.money(r.netMargin)}</b>/order), so more spend `
        + `only loses more.`
        + `<span class="fixit">Fix the economics first: raise CVR, AOV or `
        + `price, cut COGS/shipping, or lower CPC/CPM — then solve again. `
        + `Goal-seek can only find a budget once a profit exists.</span>`;
    } else {
      // Profitable, but the target is above the ceiling these inputs allow.
      out.innerHTML =
        `<b>${fmt.money0(target)}/day is above the ceiling</b> for these `
        + `inputs. The most you can make is about `
        + `<b>${fmt.money0(res.peakProfit)}/day</b> at `
        + `<b>${fmt.money0(res.peakSpend)}/day</b> spend — past that, CPM `
        + `creep eats the gains.`
        + `<span class="fixit">Lower the target to `
        + `${fmt.money0(res.peakProfit)} or less, raise the Top tier × to `
        + `search higher, or improve CVR/margin to lift the ceiling.</span>`;
    }
  });

  // Shareable scenario link — inputs base64-encoded in the URL hash, no server
  $('shareBtn').addEventListener('click', async () => {
    const payload = btoa(encodeURIComponent(JSON.stringify(readBase())));
    const url = location.origin + location.pathname + '#s=' + payload;
    const msg = $('shareMsg');
    try {
      await navigator.clipboard.writeText(url);
      msg.textContent = 'Share link copied — inputs are encoded in the URL, nothing is uploaded.';
    } catch {
      location.hash = 's=' + payload;
      msg.textContent = 'Share link is in the address bar (copy failed silently).';
    }
    msg.hidden = false;
    setTimeout(() => { msg.hidden = true; }, 4000);
  });

  // Methodology modal
  const mm = $('methodModal');
  const closeMM = () => { mm.hidden = true; };
  $('methodBtn').addEventListener('click', () => { mm.hidden = false; });
  $('methodX').addEventListener('click', closeMM);
  mm.addEventListener('click', e => { if (e.target === mm) closeMM(); });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !mm.hidden) closeMM();
  });

  ['ctrSlider', 'cvrSlider', 'cpmSlider', 'spendSlider'].forEach(id =>
    $(id).addEventListener('input', onSlider));
  $('resetSliders').addEventListener('click', syncSlidersToInputs);
  $('probeSlider').addEventListener('input', () => renderProbe(readInputs()));
}

// Subtle parallax: the #bgfx field drifts slower than scroll, with a faint
// pointer-driven offset for depth. rAF-throttled; disabled for reduced motion.
function initParallax() {
  const fx = $('bgfx');
  if (!fx || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  let sy = 0, px = 0, py = 0, ticking = false;
  const apply = () => {
    ticking = false;
    fx.style.transform =
      `translate3d(${px * 14}px, ${sy * -0.12 + py * 14}px, 0) scale(1.06)`;
  };
  const req = () => { if (!ticking) { ticking = true; requestAnimationFrame(apply); } };
  addEventListener('scroll', () => { sy = scrollY; req(); }, { passive: true });
  addEventListener('pointermove', e => {
    px = (e.clientX / innerWidth - 0.5);
    py = (e.clientY / innerHeight - 0.5);
    req();
  }, { passive: true });
}

// Rich, themed tooltip engine. Reads data-tip (paragraphs split on "|"; a
// segment prefixed "RULE:" becomes the rule-of-thumb line; "`x`" → mono chip).
// Title comes from data-tip-title or the nearest label/metric text.
function initTooltips() {
  const tip = document.createElement('div');
  tip.id = 'tip';
  tip.setAttribute('role', 'tooltip');
  document.body.appendChild(tip);
  let cur = null;

  const fmtSeg = s => s.replace(/`([^`]+)`/g, '<span class="tip-k">$1</span>');

  const build = el => {
    let title = el.dataset.tipTitle;
    if (!title) {
      // The icon sits right after the label text, so the text node just
      // before it is the clean name (avoids input values / suffixes).
      const prev = el.previousSibling;
      if (prev && prev.nodeType === 3 && prev.textContent.trim()) {
        title = prev.textContent.trim();
      } else {
        const host = el.closest('.m-label, label');
        if (host) title = (host.textContent.split('?')[0] || '').trim();
      }
    }
    const parts = (el.dataset.tip || '').split('|').map(s => s.trim()).filter(Boolean);
    let html = title ? `<span class="tip-h">${title}</span>` : '';
    for (const p of parts) {
      if (/^RULE:/i.test(p)) html += `<p class="tip-rule">${fmtSeg(p.replace(/^RULE:/i, '').trim())}</p>`;
      else html += `<p>${fmtSeg(p)}</p>`;
    }
    tip.innerHTML = html;
  };

  const place = el => {
    const r = el.getBoundingClientRect();
    tip.style.maxWidth = Math.min(380, innerWidth - 24) + 'px';
    tip.style.left = '-9999px'; tip.style.top = '0';
    tip.classList.add('show');
    const tr = tip.getBoundingClientRect();
    let x = r.left + r.width / 2 - tr.width / 2;
    x = Math.max(12, Math.min(x, innerWidth - tr.width - 12));
    let y = r.bottom + 10;
    if (y + tr.height > innerHeight - 12) {
      const above = r.top - tr.height - 10;
      y = above >= 12 ? above : Math.max(12, innerHeight - tr.height - 12);
    }
    tip.style.left = Math.round(x) + 'px';
    tip.style.top = Math.round(y) + 'px';
  };

  const show = el => { cur = el; build(el); place(el); };
  const hide = () => { cur = null; tip.classList.remove('show'); };

  document.addEventListener('pointerover', e => {
    const el = e.target.closest && e.target.closest('.info');
    if (el && el !== cur) show(el);
  });
  document.addEventListener('pointerout', e => {
    const el = e.target.closest && e.target.closest('.info');
    if (el && el === cur && !el.contains(e.relatedTarget)) hide();
  });
  document.addEventListener('focusin', e => {
    const el = e.target.closest && e.target.closest('.info');
    if (el) show(el);
  });
  document.addEventListener('focusout', e => {
    if (e.target.closest && e.target.closest('.info') === cur) hide();
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') hide(); });
  addEventListener('scroll', () => { if (cur) hide(); }, { passive: true });
}

// Every card panel collapses from its header (chevron or title click).
// Collapsed set persists in localStorage, keyed by card id.
function initCollapsibles() {
  let collapsed = [];
  try { collapsed = JSON.parse(localStorage.getItem('adcalc_collapsed') || '[]'); }
  catch { collapsed = []; }
  document.querySelectorAll('main .card').forEach(card => {
    const head = card.querySelector(':scope > .card-head');
    if (!head) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'card-toggle';
    btn.setAttribute('aria-label', 'Collapse or expand this section');
    btn.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true">'
      + '<path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" '
      + 'stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    head.insertBefore(btn, head.firstChild);
    const id = card.id;
    if (id && collapsed.includes(id)) card.classList.add('collapsed');
    const save = () => {
      if (!id) return;
      const set = new Set(collapsed);
      card.classList.contains('collapsed') ? set.add(id) : set.delete(id);
      collapsed = [...set];
      try { localStorage.setItem('adcalc_collapsed', JSON.stringify(collapsed)); }
      catch { /* storage full / blocked — non-critical */ }
    };
    head.addEventListener('click', e => {
      // Don't toggle when interacting with controls living in the header.
      if (e.target.closest('input,select,a,label,.info')) return;
      if (e.target.closest('button:not(.card-toggle)')) return;
      card.classList.toggle('collapsed');
      btn.setAttribute('aria-expanded',
        String(!card.classList.contains('collapsed')));
      save();
    });
  });
}

async function init() {
  bindInputs();
  initParallax();
  initTooltips();
  initCollapsibles();
  const s = await db.getSettings();
  if (s.currency) {
    fmt.setCurrency(s.currency);
    $('currency').value = s.currency;
    document.querySelectorAll('.ip .cur').forEach(i => i.textContent = s.currency);
  }
  if (s.draft) {
    Object.entries(s.draft).forEach(([k, v]) => { if ($(k) && typeof v !== 'object') $(k).value = v; });
    if (s.draft.mode) setMode(s.draft.mode); // restore CPM+CTR / Direct-CPC
  }
  // A shared link (#s=...) overrides the saved draft.
  const m = location.hash.match(/[#&]s=([^&]+)/);
  if (m) {
    try {
      const shared = JSON.parse(decodeURIComponent(atob(m[1])));
      Object.entries(shared).forEach(([k, v]) => {
        if ($(k) && typeof v !== 'object') $(k).value = v;
      });
      if (shared.mode) setMode(shared.mode);
    } catch { /* malformed link — ignore, fall back to draft */ }
  }
  if (Array.isArray(s.channels)) channels = s.channels;
  if (s.skuMix && typeof s.skuMix === 'object') skuMix = s.skuMix;
  applyTab(s.tab || 'all'); // restore the Live-results filter
  renderChannels();
  if (s.slider) {
    // Restore the sensitivity state so a refresh keeps the dragged scenario.
    sliderOverride = s.slider;
    $('ctrSlider').value = s.slider.ctr;
    $('cvrSlider').value = s.slider.cvr;
    $('cpmSlider').value = s.slider.cpm;
    $('spendSlider').value = s.slider.spendMult ?? 1;
    updateSliderOutputs();
    render();
  } else {
    // No saved sensitivity: line the sliders up with the typed inputs.
    syncSlidersToInputs();
  }
  setProbeToCurrent(readInputs()); // open the probe at current spend, not $0
  renderProbe(readInputs());
  refreshProductList();
  refreshCampaignList();
  refreshScenarioList();
  renderSku();
  renderTrend();
}

init();
