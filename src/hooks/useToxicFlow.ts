import { useState, useEffect, useRef, useCallback } from 'react';
import type { ToxicFlowData } from '../types/toxic';

const POLL_INTERVAL = 1500; // 1.5s — matches Upstox rate limits

interface UseToxicFlowOptions {
  symbol: string;
  exchange?: string;
  enabled?: boolean;
}

export function useToxicFlow({ symbol, exchange = 'NSE_EQ', enabled = true }: UseToxicFlowOptions) {
  const [data, setData] = useState<ToxicFlowData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [latency, setLatency] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const fetchData = useCallback(async () => {
    if (!symbol) return;

    abortRef.current?.abort();
    abortRef.current = new AbortController();

    const start = performance.now();

    try {
      const res = await fetch(
        `/api/toxic-flow?symbol=${encodeURIComponent(symbol)}&exchange=${encodeURIComponent(exchange)}`,
        { signal: abortRef.current.signal }
      );
      const json = await res.json();

      if (!res.ok || !json.success) {
        setError(json.error || `HTTP ${res.status}`);
        return;
      }

      setData(json as ToxicFlowData);
      setError(null);
      setLatency(Math.round(performance.now() - start));
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [symbol, exchange]);

  useEffect(() => {
    if (!enabled || !symbol) {
      setData(null);
      setError(null);
      return;
    }

    setLoading(true);
    fetchData();

    intervalRef.current = setInterval(fetchData, POLL_INTERVAL);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      abortRef.current?.abort();
    };
  }, [symbol, exchange, enabled, fetchData]);

  return { data, error, loading, latency };
}
