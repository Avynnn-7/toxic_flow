#ifndef TOXIC_ENGINE_H
#define TOXIC_ENGINE_H

#include <cmath>
#include <cstring>
#include <algorithm>

constexpr int RING_CAPACITY    = 256;
constexpr int MAX_DEPTH_LEVELS = 5;
constexpr int HISTOGRAM_BINS   = 32;

constexpr double EWMA_VPIN_ALPHA    = 2.0 / 51.0;
constexpr double EWMA_AMIHUD_ALPHA  = 2.0 / 51.0;
constexpr double EWMA_OFI_ALPHA     = 2.0 / 31.0;

constexpr double HAWKES_MU    = 0.5;
constexpr double HAWKES_ALPHA = 0.3;
constexpr double HAWKES_BETA  = 0.1;

constexpr double WELFORD_DECAY = 0.98;

inline double fast_exp(double x) {
    x = std::max(-20.0, std::min(20.0, x));
    return std::exp(x);
}

inline double normal_cdf(double z) {
    if (z < -8.0) return 0.0;
    if (z >  8.0) return 1.0;

    constexpr double a1 =  0.254829592;
    constexpr double a2 = -0.284496736;
    constexpr double a3 =  1.421413741;
    constexpr double a4 = -1.453152027;
    constexpr double a5 =  1.061405429;
    constexpr double p  =  0.3275911;

    double sign = (z >= 0.0) ? 1.0 : -1.0;
    double az   = std::abs(z);
    double t    = 1.0 / (1.0 + p * az);
    double t2   = t  * t;
    double t3   = t2 * t;
    double t4   = t3 * t;
    double t5   = t4 * t;

    double phi = 0.3989422804014327 * fast_exp(-0.5 * az * az);
    double poly = a1*t + a2*t2 + a3*t3 + a4*t4 + a5*t5;
    double erfc_half = phi * poly;

    return 0.5 * (1.0 + sign * (1.0 - 2.0 * erfc_half));
}

inline double fast_clamp01(double x) {
    return (x < 0.0) ? 0.0 : (x > 1.0) ? 1.0 : x;
}

template<typename T, int CAPACITY>
struct RingBuffer {
    static_assert((CAPACITY & (CAPACITY - 1)) == 0, "Capacity must be power of 2");

    T   data[CAPACITY];
    int head  = 0;
    int count = 0;

    void push(const T& item) {
        data[head & (CAPACITY - 1)] = item;
        head++;
        if (count < CAPACITY) count++;
    }

    const T& newest(int offset = 0) const {
        return data[(head - 1 - offset) & (CAPACITY - 1)];
    }

    int  size()  const { return count; }
    bool empty() const { return count == 0; }
    void clear()       { head = 0; count = 0; }
};

struct OnlineHistogram {
    double bin_min    = 0.0;
    double bin_max    = 1.0;
    int    bins[HISTOGRAM_BINS] = {};
    int    total_count = 0;

    void reset(double min_val = 0.0, double max_val = 1.0) {
        bin_min = min_val;
        bin_max = max_val;
        std::memset(bins, 0, sizeof(bins));
        total_count = 0;
    }

    void push(double value) {
        double range = bin_max - bin_min;
        if (range <= 0.0) range = 1.0;
        int idx = static_cast<int>((value - bin_min) / range * HISTOGRAM_BINS);
        idx = std::clamp(idx, 0, HISTOGRAM_BINS - 1);
        bins[idx]++;
        total_count++;
    }

    double percentile_of(double value) const {
        if (total_count == 0) return 0.5;
        double range = bin_max - bin_min;
        if (range <= 0.0) return 0.5;
        int idx = static_cast<int>((value - bin_min) / range * HISTOGRAM_BINS);
        idx = std::clamp(idx, 0, HISTOGRAM_BINS - 1);

        int count_below = 0;
        for (int i = 0; i < idx; i++) count_below += bins[i];
        count_below += bins[idx] / 2;
        return static_cast<double>(count_below) / total_count;
    }
};

struct WelfordRegression {
    double mean_x = 0.0;
    double mean_y = 0.0;
    double c_xy   = 0.0;
    double m2_x   = 0.0;
    double n      = 0.0;
    double decay  = WELFORD_DECAY;

    void reset() {
        mean_x = mean_y = c_xy = m2_x = 0.0;
        n = 0.0;
    }

    void push(double x, double y) {
        n    = n    * decay + 1.0;
        c_xy *= decay;
        m2_x *= decay;

        double dx   = x - mean_x;
        mean_x     += dx / n;
        double dy   = y - mean_y;
        mean_y     += dy / n;

        c_xy += dx * (y - mean_y);
        m2_x += dx * (x - mean_x);
    }

    double slope() const {
        return (m2_x > 1e-10) ? std::abs(c_xy / m2_x) : 0.0;
    }

    int effective_n() const {
        return static_cast<int>(n);
    }
};

struct DepthLevel {
    double price;
    int    quantity;
};

struct Quote {
    double     ltp;
    int        volume;
    DepthLevel bid[MAX_DEPTH_LEVELS];
    DepthLevel ask[MAX_DEPTH_LEVELS];
    int        bid_levels;
    int        ask_levels;
    long       timestamp_ms;
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
    double vpin;
    double ofi;
    double kyle_lambda;
    double amihud;
    double hawkes;
    double pin;

    double spread_bps;
    double mid_price;
    double depth_imbalance;
    double bid_depth_value;
    double ask_depth_value;

    int    toxic_score;
    int    crash_risk;

    int    should_buy;
    int    stoploss_safe;

    double compute_time_us;
    int    update_count;
    int    bars_completed;
    double bar_progress;
};

struct ToxicSession {
    int volume_bar_size;

    Quote last_quote;
    bool  has_last_quote;

    struct {
        double open, high, low, close;
        int    buy_vol, sell_vol, total_vol;
    } bar_acc;

    double ewma_vpin;
    bool   ewma_vpin_init;
    double ewma_amihud;
    bool   ewma_amihud_init;
    double ewma_ofi;
    bool   ewma_ofi_init;

    WelfordRegression kyle_reg;

    double hawkes_intensity;
    long   hawkes_last_ts;
    bool   hawkes_init;

    OnlineHistogram vpin_histogram;

    double pin_sum_buy;
    double pin_sum_sell;
    int    pin_bar_count;
    int    pin_significant;
    double pin_decay;

    int last_bid_qty;
    int last_ask_qty;

    RingBuffer<VolumeBar, RING_CAPACITY> volume_bars;
    RingBuffer<OFIPoint,  RING_CAPACITY> ofi_history;
    RingBuffer<int,       RING_CAPACITY> score_history;
    RingBuffer<int,       RING_CAPACITY> crash_history;

    int update_count;

    void init(int bar_size = 5000) {
        volume_bar_size = bar_size;
        has_last_quote  = false;

        bar_acc          = {};
        bar_acc.high     = -1e18;
        bar_acc.low      =  1e18;

        ewma_vpin        = 0.0; ewma_vpin_init   = false;
        ewma_amihud      = 0.0; ewma_amihud_init = false;
        ewma_ofi         = 0.0; ewma_ofi_init    = false;

        kyle_reg.reset();

        hawkes_intensity = HAWKES_MU;
        hawkes_last_ts   = 0;
        hawkes_init      = false;

        vpin_histogram.reset(0.0, 1.0);

        pin_sum_buy    = 0.0; pin_sum_sell = 0.0;
        pin_bar_count  = 0;   pin_significant = 0;
        pin_decay      = 0.95;

        last_bid_qty = 0;
        last_ask_qty = 0;

        update_count = 0;

        volume_bars.clear();
        ofi_history.clear();
        score_history.clear();
        crash_history.clear();
    }

    void classify_volume(const Quote& q, int& buy_vol, int& sell_vol) {
        if (!has_last_quote) { buy_vol = 0; sell_vol = 0; return; }

        int vol_delta = std::max(0, q.volume - last_quote.volume);
        if (vol_delta == 0) { buy_vol = 0; sell_vol = 0; return; }

        double cur_mid  = (q.bid[0].price + q.ask[0].price) * 0.5;
        if (cur_mid <= 0.0) cur_mid = q.ltp;
        double last_mid = (last_quote.bid[0].price + last_quote.ask[0].price) * 0.5;
        if (last_mid <= 0.0) last_mid = last_quote.ltp;

        double dp     = cur_mid - last_mid;
        double spread = std::max(q.ask[0].price - q.bid[0].price, 0.01);
        double z      = dp / spread;

        double buy_frac = normal_cdf(z);

        buy_vol  = static_cast<int>(vol_delta * buy_frac);
        sell_vol = vol_delta - buy_vol;
    }

    int update_bars(const Quote& q, int buy_vol, int sell_vol) {
        int total = buy_vol + sell_vol;
        if (bar_acc.total_vol == 0) {
            bar_acc.open = q.ltp;
            bar_acc.high = q.ltp;
            bar_acc.low  = q.ltp;
        }
        bar_acc.high      = std::max(bar_acc.high, q.ltp);
        bar_acc.low       = std::min(bar_acc.low,  q.ltp);
        bar_acc.close     = q.ltp;
        bar_acc.buy_vol   += buy_vol;
        bar_acc.sell_vol  += sell_vol;
        bar_acc.total_vol += total;

        int completed = 0;
        while (bar_acc.total_vol >= volume_bar_size) {
            VolumeBar bar;
            bar.open      = bar_acc.open;
            bar.high      = bar_acc.high;
            bar.low       = bar_acc.low;
            bar.close     = bar_acc.close;
            bar.buy_vol   = std::min(bar_acc.buy_vol,  volume_bar_size);
            bar.sell_vol  = std::min(bar_acc.sell_vol, volume_bar_size);
            bar.total_vol = volume_bar_size;
            bar.vpin      = std::abs(bar.buy_vol - bar.sell_vol) / static_cast<double>(bar.total_vol);
            bar.bar_index = volume_bars.size();

            volume_bars.push(bar);

            if (!ewma_vpin_init) {
                ewma_vpin      = bar.vpin;
                ewma_vpin_init = true;
            } else {
                ewma_vpin = EWMA_VPIN_ALPHA * bar.vpin + (1.0 - EWMA_VPIN_ALPHA) * ewma_vpin;
            }

            vpin_histogram.push(bar.vpin);

            pin_sum_buy  = pin_sum_buy  * pin_decay + bar.buy_vol;
            pin_sum_sell = pin_sum_sell * pin_decay + bar.sell_vol;
            pin_bar_count++;
            if (bar.vpin > 0.3) pin_significant++;
            if (pin_bar_count > 30) {
                pin_significant = static_cast<int>(pin_significant * pin_decay);
                pin_bar_count   = 30;
            }

            completed++;

            int overflow = bar_acc.total_vol - volume_bar_size;
            bar_acc.open  = bar_acc.close;
            bar_acc.high  = bar_acc.close;
            bar_acc.low   = bar_acc.close;
            double frac   = (total > 0) ? static_cast<double>(buy_vol) / total : 0.5;
            bar_acc.buy_vol   = static_cast<int>(overflow * frac);
            bar_acc.sell_vol  = overflow - bar_acc.buy_vol;
            bar_acc.total_vol = overflow;
        }
        return completed;
    }

    double compute_vpin() {
        return ewma_vpin;
    }

    double compute_ofi(const Quote& q) {
        int bid_qty = 0, ask_qty = 0;
        for (int i = 0; i < q.bid_levels; i++) bid_qty += q.bid[i].quantity;
        for (int i = 0; i < q.ask_levels; i++) ask_qty += q.ask[i].quantity;

        int    delta_b   = bid_qty - last_bid_qty;
        int    delta_a   = ask_qty - last_ask_qty;
        double ofi_raw   = static_cast<double>(delta_b - delta_a);
        int    total_depth = std::max(bid_qty + ask_qty, 1);
        double norm_ofi  = ofi_raw / total_depth;

        if (!ewma_ofi_init) {
            ewma_ofi      = norm_ofi;
            ewma_ofi_init = true;
        } else {
            ewma_ofi = EWMA_OFI_ALPHA * norm_ofi + (1.0 - EWMA_OFI_ALPHA) * ewma_ofi;
        }

        last_bid_qty = bid_qty;
        last_ask_qty = ask_qty;

        ofi_history.push({norm_ofi, bid_qty, ask_qty});
        return ewma_ofi;
    }

    double compute_kyle_lambda(const Quote& q) {
        if (!has_last_quote) return 0.0;

        double dp  = q.ltp - last_quote.ltp;
        int bq = 0, aq = 0, lbq = 0, laq = 0;
        for (int i = 0; i < q.bid_levels;            i++) bq  += q.bid[i].quantity;
        for (int i = 0; i < q.ask_levels;            i++) aq  += q.ask[i].quantity;
        for (int i = 0; i < last_quote.bid_levels;   i++) lbq += last_quote.bid[i].quantity;
        for (int i = 0; i < last_quote.ask_levels;   i++) laq += last_quote.ask[i].quantity;
        double doi = static_cast<double>((bq - aq) - (lbq - laq));

        kyle_reg.push(doi, dp);

        if (kyle_reg.effective_n() < 5) return 0.0;
        return kyle_reg.slope();
    }

    double compute_amihud(const Quote& q) {
        if (!has_last_quote || last_quote.ltp <= 0.0) return 0.0;
        double ret       = std::abs((q.ltp - last_quote.ltp) / last_quote.ltp);
        int    vol_delta = std::max(q.volume - last_quote.volume, 1);
        double amihud    = ret / vol_delta * 1e6;

        if (!ewma_amihud_init) {
            ewma_amihud      = amihud;
            ewma_amihud_init = true;
        } else {
            ewma_amihud = EWMA_AMIHUD_ALPHA * amihud + (1.0 - EWMA_AMIHUD_ALPHA) * ewma_amihud;
        }

        return ewma_amihud;
    }

    double compute_hawkes(long timestamp_ms) {
        if (!hawkes_init) {
            hawkes_intensity = HAWKES_MU;
            hawkes_last_ts   = timestamp_ms;
            hawkes_init      = true;
            return 0.0;
        }

        double dt = static_cast<double>(timestamp_ms - hawkes_last_ts);
        if (dt <= 0.0) dt = 1.0;

        double decay_factor  = fast_exp(-HAWKES_BETA * dt);
        hawkes_intensity     = HAWKES_MU + decay_factor * (hawkes_intensity - HAWKES_MU + HAWKES_ALPHA);

        hawkes_last_ts = timestamp_ms;

        double clustering = fast_clamp01((hawkes_intensity - HAWKES_MU) / (HAWKES_MU * 3.0));
        return clustering;
    }

    double compute_pin() {
        if (pin_bar_count < 5) return 0.0;

        double avg_buy  = pin_sum_buy  * (1.0 - pin_decay);
        double avg_sell = pin_sum_sell * (1.0 - pin_decay);

        double eps   = std::min(avg_buy, avg_sell) * 0.8;
        double mu    = std::abs(avg_buy - avg_sell);
        double alpha = (pin_bar_count > 0)
                       ? static_cast<double>(pin_significant) / pin_bar_count
                       : 0.0;

        double denom = alpha * mu + 2.0 * eps;
        return (denom > 0.0) ? (alpha * mu) / denom : 0.0;
    }

    int compute_toxic_score(double vpin, double ofi, double lambda,
                            double amihud, double hawkes, double pin,
                            double spread_bps) {
        double v = fast_clamp01(vpin / 0.6);
        double o = fast_clamp01(std::abs(ofi) / 0.5);
        double l = fast_clamp01(lambda / 5.0);
        double a = fast_clamp01(amihud / 100.0);
        double h = fast_clamp01(hawkes);
        double p = fast_clamp01(pin / 0.5);
        double s = fast_clamp01(spread_bps / 50.0);

        double logit = -2.5
                     + 3.5 * v
                     + 2.8 * o
                     + 2.0 * l
                     + 1.5 * a
                     + 1.8 * h
                     + 1.5 * p
                     + 1.0 * s;

        double prob = 1.0 / (1.0 + fast_exp(-logit));
        return std::clamp(static_cast<int>(prob * 100.0), 0, 100);
    }

    int compute_crash_risk(double vpin, double spread_bps, double amihud) {
        if (vpin_histogram.total_count < 5) return 0;

        double pct         = vpin_histogram.percentile_of(vpin);
        double spread_sig  = fast_clamp01(spread_bps / 30.0);

        double amihud_spike = 0.0;
        if (ewma_amihud_init && ewma_amihud > 0.0) {
            amihud_spike = fast_clamp01(amihud / (ewma_amihud * 3.0));
        }

        double logit = -2.0
                     + 4.0 * pct
                     + 2.5 * spread_sig
                     + 2.0 * amihud_spike;

        double prob = 1.0 / (1.0 + fast_exp(-logit));
        return std::clamp(static_cast<int>(prob * 100.0), 0, 100);
    }

    AnalysisResult process_tick(const Quote& q) {
        int buy_vol, sell_vol;
        classify_volume(q, buy_vol, sell_vol);

        update_bars(q, buy_vol, sell_vol);

        double vpin       = compute_vpin();
        double ofi        = compute_ofi(q);
        double lambda     = compute_kyle_lambda(q);
        double amihud_val = compute_amihud(q);
        double hawkes     = compute_hawkes(q.timestamp_ms);
        double pin        = compute_pin();

        double best_bid   = q.bid[0].price;
        double best_ask   = q.ask[0].price;
        double mid        = (best_bid + best_ask) * 0.5;
        if (mid <= 0.0) mid = q.ltp;
        double spread     = best_ask - best_bid;
        double spread_bps = (mid > 0.0) ? (spread / mid) * 10000.0 : 0.0;

        double bid_depth = 0.0, ask_depth = 0.0;
        for (int i = 0; i < q.bid_levels; i++) bid_depth += q.bid[i].price * q.bid[i].quantity;
        for (int i = 0; i < q.ask_levels; i++) ask_depth += q.ask[i].price * q.ask[i].quantity;
        double depth_imb = (bid_depth + ask_depth > 0.0)
                           ? (bid_depth - ask_depth) / (bid_depth + ask_depth)
                           : 0.0;

        int score = compute_toxic_score(vpin, ofi, lambda, amihud_val, hawkes, pin, spread_bps);
        int crash = compute_crash_risk(vpin, spread_bps, amihud_val);

        score_history.push(score);
        crash_history.push(crash);

        last_quote     = q;
        has_last_quote = true;
        update_count++;

        return {
            vpin, ofi, lambda, amihud_val, hawkes, pin,
            spread_bps, mid, depth_imb, bid_depth, ask_depth,
            score, crash,
            (score < 30) ? 2 : (score < 60) ? 1 : 0,
            (crash < 30) ? 2 : (crash < 60) ? 1 : 0,
            0.0,
            update_count,
            volume_bars.size(),
            static_cast<double>(bar_acc.total_vol) / volume_bar_size,
        };
    }
};

#endif