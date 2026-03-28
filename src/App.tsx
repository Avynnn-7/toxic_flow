import { useState, useCallback, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Activity, Zap, Clock, Shield, WifiOff, Radio, Globe } from 'lucide-react';
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
  // ── State ─────────────────────────────────────────────────────────────
  const [symbolData, setSymbolData] = useState<Map<string, ToxicFlowData | null>>(
    () => new Map(DEFAULT_SYMBOLS.map(s => [`${s.symbol}:${s.exchange}`, null]))
  );
  const [selectedKey, setSelectedKey] = useState(`${DEFAULT_SYMBOLS[0].symbol}:${DEFAULT_SYMBOLS[0].exchange}`);

  // ── WebSocket ─────────────────────────────────────────────────────────
  const handleData = useCallback((symbol: string, data: ToxicFlowData) => {
    setSymbolData(prev => {
      const next = new Map(prev);
      // Find the key that matches this symbol
      for (const key of next.keys()) {
        if (key.startsWith(`${symbol}:`)) {
          next.set(key, data);
          return next;
        }
      }
      return next;
    });
  }, []);

  const { connected, transport, latency, subscribe, unsubscribe } = useWebSocket(handleData);

  // ── Auto-subscribe on mount ───────────────────────────────────────────
  useState(() => {
    // This runs once on mount
    setTimeout(() => {
      for (const s of DEFAULT_SYMBOLS) {
        subscribe(s.symbol, s.exchange);
      }
    }, 500);
  });

  // ── Handlers ──────────────────────────────────────────────────────────
  const handleSelect = useCallback((symbol: string, exchange: string) => {
    setSelectedKey(`${symbol}:${exchange}`);
  }, []);

  const handleAdd = useCallback((symbol: string, exchange: string) => {
    const key = `${symbol}:${exchange}`;
    setSymbolData(prev => {
      if (prev.has(key)) return prev;
      const next = new Map(prev);
      next.set(key, null);
      return next;
    });
    subscribe(symbol, exchange);
    setSelectedKey(key);
  }, [subscribe]);

  const handleRemove = useCallback((symbol: string, exchange: string) => {
    const key = `${symbol}:${exchange}`;
    unsubscribe(symbol, exchange);
    setSymbolData(prev => {
      const next = new Map(prev);
      next.delete(key);
      return next;
    });
    // If removed the selected one, select first available
    if (selectedKey === key) {
      const keys = [...symbolData.keys()].filter(k => k !== key);
      if (keys.length > 0) setSelectedKey(keys[0]);
    }
  }, [unsubscribe, selectedKey, symbolData]);

  // ── Selected data ─────────────────────────────────────────────────────
  const selectedData = useMemo(() => symbolData.get(selectedKey) || null, [symbolData, selectedKey]);
  const selectedSymbol = selectedKey.split(':')[0];

  // ── Active symbols count ──────────────────────────────────────────────
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
          symbols={symbolData}
          selectedSymbol={selectedSymbol}
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
                Volume-synchronized stochastic analysis • {symbolData.size} symbols tracked
              </p>
            </div>
          </div>

          <div className="header-right">
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
                  <span className="font-mono">{activeCount}/{symbolData.size}</span>
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
            <h2>Connecting to {selectedSymbol}...</h2>
            <p>
              {connected
                ? 'Waiting for first data update'
                : transport === 'http-poll'
                  ? 'Using HTTP polling fallback'
                  : 'Establishing WebSocket connection'}
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

                {/* Recommendation */}
                <RecommendationCard
                  recommendation={selectedData.recommendation}
                  ltp={selectedData.ltp}
                  volume={selectedData.volume}
                  symbol={selectedData.symbol}
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

              {/* ── Right Column ────────────────────────────────────────────── */}
              <div className="detail-right">
                <MetricsGrid data={selectedData} />

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
                    Engine: {selectedData.computeTimeMs}ms
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
