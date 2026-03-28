import { useState, useCallback, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Activity, Zap, Clock, Shield, WifiOff, Radio, Globe, BookOpen, Cpu } from 'lucide-react';
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

const DEFAULT_SYMBOLS = [
  { symbol: 'RELIANCE', exchange: 'NSE_EQ' },
  { symbol: 'TCS', exchange: 'NSE_EQ' },
  { symbol: 'INFY', exchange: 'NSE_EQ' },
  { symbol: 'HDFCBANK', exchange: 'NSE_EQ' },
  { symbol: 'SBIN', exchange: 'NSE_EQ' },
];

export default function App() {
  // ── State ──────────────────────────────────────────────────────────────
  const [symbols, setSymbols] = useState(DEFAULT_SYMBOLS);
  const [symbolData, setSymbolData] = useState<Map<string, ToxicFlowData>>(new Map());
  const [activeSymbol, setActiveSymbol] = useState(DEFAULT_SYMBOLS[0].symbol);
  const [activeExchange, setActiveExchange] = useState(DEFAULT_SYMBOLS[0].exchange);
  const [beginnerMode, setBeginnerMode] = useState(false);

  // ── WebSocket ──────────────────────────────────────────────────────────
  const handleData = useCallback((symbol: string, data: ToxicFlowData) => {
    setSymbolData(prev => {
      const next = new Map(prev);
      // Find matching exchange
      const exchange = data.exchange || 'NSE_EQ';
      next.set(`${symbol}:${exchange}`, data);
      return next;
    });
  }, []);

  const { connected, transport, latency, subscribe, unsubscribe } = useWebSocket(handleData);

  // Auto-subscribe on mount
  useState(() => {
    setTimeout(() => {
      for (const s of DEFAULT_SYMBOLS) {
        subscribe(s.symbol, s.exchange);
      }
    }, 500);
  });

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
      }
    }
  }, [symbols, unsubscribe, activeSymbol]);

  // ── Selected data ──────────────────────────────────────────────────────
  const selectedKey = `${activeSymbol}:${activeExchange}`;
  const selectedData = symbolData.get(selectedKey) || null;

  // Engine type from data
  const engineType = (selectedData as any)?.engine || 'unknown';
  const isCppWasm = engineType === 'cpp-wasm';

  // Active count
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
                  ? 'Real-time stock safety scanner • Analyzing market health'
                  : 'C++ WASM stochastic engine • O(1) per-tick analysis'}
              </p>
            </div>
          </div>

          <div className="header-right">
            {/* Beginner Mode Toggle */}
            <div
              className={`beginner-toggle ${beginnerMode ? 'active' : ''}`}
              onClick={() => setBeginnerMode(!beginnerMode)}
              title={beginnerMode ? 'Switch to Expert Mode' : 'Switch to Beginner Mode'}
            >
              <BookOpen size={12} />
              <span>{beginnerMode ? 'Beginner' : 'Expert'}</span>
              <div className={`toggle-switch ${beginnerMode ? 'active' : ''}`} />
            </div>

            {/* Engine Badge */}
            <div className={`engine-badge ${isCppWasm ? 'wasm' : 'js'}`}>
              <Cpu size={10} />
              {isCppWasm ? 'C++ WASM' : 'JS O(1)'}
            </div>

            {/* Connection Status */}
            <div className="status-chip">
              {connected ? (
                <>
                  <div className="live-dot" />
                  <Radio size={12} />
                  <span className="font-mono" style={{ color: 'var(--safe)' }}>WS LIVE</span>
                </>
              ) : transport === 'http-poll' ? (
                <>
                  <Globe size={12} style={{ color: 'var(--caution)' }} />
                  <span className="font-mono" style={{ color: 'var(--caution)' }}>HTTP POLL</span>
                </>
              ) : (
                <>
                  <WifiOff size={12} style={{ color: 'var(--danger)' }} />
                  <span className="font-mono" style={{ color: 'var(--danger)' }}>OFFLINE</span>
                </>
              )}
            </div>

            {selectedData && (
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

        {/* ── Content ───────────────────────────────────────────────────── */}
        {!selectedData && (
          <div className="empty-state-main">
            <div className="empty-icon-pulse">
              <Shield size={40} />
            </div>
            <h2>
              {beginnerMode ? `Checking ${activeSymbol}...` : `Connecting to ${activeSymbol}...`}
            </h2>
            <p>
              {connected
                ? beginnerMode ? 'Getting the latest market data for you' : 'Waiting for first data update'
                : transport === 'http-poll'
                  ? 'Using HTTP polling fallback'
                  : beginnerMode ? 'Connecting to live market data' : 'Establishing WebSocket connection'}
            </p>
            <div className="loading-bar">
              <div className="loading-bar-fill" />
            </div>
          </div>
        )}

        {selectedData && (
          <motion.div
            key={selectedKey}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25 }}
            className="detail-container"
          >
            {/* Crash Risk Alert */}
            <CrashRiskPanel
              crashRisk={selectedData.crashRisk}
              toxicScore={selectedData.toxicScore}
              details={selectedData.recommendation.details}
            />

            <div className="detail-grid">
              {/* ── Left Column ─────────────────────────────────────────────── */}
              <div className="detail-left">
                {/* Gauge Card */}
                <div className="card gauge-card">
                  <ToxicMeter
                    score={selectedData.toxicScore}
                    label={selectedData.recommendation.label}
                    color={selectedData.recommendation.color}
                  />

                  {/* Bar progress */}
                  <div className="bar-progress-section">
                    <div className="bar-progress-header">
                      <span>{beginnerMode ? 'Analysis progress' : 'Volume bar progress'}</span>
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

                {/* Recommendation */}
                <RecommendationCard
                  recommendation={selectedData.recommendation}
                  ltp={selectedData.ltp}
                  volume={selectedData.volume}
                  symbol={activeSymbol}
                />

                {/* Spread */}
                <div className="card">
                  <div className="card-header">
                    <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>
                      {beginnerMode ? 'Trading Cost & Liquidity' : 'Spread & Depth'}
                    </span>
                  </div>
                  <div className="spread-grid">
                    <div className="metric-card">
                      <div className="metric-label">{beginnerMode ? 'Trading Cost' : 'Spread'}</div>
                      <div className="metric-value font-mono" style={{ color: selectedData.spread.spreadBps > 20 ? 'var(--danger)' : 'var(--safe)' }}>
                        {selectedData.spread.spreadBps.toFixed(1)} bps
                      </div>
                      {beginnerMode && (
                        <div className="metric-sub">
                          {selectedData.spread.spreadBps < 5 ? 'Very cheap to trade' : selectedData.spread.spreadBps < 15 ? 'Normal cost' : 'Expensive — wide gap'}
                        </div>
                      )}
                    </div>
                    <div className="metric-card">
                      <div className="metric-label">Mid Price</div>
                      <div className="metric-value font-mono">₹{selectedData.spread.mid.toFixed(2)}</div>
                    </div>
                    <div className="metric-card">
                      <div className="metric-label">{beginnerMode ? 'Buyers queued' : 'Bid Depth'}</div>
                      <div className="metric-value font-mono" style={{ color: 'var(--buy-color)' }}>₹{(selectedData.spread.bidDepth / 1e6).toFixed(1)}M</div>
                    </div>
                    <div className="metric-card">
                      <div className="metric-label">{beginnerMode ? 'Sellers queued' : 'Ask Depth'}</div>
                      <div className="metric-value font-mono" style={{ color: 'var(--sell-color)' }}>₹{(selectedData.spread.askDepth / 1e6).toFixed(1)}M</div>
                    </div>
                  </div>
                </div>
              </div>

              {/* ── Right Column ────────────────────────────────────────────── */}
              <div className="detail-right">
                <MetricsGrid data={selectedData} beginnerMode={beginnerMode} />

                <div className="charts-row">
                  <VolumeBarChart bars={selectedData.volumeBars} />
                  <OFIChart history={selectedData.ofiHistory} />
                </div>

                <VPINGauge
                  vpinHistory={selectedData.scoreHistory.map(s => s / 100)}
                  crashRiskHistory={selectedData.crashRiskHistory}
                />

                {/* Session Info Footer */}
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
          </motion.div>
        )}
      </main>
    </div>
  );
}
