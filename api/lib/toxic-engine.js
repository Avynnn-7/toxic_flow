/**
 * toxic-engine.js
 * ===============
 * Real-time toxic flow detection engine using stochastic calculus models.
 *
 * Algorithms:
 *   1. Volume Bars (volume clock — not time clock)
 *   2. VPIN (Volume-Synchronized Probability of Informed Trading)
 *   3. Bulk Volume Classification (BVC)
 *   4. Kyle's Lambda (price impact coefficient)
 *   5. Order Flow Imbalance (OFI)
 *   6. Amihud Illiquidity Ratio
 *   7. Hawkes Process clustering coefficient
 *   8. PIN approximation (Poisson arrival model)
 *   9. Composite Toxic Score (0-100) & Crash Risk Score
 *
 * Performance target: < 3ms full computation per update.
 * All state held in ring buffers for O(1) amortized updates.
 */

// ══════════════════════════════════════════════════════════════════════════════
// RING BUFFER — Fixed-size circular buffer for O(1) push/iterate
// ══════════════════════════════════════════════════════════════════════════════
class RingBuffer {
  constructor(capacity) {
    this.capacity = capacity;
    this.buffer = new Array(capacity);
    this.head = 0;
    this.size = 0;
  }

  push(item) {
    this.buffer[this.head] = item;
    this.head = (this.head + 1) % this.capacity;
    if (this.size < this.capacity) this.size++;
  }

  toArray() {
    if (this.size === 0) return [];
    if (this.size < this.capacity) {
      return this.buffer.slice(0, this.size);
    }
    // Wrap-around: oldest is at head, newest is at head-1
    return [...this.buffer.slice(this.head), ...this.buffer.slice(0, this.head)];
  }

  last(n = 1) {
    const arr = this.toArray();
    return arr.slice(Math.max(0, arr.length - n));
  }

  get latest() {
    if (this.size === 0) return null;
    const idx = (this.head - 1 + this.capacity) % this.capacity;
    return this.buffer[idx];
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// GLOBAL SESSION STORE — Keyed by instrument, persists across serverless calls
// Uses Vercel's in-memory caching (same lambda reuse = same state)
// ══════════════════════════════════════════════════════════════════════════════
const sessions = {};

function getSession(instrumentKey, config = {}) {
  if (!sessions[instrumentKey]) {
    const volumeBarSize = config.volumeBarSize || 5000; // shares per bar
    sessions[instrumentKey] = {
      // Config
      volumeBarSize,
      // Raw tick accumulator
      lastQuote: null,
      cumulativeVolume: 0,
      barAccumulator: { open: 0, high: -Infinity, low: Infinity, close: 0, buyVol: 0, sellVol: 0, totalVol: 0, trades: 0 },
      // Volume bars
      volumeBars: new RingBuffer(200),
      // VPIN state
      vpinWindow: new RingBuffer(50),
      // OFI state
      lastBidQty: 0,
      lastAskQty: 0,
      ofiHistory: new RingBuffer(100),
      // Kyle's Lambda regression buffer
      priceChanges: new RingBuffer(50),
      oiChanges: new RingBuffer(50),
      // Amihud
      amihudHistory: new RingBuffer(50),
      // Hawkes process
      tradeTimestamps: new RingBuffer(200),
      hawkesHistory: new RingBuffer(50),
      // PIN state
      buyArrivals: new RingBuffer(100),
      sellArrivals: new RingBuffer(100),
      // Score history
      scoreHistory: new RingBuffer(100),
      crashRiskHistory: new RingBuffer(100),
      // Timestamps
      createdAt: Date.now(),
      updateCount: 0,
    };
  }
  return sessions[instrumentKey];
}

// ══════════════════════════════════════════════════════════════════════════════
// BULK VOLUME CLASSIFICATION (BVC)
// Classifies a volume delta as buy or sell using the Lee-Ready tick rule
// approximation via mid-price change direction.
// ══════════════════════════════════════════════════════════════════════════════
function classifyVolume(currentQuote, lastQuote) {
  if (!lastQuote) return { buyVol: 0, sellVol: 0 };

  const volumeDelta = Math.max(0, currentQuote.volume - lastQuote.volume);
  if (volumeDelta === 0) return { buyVol: 0, sellVol: 0 };

  // Mid-price method: if price went up, classify as buy; down = sell
  const currentMid = (currentQuote.depth.buy[0]?.price + currentQuote.depth.sell[0]?.price) / 2 || currentQuote.ltp;
  const lastMid = (lastQuote.depth.buy[0]?.price + lastQuote.depth.sell[0]?.price) / 2 || lastQuote.ltp;

  // BVC uses a probabilistic split based on normalized price change
  // Z = ΔP / σ, then buy_frac = Φ(Z)
  const priceChange = currentMid - lastMid;
  const spread = (currentQuote.depth.sell[0]?.price || currentQuote.ltp) -
                 (currentQuote.depth.buy[0]?.price || currentQuote.ltp);
  const sigma = Math.max(spread, 0.01); // avoid division by zero

  // Approximate normal CDF using fast approximation
  const z = priceChange / sigma;
  const buyFraction = 1 / (1 + Math.exp(-1.7 * z)); // logistic approximation to Φ(z)

  return {
    buyVol: Math.round(volumeDelta * buyFraction),
    sellVol: Math.round(volumeDelta * (1 - buyFraction)),
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// VOLUME BAR CONSTRUCTION
// Creates a new bar when cumulative volume exceeds threshold
// ══════════════════════════════════════════════════════════════════════════════
function updateVolumeBars(session, quote) {
  const { buyVol, sellVol } = classifyVolume(quote, session.lastQuote);
  const totalVol = buyVol + sellVol;
  const acc = session.barAccumulator;

  if (acc.totalVol === 0) {
    acc.open = quote.ltp;
    acc.high = quote.ltp;
    acc.low = quote.ltp;
  }

  acc.high = Math.max(acc.high, quote.ltp);
  acc.low = Math.min(acc.low, quote.ltp);
  acc.close = quote.ltp;
  acc.buyVol += buyVol;
  acc.sellVol += sellVol;
  acc.totalVol += totalVol;
  acc.trades++;

  const completedBars = [];

  // Complete bars when volume threshold crossed
  while (acc.totalVol >= session.volumeBarSize) {
    const bar = {
      open: acc.open,
      high: acc.high,
      low: acc.low,
      close: acc.close,
      buyVol: Math.min(acc.buyVol, session.volumeBarSize),
      sellVol: Math.min(acc.sellVol, session.volumeBarSize),
      totalVol: session.volumeBarSize,
      vpin: 0, // computed below
      timestamp: Date.now(),
      barIndex: session.volumeBars.size,
    };

    // VPIN for this bar
    bar.vpin = Math.abs(bar.buyVol - bar.sellVol) / bar.totalVol;

    session.volumeBars.push(bar);
    session.vpinWindow.push(bar.vpin);
    completedBars.push(bar);

    // Carry overflow to next bar
    const overflow = acc.totalVol - session.volumeBarSize;
    acc.open = acc.close;
    acc.high = acc.close;
    acc.low = acc.close;
    acc.buyVol = Math.round(overflow * (buyVol / Math.max(totalVol, 1)));
    acc.sellVol = overflow - acc.buyVol;
    acc.totalVol = overflow;
    acc.trades = 0;
  }

  return completedBars;
}

// ══════════════════════════════════════════════════════════════════════════════
// ROLLING VPIN
// Average VPIN over last N volume bars
// ══════════════════════════════════════════════════════════════════════════════
function computeRollingVPIN(session, window = 50) {
  const vpins = session.vpinWindow.last(window);
  if (vpins.length === 0) return 0;
  return vpins.reduce((a, b) => a + b, 0) / vpins.length;
}

// ══════════════════════════════════════════════════════════════════════════════
// ORDER FLOW IMBALANCE (OFI)
// ══════════════════════════════════════════════════════════════════════════════
function computeOFI(session, quote) {
  const bidQty = quote.depth.buy.reduce((s, l) => s + l.quantity, 0);
  const askQty = quote.depth.sell.reduce((s, l) => s + l.quantity, 0);

  const deltaB = bidQty - session.lastBidQty;
  const deltaA = askQty - session.lastAskQty;
  const ofi = deltaB - deltaA;

  session.lastBidQty = bidQty;
  session.lastAskQty = askQty;

  const totalDepth = Math.max(bidQty + askQty, 1);
  const normalizedOFI = ofi / totalDepth;

  session.ofiHistory.push({
    raw: ofi,
    normalized: normalizedOFI,
    bidQty,
    askQty,
    timestamp: Date.now(),
  });

  return normalizedOFI;
}

// ══════════════════════════════════════════════════════════════════════════════
// KYLE'S LAMBDA (Price Impact Coefficient)
// λ = Cov(ΔP, ΔOI) / Var(ΔOI) via OLS regression
// ══════════════════════════════════════════════════════════════════════════════
function computeKyleLambda(session, quote) {
  if (!session.lastQuote) return 0;

  const priceChange = quote.ltp - session.lastQuote.ltp;
  const bidQty = quote.depth.buy.reduce((s, l) => s + l.quantity, 0);
  const askQty = quote.depth.sell.reduce((s, l) => s + l.quantity, 0);
  const lastBidQty = session.lastQuote.depth.buy.reduce((s, l) => s + l.quantity, 0);
  const lastAskQty = session.lastQuote.depth.sell.reduce((s, l) => s + l.quantity, 0);
  const oiChange = (bidQty - askQty) - (lastBidQty - lastAskQty);

  session.priceChanges.push(priceChange);
  session.oiChanges.push(oiChange);

  const prices = session.priceChanges.toArray();
  const ois = session.oiChanges.toArray();
  if (prices.length < 5) return 0;

  // OLS: λ = Cov(ΔP, ΔOI) / Var(ΔOI)
  const n = prices.length;
  const meanP = prices.reduce((a, b) => a + b, 0) / n;
  const meanOI = ois.reduce((a, b) => a + b, 0) / n;

  let cov = 0, varOI = 0;
  for (let i = 0; i < n; i++) {
    const dp = prices[i] - meanP;
    const doi = ois[i] - meanOI;
    cov += dp * doi;
    varOI += doi * doi;
  }

  return varOI > 0 ? Math.abs(cov / varOI) : 0;
}

// ══════════════════════════════════════════════════════════════════════════════
// AMIHUD ILLIQUIDITY RATIO
// ILLIQ = |Return| / Volume
// ══════════════════════════════════════════════════════════════════════════════
function computeAmihud(session, quote) {
  if (!session.lastQuote || session.lastQuote.ltp === 0) return 0;

  const ret = Math.abs((quote.ltp - session.lastQuote.ltp) / session.lastQuote.ltp);
  const volumeDelta = Math.max(quote.volume - (session.lastQuote.volume || 0), 1);
  const amihud = ret / volumeDelta * 1e6; // scale for readability

  session.amihudHistory.push(amihud);
  return amihud;
}

// ══════════════════════════════════════════════════════════════════════════════
// HAWKES PROCESS — Trade Clustering Coefficient
// Measures self-excitement: do trades cluster? High clustering = informed
// Approximation: ratio of inter-arrival variance to mean
// ══════════════════════════════════════════════════════════════════════════════
function computeHawkes(session) {
  const timestamps = session.tradeTimestamps.toArray();
  if (timestamps.length < 10) return 0;

  // Compute inter-arrival times
  const interArrivals = [];
  for (let i = 1; i < timestamps.length; i++) {
    interArrivals.push(timestamps[i] - timestamps[i - 1]);
  }

  const mean = interArrivals.reduce((a, b) => a + b, 0) / interArrivals.length;
  if (mean === 0) return 0;

  const variance = interArrivals.reduce((a, t) => a + (t - mean) ** 2, 0) / interArrivals.length;
  // Coefficient of variation squared — Poisson has CoV = 1, Hawkes > 1
  const cov2 = variance / (mean * mean);

  // Normalize: 0 = Poisson (no clustering), 1 = extreme clustering
  const hawkes = Math.min(1, Math.max(0, (cov2 - 1) / 4));

  session.hawkesHistory.push(hawkes);
  return hawkes;
}

// ══════════════════════════════════════════════════════════════════════════════
// PIN APPROXIMATION (Probability of Informed Trading)
// Using buy/sell arrival rates from recent volume bars
// PIN = α·μ / (α·μ + ε_b + ε_s)
// ══════════════════════════════════════════════════════════════════════════════
function computePIN(session) {
  const bars = session.volumeBars.last(30);
  if (bars.length < 5) return 0;

  // Estimate buy/sell arrival rates
  const buyRates = bars.map(b => b.buyVol);
  const sellRates = bars.map(b => b.sellVol);

  const avgBuy = buyRates.reduce((a, b) => a + b, 0) / bars.length;
  const avgSell = sellRates.reduce((a, b) => a + b, 0) / bars.length;

  // Uninformed rates = minimum of buy/sell (floor)
  const epsilonB = Math.min(avgBuy, avgSell) * 0.8;
  const epsilonS = Math.min(avgBuy, avgSell) * 0.8;

  // Informed rate = excess of dominant side
  const mu = Math.abs(avgBuy - avgSell);

  // α = fraction of bars with significant imbalance
  const significantBars = bars.filter(b => b.vpin > 0.3).length;
  const alpha = significantBars / bars.length;

  // PIN formula
  const denom = alpha * mu + epsilonB + epsilonS;
  return denom > 0 ? (alpha * mu) / denom : 0;
}

// ══════════════════════════════════════════════════════════════════════════════
// SPREAD ANALYSIS — Bid-Ask spread dynamics
// ══════════════════════════════════════════════════════════════════════════════
function computeSpreadMetrics(quote) {
  const bestBid = quote.depth.buy[0]?.price || 0;
  const bestAsk = quote.depth.sell[0]?.price || 0;
  const mid = (bestBid + bestAsk) / 2 || quote.ltp;
  const spread = bestAsk - bestBid;
  const spreadBps = mid > 0 ? (spread / mid) * 10000 : 0;

  const bidDepth = quote.depth.buy.reduce((s, l) => s + l.quantity * l.price, 0);
  const askDepth = quote.depth.sell.reduce((s, l) => s + l.quantity * l.price, 0);
  const depthImbalance = (bidDepth + askDepth) > 0
    ? (bidDepth - askDepth) / (bidDepth + askDepth)
    : 0;

  return { spread, spreadBps, mid, depthImbalance, bidDepth, askDepth };
}

// ══════════════════════════════════════════════════════════════════════════════
// COMPOSITE TOXIC SCORE (0–100)
// Weighted combination of all metrics
// ══════════════════════════════════════════════════════════════════════════════
function computeToxicScore(vpin, ofi, lambda, amihud, hawkes, pin, spreadBps) {
  // Normalize each metric to [0, 1]
  const vpinNorm = Math.min(1, vpin / 0.6);         // VPIN > 0.6 = max toxic
  const ofiNorm = Math.min(1, Math.abs(ofi) / 0.5); // |OFI| > 0.5 = max toxic
  const lambdaNorm = Math.min(1, lambda / 5);        // λ > 5 = max toxic
  const amihudNorm = Math.min(1, amihud / 100);      // Amihud > 100 = max toxic
  const hawkesNorm = hawkes;                          // Already [0, 1]
  const pinNorm = Math.min(1, pin / 0.5);             // PIN > 0.5 = max toxic
  const spreadNorm = Math.min(1, spreadBps / 50);     // > 50bps = wide

  // Weighted combination
  const score = (
    0.25 * vpinNorm +
    0.20 * ofiNorm +
    0.15 * lambdaNorm +
    0.12 * amihudNorm +
    0.10 * hawkesNorm +
    0.10 * pinNorm +
    0.08 * spreadNorm
  ) * 100;

  return Math.round(Math.min(100, Math.max(0, score)));
}

// ══════════════════════════════════════════════════════════════════════════════
// CRASH RISK SCORE (0–100)
// Focuses on VPIN percentile + volume acceleration + spread widening
// ══════════════════════════════════════════════════════════════════════════════
function computeCrashRisk(session, vpin, spreadBps, amihud) {
  const vpinHistory = session.vpinWindow.toArray();
  if (vpinHistory.length < 5) return 0;

  // VPIN percentile in recent history
  const sorted = [...vpinHistory].sort((a, b) => a - b);
  const rank = sorted.filter(v => v < vpin).length;
  const vpinPercentile = rank / sorted.length;

  // Volume acceleration (are bars completing faster?)
  const bars = session.volumeBars.last(10);
  let volumeAccel = 0;
  if (bars.length >= 4) {
    const recentGap = bars.slice(-2).reduce((s, b) => s + (Date.now() - b.timestamp), 0) / 2;
    const olderGap = bars.slice(0, 2).reduce((s, b) => s + (Date.now() - b.timestamp), 0) / 2;
    volumeAccel = olderGap > 0 ? Math.min(1, recentGap / olderGap) : 0;
  }

  // Spread widening signal
  const spreadSignal = Math.min(1, spreadBps / 30);

  // Amihud spike
  const amihudArr = session.amihudHistory.toArray();
  let amihudSpike = 0;
  if (amihudArr.length > 5) {
    const amihudAvg = amihudArr.reduce((a, b) => a + b, 0) / amihudArr.length;
    amihudSpike = amihudAvg > 0 ? Math.min(1, amihud / (amihudAvg * 3)) : 0;
  }

  const crashRisk = (
    0.40 * vpinPercentile +
    0.25 * spreadSignal +
    0.20 * amihudSpike +
    0.15 * volumeAccel
  ) * 100;

  return Math.round(Math.min(100, Math.max(0, crashRisk)));
}

// ══════════════════════════════════════════════════════════════════════════════
// RECOMMENDATION ENGINE
// ══════════════════════════════════════════════════════════════════════════════
function generateRecommendation(toxicScore, crashRisk, vpin, ofi, lambda, pin) {
  let label, action, color, details;

  if (toxicScore <= 25) {
    label = 'SAFE';
    color = '#00ff88';
    action = 'Normal market conditions. Flow is predominantly uninformed/noise trading.';
    details = 'No significant institutional manipulation detected. Order book depth is balanced. Safe to trade with standard position sizing.';
  } else if (toxicScore <= 50) {
    label = 'CAUTION';
    color = '#ffaa00';
    action = 'Mixed signals detected. Slight institutional presence possible.';
    details = `Order flow shows ${ofi > 0 ? 'buying' : 'selling'} pressure. Consider reducing position size by 30-50%. Use tighter stop-losses.`;
  } else if (toxicScore <= 70) {
    label = 'TOXIC';
    color = '#ff6b35';
    action = 'Significant informed flow detected. Institutional players likely active.';
    details = `VPIN at ${(vpin * 100).toFixed(1)}% — above normal. Kyle's Lambda shows ${lambda > 2 ? 'high' : 'moderate'} price impact. Avoid new positions. Existing positions: tighten stops to 50%.`;
  } else if (toxicScore <= 85) {
    label = 'DANGER';
    color = '#ff3b57';
    action = 'Institutional manipulation highly likely. Extreme adverse selection risk.';
    details = `PIN estimate: ${(pin * 100).toFixed(1)}%. Order flow is heavily ${ofi > 0 ? 'buy' : 'sell'}-skewed. Stop-loss slippage risk is HIGH. Consider exiting positions immediately.`;
  } else {
    label = 'CRASH RISK';
    color = '#ff0040';
    action = 'CRITICAL: VPIN at extreme levels. Volatility collapse / flash crash possible.';
    details = `Historical precedent (Flash Crash 2010, Feb 2018 VIX-mageddon): VPIN at these levels preceded violent moves where stop-losses could NOT execute. EXIT ALL POSITIONS. Do NOT attempt to "buy the dip."`;
  }

  if (crashRisk > 70) {
    details += ' ⚠️ CRASH RISK ELEVATED: Liquidity is evaporating. Even stop-loss orders may not save you — consider market-on-close orders only.';
  }

  return { label, action, color, details, toxicScore, crashRisk };
}

// ══════════════════════════════════════════════════════════════════════════════
// MAIN ANALYSIS FUNCTION
// Takes a fresh quote, updates all models, returns full snapshot.
// Target: < 3ms execution time.
// ══════════════════════════════════════════════════════════════════════════════
export function analyzeQuote(instrumentKey, quote, config = {}) {
  const startMs = performance.now();
  const session = getSession(instrumentKey, config);

  // Record trade timestamp for Hawkes
  session.tradeTimestamps.push(Date.now());

  // 1. Build volume bars
  const newBars = updateVolumeBars(session, quote);

  // 2. VPIN (rolling)
  const vpin = computeRollingVPIN(session);

  // 3. OFI
  const ofi = computeOFI(session, quote);

  // 4. Kyle's Lambda
  const lambda = computeKyleLambda(session, quote);

  // 5. Amihud
  const amihud = computeAmihud(session, quote);

  // 6. Hawkes clustering
  const hawkes = computeHawkes(session);

  // 7. PIN
  const pin = computePIN(session);

  // 8. Spread metrics
  const spreadMetrics = computeSpreadMetrics(quote);

  // 9. Composite scores
  const toxicScore = computeToxicScore(vpin, ofi, lambda, amihud, hawkes, pin, spreadMetrics.spreadBps);
  const crashRisk = computeCrashRisk(session, vpin, spreadMetrics.spreadBps, amihud);

  // 10. Recommendation
  const recommendation = generateRecommendation(toxicScore, crashRisk, vpin, ofi, lambda, pin);

  // Store in history
  session.scoreHistory.push(toxicScore);
  session.crashRiskHistory.push(crashRisk);

  // Update last quote
  session.lastQuote = JSON.parse(JSON.stringify(quote));
  session.updateCount++;

  const computeMs = performance.now() - startMs;

  return {
    // Core metrics
    vpin: parseFloat(vpin.toFixed(4)),
    ofi: parseFloat(ofi.toFixed(4)),
    kyleLambda: parseFloat(lambda.toFixed(4)),
    amihud: parseFloat(amihud.toFixed(4)),
    hawkes: parseFloat(hawkes.toFixed(4)),
    pin: parseFloat(pin.toFixed(4)),

    // Spread
    spread: spreadMetrics,

    // Scores
    toxicScore,
    crashRisk,

    // Recommendation
    recommendation,

    // Volume bars (last 50 for chart)
    volumeBars: session.volumeBars.last(50).map(b => ({
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close,
      buyVol: b.buyVol,
      sellVol: b.sellVol,
      vpin: parseFloat(b.vpin.toFixed(4)),
      barIndex: b.barIndex,
    })),

    // OFI history (last 50)
    ofiHistory: session.ofiHistory.last(50).map(o => ({
      normalized: parseFloat(o.normalized.toFixed(4)),
      bidQty: o.bidQty,
      askQty: o.askQty,
      timestamp: o.timestamp,
    })),

    // Score history
    scoreHistory: session.scoreHistory.last(50),
    crashRiskHistory: session.crashRiskHistory.last(50),

    // Quote data
    ltp: quote.ltp,
    volume: quote.volume,

    // Bar accumulator progress
    barProgress: session.barAccumulator.totalVol / session.volumeBarSize,
    volumeBarSize: session.volumeBarSize,
    totalBarsCompleted: session.volumeBars.size,

    // Meta
    updateCount: session.updateCount,
    computeTimeMs: parseFloat(computeMs.toFixed(2)),
  };
}

// Auto-calibrate volume bar size from ADV
export function calibrateBarSize(avgDailyVolume) {
  // ~200 bars per day = good resolution
  const barSize = Math.max(100, Math.round(avgDailyVolume / 200));
  // Round to nearest 100
  return Math.round(barSize / 100) * 100;
}
