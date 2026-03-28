import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, ReferenceLine } from 'recharts';
import type { VolumeBar } from '../types/toxic';

interface VolumeBarChartProps {
  bars: VolumeBar[];
}

export default function VolumeBarChart({ bars }: VolumeBarChartProps) {
  if (bars.length === 0) {
    return (
      <div className="card">
        <div className="card-header">
          <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>Volume Bars (Not Time Bars)</span>
        </div>
        <div className="card-body" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 180, color: 'var(--text-tertiary)', fontSize: '0.8rem' }}>
          Accumulating volume data...
        </div>
      </div>
    );
  }

  const chartData = bars.map((b, i) => ({
    name: `#${b.barIndex || i}`,
    buy: b.buyVol,
    sell: -b.sellVol, // negative for stacked below zero
    vpin: b.vpin,
    net: b.buyVol - b.sellVol,
  }));

  return (
    <div className="card">
      <div className="card-header">
        <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>Volume Bars (Volume Clock)</span>
        <span className="badge" style={{ background: 'var(--bg-glass)', color: 'var(--text-secondary)', fontSize: '0.65rem', padding: '2px 8px' }}>
          {bars.length} bars
        </span>
      </div>
      <div className="card-body" style={{ padding: '12px 8px' }}>
        <div className="chart-container">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} stackOffset="sign">
              <XAxis
                dataKey="name"
                tick={{ fill: 'rgba(255,255,255,0.25)', fontSize: 9 }}
                axisLine={{ stroke: 'rgba(255,255,255,0.06)' }}
                tickLine={false}
                interval={Math.max(0, Math.floor(chartData.length / 8))}
              />
              <YAxis
                tick={{ fill: 'rgba(255,255,255,0.25)', fontSize: 9 }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v: number) => `${Math.abs(v / 1000).toFixed(0)}k`}
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
                formatter={(value: unknown, name: unknown) => {
                  const label = String(name) === 'buy' ? 'Buy Vol' : 'Sell Vol';
                  return [`${Math.abs(Number(value)).toLocaleString()}`, label];
                }}
                labelFormatter={(label) => `Bar ${label}`}
              />
              <ReferenceLine y={0} stroke="rgba(255,255,255,0.1)" />
              <Bar dataKey="buy" stackId="vol" radius={[3, 3, 0, 0]}>
                {chartData.map((entry, i) => (
                  <Cell
                    key={`buy-${i}`}
                    fill={entry.vpin > 0.5 ? '#ff6b35' : entry.vpin > 0.3 ? '#ffaa00' : '#00d4aa'}
                    fillOpacity={0.85}
                  />
                ))}
              </Bar>
              <Bar dataKey="sell" stackId="vol" radius={[0, 0, 3, 3]}>
                {chartData.map((_entry, i) => (
                  <Cell key={`sell-${i}`} fill="#ff4d6a" fillOpacity={0.6} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
