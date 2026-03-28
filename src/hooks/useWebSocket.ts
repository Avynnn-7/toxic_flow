import { useState, useEffect, useRef, useCallback } from 'react';
import type { ToxicFlowData } from '../types/toxic';

/**
 * WebSocket hook for real-time toxic flow updates.
 *
 * Features:
 *   - Auto-reconnect with exponential backoff
 *   - Per-symbol subscriptions
 *   - Falls back to HTTP polling if WebSocket fails
 *   - Heartbeat-aware
 */

// Auto-detect WebSocket URL
function getWsUrl(): string {
  if (import.meta.env.VITE_WS_URL) return import.meta.env.VITE_WS_URL;
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}/ws`;
}

const HTTP_POLL_MS = 1500;

export type SymbolKey = string; // "RELIANCE:NSE_EQ"

interface WsState {
  connected: boolean;
  transport: 'websocket' | 'http-poll' | 'disconnected';
  latency: number;
}

type DataCallback = (symbol: string, data: ToxicFlowData) => void;

export function useWebSocket(onData: DataCallback) {
  const [state, setState] = useState<WsState>({
    connected: false,
    transport: 'disconnected',
    latency: 0,
  });

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttempts = useRef(0);
  const maxReconnect = 5;
  const subscribedSymbols = useRef<Map<string, string>>(new Map()); // symbol -> exchange
  const onDataRef = useRef(onData);
  onDataRef.current = onData;

  // Client-driven WebSocket polling (for CF Workers which can't run server-side intervals)
  const wsPollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const WS_POLL_MS = 500; // 500ms = 2 updates/sec over WebSocket

  // HTTP polling fallback state
  const pollIntervals = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map());
  const usingHttpFallback = useRef(false);

  // ── HTTP Polling Fallback ──────────────────────────────────────────────
  const startHttpPoll = useCallback((symbol: string, exchange: string) => {
    const key = `${symbol}:${exchange}`;
    if (pollIntervals.current.has(key)) return;

    const poll = async () => {
      try {
        const start = performance.now();
        const res = await fetch(`/api/toxic-flow?symbol=${encodeURIComponent(symbol)}&exchange=${encodeURIComponent(exchange)}`);
        const json = await res.json();
        if (json.success) {
          json.transport = 'http-poll';
          onDataRef.current(symbol, json as ToxicFlowData);
          setState(s => ({ ...s, latency: Math.round(performance.now() - start), transport: 'http-poll' }));
        }
      } catch { /* ignore */ }
    };

    poll();
    pollIntervals.current.set(key, setInterval(poll, HTTP_POLL_MS));
  }, []);

  const stopHttpPoll = useCallback((symbol: string, exchange: string) => {
    const key = `${symbol}:${exchange}`;
    const interval = pollIntervals.current.get(key);
    if (interval) {
      clearInterval(interval);
      pollIntervals.current.delete(key);
    }
  }, []);

  const stopAllHttpPolls = useCallback(() => {
    for (const interval of pollIntervals.current.values()) clearInterval(interval);
    pollIntervals.current.clear();
  }, []);

  // ── WebSocket Connection ───────────────────────────────────────────────
  const connect = useCallback(() => {
    try {
      const url = getWsUrl();
      const ws = new WebSocket(url);

      ws.onopen = () => {
        console.log('[WS] Connected');
        setState(s => ({ ...s, connected: true, transport: 'websocket' }));
        reconnectAttempts.current = 0;
        usingHttpFallback.current = false;
        stopAllHttpPolls();

        // Re-subscribe all previously subscribed symbols
        if (subscribedSymbols.current.size > 0) {
          const symbols = [...subscribedSymbols.current.entries()].map(
            ([symbol, exchange]) => ({ symbol, exchange })
          );
          ws.send(JSON.stringify({ type: 'subscribe', symbols }));
        }

        // Start client-driven polling (CF Workers need client to trigger fetches)
        if (wsPollTimer.current) clearInterval(wsPollTimer.current);
        wsPollTimer.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN && subscribedSymbols.current.size > 0) {
            ws.send(JSON.stringify({ type: 'poll' }));
          }
        }, WS_POLL_MS);
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'update') {
            onDataRef.current(msg.symbol, msg.data);
            setState(s => ({ ...s, latency: msg.data?.totalLatencyMs || 0 }));
          }
        } catch { /* ignore parse errors */ }
      };

      ws.onclose = () => {
        console.log('[WS] Disconnected');
        setState(s => ({ ...s, connected: false }));
        // Stop client-driven polling
        if (wsPollTimer.current) { clearInterval(wsPollTimer.current); wsPollTimer.current = null; }

        if (reconnectAttempts.current < maxReconnect) {
          const delay = Math.min(1000 * Math.pow(2, reconnectAttempts.current), 8000);
          console.log(`[WS] Reconnecting in ${delay}ms (attempt ${reconnectAttempts.current + 1})`);
          setTimeout(connect, delay);
          reconnectAttempts.current++;
        } else {
          console.log('[WS] Max reconnect attempts. Falling back to HTTP polling.');
          usingHttpFallback.current = true;
          setState(s => ({ ...s, transport: 'http-poll' }));
          // Start HTTP polling for all subscribed symbols
          for (const [symbol, exchange] of subscribedSymbols.current) {
            startHttpPoll(symbol, exchange);
          }
        }
      };

      ws.onerror = () => {
        // onclose will fire after this
      };

      wsRef.current = ws;
    } catch {
      // WebSocket creation failed — use HTTP polling
      usingHttpFallback.current = true;
      setState(s => ({ ...s, transport: 'http-poll', connected: false }));
      for (const [symbol, exchange] of subscribedSymbols.current) {
        startHttpPoll(symbol, exchange);
      }
    }
  }, [startHttpPoll, stopAllHttpPolls]);

  // ── Subscribe ──────────────────────────────────────────────────────────
  const subscribe = useCallback((symbol: string, exchange: string = 'NSE_EQ') => {
    subscribedSymbols.current.set(symbol, exchange);

    if (usingHttpFallback.current) {
      startHttpPoll(symbol, exchange);
      return;
    }

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'subscribe',
        symbols: [{ symbol, exchange }],
      }));
    }
  }, [startHttpPoll]);

  // ── Unsubscribe ────────────────────────────────────────────────────────
  const unsubscribe = useCallback((symbol: string, exchange: string = 'NSE_EQ') => {
    subscribedSymbols.current.delete(symbol);
    stopHttpPoll(symbol, exchange);

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'unsubscribe',
        symbols: [symbol],
        exchange,
      }));
    }
  }, [stopHttpPoll]);

  // ── Lifecycle ──────────────────────────────────────────────────────────
  useEffect(() => {
    connect();
    return () => {
      wsRef.current?.close();
      stopAllHttpPolls();
      if (wsPollTimer.current) clearInterval(wsPollTimer.current);
    };
  }, [connect, stopAllHttpPolls]);

  return { ...state, subscribe, unsubscribe };
}
