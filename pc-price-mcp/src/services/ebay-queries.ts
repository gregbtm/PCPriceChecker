/**
 * Extra eBay queries by manufacturer part number (roadmap C6).
 *
 * A keyword search ("ddr5 so-dimm 64gb") only finds listings whose title says so; a seller who writes "Crucial CT2K32G56C46S5 64GB laptop RAM"
 * is invisible to it. A part number names the product exactly, and the classifier already trusts a known MPN (data/memory-mpns.ts), so
 * searching each one closes that gap. Cost: one call per part number, at most once every `ebay_mpn_every_hours` (default 6) per component,
 * a few dozen calls a day against a 5,000 a day free allowance. `off` disables it; `0` runs on every pass.
 */
import * as db from '../db.js';
import { KNOWN_MPNS } from '../data/memory-mpns.js';
import { PROFILES } from './memory-classifier.js';

const key = (componentId: number) => `ebay_mpn_last:${componentId}`;

export function mpnEveryHours(): number | null {
  const raw = (db.getConfig('ebay_mpn_every_hours') ?? process.env.EBAY_MPN_EVERY_HOURS ?? '6').trim().toLowerCase();
  if (raw === 'off') return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 6;
}

/** Part numbers of the capacities this component's profile accepts; none for a component without a profile. */
export function mpnQueries(component: Pick<db.TrackedComponent, 'profile_id'>): string[] {
  const profile = component.profile_id ? PROFILES[component.profile_id] : undefined;
  if (!profile) return [];
  const sizes = new Set(profile.acceptedTotalsGb.map(x => x.gb));
  return KNOWN_MPNS.filter(k => sizes.has(k.kitGb)).map(k => k.mpn);
}

export function mpnDue(componentId: number, now = Date.now()): boolean {
  const every = mpnEveryHours();
  if (every == null) return false;
  const last = Number(db.getConfig(key(componentId)) ?? 0);
  return now - last >= every * 3_600_000;
}

export function markMpnRun(componentId: number, now = Date.now()): void {
  db.setConfig(key(componentId), String(now));
}
