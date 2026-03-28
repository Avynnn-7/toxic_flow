/**
 * server.js — WebSocket + Express server for Toxic Flow Detector
 *
 * ARCHITECTURE:
 *   Upstox REST API ←(500ms poll)→ Server ←(WebSocket push)→ Browser
 *
 * The server manages:
 *   1. A single batch poll loop (all active symbols in ONE api call)
 *   2. Per-symbol toxic engine sessions (ring-buffer state)
 *   3. WebSocket broadcast to subscribed clients
 *
 * This eliminates HTTP overhead per update — the browser receives
 * pre-computed analysis pushed over a persistent connection.
 *
 * DEPLOY: Render.com (free tier, supports WebSocket natively)
 */

import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';

import { analyzeQuote, calibrateBarSize } from './api/lib/toxic-engine.js';
import { resolveInstrumentKey, searchInstruments } from './api/lib/upstox-client.js';

dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3001;
const POLL_MS = 500; // 500ms poll — 2x per second
const UPSTOX_BASE = 'https://api.upstox.com/v2';

// ══════════════════════════════════════════════════════════════════════════════
// EXPRESS APP — serves static files + REST fallback
// ══════════════════════════════════════════════════════════════════════════════
const app = express();
app.use(express.static(join(__dirname, 'dist')));

// REST fallback endpoints (for Vercel or when WebSocket unavailable)
app.get('/api/search', async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const { q } = req.query;
  if (!q) return res.json({ success: true, results: [] });
  const token = process.env.UPSTOX_ACCESS_TOKEN;
  if (!token) return res.status(500).json({ success: false, error: 'Token not configured' });
  try {
    const results = await searchInstruments(String(q), token);
    res.json({ success: true, results });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// SPA fallback
app.get('*', (_req, res) => {
  res.sendFile(join(__dirname, 'dist', 'index.html'));
});

// ══════════════════════════════════════════════════════════════════════════════
// HTTP + WEBSOCKET SERVER
// ══════════════════════════════════════════════════════════════════════════════
const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

// ══════════════════════════════════════════════════════════════════════════════
// UPSTOX BATCH FETCHER — single API call for ALL active symbols
// ══════════════════════════════════════════════════════════════════════════════
function getAuthHeaders() {
  const token = process.env.UPSTOX_ACCESS_TOKEN;
  if (!token) return null;
  const bearer = token.startsWith('Bearer ') ? token : `Bearer ${token}`;
  return { 'Authorization': bearer, 'Accept': 'application/json' };
}

async function fetchBatchQuotes(instrumentKeys) {
  const headers = getAuthHeaders();
  if (!headers) throw new Error('Token not configured');

  const keysParam = instrumentKeys.join(',');
  const url = `${UPSTOX_BASE}/market-quote/quotes?instrument_key=${encodeURIComponent(keysParam)}`;

  const res = await fetch(url, { headers, signal: AbortSignal.timeout(5000) });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Upstox ${res.status}: ${body.slice(0, 200)}`);
  }
  const json = await res.json();
  return json?.data || {};
}

function parseQuote(raw) {
  return {
    ltp: raw.last_price || raw.ohlc?.close || 0,
    open: raw.ohlc?.open || 0,
    high: raw.ohlc?.high || 0,
    low: raw.ohlc?.low || 0,
    close: raw.ohlc?.close || 0,
    volume: raw.volume || 0,
    oi: raw.oi || 0,
    depth: {
      buy: (raw.depth?.buy || []).map(l => ({
        price: l.price || 0, quantity: l.quantity || 0, orders: l.orders || 0,
      })),
      sell: (raw.depth?.sell || []).map(l => ({
        price: l.price || 0, quantity: l.quantity || 0, orders: l.orders || 0,
      })),
    },
    timestamp: new Date().toISOString(),
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// SYMBOL SUBSCRIPTION MANAGER
// ══════════════════════════════════════════════════════════════════════════════
const symbolState = new Map();
// symbolState: Map<symbolKey, {
//   symbol, exchange, instrumentKey,
//   subscribers: Set<ws>,
//   barSize, lastData
// }>

const instrumentKeyCache = new Map(); // "RELIANCE:NSE_EQ" -> "NSE_EQ|INE002A01018"

async function resolveAndCache(symbol, exchange) {
  const cacheKey = `${symbol}:${exchange}`;
  if (instrumentKeyCache.has(cacheKey)) return instrumentKeyCache.get(cacheKey);
  const token = process.env.UPSTOX_ACCESS_TOKEN;
  if (!token) throw new Error('Token not configured');
  const key = await resolveInstrumentKey(symbol, exchange, token);
  instrumentKeyCache.set(cacheKey, key);
  return key;
}

async function subscribeClient(ws, symbol, exchange) {
  const symKey = `${symbol}:${exchange}`;

  try {
    const instrumentKey = await resolveAndCache(symbol, exchange);

    if (!symbolState.has(symKey)) {
      symbolState.set(symKey, {
        symbol, exchange, instrumentKey,
        subscribers: new Set(),
        barSize: 5000,
        lastData: null,
      });
    }

    const state = symbolState.get(symKey);
    state.subscribers.add(ws);

    // Send last known data immediately (instant render)
    if (state.lastData) {
      safeSend(ws, { type: 'update', symbol, exchange, data: state.lastData });
    }

    console.log(`[WS] +subscribe ${symKey} (${state.subscribers.size} clients)`);
    return true;
  } catch (err) {
    safeSend(ws, { type: 'error', symbol, message: err.message });
    return false;
  }
}

function unsubscribeClient(ws, symbol, exchange) {
  const symKey = `${symbol}:${exchange}`;
  const state = symbolState.get(symKey);
  if (state) {
    state.subscribers.delete(ws);
    console.log(`[WS] -unsubscribe ${symKey} (${state.subscribers.size} clients)`);
    // Don't delete state — keep session alive for quick re-subscribe
  }
}

function unsubscribeAll(ws) {
  for (const [symKey, state] of symbolState) {
    if (state.subscribers.has(ws)) {
      state.subscribers.delete(ws);
      console.log(`[WS] -disconnect ${symKey} (${state.subscribers.size} clients)`);
    }
  }
}

function safeSend(ws, data) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// BATCH POLL LOOP — single timer, all symbols, one API call
// ══════════════════════════════════════════════════════════════════════════════
let pollTimer = null;

function startPollLoop() {
  if (pollTimer) return;
  console.log(`[Poll] Starting batch poll loop @ ${POLL_MS}ms`);

  pollTimer = setInterval(async () => {
    // Collect all symbols with active subscribers
    const activeSymbols = [];
    for (const [symKey, state] of symbolState) {
      if (state.subscribers.size > 0) {
        activeSymbols.push({ symKey, ...state });
      }
    }

    if (activeSymbols.length === 0) return;

    try {
      const instrumentKeys = activeSymbols.map(s => s.instrumentKey);
      const rawQuotes = await fetchBatchQuotes(instrumentKeys);
      const pollTime = Date.now();

      for (const sym of activeSymbols) {
        const rawQuote = rawQuotes[sym.instrumentKey];
        if (!rawQuote) continue;

        const quote = parseQuote(rawQuote);
        const engineStart = performance.now();

        // Auto-calibrate bar size on first real volume
        if (sym.barSize === 5000 && quote.volume > 0) {
          sym.barSize = calibrateBarSize(quote.volume);
          const state = symbolState.get(sym.symKey);
          if (state) state.barSize = sym.barSize;
        }

        // Run toxic engine
        const analysis = analyzeQuote(sym.instrumentKey, quote, { volumeBarSize: sym.barSize });
        const engineMs = performance.now() - engineStart;

        const result = {
          success: true,
          symbol: sym.symbol,
          exchange: sym.exchange,
          ...analysis,
          computeTimeMs: parseFloat(engineMs.toFixed(3)),
          totalLatencyMs: Date.now() - pollTime,
          timestamp: new Date().toISOString(),
          transport: 'websocket',
        };

        // Cache last data
        const state = symbolState.get(sym.symKey);
        if (state) state.lastData = result;

        // Broadcast to all subscribers
        for (const client of sym.subscribers) {
          safeSend(client, { type: 'update', symbol: sym.symbol, exchange: sym.exchange, data: result });
        }
      }
    } catch (err) {
      console.error(`[Poll] Batch error:`, err.message);
      // Broadcast error to all active clients
      for (const sym of activeSymbols) {
        for (const client of sym.subscribers) {
          safeSend(client, { type: 'error', symbol: sym.symbol, message: err.message });
        }
      }
    }
  }, POLL_MS);
}

// ══════════════════════════════════════════════════════════════════════════════
// WEBSOCKET CONNECTION HANDLER
// ══════════════════════════════════════════════════════════════════════════════
let clientId = 0;

wss.on('connection', (ws, req) => {
  const id = ++clientId;
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  console.log(`[WS] Client #${id} connected from ${ip}`);

  safeSend(ws, { type: 'connected', id, serverTime: new Date().toISOString() });

  ws.on('message', async (raw) => {
    try {
      const msg = JSON.parse(raw.toString());

      switch (msg.type) {
        case 'subscribe': {
          const symbols = msg.symbols || [];
          const subscribed = [];
          for (const s of symbols) {
            const ok = await subscribeClient(ws, s.symbol, s.exchange || 'NSE_EQ');
            if (ok) subscribed.push(s.symbol);
          }
          safeSend(ws, { type: 'subscribed', symbols: subscribed });
          startPollLoop(); // Ensure poll is running
          break;
        }

        case 'unsubscribe': {
          const symbols = msg.symbols || [];
          for (const sym of symbols) {
            unsubscribeClient(ws, sym, msg.exchange || 'NSE_EQ');
          }
          safeSend(ws, { type: 'unsubscribed', symbols: msg.symbols });
          break;
        }

        default:
          safeSend(ws, { type: 'error', message: `Unknown message type: ${msg.type}` });
      }
    } catch (err) {
      safeSend(ws, { type: 'error', message: 'Invalid JSON message' });
    }
  });

  ws.on('close', () => {
    console.log(`[WS] Client #${id} disconnected`);
    unsubscribeAll(ws);
  });

  ws.on('error', (err) => {
    console.error(`[WS] Client #${id} error:`, err.message);
  });

  // Heartbeat
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
});

// Heartbeat interval — detect dead connections
setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

// ══════════════════════════════════════════════════════════════════════════════
// START
// ══════════════════════════════════════════════════════════════════════════════
server.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════════════╗
║  Toxic Flow Detector — WebSocket Server                  ║
║  http://localhost:${PORT}                                   ║
║  WebSocket: ws://localhost:${PORT}/ws                       ║
║  Poll interval: ${POLL_MS}ms | Engine: JS (C++ optional)     ║
╚══════════════════════════════════════════════════════════╝
`);
});
