/**
 * Vercel Serverless: /api/quote
 * Lightweight LTP + volume endpoint for initial load / symbol validation.
 */

import { resolveInstrumentKey, fetchQuoteWithDepth } from './lib/upstox-client.js';

const instrumentCache = {};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { symbol, exchange = 'NSE_EQ' } = req.query;

  if (!symbol) {
    return res.status(400).json({ success: false, error: 'symbol required' });
  }

  const token = process.env.UPSTOX_ACCESS_TOKEN;
  if (!token) {
    return res.status(500).json({ success: false, error: 'Token not configured' });
  }

  try {
    const upperSymbol = String(symbol).toUpperCase();
    const cacheKey = `${upperSymbol}:${exchange}`;
    if (!instrumentCache[cacheKey]) {
      instrumentCache[cacheKey] = await resolveInstrumentKey(upperSymbol, String(exchange), token);
    }

    const quote = await fetchQuoteWithDepth(instrumentCache[cacheKey], token);
    return res.status(200).json({ success: true, symbol: upperSymbol, exchange, ...quote });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}
