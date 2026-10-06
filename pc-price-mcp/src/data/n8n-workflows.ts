/**
 * n8n workflow definitions the dashboard offers for download/import (HANDOFF 9q). Built on request so the app's own
 * address and the configured ntfy topic are filled in. The shapes follow n8n's exported-workflow format and the node
 * versions of the repo's earlier example; **none has been imported into a running n8n** (Unverified), so a node version may
 * need adjusting on import. The app never writes into n8n's database; these are plain JSON files the owner imports.
 */
export interface N8nWorkflow { name: string; nodes: unknown[]; connections: Record<string, unknown>; settings: Record<string, unknown> }

export interface N8nInfo { id: string; title: string; description: string }

export const N8N_WORKFLOWS: N8nInfo[] = [
  { id: 'webhook-to-ntfy', title: 'Alerts: webhook to ntfy', description: 'The app pushes every alert to an n8n webhook; n8n forwards price alerts to ntfy (or add your own routing).' },
  { id: 'health-digest', title: 'Daily scraper health digest', description: 'Every morning n8n asks the app for failing sources and sends an ntfy message only when something is failing.' },
  { id: 'deals-digest', title: 'Daily deals digest', description: 'Every morning n8n lists components currently at or below their alert price and sends the list to ntfy.' },
];

const ntfyNode = (ntfyUrl: string, title: string, body: string, position: [number, number]) => ({
  parameters: {
    method: 'POST', url: ntfyUrl, sendHeaders: true,
    headerParameters: { parameters: [{ name: 'Title', value: title }] },
    sendBody: true, contentType: 'raw', rawContentType: 'text/plain', body, options: {},
  },
  name: 'Send to ntfy', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position,
});

const schedule = (cron: string) => ({
  parameters: { rule: { interval: [{ field: 'cronExpression', expression: cron }] } },
  name: 'Every morning', type: 'n8n-nodes-base.scheduleTrigger', typeVersion: 1.2, position: [0, 0],
});

const getApp = (url: string, name: string) => ({
  parameters: { method: 'GET', url, options: {} },
  name, type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [240, 0],
});

const ifNode = (left: string, name: string) => ({
  parameters: {
    conditions: {
      options: { caseSensitive: true, typeValidation: 'loose' },
      conditions: [{ leftValue: left, rightValue: 0, operator: { type: 'number', operation: 'gt' } }],
      combinator: 'and',
    },
    options: {},
  },
  name, type: 'n8n-nodes-base.if', typeVersion: 2, position: [480, 0],
});

export function buildN8nWorkflow(id: string, appBase: string, ntfyUrl: string): N8nWorkflow | null {
  const base = appBase.replace(/\/+$/, '');
  if (id === 'webhook-to-ntfy') {
    return {
      name: 'PCPriceChecker: webhook to ntfy',
      nodes: [
        { parameters: { httpMethod: 'POST', path: 'pcpc', authentication: 'headerAuth', options: {} },
          name: 'PCPriceChecker webhook', type: 'n8n-nodes-base.webhook', typeVersion: 2, position: [0, 0], webhookId: 'pcpc-alerts' },
        { parameters: { conditions: { options: { caseSensitive: true, typeValidation: 'loose' },
            conditions: [{ leftValue: '={{ $json.body.event }}', rightValue: 'price_alert', operator: { type: 'string', operation: 'equals' } }],
            combinator: 'and' }, options: {} },
          name: 'Is price alert?', type: 'n8n-nodes-base.if', typeVersion: 2, position: [240, 0] },
        ntfyNode(ntfyUrl, "={{ 'In stock under target: ' + $json.body.componentName }}",
          "={{ '£' + $json.body.price + ' at ' + $json.body.retailer + ' (target £' + $json.body.alertThreshold + ')\\n' + ($json.body.message || '') }}", [480, -80]),
      ],
      connections: {
        'PCPriceChecker webhook': { main: [[{ node: 'Is price alert?', type: 'main', index: 0 }]] },
        'Is price alert?': { main: [[{ node: 'Send to ntfy', type: 'main', index: 0 }], []] },
      },
      settings: {},
    };
  }
  if (id === 'health-digest') {
    return {
      name: 'PCPriceChecker: daily scraper health digest',
      nodes: [
        schedule('15 7 * * *'),
        getApp(`${base}/api/health`, 'Get app health'),
        ifNode('={{ $json.scrapers.failing.length }}', 'Any source failing?'),
        ntfyNode(ntfyUrl, 'PCPriceChecker: scrapers failing', "={{ 'Failing 3+ times in a row: ' + $json.scrapers.failing.join(', ') }}", [720, -80]),
      ],
      connections: {
        'Every morning': { main: [[{ node: 'Get app health', type: 'main', index: 0 }]] },
        'Get app health': { main: [[{ node: 'Any source failing?', type: 'main', index: 0 }]] },
        'Any source failing?': { main: [[{ node: 'Send to ntfy', type: 'main', index: 0 }], []] },
      },
      settings: {},
    };
  }
  if (id === 'deals-digest') {
    // /api/alerts returns an array; n8n turns it into one item per component, and an empty array runs nothing downstream.
    return {
      name: 'PCPriceChecker: daily deals digest',
      nodes: [
        schedule('30 7 * * *'),
        getApp(`${base}/api/alerts`, 'Get alerts'),
        ntfyNode(ntfyUrl, "={{ 'At or below target: ' + $json.name }}",
          "={{ '£' + $json.best_price + ' at ' + $json.best_retailer + ' (target £' + $json.alert_price + ')' }}", [480, 0]),
      ],
      connections: {
        'Every morning': { main: [[{ node: 'Get alerts', type: 'main', index: 0 }]] },
        'Get alerts': { main: [[{ node: 'Send to ntfy', type: 'main', index: 0 }]] },
      },
      settings: {},
    };
  }
  return null;
}
