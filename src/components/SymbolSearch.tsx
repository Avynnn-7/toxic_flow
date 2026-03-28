import { useState, useEffect, useRef, useCallback } from 'react';
import { Search } from 'lucide-react';
import type { SearchResult } from '../types/toxic';

interface SymbolSearchProps {
  onSelect: (symbol: string, exchange: string) => void;
  currentSymbol: string;
}

export default function SymbolSearch({ onSelect, currentSymbol }: SymbolSearchProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState(-1);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

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
    debounceRef.current = setTimeout(() => search(query), 200);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, search]);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const handleSelect = (item: SearchResult) => {
    onSelect(item.symbol, item.exchange || 'NSE_EQ');
    setQuery('');
    setOpen(false);
    setSelectedIdx(-1);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIdx(i => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIdx(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && selectedIdx >= 0 && results[selectedIdx]) {
      handleSelect(results[selectedIdx]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div className="search-wrapper" ref={wrapperRef}>
      <Search size={18} className="search-icon" />
      <input
        id="symbol-search"
        className="search-input"
        type="text"
        placeholder={currentSymbol || 'Search any NSE/BSE stock...'}
        value={query}
        onChange={e => { setQuery(e.target.value); setOpen(true); setSelectedIdx(-1); }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        autoComplete="off"
      />
      {open && results.length > 0 && (
        <div className="search-dropdown fade-in">
          {results.map((item, i) => (
            <div
              key={`${item.symbol}-${item.exchange}`}
              className="search-item"
              style={i === selectedIdx ? { background: 'var(--bg-card-hover)' } : undefined}
              onClick={() => handleSelect(item)}
              onMouseEnter={() => setSelectedIdx(i)}
            >
              <div>
                <span className="search-symbol">{item.symbol}</span>
                <div className="search-name">{item.name}</div>
              </div>
              <span className="badge" style={{ fontSize: '0.65rem', padding: '2px 8px', background: 'var(--bg-glass)', color: 'var(--text-secondary)' }}>
                {item.exchange}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
