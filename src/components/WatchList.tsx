import { useState, useCallback, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, X, TrendingUp } from 'lucide-react';
import type { ToxicFlowData, SearchResult } from '../types/toxic';

interface WatchListProps {
  symbols: { symbol: string; exchange: string }[];
  activeSymbol: string;
  activeExchange: string;
  symbolData: Map<string, ToxicFlowData>;
  onSelect: (symbol: string, exchange: string) => void;
  onAdd: (symbol: string, exchange: string) => void;
  onRemove: (symbol: string) => void;
}

const POPULAR_SUGGESTIONS = [
  { symbol: 'RELIANCE', name: 'Reliance Industries' },
  { symbol: 'TCS', name: 'Tata Consultancy' },
  { symbol: 'HDFCBANK', name: 'HDFC Bank' },
  { symbol: 'INFY', name: 'Infosys' },
  { symbol: 'SBIN', name: 'State Bank of India' },
  { symbol: 'ICICIBANK', name: 'ICICI Bank' },
  { symbol: 'WIPRO', name: 'Wipro' },
  { symbol: 'TATAMOTORS', name: 'Tata Motors' },
  { symbol: 'ITC', name: 'ITC Ltd' },
  { symbol: 'BHARTIARTL', name: 'Bharti Airtel' },
];

function getScoreColor(score: number): string {
  if (score <= 25) return 'var(--safe)';
  if (score <= 50) return 'var(--caution)';
  if (score <= 70) return 'var(--toxic)';
  return 'var(--danger)';
}

function getScoreLabel(score: number): string {
  if (score <= 25) return 'SAFE';
  if (score <= 50) return 'CAUTION';
  if (score <= 70) return 'TOXIC';
  return 'DANGER';
}

export default function WatchList({
  symbols, activeSymbol, activeExchange, symbolData,
  onSelect, onAdd, onRemove,
}: WatchListProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [exchangeFilter, setExchangeFilter] = useState<'ALL' | 'NSE' | 'BSE'>('ALL');
  const searchRef = useRef<HTMLInputElement>(null);
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (searchRef.current && symbols.length === 0) {
      searchRef.current.focus();
    }
  }, [symbols.length]);

  const doSearch = useCallback(async (q: string) => {
    if (q.length < 1) { setSearchResults([]); return; }
    setIsSearching(true);
    try {
      const exchangeParam = exchangeFilter !== 'ALL' ? `&exchange=${exchangeFilter}` : '';
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}${exchangeParam}`);
      const data = await res.json();
      if (data.success && data.results) {
        setSearchResults(data.results.slice(0, 10));
      }
    } catch { /* ignore */ }
    setIsSearching(false);
  }, [exchangeFilter]);

  const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value.toUpperCase();
    setSearchQuery(val);
    clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => doSearch(val), 300);
  }, [doSearch]);

  const handleAddSymbol = useCallback((symbol: string, exchange: string) => {
    onAdd(symbol, exchange);
    setSearchQuery('');
    setSearchResults([]);
  }, [onAdd]);

  // Filter popular suggestions to hide already-added stocks
  const filteredSuggestions = POPULAR_SUGGESTIONS.filter(
    s => !symbols.some(sym => sym.symbol === s.symbol)
  );

  return (
    <div className="watchlist-panel">
      {/* Header */}
      <div className="watchlist-header">
        <span className="watchlist-title">
          <TrendingUp size={14} style={{ marginRight: 6, opacity: 0.6 }} />
          Stock Scanner
        </span>
      </div>

      {/* Exchange Filter */}
      <div className="exchange-tabs">
        {(['ALL', 'NSE', 'BSE'] as const).map(tab => (
          <button
            key={tab}
            className={`exchange-tab ${exchangeFilter === tab ? 'active' : ''}`}
            onClick={() => {
              setExchangeFilter(tab);
              if (searchQuery) doSearch(searchQuery);
            }}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Search — always visible */}
      <div className="watchlist-search">
        <Search size={14} style={{ color: 'var(--text-dim)', flexShrink: 0 }} />
        <input
          ref={searchRef}
          type="text"
          className="watchlist-search-input"
          placeholder="Search any stock..."
          value={searchQuery}
          onChange={handleSearchChange}
        />
        {searchQuery && (
          <button
            onClick={() => { setSearchQuery(''); setSearchResults([]); }}
            style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', padding: 2 }}
          >
            <X size={12} />
          </button>
        )}
        {isSearching && (
          <div className="loading-bar" style={{ width: 30, height: 2 }}>
            <div className="loading-bar-fill" />
          </div>
        )}
      </div>

      {/* Search results */}
      <AnimatePresence>
        {searchResults.length > 0 && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
          >
            <div className="watchlist-search-results">
              {searchResults.map((r, i) => (
                <button
                  key={`${r.symbol}-${r.exchange}-${i}`}
                  className="watchlist-search-item"
                  onClick={() => handleAddSymbol(r.symbol, r.exchange)}
                >
                  <div>
                    <div style={{ fontWeight: 600, fontFamily: 'JetBrains Mono, monospace' }}>
                      {r.symbol}
                    </div>
                    <div className="watchlist-search-item-name">
                      {r.name || r.symbol}
                    </div>
                  </div>
                  <span style={{
                    fontSize: '0.55rem',
                    padding: '2px 6px',
                    borderRadius: 4,
                    background: r.exchange?.includes('BSE') ? 'rgba(255, 170, 0, 0.1)' : 'rgba(212, 175, 55, 0.08)',
                    color: r.exchange?.includes('BSE') ? 'var(--caution)' : 'var(--accent-gold)',
                  }}>
                    {r.exchange?.includes('BSE') ? 'BSE' : 'NSE'}
                  </span>
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Quick suggestions when no search and no stocks added */}
      {!searchQuery && symbols.length === 0 && (
        <div className="sidebar-suggestions">
          <div className="suggestions-label">Try these popular stocks:</div>
          <div className="suggestions-list">
            {filteredSuggestions.slice(0, 6).map(s => (
              <button
                key={s.symbol}
                className="suggestion-chip"
                onClick={() => handleAddSymbol(s.symbol, 'NSE_EQ')}
              >
                <span className="suggestion-symbol">{s.symbol}</span>
                <span className="suggestion-name">{s.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Quick suggestions when stocks exist */}
      {!searchQuery && symbols.length > 0 && filteredSuggestions.length > 0 && (
        <div className="sidebar-suggestions compact">
          <div className="suggestions-label">Add more:</div>
          <div className="popular-stocks-grid">
            {filteredSuggestions.slice(0, 5).map(s => (
              <button
                key={s.symbol}
                className="popular-stock-chip"
                onClick={() => handleAddSymbol(s.symbol, 'NSE_EQ')}
              >
                + {s.symbol}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Watchlist Items */}
      <div className="watchlist-items">
        {symbols.map(({ symbol, exchange }) => {
          const isActive = symbol === activeSymbol && exchange === activeExchange;
          const data = symbolData.get(`${symbol}:${exchange}`);
          const score = data?.toxicScore ?? 0;
          const ltp = data?.ltp ?? 0;
          const color = getScoreColor(score);

          return (
            <motion.div
              key={`${symbol}:${exchange}`}
              className={`watchlist-item ${isActive ? 'watchlist-item-selected' : ''}`}
              onClick={() => onSelect(symbol, exchange)}
              layout
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
            >
              <div className="watchlist-item-top">
                <span className="watchlist-symbol font-mono">{symbol}</span>
                <button
                  className="watchlist-remove"
                  onClick={(e) => { e.stopPropagation(); onRemove(symbol); }}
                  title="Remove"
                >
                  <X size={12} />
                </button>
              </div>

              <div className="watchlist-item-mid">
                <span className="watchlist-ltp font-mono">
                  ₹{ltp > 0 ? ltp.toFixed(2) : '—'}
                </span>
                {data && (
                  <span style={{
                    fontSize: '0.58rem',
                    padding: '1px 5px',
                    borderRadius: 3,
                    background: exchange.includes('BSE') ? 'rgba(255, 170, 0, 0.1)' : 'rgba(212, 175, 55, 0.08)',
                    color: exchange.includes('BSE') ? 'var(--caution)' : 'var(--accent-gold)',
                  }}>
                    {exchange.includes('BSE') ? 'BSE' : 'NSE'}
                  </span>
                )}
              </div>

              <div className="watchlist-item-bottom">
                <div className="watchlist-score-bar">
                  <div
                    className="watchlist-score-fill"
                    style={{ width: `${score}%`, background: color }}
                  />
                </div>
                <span className="watchlist-score-label font-mono" style={{ color }}>
                  {score}
                </span>
                {data && (
                  <span
                    className="watchlist-score-tag"
                    style={{ color, borderColor: `${color}33` }}
                  >
                    {getScoreLabel(score)}
                  </span>
                )}
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
