import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import type { OFIPoint } from '../types/toxic';

interface OFIChartProps {
  history: OFIPoint[];
}

export default function OFIChart({ history }: OFIChartProps) {
  if (history.length < 2) {
    return (
      <div className="card">
        <div className="card-header">
          <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>Order Flow Imbalance</span>
        </div>
        <div className="card-body" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 180, color: 'var(--text-tertiary)', fontSize: '0.8rem' }}>
          Collecting depth data...
        </div>
      </div>
    );
  }

  const chartData = history.map((point, i) => ({
    idx: i,
    ofi: parseFloat((point.normalized * 100).toFixed(2)),
    bidQty: point.bidQty,
    askQty: point.askQty,
  }));

  return (
    <div className="card">
      <div className="card-header">
        <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>Order Flow Imbalance (OFI)</span>
        <div style={{ display: 'flex', gap: 12, fontSize: '0.7rem' }}>
          <span style={{ color: 'var(--buy-color)' }}>▲ Buy Pressure</span>
          <span style={{ color: 'var(--sell-color)' }}>▼ Sell Pressure</span>
        </div>
      </div>
      <div className="card-body" style={{ padding: '12px 8px' }}>
        <div className="chart-container">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="ofi-pos" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#22c55e" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="#22c55e" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="ofi-neg" x1="0" y1="1" x2="0" y2="0">
                  <stop offset="0%" stopColor="#ef4444" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="#ef4444" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="idx"
                tick={{ fill: 'rgba(255,255,255,0.2)', fontSize: 9 }}
                axisLine={{ stroke: 'rgba(255,255,255,0.06)' }}
                tickLine={false}
                interval={Math.max(0, Math.floor(chartData.length / 6))}
              />
              <YAxis
                tick={{ fill: 'rgba(255,255,255,0.2)', fontSize: 9 }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v: number) => `${v.toFixed(0)}%`}
              />
              <Tooltip
                contentStyle={{
                  background: 'rgba(14, 17, 28, 0.95)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: 8,
                  color: '#e8eaf0',
                  fontSize: 12,
                  fontFamily: 'JetBrains Mono',
                }}
                formatter={(value: unknown) => [`${Number(value).toFixed(2)}%`, 'OFI']}
              />
              <ReferenceLine y={0} stroke="rgba(255,255,255,0.15)" strokeDasharray="4 4" />
              <Area
                type="monotone"
                dataKey="ofi"
                stroke="#22c55e"
                fill="url(#ofi-pos)"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 3, fill: '#22c55e' }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
