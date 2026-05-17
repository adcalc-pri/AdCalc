// Pure unit-economics math engine. No DOM, no rounding — full float precision.
// Every display element in the UI is downstream of compute().

export function deriveCPC({ mode, cpm, ctr, cpc }) {
  // CTR comes in as a percentage (1.8 => 1.8%). Convert to fraction.
  if (mode === 'cpc') return cpc;
  const ctrFrac = ctr / 100;
  if (ctrFrac <= 0 || cpm <= 0) return 0;
  return (cpm / 1000) * (1 / ctrFrac); // (CPM/1000) × (1/CTR)
}

// inputs: { price, cogs, shipping, processing, refund, otherFees,
//           spend, mode, cpm, ctr, cpc, cvr, aov, upsell,
//           targetProfit, newPct, newVisPct, otherSpend, otherRevenue,
//           attrCapture, ordersPerYear, retentionM, tierMax }
// processing/refund/cvr/ctr/targetProfit/newPct/newVisPct/attrCapture are
// percentages as typed. targetProfit/otherSpend/otherRevenue default to 0
// (neutral); newPct/newVisPct/attrCapture default to 100 when absent. A click
// is treated as a visitor (this is a prospective model — no session pixel).
export function compute(inp) {
  const revenuePerOrder = (inp.aov && inp.aov > 0 ? inp.aov : inp.price) + (inp.upsell || 0);

  const cpc = deriveCPC(inp);
  const cvrFrac = inp.cvr / 100;

  const clicks = cpc > 0 ? inp.spend / cpc : 0;
  const orders = clicks * cvrFrac;

  const processingCost = revenuePerOrder * (inp.processing / 100);
  const grossMargin = revenuePerOrder - inp.cogs - inp.shipping - processingCost;
  const refundCost = grossMargin * (inp.refund / 100);
  const netMargin = grossMargin - refundCost - (inp.otherFees || 0);

  const cac = orders > 0 ? inp.spend / orders : 0;
  const netProfitPerOrder = netMargin - cac;
  const dailyProfit = netProfitPerOrder * orders;

  const dailyRevenue = orders * revenuePerOrder;
  const roas = inp.spend > 0 ? dailyRevenue / inp.spend : 0;
  const breakevenRoas = netMargin > 0 ? revenuePerOrder / netMargin : Infinity;

  const contribution = revenuePerOrder - inp.cogs - inp.shipping; // for breakeven CVR
  const breakevenCvr = contribution > 0 && clicks > 0
    ? (cac * orders) / contribution / clicks // = spend / (contribution × clicks)
    : 0;

  // --- Profit-target benchmarks (goal-seek, not breakeven) ---
  // Max cost per order that still leaves the desired net profit per order.
  // netProfitPerOrder = netMargin − CAC, so CAC ceiling = netMargin − target.
  const targetProfitPerOrder = revenuePerOrder * ((inp.targetProfit || 0) / 100);
  const targetCpo = netMargin - targetProfitPerOrder; // also the target CAC
  const targetRoas = targetCpo > 0 ? revenuePerOrder / targetCpo : Infinity;
  const targetDailyProfit = targetProfitPerOrder * orders; // chart goalpost

  // --- Contribution margin & breakeven AOV ---
  // Contribution margin/order = what each order contributes before ad cost
  // (this is netMargin: revenue less every variable cost but CAC). CAC then
  // eats into it; netProfitPerOrder = contributionMargin − CAC.
  const contributionMargin = netMargin;
  // Breakeven AOV: the minimum revenue/order that zeroes net profit at the
  // current CAC, processing% and refund%. Invert the margin chain:
  //   net = [rev(1−p) − COGS − Ship](1−refund) − otherFees = CAC
  const p = inp.processing / 100;
  const rf = inp.refund / 100;
  const breakevenAov = (1 - p) > 0 && (1 - rf) > 0 && isFinite(cac)
    ? (((cac + (inp.otherFees || 0)) / (1 - rf)) + inp.cogs + inp.shipping) / (1 - p)
    : Infinity;

  // --- New vs. returning customers ---
  // Ad spend is treated as the cost of acquiring NEW customers, so new-customer
  // CAC is always >= blended CAC. newPct is the share of orders that are new.
  const newPct = inp.newPct == null ? 100 : inp.newPct;
  const newOrders = orders * (newPct / 100);
  const returningOrders = orders - newOrders;
  const newCustomerCac = newOrders > 0 ? inp.spend / newOrders : 0;
  const newCustomerRoas = inp.spend > 0
    ? (newOrders * revenuePerOrder) / inp.spend : 0;

  // --- Per-visitor economics (a click ≈ a visitor here) ---
  // Northbeam 3.0: CPV applies to all visitors; RPV split new vs. returning.
  const cpv = clicks > 0 ? inp.spend / clicks : 0;
  const rpvAll = clicks > 0 ? dailyRevenue / clicks : 0;
  const newVisPct = inp.newVisPct == null ? 100 : inp.newVisPct;
  const newVisitors = clicks * (newVisPct / 100);
  const returningVisitors = clicks - newVisitors;
  const newRevenue = newOrders * revenuePerOrder;
  const returningRevenue = returningOrders * revenuePerOrder;
  const rpvNew = newVisitors > 0 ? newRevenue / newVisitors : 0;
  const rpvReturning = returningVisitors > 0
    ? returningRevenue / returningVisitors : 0;

  // --- MER: blended efficiency across this campaign + other channels ---
  const otherSpend = inp.otherSpend || 0;
  const otherRevenue = inp.otherRevenue || 0;
  const blendedSpend = inp.spend + otherSpend;
  const mer = blendedSpend > 0
    ? (dailyRevenue + otherRevenue) / blendedSpend : 0;

  // --- Attribution capture: platform-reported vs. true numbers ---
  // attrCapture = % of true conversions the ad platform attributes given the
  // lookback window. Reported ROAS scales with it; reported CAC inflates.
  const attr = (inp.attrCapture == null ? 100 : inp.attrCapture) / 100;
  const reportedRoas = roas * attr;
  const reportedCac = attr > 0 ? cac / attr : Infinity;

  // --- Customer LTV & CAC payback ---
  // Naive: flat annual gross-margin value (ordersPerYear, defaults to 1).
  const ordersPerYear = inp.ordersPerYear == null ? 1 : inp.ordersPerYear;
  const cltv = grossMargin * ordersPerYear;
  const monthlyMargin = grossMargin * (ordersPerYear / 12);
  const paybackMonths = monthlyMargin > 0
    ? newCustomerCac / monthlyMargin : Infinity;

  // Cohort retention model — the honest LTV. retentionM is the monthly
  // repeat-purchase probability (%). A customer contributes grossMargin in
  // the acquisition month (k=0) and ret^k in month k (geometric survival).
  // 12-month LTV = grossMargin × Σ ret^k for k=0..11. Cohort payback = first
  // month the cumulative per-customer margin clears new-customer CAC.
  const ret = Math.min(0.99, Math.max(0, (inp.retentionM || 0) / 100));
  let cum = 0, cohortPayback = Infinity, ltv12 = 0;
  for (let k = 0; k < 12; k++) {
    ltv12 += grossMargin * Math.pow(ret, k);
  }
  for (let k = 0; k < 60; k++) {
    cum += grossMargin * Math.pow(ret, k);
    if (cohortPayback === Infinity && cum >= newCustomerCac) cohortPayback = k;
  }
  // Surface the retention-aware figures when retention is set, else the naive.
  const usingRetention = (inp.retentionM || 0) > 0;
  const effectiveLtv = usingRetention ? ltv12 : cltv;
  const effectivePayback = usingRetention ? cohortPayback : paybackMonths;

  // Headroom of the typed CVR over the breakeven CVR (percentage points).
  const cvrHeadroom = inp.cvr - breakevenCvr * 100;

  return {
    cpc, clicks, orders, cac,
    grossMargin, netMargin,
    netProfitPerOrder, dailyProfit,
    revenuePerOrder, dailyRevenue, roas, breakevenRoas,
    breakevenCvr: breakevenCvr * 100, // back to a percentage for display
    targetCpo, targetRoas, targetDailyProfit,
    contributionMargin, breakevenAov,
    newOrders, returningOrders, newCustomerCac, newCustomerRoas,
    cpv, rpvAll, rpvNew, rpvReturning,
    cltv, paybackMonths, cvrHeadroom,
    ltv12, cohortPayback, effectiveLtv, effectivePayback,
    mer, reportedRoas, reportedCac,
    monthlyRevenue: dailyRevenue * 30,
    monthlySpend: inp.spend * 30,
    monthlyNetProfit: dailyProfit * 30,
  };
}

// Health classification used for the color coding (green/amber/red).
export function health(r) {
  if (r.netProfitPerOrder <= 0 || r.dailyProfit <= 0) return 'red';
  if (r.roas <= r.breakevenRoas) return 'red';
  if (r.roas <= r.breakevenRoas * 1.2) return 'amber'; // within 20% of breakeven
  return 'green';
}
