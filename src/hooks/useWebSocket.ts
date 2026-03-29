import { useState, useEffect, useRef, useCallback } from 'react';
import type { ToxicFlowData } from '../types/toxic';

/**
 * WebSocket hook for real-time toxic flow updates.
 *
 * Features:
 *   - Auto-reconnect with exponential backoff
 *   - Per-symbol subscriptions
 *   - Immediate HTTP fetch on subscribe for initial data (fixes market-closed blank screen)
 *   - Falls back to HTTP polling if WebSocket fails
 *   - Heartbeat-aware
 */

function getWsUrl(): string {
  if (import.meta.env.VITE_WS_URL) return import.meta.env.VITE_WS_URL;
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}/ws`;
}

const HTTP_POLL_MS = 2000;

export type SymbolKey = string;

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
  const subscribedSymbols = useRef<Map<string, string>>(new Map());
  const onDataRef = useRef(onData);
  onDataRef.current = onData;
  const receivedData = useRef<Set<string>>(new Set()); // track which symbols got WS data

  const wsPollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const WS_POLL_MS = 500;

  const pollIntervals = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map());
  const usingHttpFallback = useRef(false);

  // ── One-shot HTTP fetch (for immediate data on subscribe) ───────────────
  const fetchOnce = useCallback(async (symbol: string, exchange: string) => {
    try {
      const start = performance.now();
      const res = await fetch(`/api/toxic-flow?symbol=${encodeURIComponent(symbol)}&exchange=${encodeURIComponent(exchange)}`);
      const json = await res.json();
      if (json.success) {
        json.transport = 'http-initial';
        onDataRef.current(symbol, json as ToxicFlowData);
        setState(s => ({ ...s, latency: Math.round(performance.now() - start) }));
      }
    } catch { /* ignore */ }
  }, []);

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

        if (subscribedSymbols.current.size > 0) {
          const symbols = [...subscribedSymbols.current.entries()].map(
            ([symbol, exchange]) => ({ symbol, exchange })
          );
          ws.send(JSON.stringify({ type: 'subscribe', symbols }));
        }

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
            receivedData.current.add(msg.symbol);
            onDataRef.current(msg.symbol, msg.data);
            setState(s => ({ ...s, latency: msg.data?.totalLatencyMs || 0 }));
          }
        } catch { /* ignore */ }
      };

      ws.onclose = () => {
        console.log('[WS] Disconnected');
        setState(s => ({ ...s, connected: false }));
        if (wsPollTimer.current) { clearInterval(wsPollTimer.current); wsPollTimer.current = null; }

        if (reconnectAttempts.current < maxReconnect) {
          const delay = Math.min(1000 * Math.pow(2, reconnectAttempts.current), 8000);
          setTimeout(connect, delay);
          reconnectAttempts.current++;
        } else {
          usingHttpFallback.current = true;
          setState(s => ({ ...s, transport: 'http-poll' }));
          for (const [symbol, exchange] of subscribedSymbols.current) {
            startHttpPoll(symbol, exchange);
          }
        }
      };

      ws.onerror = () => {};

      wsRef.current = ws;
    } catch {
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

    // Always do one immediate HTTP fetch so we never show a blank screen
    fetchOnce(symbol, exchange);

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
  }, [startHttpPoll, fetchOnce]);

  // ── Unsubscribe ────────────────────────────────────────────────────────
  const unsubscribe = useCallback((symbol: string, exchange: string = 'NSE_EQ') => {
    subscribedSymbols.current.delete(symbol);
    receivedData.current.delete(symbol);
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
