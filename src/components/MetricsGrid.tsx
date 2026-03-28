import type { ToxicFlowData } from '../types/toxic';
import { TrendingDown, TrendingUp, Activity, BarChart3, Zap, Shield } from 'lucide-react';

interface MetricsGridProps {
  data: ToxicFlowData;
}

function getMetricColor(value: number, thresholds: [number, number, number]): string {
  if (value <= thresholds[0]) return 'var(--safe)';
  if (value <= thresholds[1]) return 'var(--caution)';
  if (value <= thresholds[2]) return 'var(--toxic)';
  return 'var(--danger)';
}

export default function MetricsGrid({ data }: MetricsGridProps) {
  const metrics = [
    {
      label: 'VPIN',
      value: (data.vpin * 100).toFixed(1) + '%',
      color: getMetricColor(data.vpin, [0.2, 0.4, 0.6]),
      sub: 'Vol-Synced Informed Prob.',
      icon: <Activity size={14} />,
      tooltip: 'Volume-Synchronized Probability of Informed Trading. >40% = elevated.',
    },
    {
      label: 'OFI',
      value: (data.ofi >= 0 ? '+' : '') + (data.ofi * 100).toFixed(1) + '%',
      color: Math.abs(data.ofi) > 0.3 ? 'var(--danger)' : Math.abs(data.ofi) > 0.15 ? 'var(--caution)' : 'var(--safe)',
      sub: data.ofi > 0 ? 'Buy pressure' : 'Sell pressure',
      icon: data.ofi > 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />,
    },
    {
      label: "KYLE'S λ",
      value: data.kyleLambda.toFixed(3),
      color: getMetricColor(data.kyleLambda, [1, 3, 5]),
      sub: 'Price impact / unit flow',
      icon: <Zap size={14} />,
    },
    {
      label: 'AMIHUD',
      value: data.amihud.toFixed(2),
      color: getMetricColor(data.amihud, [20, 50, 100]),
      sub: 'Illiquidity ratio',
      icon: <BarChart3 size={14} />,
    },
    {
      label: 'HAWKES',
      value: (data.hawkes * 100).toFixed(1) + '%',
      color: getMetricColor(data.hawkes, [0.2, 0.5, 0.7]),
      sub: 'Trade clustering',
      icon: <Activity size={14} />,
    },
    {
      label: 'PIN',
      value: (data.pin * 100).toFixed(1) + '%',
      color: getMetricColor(data.pin, [0.15, 0.3, 0.5]),
      sub: 'Prob. of Informed Trading',
      icon: <Shield size={14} />,
    },
  ];

  return (
    <div className="metrics-row">
      {metrics.map((m) => (
        <div key={m.label} className="metric-card" title={m.tooltip}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
            <span style={{ color: m.color, display: 'flex' }}>{m.icon}</span>
            <span className="metric-label" style={{ margin: 0 }}>{m.label}</span>
          </div>
          <div className="metric-value font-mono" style={{ color: m.color }}>
            {m.value}
          </div>
          <div className="metric-sub">{m.sub}</div>
        </div>
      ))}
    </div>
  );
}
