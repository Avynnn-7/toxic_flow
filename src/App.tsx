import { useState, useCallback, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Activity, Zap, Clock, Shield, WifiOff, Radio, Globe, BookOpen, Cpu, Search, TrendingUp } from 'lucide-react';
import { useWebSocket } from './hooks/useWebSocket';
import type { ToxicFlowData } from './types/toxic';

import WatchList from './components/WatchList';
import ToxicMeter from './components/ToxicMeter';
import MetricsGrid from './components/MetricsGrid';
import VolumeBarChart from './components/VolumeBarChart';
import OFIChart from './components/OFIChart';
import VPINGauge from './components/VPINGauge';
import CrashRiskPanel from './components/CrashRiskPanel';
import RecommendationCard from './components/RecommendationCard';

export default function App() {
  // ── State ──────────────────────────────────────────────────────────────
  const [symbols, setSymbols] = useState<{ symbol: string; exchange: string }[]>([]);
  const [symbolData, setSymbolData] = useState<Map<string, ToxicFlowData>>(new Map());
  const [activeSymbol, setActiveSymbol] = useState('');
  const [activeExchange, setActiveExchange] = useState('NSE_EQ');
  const [beginnerMode, setBeginnerMode] = useState(true); // default beginner

  // ── WebSocket ──────────────────────────────────────────────────────────
  const handleData = useCallback((symbol: string, data: ToxicFlowData) => {
    setSymbolData(prev => {
      const next = new Map(prev);
      const exchange = data.exchange || 'NSE_EQ';
      next.set(`${symbol}:${exchange}`, data);
      return next;
    });
  }, []);

  const { connected, transport, latency, subscribe, unsubscribe } = useWebSocket(handleData);

  // ── Handlers ───────────────────────────────────────────────────────────
  const handleSelect = useCallback((symbol: string, exchange: string) => {
    setActiveSymbol(symbol);
    setActiveExchange(exchange);
  }, []);

  const handleAdd = useCallback((symbol: string, exchange: string) => {
    setSymbols(prev => {
      if (prev.some(s => s.symbol === symbol && s.exchange === exchange)) return prev;
      return [...prev, { symbol, exchange }];
    });
    subscribe(symbol, exchange);
    setActiveSymbol(symbol);
    setActiveExchange(exchange);
  }, [subscribe]);

  const handleRemove = useCallback((symbol: string) => {
    const sym = symbols.find(s => s.symbol === symbol);
    if (!sym) return;
    unsubscribe(symbol, sym.exchange);
    setSymbols(prev => prev.filter(s => s.symbol !== symbol));
    setSymbolData(prev => {
      const next = new Map(prev);
      next.delete(`${symbol}:${sym.exchange}`);
      return next;
    });
    if (activeSymbol === symbol) {
      const remaining = symbols.filter(s => s.symbol !== symbol);
      if (remaining.length > 0) {
        setActiveSymbol(remaining[0].symbol);
        setActiveExchange(remaining[0].exchange);
      } else {
        setActiveSymbol('');
      }
    }
  }, [symbols, unsubscribe, activeSymbol]);

  // ── Selected data ──────────────────────────────────────────────────────
  const selectedKey = `${activeSymbol}:${activeExchange}`;
  const selectedData = symbolData.get(selectedKey) || null;
  const engineType = (selectedData as any)?.engine || 'unknown';
  const isCppWasm = engineType === 'cpp-wasm';

  const activeCount = useMemo(() => {
    let count = 0;
    for (const d of symbolData.values()) if (d) count++;
    return count;
  }, [symbolData]);

  return (
    <div className="app-container">
      {/* ── Sidebar ──────────────────────────────────────────────────────── */}
      <aside className="sidebar">
        <WatchList
          symbols={symbols}
          activeSymbol={activeSymbol}
          activeExchange={activeExchange}
          symbolData={symbolData}
          onSelect={handleSelect}
          onAdd={handleAdd}
          onRemove={handleRemove}
        />
      </aside>

      {/* ── Main Content ─────────────────────────────────────────────────── */}
      <main className="main-content">
        {/* Header */}
        <header className="main-header">
          <div className="header-left">
            <div className="header-logo">
              <Shield size={22} color="white" />
            </div>
            <div>
              <h1 className="header-title">Toxic Flow Detector</h1>
              <p className="header-subtitle">
                {beginnerMode
                  ? 'Is this stock safe to trade right now?'
                  : 'C++ WASM stochastic engine • O(1) per-tick analysis'}
              </p>
            </div>
          </div>

          <div className="header-right">
            {/* Mode Toggle */}
            <div
              className={`beginner-toggle ${beginnerMode ? 'active' : ''}`}
              onClick={() => setBeginnerMode(!beginnerMode)}
              title={beginnerMode ? 'Switch to Expert Mode' : 'Switch to Beginner Mode'}
            >
              {beginnerMode ? <BookOpen size={12} /> : <Cpu size={12} />}
              <span>{beginnerMode ? '🟢 Beginner' : '⚡ Expert'}</span>
              <div className={`toggle-switch ${beginnerMode ? 'active' : ''}`} />
            </div>

            {/* Engine Badge — only in expert mode */}
            {!beginnerMode && (
              <div className={`engine-badge ${isCppWasm ? 'wasm' : 'js'}`}>
                <Cpu size={10} />
                {isCppWasm ? 'C++ WASM' : 'JS O(1)'}
              </div>
            )}

            {/* Connection Status */}
            <div className="status-chip">
              {connected ? (
                <>
                  <div className="live-dot" />
                  <Radio size={12} />
                  <span className="font-mono" style={{ color: 'var(--safe)' }}>
                    {beginnerMode ? 'LIVE' : 'WS LIVE'}
                  </span>
                </>
              ) : transport === 'http-poll' ? (
                <>
                  <Globe size={12} style={{ color: 'var(--caution)' }} />
                  <span className="font-mono" style={{ color: 'var(--caution)' }}>
                    {beginnerMode ? 'CONNECTED' : 'HTTP POLL'}
                  </span>
                </>
              ) : (
                <>
                  <WifiOff size={12} style={{ color: 'var(--danger)' }} />
                  <span className="font-mono" style={{ color: 'var(--danger)' }}>OFFLINE</span>
                </>
              )}
            </div>

            {/* Technical stats — expert only */}
            {!beginnerMode && selectedData && (
              <>
                <div className="status-chip">
                  <Clock size={12} />
                  <span className="font-mono">{latency}ms</span>
                </div>
                <div className="status-chip">
                  <Zap size={12} style={{ color: 'var(--safe)' }} />
                  <span className="font-mono">{selectedData.computeTimeMs}ms</span>
                </div>
                <div className="status-chip">
                  <Activity size={12} />
                  <span className="font-mono">{activeCount}/{symbols.length}</span>
                </div>
              </>
            )}
          </div>
        </header>

        {/* ── No Stock Selected ─────────────────────────────────────────── */}
        {!activeSymbol && (
          <div className="empty-state-main">
            <div className="empty-icon-pulse">
              <Search size={40} />
            </div>
            <h2>
              {beginnerMode
                ? 'Search for a stock to check if it\'s safe'
                : 'Search for a symbol to begin analysis'}
            </h2>
            <p>
              {beginnerMode
                ? 'Type any company name or stock ticker in the search bar on the left'
                : 'Use the sidebar search to add NSE/BSE instruments'}
            </p>
          </div>
        )}

        {/* ── Waiting for data ──────────────────────────────────────────── */}
        {activeSymbol && !selectedData && (
          <div className="empty-state-main">
            <div className="empty-icon-pulse">
              <TrendingUp size={40} />
            </div>
            <h2>
              {beginnerMode ? `Loading ${activeSymbol}...` : `Connecting to ${activeSymbol}...`}
            </h2>
            <p>
              {beginnerMode
                ? 'Getting the latest safety analysis for you'
                : 'Fetching initial data from server'}
            </p>
            <div className="loading-bar">
              <div className="loading-bar-fill" />
            </div>
          </div>
        )}

        {/* ── Data Display ──────────────────────────────────────────────── */}
        {selectedData && (
          <motion.div
            key={selectedKey}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25 }}
            className="detail-container"
          >
            {beginnerMode ? (
              /* ═══════════════════════════════════════════════════════════
                 BEGINNER MODE — Simple, friendly, educational
                 ═══════════════════════════════════════════════════════════ */
              <div className="beginner-layout">
                {/* Big safety verdict */}
                <div className="beginner-verdict-card card" style={{ borderColor: `${selectedData.recommendation.color}33` }}>
                  <div className="beginner-verdict-header">
                    <div className="beginner-stock-info">
                      <span className="beginner-stock-name font-mono">{activeSymbol}</span>
                      <span className="beginner-stock-price font-mono">₹{selectedData.ltp.toFixed(2)}</span>
                      <span className="beginner-stock-vol">Vol: {(selectedData.volume / 1e6).toFixed(1)}M</span>
                    </div>
                    <div className="beginner-verdict-badge" style={{ background: `${selectedData.recommendation.color}18`, color: selectedData.recommendation.color, borderColor: `${selectedData.recommendation.color}40` }}>
                      {selectedData.recommendation.label === 'SAFE' ? '🟢' : selectedData.recommendation.label === 'CAUTION' ? '🟡' : '🔴'} {selectedData.recommendation.label}
                    </div>
                  </div>

                  <ToxicMeter
                    score={selectedData.toxicScore}
                    label={selectedData.recommendation.label}
                    color={selectedData.recommendation.color}
                    size={200}
                  />

                  <div className="beginner-verdict-text">
                    <p className="beginner-action" style={{ color: selectedData.recommendation.color }}>
                      {selectedData.recommendation.action}
                    </p>
                    <p className="beginner-details">{selectedData.recommendation.details}</p>
                  </div>

                  {/* Simple buy / stop-loss indicators */}
                  <div className="beginner-simple-grid">
                    <div className="beginner-simple-item">
                      <span className="beginner-simple-label">Should you buy?</span>
                      <span className="beginner-simple-value font-mono" style={{
                        color: selectedData.toxicScore < 30 ? 'var(--safe)' : selectedData.toxicScore < 60 ? 'var(--caution)' : 'var(--danger)',
                      }}>
                        {selectedData.toxicScore < 30 ? '✅ YES — Safe' : selectedData.toxicScore < 50 ? '⚠️ WAIT' : selectedData.toxicScore < 70 ? '❌ NO — Risky' : '🚫 DANGEROUS'}
                      </span>
                    </div>
                    <div className="beginner-simple-item">
                      <span className="beginner-simple-label">Can stop-loss protect you?</span>
                      <span className="beginner-simple-value font-mono" style={{
                        color: selectedData.crashRisk < 30 ? 'var(--safe)' : selectedData.crashRisk < 60 ? 'var(--caution)' : 'var(--danger)',
                      }}>
                        {selectedData.crashRisk < 30 ? '✅ Yes — Normal' : selectedData.crashRisk < 60 ? '⚠️ Maybe — Slippage' : '❌ No — Liquidity gone'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Educational metric cards */}
                <div className="beginner-metrics-list">
                  <BeginnerMetricCard
                    emoji="🔍"
                    title="Secret Trading (VPIN)"
                    value={`${(selectedData.vpin * 100).toFixed(1)}%`}
                    status={selectedData.vpin <= 0.2 ? 'safe' : selectedData.vpin <= 0.4 ? 'caution' : 'danger'}
                    plainText={selectedData.vpin <= 0.2
                      ? 'No signs of insider trading. The market is playing fair.'
                      : selectedData.vpin <= 0.4
                        ? 'Some unusual activity. Big players might be building positions quietly.'
                        : 'High probability of informed trading! Someone might know something you don\'t.'}
                    learnMore="VPIN (Volume-Synchronized Probability of Informed Trading) groups trades into equal-volume blocks and checks if buys and sells are balanced. When they're heavily skewed, it suggests 'smart money' is secretly accumulating a position. Think of it like noticing that every time a specific person enters a poker game, they always win — they probably know the cards."
                  />
                  <BeginnerMetricCard
                    emoji="💰"
                    title={`Money Flow (OFI): ${selectedData.ofi > 0 ? 'Buying' : 'Selling'}`}
                    value={`${selectedData.ofi >= 0 ? '+' : ''}${(selectedData.ofi * 100).toFixed(1)}%`}
                    status={Math.abs(selectedData.ofi) <= 0.15 ? 'safe' : Math.abs(selectedData.ofi) <= 0.3 ? 'caution' : 'danger'}
                    plainText={selectedData.ofi > 0
                      ? `More people want to BUY than SELL. It's like a crowd rushing into a store — demand is strong.`
                      : `More people want to SELL than BUY. Like everyone running for the exit — selling pressure is high.`}
                    learnMore="OFI (Order Flow Imbalance) tracks the balance of buy vs. sell orders sitting in the order book. It looks at all 5 price levels of bids and asks and measures whether buying or selling demand is dominant. A large imbalance often precedes sharp price moves — like watching a dam about to overflow."
                  />
                  <BeginnerMetricCard
                    emoji="⚡"
                    title="Price Impact (Kyle's Lambda)"
                    value={selectedData.kyleLambda.toFixed(3)}
                    status={selectedData.kyleLambda <= 1 ? 'safe' : selectedData.kyleLambda <= 3 ? 'caution' : 'danger'}
                    plainText={selectedData.kyleLambda <= 1
                      ? 'Trades have very little impact on price. Market is healthy and liquid.'
                      : selectedData.kyleLambda <= 3
                        ? 'Moderate price impact per trade. Be careful with large orders.'
                        : 'Even small trades are moving the price significantly! Very illiquid — dangerous territory.'}
                    learnMore="Kyle's Lambda measures how much price moves per unit of order flow. Imagine throwing stones into water — Lambda tells you how big the splash is. A high Lambda means the stock is 'thin' (few buyers/sellers), so even a small trade causes a large price move. This makes you vulnerable to slippage and manipulation."
                  />
                  <BeginnerMetricCard
                    emoji="🌊"
                    title="Trade Bursts (Hawkes)"
                    value={`${(selectedData.hawkes * 100).toFixed(1)}%`}
                    status={selectedData.hawkes <= 0.2 ? 'safe' : selectedData.hawkes <= 0.5 ? 'caution' : 'danger'}
                    plainText={selectedData.hawkes <= 0.2
                      ? 'Trades are arriving at a normal, steady pace. No suspicious patterns.'
                      : selectedData.hawkes <= 0.5
                        ? 'Trades are clustering into bursts. Could be algorithmic trading or coordinated activity.'
                        : 'Extreme burst patterns! Likely high-frequency bots or coordinated manipulation.'}
                    learnMore="The Hawkes Process is a mathematical model that detects when events cluster in time. In a normal market, trades arrive randomly like raindrops. But when algorithms or coordinated traders are active, trades come in rapid machine-gun bursts. This is like hearing single gunshots vs. automatic fire — the pattern tells you if something unusual is happening."
                  />
                  <BeginnerMetricCard
                    emoji="🎯"
                    title="Insider Risk (PIN)"
                    value={`${(selectedData.pin * 100).toFixed(1)}%`}
                    status={selectedData.pin <= 0.15 ? 'safe' : selectedData.pin <= 0.3 ? 'caution' : 'danger'}
                    plainText={selectedData.pin <= 0.15
                      ? 'Low chance of informed trading. You\'re on a level playing field.'
                      : selectedData.pin <= 0.3
                        ? 'Moderate insider activity risk. The person on the other side might know more than you.'
                        : 'High insider risk! Someone likely has information you don\'t. Avoid trading.'}
                    learnMore="PIN (Probability of Informed Trading) estimates the fraction of trades coming from people with private information (insiders). It uses a Bayesian model that compares expected 'normal' trading volume vs. excess one-sided volume. A PIN above 30% means roughly 1 in 3 trades is from someone with better info — you're essentially bringing a knife to a gunfight."
                  />
                  <BeginnerMetricCard
                    emoji="💧"
                    title="Liquidity (Amihud)"
                    value={selectedData.amihud.toFixed(2)}
                    status={selectedData.amihud <= 20 ? 'safe' : selectedData.amihud <= 50 ? 'caution' : 'danger'}
                    plainText={selectedData.amihud <= 20
                      ? 'Easy to trade without moving the price. Good liquidity — the exit door is wide open.'
                      : selectedData.amihud <= 50
                        ? 'Moderate liquidity. Trading large amounts might cause slippage.'
                        : 'Very illiquid! If you try to sell, you\'ll have to accept a much worse price.'}
                    learnMore="The Amihud Illiquidity Ratio measures how much price moves per unit of trading volume. Think of it as 'how crowded is the exit door.' When Amihud is low, you can easily enter and exit trades without moving the price. When it's high, trying to sell (especially in size) will push the price against you — like trying to leave a concert through a single narrow door."
                  />
                </div>
              </div>
            ) : (
              /* ═══════════════════════════════════════════════════════════
                 EXPERT MODE — Full technical dashboard
                 ═══════════════════════════════════════════════════════════ */
              <>
                <CrashRiskPanel
                  crashRisk={selectedData.crashRisk}
                  toxicScore={selectedData.toxicScore}
                  details={selectedData.recommendation.details}
                />

                <div className="detail-grid">
                  {/* Left Column */}
                  <div className="detail-left">
                    <div className="card gauge-card">
                      <ToxicMeter
                        score={selectedData.toxicScore}
                        label={selectedData.recommendation.label}
                        color={selectedData.recommendation.color}
                      />
                      <div className="bar-progress-section">
                        <div className="bar-progress-header">
                          <span>Volume bar progress</span>
                          <span className="font-mono">{Math.round(selectedData.barProgress * 100)}%</span>
                        </div>
                        <div className="bar-progress">
                          <div className="bar-progress-fill" style={{ width: `${selectedData.barProgress * 100}%` }} />
                        </div>
                        <div className="bar-progress-footer">
                          <span>{selectedData.totalBarsCompleted} bars</span>
                          <span className="font-mono">{selectedData.volumeBarSize.toLocaleString()} shares/bar</span>
                        </div>
                      </div>
                    </div>

                    <RecommendationCard
                      recommendation={selectedData.recommendation}
                      ltp={selectedData.ltp}
                      volume={selectedData.volume}
                      symbol={activeSymbol}
                    />

                    {/* Spread */}
                    <div className="card">
                      <div className="card-header">
                        <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>Spread & Depth</span>
                      </div>
                      <div className="spread-grid">
                        <div className="metric-card">
                          <div className="metric-label">Spread</div>
                          <div className="metric-value font-mono" style={{ color: selectedData.spread.spreadBps > 20 ? 'var(--danger)' : 'var(--safe)' }}>
                            {selectedData.spread.spreadBps.toFixed(1)} bps
                          </div>
                        </div>
                        <div className="metric-card">
                          <div className="metric-label">Mid Price</div>
                          <div className="metric-value font-mono">₹{selectedData.spread.mid.toFixed(2)}</div>
                        </div>
                        <div className="metric-card">
                          <div className="metric-label">Bid Depth</div>
                          <div className="metric-value font-mono" style={{ color: 'var(--buy-color)' }}>₹{(selectedData.spread.bidDepth / 1e6).toFixed(1)}M</div>
                        </div>
                        <div className="metric-card">
                          <div className="metric-label">Ask Depth</div>
                          <div className="metric-value font-mono" style={{ color: 'var(--sell-color)' }}>₹{(selectedData.spread.askDepth / 1e6).toFixed(1)}M</div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Right Column */}
                  <div className="detail-right">
                    <MetricsGrid data={selectedData} beginnerMode={false} />
                    <div className="charts-row">
                      <VolumeBarChart bars={selectedData.volumeBars} />
                      <OFIChart history={selectedData.ofiHistory} />
                    </div>
                    <VPINGauge
                      vpinHistory={selectedData.scoreHistory.map(s => s / 100)}
                      crashRiskHistory={selectedData.crashRiskHistory}
                    />
                    <div className="session-footer">
                      <span>
                        {connected ? '🟢' : '🟡'} {transport === 'websocket' ? 'WebSocket' : 'HTTP Poll'} •
                        Updates: {selectedData.updateCount} •
                        Engine: {isCppWasm ? '⚡ C++ WASM' : 'JS'} {selectedData.computeTimeMs}ms •
                        Transport: {(selectedData as any)?.transport || transport}
                      </span>
                      <span>{selectedData.timestamp}</span>
                    </div>
                  </div>
                </div>
              </>
            )}
          </motion.div>
        )}
      </main>
    </div>
  );
}

/* ── Beginner Metric Card Component ────────────────────────────────────── */
function BeginnerMetricCard({
  emoji, title, value, status, plainText, learnMore,
}: {
  emoji: string;
  title: string;
  value: string;
  status: 'safe' | 'caution' | 'danger';
  plainText: string;
  learnMore: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const color = status === 'safe' ? 'var(--safe)' : status === 'caution' ? 'var(--caution)' : 'var(--danger)';
  const statusIcon = status === 'safe' ? '🟢' : status === 'caution' ? '🟡' : '🔴';
  const statusLabel = status === 'safe' ? 'Safe' : status === 'caution' ? 'Watch' : 'Warning';

  return (
    <div className="beginner-metric-card card">
      <div className="beginner-metric-header" onClick={() => setExpanded(!expanded)}>
        <div className="beginner-metric-left">
          <span className="beginner-metric-emoji">{emoji}</span>
          <div>
            <div className="beginner-metric-title">{title}</div>
            <div className="beginner-metric-plain">{plainText}</div>
          </div>
        </div>
        <div className="beginner-metric-right">
          <span className="beginner-metric-status" style={{ color }}>{statusIcon} {statusLabel}</span>
          <span className="beginner-metric-value font-mono" style={{ color }}>{value}</span>
        </div>
      </div>
      {expanded && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          className="beginner-metric-learn"
        >
          <div className="beginner-learn-header">📚 How does this work?</div>
          <p>{learnMore}</p>
        </motion.div>
      )}
      <button className="beginner-learn-toggle" onClick={() => setExpanded(!expanded)}>
        {expanded ? '▲ Hide details' : '▼ Learn more — what is this?'}
      </button>
    </div>
  );
}
