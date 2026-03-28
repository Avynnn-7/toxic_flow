import { useState, useCallback, useRef, useEffect } from 'react';
import { Search, X, TrendingUp, TrendingDown, Plus } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import type { ToxicFlowData, SearchResult } from '../types/toxic';

interface WatchListProps {
  symbols: Map<string, ToxicFlowData | null>;
  selectedSymbol: string;
  onSelect: (symbol: string, exchange: string) => void;
  onAdd: (symbol: string, exchange: string) => void;
  onRemove: (symbol: string, exchange: string) => void;
}

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
  if (score <= 85) return 'DANGER';
  return 'CRASH';
}

export default function WatchList({ symbols, selectedSymbol, onSelect, onAdd, onRemove }: WatchListProps) {
  const [showSearch, setShowSearch] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const search = useCallback(async (q: string) => {
    if (q.length < 1) { setResults([]); return; }
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
      const json = await res.json();
      if (json.success) setResults(json.results || []);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(query), 150);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, search]);

  useEffect(() => {
    if (showSearch && inputRef.current) inputRef.current.focus();
  }, [showSearch]);

  const handleAdd = (item: SearchResult) => {
    onAdd(item.symbol, item.exchange || 'NSE_EQ');
    setQuery('');
    setResults([]);
    setShowSearch(false);
  };

  return (
    <div className="watchlist-panel">
      {/* Header */}
      <div className="watchlist-header">
        <span className="watchlist-title">Watchlist</span>
        <button
          className="watchlist-add-btn"
          onClick={() => setShowSearch(!showSearch)}
          title="Add symbol"
        >
          <Plus size={16} />
        </button>
      </div>

      {/* Search */}
      <AnimatePresence>
        {showSearch && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            style={{ overflow: 'hidden' }}
          >
            <div className="watchlist-search">
              <Search size={14} style={{ color: 'var(--text-tertiary)', flexShrink: 0 }} />
              <input
                ref={inputRef}
                type="text"
                placeholder="Search symbol..."
                value={query}
                onChange={e => setQuery(e.target.value.toUpperCase())}
                className="watchlist-search-input"
              />
            </div>
            {results.length > 0 && (
              <div className="watchlist-search-results">
                {results.slice(0, 6).map(r => (
                  <button
                    key={`${r.symbol}-${r.exchange}`}
                    className="watchlist-search-item"
                    onClick={() => handleAdd(r)}
                  >
                    <span className="font-mono" style={{ fontWeight: 600 }}>{r.symbol}</span>
                    <span style={{ fontSize: '0.6rem', color: 'var(--text-tertiary)' }}>{r.exchange}</span>
                  </button>
                ))}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Symbol List */}
      <div className="watchlist-items">
        {[...symbols.entries()].map(([key, data]) => {
          const [symbol, exchange] = key.split(':');
          const isSelected = key === `${selectedSymbol}:${exchange}` || symbol === selectedSymbol;
          const score = data?.toxicScore ?? 0;
          const ltp = data?.ltp ?? 0;
          const ofi = data?.ofi ?? 0;
          const color = getScoreColor(score);

          return (
            <motion.div
              key={key}
              className={`watchlist-item ${isSelected ? 'watchlist-item-selected' : ''}`}
              onClick={() => onSelect(symbol, exchange || 'NSE_EQ')}
              layout
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              whileHover={{ x: 2 }}
              style={isSelected ? { borderLeftColor: color } : undefined}
            >
              <div className="watchlist-item-top">
                <span className="watchlist-symbol font-mono">{symbol}</span>
                <button
                  className="watchlist-remove"
                  onClick={e => { e.stopPropagation(); onRemove(symbol, exchange || 'NSE_EQ'); }}
                  title="Remove"
                >
                  <X size={12} />
                </button>
              </div>

              <div className="watchlist-item-mid">
                <span className="watchlist-ltp font-mono">
                  {ltp > 0 ? `₹${ltp.toFixed(2)}` : '—'}
                </span>
                {ofi !== 0 && (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 2, color: ofi > 0 ? 'var(--buy-color)' : 'var(--sell-color)', fontSize: '0.65rem' }}>
                    {ofi > 0 ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
                    {(Math.abs(ofi) * 100).toFixed(1)}%
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
                  {data ? score : '—'}
                </span>
                <span className="watchlist-score-tag" style={{ color, borderColor: `${color}33` }}>
                  {data ? getScoreLabel(score) : '...'}
                </span>
              </div>
            </motion.div>
          );
        })}
      </div>

      {symbols.size === 0 && (
        <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-tertiary)', fontSize: '0.75rem' }}>
          Click + to add symbols
        </div>
      )}
    </div>
  );
}
