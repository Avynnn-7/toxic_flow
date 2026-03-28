import { useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Activity, Zap, Clock, BarChart2, Shield } from 'lucide-react';
import { useToxicFlow } from './hooks/useToxicFlow';
import SymbolSearch from './components/SymbolSearch';
import ToxicMeter from './components/ToxicMeter';
import MetricsGrid from './components/MetricsGrid';
import VolumeBarChart from './components/VolumeBarChart';
import OFIChart from './components/OFIChart';
import VPINGauge from './components/VPINGauge';
import CrashRiskPanel from './components/CrashRiskPanel';
import RecommendationCard from './components/RecommendationCard';

export default function App() {
  const [symbol, setSymbol] = useState('RELIANCE');
  const [exchange, setExchange] = useState('NSE_EQ');

  const { data, error, loading, latency } = useToxicFlow({
    symbol,
    exchange,
    enabled: !!symbol,
  });

  const handleSelectSymbol = useCallback((sym: string, exch: string) => {
    setSymbol(sym);
    setExchange(exch);
  }, []);

  return (
    <div className="dashboard">
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="dashboard-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{
            width: 40, height: 40, borderRadius: 12,
            background: 'linear-gradient(135deg, #a855f7 0%, #3b82f6 100%)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Shield size={22} color="white" />
          </div>
          <div>
            <h1 style={{ fontSize: '1.2rem', fontWeight: 800, letterSpacing: '-0.03em' }}>
              Toxic Flow Detector
            </h1>
            <p style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)', marginTop: 2 }}>
              Real-time market microstructure analysis • Stochastic calculus models
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <SymbolSearch onSelect={handleSelectSymbol} currentSymbol={symbol} />

          {/* Live status */}
          {data && (
            <div className="status-row">
              <div className="live-dot" />
              <span className="font-mono">LIVE</span>
              <span style={{ color: 'var(--text-tertiary)' }}>|</span>
              <Clock size={12} />
              <span className="font-mono">{latency}ms</span>
              <span style={{ color: 'var(--text-tertiary)' }}>|</span>
              <Zap size={12} style={{ color: 'var(--safe)' }} />
              <span className="font-mono">{data.computeTimeMs}ms engine</span>
            </div>
          )}
        </div>
      </div>

      {/* ── Error State ─────────────────────────────────────────────────────── */}
      {error && !data && (
        <motion.div
          className="card"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          style={{ padding: 24, textAlign: 'center', borderColor: 'rgba(255,170,0,0.2)' }}
        >
          <Activity size={32} style={{ color: 'var(--caution)', marginBottom: 12 }} />
          <h3 style={{ color: 'var(--caution)', marginBottom: 8 }}>Connection Issue</h3>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', maxWidth: 500, margin: '0 auto' }}>
            {error}
          </p>
          <p style={{ color: 'var(--text-tertiary)', fontSize: '0.75rem', marginTop: 12 }}>
            Make sure the market is open (9:15 AM – 3:30 PM IST) and UPSTOX_ACCESS_TOKEN is set.
          </p>
        </motion.div>
      )}

      {/* ── Loading State ───────────────────────────────────────────────────── */}
      {loading && !data && !error && (
        <div className="loading-container">
          <div className="loading-spinner" />
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
            Connecting to Upstox for <span className="font-mono" style={{ color: 'var(--accent-blue)' }}>{symbol}</span>...
          </p>
        </div>
      )}

      {/* ── Empty State ─────────────────────────────────────────────────────── */}
      {!symbol && (
        <div className="empty-state">
          <div className="empty-icon">
            <BarChart2 size={36} />
          </div>
          <h3 style={{ color: 'var(--text-secondary)' }}>Search for a stock</h3>
          <p style={{ color: 'var(--text-tertiary)', fontSize: '0.85rem' }}>
            Enter any NSE or BSE stock symbol to start real-time toxic flow analysis.
          </p>
        </div>
      )}

      {/* ── Main Dashboard ──────────────────────────────────────────────────── */}
      {data && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
        >
          {/* Crash Risk Alert */}
          <CrashRiskPanel
            crashRisk={data.crashRisk}
            toxicScore={data.toxicScore}
            details={data.recommendation.details}
          />

          <div className="dashboard-grid" style={{ marginTop: data.crashRisk > 50 || data.toxicScore > 65 ? 24 : 0 }}>
            {/* ── Left Panel: Gauge + Recommendation ─────────────────────────── */}
            <div className="left-panel">
              <div className="card">
                <ToxicMeter
                  score={data.toxicScore}
                  label={data.recommendation.label}
                  color={data.recommendation.color}
                />
                {/* Volume bar progress */}
                <div style={{ padding: '0 24px 16px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: 'var(--text-tertiary)' }}>
                    <span>Volume bar progress</span>
                    <span className="font-mono">{Math.round(data.barProgress * 100)}%</span>
                  </div>
                  <div className="bar-progress">
                    <div className="bar-progress-fill" style={{ width: `${data.barProgress * 100}%` }} />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.65rem', color: 'var(--text-tertiary)', marginTop: 4 }}>
                    <span>{data.totalBarsCompleted} bars completed</span>
                    <span className="font-mono">{data.volumeBarSize.toLocaleString()} shares/bar</span>
                  </div>
                </div>
              </div>

              {/* Recommendation */}
              <RecommendationCard
                recommendation={data.recommendation}
                ltp={data.ltp}
                volume={data.volume}
                symbol={data.symbol}
              />

              {/* Spread metrics */}
              <div className="card">
                <div className="card-header">
                  <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>Spread Analysis</span>
                </div>
                <div className="card-body" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div className="metric-card">
                    <div className="metric-label">Spread</div>
                    <div className="metric-value font-mono" style={{ fontSize: '1rem', color: data.spread.spreadBps > 20 ? 'var(--danger)' : 'var(--safe)' }}>
                      {data.spread.spreadBps.toFixed(1)} bps
                    </div>
                  </div>
                  <div className="metric-card">
                    <div className="metric-label">Mid Price</div>
                    <div className="metric-value font-mono" style={{ fontSize: '1rem' }}>
                      ₹{data.spread.mid.toFixed(2)}
                    </div>
                  </div>
                  <div className="metric-card">
                    <div className="metric-label">Bid Depth</div>
                    <div className="metric-value font-mono" style={{ fontSize: '1rem', color: 'var(--buy-color)' }}>
                      ₹{(data.spread.bidDepth / 1e6).toFixed(1)}M
                    </div>
                  </div>
                  <div className="metric-card">
                    <div className="metric-label">Ask Depth</div>
                    <div className="metric-value font-mono" style={{ fontSize: '1rem', color: 'var(--sell-color)' }}>
                      ₹{(data.spread.askDepth / 1e6).toFixed(1)}M
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* ── Right Panel: Metrics + Charts ─────────────────────────────── */}
            <div className="right-panel">
              {/* Metrics Grid */}
              <MetricsGrid data={data} />

              {/* Charts */}
              <div className="charts-row">
                <VolumeBarChart bars={data.volumeBars} />
                <OFIChart history={data.ofiHistory} />
              </div>

              {/* Score Timeline */}
              <VPINGauge
                vpinHistory={data.scoreHistory.map(s => s / 100)} 
                crashRiskHistory={data.crashRiskHistory}
              />

              {/* Session info */}
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0 4px', fontSize: '0.65rem', color: 'var(--text-tertiary)' }}>
                <span>Updates: {data.updateCount} • Engine: {data.computeTimeMs}ms • E2E: {data.totalLatencyMs}ms</span>
                <span>{data.timestamp}</span>
              </div>
            </div>
          </div>
        </motion.div>
      )}

      {/* Footer */}
      <footer style={{
        textAlign: 'center',
        padding: '24px 0',
        fontSize: '0.7rem',
        color: 'var(--text-tertiary)',
        borderTop: '1px solid var(--border-subtle)',
        marginTop: 16,
      }}>
        Toxic Flow Detector • Stochastic Calculus Models (VPIN · Kyle-λ · OFI · Hawkes · PIN) •
        Volume-synchronized intervals • <strong style={{ color: 'var(--text-secondary)' }}>Not financial advice</strong>
      </footer>
    </div>
  );
}
