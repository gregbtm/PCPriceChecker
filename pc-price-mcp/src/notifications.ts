/**
 * Outbound webhook notifications — Discord and Slack.
 * Webhook URLs are stored in the config table (discord_webhook_url, slack_webhook_url).
 */
import * as db from './db.js';

export type NotificationType = 'price_alert' | 'price_drop' | 'restock' | 'test';

export interface NotificationPayload {
  type: NotificationType;
  componentName: string;
  price?: number;
  currency?: string;
  retailer?: string;
  alertThreshold?: number;
  dropAmount?: number;
  dropPercent?: number;
  url?: string | null;
  message?: string;
}

const DISCORD_COLORS: Record<NotificationType, number> = {
  price_alert: 0x00C851, // green
  price_drop:  0x4A90D9, // blue
  restock:     0xFF8800, // orange
  test:        0x9B59B6, // purple
};

const DISCORD_TITLES: Record<NotificationType, string> = {
  price_alert: '🔔 Price Alert Triggered!',
  price_drop:  '📉 Price Drop Detected',
  restock:     '📦 Back In Stock!',
  test:        '🧪 Test Notification',
};

function fmtPrice(amount: number, currency = 'GBP'): string {
  const sym: Record<string, string> = { GBP: '£', USD: '$', EUR: '€' };
  return `${sym[currency] ?? currency + ' '}${amount.toFixed(2)}`;
}

export async function sendDiscord(webhookUrl: string, payload: NotificationPayload): Promise<boolean> {
  const fields: any[] = [{ name: 'Component', value: payload.componentName, inline: true }];

  if (payload.price != null)
    fields.push({ name: 'Price', value: fmtPrice(payload.price, payload.currency), inline: true });
  if (payload.retailer)
    fields.push({ name: 'Retailer', value: payload.retailer, inline: true });
  if (payload.alertThreshold != null)
    fields.push({ name: 'Your Target', value: fmtPrice(payload.alertThreshold), inline: true });
  if (payload.dropAmount != null && payload.dropPercent != null)
    fields.push({ name: 'Saving', value: `${fmtPrice(payload.dropAmount, payload.currency)} (${payload.dropPercent.toFixed(1)}%)`, inline: true });

  const embed: any = {
    title: DISCORD_TITLES[payload.type],
    color: DISCORD_COLORS[payload.type],
    fields,
    timestamp: new Date().toISOString(),
    footer: { text: 'UK PC Price MCP' },
  };
  if (payload.url) embed.description = `[View product](${payload.url})`;
  if (payload.message) embed.description = (embed.description ? embed.description + '\n' : '') + payload.message;

  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'PC Price Alert', embeds: [embed] }),
      signal: AbortSignal.timeout(8_000),
    });
    return res.ok;
  } catch { return false; }
}

export async function sendSlack(webhookUrl: string, payload: NotificationPayload): Promise<boolean> {
  const sym = (payload.currency === 'GBP' || !payload.currency) ? '£' : `${payload.currency} `;
  let text = '';
  switch (payload.type) {
    case 'price_alert':
      text = `🔔 *Price Alert:* ${payload.componentName} is *${sym}${payload.price?.toFixed(2)}* at ${payload.retailer}` +
        (payload.alertThreshold ? ` (target: ${sym}${payload.alertThreshold.toFixed(2)})` : '');
      break;
    case 'price_drop':
      text = `📉 *Price Drop:* ${payload.componentName} fell ${sym}${payload.dropAmount?.toFixed(2)} (${payload.dropPercent?.toFixed(1)}%) at ${payload.retailer} → now *${sym}${payload.price?.toFixed(2)}*`;
      break;
    case 'restock':
      text = `📦 *Back In Stock:* ${payload.componentName} at ${payload.retailer}` +
        (payload.price ? ` — *${sym}${payload.price.toFixed(2)}*` : '');
      break;
    case 'test':
      text = `🧪 *Test notification* from UK PC Price MCP — webhooks are working!`;
      break;
  }
  if (payload.message) text += `\n${payload.message}`;
  if (payload.url) text += `\n<${payload.url}>`;

  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(8_000),
    });
    return res.ok;
  } catch { return false; }
}

export async function notifyAll(payload: NotificationPayload): Promise<{ discord: boolean; slack: boolean }> {
  const discordUrl = db.getConfig('discord_webhook_url');
  const slackUrl = db.getConfig('slack_webhook_url');

  const [discord, slack] = await Promise.all([
    discordUrl ? sendDiscord(discordUrl, payload) : Promise.resolve(false),
    slackUrl ? sendSlack(slackUrl, payload) : Promise.resolve(false),
  ]);

  return { discord, slack };
}
