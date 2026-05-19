import { useEffect, useRef } from 'react';

const API_BASE = (import.meta.env.VITE_API_URL || 'http://localhost:8000').replace(/\/$/, '');
const SSE_EVENTS = ['message.received', 'call.incoming', 'call.updated'];
const HEARTBEAT_TIMEOUT_MS = 45000;
const MAX_RECONNECT_DELAY_MS = 30000;

export function useSSE(token, onEvent) {
  const esRef = useRef(null);
  const reconnectDelay = useRef(1000);
  const reconnectTimer = useRef(null);
  const heartbeatTimer = useRef(null);
  const onEventRef = useRef(onEvent);
  const activeRef = useRef(false);

  // Always keep onEventRef current without triggering reconnects
  useEffect(() => {
    onEventRef.current = onEvent;
  });

  useEffect(() => {
    if (!token) return;
    activeRef.current = true;
    reconnectDelay.current = 1000;

    const connect = () => {
      if (!activeRef.current) return;

      const resetHeartbeat = () => {
        clearTimeout(heartbeatTimer.current);
        heartbeatTimer.current = setTimeout(() => {
          if (esRef.current) {
            esRef.current.close();
            esRef.current = null;
          }
          connect();
        }, HEARTBEAT_TIMEOUT_MS);
      };

      const url = `${API_BASE}/api/events/stream?token=${encodeURIComponent(token)}`;
      const es = new EventSource(url);
      esRef.current = es;

      es.onopen = () => {
        reconnectDelay.current = 1000;
        resetHeartbeat();
      };

      SSE_EVENTS.forEach((name) => {
        es.addEventListener(name, (e) => {
          resetHeartbeat();
          try {
            onEventRef.current(name, JSON.parse(e.data));
          } catch {}
        });
      });

      es.onerror = () => {
        clearTimeout(heartbeatTimer.current);
        es.close();
        esRef.current = null;
        if (!activeRef.current) return;
        const delay = reconnectDelay.current;
        reconnectDelay.current = Math.min(delay * 2, MAX_RECONNECT_DELAY_MS);
        reconnectTimer.current = setTimeout(connect, delay);
      };
    };

    connect();

    return () => {
      activeRef.current = false;
      clearTimeout(reconnectTimer.current);
      clearTimeout(heartbeatTimer.current);
      if (esRef.current) {
        esRef.current.close();
        esRef.current = null;
      }
    };
  }, [token]);
}
