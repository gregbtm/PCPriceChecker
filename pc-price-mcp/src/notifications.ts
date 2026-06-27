/**
 * Outbound webhook notifications — Discord and Slack.
 * Webhook URLs are stored in the config table (discord_webhook_url, slack_webhook_url).
 */
import * as db from './db.js';

export type NotificationType = 'price_alert' | 'price_drop' | 'restock' | 'test' | 'saved_search';

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
  price_alert:   0x00C851,
  price_drop:    0x4A90D9,
  restock:       0xFF8800,
  test:          0x9B59B6,
  saved_search:  0xF59E0B,
};

const DISCORD_TITLES: Record<NotificationType, string> = {
  price_alert:   '🔔 Price Alert Triggered!',
  price_drop:    '📉 Price Drop Detected',
  restock:       '📦 Back In Stock!',
  test:          '🧪 Test Notification',
  saved_search:  '🔍 Saved Search Match!',
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

// ── Telegram ───────────────────────────────────────────────────────────────

export async function sendTelegram(botToken: string, chatId: string, payload: NotificationPayload): Promise<boolean> {
  const sym = payload.currency === 'GBP' ? '£' : (payload.currency ?? '£');
  let text = `*${DISCORD_TITLES[payload.type]}*\n\n*${payload.componentName}*`;
  if (payload.price != null) text += `\nPrice: *${sym}${payload.price.toFixed(2)}*`;
  if (payload.retailer)      text += ` at ${payload.retailer}`;
  if (payload.alertThreshold != null) text += `\nTarget: ${sym}${payload.alertThreshold.toFixed(2)}`;
  if (payload.dropAmount != null && payload.dropPercent != null)
    text += `\nSaving: ${sym}${payload.dropAmount.toFixed(2)} (${payload.dropPercent.toFixed(1)}% off)`;
  if (payload.message) text += `\n${payload.message}`;
  if (payload.url)     text += `\n[View product](${payload.url})`;

  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown', disable_web_page_preview: true }),
      signal: AbortSignal.timeout(8_000),
    });
    return res.ok;
  } catch { return false; }
}

// ── Email via Resend ────────────────────────────────────────────────────────

export async function sendEmail(resendApiKey: string, toEmail: string, payload: NotificationPayload): Promise<boolean> {
  const sym = payload.currency === 'GBP' ? '£' : (payload.currency ?? '£');
  const title = DISCORD_TITLES[payload.type];

  let bodyRows = `<tr><td style="padding:4px 8px;color:#9ca3af">Component</td><td style="padding:4px 8px;color:#fff;font-weight:600">${payload.componentName}</td></tr>`;
  if (payload.price != null)
    bodyRows += `<tr><td style="padding:4px 8px;color:#9ca3af">Price</td><td style="padding:4px 8px;color:#34d399;font-weight:700">${sym}${payload.price.toFixed(2)}</td></tr>`;
  if (payload.retailer)
    bodyRows += `<tr><td style="padding:4px 8px;color:#9ca3af">Retailer</td><td style="padding:4px 8px;color:#fff">${payload.retailer}</td></tr>`;
  if (payload.alertThreshold != null)
    bodyRows += `<tr><td style="padding:4px 8px;color:#9ca3af">Your target</td><td style="padding:4px 8px;color:#fbbf24">${sym}${payload.alertThreshold.toFixed(2)}</td></tr>`;
  if (payload.dropAmount != null && payload.dropPercent != null)
    bodyRows += `<tr><td style="padding:4px 8px;color:#9ca3af">Saving</td><td style="padding:4px 8px;color:#60a5fa">${sym}${payload.dropAmount.toFixed(2)} (${payload.dropPercent.toFixed(1)}%)</td></tr>`;

  const html = `<!DOCTYPE html><html><body style="background:#111827;font-family:sans-serif;padding:24px">
<div style="max-width:480px;margin:0 auto;background:#1f2937;border-radius:12px;padding:24px;border:1px solid #374151">
  <h2 style="color:#fff;margin:0 0 16px">${title}</h2>
  <table style="width:100%;border-collapse:collapse">${bodyRows}</table>
  ${payload.message ? `<p style="color:#d1d5db;margin-top:12px">${payload.message}</p>` : ''}
  ${payload.url ? `<a href="${payload.url}" style="display:inline-block;margin-top:16px;padding:10px 20px;background:#2563eb;color:#fff;border-radius:8px;text-decoration:none">View Product →</a>` : ''}
  <p style="color:#6b7280;font-size:11px;margin-top:20px">UK PC Price MCP</p>
</div></body></html>`;

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${resendApiKey}` },
      body: JSON.stringify({
        from: 'PC Price Alerts <alerts@resend.dev>',
        to: [toEmail],
        subject: `${title} — ${payload.componentName}`,
        html,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    return res.ok;
  } catch { return false; }
}

// ── notifyAll ───────────────────────────────────────────────────────────────

export async function notifyAll(payload: NotificationPayload): Promise<{ discord: boolean; slack: boolean; telegram: boolean; email: boolean }> {
  const discordUrl    = db.getConfig('discord_webhook_url');
  const slackUrl      = db.getConfig('slack_webhook_url');
  const tgToken       = db.getConfig('telegram_bot_token');
  const tgChatId      = db.getConfig('telegram_chat_id');
  const resendKey     = db.getConfig('resend_api_key');
  const alertEmail    = db.getConfig('alert_email');

  const [discord, slack, telegram, email] = await Promise.all([
    discordUrl              ? sendDiscord(discordUrl, payload)              : Promise.resolve(false),
    slackUrl                ? sendSlack(slackUrl, payload)                  : Promise.resolve(false),
    tgToken && tgChatId     ? sendTelegram(tgToken, tgChatId, payload)      : Promise.resolve(false),
    resendKey && alertEmail ? sendEmail(resendKey, alertEmail, payload)     : Promise.resolve(false),
  ]);

  return { discord, slack, telegram, email };
}
