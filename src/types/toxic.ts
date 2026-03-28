// ══════════════════════════════════════════════════════════════════════════════
// Toxic Flow Detector — TypeScript Interfaces
// ══════════════════════════════════════════════════════════════════════════════

export interface DepthLevel {
  price: number;
  quantity: number;
  orders: number;
}

export interface QuoteDepth {
  buy: DepthLevel[];
  sell: DepthLevel[];
}

export interface SpreadMetrics {
  spread: number;
  spreadBps: number;
  mid: number;
  depthImbalance: number;
  bidDepth: number;
  askDepth: number;
}

export interface VolumeBar {
  open: number;
  high: number;
  low: number;
  close: number;
  buyVol: number;
  sellVol: number;
  vpin: number;
  barIndex: number;
}

export interface OFIPoint {
  normalized: number;
  bidQty: number;
  askQty: number;
  timestamp: number;
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

  // Core metrics
  vpin: number;
  ofi: number;
  kyleLambda: number;
  amihud: number;
  hawkes: number;
  pin: number;

  // Spread
  spread: SpreadMetrics;

  // Scores
  toxicScore: number;
  crashRisk: number;

  // Recommendation
  recommendation: Recommendation;

  // Charts
  volumeBars: VolumeBar[];
  ofiHistory: OFIPoint[];
  scoreHistory: number[];
  crashRiskHistory: number[];

  // Quote
  ltp: number;
  volume: number;

  // Volume bar state
  barProgress: number;
  volumeBarSize: number;
  totalBarsCompleted: number;

  // Meta
  updateCount: number;
  computeTimeMs: number;
  totalLatencyMs: number;
  timestamp: string;

  // Error state
  error?: string;
}

export interface SearchResult {
  symbol: string;
  name: string;
  exchange: string;
  instrumentKey: string;
}
