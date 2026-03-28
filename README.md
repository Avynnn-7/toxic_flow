# Toxic Flow Detector

Real-time market microstructure analysis using stochastic calculus models on **volume-synchronized intervals** (not time bars). Detects institutional manipulation, toxic order flow, and crash risk before stop-losses can't save you.

## Algorithms

| Model | What It Detects |
|-------|-----------------|
| **VPIN** (Easley et al.) | Volume-Synced Informed Trading Probability — spiked before 2010 Flash Crash |
| **Kyle's Lambda** | Price impact per unit order flow — thin liquidity = toxic |
| **OFI** (Order Flow Imbalance) | Sustained bid/ask depth asymmetry = institutional accumulation |
| **Amihud Illiquidity** | |Return| / Volume — high = crash precursor |
| **Hawkes Process** | Trade arrival clustering — informed traders cluster |
| **PIN** (Poisson model) | Probability of Informed Trading from arrival rates |

All computed on **volume bars** — each bar = fixed N shares traded. This normalizes for activity levels (more bars in volatile sessions, fewer in quiet ones).

## Architecture

```
Browser (React + Vite)
    ↓ fetch /api/toxic-flow?symbol=...     (never sees token)
Vercel Serverless Functions (/api/)
    ↓ Bearer token from process.env
Upstox REST API (quotes + depth)
    ↓ computed server-side
VPIN · Kyle-λ · OFI · PIN · Amihud → Toxic Score + Recommendation
```

## Security

- `UPSTOX_ACCESS_TOKEN` is **never** exposed to the frontend
- All API calls proxy through `/api/` serverless functions
- Token is set as Vercel environment variable, NOT in code
- `.env` is gitignored

## Scoring

| Toxic Score | Label | Action |
|-------------|-------|--------|
| 0–25 | 🟢 SAFE | Normal market. Safe to trade. |
| 25–50 | 🟡 CAUTION | Slight institutional presence. |
| 50–70 | 🟠 TOXIC | Significant informed flow. Wait. |
| 70–85 | 🔴 DANGER | Manipulation likely. Exit. |
| 85–100 | ⚠️ CRASH RISK | VPIN critical. Volatility collapse possible. |

## Quick Start

```bash
npm install
# Set your Upstox token
cp .env.example .env
# Edit .env with your token
npm run dev
```

## Deploy to Vercel

1. Push to GitHub
2. Import in Vercel
3. Set `UPSTOX_ACCESS_TOKEN` in Settings > Environment Variables
4. Deploy

## Tech Stack

- **Frontend:** React 19 + TypeScript + Vite
- **Charts:** Recharts (volume bars, OFI area, score timeline)
- **Animations:** Framer Motion (gauge needle, alerts)
- **Backend:** Vercel Serverless Functions (Node.js)
- **Data:** Upstox v2/v3 REST API (real-time quotes + depth)
- **Engine:** Custom ring-buffer based stochastic models (< 3ms per computation)

---

**⚠️ Disclaimer:** This is a decision-support tool only — not financial advice. The crash risk score is a probabilistic signal, not a guarantee.
