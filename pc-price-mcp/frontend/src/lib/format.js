export function fmtDate(dt) {
  if (!dt) return '';
  const d = new Date(String(dt).endsWith('Z') ? dt : dt + 'Z');
  return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}
