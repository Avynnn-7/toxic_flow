import { useState, useCallback, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Search, X } from 'lucide-react';
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

const POPULAR_STOCKS = [
  { symbol: 'RELIANCE', exchange: 'NSE_EQ' },
  { symbol: 'TCS', exchange: 'NSE_EQ' },
  { symbol: 'HDFCBANK', exchange: 'NSE_EQ' },
  { symbol: 'INFY', exchange: 'NSE_EQ' },
  { symbol: 'ICICIBANK', exchange: 'NSE_EQ' },
  { symbol: 'SBIN', exchange: 'NSE_EQ' },
  { symbol: 'WIPRO', exchange: 'NSE_EQ' },
  { symbol: 'TATAMOTORS', exchange: 'NSE_EQ' },
  { symbol: 'ADANIENT', exchange: 'NSE_EQ' },
  { symbol: 'BHARTIARTL', exchange: 'NSE_EQ' },
  { symbol: 'ITC', exchange: 'NSE_EQ' },
  { symbol: 'LT', exchange: 'NSE_EQ' },
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
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [exchangeFilter, setExchangeFilter] = useState<'ALL' | 'NSE' | 'BSE'>('ALL');
  const searchRef = useRef<HTMLInputElement>(null);
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (showSearch && searchRef.current) {
      searchRef.current.focus();
    }
  }, [showSearch]);

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
    const alreadyExists = symbols.some(s => s.symbol === symbol);
    if (!alreadyExists) {
      onAdd(symbol, exchange);
    }
    onSelect(symbol, exchange);
    setShowSearch(false);
    setSearchQuery('');
    setSearchResults([]);
  }, [symbols, onAdd, onSelect]);

  const handleQuickAdd = useCallback((symbol: string, exchange: string) => {
    handleAddSymbol(symbol, exchange);
  }, [handleAddSymbol]);

  return (
    <div className="watchlist-panel">
      {/* Header */}
      <div className="watchlist-header">
        <span className="watchlist-title">Scanner</span>
        <button
          className="watchlist-add-btn"
          onClick={() => setShowSearch(!showSearch)}
          title="Add Stock"
        >
          {showSearch ? <X size={14} /> : <Plus size={14} />}
        </button>
      </div>

      {/* Exchange Filter Tabs */}
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

      {/* Search */}
      <AnimatePresence>
        {showSearch && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <div className="watchlist-search">
              <Search size={14} style={{ color: 'var(--text-dim)' }} />
              <input
                ref={searchRef}
                type="text"
                className="watchlist-search-input"
                placeholder="Search NSE / BSE stocks..."
                value={searchQuery}
                onChange={handleSearchChange}
              />
              {isSearching && (
                <div className="loading-bar" style={{ width: 40, height: 2 }}>
                  <div className="loading-bar-fill" />
                </div>
              )}
            </div>

            {/* Popular Stocks Quick-Add */}
            {!searchQuery && (
              <div className="popular-stocks">
                <div className="popular-stocks-label">Popular Stocks</div>
                <div className="popular-stocks-grid">
                  {POPULAR_STOCKS.map(s => (
                    <button
                      key={s.symbol}
                      className="popular-stock-chip"
                      onClick={() => handleQuickAdd(s.symbol, s.exchange)}
                    >
                      {s.symbol}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Search Results */}
            {searchResults.length > 0 && (
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
            )}
          </motion.div>
        )}
      </AnimatePresence>

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

        {symbols.length === 0 && (
          <div style={{
            padding: '40px 20px',
            textAlign: 'center',
            color: 'var(--text-dim)',
            fontSize: '0.75rem',
          }}>
            <p style={{ marginBottom: 8 }}>No stocks in scanner</p>
            <p>Click <strong>+</strong> to add a stock</p>
          </div>
        )}
      </div>
    </div>
  );
}
