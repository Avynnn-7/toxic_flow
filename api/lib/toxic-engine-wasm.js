/**
 * toxic-engine-wasm.js — WASM-based Toxic Engine wrapper
 *
 * Loads the compiled C++ toxic engine via WebAssembly for
 * O(1) per-tick computation with native performance.
 *
 * Falls back to the pure-JS engine if WASM isn't available.
 */

import { readFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WASM_PATH = join(__dirname, '..', '..', 'engine', 'toxic_engine.wasm');
const JS_PATH = join(__dirname, '..', '..', 'engine', 'toxic_engine.js');

let wasmModule = null;
let wasmReady = false;

// ══════════════════════════════════════════════════════════════════════════════
// WASM Module Loader
// ══════════════════════════════════════════════════════════════════════════════

async function loadWasm() {
  try {
    if (!existsSync(WASM_PATH)) {
      console.log('[Engine] WASM not found, using JS fallback');
      return false;
    }

    // Try loading the Emscripten module
    let importUrl = JS_PATH;
    if (process.platform === 'win32') {
      importUrl = 'file://' + JS_PATH.replace(/\\/g, '/');
    }
    const moduleFactory = (await import(importUrl)).default;
    wasmModule = await moduleFactory();
    wasmReady = true;
    console.log('[Engine] ✅ C++ WASM engine loaded — O(1) per tick');
    return true;
  } catch (err) {
    console.warn('[Engine] WASM load failed, using JS fallback:', err.message);
    return false;
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// WASM Engine Class — wraps C functions
// ══════════════════════════════════════════════════════════════════════════════

class WasmToxicEngine {
  constructor(barSize = 5000) {
    this.sessionId = wasmModule._create_session(barSize);
    this.barSize = barSize;
    this.updateCount = 0;
    this.tickCount = 0;
    this.lastVolume = -1;
    this.volumeChanges = 0;
    this.priceChanges = 0;
    this.lastQuote = null;
  }

  process(quote) {
    const t0 = performance.now();
    this.tickCount++;

    if (this.lastVolume >= 0 && quote.volume !== this.lastVolume) this.volumeChanges++;
    if (this.lastQuote && quote.ltp !== this.lastQuote.ltp) this.priceChanges++;
    this.lastVolume = quote.volume;
    const marketActive = this.volumeChanges >= 2 || this.priceChanges >= 2;

    // Reset and set quote fields
    wasmModule._reset_quote();
    wasmModule._set_quote_ltp(quote.ltp || 0);
    wasmModule._set_quote_volume(quote.volume || 0);
    wasmModule._set_quote_timestamp(Date.now());

    // Set depth levels
    const buyDepth = quote.depth?.buy || [];
    const sellDepth = quote.depth?.sell || [];
    for (let i = 0; i < Math.min(buyDepth.length, 5); i++) {
      wasmModule._set_quote_bid(i, buyDepth[i].price || 0, buyDepth[i].quantity || 0);
    }
    for (let i = 0; i < Math.min(sellDepth.length, 5); i++) {
      wasmModule._set_quote_ask(i, sellDepth[i].price || 0, sellDepth[i].quantity || 0);
    }

    // Process tick
    wasmModule._process_tick(this.sessionId);
    this.updateCount++;

    const computeTimeMs = performance.now() - t0;

    // Extract results
    const sid = this.sessionId;
    const gf = (field) => wasmModule._get_result_field(sid, field);

    const vpin = gf(0);
    const ofi = gf(1);
    const kyleLambda = gf(2);
    const amihud = gf(3);
    const hawkes = gf(4);
    const pin = gf(5);
    const toxicScore = Math.round(gf(11));
    const crashRisk = Math.round(gf(12));

    // Extract volume bars for UI
    const barCount = Math.min(wasmModule._get_volume_bar_count(sid), 50);
    const volumeBars = [];
    for (let i = barCount - 1; i >= 0; i--) {
      volumeBars.push({
        open: wasmModule._get_volume_bar_field(sid, i, 0),
        high: wasmModule._get_volume_bar_field(sid, i, 1),
        low: wasmModule._get_volume_bar_field(sid, i, 2),
        close: wasmModule._get_volume_bar_field(sid, i, 3),
        buyVol: wasmModule._get_volume_bar_field(sid, i, 4),
        sellVol: wasmModule._get_volume_bar_field(sid, i, 5),
        vpin: parseFloat(wasmModule._get_volume_bar_field(sid, i, 6).toFixed(4)),
        barIndex: wasmModule._get_volume_bar_field(sid, i, 7),
      });
    }

    // Extract OFI history for UI
    const ofiCount = Math.min(wasmModule._get_ofi_count(sid), 50);
    const ofiHistory = [];
    for (let i = ofiCount - 1; i >= 0; i--) {
      ofiHistory.push({
        normalized: parseFloat(wasmModule._get_ofi_field(sid, i, 0).toFixed(4)),
        bidQty: wasmModule._get_ofi_field(sid, i, 1),
        askQty: wasmModule._get_ofi_field(sid, i, 2),
      });
    }

    // Extract score history for UI
    const scoreCount = Math.min(wasmModule._get_score_count(sid), 50);
    const scoreHistory = [];
    for (let i = scoreCount - 1; i >= 0; i--) {
      scoreHistory.push(wasmModule._get_score_history_val(sid, i));
    }

    const crashCount = Math.min(wasmModule._get_crash_count(sid), 50);
    const crashRiskHistory = [];
    for (let i = crashCount - 1; i >= 0; i--) {
      crashRiskHistory.push(wasmModule._get_crash_history_val(sid, i));
    }

    const spreadBps = parseFloat(gf(6).toFixed(2));
    const depthImbalance = parseFloat(gf(8).toFixed(4));
    
    // Override score if market is closed (authentic EOD score)
    let finalToxicScore = toxicScore;
    let finalCrashRisk = crashRisk;
    
    if (!marketActive && this.tickCount < 5) {
      const volatilityBps = quote.open > 0 ? ((quote.high - quote.low) / quote.open) * 10000 : 0;
      const trend = quote.open > 0 ? ((quote.close - quote.open) / quote.open) * 100 : 0;
      
      const volScore = Math.min(1, volatilityBps / 300) * 40;
      const trendScore = Math.min(1, Math.abs(trend) / 3) * 30;
      const imbScore = Math.min(1, Math.abs(depthImbalance)) * 30;
      
      finalToxicScore = Math.round(volScore + trendScore + imbScore);
      finalCrashRisk = 0;
    }

    // Generate recommendation
    const recommendation = !marketActive && this.tickCount < 5
      ? this._getMarketClosedRec(finalToxicScore, spreadBps, depthImbalance)
      : this._getRecommendation(finalToxicScore, finalCrashRisk, vpin, ofi, kyleLambda, pin);

    this.lastQuote = JSON.parse(JSON.stringify(quote));

    return {
      success: true,
      ltp: quote.ltp,
      volume: quote.volume,
      vpin: parseFloat(vpin.toFixed(4)),
      ofi: parseFloat(ofi.toFixed(4)),
      kyleLambda: parseFloat(kyleLambda.toFixed(4)),
      amihud: parseFloat(amihud.toFixed(4)),
      hawkes: parseFloat(hawkes.toFixed(4)),
      pin: parseFloat(pin.toFixed(4)),
      toxicScore: finalToxicScore,
      crashRisk: finalCrashRisk,
      marketActive,
      spread: {
        spreadBps,
        mid: parseFloat(gf(7).toFixed(2)),
        depthImbalance,
        bidDepth: gf(9),
        askDepth: gf(10),
      },
      volumeBars,
      volumeBarSize: this.barSize,
      barProgress: gf(18),
      totalBarsCompleted: Math.round(gf(17)),
      ofiHistory,
      scoreHistory,
      crashRiskHistory,
      recommendation,
      computeTimeMs: parseFloat(computeTimeMs.toFixed(3)),
      updateCount: this.updateCount,
      timestamp: new Date().toISOString(),
      transport: 'websocket',
      engine: 'cpp-wasm',
    };
  }

  _getMarketClosedRec(score, spreadBps, depthImbalance) {
    const imb = Math.abs(depthImbalance);
    const direction = depthImbalance > 0 ? 'buy-side heavy' : depthImbalance < 0 ? 'sell-side heavy' : 'balanced';
    return {
      label: 'MARKET CLOSED',
      action: 'No live trading activity. Showing last session snapshot.',
      color: '#d4af37',
      details: `Closing order book is ${direction} (imbalance: ${(imb*100).toFixed(1)}%). Spread: ${spreadBps.toFixed(1)} bps. Real-time scores will activate when market opens (Mon-Fri 9:15 AM IST).`,
      toxicScore: score,
      crashRisk: 0,
    };
  }

  _getRecommendation(score, crashRisk, vpin, ofi, lambda, pin) {
    if (score <= 25) return {
      label: 'SAFE', action: 'Normal market conditions. No signs of manipulation.',
      color: '#22c55e',
      details: 'Order flow looks clean — no significant institutional manipulation detected. Safe to trade with standard position sizing.',
      toxicScore: score, crashRisk,
    };
    if (score <= 50) return {
      label: 'CAUTION', action: 'Mixed signals. Some unusual activity detected.',
      color: '#eab308',
      details: `Order flow shows ${ofi > 0 ? 'buying' : 'selling'} pressure. Consider reducing position size. Use tighter stop-losses.`,
      toxicScore: score, crashRisk,
    };
    if (score <= 70) return {
      label: 'TOXIC', action: 'Significant toxic flow. Institutional players likely active.',
      color: '#f97316',
      details: `VPIN at ${(vpin * 100).toFixed(1)}%. Kyle's Lambda shows ${lambda > 2 ? 'high' : 'moderate'} price impact. Avoid new positions.`,
      toxicScore: score, crashRisk,
    };
    if (score <= 85) return {
      label: 'DANGER', action: 'Extreme toxic flow. High adverse selection risk.',
      color: '#ef4444',
      details: `PIN estimate: ${(pin * 100).toFixed(1)}%. Flow is heavily skewed. EXIT positions. Stop-loss slippage risk is HIGH.`,
      toxicScore: score, crashRisk,
    };
    return {
      label: 'CRASH RISK', action: 'CRITICAL: Flash crash conditions detected.',
      color: '#dc2626',
      details: 'VPIN at extreme levels. Liquidity evaporating. EXIT ALL. Do NOT buy the dip.',
      toxicScore: score, crashRisk,
    };
  }

  destroy() {
    if (wasmModule && this.sessionId >= 0) {
      wasmModule._destroy_session(this.sessionId);
    }
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// PURE JS FALLBACK ENGINE — identical algorithms to C++ (O(1) per tick)
// Used when WASM is not compiled/available
// ══════════════════════════════════════════════════════════════════════════════

const EWMA_VPIN_A = 2 / 51;
const EWMA_AMIHUD_A = 2 / 51;
const EWMA_OFI_A = 2 / 31;
const WELFORD_D = 0.98;
const H_MU = 0.5;
const H_ALPHA = 0.3;
const H_BETA = 0.1;

function normalCDF(z) {
  if (z < -8) return 0;
  if (z > 8) return 1;
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const sign = z >= 0 ? 1 : -1;
  const az = Math.abs(z);
  const t = 1 / (1 + p * az);
  const phi = 0.3989422804014327 * Math.exp(-0.5 * az * az);
  const cdf = 1 - phi * (a1*t + a2*t*t + a3*t*t*t + a4*t*t*t*t + a5*t*t*t*t*t);
  return 0.5 * (1 + sign * (2 * cdf - 1));
}

function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }

class JSFallbackEngine {
  constructor(barSize = 5000) {
    this.barSize = barSize;
    this.lastQuote = null;
    this.barAcc = { open: 0, high: -Infinity, low: Infinity, close: 0, buyVol: 0, sellVol: 0, totalVol: 0 };

    // EWMA
    this.ewmaVpin = 0; this.ewmaVpinInit = false;
    this.ewmaAmihud = 0; this.ewmaAmihudInit = false;
    this.ewmaOfi = 0; this.ewmaOfiInit = false;

    // Welford
    this.wMeanX = 0; this.wMeanY = 0; this.wCxy = 0; this.wM2x = 0; this.wN = 0;

    // Hawkes
    this.hawkesIntensity = H_MU; this.hawkesLastTs = 0; this.hawkesInit = false;

    // Online histogram
    this.histBins = new Int32Array(32); this.histTotal = 0;

    // PIN
    this.pinSumBuy = 0; this.pinSumSell = 0; this.pinBarCount = 0; this.pinSig = 0;

    // OFI — first tick is baseline, NOT a signal
    this.lastBidQty = -1; this.lastAskQty = -1; // -1 = not initialized
    this.ofiBaselineSet = false;

    // Market state detection
    this.lastVolume = -1;
    this.volumeChanges = 0;  // how many ticks had real volume delta
    this.priceChanges = 0;   // how many ticks had price movement
    this.tickCount = 0;

    // History rings (for UI)
    this.volumeBars = [];
    this.ofiHistory = [];
    this.scoreHistory = [];
    this.crashHistory = [];
    this.updateCount = 0;
  }

  process(quote) {
    const t0 = performance.now();
    this.tickCount++;

    // ── Track market activity ──────────────────────────────────────
    if (this.lastVolume >= 0 && quote.volume !== this.lastVolume) this.volumeChanges++;
    if (this.lastQuote && quote.ltp !== this.lastQuote.ltp) this.priceChanges++;
    this.lastVolume = quote.volume;
    const marketActive = this.volumeChanges >= 2 || this.priceChanges >= 2;

    // ── BVC (Bulk Volume Classification) ──────────────────────────
    let buyVol = 0, sellVol = 0;
    if (this.lastQuote) {
      const volDelta = Math.max(0, quote.volume - this.lastQuote.volume);
      if (volDelta > 0) {
        const curMid = (quote.depth?.buy?.[0]?.price && quote.depth?.sell?.[0]?.price)
          ? (quote.depth.buy[0].price + quote.depth.sell[0].price) / 2 : quote.ltp;
        const lastMid = (this.lastQuote.depth?.buy?.[0]?.price && this.lastQuote.depth?.sell?.[0]?.price)
          ? (this.lastQuote.depth.buy[0].price + this.lastQuote.depth.sell[0].price) / 2 : this.lastQuote.ltp;
        const spread = Math.max((quote.depth?.sell?.[0]?.price || quote.ltp) - (quote.depth?.buy?.[0]?.price || quote.ltp), 0.01);
        const z = (curMid - lastMid) / spread;
        const bf = normalCDF(z);
        buyVol = Math.round(volDelta * bf);
        sellVol = volDelta - buyVol;
      }
    }

    // ── Volume bars ───────────────────────────────────────────────
    const total = buyVol + sellVol;
    if (this.barAcc.totalVol === 0) { this.barAcc.open = quote.ltp; this.barAcc.high = quote.ltp; this.barAcc.low = quote.ltp; }
    this.barAcc.high = Math.max(this.barAcc.high, quote.ltp);
    this.barAcc.low = Math.min(this.barAcc.low, quote.ltp);
    this.barAcc.close = quote.ltp;
    this.barAcc.buyVol += buyVol; this.barAcc.sellVol += sellVol; this.barAcc.totalVol += total;

    while (this.barAcc.totalVol >= this.barSize) {
      const bar = {
        open: this.barAcc.open, high: this.barAcc.high, low: this.barAcc.low, close: this.barAcc.close,
        buyVol: Math.min(this.barAcc.buyVol, this.barSize), sellVol: Math.min(this.barAcc.sellVol, this.barSize),
        totalVol: this.barSize, barIndex: this.volumeBars.length,
        vpin: Math.abs(this.barAcc.buyVol - this.barAcc.sellVol) / this.barSize,
      };
      if (this.volumeBars.length >= 200) this.volumeBars.shift();
      this.volumeBars.push(bar);

      // EWMA VPIN
      if (!this.ewmaVpinInit) { this.ewmaVpin = bar.vpin; this.ewmaVpinInit = true; }
      else this.ewmaVpin = EWMA_VPIN_A * bar.vpin + (1 - EWMA_VPIN_A) * this.ewmaVpin;

      // Histogram
      const idx = Math.min(31, Math.max(0, Math.floor(bar.vpin * 32)));
      this.histBins[idx]++; this.histTotal++;

      // PIN accum
      this.pinSumBuy = this.pinSumBuy * 0.95 + bar.buyVol;
      this.pinSumSell = this.pinSumSell * 0.95 + bar.sellVol;
      this.pinBarCount++;
      if (bar.vpin > 0.3) this.pinSig++;
      if (this.pinBarCount > 30) { this.pinSig = Math.round(this.pinSig * 0.95); this.pinBarCount = 30; }

      const overflow = this.barAcc.totalVol - this.barSize;
      const frac = total > 0 ? buyVol / total : 0.5;
      this.barAcc = { open: this.barAcc.close, high: this.barAcc.close, low: this.barAcc.close, close: this.barAcc.close,
        buyVol: Math.round(overflow * frac), sellVol: overflow - Math.round(overflow * frac), totalVol: overflow };
    }

    const vpin = this.ewmaVpin;

    // ── OFI ───────────────────────────────────────────────────────
    // FIX: First tick sets the baseline. Don't count initial depth as a "change."
    let bidQty = 0, askQty = 0;
    (quote.depth?.buy || []).forEach(l => bidQty += l.quantity || 0);
    (quote.depth?.sell || []).forEach(l => askQty += l.quantity || 0);

    let normOfi = 0;
    if (!this.ofiBaselineSet) {
      // First tick: just record baseline, OFI = 0
      this.lastBidQty = bidQty;
      this.lastAskQty = askQty;
      this.ofiBaselineSet = true;
      this.ewmaOfi = 0;
      this.ewmaOfiInit = true;
    } else {
      normOfi = (bidQty - this.lastBidQty - (askQty - this.lastAskQty)) / Math.max(bidQty + askQty, 1);
      this.ewmaOfi = EWMA_OFI_A * normOfi + (1 - EWMA_OFI_A) * this.ewmaOfi;
      this.lastBidQty = bidQty;
      this.lastAskQty = askQty;
    }
    if (this.ofiHistory.length >= 200) this.ofiHistory.shift();
    this.ofiHistory.push({ normalized: normOfi, bidQty, askQty });

    // ── Kyle's Lambda (Welford) ───────────────────────────────────
    let kyleLambda = 0;
    if (this.lastQuote) {
      const dp = quote.ltp - this.lastQuote.ltp;
      let lbq = 0, laq = 0;
      (this.lastQuote.depth?.buy || []).forEach(l => lbq += l.quantity || 0);
      (this.lastQuote.depth?.sell || []).forEach(l => laq += l.quantity || 0);
      const doi = (bidQty - askQty) - (lbq - laq);
      this.wN = this.wN * WELFORD_D + 1;
      this.wCxy *= WELFORD_D; this.wM2x *= WELFORD_D;
      const dx = doi - this.wMeanX; this.wMeanX += dx / this.wN;
      const dy = dp - this.wMeanY; this.wMeanY += dy / this.wN;
      this.wCxy += dx * (dp - this.wMeanY);
      this.wM2x += dx * (doi - this.wMeanX);
      if (this.wN >= 5 && this.wM2x > 1e-10) kyleLambda = Math.abs(this.wCxy / this.wM2x);
    }

    // ── Amihud ────────────────────────────────────────────────────
    let amihud = 0;
    if (this.lastQuote && this.lastQuote.ltp > 0) {
      const ret = Math.abs((quote.ltp - this.lastQuote.ltp) / this.lastQuote.ltp);
      const vd = Math.max(quote.volume - this.lastQuote.volume, 1);
      amihud = (ret / vd) * 1e6;
      if (!this.ewmaAmihudInit) { this.ewmaAmihud = amihud; this.ewmaAmihudInit = true; }
      else this.ewmaAmihud = EWMA_AMIHUD_A * amihud + (1 - EWMA_AMIHUD_A) * this.ewmaAmihud;
      amihud = this.ewmaAmihud;
    }

    // ── Hawkes (recursive) ────────────────────────────────────────
    // FIX: Ignore rapid duplicate API calls (dt < 200ms) — not real trades
    let hawkes = 0;
    const ts = Date.now();
    if (!this.hawkesInit) { this.hawkesIntensity = H_MU; this.hawkesLastTs = ts; this.hawkesInit = true; }
    else {
      const dt = Math.max(ts - this.hawkesLastTs, 1);
      if (dt >= 200) { // Only count if >= 200ms gap (real trade interval)
        const decay = Math.exp(-H_BETA * dt);
        this.hawkesIntensity = H_MU + decay * (this.hawkesIntensity - H_MU + H_ALPHA);
        this.hawkesLastTs = ts;
      }
      hawkes = clamp01((this.hawkesIntensity - H_MU) / (H_MU * 3));
    }

    // ── PIN ───────────────────────────────────────────────────────
    let pin = 0;
    if (this.pinBarCount >= 5) {
      const avgBuy = this.pinSumBuy * (1 - 0.95);
      const avgSell = this.pinSumSell * (1 - 0.95);
      const eps = Math.min(avgBuy, avgSell) * 0.8;
      const mu = Math.abs(avgBuy - avgSell);
      const alpha = this.pinBarCount > 0 ? this.pinSig / this.pinBarCount : 0;
      const denom = alpha * mu + eps + eps;
      pin = denom > 0 ? (alpha * mu) / denom : 0;
    }

    // ── Spread ────────────────────────────────────────────────────
    const bestBid = quote.depth?.buy?.[0]?.price || quote.ltp;
    const bestAsk = quote.depth?.sell?.[0]?.price || quote.ltp;
    const mid = (bestBid + bestAsk) / 2 || quote.ltp;
    const spreadBps = mid > 0 ? ((bestAsk - bestBid) / mid) * 10000 : 0;
    let bidDepth = 0, askDepth = 0;
    (quote.depth?.buy || []).forEach(l => bidDepth += (l.price || 0) * (l.quantity || 0));
    (quote.depth?.sell || []).forEach(l => askDepth += (l.price || 0) * (l.quantity || 0));
    const depthImbalance = (bidDepth + askDepth > 0) ? (bidDepth - askDepth) / (bidDepth + askDepth) : 0;

    // ── Toxic Score ──────────────────────────────────────────────
    let toxicScore, crashRisk;

    if (!marketActive && this.tickCount < 5) {
      // Authentic End-Of-Day Analysis
      const volatilityBps = quote.open > 0 ? ((quote.high - quote.low) / quote.open) * 10000 : 0;
      const trend = quote.open > 0 ? ((quote.close - quote.open) / quote.open) * 100 : 0;
      
      const volScore = Math.min(1, volatilityBps / 300) * 40; // up to 40 pts from 3% vol
      const trendScore = Math.min(1, Math.abs(trend) / 3) * 30; // up to 30 pts from 3% trend
      const imbScore = Math.min(1, Math.abs(depthImbalance)) * 30; // up to 30 pts from skew
      
      toxicScore = Math.round(volScore + trendScore + imbScore);
      crashRisk = 0; // Can't assess crash risk from a snapshot
    } else {
      // REAL COMPUTATION — enough live data flowing
      const v = clamp01(vpin / 0.6), o = clamp01(Math.abs(this.ewmaOfi) / 0.5), l = clamp01(kyleLambda / 5);
      const a = clamp01(amihud / 100), h = clamp01(hawkes), p = clamp01(pin / 0.5), s = clamp01(spreadBps / 50);
      const logit = -2.5 + 3.5*v + 2.8*o + 2.0*l + 1.5*a + 1.8*h + 1.5*p + 1.0*s;
      toxicScore = Math.min(100, Math.max(0, Math.round(100 / (1 + Math.exp(-logit)))));

      // Crash risk (histogram percentile)
      crashRisk = 0;
      if (this.histTotal >= 5) {
        const vpinIdx = Math.min(31, Math.max(0, Math.floor(vpin * 32)));
        let below = 0; for (let i = 0; i < vpinIdx; i++) below += this.histBins[i];
        below += this.histBins[vpinIdx] / 2;
        const pct = below / this.histTotal;
        const spreadSig = clamp01(spreadBps / 30);
        const amihudSpike = this.ewmaAmihudInit && this.ewmaAmihud > 0 ? clamp01(amihud / (this.ewmaAmihud * 3)) : 0;
        const cLogit = -2.0 + 4.0*pct + 2.5*spreadSig + 2.0*amihudSpike;
        crashRisk = Math.min(100, Math.max(0, Math.round(100 / (1 + Math.exp(-cLogit)))));
      }
    }

    if (this.scoreHistory.length >= 200) this.scoreHistory.shift();
    if (this.crashHistory.length >= 200) this.crashHistory.shift();
    this.scoreHistory.push(toxicScore);
    this.crashHistory.push(crashRisk);

    this.lastQuote = JSON.parse(JSON.stringify(quote));
    this.updateCount++;

    const computeTimeMs = performance.now() - t0;
    const recommendation = !marketActive && this.tickCount < 5
      ? this._getMarketClosedRec(toxicScore, spreadBps, depthImbalance)
      : this._getRec(toxicScore, crashRisk, vpin, this.ewmaOfi, kyleLambda, pin);

    return {
      success: true, ltp: quote.ltp, volume: quote.volume,
      vpin: parseFloat(vpin.toFixed(4)), ofi: parseFloat(this.ewmaOfi.toFixed(4)),
      kyleLambda: parseFloat(kyleLambda.toFixed(4)), amihud: parseFloat(amihud.toFixed(4)),
      hawkes: parseFloat(hawkes.toFixed(4)), pin: parseFloat(pin.toFixed(4)),
      toxicScore, crashRisk,
      marketActive,
      spread: { spreadBps: parseFloat(spreadBps.toFixed(2)), mid: parseFloat(mid.toFixed(2)), depthImbalance: parseFloat(depthImbalance.toFixed(4)), bidDepth, askDepth },
      volumeBars: this.volumeBars.slice(-50),
      volumeBarSize: this.barSize, barProgress: this.barAcc.totalVol / this.barSize,
      totalBarsCompleted: this.volumeBars.length,
      ofiHistory: this.ofiHistory.slice(-50),
      scoreHistory: this.scoreHistory.slice(-50),
      crashRiskHistory: this.crashHistory.slice(-50),
      recommendation, computeTimeMs: parseFloat(computeTimeMs.toFixed(3)),
      updateCount: this.updateCount, timestamp: new Date().toISOString(),
      transport: 'websocket', engine: 'js-o1-fallback',
    };
  }

  _getMarketClosedRec(score, spreadBps, depthImbalance) {
    const imb = Math.abs(depthImbalance);
    const direction = depthImbalance > 0 ? 'buy-side heavy' : depthImbalance < 0 ? 'sell-side heavy' : 'balanced';
    return {
      label: 'MARKET CLOSED',
      action: 'No live trading activity. Showing last session snapshot.',
      color: '#d4af37',
      details: `Closing order book is ${direction} (imbalance: ${(imb*100).toFixed(1)}%). Spread: ${spreadBps.toFixed(1)} bps. Real-time scores will activate when market opens (Mon-Fri 9:15 AM IST).`,
      toxicScore: score,
      crashRisk: 0,
    };
  }

  _getRec(score, crashRisk, vpin, ofi, lambda, pin) {
    if (score <= 25) return { label: 'SAFE', action: 'Normal market conditions. No signs of manipulation.', color: '#22c55e', details: 'Order flow looks clean. Safe to trade.', toxicScore: score, crashRisk };
    if (score <= 50) return { label: 'CAUTION', action: 'Mixed signals detected.', color: '#eab308', details: `Flow shows ${ofi > 0 ? 'buying' : 'selling'} pressure. Reduce size, tighten stops.`, toxicScore: score, crashRisk };
    if (score <= 70) return { label: 'TOXIC', action: 'Significant toxic flow detected.', color: '#f97316', details: `VPIN at ${(vpin*100).toFixed(1)}%. Avoid new positions.`, toxicScore: score, crashRisk };
    if (score <= 85) return { label: 'DANGER', action: 'Extreme toxic flow. EXIT positions.', color: '#ef4444', details: `PIN: ${(pin*100).toFixed(1)}%. Stop-loss slippage risk HIGH.`, toxicScore: score, crashRisk };
    return { label: 'CRASH RISK', action: 'CRITICAL: Flash crash conditions.', color: '#dc2626', details: 'EXIT ALL. Do NOT buy the dip.', toxicScore: score, crashRisk };
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// PUBLIC API — unified interface for both engines
// ══════════════════════════════════════════════════════════════════════════════

const engineSessions = new Map();

export async function initEngine() {
  return loadWasm();
}

export function getOrCreateEngine(instrumentKey, barSize = 5000) {
  if (!engineSessions.has(instrumentKey)) {
    const engine = wasmReady
      ? new WasmToxicEngine(barSize)
      : new JSFallbackEngine(barSize);
    engineSessions.set(instrumentKey, { engine, barSize });
  }
  return engineSessions.get(instrumentKey);
}

export function processQuote(instrumentKey, quote, barSize = 5000) {
  const session = getOrCreateEngine(instrumentKey, barSize);
  if (barSize !== session.barSize) {
    session.barSize = barSize;
    session.engine.barSize = barSize;
  }
  return session.engine.process(quote);
}

export function calibrateBarSize(avgDailyVolume) {
  const barSize = Math.max(100, Math.round(avgDailyVolume / 200));
  return Math.round(barSize / 100) * 100;
}

export function isWasmActive() {
  return wasmReady;
}
