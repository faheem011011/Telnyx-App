import { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { TelnyxRTC } from '@telnyx/webrtc';
import { callsApi } from '../services/api';
import { useAuth } from './AuthContext';

const TelnyxContext = createContext(null);

const TELNYX_DEFAULTS = {
  deviceReady: false,
  deviceError: null,
  incomingCall: null,
  activeCall: null,
  activeCallInfo: null,
  muted: false,
  recording: false,
  makeCall: () => {},
  acceptIncoming: () => {},
  rejectIncoming: () => {},
  hangup: () => {},
  toggleMute: () => {},
  toggleRecording: () => {},
  sendDigit: () => {},
};

export function TelnyxProvider({ children }) {
  const { user } = useAuth();
  const clientRef = useRef(null);
  const [deviceReady, setDeviceReady] = useState(false);
  const [deviceError, setDeviceError] = useState(null);
  const [incomingCall, setIncomingCall] = useState(null);
  const [activeCall, setActiveCall] = useState(null);
  const [activeCallInfo, setActiveCallInfo] = useState(null);
  const [muted, setMuted] = useState(false);
  const [recording, setRecording] = useState(false);
  const [tokenVersion, setTokenVersion] = useState(0);
  const refreshTimerRef = useRef(null);

  useEffect(() => {
    if (!user) return;

    let client;
    let cancelled = false;

    const scheduleRefresh = (token) => {
      clearTimeout(refreshTimerRef.current);
      let delay = 23 * 60 * 60 * 1000;
      try {
        const { exp } = JSON.parse(atob(token.split('.')[1]));
        if (exp) delay = Math.max(60_000, exp * 1000 - Date.now() - 5 * 60 * 1000);
      } catch (_) {}
      refreshTimerRef.current = setTimeout(() => setTokenVersion((v) => v + 1), delay);
    };

    const setup = async () => {
      try {
        const { token } = await callsApi.getToken();
        if (cancelled) return;

        client = new TelnyxRTC({ login_token: token });

        client.on('telnyx.ready', () => {
          if (!cancelled) setDeviceReady(true);
        });

        client.on('telnyx.error', (error) => {
          console.error('[Telnyx] Error', error);
          if (!cancelled) setDeviceError(error?.message || 'Telnyx connection error');
        });

        client.on('telnyx.notification', (notification) => {
          if (notification.type !== 'callUpdate') return;
          const call = notification.call;
          const state = call?.state;

          if (state === 'ringing' && call.direction === 'inbound') {
            if (!cancelled) setIncomingCall(call);
            call.on('hangup', () => {
              if (!cancelled) setIncomingCall((prev) => (prev?.id === call.id ? null : prev));
            });
          }

          if (state === 'active') {
            if (!cancelled) {
              setActiveCallInfo((prev) =>
                prev?.callId === call.id
                  ? { ...prev, startedAt: Date.now(), connected: true }
                  : prev
              );
            }
          }

          if (state === 'hangup' || state === 'destroy') {
            if (!cancelled) {
              setIncomingCall((prev) => (prev?.id === call.id ? null : prev));
              setActiveCall((prev) => (prev?.id === call.id ? null : prev));
              setActiveCallInfo((prev) => (prev?.callId === call.id ? null : prev));
              setMuted(false);
              setRecording(false);
            }
          }
        });

        client.on('telnyx.socket.close', () => {
          if (!cancelled) setDeviceReady(false);
        });

        client.connect();
        clientRef.current = client;
        scheduleRefresh(token);
      } catch (err) {
        console.error('[Telnyx] Setup failed', err);
        if (!cancelled) {
          setDeviceError(
            err.response?.data?.detail ||
              err.message ||
              'Failed to connect to Telnyx. Check credentials in backend .env.'
          );
        }
      }
    };

    setup();

    return () => {
      cancelled = true;
      clearTimeout(refreshTimerRef.current);
      if (client) {
        try { client.disconnect(); } catch (_) {}
      }
      clientRef.current = null;
      setDeviceReady(false);
    };
  }, [user, tokenVersion]);

  const makeCall = useCallback(
    async (toNumber) => {
      if (!clientRef.current || !deviceReady) {
        throw new Error('Phone not ready. Try again in a moment.');
      }
      const call = clientRef.current.newCall({
        destinationNumber: toNumber,
        callerNumber: user?.phone_number || '',
      });
      setActiveCall(call);
      setActiveCallInfo({ callId: call.id, number: toNumber, direction: 'outbound', startedAt: Date.now(), connected: false });
      setMuted(false);
      return call;
    },
    [deviceReady, user]
  );

  const acceptIncoming = useCallback(() => {
    if (!incomingCall) return;
    const from = incomingCall.options?.remoteCallerNumber || incomingCall.options?.destinationNumber || 'Unknown';
    incomingCall.answer();
    setActiveCall(incomingCall);
    setActiveCallInfo({ callId: incomingCall.id, number: from, direction: 'inbound', startedAt: Date.now(), connected: true });
    setIncomingCall(null);
    setMuted(false);
  }, [incomingCall]);

  const rejectIncoming = useCallback(() => {
    if (!incomingCall) return;
    incomingCall.hangup();
    setIncomingCall(null);
  }, [incomingCall]);

  const hangup = useCallback(() => {
    if (activeCall) activeCall.hangup();
  }, [activeCall]);

  const toggleMute = useCallback(() => {
    if (!activeCall) return;
    const next = !muted;
    if (next) activeCall.muteAudio(); else activeCall.unmuteAudio();
    setMuted(next);
  }, [activeCall, muted]);

  const sendDigit = useCallback(
    (digit) => { if (activeCall) activeCall.dtmf(digit); },
    [activeCall]
  );

  const toggleRecording = useCallback(async () => {
    if (!activeCall) return;
    try {
      if (!recording) {
        await callsApi.startRecording();
        setRecording(true);
      } else {
        await callsApi.stopRecording();
        setRecording(false);
      }
    } catch (e) {
      console.error('[Telnyx] Recording error', e);
    }
  }, [activeCall, recording]);

  const value = {
    deviceReady,
    deviceError,
    incomingCall,
    activeCall,
    activeCallInfo,
    muted,
    recording,
    makeCall,
    acceptIncoming,
    rejectIncoming,
    hangup,
    toggleMute,
    toggleRecording,
    sendDigit,
  };

  return <TelnyxContext.Provider value={value}>{children}</TelnyxContext.Provider>;
}

export const useTelnyx = () => {
  const ctx = useContext(TelnyxContext);
  if (!ctx) return TELNYX_DEFAULTS;
  return ctx;
};
