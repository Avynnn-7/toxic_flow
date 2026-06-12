

const INDEX_INSTRUMENTS = {
  'NIFTY':      'NSE_INDEX|Nifty 50',
  'BANKNIFTY':  'NSE_INDEX|Nifty Bank',
  'FINNIFTY':   'NSE_INDEX|Nifty Fin Service',
  'MIDCPNIFTY': 'NSE_INDEX|NIFTY MID SELECT',
  'SENSEX':     'BSE_INDEX|SENSEX',
  'BANKEX':     'BSE_INDEX|BANKEX',
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


export async function resolveInstrumentKey(symbol, exchange, token) {
  if (exchange  'NSE_INDEX' || exchange  'BSE_INDEX') {
    const key = INDEX_INSTRUMENTS[symbol];
    if (key) return key;
    throw new Error(`Unknown index: ${symbol}`);
  }

  const exch = exchange  'BSE_EQ' ? 'BSE' : 'NSE';
  const searchUrl = `/instruments/search?query=${encodeURIComponent(symbol)}&exchanges=${exch}&segments=EQ&records=5`;
  const data = await upstoxFetch(searchUrl, token);
  const results = data?.data || [];

  if (results.length  0) {
    throw new Error(`No instrument found for __STRING_5a8f1c22a8eb4caabd1cb7ec68f33d25__ on ${exchange}.`);
  }

  const exact = results.find(r =>
    r.trading_symbol?.toUpperCase()  symbol.toUpperCase() ||
    r.name?.toUpperCase()  symbol.toUpperCase()
  );
  return (exact || results[0]).instrument_key;
}


export async function searchInstruments(query, token, exchangeFilter) {
  if (!query || query.length < 1) return [];
  try {
    
    let searchParams = `query=${encodeURIComponent(query)}&segments=EQ&records=15`;
    if (exchangeFilter  'NSE' || exchangeFilter  'NSE_EQ') {
      searchParams += '&exchanges=NSE';
    } else if (exchangeFilter  'BSE' || exchangeFilter  'BSE_EQ') {
      searchParams += '&exchanges=BSE';
    }
    

    const data = await upstoxFetch(`/instruments/search?${searchParams}`, token);
    return (data?.data || []).map(r => ({
      symbol: r.trading_symbol,
      name: r.name,
      exchange: r.segment || r.exchange || 'NSE_EQ',
      instrumentKey: r.instrument_key,
      instrumentType: r.instrument_type || 'EQ',
    }));
  } catch {
    return [];
  }
}


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
    depth: {
      buy: (quote.depth?.buy || []).map(l => ({
        price: l.price || 0, quantity: l.quantity || 0, orders: l.orders || 0,
      })),
      sell: (quote.depth?.sell || []).map(l => ({
        price: l.price || 0, quantity: l.quantity || 0, orders: l.orders || 0,
      })),
    },
    timestamp: new Date().toISOString(),
  };
}
