import { Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, Area, ComposedChart } from 'recharts';

interface VPINGaugeProps {
  vpinHistory: number[];
  crashRiskHistory: number[];
}

export default function VPINGauge({ vpinHistory, crashRiskHistory }: VPINGaugeProps) {
  const chartData = vpinHistory.map((v, i) => ({
    idx: i,
    vpin: parseFloat((v * 100).toFixed(1)),
    crashRisk: crashRiskHistory[i] || 0,
  }));

  if (chartData.length < 2) {
    return (
      <div className="card">
        <div className="card-header">
          <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>VPIN & Crash Risk Timeline</span>
        </div>
        <div className="card-body" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 180, color: 'var(--text-tertiary)', fontSize: '0.8rem' }}>
          Building VPIN history...
        </div>
      </div>
    );
  }

  // Use score history directly (these are toxic scores already 0-100)
  const vpinData = chartData.map(d => ({
    ...d,
    // For the chart, show VPIN as percentage
    vpin: d.vpin,
  }));

  return (
    <div className="card">
      <div className="card-header">
        <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>Toxic Score & Crash Risk</span>
        <div style={{ display: 'flex', gap: 12, fontSize: '0.65rem' }}>
          <span style={{ color: '#a855f7' }}>━ Toxic Score</span>
          <span style={{ color: '#ff3b57' }}>━ Crash Risk</span>
        </div>
      </div>
      <div className="card-body" style={{ padding: '12px 8px' }}>
        <div className="chart-container">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={vpinData}>
              <defs>
                <linearGradient id="crash-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#ff3b57" stopOpacity={0.15} />
                  <stop offset="100%" stopColor="#ff3b57" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="idx"
                tick={{ fill: 'rgba(255,255,255,0.2)', fontSize: 9 }}
                axisLine={{ stroke: 'rgba(255,255,255,0.06)' }}
                tickLine={false}
                interval={Math.max(0, Math.floor(vpinData.length / 6))}
              />
              <YAxis
                domain={[0, 100]}
                tick={{ fill: 'rgba(255,255,255,0.2)', fontSize: 9 }}
                axisLine={false}
                tickLine={false}
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
              />
              {/* Danger zone reference */}
              <ReferenceLine y={70} stroke="rgba(255,59,87,0.3)" strokeDasharray="6 4" label={{ value: 'DANGER', fill: 'rgba(255,59,87,0.4)', fontSize: 9 }} />
              <ReferenceLine y={50} stroke="rgba(255,170,0,0.2)" strokeDasharray="4 4" />

              <Area
                type="monotone"
                dataKey="crashRisk"
                fill="url(#crash-fill)"
                stroke="transparent"
              />
              <Line
                type="monotone"
                dataKey="crashRisk"
                stroke="#ff3b57"
                strokeWidth={1.5}
                dot={false}
                activeDot={{ r: 3, fill: '#ff3b57' }}
              />
              <Line
                type="monotone"
                dataKey="vpin"
                stroke="#a855f7"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 3, fill: '#a855f7' }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
