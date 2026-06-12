

import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';
import protobuf from 'protobufjs';

import { initEngine, processQuote, calibrateBarSize, isWasmActive } from './api/lib/toxic-engine-wasm.js';
import { resolveInstrumentKey, searchInstruments, fetchQuoteWithDepth } from './api/lib/upstox-client.js';

dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3001;
const UPSTOX_BASE = 'https://api.upstox.com/v2';
const UPSTOX_WS_AUTH = 'https://api.upstox.com/v3/feed/market-data-feed/authorize';
const POLL_FALLBACK_MS = 500; 




let FeedResponse = null;

async function loadProtoSchema() {
  try {
    const root = await protobuf.load(join(__dirname, 'proto', 'MarketDataFeedV3.proto'));
    FeedResponse = root.lookupType('com.upstox.marketdatafeederv3udapi.rpc.proto.FeedResponse');
    console.log('[Proto]  MarketDataFeedV3 schema loaded');
    return true;
  } catch (err) {
    console.error('[Proto]  Failed to load proto schema:', err.message);
    return false;
  }
}




const app = express();
app.use(express.static(join(__dirname, 'dist')));


app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    engine: isWasmActive() ? 'cpp-wasm' : 'js-o1',
    upstoxWs: upstoxWsConnected ? 'connected' : 'disconnected',
    clients: wss?.clients?.size || 0,
    uptime: Math.round(process.uptime()),
  });
});


app.get('/api/search', async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const { q, exchange } = req.query;
  if (!q) return res.json({ success: true, results: [] });
  const token = process.env.UPSTOX_ACCESS_TOKEN;
  if (!token) return res.status(500).json({ success: false, error: 'Token not configured' });
  try {
    const results = await searchInstruments(String(q), token, exchange);
    res.json({ success: true, results });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});


app.get('/api/toxic-flow', async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const symbol = req.query.symbol || 'RELIANCE';
  const exchange = req.query.exchange || 'NSE_EQ';
  const token = process.env.UPSTOX_ACCESS_TOKEN;
  if (!token) return res.status(500).json({ success: false, error: 'Token not configured' });
  try {
    const instrumentKey = await resolveAndCache(symbol, exchange);
    const quote = await fetchQuoteWithDepth(instrumentKey, token);
    if (symbolState.has(`${symbol}:${exchange}`)) {
      const state = symbolState.get(`${symbol}:${exchange}`);
      if (state.barSize  5000 && quote.volume > 0) {
        state.barSize = calibrateBarSize(quote.volume);
      }
    }
    const result = processQuote(instrumentKey, quote, symbolState.get(`${symbol}:${exchange}`)?.barSize || 5000);
    result.symbol = symbol;
    result.exchange = exchange;
    result.transport = 'http-poll';
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});


app.get('/{*splat}', (_req, res) => {
  res.sendFile(join(__dirname, 'dist', 'index.html'));
});




const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });




const symbolState = new Map();
const instrumentKeyCache = new Map();

function getAuthHeaders() {
  const token = process.env.UPSTOX_ACCESS_TOKEN;
  if (!token) return null;
  const bearer = token.startsWith('Bearer ') ? token : `Bearer ${token}`;
  return { 'Authorization': bearer, 'Accept': 'application/json' };
}

async function resolveAndCache(symbol, exchange) {
  const cacheKey = `${symbol}:${exchange}`;
  if (instrumentKeyCache.has(cacheKey)) return instrumentKeyCache.get(cacheKey);
  const token = process.env.UPSTOX_ACCESS_TOKEN;
  if (!token) throw new Error('Token not configured');
  const key = await resolveInstrumentKey(symbol, exchange, token);
  instrumentKeyCache.set(cacheKey, key);
  return key;
}

function safeSend(ws, data) {
  if (ws.readyState  WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}










let upstoxWs = null;
let upstoxWsConnected = false;
let upstoxReconnectTimer = null;
let upstoxSubscribedKeys = new Set();

async function connectUpstoxWebSocket() {
  const token = process.env.UPSTOX_ACCESS_TOKEN;
  if (!token) {
    console.error('[Upstox WS] No access token configured');
    return;
  }

  try {
    
    const headers = getAuthHeaders();
    const authRes = await fetch(UPSTOX_WS_AUTH, { headers });
    if (!authRes.ok) {
      const body = await authRes.text();
      throw new Error(`Auth failed ${authRes.status}: ${body.slice(0, 200)}`);
    }
    const authData = await authRes.json();
    const wsUrl = authData?.data?.authorizedRedirectUri;
    if (!wsUrl) throw new Error('No authorized WebSocket URL returned');

    console.log('[Upstox WS] Connecting to:', wsUrl.slice(0, 60) + '...');

    
    upstoxWs = new WebSocket(wsUrl, {
      headers: { 'Accept': 'application/octet-stream' },
      followRedirects: true,
    });

    upstoxWs.binaryType = 'arraybuffer';

    upstoxWs.on('open', () => {
      console.log('[Upstox WS]  Connected — push-based feed active');
      upstoxWsConnected = true;

      
      if (upstoxSubscribedKeys.size > 0) {
        subscribeUpstoxInstruments([...upstoxSubscribedKeys]);
      }
    });

    upstoxWs.on('message', (data) => {
      try {
        handleUpstoxMessage(data);
      } catch (err) {
        console.error('[Upstox WS] Message parse error:', err.message);
      }
    });

    upstoxWs.on('close', (code) => {
      console.log(`[Upstox WS] Disconnected (code: ${code})`);
      upstoxWsConnected = false;
      upstoxWs = null;
      
      scheduleUpstoxReconnect();
    });

    upstoxWs.on('error', (err) => {
      console.error('[Upstox WS] Error:', err.message);
    });

  } catch (err) {
    console.error('[Upstox WS] Connection failed:', err.message);
    upstoxWsConnected = false;
    scheduleUpstoxReconnect();
  }
}

function scheduleUpstoxReconnect() {
  if (upstoxReconnectTimer) return;
  const delay = 5000;
  console.log(`[Upstox WS] Reconnecting in ${delay}ms...`);
  upstoxReconnectTimer = setTimeout(() => {
    upstoxReconnectTimer = null;
    connectUpstoxWebSocket();
  }, delay);
}

function subscribeUpstoxInstruments(instrumentKeys) {
  if (!upstoxWs || upstoxWs.readyState !== WebSocket.OPEN) return;

  
  for (const key of instrumentKeys) upstoxSubscribedKeys.add(key);

  
  const subscribeMsg = JSON.stringify({
    guid: 'toxic-flow-' + Date.now(),
    method: 'sub',
    data: {
      mode: 'full_d5',  
      instrumentKeys: instrumentKeys,
    },
  });

  upstoxWs.send(Buffer.from(subscribeMsg));
  console.log(`[Upstox WS] Subscribed to ${instrumentKeys.length} instruments`);
}

function handleUpstoxMessage(rawData) {
  
  if (rawData instanceof ArrayBuffer || Buffer.isBuffer(rawData)) {
    if (FeedResponse) {
      try {
        const decoded = FeedResponse.decode(new Uint8Array(rawData));
        const feedObj = FeedResponse.toObject(decoded, { longs: Number, defaults: true });

        if (feedObj.feeds) {
          for (const [instrumentKey, feed] of Object.entries(feedObj.feeds)) {
            processUpstoxFeed(instrumentKey, feed);
          }
        }
        return;
      } catch (protoErr) {
        
      }
    }
  }

  
  try {
    const textData = typeof rawData  'string' ? rawData : Buffer.from(rawData).toString('utf-8');
    const json = JSON.parse(textData);
    if (json.feeds) {
      for (const [instrumentKey, feed] of Object.entries(json.feeds)) {
        processUpstoxFeed(instrumentKey, feed);
      }
    }
  } catch {
    
  }
}

function processUpstoxFeed(instrumentKey, feed) {
  
  const ff = feed?.fullFeed?.marketFF || feed?.fullFeed?.indexFF;
  if (!ff) return;

  const ltpc = ff.ltpc || {};
  const marketLevel = ff.marketLevel?.bidAskQuote || [];
  const ohlcList = ff.marketOHLC?.ohlc || [];
  const dayOhlc = ohlcList.find(o => o.interval  '1d') || ohlcList[0] || {};

  const quote = {
    ltp: ltpc.ltp || 0,
    open: dayOhlc.open || 0,
    high: dayOhlc.high || 0,
    low: dayOhlc.low || 0,
    close: ltpc.cp || dayOhlc.close || 0,
    volume: Number(ff.vtt || dayOhlc.vol || 0),
    oi: ff.oi || 0,
    depth: {
      buy: marketLevel.filter((_, i) => i % 2  0).slice(0, 5).map(q => ({
        price: q.bidP || 0, quantity: Number(q.bidQ || 0),
      })),
      sell: marketLevel.filter((_, i) => i % 2  0).slice(0, 5).map(q => ({
        price: q.askP || 0, quantity: Number(q.askQ || 0),
      })),
    },
    timestamp: new Date().toISOString(),
  };

  
  if (marketLevel.length > 0 && !quote.depth.buy[0]?.price) {
    quote.depth.buy = marketLevel.slice(0, 5).map(q => ({
      price: q.bidP || q.bp || 0, quantity: Number(q.bidQ || q.bq || 0),
    }));
    quote.depth.sell = marketLevel.slice(0, 5).map(q => ({
      price: q.askP || q.ap || 0, quantity: Number(q.askQ || q.aq || 0),
    }));
  }

  if (quote.ltp <= 0) return;

  
  for (const [symKey, state] of symbolState) {
    if (state.instrumentKey  instrumentKey && state.subscribers.size > 0) {
      
      if (state.barSize  5000 && quote.volume > 0) {
        state.barSize = calibrateBarSize(quote.volume);
      }

      
      const result = processQuote(instrumentKey, quote, state.barSize);
      result.symbol = state.symbol;
      result.exchange = state.exchange;
      result.volumeBarSize = state.barSize;

      state.lastData = result;

      
      for (const client of state.subscribers) {
        safeSend(client, { type: 'update', symbol: state.symbol, exchange: state.exchange, data: result });
      }
    }
  }
}




let pollTimer = null;

async function fetchBatchQuotes(instrumentKeys) {
  const headers = getAuthHeaders();
  if (!headers) throw new Error('Token not configured');
  const keysParam = instrumentKeys.join(',');
  const url = `${UPSTOX_BASE}/market-quote/quotes?instrument_key=${encodeURIComponent(keysParam)}`;
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`Upstox ${res.status}`);
  const json = await res.json();
  return json?.data || {};
}

function parseQuote(raw) {
  return {
    ltp: raw.last_price || raw.ohlc?.close || 0,
    open: raw.ohlc?.open || 0, high: raw.ohlc?.high || 0,
    low: raw.ohlc?.low || 0, close: raw.ohlc?.close || 0,
    volume: raw.volume || 0, oi: raw.oi || 0,
    depth: {
      buy: (raw.depth?.buy || []).map(l => ({ price: l.price || 0, quantity: l.quantity || 0, orders: l.orders || 0 })),
      sell: (raw.depth?.sell || []).map(l => ({ price: l.price || 0, quantity: l.quantity || 0, orders: l.orders || 0 })),
    },
    timestamp: new Date().toISOString(),
  };
}

function startPollFallback() {
  if (pollTimer) return;
  console.log(`[Poll] Starting fallback poll @ ${POLL_FALLBACK_MS}ms`);

  pollTimer = setInterval(async () => {
    if (upstoxWsConnected) return; 

    const activeSymbols = [];
    for (const [symKey, state] of symbolState) {
      if (state.subscribers.size > 0) activeSymbols.push({ symKey, ...state });
    }
    if (activeSymbols.length  0) return;

    try {
      const instrumentKeys = activeSymbols.map(s => s.instrumentKey);
      const rawQuotes = await fetchBatchQuotes(instrumentKeys);

      for (const sym of activeSymbols) {
        const rawQuote = rawQuotes[sym.instrumentKey];
        if (!rawQuote) continue;

        const quote = parseQuote(rawQuote);
        if (sym.barSize  5000 && quote.volume > 0) {
          sym.barSize = calibrateBarSize(quote.volume);
          const state = symbolState.get(sym.symKey);
          if (state) state.barSize = sym.barSize;
        }

        const result = processQuote(sym.instrumentKey, quote, sym.barSize);
        result.symbol = sym.symbol;
        result.exchange = sym.exchange;
        result.volumeBarSize = sym.barSize;
        result.transport = 'http-poll-fallback';

        const state = symbolState.get(sym.symKey);
        if (state) state.lastData = result;

        for (const client of sym.subscribers) {
          safeSend(client, { type: 'update', symbol: sym.symbol, exchange: sym.exchange, data: result });
        }
      }
    } catch (err) {
      console.error('[Poll] Error:', err.message);
    }
  }, POLL_FALLBACK_MS);
}




let clientId = 0;

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

    
    if (upstoxWsConnected) {
      subscribeUpstoxInstruments([instrumentKey]);
    }

    
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
  }
}

function unsubscribeAll(ws) {
  for (const [symKey, state] of symbolState) {
    if (state.subscribers.has(ws)) {
      state.subscribers.delete(ws);
    }
  }
}

wss.on('connection', (ws, req) => {
  const id = ++clientId;
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  console.log(`[WS] Client #${id} connected from ${ip}`);

  safeSend(ws, {
    type: 'connected', id,
    engine: isWasmActive() ? 'cpp-wasm' : 'js-o1',
    serverTime: new Date().toISOString(),
  });

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
          startPollFallback(); 
          break;
        }

        case 'unsubscribe': {
          for (const sym of (msg.symbols || [])) {
            unsubscribeClient(ws, sym, msg.exchange || 'NSE_EQ');
          }
          safeSend(ws, { type: 'unsubscribed', symbols: msg.symbols });
          break;
        }

        case 'poll': {
          
          
          if (!upstoxWsConnected) {
            
            const activeSymbols = [];
            for (const [symKey, state] of symbolState) {
              if (state.subscribers.has(ws)) {
                activeSymbols.push({ symKey, ...state });
              }
            }
            if (activeSymbols.length  0) break;

            try {
              const instrumentKeys = activeSymbols.map(s => s.instrumentKey);
              const rawQuotes = await fetchBatchQuotes(instrumentKeys);

              for (const sym of activeSymbols) {
                const rawQuote = rawQuotes[sym.instrumentKey];
                if (!rawQuote) continue;
                const quote = parseQuote(rawQuote);
                if (sym.barSize  5000 && quote.volume > 0) {
                  sym.barSize = calibrateBarSize(quote.volume);
                }
                const result = processQuote(sym.instrumentKey, quote, sym.barSize);
                result.symbol = sym.symbol;
                result.exchange = sym.exchange;
                result.volumeBarSize = sym.barSize;
                const state = symbolState.get(sym.symKey);
                if (state) state.lastData = result;
                safeSend(ws, { type: 'update', symbol: sym.symbol, exchange: sym.exchange, data: result });
              }
            } catch (err) {
              safeSend(ws, { type: 'error', message: err.message });
            }
          }
          break;
        }

        default:
          safeSend(ws, { type: 'error', message: `Unknown: ${msg.type}` });
      }
    } catch (err) {
      safeSend(ws, { type: 'error', message: 'Invalid JSON' });
    }
  });

  ws.on('close', () => {
    console.log(`[WS] Client #${id} disconnected`);
    unsubscribeAll(ws);
  });

  ws.on('error', (err) => {
    console.error(`[WS] Client #${id} error:`, err.message);
  });

  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
});


setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);





function startKeepAlive() {
  const KEEP_ALIVE_MS = 14 * 60 * 1000; 

  setInterval(async () => {
    try {
      const url = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
      await fetch(`${url}/health`, { signal: AbortSignal.timeout(5000) });
      console.log('[Keep-Alive] Ping sent');
    } catch {
      
      try {
        await fetch(`http://localhost:${PORT}/health`, { signal: AbortSignal.timeout(3000) });
      } catch {  }
    }
  }, KEEP_ALIVE_MS);
}




async function startup() {
  
  const wasmOk = await initEngine();
  console.log(`[Engine] ${wasmOk ? __STRING_886c155a3ea6437aa001189c74f3ef40__ : __STRING_497ff162a11e4fae98f05aa21f575217__} engine active`);

  
  await loadProtoSchema();

  
  server.listen(PORT, () => {
    console.log(`
╔═══════════════════════════════════════════════════════════════╗
║  ️  RIFT: Real time informed Flow Tracker — WebSocket Server                   ║
║  http://localhost:${PORT}                                        ║
║  WebSocket: ws://localhost:${PORT}/ws                             ║
║  Engine: ${(wasmOk ? __STRING_5a23e621952b409f9edd09a25ca570d5__ : __STRING_6c8d7b2f75c649b1b3d5a89d9e748c86__).padEnd(42)}  ║
║  Feed: Upstox WebSocket (protobuf push)                       ║
║  Keep-Alive: Active (14-min ping)                             ║
╚═══════════════════════════════════════════════════════════════╝
`);
  });

  
  setTimeout(() => connectUpstoxWebSocket(), 1000);

  
  startKeepAlive();
}

startup().catch(err => {
  console.error('Startup failed:', err);
  process.exit(1);
});
