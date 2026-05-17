import { compute, health } from './calc.js';

// Tier multiples of current spend. The low band is fixed (0.25/0.5/1× so
// "current" is always present and highlighted); the three growth steps are
// derived geometrically from a user-defined top multiple (inp.tierMax,
// default 10×) so buyers can model their own ceiling instead of hard tiers.
function ratiosFor(inp) {
  const m = Math.max(1.5, inp && inp.tierMax > 0 ? inp.tierMax : 10);
  return [0.25, 0.5, 1,
    +Math.pow(m, 1 / 3).toFixed(3),
    +Math.pow(m, 2 / 3).toFixed(3),
    m];
}

// CPM creep: auctions get more expensive as you scale. Mild log model so the
// table flags the tier where scaling flips unit economics negative.
// scaledCPM = CPM × (1 + creep × log2(ratio)), clamped at ratio >= 1.
const CREEP = 0.06;
function scaledCPM(cpm, ratio) {
  if (ratio <= 1) return cpm;
  return cpm * (1 + CREEP * Math.log2(ratio));
}

export function scenarioMaxSpend(inp) {
  const r = ratiosFor(inp);
  return inp.spend * r[r.length - 1];
}

// Daily revenue at an arbitrary spend, with CPM creep applied.
function revenueAt(inp, spend) {
  const ratio = inp.spend > 0 ? spend / inp.spend : 0;
  return compute({ ...inp, spend, cpm: scaledCPM(inp.cpm, ratio) }).dailyRevenue;
}

// Marginal (incremental) ROAS: revenue earned on the NEXT dollar of spend at
// this point — what sophisticated buyers use to decide whether to scale.
export function marginalRoasAt(inp, spend) {
  const d = Math.max(1, spend * 0.02);
  return (revenueAt(inp, spend + d) - revenueAt(inp, spend)) / d;
}

// Saturation / "scaling ceiling": the spend at which the next dollar's ROAS
// falls below breakeven ROAS — i.e. scaling further destroys money. Returns
// { spend, beyond } where beyond=true means no ceiling within the search range.
export function saturationSpend(inp) {
  const be = compute(inp).breakevenRoas;
  if (!isFinite(be) || be <= 0) return { spend: null, beyond: true };
  const max = scenarioMaxSpend(inp) * 1.5, n = 200;
  for (let i = 1; i <= n; i++) {
    const s = (max * i) / n;
    if (marginalRoasAt(inp, s) < be) return { spend: s, beyond: false };
  }
  return { spend: null, beyond: true };
}

export function tiers(inp) {
  const currentProfit = compute(inp).dailyProfit;
  return ratiosFor(inp).map(ratio => {
    const spend = inp.spend * ratio;
    const scenarioInput = { ...inp, spend, cpm: scaledCPM(inp.cpm, ratio) };
    const r = compute(scenarioInput);
    return {
      ratio,
      spend,
      profit: r.dailyProfit,
      deltaVsCurrent: r.dailyProfit - currentProfit, // diminishing-returns cue
      roas: r.roas,
      marginalRoas: marginalRoasAt(inp, spend), // ROAS on the next $ here
      state: health(r),          // green | amber | red
      isCurrent: ratio === 1,
      cpmUsed: scenarioInput.cpm,
    };
  });
}

// Smooth profit-vs-spend curve for the chart. Samples spend from 0 to the top
// tier (current × max ratio), applying the same CPM-creep model so the curve
// matches the tier cards. Returns { points:[{spend,profit}], current, maxSpend,
// maxProfit, minProfit }.
export function profitCurve(inp, n = 48) {
  const r = ratiosFor(inp);
  const maxSpend = inp.spend * r[r.length - 1];
  const points = [];
  let maxProfit = -Infinity, minProfit = Infinity;
  for (let i = 0; i <= n; i++) {
    const spend = (maxSpend * i) / n;
    const ratio = inp.spend > 0 ? spend / inp.spend : 0;
    const profit = compute({ ...inp, spend, cpm: scaledCPM(inp.cpm, ratio) }).dailyProfit;
    points.push({ spend, profit });
    if (profit > maxProfit) maxProfit = profit;
    if (profit < minProfit) minProfit = profit;
  }
  return { points, current: inp.spend, maxSpend, maxProfit, minProfit };
}

// Goal-seek: cheapest daily spend that reaches a target daily profit. Profit
// vs spend is NOT monotonic (CPM creep + rising CAC eventually bend it down),
// so we scan the whole range rather than binary-search, then refine locally.
export function solveSpend(inp, targetProfit, n = 240) {
  const maxSpend = scenarioMaxSpend(inp) * 1.5; // search a bit past top tier
  const at = s => {
    const ratio = inp.spend > 0 ? s / inp.spend : 0;
    return compute({ ...inp, spend: s, cpm: scaledCPM(inp.cpm, ratio) });
  };
  let best = null, peak = { profit: -Infinity, spend: 0 };
  for (let i = 1; i <= n; i++) {
    const s = (maxSpend * i) / n;
    const p = at(s).dailyProfit;
    if (p > peak.profit) peak = { profit: p, spend: s };
    if (p >= targetProfit && !best) { best = s; break; }
  }
  if (best == null) {
    return { reachable: false, peakProfit: peak.profit, peakSpend: peak.spend };
  }
  // Refine between the previous step and the hit for a tighter spend.
  let lo = Math.max(0, best - maxSpend / n), hi = best;
  for (let k = 0; k < 30; k++) {
    const mid = (lo + hi) / 2;
    if (at(mid).dailyProfit >= targetProfit) hi = mid; else lo = mid;
  }
  const r = at(hi);
  return { reachable: true, spend: hi, profit: r.dailyProfit, roas: r.roas };
}

// One arbitrary spend point for the draggable "what-if" probe slider. Same
// CPM-creep model as the tiers so the number is consistent with the table.
export function probeScenario(inp, spend) {
  const ratio = inp.spend > 0 ? spend / inp.spend : 0;
  const r = compute({ ...inp, spend, cpm: scaledCPM(inp.cpm, ratio) });
  const cur = compute(inp).dailyProfit;
  return {
    spend, profit: r.dailyProfit, roas: r.roas,
    state: health(r), deltaVsCurrent: r.dailyProfit - cur,
  };
}
