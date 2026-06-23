// Calculates a deal score (0–100) from existing price history.
// 100 = at or near all-time low. 0 = at or near all-time high.

import * as db from '../db.js';

export interface DealScore {
  componentId: number;
  componentName: string;
  currentBestPrice: number | null;
  allTimeLow: number | null;
  allTimeHigh: number | null;
  avg30d: number | null;
  score: number | null;         // 0–100, null if insufficient history
  label: string;
  vsAvg30dPercent: number | null;
  vsAllTimeLowPercent: number | null;
  dataPoints: number;
  recommendation: string;
}

export function calculateDealScore(componentId: number): DealScore {
  const comp = db.getTrackedComponentById(componentId);
  const stats = db.getPriceStats(componentId);
  const latest = db.getLatestPricePerRetailer(componentId);
  const currentBest = latest[0]?.price ?? null;

  const base: Omit<DealScore, 'score' | 'label' | 'recommendation'> = {
    componentId,
    componentName: comp?.name ?? `Component #${componentId}`,
    currentBestPrice: currentBest,
    allTimeLow: stats.all_time_low,
    allTimeHigh: stats.all_time_high,
    avg30d: stats.avg_30d,
    vsAvg30dPercent: null,
    vsAllTimeLowPercent: null,
    dataPoints: stats.total_records,
  };

  if (currentBest == null || stats.all_time_low == null || stats.all_time_high == null || stats.total_records < 3) {
    return { ...base, score: null, label: 'Insufficient data', recommendation: 'Not enough price history yet. Check back after a few refreshes.' };
  }

  // Normalise: 100 = at all-time low, 0 = at all-time high
  const range = stats.all_time_high - stats.all_time_low;
  let score = range > 0
    ? Math.round(100 * (stats.all_time_high - currentBest) / range)
    : 50;
  score = Math.max(0, Math.min(100, score));

  const vsAvg30d = stats.avg_30d
    ? Math.round((stats.avg_30d - currentBest) / stats.avg_30d * 100)
    : null;
  const vsAtl = Math.round((currentBest - stats.all_time_low) / stats.all_time_low * 100);

  let label: string;
  let recommendation: string;
  if (score >= 90) {
    label = 'Excellent deal';
    recommendation = `At or near the all-time low (£${stats.all_time_low}). Buy now if you need it.`;
  } else if (score >= 70) {
    label = 'Good deal';
    recommendation = `Below the 30-day average. Solid time to buy.`;
  } else if (score >= 50) {
    label = 'Fair price';
    recommendation = 'Close to average. Not a steal but not overpriced.';
  } else if (score >= 30) {
    label = 'Slightly elevated';
    recommendation = 'Above average — prices have come down before. Consider waiting.';
  } else {
    label = 'High price';
    recommendation = `Well above average. All-time low was £${stats.all_time_low}. Worth waiting unless urgent.`;
  }

  return {
    ...base,
    score,
    label,
    vsAvg30dPercent: vsAvg30d,
    vsAllTimeLowPercent: vsAtl,
    recommendation,
  };
}

export function getDealScoresForAll(): DealScore[] {
  return db.getTrackedComponents()
    .map(c => calculateDealScore(c.id))
    .filter(d => d.score !== null)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
}
