// Display formatting only. Internal math stays full-precision (see calc.js).

let symbol = '$';
export function setCurrency(sym) { symbol = sym; }
export function getCurrency() { return symbol; }

export function money(n) {
  if (!isFinite(n)) return '—';
  const neg = n < 0;
  const s = Math.abs(n).toLocaleString(undefined, {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  });
  return (neg ? '-' : '') + symbol + s;
}

export function money0(n) {
  if (!isFinite(n)) return '—';
  const neg = n < 0;
  const s = Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 0 });
  return (neg ? '-' : '') + symbol + s;
}

// Signed, whole-number money for deltas: +$784 / -$120 / $0.
export function moneySigned(n) {
  if (!isFinite(n)) return '—';
  const sign = n > 0 ? '+' : n < 0 ? '-' : '';
  const s = Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 0 });
  return sign + symbol + s;
}

export function num(n, dp = 1) {
  if (!isFinite(n)) return '—';
  return n.toLocaleString(undefined, {
    minimumFractionDigits: dp, maximumFractionDigits: dp,
  });
}

export function pct(n, dp = 2) {
  if (!isFinite(n)) return '—';
  return n.toFixed(dp) + '%';
}

export function roas(n) {
  if (!isFinite(n)) return '—';
  return n.toFixed(2) + 'x';
}
