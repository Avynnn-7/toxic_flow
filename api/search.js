/**
 * Vercel Serverless: /api/search
 * Instrument search for autocomplete.
 */

import { searchInstruments } from './lib/upstox-client.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { q } = req.query;
  if (!q || String(q).length < 1) {
    return res.status(200).json({ success: true, results: [] });
  }

  const token = process.env.UPSTOX_ACCESS_TOKEN;
  if (!token) {
    return res.status(500).json({ success: false, error: 'Token not configured' });
  }

  try {
    const results = await searchInstruments(String(q), token);
    return res.status(200).json({ success: true, results });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}
