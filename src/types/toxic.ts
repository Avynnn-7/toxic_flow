// ══════════════════════════════════════════════════════════════════════════════
// Toxic Flow Data Model — TypeScript interfaces
// ══════════════════════════════════════════════════════════════════════════════

export interface VolumeBar {
  barIndex: number;
  open: number;
  high: number;
  low: number;
  close: number;
  buyVol: number;
  sellVol: number;
  totalVol: number;
  vpin: number;
}

export interface OFIPoint {
  normalized: number;
  bidQty: number;
  askQty: number;
}

export interface Spread {
  spreadBps: number;
  mid: number;
  bidDepth: number;
  askDepth: number;
  depthImbalance: number;
}

export interface Recommendation {
  label: string;
  action: string;
  color: string;
  details: string;
  toxicScore: number;
  crashRisk: number;
}

export interface ToxicFlowData {
  success: boolean;
  symbol: string;
  exchange: string;
  ltp: number;
  volume: number;

  // Core metrics
  vpin: number;
  ofi: number;
  kyleLambda: number;
  amihud: number;
  hawkes: number;
  pin: number;

  // Scores
  toxicScore: number;
  crashRisk: number;

  // Spread
  spread: Spread;

  // Volume bars
  volumeBars: VolumeBar[];
  volumeBarSize: number;
  barProgress: number;
  totalBarsCompleted: number;

  // History
  ofiHistory: OFIPoint[];
  scoreHistory: number[];
  crashRiskHistory: number[];

  // Recommendation
  recommendation: Recommendation;

  // Meta
  computeTimeMs: number;
  totalLatencyMs: number;
  updateCount: number;
  timestamp: string;
  transport: 'websocket' | 'http-poll';
}

export interface SearchResult {
  symbol: string;
  name: string;
  exchange: string;
  instrumentKey: string;
  instrumentType: string;
}
