import { useMemo, useState, useEffect } from 'react';
import { motion } from 'framer-motion';

interface ToxicMeterProps {
  score: number;
  label: string;
  color: string;
  size?: number;
}

export default function ToxicMeter({ score, label, color, size = 240 }: ToxicMeterProps) {
  const center = size / 2;
  const radius = size / 2 - 20;
  const strokeWidth = 14;
  const circumference = Math.PI * radius; // half circle
  const startAngle = Math.PI;             // 180° (left)

  // Add a tiny realistic "heartbeat" jitter to the needle
  const [wobble, setWobble] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      // Very tiny variance: +/- 0.02 radians
      setWobble((Math.random() - 0.5) * 0.04);
    }, 1500 + Math.random() * 1000);
    return () => clearInterval(interval);
  }, []);

  const { arcPath, angleDeg, needleLen } = useMemo(() => {
    // SVG arc for the background and fill
    const sx = center + radius * Math.cos(startAngle);
    const sy = center + radius * Math.sin(startAngle);
    const ex = center + radius * Math.cos(0);
    const ey = center + radius * Math.sin(0);
    const arcPath = `M ${sx} ${sy} A ${radius} ${radius} 0 0 1 ${ex} ${ey}`;

    // Needle angle calculation (in degrees)
    // score 0 = -180 deg (left), score 100 = 0 deg (right)
    const baseAngleDeg = -180 + (score / 100) * 180;
    const angleDeg = baseAngleDeg + (wobble * (180 / Math.PI));
    const needleLen = radius - 25;
    
    return { arcPath, angleDeg, needleLen };
  }, [score, center, radius, wobble]);

  // Glow intensity based on score
  const glowIntensity = Math.min(1, score / 70);

  return (
    <div className="gauge-container" style={{ position: 'relative' }}>
      <svg width={size} height={size / 2 + 40} viewBox={`0 0 ${size} ${size / 2 + 40}`}>
        <defs>
          <linearGradient id="gauge-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="var(--safe)" />
            <stop offset="40%" stopColor="var(--caution)" />
            <stop offset="65%" stopColor="var(--toxic)" />
            <stop offset="85%" stopColor="var(--danger)" />
            <stop offset="100%" stopColor="var(--crash)" />
          </linearGradient>
          <filter id="glow">
            <feGaussianBlur stdDeviation={4 * glowIntensity} result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter id="needle-glow">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Background arc */}
        <path
          d={arcPath}
          fill="none"
          stroke="rgba(255,255,255,0.06)"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
        />

        {/* Filled arc */}
        <path
          d={arcPath}
          fill="none"
          stroke="url(#gauge-gradient)"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - score / 100)}
          filter="url(#glow)"
          style={{ transition: 'stroke-dashoffset 0.8s cubic-bezier(0.34, 1.56, 0.64, 1)' }}
        />

        {/* Tick marks */}
        {[0, 25, 50, 75, 100].map((tick) => {
          const angle = Math.PI - (tick / 100) * Math.PI;
          const r1 = radius + 12;
          const r2 = radius + 6;
          return (
            <g key={tick}>
              <line
                x1={center + r2 * Math.cos(angle)}
                y1={center + r2 * Math.sin(angle)}
                x2={center + r1 * Math.cos(angle)}
                y2={center + r1 * Math.sin(angle)}
                stroke="rgba(255,255,255,0.2)"
                strokeWidth="1.5"
              />
              <text
                x={center + (r1 + 10) * Math.cos(angle)}
                y={center + (r1 + 10) * Math.sin(angle)}
                textAnchor="middle"
                dominantBaseline="middle"
                fill="rgba(255,255,255,0.3)"
                fontSize="9"
                fontFamily="JetBrains Mono"
              >
                {tick}
              </text>
            </g>
          );
        })}

        {/* Needle */}
        <motion.g
          animate={{ rotate: angleDeg }}
          transition={{ type: 'spring', stiffness: 80, damping: 15 }}
          style={{ originX: `${center}px`, originY: `${center}px` }}
        >
          <line
            x1={center}
            y1={center}
            x2={center + needleLen}
            y2={center}
            stroke={color}
            strokeWidth="2.5"
            strokeLinecap="round"
            filter="url(#needle-glow)"
          />
        </motion.g>

        {/* Center dot */}
        <circle cx={center} cy={center} r="6" fill={color} opacity="0.9" />
        <circle cx={center} cy={center} r="3" fill="var(--bg-primary)" />

        {/* Score text */}
        <text
          x={center}
          y={center + 30}
          textAnchor="middle"
          fill={color}
          fontSize="28"
          fontWeight="800"
          fontFamily="JetBrains Mono"
          style={{ transition: 'fill 0.5s ease' }}
        >
          {score}
        </text>

        <text
          x={center}
          y={center + 48}
          textAnchor="middle"
          fill="rgba(255,255,255,0.4)"
          fontSize="10"
          fontWeight="500"
          fontFamily="Inter"
          letterSpacing="0.1em"
        >
          TOXIC SCORE
        </text>
      </svg>

      {/* Label badge below */}
      <motion.div
        className={`badge badge-${label.toLowerCase().replace(/\s+/g, '')}`}
        style={{ background: `${color}22`, color, marginTop: 8 }}
        animate={{ scale: [1, 1.04, 1] }}
        transition={{ duration: 2, repeat: Infinity }}
      >
        <span style={{
          width: 6, height: 6, borderRadius: '50%',
          background: color, display: 'inline-block',
          boxShadow: `0 0 8px ${color}`,
        }} />
        {label}
      </motion.div>
    </div>
  );
}
