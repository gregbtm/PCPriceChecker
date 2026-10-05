#!/usr/bin/env node
/**
 * Standalone web dashboard server — no MCP stdio transport.
 * Use this to run the dashboard as a persistent NAS service:
 *
 *   node dist/web-standalone.js
 *
 * Starts the background scheduler (if configured) and the web UI on WEB_PORT.
 */
import { startScheduler } from './scheduler.js';
import { startWebServer } from './web.js';

// Also run once ~30 s after start so a restart or image update does not mean waiting a full interval.
startScheduler({ runSoon: process.env.SCHEDULER_RUN_ON_START !== 'false' });

const port = parseInt(process.env.WEB_PORT ?? process.env.PORT ?? '3000');
startWebServer(port);
