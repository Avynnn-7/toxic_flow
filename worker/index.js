




function normalCDF(z) {
  if (z < -8) return 0;
  if (z > 8) return 1;
  const a1=0.254829592,a2=-0.284496736,a3=1.421413741,a4=-1.453152027,a5=1.061405429,p=0.3275911;
  const sign = z >= 0 ? 1 : -1, az = Math.abs(z);
  const t = 1/(1+p*az);
  const phi = 0.3989422804014327 * Math.exp(-0.5*az*az);
  const cdf = 1  phi*(a1*t+a2*t*t+a3*t*t*t+a4*t*t*t*t+a5*t*t*t*t*t);
  return 0.5*(1+sign*(2*cdf-1));
}
function clamp01(x) { return x<0?0:x>1?1:x; }




const EWMA_VPIN_A=2/51, EWMA_AMIHUD_A=2/51, EWMA_OFI_A=2/31;
const WELFORD_D=0.98, H_MU=0.5, H_ALPHA=0.3, H_BETA=0.1;

class ToxicEngine {
  constructor(barSize = 5000) {
    this.volumeBarSize = barSize;
    this.lastQuote = null;
    this.barAcc = { open:0, high:-Infinity, low:Infinity, close:0, buyVol:0, sellVol:0, totalVol:0 };
    this.ewmaVpin=0; this.ewmaVpinInit=false;
    this.ewmaAmihud=0; this.ewmaAmihudInit=false;
    this.ewmaOfi=0; this.ewmaOfiInit=false;
    this.wMeanX=0; this.wMeanY=0; this.wCxy=0; this.wM2x=0; this.wN=0;
    this.hawkesI=H_MU; this.hawkesTs=0; this.hawkesInit=false;
    this.histBins=new Int32Array(32); this.histTotal=0;
    this.pinSumB=0; this.pinSumS=0; this.pinBC=0; this.pinSig=0;
    this.lastBQ=0; this.lastAQ=0;
    this.volumeBars=[]; this.ofiHistory=[]; this.scoreHistory=[]; this.crashHistory=[];
    this.updateCount=0;
  }

  process(quote) {
    const t0 = Date.now();
    let buyVol=0, sellVol=0;
    if (this.lastQuote) {
      const vd = Math.max(0, quote.volume  this.lastQuote.volume);
      if (vd > 0) {
        const cm = (quote.depth?.buy?.[0]?.price && quote.depth?.sell?.[0]?.price)
          ? (quote.depth.buy[0].price+quote.depth.sell[0].price)/2 : quote.ltp;
        const lm = (this.lastQuote.depth?.buy?.[0]?.price && this.lastQuote.depth?.sell?.[0]?.price)
          ? (this.lastQuote.depth.buy[0].price+this.lastQuote.depth.sell[0].price)/2 : this.lastQuote.ltp;
        const sp = Math.max((quote.depth?.sell?.[0]?.price||quote.ltp)-(quote.depth?.buy?.[0]?.price||quote.ltp), 0.01);
        const bf = normalCDF((cm-lm)/sp);
        buyVol = Math.round(vd*bf); sellVol = vd-buyVol;
      }
    }

    
    const total = buyVol+sellVol;
    if (!this.barAcc.totalVol) { this.barAcc.open=quote.ltp; this.barAcc.high=quote.ltp; this.barAcc.low=quote.ltp; }
    this.barAcc.high=Math.max(this.barAcc.high,quote.ltp);
    this.barAcc.low=Math.min(this.barAcc.low,quote.ltp);
    this.barAcc.close=quote.ltp; this.barAcc.buyVol+=buyVol; this.barAcc.sellVol+=sellVol; this.barAcc.totalVol+=total;

    while (this.barAcc.totalVol >= this.volumeBarSize) {
      const bar = { open:this.barAcc.open, high:this.barAcc.high, low:this.barAcc.low, close:this.barAcc.close,
        buyVol:Math.min(this.barAcc.buyVol,this.volumeBarSize), sellVol:Math.min(this.barAcc.sellVol,this.volumeBarSize),
        totalVol:this.volumeBarSize, barIndex:this.volumeBars.length,
        vpin:Math.abs(this.barAcc.buyVol-this.barAcc.sellVol)/this.volumeBarSize };
      if (this.volumeBars.length>=200) this.volumeBars.shift();
      this.volumeBars.push(bar);

      if (!this.ewmaVpinInit) { this.ewmaVpin=bar.vpin; this.ewmaVpinInit=true; }
      else this.ewmaVpin = EWMA_VPIN_A*bar.vpin + (1-EWMA_VPIN_A)*this.ewmaVpin;

      const idx = Math.min(31, Math.max(0, Math.floor(bar.vpin*32)));
      this.histBins[idx]++; this.histTotal++;

      this.pinSumB=this.pinSumB*0.95+bar.buyVol; this.pinSumS=this.pinSumS*0.95+bar.sellVol;
      this.pinBC++; if (bar.vpin>0.3) this.pinSig++;
      if (this.pinBC>30) { this.pinSig=Math.round(this.pinSig*0.95); this.pinBC=30; }

      const overflow = this.barAcc.totalVol-this.volumeBarSize;
      const frac = total>0?buyVol/total:0.5;
      this.barAcc = { open:this.barAcc.close,high:this.barAcc.close,low:this.barAcc.close,close:this.barAcc.close,
        buyVol:Math.round(overflow*frac), sellVol:overflow-Math.round(overflow*frac), totalVol:overflow };
    }

    const vpin = this.ewmaVpin;

    
    let bq=0, aq=0;
    (quote.depth?.buy||[]).forEach(l => bq+=l.quantity||0);
    (quote.depth?.sell||[]).forEach(l => aq+=l.quantity||0);
    const normOfi = (bq-this.lastBQ-(aq-this.lastAQ))/Math.max(bq+aq,1);
    if (!this.ewmaOfiInit) { this.ewmaOfi=normOfi; this.ewmaOfiInit=true; }
    else this.ewmaOfi = EWMA_OFI_A*normOfi + (1-EWMA_OFI_A)*this.ewmaOfi;
    this.lastBQ=bq; this.lastAQ=aq;
    if (this.ofiHistory.length>=200) this.ofiHistory.shift();
    this.ofiHistory.push({ normalized:normOfi, bidQty:bq, askQty:aq });

    
    let kyleLambda = 0;
    if (this.lastQuote) {
      const dp = quote.ltp-this.lastQuote.ltp;
      let lbq=0, laq=0;
      (this.lastQuote.depth?.buy||[]).forEach(l => lbq+=l.quantity||0);
      (this.lastQuote.depth?.sell||[]).forEach(l => laq+=l.quantity||0);
      const doi = (bq-aq)-(lbq-laq);
      this.wN=this.wN*WELFORD_D+1; this.wCxy*=WELFORD_D; this.wM2x*=WELFORD_D;
      const dx=doi-this.wMeanX; this.wMeanX+=dx/this.wN;
      const dy=dp-this.wMeanY; this.wMeanY+=dy/this.wN;
      this.wCxy+=dx*(dp-this.wMeanY); this.wM2x+=dx*(doi-this.wMeanX);
      if (this.wN>=5 && this.wM2x>1e-10) kyleLambda=Math.abs(this.wCxy/this.wM2x);
    }

    
    let amihud = 0;
    if (this.lastQuote && this.lastQuote.ltp>0) {
      const ret = Math.abs((quote.ltp-this.lastQuote.ltp)/this.lastQuote.ltp);
      const vd = Math.max(quote.volume-this.lastQuote.volume, 1);
      amihud = (ret/vd)*1e6;
      if (!this.ewmaAmihudInit) { this.ewmaAmihud=amihud; this.ewmaAmihudInit=true; }
      else this.ewmaAmihud = EWMA_AMIHUD_A*amihud + (1-EWMA_AMIHUD_A)*this.ewmaAmihud;
      amihud = this.ewmaAmihud;
    }

    
    let hawkes = 0;
    const ts = Date.now();
    if (!this.hawkesInit) { this.hawkesI=H_MU; this.hawkesTs=ts; this.hawkesInit=true; }
    else {
      const dt = Math.max(ts-this.hawkesTs,1);
      this.hawkesI = H_MU + Math.exp(-H_BETA*dt)*(this.hawkesI-H_MU+H_ALPHA);
      this.hawkesTs=ts;
      hawkes = clamp01((this.hawkesI-H_MU)/(H_MU*3));
    }

    
    let pin = 0;
    if (this.pinBC>=5) {
      const ab=this.pinSumB*(1-0.95), as=this.pinSumS*(1-0.95);
      const eps=Math.min(ab,as)*0.8, mu=Math.abs(ab-as);
      const alpha=this.pinBC>0?this.pinSig/this.pinBC:0;
      const denom=alpha*mu+eps+eps;
      pin = denom>0?(alpha*mu)/denom:0;
    }

    
    const bb=quote.depth?.buy?.[0]?.price||quote.ltp, ba=quote.depth?.sell?.[0]?.price||quote.ltp;
    const mid=(bb+ba)/2||quote.ltp;
    const spreadBps = mid>0?((ba-bb)/mid)*10000:0;
    let bidDepth=0, askDepth=0;
    (quote.depth?.buy||[]).forEach(l => bidDepth+=(l.price||0)*(l.quantity||0));
    (quote.depth?.sell||[]).forEach(l => askDepth+=(l.price||0)*(l.quantity||0));
    const depthImbalance = (bidDepth+askDepth>0)?(bidDepth-askDepth)/(bidDepth+askDepth):0;

    
    const v=clamp01(vpin/0.6), o=clamp01(Math.abs(this.ewmaOfi)/0.5), l=clamp01(kyleLambda/5);
    const a=clamp01(amihud/100), h=clamp01(hawkes), p=clamp01(pin/0.5), s=clamp01(spreadBps/50);
    const logit = -2.5+3.5*v+2.8*o+2.0*l+1.5*a+1.8*h+1.5*p+1.0*s;
    const toxicScore = Math.min(100, Math.max(0, Math.round(100/(1+Math.exp(-logit)))));

    
    let crashRisk = 0;
    if (this.histTotal>=5) {
      const vi = Math.min(31, Math.max(0, Math.floor(vpin*32)));
      let below=0; for (let i=0;i<vi;i++) below+=this.histBins[i];
      below += this.histBins[vi]/2;
      const pct = below/this.histTotal;
      const ss=clamp01(spreadBps/30);
      const as2 = this.ewmaAmihudInit&&this.ewmaAmihud>0?clamp01(amihud/(this.ewmaAmihud*3)):0;
      const cl = -2.0+4.0*pct+2.5*ss+2.0*as2;
      crashRisk = Math.min(100, Math.max(0, Math.round(100/(1+Math.exp(-cl)))));
    }

    if (this.scoreHistory.length>=200) this.scoreHistory.shift();
    if (this.crashHistory.length>=200) this.crashHistory.shift();
    this.scoreHistory.push(toxicScore); this.crashHistory.push(crashRisk);

    
    let recommendation;
    if (toxicScore<=25) recommendation={label:'SAFE',action:'Normal market conditions.',color:'#00d4aa',details:'Order flow is clean. Safe to trade.',toxicScore,crashRisk};
    else if (toxicScore<=50) recommendation={label:'CAUTION',action:'Mixed signals detected.',color:'#ffaa00',details:`Flow shows ${this.ewmaOfi>0?__STRING_de1b41d503a84604b7d5a9caa8a10296__:__STRING_44fa49da767d4884b3e027c72e55292b__} pressure. Reduce size.`,toxicScore,crashRisk};
    else if (toxicScore<=70) recommendation={label:'TOXIC',action:'Significant toxic flow.',color:'#ff6b35',details:`VPIN at ${(vpin*100).toFixed(1)}%. Avoid new positions.`,toxicScore,crashRisk};
    else if (toxicScore<=85) recommendation={label:'DANGER',action:'Extreme toxic flow. EXIT.',color:'#ff3b57',details:`PIN: ${(pin*100).toFixed(1)}%. Stop-loss slippage HIGH.`,toxicScore,crashRisk};
    else recommendation={label:'CRASH RISK',action:'CRITICAL: Flash crash conditions.',color:'#ff0040',details:'EXIT ALL. Do NOT buy the dip.',toxicScore,crashRisk};

    this.lastQuote = JSON.parse(JSON.stringify(quote));
    this.updateCount++;
    const computeTimeMs = Date.now()-t0;

    return {
      success:true, ltp:quote.ltp, volume:quote.volume,
      vpin:parseFloat(vpin.toFixed(4)), ofi:parseFloat(this.ewmaOfi.toFixed(4)),
      kyleLambda:parseFloat(kyleLambda.toFixed(4)), amihud:parseFloat(amihud.toFixed(4)),
      hawkes:parseFloat(hawkes.toFixed(4)), pin:parseFloat(pin.toFixed(4)),
      toxicScore, crashRisk,
      spread:{spreadBps:parseFloat(spreadBps.toFixed(2)),mid:parseFloat(mid.toFixed(2)),bidDepth,askDepth,depthImbalance:parseFloat(depthImbalance.toFixed(4))},
      volumeBars:this.volumeBars.slice(-50), volumeBarSize:this.volumeBarSize,
      barProgress:this.barAcc.totalVol/this.volumeBarSize, totalBarsCompleted:this.volumeBars.length,
      ofiHistory:this.ofiHistory.slice(-50), scoreHistory:this.scoreHistory.slice(-50), crashRiskHistory:this.crashHistory.slice(-50),
      recommendation, computeTimeMs, updateCount:this.updateCount, timestamp:new Date().toISOString(), transport:'websocket', engine:'js-o1-worker',
    };
  }
}




const UPSTOX_BASE = 'https://api.upstox.com/v2';
const INSTRUMENT_CACHE = new Map();

function getHeaders(token) {
  const bearer = token.startsWith('Bearer ') ? token : `Bearer ${token}`;
  return { 'Authorization': bearer, 'Accept': 'application/json' };
}

async function resolveInstrumentKey(symbol, exchange, token) {
  const cacheKey = `${symbol}:${exchange}`;
  if (INSTRUMENT_CACHE.has(cacheKey)) return INSTRUMENT_CACHE.get(cacheKey);
  const exch = exchange  'BSE_EQ' ? 'BSE' : 'NSE';
  const url = `${UPSTOX_BASE}/instruments/search?query=${encodeURIComponent(symbol)}&exchanges=${exch}&segments=EQ&records=5`;
  const res = await fetch(url, { headers: getHeaders(token) });
  if (!res.ok) throw new Error(`Search failed: ${res.status}`);
  const json = await res.json();
  const results = json?.data || [];
  const exact = results.find(i => i.trading_symbol?.toUpperCase()  symbol.toUpperCase());
  const key = (exact || results[0])?.instrument_key || `${exchange}|${symbol}`;
  INSTRUMENT_CACHE.set(cacheKey, key);
  return key;
}

async function fetchQuotes(instrumentKeys, token) {
  const url = `${UPSTOX_BASE}/market-quote/quotes?instrument_key=${encodeURIComponent(instrumentKeys.join(__STRING_34c1e369ad7842eb9c12e8ad4e445843__))}`;
  const res = await fetch(url, { headers: getHeaders(token), signal: AbortSignal.timeout(4000) });
  if (!res.ok) throw new Error(`Upstox ${res.status}`);
  const json = await res.json();
  return json?.data || {};
}

function parseQuote(raw) {
  return {
    ltp: raw.last_price||raw.ohlc?.close||0,
    open:raw.ohlc?.open||0, high:raw.ohlc?.high||0, low:raw.ohlc?.low||0, close:raw.ohlc?.close||0,
    volume:raw.volume||0,
    depth:{
      buy: (raw.depth?.buy||[]).map(l => ({price:l.price||0, quantity:l.quantity||0})),
      sell: (raw.depth?.sell||[]).map(l => ({price:l.price||0, quantity:l.quantity||0})),
    },
  };
}

function calibrateBarSize(volume) {
  return Math.round(Math.max(1000, Math.min(500000, Math.round(volume*2/50)))/1000)*1000;
}

async function searchInstruments(query, token, exchange) {
  let params = `query=${encodeURIComponent(query)}&segments=EQ&records=15`;
  if (exchange  'NSE' || exchange  'NSE_EQ') params += '&exchanges=NSE';
  else if (exchange  'BSE' || exchange  'BSE_EQ') params += '&exchanges=BSE';
  const res = await fetch(`${UPSTOX_BASE}/instruments/search?${params}`, { headers: getHeaders(token) });
  if (!res.ok) return [];
  const json = await res.json();
  return (json?.data||[]).map(r => ({
    symbol:r.trading_symbol, name:r.name, exchange:r.segment||r.exchange||'NSE_EQ',
    instrumentKey:r.instrument_key, instrumentType:r.instrument_type||'EQ',
  }));
}




const engineSessions = new Map();
function getOrCreateSession(instrumentKey) {
  if (!engineSessions.has(instrumentKey)) engineSessions.set(instrumentKey, { engine: new ToxicEngine(), barSize: 5000 });
  return engineSessions.get(instrumentKey);
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}




function handleWebSocket(env) {
  const pair = new WebSocketPair();
  const [client, server] = Object.values(pair);
  server.accept();
  const subscriptions = new Map();

  server.addEventListener('message', async (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type  'subscribe') {
        const token = env.UPSTOX_ACCESS_TOKEN;
        if (!token) { server.send(JSON.stringify({type:'error',message:'Token not configured'})); return; }
        const subscribed = [];
        for (const s of (msg.symbols||[])) {
          try {
            const ik = await resolveInstrumentKey(s.symbol, s.exchange||'NSE_EQ', token);
            subscriptions.set(s.symbol, {exchange:s.exchange||'NSE_EQ', instrumentKey:ik});
            subscribed.push(s.symbol);
          } catch (err) { server.send(JSON.stringify({type:'error',symbol:s.symbol,message:err.message})); }
        }
        server.send(JSON.stringify({type:'subscribed',symbols:subscribed}));
      } else if (msg.type  'poll') {
        const token = env.UPSTOX_ACCESS_TOKEN;
        if (!token || subscriptions.size0) return;
        const iks = [...subscriptions.values()].map(s => s.instrumentKey);
        const rawQuotes = await fetchQuotes(iks, token);
        for (const [symbol, sub] of subscriptions) {
          const raw = rawQuotes[sub.instrumentKey];
          if (!raw) continue;
          const quote = parseQuote(raw);
          const session = getOrCreateSession(sub.instrumentKey);
          if (session.barSize5000 && quote.volume>0) {
            session.barSize = calibrateBarSize(quote.volume);
            session.engine.volumeBarSize = session.barSize;
          }
          const result = session.engine.process(quote);
          result.symbol=symbol; result.exchange=sub.exchange; result.volumeBarSize=session.barSize;
          server.send(JSON.stringify({type:'update',symbol,exchange:sub.exchange,data:result}));
        }
      } else if (msg.type  'unsubscribe') {
        for (const sym of (msg.symbols||[])) subscriptions.delete(sym);
        server.send(JSON.stringify({type:'unsubscribed',symbols:msg.symbols}));
      }
    } catch (err) { server.send(JSON.stringify({type:'error',message:err.message})); }
  });

  server.addEventListener('close', () => subscriptions.clear());
  return new Response(null, { status: 101, webSocket: client });
}




async function handleApi(url, env) {
  const token = env.UPSTOX_ACCESS_TOKEN;
  if (!token) return jsonResponse({success:false,error:'Token not configured'}, 500);

  if (url.pathname  '/api/search') {
    const q = url.searchParams.get('q');
    const exchange = url.searchParams.get('exchange');
    if (!q) return jsonResponse({success:true,results:[]});
    const results = await searchInstruments(q, token, exchange);
    return jsonResponse({success:true,results});
  }

  if (url.pathname  '/api/toxic-flow') {
    const symbol = url.searchParams.get('symbol')||'RELIANCE';
    const exchange = url.searchParams.get('exchange')||'NSE_EQ';
    try {
      const ik = await resolveInstrumentKey(symbol, exchange, token);
      const rq = await fetchQuotes([ik], token);
      const raw = rq[ik];
      if (!raw) return jsonResponse({success:false,error:'No quote data'}, 404);
      const quote = parseQuote(raw);
      const session = getOrCreateSession(ik);
      if (session.barSize5000 && quote.volume>0) { session.barSize=calibrateBarSize(quote.volume); session.engine.volumeBarSize=session.barSize; }
      const result = session.engine.process(quote);
      result.symbol=symbol; result.exchange=exchange; result.volumeBarSize=session.barSize; result.transport='http-poll';
      return jsonResponse(result);
    } catch(err) { return jsonResponse({success:false,error:err.message}, 500); }
  }

  if (url.pathname  '/health') {
    return jsonResponse({status:'ok',engine:'js-o1-worker',sessions:engineSessions.size});
  }

  return jsonResponse({error:'Not found'}, 404);
}




export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method  'OPTIONS') return new Response(null, { headers: CORS_HEADERS });
    if (request.headers.get('Upgrade')  'websocket') return handleWebSocket(env);
    if (url.pathname.startsWith('/api/') || url.pathname  '/health') return handleApi(url, env);
    try {
      const r = await env.ASSETS.fetch(request);
      if (r.status !== 404) return r;
    } catch {}
    try { return await env.ASSETS.fetch(new Request(new URL('/index.html', request.url), request)); }
    catch { return new Response('Not Found', { status: 404 }); }
  },
};
