




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
    if (this.size  0) return [];
    if (this.size < this.capacity) {
      return this.buffer.slice(0, this.size);
    }
    
    return [...this.buffer.slice(this.head), ...this.buffer.slice(0, this.head)];
  }

  last(n = 1) {
    const arr = this.toArray();
    return arr.slice(Math.max(0, arr.length  n));
  }

  get latest() {
    if (this.size  0) return null;
    const idx = (this.head  1 + this.capacity) % this.capacity;
    return this.buffer[idx];
  }
}





const sessions = {};

function getSession(instrumentKey, config = {}) {
  if (!sessions[instrumentKey]) {
    const volumeBarSize = config.volumeBarSize || 5000; 
    sessions[instrumentKey] = {
      
      volumeBarSize,
      
      lastQuote: null,
      cumulativeVolume: 0,
      barAccumulator: { open: 0, high: -Infinity, low: Infinity, close: 0, buyVol: 0, sellVol: 0, totalVol: 0, trades: 0 },
      
      volumeBars: new RingBuffer(200),
      
      vpinWindow: new RingBuffer(50),
      
      lastBidQty: 0,
      lastAskQty: 0,
      ofiHistory: new RingBuffer(100),
      
      priceChanges: new RingBuffer(50),
      oiChanges: new RingBuffer(50),
      
      amihudHistory: new RingBuffer(50),
      
      tradeTimestamps: new RingBuffer(200),
      hawkesHistory: new RingBuffer(50),
      
      buyArrivals: new RingBuffer(100),
      sellArrivals: new RingBuffer(100),
      
      scoreHistory: new RingBuffer(100),
      crashRiskHistory: new RingBuffer(100),
      
      createdAt: Date.now(),
      updateCount: 0,
    };
  }
  return sessions[instrumentKey];
}






function classifyVolume(currentQuote, lastQuote) {
  if (!lastQuote) return { buyVol: 0, sellVol: 0 };

  const volumeDelta = Math.max(0, currentQuote.volume  lastQuote.volume);
  if (volumeDelta  0) return { buyVol: 0, sellVol: 0 };

  
  const currentMid = (currentQuote.depth.buy[0]?.price + currentQuote.depth.sell[0]?.price) / 2 || currentQuote.ltp;
  const lastMid = (lastQuote.depth.buy[0]?.price + lastQuote.depth.sell[0]?.price) / 2 || lastQuote.ltp;

  
  
  const priceChange = currentMid  lastMid;
  const spread = (currentQuote.depth.sell[0]?.price || currentQuote.ltp) 
                 (currentQuote.depth.buy[0]?.price || currentQuote.ltp);
  const sigma = Math.max(spread, 0.01); 

  
  const z = priceChange / sigma;
  const buyFraction = 1 / (1 + Math.exp(-1.7 * z)); 

  return {
    buyVol: Math.round(volumeDelta * buyFraction),
    sellVol: Math.round(volumeDelta * (1  buyFraction)),
  };
}





function updateVolumeBars(session, quote) {
  const { buyVol, sellVol } = classifyVolume(quote, session.lastQuote);
  const totalVol = buyVol + sellVol;
  const acc = session.barAccumulator;

  if (acc.totalVol  0) {
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

  
  while (acc.totalVol >= session.volumeBarSize) {
    const bar = {
      open: acc.open,
      high: acc.high,
      low: acc.low,
      close: acc.close,
      buyVol: Math.min(acc.buyVol, session.volumeBarSize),
      sellVol: Math.min(acc.sellVol, session.volumeBarSize),
      totalVol: session.volumeBarSize,
      vpin: 0, 
      timestamp: Date.now(),
      barIndex: session.volumeBars.size,
    };

    
    bar.vpin = Math.abs(bar.buyVol  bar.sellVol) / bar.totalVol;

    session.volumeBars.push(bar);
    session.vpinWindow.push(bar.vpin);
    completedBars.push(bar);

    
    const overflow = acc.totalVol  session.volumeBarSize;
    acc.open = acc.close;
    acc.high = acc.close;
    acc.low = acc.close;
    acc.buyVol = Math.round(overflow * (buyVol / Math.max(totalVol, 1)));
    acc.sellVol = overflow  acc.buyVol;
    acc.totalVol = overflow;
    acc.trades = 0;
  }

  return completedBars;
}





function computeRollingVPIN(session, window = 50) {
  const vpins = session.vpinWindow.last(window);
  if (vpins.length  0) return 0;
  return vpins.reduce((a, b) => a + b, 0) / vpins.length;
}




function computeOFI(session, quote) {
  const bidQty = quote.depth.buy.reduce((s, l) => s + l.quantity, 0);
  const askQty = quote.depth.sell.reduce((s, l) => s + l.quantity, 0);

  const deltaB = bidQty  session.lastBidQty;
  const deltaA = askQty  session.lastAskQty;
  const ofi = deltaB  deltaA;

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





function computeKyleLambda(session, quote) {
  if (!session.lastQuote) return 0;

  const priceChange = quote.ltp  session.lastQuote.ltp;
  const bidQty = quote.depth.buy.reduce((s, l) => s + l.quantity, 0);
  const askQty = quote.depth.sell.reduce((s, l) => s + l.quantity, 0);
  const lastBidQty = session.lastQuote.depth.buy.reduce((s, l) => s + l.quantity, 0);
  const lastAskQty = session.lastQuote.depth.sell.reduce((s, l) => s + l.quantity, 0);
  const oiChange = (bidQty  askQty)  (lastBidQty  lastAskQty);

  session.priceChanges.push(priceChange);
  session.oiChanges.push(oiChange);

  const prices = session.priceChanges.toArray();
  const ois = session.oiChanges.toArray();
  if (prices.length < 5) return 0;

  
  const n = prices.length;
  const meanP = prices.reduce((a, b) => a + b, 0) / n;
  const meanOI = ois.reduce((a, b) => a + b, 0) / n;

  let cov = 0, varOI = 0;
  for (let i = 0; i < n; i++) {
    const dp = prices[i]  meanP;
    const doi = ois[i]  meanOI;
    cov += dp * doi;
    varOI += doi * doi;
  }

  return varOI > 0 ? Math.abs(cov / varOI) : 0;
}





function computeAmihud(session, quote) {
  if (!session.lastQuote || session.lastQuote.ltp  0) return 0;

  const ret = Math.abs((quote.ltp  session.lastQuote.ltp) / session.lastQuote.ltp);
  const volumeDelta = Math.max(quote.volume  (session.lastQuote.volume || 0), 1);
  const amihud = ret / volumeDelta * 1e6; 

  session.amihudHistory.push(amihud);
  return amihud;
}






function computeHawkes(session) {
  const timestamps = session.tradeTimestamps.toArray();
  if (timestamps.length < 10) return 0;

  
  const interArrivals = [];
  for (let i = 1; i < timestamps.length; i++) {
    interArrivals.push(timestamps[i]  timestamps[i  1]);
  }

  const mean = interArrivals.reduce((a, b) => a + b, 0) / interArrivals.length;
  if (mean  0) return 0;

  const variance = interArrivals.reduce((a, t) => a + (t  mean) ** 2, 0) / interArrivals.length;
  
  const cov2 = variance / (mean * mean);

  
  const hawkes = Math.min(1, Math.max(0, (cov2  1) / 4));

  session.hawkesHistory.push(hawkes);
  return hawkes;
}






function computePIN(session) {
  const bars = session.volumeBars.last(30);
  if (bars.length < 5) return 0;

  
  const buyRates = bars.map(b => b.buyVol);
  const sellRates = bars.map(b => b.sellVol);

  const avgBuy = buyRates.reduce((a, b) => a + b, 0) / bars.length;
  const avgSell = sellRates.reduce((a, b) => a + b, 0) / bars.length;

  
  const epsilonB = Math.min(avgBuy, avgSell) * 0.8;
  const epsilonS = Math.min(avgBuy, avgSell) * 0.8;

  
  const mu = Math.abs(avgBuy  avgSell);

  
  const significantBars = bars.filter(b => b.vpin > 0.3).length;
  const alpha = significantBars / bars.length;

  
  const denom = alpha * mu + epsilonB + epsilonS;
  return denom > 0 ? (alpha * mu) / denom : 0;
}




function computeSpreadMetrics(quote) {
  const bestBid = quote.depth.buy[0]?.price || 0;
  const bestAsk = quote.depth.sell[0]?.price || 0;
  const mid = (bestBid + bestAsk) / 2 || quote.ltp;
  const spread = bestAsk  bestBid;
  const spreadBps = mid > 0 ? (spread / mid) * 10000 : 0;

  const bidDepth = quote.depth.buy.reduce((s, l) => s + l.quantity * l.price, 0);
  const askDepth = quote.depth.sell.reduce((s, l) => s + l.quantity * l.price, 0);
  const depthImbalance = (bidDepth + askDepth) > 0
    ? (bidDepth  askDepth) / (bidDepth + askDepth)
    : 0;

  return { spread, spreadBps, mid, depthImbalance, bidDepth, askDepth };
}





function computeToxicScore(vpin, ofi, lambda, amihud, hawkes, pin, spreadBps) {
  
  const vpinNorm = Math.min(1, vpin / 0.6);         
  const ofiNorm = Math.min(1, Math.abs(ofi) / 0.5); 
  const lambdaNorm = Math.min(1, lambda / 5);        
  const amihudNorm = Math.min(1, amihud / 100);      
  const hawkesNorm = hawkes;                          
  const pinNorm = Math.min(1, pin / 0.5);             
  const spreadNorm = Math.min(1, spreadBps / 50);     

  
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





function computeCrashRisk(session, vpin, spreadBps, amihud) {
  const vpinHistory = session.vpinWindow.toArray();
  if (vpinHistory.length < 5) return 0;

  
  const sorted = [...vpinHistory].sort((a, b) => a  b);
  const rank = sorted.filter(v => v < vpin).length;
  const vpinPercentile = rank / sorted.length;

  
  const bars = session.volumeBars.last(10);
  let volumeAccel = 0;
  if (bars.length >= 4) {
    const recentGap = bars.slice(-2).reduce((s, b) => s + (Date.now()  b.timestamp), 0) / 2;
    const olderGap = bars.slice(0, 2).reduce((s, b) => s + (Date.now()  b.timestamp), 0) / 2;
    volumeAccel = olderGap > 0 ? Math.min(1, recentGap / olderGap) : 0;
  }

  
  const spreadSignal = Math.min(1, spreadBps / 30);

  
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
    details = `Order flow shows ${ofi > 0 ? __STRING_139694e0f0cc4dc091d1b3c6b7958899__ : __STRING_ea6229b03eb04879bf49d15bae071c31__} pressure. Consider reducing position size by 30-50%. Use tighter stop-losses.`;
  } else if (toxicScore <= 70) {
    label = 'TOXIC';
    color = '#ff6b35';
    action = 'Significant informed flow detected. Institutional players likely active.';
    details = `VPIN at ${(vpin * 100).toFixed(1)}% — above normal. Kyle__STRING_e7a6939e5d194045b634f6b123145642__high__STRING_d966f5fb18a74fe3af5af9a0524bd8e1__moderate'} price impact. Avoid new positions. Existing positions: tighten stops to 50%.`;
  } else if (toxicScore <= 85) {
    label = 'DANGER';
    color = '#ff3b57';
    action = 'Institutional manipulation highly likely. Extreme adverse selection risk.';
    details = `PIN estimate: ${(pin * 100).toFixed(1)}%. Order flow is heavily ${ofi > 0 ? __STRING_c3a325fcda394bf98d22c79c6e05c556__ : __STRING_c80ceba8c5484d99af3490d88dbdc3cb__}-skewed. Stop-loss slippage risk is HIGH. Consider exiting positions immediately.`;
  } else {
    label = 'CRASH RISK';
    color = '#ff0040';
    action = 'CRITICAL: VPIN at extreme levels. Volatility collapse / flash crash possible.';
    details = `Historical precedent (Flash Crash 2010, Feb 2018 VIX-mageddon): VPIN at these levels preceded violent moves where stop-losses could NOT execute. EXIT ALL POSITIONS. Do NOT attempt to __STRING_da3dc88f1f82464c98c459bc2886697e__`;
  }

  if (crashRisk > 70) {
    details += ' ️ CRASH RISK ELEVATED: Liquidity is evaporating. Even stop-loss orders may not save you — consider market-on-close orders only.';
  }

  return { label, action, color, details, toxicScore, crashRisk };
}






export function analyzeQuote(instrumentKey, quote, config = {}) {
  const startMs = performance.now();
  const session = getSession(instrumentKey, config);

  
  session.tradeTimestamps.push(Date.now());

  
  const newBars = updateVolumeBars(session, quote);

  
  const vpin = computeRollingVPIN(session);

  
  const ofi = computeOFI(session, quote);

  
  const lambda = computeKyleLambda(session, quote);

  
  const amihud = computeAmihud(session, quote);

  
  const hawkes = computeHawkes(session);

  
  const pin = computePIN(session);

  
  const spreadMetrics = computeSpreadMetrics(quote);

  
  const toxicScore = computeToxicScore(vpin, ofi, lambda, amihud, hawkes, pin, spreadMetrics.spreadBps);
  const crashRisk = computeCrashRisk(session, vpin, spreadMetrics.spreadBps, amihud);

  
  const recommendation = generateRecommendation(toxicScore, crashRisk, vpin, ofi, lambda, pin);

  
  session.scoreHistory.push(toxicScore);
  session.crashRiskHistory.push(crashRisk);

  
  session.lastQuote = JSON.parse(JSON.stringify(quote));
  session.updateCount++;

  const computeMs = performance.now()  startMs;

  return {
    
    vpin: parseFloat(vpin.toFixed(4)),
    ofi: parseFloat(ofi.toFixed(4)),
    kyleLambda: parseFloat(lambda.toFixed(4)),
    amihud: parseFloat(amihud.toFixed(4)),
    hawkes: parseFloat(hawkes.toFixed(4)),
    pin: parseFloat(pin.toFixed(4)),

    
    spread: spreadMetrics,

    
    toxicScore,
    crashRisk,

    
    recommendation,

    
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

    
    ofiHistory: session.ofiHistory.last(50).map(o => ({
      normalized: parseFloat(o.normalized.toFixed(4)),
      bidQty: o.bidQty,
      askQty: o.askQty,
      timestamp: o.timestamp,
    })),

    
    scoreHistory: session.scoreHistory.last(50),
    crashRiskHistory: session.crashRiskHistory.last(50),

    
    ltp: quote.ltp,
    volume: quote.volume,

    
    barProgress: session.barAccumulator.totalVol / session.volumeBarSize,
    volumeBarSize: session.volumeBarSize,
    totalBarsCompleted: session.volumeBars.size,

    
    updateCount: session.updateCount,
    computeTimeMs: parseFloat(computeMs.toFixed(2)),
  };
}


export function calibrateBarSize(avgDailyVolume) {
  
  const barSize = Math.max(100, Math.round(avgDailyVolume / 200));
  
  return Math.round(barSize / 100) * 100;
}
