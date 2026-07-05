export function fmtDate(dt) {
  if (!dt) return '';
  const d = new Date(String(dt).endsWith('Z') ? dt : dt + 'Z');
  return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export const CURRENCY_SYMS = { GBP: '£', USD: '$', EUR: '€' };

export function fmtPrice(amount, currency = 'GBP', vatMode = 'inc_vat') {
  if (amount == null) return '—';
  const sym = CURRENCY_SYMS[currency] ?? (currency + ' ');
  const v = vatMode === 'ex_vat' ? amount / 1.2 : amount;
  return sym + v.toFixed(2);
}
