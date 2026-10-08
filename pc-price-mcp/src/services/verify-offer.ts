/**
 * Verify before alerting (roadmap C4/C5). A scrape can be an hour old, and an eBay item can sell or end in that time; a title can also leave
 * out what matters (ECC, module type). Just before a price alert or a "worth a look" list is sent, the best offer is re-read at its source and
 * the alert is held back if the listing is gone, no longer available, or its own item specifics say it does not fit the machine.
 *
 * Only eBay offers can be re-read this way today (the item API states availability and specifics); anything else passes through unchanged.
 * An inconclusive re-read (network error, HTTP 5xx, an unexpected shape) NEVER blocks an alert: a missed alert costs more than a caveat.
 */
import type { PriceRecord } from '../db.js';

export interface ItemReading {
  /** true = available now, false = ended, sold out or removed, null = could not tell. */
  available: boolean | null;
  price: number | null;
  aspects: Record<string, string>;
}

export type Verdict =
  | { ok: true; note?: string; price?: number; aspects?: Record<string, string>; flagsRemoved?: string[]; flagsAdded?: string[] }
  | { ok: false; reason: string; aspects?: Record<string, string> };

export type Reader = (legacyId: string) => Promise<{ status: number; body: Record<string, unknown> | null }>;

export function legacyIdOf(url: string | null): string | null {
  return url?.match(/\/itm\/(?:[^/?#]*\/)?(\d{9,14})/)?.[1] ?? null;
}

/** Defensive parse of a Browse API item: every field optional, nothing assumed. */
export function readItem(body: Record<string, unknown>): ItemReading {
  const aspects: Record<string, string> = {};
  const list = body.localizedAspects;
  if (Array.isArray(list)) {
    for (const a of list as Array<Record<string, unknown>>) {
      if (typeof a?.name === 'string' && a.value != null) aspects[a.name.trim().toLowerCase()] = String(a.value).trim();
    }
  }
  const price = Number((body.price as Record<string, unknown> | undefined)?.value);
  let available: boolean | null = null;
  const est = body.estimatedAvailabilities;
  if (Array.isArray(est) && est.length > 0) {
    const status = String((est[0] as Record<string, unknown>)?.estimatedAvailabilityStatus ?? '').toUpperCase();
    if (status === 'OUT_OF_STOCK') available = false;
    else if (status === 'IN_STOCK' || status === 'LIMITED_STOCK') available = true;
  }
  const end = typeof body.itemEndDate === 'string' ? Date.parse(body.itemEndDate) : NaN;
  if (Number.isFinite(end) && end < Date.now()) available = false;
  return { available, price: Number.isFinite(price) && price > 0 ? price : null, aspects };
}

/** What the seller's own item specifics say about fit. Only a clear statement counts; missing or odd values say nothing. */
export function aspectsVerdict(aspects: Record<string, string>): { ecc: boolean | null; conflict: string | null; eccListed: boolean } {
  const eccRaw = Object.entries(aspects).find(([k]) => /\becc\b|error\s*correct/.test(k))?.[1] ?? '';
  const type = Object.entries(aspects).find(([k]) => /^(type|form factor|memory type|ram type)$/.test(k))?.[1] ?? '';
  let ecc: boolean | null = null;
  if (/non[\s-]?ecc|^no$|^not\s*ecc|unbuffered/i.test(eccRaw)) ecc = false;
  else if (/\becc\b|^yes$|registered/i.test(eccRaw)) ecc = true;
  let conflict: string | null = null;
  if (ecc === true) conflict = 'item specifics say ECC memory; the N5 Air needs non-ECC';
  else if (/^(u-?dimm|dimm|desktop)\b/i.test(type) && !/so-?dimm/i.test(type)) conflict = `item specifics say "${type}", not SO-DIMM`;
  else if (/ddr\s?4\b/i.test(type)) conflict = `item specifics say "${type}", not DDR5`;
  // Seen on a real listing (2026-10-08): the seller's "Memory Features" specific said "ECC Memory" for a kit sold as plain DDR5 SO-DIMM. DDR5 has
  // on-die ECC, so sellers tick it for ordinary modules; it is a caveat to confirm, not proof of ECC modules, so it is a flag and never a block.
  const eccListed = ecc == null && Object.entries(aspects).some(([k, v]) => !/\becc\b|error\s*correct/.test(k) && /\becc\b/i.test(v) && !/non[\s-]?ecc/i.test(v));
  return { ecc, conflict, eccListed };
}

export async function verifyOffer(offer: Pick<PriceRecord, 'url' | 'price' | 'profile_flags' | 'source'>, read: Reader): Promise<Verdict> {
  const id = legacyIdOf(offer.url);
  if (!id || !/ebay/i.test(offer.url ?? '')) return { ok: true };            // not an eBay listing: nothing to re-read
  const r = await read(id);
  if (r.status === 404) return { ok: false, reason: 'the listing is gone (eBay answered not found)' };
  if (!r.body) return { ok: true, note: 'could not re-check the listing just now' };
  const item = readItem(r.body);
  if (item.available === false) return { ok: false, reason: 'the listing has ended or is out of stock', aspects: item.aspects };
  const { ecc, conflict, eccListed } = aspectsVerdict(item.aspects);
  if (conflict) return { ok: false, reason: conflict, aspects: item.aspects };
  const flagsRemoved = ecc === false && (offer.profile_flags ?? '').includes('ecc_unstated') ? ['ecc_unstated'] : [];
  const priceChanged = item.price != null && Math.abs(item.price - offer.price) / offer.price > 0.01;
  const flagsAdded = eccListed && !(offer.profile_flags ?? '').includes('ecc_listed') ? ['ecc_listed'] : [];
  return { ok: true, aspects: item.aspects, flagsRemoved, flagsAdded, ...(priceChanged ? { price: item.price! } : {}),
    ...(priceChanged ? { note: `price is now £${item.price!.toFixed(2)} (was £${offer.price.toFixed(2)})` } : {}) };
}
