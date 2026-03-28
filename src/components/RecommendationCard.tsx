import type { Recommendation } from '../types/toxic';
import { motion } from 'framer-motion';
import { ShieldCheck, ShieldAlert, ShieldX, AlertTriangle, Skull } from 'lucide-react';

interface RecommendationCardProps {
  recommendation: Recommendation;
  ltp: number;
  volume: number;
  symbol: string;
}

const iconMap: Record<string, React.ReactNode> = {
  'SAFE': <ShieldCheck size={20} />,
  'CAUTION': <AlertTriangle size={20} />,
  'TOXIC': <ShieldAlert size={20} />,
  'DANGER': <ShieldX size={20} />,
  'CRASH RISK': <Skull size={20} />,
};

export default function RecommendationCard({ recommendation, ltp, volume, symbol }: RecommendationCardProps) {
  const { label, action, color, details, toxicScore, crashRisk } = recommendation;

  return (
    <div className="card" style={{ borderColor: `${color}33` }}>
      <div className="card-header" style={{ borderColor: `${color}22` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <motion.span
            style={{ color, display: 'flex' }}
            animate={{ scale: [1, 1.1, 1] }}
            transition={{ duration: 2, repeat: Infinity }}
          >
            {iconMap[label] || <ShieldCheck size={20} />}
          </motion.span>
          <span style={{ fontSize: '0.85rem', fontWeight: 700 }}>Recommendation</span>
        </div>
        <span className="badge" style={{ background: `${color}22`, color }}>
          {label}
        </span>
      </div>
      <div className="recommendation" style={{ borderLeftColor: color }}>
        {/* Stock info */}
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 12 }}>
          <span className="font-mono" style={{ fontSize: '1.3rem', fontWeight: 800, color: 'var(--text-primary)' }}>
            {symbol}
          </span>
          <span className="font-mono" style={{ fontSize: '1rem', color: 'var(--text-secondary)' }}>
            ₹{ltp.toFixed(2)}
          </span>
          <span style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)' }}>
            Vol: {(volume / 1e6).toFixed(2)}M
          </span>
        </div>

        {/* Action */}
        <div className="recommendation-action" style={{ color }}>
          {action}
        </div>

        {/* Details */}
        <div className="recommendation-details">
          {details}
        </div>

        {/* Score summary */}
        <div style={{ display: 'flex', gap: 16, marginTop: 16 }}>
          <div style={{ flex: 1 }}>
            <div className="metric-label">Should you buy?</div>
            <div className="font-mono" style={{
              fontSize: '1rem',
              fontWeight: 700,
              color: toxicScore < 30 ? 'var(--safe)' : toxicScore < 60 ? 'var(--caution)' : 'var(--danger)',
            }}>
              {toxicScore < 30 ? '✅ YES — Safe Entry' : toxicScore < 50 ? '⚠️ WAIT — Mixed Signals' : toxicScore < 70 ? '❌ NO — High Toxicity' : '🚫 ABSOLUTELY NOT'}
            </div>
          </div>
          <div style={{ flex: 1 }}>
            <div className="metric-label">Can stop-loss save you?</div>
            <div className="font-mono" style={{
              fontSize: '1rem',
              fontWeight: 700,
              color: crashRisk < 30 ? 'var(--safe)' : crashRisk < 60 ? 'var(--caution)' : 'var(--danger)',
            }}>
              {crashRisk < 30 ? '✅ Yes — Normal liquidity' : crashRisk < 60 ? '⚠️ Maybe — Slippage risk' : '❌ NO — Liquidity evaporating'}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
