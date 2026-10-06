/**
 * Quiet hours (P4-2): config `quiet_hours` as "HH:MM-HH:MM" in the container's local time (TZ), e.g. "22:00-07:00".
 * Unset or unparseable means no quiet hours (an invalid value must never silence alerts). While quiet, alerts are not
 * sent and no alert state is recorded, so anything still true at the first pass afterwards is sent then.
 */
import * as db from '../db.js';

export function parseQuietHours(raw: string | null | undefined): { start: number; end: number } | null {
  const m = /^\s*(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})\s*$/.exec(raw ?? '');
  if (!m) return null;
  const [sh, sm, eh, em] = m.slice(1).map(Number);
  if (sh > 23 || eh > 23 || sm > 59 || em > 59) return null;
  const start = sh * 60 + sm, end = eh * 60 + em;
  return start === end ? null : { start, end };
}

export function inQuietHours(now: Date | number = Date.now(), raw: string | null | undefined = db.getConfig('quiet_hours')): boolean {
  const q = parseQuietHours(raw);
  if (!q) return false;
  const d = typeof now === 'number' ? new Date(now) : now;
  const mins = d.getHours() * 60 + d.getMinutes();
  return q.start < q.end ? mins >= q.start && mins < q.end : mins >= q.start || mins < q.end;
}
