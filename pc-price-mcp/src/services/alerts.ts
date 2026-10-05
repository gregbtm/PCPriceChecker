/**
 * Alert decision logic extracted from the scheduler so it can be tested
 * against a seeded database without any network access.
 */
import * as db from '../db.js';
import { notifyAll } from '../notifications.js';

type Notify = typeof notifyAll;

export interface AlertContext {
  component: db.TrackedComponent;
  prevBestPrice: number | null;
  dropThresholdPct: number;
  notify?: Notify;
}

/** Evaluate target-price and price-drop alerts after fresh snapshots were saved. */
export async function evaluateAlerts(ctx: AlertContext): Promise<void> {
  const { component, prevBestPrice, dropThresholdPct } = ctx;
  const notify = ctx.notify ?? notifyAll;

  const newBest = db.getBestInStockOffer(component.id);
  if (!newBest) return;

  if (component.alert_price != null && newBest.price <= component.alert_price
      && db.shouldSendAlert(component.id, 1440)) {
    await notify({ type: 'price_alert', componentName: component.name,
      price: newBest.price, currency: newBest.currency, retailer: newBest.retailer,
      alertThreshold: component.alert_price, url: newBest.url });
    db.markLastAlerted(component.id);
  }

  if (prevBestPrice != null && newBest.price < prevBestPrice) {
    const dropPct = ((prevBestPrice - newBest.price) / prevBestPrice) * 100;
    if (dropPct >= dropThresholdPct && db.shouldSendAlert(component.id, 360)) {
      await notify({ type: 'price_drop', componentName: component.name,
        price: newBest.price, currency: newBest.currency, retailer: newBest.retailer,
        dropAmount: prevBestPrice - newBest.price, dropPercent: dropPct, url: newBest.url });
      db.markLastAlerted(component.id);
    }
  }
}
