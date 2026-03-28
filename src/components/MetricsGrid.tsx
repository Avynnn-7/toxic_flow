import { useState } from 'react';
import type { ToxicFlowData } from '../types/toxic';
import { TrendingDown, TrendingUp, Activity, BarChart3, Zap, Shield } from 'lucide-react';

interface MetricsGridProps {
  data: ToxicFlowData;
  beginnerMode: boolean;
}

function getMetricColor(value: number, thresholds: [number, number, number]): string {
  if (value <= thresholds[0]) return 'var(--safe)';
  if (value <= thresholds[1]) return 'var(--caution)';
  if (value <= thresholds[2]) return 'var(--toxic)';
  return 'var(--danger)';
}

function getTrafficLight(value: number, thresholds: [number, number, number]): string {
  if (value <= thresholds[0]) return '🟢';
  if (value <= thresholds[1]) return '🟡';
  if (value <= thresholds[2]) return '🟠';
  return '🔴';
}

interface MetricDef {
  label: string;
  beginnerLabel: string;
  value: string;
  color: string;
  sub: string;
  beginnerSub: string;
  icon: React.ReactNode;
  tooltip: string;
  beginnerTooltip: string;
  trafficLight: string;
}

export default function MetricsGrid({ data, beginnerMode }: MetricsGridProps) {
  const [hoveredMetric, setHoveredMetric] = useState<string | null>(null);

  const metrics: MetricDef[] = [
    {
      label: 'VPIN',
      beginnerLabel: 'SECRET TRADING',
      value: (data.vpin * 100).toFixed(1) + '%',
      color: getMetricColor(data.vpin, [0.2, 0.4, 0.6]),
      sub: 'Vol-Synced Informed Prob.',
      beginnerSub: 'Are big players secretly trading?',
      icon: <Activity size={14} />,
      tooltip: 'VPIN measures the probability that trades were made by informed (insider) traders. >40% = elevated. >60% = dangerous.',
      beginnerTooltip: 'This checks if "smart money" (large institutional traders who might have insider info) is secretly buying or selling. A high number means someone might know something you don\'t.',
      trafficLight: getTrafficLight(data.vpin, [0.2, 0.4, 0.6]),
    },
    {
      label: 'OFI',
      beginnerLabel: 'MONEY FLOW',
      value: (data.ofi >= 0 ? '+' : '') + (data.ofi * 100).toFixed(1) + '%',
      color: Math.abs(data.ofi) > 0.3 ? 'var(--danger)' : Math.abs(data.ofi) > 0.15 ? 'var(--caution)' : 'var(--safe)',
      sub: data.ofi > 0 ? 'Buy pressure' : 'Sell pressure',
      beginnerSub: data.ofi > 0 ? '💰 Money flowing IN' : '💸 Money flowing OUT',
      icon: data.ofi > 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />,
      tooltip: 'Order Flow Imbalance: net buying vs selling pressure in the order book. Large positive = aggressive buying.',
      beginnerTooltip: data.ofi > 0
        ? 'More people want to BUY than SELL. Think of it like a crowd rushing into a store — demand is high.'
        : 'More people want to SELL than BUY. Like everyone running for the exit — selling pressure is strong.',
      trafficLight: getTrafficLight(Math.abs(data.ofi), [0.15, 0.3, 0.45]),
    },
    {
      label: "KYLE'S λ",
      beginnerLabel: 'PRICE IMPACT',
      value: data.kyleLambda.toFixed(3),
      color: getMetricColor(data.kyleLambda, [1, 3, 5]),
      sub: 'Price impact / unit flow',
      beginnerSub: 'How much can one trade move the price?',
      icon: <Zap size={14} />,
      tooltip: 'Kyle\'s Lambda: measures how much a single unit of order flow moves the price. High = illiquid, easy to manipulate.',
      beginnerTooltip: 'Imagine throwing a stone into water — this measures how big the splash is. A high number means even a small trade can move the price a lot, making it risky for you.',
      trafficLight: getTrafficLight(data.kyleLambda, [1, 3, 5]),
    },
    {
      label: 'AMIHUD',
      beginnerLabel: 'LIQUIDITY',
      value: data.amihud.toFixed(2),
      color: getMetricColor(data.amihud, [20, 50, 100]),
      sub: 'Illiquidity ratio',
      beginnerSub: 'How easy is it to trade without moving the price?',
      icon: <BarChart3 size={14} />,
      tooltip: 'Amihud illiquidity ratio: price impact per ₹ traded. Higher = less liquid, harder to exit without slippage.',
      beginnerTooltip: 'Think of this as "how crowded is the exit door." Low = easy to get out of your trade. High = if you try to sell, you\'ll have to accept a worse price because nobody is buying.',
      trafficLight: getTrafficLight(data.amihud, [20, 50, 100]),
    },
    {
      label: 'HAWKES',
      beginnerLabel: 'TRADE BURSTS',
      value: (data.hawkes * 100).toFixed(1) + '%',
      color: getMetricColor(data.hawkes, [0.2, 0.5, 0.7]),
      sub: 'Trade clustering',
      beginnerSub: 'Are trades happening in suspicious bursts?',
      icon: <Activity size={14} />,
      tooltip: 'Hawkes process intensity: detects clustering of trades over time. High = HFT activity or coordinated trading bursts.',
      beginnerTooltip: 'Normally, trades happen at a steady pace. When they come in rapid bursts, it could mean high-frequency trading bots or coordinated manipulation. Like hearing a machine gun instead of single shots.',
      trafficLight: getTrafficLight(data.hawkes, [0.2, 0.5, 0.7]),
    },
    {
      label: 'PIN',
      beginnerLabel: 'INSIDER RISK',
      value: (data.pin * 100).toFixed(1) + '%',
      color: getMetricColor(data.pin, [0.15, 0.3, 0.5]),
      sub: 'Prob. of Informed Trading',
      beginnerSub: 'What\'s the chance you\'re trading against insiders?',
      icon: <Shield size={14} />,
      tooltip: 'Probability of Informed Trading: estimates the fraction of trades from informed participants. >30% = concerning.',
      beginnerTooltip: 'This estimates the chance that the person on the other side of your trade KNOWS something you don\'t (like an insider). High = you\'re likely trading against someone with better information.',
      trafficLight: getTrafficLight(data.pin, [0.15, 0.3, 0.5]),
    },
  ];

  return (
    <div className="metrics-row">
      {metrics.map((m) => (
        <div
          key={m.label}
          className="metric-card"
          onMouseEnter={() => setHoveredMetric(m.label)}
          onMouseLeave={() => setHoveredMetric(null)}
        >
          {/* Tooltip */}
          {hoveredMetric === m.label && (
            <div className="metric-tooltip">
              <div className="metric-tooltip-title">
                {beginnerMode ? m.beginnerLabel : m.label} {m.trafficLight}
              </div>
              {beginnerMode ? m.beginnerTooltip : m.tooltip}
            </div>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
            <span style={{ color: m.color, display: 'flex' }}>{m.icon}</span>
            <span className="metric-label" style={{ margin: 0 }}>
              {beginnerMode ? m.beginnerLabel : m.label}
            </span>
            {beginnerMode && (
              <span style={{ color: m.color, fontSize: '0.7rem', marginLeft: 'auto' }}>
                {m.trafficLight}
              </span>
            )}
          </div>
          <div className="metric-value font-mono" style={{ color: m.color }}>
            {m.value}
          </div>
          <div className="metric-sub">
            {beginnerMode ? m.beginnerSub : m.sub}
          </div>
        </div>
      ))}
    </div>
  );
}
