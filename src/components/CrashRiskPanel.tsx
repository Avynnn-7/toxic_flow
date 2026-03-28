import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, ShieldAlert } from 'lucide-react';

interface CrashRiskPanelProps {
  crashRisk: number;
  toxicScore: number;
  details: string;
}

export default function CrashRiskPanel({ crashRisk, toxicScore, details }: CrashRiskPanelProps) {
  const showAlert = crashRisk > 50 || toxicScore > 65;

  return (
    <AnimatePresence>
      {showAlert && (
        <motion.div
          className="crash-alert"
          initial={{ opacity: 0, height: 0, marginBottom: 0 }}
          animate={{ opacity: 1, height: 'auto', marginBottom: 0 }}
          exit={{ opacity: 0, height: 0, marginBottom: 0 }}
          transition={{ duration: 0.4 }}
        >
          <div className="crash-alert-title">
            {crashRisk > 70 ? (
              <ShieldAlert size={20} />
            ) : (
              <AlertTriangle size={20} />
            )}
            {crashRisk > 70
              ? '⚠️ CRASH RISK CRITICAL'
              : crashRisk > 50
                ? '🔴 ELEVATED CRASH RISK'
                : '🟠 TOXIC FLOW DETECTED'}
          </div>
          <div className="crash-alert-body">
            {crashRisk > 70 ? (
              <>
                <strong>VPIN at 95th+ percentile.</strong> Historical Flash Crash (2010),
                VIX-mageddon (Feb 2018), and Volmageddon events showed identical signatures.
                Liquidity is evaporating — stop-loss orders may NOT execute at expected prices.
                <br /><br />
                <strong>Recommendation:</strong> EXIT all positions immediately.
                Do NOT attempt to &quot;buy the dip&quot; — volatility can vanish entirely,
                leaving you with unlimited downside.
              </>
            ) : (
              details
            )}
          </div>
          <div style={{ display: 'flex', gap: 16, marginTop: 12 }}>
            <div className="metric-card" style={{ flex: 1, borderColor: 'rgba(255,0,64,0.2)' }}>
              <div className="metric-label">Crash Risk Score</div>
              <div className="metric-value font-mono" style={{ color: crashRisk > 70 ? 'var(--crash)' : 'var(--danger)' }}>
                {crashRisk}
              </div>
            </div>
            <div className="metric-card" style={{ flex: 1, borderColor: 'rgba(255,0,64,0.2)' }}>
              <div className="metric-label">Toxic Score</div>
              <div className="metric-value font-mono" style={{ color: toxicScore > 70 ? 'var(--danger)' : 'var(--toxic)' }}>
                {toxicScore}
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
