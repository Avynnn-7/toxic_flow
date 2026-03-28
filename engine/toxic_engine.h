/**
 * toxic_engine.h — C++ Toxic Flow Detection Engine
 *
 * High-performance implementation of stochastic calculus models
 * for real-time market microstructure analysis.
 *
 * Designed for:
 *   - Compilation to WebAssembly (emcc)
 *   - Native Node.js addon (node-addon-api)
 *   - Standalone executable
 *
 * All state uses fixed-size ring buffers — zero heap allocation
 * after initialization. Cache-line friendly layout.
 *
 * Target: < 0.05ms (50 microseconds) per tick, single-threaded.
 */

#ifndef TOXIC_ENGINE_H
#define TOXIC_ENGINE_H

#include <cmath>
#include <cstring>
#include <algorithm>

// ══════════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ══════════════════════════════════════════════════════════════════════════════
constexpr int RING_CAPACITY    = 256;   // Power of 2 for fast modulo
constexpr int VPIN_WINDOW      = 50;
constexpr int LAMBDA_WINDOW    = 50;
constexpr int OFI_HISTORY      = 100;
constexpr int HAWKES_WINDOW    = 200;
constexpr int SCORE_HISTORY    = 100;
constexpr int MAX_DEPTH_LEVELS = 5;

// ══════════════════════════════════════════════════════════════════════════════
// RING BUFFER — O(1) push, O(1) indexed access, zero allocation
// Uses power-of-2 capacity for bitwise modulo: (idx & (capacity-1))
// ══════════════════════════════════════════════════════════════════════════════
template<typename T, int CAPACITY>
struct RingBuffer {
    static_assert((CAPACITY & (CAPACITY - 1)) == 0, "Capacity must be power of 2");

    T data[CAPACITY];
    int head = 0;
    int count = 0;

    void push(const T& item) {
        data[head & (CAPACITY - 1)] = item;
        head++;
        if (count < CAPACITY) count++;
    }

    // Access from newest (0 = latest, 1 = second latest, ...)
    const T& newest(int offset = 0) const {
        return data[(head - 1 - offset) & (CAPACITY - 1)];
    }

    // Access from oldest (0 = oldest)
    const T& oldest(int offset = 0) const {
        return data[(head - count + offset) & (CAPACITY - 1)];
    }

    int size() const { return count; }
    bool empty() const { return count == 0; }
    void clear() { head = 0; count = 0; }

    // Sum last N elements (for types supporting operator+)
    T sum_last(int n) const {
        T s{};
        n = std::min(n, count);
        for (int i = 0; i < n; i++) s = s + newest(i);
        return s;
    }
};

// ══════════════════════════════════════════════════════════════════════════════
// DATA STRUCTURES
// ══════════════════════════════════════════════════════════════════════════════
struct DepthLevel {
    double price;
    int    quantity;
};

struct Quote {
    double ltp;
    int    volume;
    DepthLevel bid[MAX_DEPTH_LEVELS];
    DepthLevel ask[MAX_DEPTH_LEVELS];
    int    bid_levels;
    int    ask_levels;
    long   timestamp_ms;
};

struct VolumeBar {
    double open, high, low, close;
    int    buy_vol, sell_vol, total_vol;
    double vpin;
    int    bar_index;
};

struct OFIPoint {
    double normalized;
    int    bid_qty, ask_qty;
};

struct AnalysisResult {
    // Core metrics
    double vpin;
    double ofi;
    double kyle_lambda;
    double amihud;
    double hawkes;
    double pin;

    // Spread
    double spread_bps;
    double mid_price;
    double depth_imbalance;
    double bid_depth_value;
    double ask_depth_value;

    // Scores
    int    toxic_score;     // 0–100
    int    crash_risk;      // 0–100

    // Recommendation
    int    should_buy;      // 0=NO, 1=WAIT, 2=YES
    int    stoploss_safe;   // 0=NO, 1=MAYBE, 2=YES

    // Meta
    double compute_time_us; // microseconds
    int    update_count;
    int    bars_completed;
    double bar_progress;    // 0.0–1.0
};

// ══════════════════════════════════════════════════════════════════════════════
// TOXIC ENGINE SESSION — all state for one symbol
// ══════════════════════════════════════════════════════════════════════════════
struct ToxicSession {
    // Config
    int volume_bar_size;

    // Last quote
    Quote last_quote;
    bool  has_last_quote;

    // Volume bar accumulator
    struct {
        double open, high, low, close;
        int    buy_vol, sell_vol, total_vol;
    } bar_acc;

    // Ring buffers
    RingBuffer<VolumeBar, RING_CAPACITY>  volume_bars;
    RingBuffer<double,    RING_CAPACITY>  vpin_window;
    RingBuffer<OFIPoint,  RING_CAPACITY>  ofi_history;
    RingBuffer<double,    RING_CAPACITY>  price_changes;
    RingBuffer<double,    RING_CAPACITY>  oi_changes;
    RingBuffer<double,    RING_CAPACITY>  amihud_history;
    RingBuffer<long,      RING_CAPACITY>  trade_timestamps;
    RingBuffer<double,    RING_CAPACITY>  hawkes_history;
    RingBuffer<int,       RING_CAPACITY>  score_history;
    RingBuffer<int,       RING_CAPACITY>  crash_history;

    // OFI state
    int last_bid_qty;
    int last_ask_qty;

    // Counters
    int update_count;

    // ── Initialize ──────────────────────────────────────────────────────────
    void init(int bar_size = 5000) {
        volume_bar_size = bar_size;
        has_last_quote = false;
        bar_acc = {};
        bar_acc.high = -1e18;
        bar_acc.low  =  1e18;
        last_bid_qty = 0;
        last_ask_qty = 0;
        update_count = 0;
        volume_bars.clear();
        vpin_window.clear();
        ofi_history.clear();
        price_changes.clear();
        oi_changes.clear();
        amihud_history.clear();
        trade_timestamps.clear();
        hawkes_history.clear();
        score_history.clear();
        crash_history.clear();
    }

    // ── Bulk Volume Classification ──────────────────────────────────────────
    // Logistic approximation to Φ(z): buyFrac = 1 / (1 + e^(-1.7z))
    void classify_volume(const Quote& q, int& buy_vol, int& sell_vol) {
        if (!has_last_quote) { buy_vol = 0; sell_vol = 0; return; }

        int vol_delta = std::max(0, q.volume - last_quote.volume);
        if (vol_delta == 0) { buy_vol = 0; sell_vol = 0; return; }

        double cur_mid = (q.bid[0].price + q.ask[0].price) * 0.5;
        if (cur_mid <= 0) cur_mid = q.ltp;
        double last_mid = (last_quote.bid[0].price + last_quote.ask[0].price) * 0.5;
        if (last_mid <= 0) last_mid = last_quote.ltp;

        double dp = cur_mid - last_mid;
        double spread = std::max(q.ask[0].price - q.bid[0].price, 0.01);
        double z = dp / spread;
        double buy_frac = 1.0 / (1.0 + std::exp(-1.7 * z));

        buy_vol  = static_cast<int>(vol_delta * buy_frac);
        sell_vol = vol_delta - buy_vol;
    }

    // ── Update volume bars ──────────────────────────────────────────────────
    int update_bars(const Quote& q, int buy_vol, int sell_vol) {
        int total = buy_vol + sell_vol;
        if (bar_acc.total_vol == 0) {
            bar_acc.open = q.ltp;
            bar_acc.high = q.ltp;
            bar_acc.low  = q.ltp;
        }
        bar_acc.high = std::max(bar_acc.high, q.ltp);
        bar_acc.low  = std::min(bar_acc.low, q.ltp);
        bar_acc.close = q.ltp;
        bar_acc.buy_vol  += buy_vol;
        bar_acc.sell_vol += sell_vol;
        bar_acc.total_vol += total;

        int completed = 0;
        while (bar_acc.total_vol >= volume_bar_size) {
            VolumeBar bar;
            bar.open = bar_acc.open;
            bar.high = bar_acc.high;
            bar.low  = bar_acc.low;
            bar.close = bar_acc.close;
            bar.buy_vol  = std::min(bar_acc.buy_vol, volume_bar_size);
            bar.sell_vol = std::min(bar_acc.sell_vol, volume_bar_size);
            bar.total_vol = volume_bar_size;
            bar.vpin = std::abs(bar.buy_vol - bar.sell_vol) / (double)bar.total_vol;
            bar.bar_index = volume_bars.size();

            volume_bars.push(bar);
            vpin_window.push(bar.vpin);
            completed++;

            int overflow = bar_acc.total_vol - volume_bar_size;
            bar_acc.open = bar_acc.close;
            bar_acc.high = bar_acc.close;
            bar_acc.low  = bar_acc.close;
            double frac = (total > 0) ? (double)buy_vol / total : 0.5;
            bar_acc.buy_vol  = static_cast<int>(overflow * frac);
            bar_acc.sell_vol = overflow - bar_acc.buy_vol;
            bar_acc.total_vol = overflow;
        }
        return completed;
    }

    // ── Rolling VPIN ────────────────────────────────────────────────────────
    double compute_vpin() {
        if (vpin_window.empty()) return 0;
        int n = std::min(VPIN_WINDOW, vpin_window.size());
        double sum = 0;
        for (int i = 0; i < n; i++) sum += vpin_window.newest(i);
        return sum / n;
    }

    // ── Order Flow Imbalance ────────────────────────────────────────────────
    double compute_ofi(const Quote& q) {
        int bid_qty = 0, ask_qty = 0;
        for (int i = 0; i < q.bid_levels; i++) bid_qty += q.bid[i].quantity;
        for (int i = 0; i < q.ask_levels; i++) ask_qty += q.ask[i].quantity;

        int delta_b = bid_qty - last_bid_qty;
        int delta_a = ask_qty - last_ask_qty;
        double ofi = delta_b - delta_a;
        int total_depth = std::max(bid_qty + ask_qty, 1);
        double norm_ofi = ofi / total_depth;

        last_bid_qty = bid_qty;
        last_ask_qty = ask_qty;

        ofi_history.push({norm_ofi, bid_qty, ask_qty});
        return norm_ofi;
    }

    // ── Kyle's Lambda (OLS regression) ──────────────────────────────────────
    double compute_kyle_lambda(const Quote& q) {
        if (!has_last_quote) return 0;

        double dp = q.ltp - last_quote.ltp;
        int bq = 0, aq = 0, lbq = 0, laq = 0;
        for (int i = 0; i < q.bid_levels; i++) bq += q.bid[i].quantity;
        for (int i = 0; i < q.ask_levels; i++) aq += q.ask[i].quantity;
        for (int i = 0; i < last_quote.bid_levels; i++) lbq += last_quote.bid[i].quantity;
        for (int i = 0; i < last_quote.ask_levels; i++) laq += last_quote.ask[i].quantity;
        double doi = (bq - aq) - (lbq - laq);

        price_changes.push(dp);
        oi_changes.push(doi);

        if (price_changes.size() < 5) return 0;

        int n = std::min(LAMBDA_WINDOW, price_changes.size());
        double mean_p = 0, mean_oi = 0;
        for (int i = 0; i < n; i++) {
            mean_p  += price_changes.newest(i);
            mean_oi += oi_changes.newest(i);
        }
        mean_p /= n; mean_oi /= n;

        double cov = 0, var_oi = 0;
        for (int i = 0; i < n; i++) {
            double dp2 = price_changes.newest(i) - mean_p;
            double do2 = oi_changes.newest(i) - mean_oi;
            cov    += dp2 * do2;
            var_oi += do2 * do2;
        }

        return (var_oi > 0) ? std::abs(cov / var_oi) : 0;
    }

    // ── Amihud Illiquidity ──────────────────────────────────────────────────
    double compute_amihud(const Quote& q) {
        if (!has_last_quote || last_quote.ltp <= 0) return 0;
        double ret = std::abs((q.ltp - last_quote.ltp) / last_quote.ltp);
        int vol_delta = std::max(q.volume - last_quote.volume, 1);
        double amihud = ret / vol_delta * 1e6;
        amihud_history.push(amihud);
        return amihud;
    }

    // ── Hawkes clustering coefficient ───────────────────────────────────────
    double compute_hawkes() {
        if (trade_timestamps.size() < 10) return 0;
        int n = std::min(HAWKES_WINDOW, trade_timestamps.size());

        double sum = 0, sum2 = 0;
        int count = 0;
        for (int i = 1; i < n; i++) {
            double dt = trade_timestamps.newest(i - 1) - trade_timestamps.newest(i);
            sum  += dt;
            sum2 += dt * dt;
            count++;
        }
        if (count == 0) return 0;
        double mean = sum / count;
        if (mean <= 0) return 0;
        double variance = sum2 / count - mean * mean;
        double cov2 = variance / (mean * mean);
        double h = std::min(1.0, std::max(0.0, (cov2 - 1.0) / 4.0));
        hawkes_history.push(h);
        return h;
    }

    // ── PIN approximation ───────────────────────────────────────────────────
    double compute_pin() {
        if (volume_bars.size() < 5) return 0;
        int n = std::min(30, volume_bars.size());
        double avg_buy = 0, avg_sell = 0;
        int significant = 0;
        for (int i = 0; i < n; i++) {
            const auto& bar = volume_bars.newest(i);
            avg_buy  += bar.buy_vol;
            avg_sell += bar.sell_vol;
            if (bar.vpin > 0.3) significant++;
        }
        avg_buy /= n; avg_sell /= n;
        double eps = std::min(avg_buy, avg_sell) * 0.8;
        double mu = std::abs(avg_buy - avg_sell);
        double alpha = (double)significant / n;
        double denom = alpha * mu + eps + eps;
        return (denom > 0) ? (alpha * mu) / denom : 0;
    }

    // ── Composite Score ─────────────────────────────────────────────────────
    int compute_toxic_score(double vpin, double ofi, double lambda,
                            double amihud, double hawkes, double pin,
                            double spread_bps) {
        double v = std::min(1.0, vpin / 0.6);
        double o = std::min(1.0, std::abs(ofi) / 0.5);
        double l = std::min(1.0, lambda / 5.0);
        double a = std::min(1.0, amihud / 100.0);
        double h = std::min(1.0, hawkes);
        double p = std::min(1.0, pin / 0.5);
        double s = std::min(1.0, spread_bps / 50.0);

        double score = (0.25*v + 0.20*o + 0.15*l + 0.12*a +
                        0.10*h + 0.10*p + 0.08*s) * 100.0;
        return std::clamp(static_cast<int>(score), 0, 100);
    }

    // ── Crash Risk ──────────────────────────────────────────────────────────
    int compute_crash_risk(double vpin, double spread_bps, double amihud) {
        if (vpin_window.size() < 5) return 0;
        int n = vpin_window.size();
        int rank = 0;
        for (int i = 0; i < n; i++) {
            if (vpin_window.newest(i) < vpin) rank++;
        }
        double pct = (double)rank / n;
        double spread_sig = std::min(1.0, spread_bps / 30.0);
        double amihud_spike = 0;
        if (amihud_history.size() > 5) {
            double avg = 0;
            int m = amihud_history.size();
            for (int i = 0; i < m; i++) avg += amihud_history.newest(i);
            avg /= m;
            if (avg > 0) amihud_spike = std::min(1.0, amihud / (avg * 3));
        }
        double risk = (0.45*pct + 0.30*spread_sig + 0.25*amihud_spike) * 100.0;
        return std::clamp(static_cast<int>(risk), 0, 100);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // MAIN ENTRY — process one tick, return full analysis
    // ══════════════════════════════════════════════════════════════════════════
    AnalysisResult process_tick(const Quote& q) {
        trade_timestamps.push(q.timestamp_ms);

        int buy_vol, sell_vol;
        classify_volume(q, buy_vol, sell_vol);
        update_bars(q, buy_vol, sell_vol);

        double vpin   = compute_vpin();
        double ofi    = compute_ofi(q);
        double lambda = compute_kyle_lambda(q);
        double amihud_val = compute_amihud(q);
        double hawkes = compute_hawkes();
        double pin    = compute_pin();

        // Spread
        double best_bid = q.bid[0].price;
        double best_ask = q.ask[0].price;
        double mid = (best_bid + best_ask) * 0.5;
        if (mid <= 0) mid = q.ltp;
        double spread = best_ask - best_bid;
        double spread_bps = (mid > 0) ? (spread / mid) * 10000.0 : 0;

        double bid_depth = 0, ask_depth = 0;
        for (int i = 0; i < q.bid_levels; i++) bid_depth += q.bid[i].price * q.bid[i].quantity;
        for (int i = 0; i < q.ask_levels; i++) ask_depth += q.ask[i].price * q.ask[i].quantity;
        double depth_imb = (bid_depth + ask_depth > 0)
            ? (bid_depth - ask_depth) / (bid_depth + ask_depth) : 0;

        int score = compute_toxic_score(vpin, ofi, lambda, amihud_val, hawkes, pin, spread_bps);
        int crash = compute_crash_risk(vpin, spread_bps, amihud_val);

        score_history.push(score);
        crash_history.push(crash);

        last_quote = q;
        has_last_quote = true;
        update_count++;

        return {
            vpin, ofi, lambda, amihud_val, hawkes, pin,
            spread_bps, mid, depth_imb, bid_depth, ask_depth,
            score, crash,
            (score < 30) ? 2 : (score < 60) ? 1 : 0,
            (crash < 30) ? 2 : (crash < 60) ? 1 : 0,
            0.0, // compute_time_us filled by caller
            update_count,
            volume_bars.size(),
            (double)bar_acc.total_vol / volume_bar_size,
        };
    }
};

#endif // TOXIC_ENGINE_H
