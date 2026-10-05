import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as db from '../db.js';
import { evaluateAlerts } from './alerts.js';

// Listing titles are real Scan.co.uk fixtures from docs/RESEARCH_AND_VERIFICATION.md section 2.
const KIT_NAME = '64GB (2x32GB) CORSAIR DDR5 Vengeance SODIMM, PC5-41600 (5200), Non-ECC Unbuffered, CAS 44, 1.1V';

function seed() {
  const raw = db.getDb();
  raw.exec('DELETE FROM price_records; DELETE FROM tracked_components;');
  db.addTrackedComponent(KIT_NAME, 'ram', 'ddr5 so-dimm 64gb', 900);
  return db.getTrackedComponents()[0];
}

function snap(retailer: string, price: number, inStock: boolean, stockState?: db.StockState): db.PriceSnapshot {
  return { source: 'test', price, currency: 'GBP', retailer, url: `https://${retailer}.example/kit`, inStock, stockState };
}

describe('A-01: alerts must be based on in-stock offers only', () => {
  let component: db.TrackedComponent;
  beforeEach(() => { component = seed(); });

  it('does not fire a price alert when only the cheaper listing is out of stock', async () => {
    db.savePriceSnapshots(component.id, [
      snap('cheap-oos.co.uk', 199.99, false),
      snap('scan.co.uk', 893.99 + 100, true),   // in stock but above the 900 target
    ]);
    const notify = vi.fn().mockResolvedValue({});
    await evaluateAlerts({ component, prevBestPrice: null, dropThresholdPct: 5, notify });
    expect(notify).not.toHaveBeenCalled();
  });

  it('does not fire when the only listing under target is out of stock', async () => {
    db.savePriceSnapshots(component.id, [snap('cheap-oos.co.uk', 199.99, false)]);
    const notify = vi.fn().mockResolvedValue({});
    await evaluateAlerts({ component, prevBestPrice: null, dropThresholdPct: 5, notify });
    expect(notify).not.toHaveBeenCalled();
  });

  it('still fires, naming the in-stock retailer, when an in-stock listing is under target', async () => {
    db.savePriceSnapshots(component.id, [
      snap('cheap-oos.co.uk', 199.99, false),
      snap('scan.co.uk', 893.99, true),
    ]);
    const notify = vi.fn().mockResolvedValue({});
    await evaluateAlerts({ component, prevBestPrice: null, dropThresholdPct: 5, notify });
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][0]).toMatchObject({ type: 'price_alert', retailer: 'scan.co.uk', price: 893.99 });
  });
});
