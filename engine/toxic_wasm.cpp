

#include "toxic_engine.h"




constexpr int MAX_SESSIONS = 64;
static ToxicSession sessions[MAX_SESSIONS];
static bool session_active[MAX_SESSIONS] = {};
static AnalysisResult last_results[MAX_SESSIONS];


static Quote shared_quote;

extern "C" {



int create_session(int bar_size) {
    for (int i = 0; i < MAX_SESSIONS; i++) {
        if (!session_active[i]) {
            sessions[i].init(bar_size);
            session_active[i] = true;
            return i;
        }
    }
    return -1; 
}

void init_session(int id, int bar_size) {
    if (id >= 0 && id < MAX_SESSIONS) {
        sessions[id].init(bar_size);
        session_active[id] = true;
    }
}

void destroy_session(int id) {
    if (id >= 0 && id < MAX_SESSIONS) {
        session_active[id] = false;
    }
}



void set_quote_ltp(double ltp) { shared_quote.ltp = ltp; }
void set_quote_volume(int volume) { shared_quote.volume = volume; }
void set_quote_timestamp(long ts) { shared_quote.timestamp_ms = ts; }

void set_quote_bid(int level, double price, int qty) {
    if (level >= 0 && level < MAX_DEPTH_LEVELS) {
        shared_quote.bid[level] = {price, qty};
        if (level + 1 > shared_quote.bid_levels) shared_quote.bid_levels = level + 1;
    }
}

void set_quote_ask(int level, double price, int qty) {
    if (level >= 0 && level < MAX_DEPTH_LEVELS) {
        shared_quote.ask[level] = {price, qty};
        if (level + 1 > shared_quote.ask_levels) shared_quote.ask_levels = level + 1;
    }
}

void reset_quote() {
    shared_quote = {};
}



int process_tick(int session_id) {
    if (session_id < 0 || session_id >= MAX_SESSIONS || !session_active[session_id]) {
        return -1;
    }
    last_results[session_id] = sessions[session_id].process_tick(shared_quote);
    return 0; 
}



double get_result_field(int session_id, int field) {
    if (session_id < 0 || session_id >= MAX_SESSIONS) return 0;
    const auto& r = last_results[session_id];

    switch (field) {
        case  0: return r.vpin;
        case  1: return r.ofi;
        case  2: return r.kyle_lambda;
        case  3: return r.amihud;
        case  4: return r.hawkes;
        case  5: return r.pin;
        case  6: return r.spread_bps;
        case  7: return r.mid_price;
        case  8: return r.depth_imbalance;
        case  9: return r.bid_depth_value;
        case 10: return r.ask_depth_value;
        case 11: return static_cast<double>(r.toxic_score);
        case 12: return static_cast<double>(r.crash_risk);
        case 13: return static_cast<double>(r.should_buy);
        case 14: return static_cast<double>(r.stoploss_safe);
        case 15: return r.compute_time_us;
        case 16: return static_cast<double>(r.update_count);
        case 17: return static_cast<double>(r.bars_completed);
        case 18: return r.bar_progress;
        default: return 0;
    }
}



int get_volume_bar_count(int sid) {
    if (sid < 0 || sid >= MAX_SESSIONS) return 0;
    return sessions[sid].volume_bars.size();
}

double get_volume_bar_field(int sid, int offset, int field) {
    if (sid < 0 || sid >= MAX_SESSIONS) return 0;
    const auto& bar = sessions[sid].volume_bars.newest(offset);
    switch (field) {
        case 0: return bar.open;
        case 1: return bar.high;
        case 2: return bar.low;
        case 3: return bar.close;
        case 4: return bar.buy_vol;
        case 5: return bar.sell_vol;
        case 6: return bar.vpin;
        case 7: return bar.bar_index;
        default: return 0;
    }
}

int get_ofi_count(int sid) {
    if (sid < 0 || sid >= MAX_SESSIONS) return 0;
    return sessions[sid].ofi_history.size();
}

double get_ofi_field(int sid, int offset, int field) {
    if (sid < 0 || sid >= MAX_SESSIONS) return 0;
    const auto& pt = sessions[sid].ofi_history.newest(offset);
    switch (field) {
        case 0: return pt.normalized;
        case 1: return pt.bid_qty;
        case 2: return pt.ask_qty;
        default: return 0;
    }
}

int get_score_history_val(int sid, int offset) {
    if (sid < 0 || sid >= MAX_SESSIONS) return 0;
    return sessions[sid].score_history.newest(offset);
}

int get_crash_history_val(int sid, int offset) {
    if (sid < 0 || sid >= MAX_SESSIONS) return 0;
    return sessions[sid].crash_history.newest(offset);
}

int get_score_count(int sid) {
    if (sid < 0 || sid >= MAX_SESSIONS) return 0;
    return sessions[sid].score_history.size();
}

int get_crash_count(int sid) {
    if (sid < 0 || sid >= MAX_SESSIONS) return 0;
    return sessions[sid].crash_history.size();
}

} 
