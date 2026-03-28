/**
 * Upstox API client for Toxic Flow serverless functions.
 * Supports ALL stocks via dynamic instrument search.
 * Token never exposed to frontend — server-side only.
 */

const INDEX_INSTRUMENTS = {
  'NIFTY':      'NSE_INDEX|Nifty 50',
  'BANKNIFTY':  'NSE_INDEX|Nifty Bank',
  'FINNIFTY':   'NSE_INDEX|Nifty Fin Service',
  'MIDCPNIFTY': 'NSE_INDEX|NIFTY MID SELECT',
  'SENSEX':     'BSE_INDEX|SENSEX',
};

async function upstoxFetch(endpoint, token, version = 'v2') {
  const bearer = token.startsWith('Bearer ') ? token : `Bearer ${token}`;
  const res = await fetch(`https://api.upstox.com/${version}${endpoint}`, {
    headers: { 'Authorization': bearer, 'Accept': 'application/json' },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Upstox API ${res.status}: ${body.slice(0, 300)}`);
  }
  return res.json();
}

/**
 * Dynamically resolve any symbol to its Upstox instrument_key.
 */
export async function resolveInstrumentKey(symbol, exchange, token) {
  if (exchange === 'NSE_INDEX' || exchange === 'BSE_INDEX') {
    const key = INDEX_INSTRUMENTS[symbol];
    if (key) return key;
    throw new Error(`Unknown index: ${symbol}`);
  }

  const exch = exchange === 'BSE_EQ' ? 'BSE' : 'NSE';
  const searchUrl = `/instruments/search?query=${encodeURIComponent(symbol)}&exchanges=${exch}&segments=EQ&records=5`;
  const data = await upstoxFetch(searchUrl, token);
  const results = data?.data || [];

  if (results.length === 0) {
    throw new Error(`No instrument found for "${symbol}" on ${exchange}.`);
  }

  const exact = results.find(r =>
    r.trading_symbol?.toUpperCase() === symbol.toUpperCase() ||
    r.name?.toUpperCase() === symbol.toUpperCase()
  );
  return (exact || results[0]).instrument_key;
}

/**
 * Search instruments — for autocomplete.
 */
export async function searchInstruments(query, token) {
  if (!query || query.length < 1) return [];
  try {
    const data = await upstoxFetch(
      `/instruments/search?query=${encodeURIComponent(query)}&segments=EQ&records=12`,
      token
    );
    return (data?.data || []).map(r => ({
      symbol: r.trading_symbol,
      name: r.name,
      exchange: r.segment,
      instrumentKey: r.instrument_key,
    }));
  } catch {
    return [];
  }
}

/**
 * Fetch live quote with full depth (bid/ask levels).
 * Returns: { ltp, open, high, low, close, volume, oi, depth, timestamp }
 */
export async function fetchQuoteWithDepth(instrumentKey, token) {
  const data = await upstoxFetch(
    `/market-quote/quotes?instrument_key=${encodeURIComponent(instrumentKey)}`,
    token
  );
  const quote = Object.values(data?.data || {})[0];
  if (!quote) throw new Error('No quote data returned');

  return {
    ltp: quote.last_price || quote.ohlc?.close || 0,
    open: quote.ohlc?.open || 0,
    high: quote.ohlc?.high || 0,
    low: quote.ohlc?.low || 0,
    close: quote.ohlc?.close || 0,
    volume: quote.volume || 0,
    oi: quote.oi || 0,
    upperCircuit: quote.upper_circuit_limit || 0,
    lowerCircuit: quote.lower_circuit_limit || 0,
    depth: {
      buy: (quote.depth?.buy || []).map(l => ({
        price: l.price || 0,
        quantity: l.quantity || 0,
        orders: l.orders || 0,
      })),
      sell: (quote.depth?.sell || []).map(l => ({
        price: l.price || 0,
        quantity: l.quantity || 0,
        orders: l.orders || 0,
      })),
    },
    timestamp: new Date().toISOString(),
  };
}
