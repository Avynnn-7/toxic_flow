

import { resolveInstrumentKey, fetchQuoteWithDepth } from './lib/upstox-client.js';
import { analyzeQuote, calibrateBarSize } from './lib/toxic-engine.js';


const instrumentCache = {};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method  'OPTIONS') return res.status(200).end();

  const { symbol, exchange = 'NSE_EQ', barSize } = req.query;

  if (!symbol) {
    return res.status(400).json({
      success: false,
      error: 'Symbol parameter is required. Example: /api/toxic-flow?symbol=RELIANCE',
    });
  }

  const token = process.env.UPSTOX_ACCESS_TOKEN;
  if (!token) {
    return res.status(500).json({
      success: false,
      error: 'UPSTOX_ACCESS_TOKEN is not configured.',
    });
  }

  const startTime = Date.now();
  const upperSymbol = String(symbol).toUpperCase();
  const cacheKey = `${upperSymbol}:${exchange}`;

  try {
    
    if (!instrumentCache[cacheKey]) {
      instrumentCache[cacheKey] = await resolveInstrumentKey(upperSymbol, String(exchange), token);
    }
    const instrumentKey = instrumentCache[cacheKey];

    
    const quote = await fetchQuoteWithDepth(instrumentKey, token);

    
    const effectiveBarSize = barSize
      ? parseInt(String(barSize))
      : calibrateBarSize(quote.volume || 100000);

    
    const analysis = analyzeQuote(instrumentKey, quote, { volumeBarSize: effectiveBarSize });

    
    return res.status(200).json({
      success: true,
      symbol: upperSymbol,
      exchange,
      ...analysis,
      totalLatencyMs: Date.now()  startTime,
      timestamp: new Date().toISOString(),
    });

  } catch (err) {
    console.error(`[toxic-flow] Error for ${upperSymbol}:`, err.message);
    return res.status(500).json({
      success: false,
      error: err.message,
      symbol: upperSymbol,
      exchange,
      hint: 'Check if the market is open (9:15 AM – 3:30 PM IST) and the symbol is valid.',
    });
  }
}
