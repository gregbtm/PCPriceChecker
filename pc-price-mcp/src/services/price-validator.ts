import type { PriceSnapshot } from '../db.js';

export interface ValidatedSnapshot extends PriceSnapshot {
  isOutlier: boolean;
  confidence: number;   // 0–1: how close to consensus price
  zScore: number;       // Modified Z-score (MAD-based)
}

export interface ValidationReport {
  totalCount: number;
  validCount: number;
  outlierCount: number;
  consensusPrice: number | null;  // median of non-outlier prices
  medianAllPrice: number | null;  // median of all prices (pre-filter)
  sourceSummary: Array<{
    source: string;
    retailer: string;
    price: number;
    confidence: number;
    isOutlier: boolean;
    zScore: number;
  }>;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Modified Z-score using Median Absolute Deviation (MAD).
 * More robust than standard Z-score — a single extreme outlier can't inflate
 * the standard deviation and mask itself.
 *
 * Formula: Mi = 0.6745 * (xi - median) / MAD
 * Flag when |Mi| > 3.5 (equivalent to ~4σ in a normal distribution).
 */
export function validatePrices(snapshots: PriceSnapshot[]): ValidatedSnapshot[] {
  if (snapshots.length === 0) return [];
  if (snapshots.length === 1) {
    return [{ ...snapshots[0], isOutlier: false, confidence: 1.0, zScore: 0 }];
  }

  const prices = snapshots.map(s => s.price);
  const med = median(prices);
  const deviations = prices.map(p => Math.abs(p - med));
  const mad = median(deviations);

  return snapshots.map(s => {
    const zScore = mad === 0 ? 0 : 0.6745 * Math.abs(s.price - med) / mad;
    const isOutlier = zScore > 3.5;
    // Confidence: how close is this price to the consensus median?
    // A 50%+ deviation from median gives 0 confidence; 0% deviation gives 1.0.
    const deviation = med > 0 ? Math.abs(s.price - med) / med : 0;
    const confidence = Math.max(0, Math.round((1 - 2 * deviation) * 100) / 100);
    return {
      ...s,
      isOutlier,
      confidence,
      zScore: Math.round(zScore * 1000) / 1000,
    };
  });
}

export function getPriceValidationReport(snapshots: PriceSnapshot[]): ValidationReport {
  const validated = validatePrices(snapshots);
  const valid = validated.filter(v => !v.isOutlier);
  const rawPrices = snapshots.map(s => s.price);
  const consensusPrices = valid.map(v => v.price);

  const round2 = (n: number | null) => n != null ? Math.round(n * 100) / 100 : null;

  return {
    totalCount: validated.length,
    validCount: valid.length,
    outlierCount: validated.length - valid.length,
    consensusPrice: round2(consensusPrices.length > 0 ? median(consensusPrices) : null),
    medianAllPrice: round2(rawPrices.length > 0 ? median(rawPrices) : null),
    sourceSummary: validated.map(v => ({
      source: v.source,
      retailer: v.retailer,
      price: v.price,
      confidence: v.confidence,
      isOutlier: v.isOutlier,
      zScore: v.zScore,
    })),
  };
}
