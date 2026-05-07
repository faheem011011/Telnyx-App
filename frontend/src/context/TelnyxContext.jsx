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

// All states that mean the call is over
const TERMINAL_STATES = new Set(['hangup', 'destroy', 'purge']);

export function TelnyxProvider({ children }) {
  const { user } = useAuth();
  const clientRef = useRef(null);
  const audioRef = useRef(null);
  // Track IDs of calls we've already answered to prevent the ringing
  // notification firing again after answer() and re-showing the modal
  const answeredCallIdRef = useRef(null);

  const [deviceReady, setDeviceReady] = useState(false);
  const [deviceError, setDeviceError] = useState(null);
  const [incomingCall, setIncomingCall] = useState(null);
  const [activeCall, setActiveCall] = useState(null);
  const [activeCallInfo, setActiveCallInfo] = useState(null);
  const [muted, setMuted] = useState(false);
  const [recording, setRecording] = useState(false);
  const [tokenVersion, setTokenVersion] = useState(0);
  const refreshTimerRef = useRef(null);

  // Attach a remote audio stream to the hidden <audio> element so the user
  // can actually hear the other party. Without this, no audio plays even
  // though WebRTC media negotiation succeeds.
  const attachAudio = useCallback((stream) => {
    const el = audioRef.current;
    if (!el || !stream) return;
    if (el.srcObject === stream) return;
    el.srcObject = stream;
    el.play().catch((err) => console.warn('[Telnyx] audio play blocked:', err));
  }, []);

  const clearCallState = useCallback(() => {
    setActiveCall(null);
    setActiveCallInfo(null);
    setMuted(false);
    setRecording(false);
    // Release the audio stream
    if (audioRef.current) {
      audioRef.current.srcObject = null;
    }
  }, []);

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

          // Attach audio stream whenever it becomes available (covers early
          // ringback, active, and any intermediate states with media)
          if (call?.remoteStream) attachAudio(call.remoteStream);

          if (state === 'ringing' && call.direction === 'inbound') {
            // Skip if we already answered this call — the SDK re-fires ringing
            // after answer() which would re-show the incoming call modal
            if (!cancelled && answeredCallIdRef.current !== call.id) {
              setIncomingCall(call);
            }
          }

          if (state === 'active') {
            if (!cancelled) {
              // Update activeCall to latest call object and mark connected.
              // We update regardless of callId match because the SDK may assign
              // a new server-side call_control_id after the call is answered.
              setActiveCall(call);
              setActiveCallInfo((prev) =>
                prev ? { ...prev, startedAt: prev.startedAt || Date.now(), connected: true } : prev
              );
            }
          }

          if (TERMINAL_STATES.has(state)) {
            if (!cancelled) {
              setIncomingCall((prev) => (prev?.id === call.id ? null : prev));
              // Clear active call unconditionally — only one call can be active,
              // and if this terminal event fired the call is definitively over.
              clearCallState();
              answeredCallIdRef.current = null;
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
  }, [user, tokenVersion, attachAudio, clearCallState]);

  const makeCall = useCallback(
    async (toNumber) => {
      if (!clientRef.current || !deviceReady) {
        throw new Error('Phone not ready. Try again in a moment.');
      }
      try {
        await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (_) {
        throw new Error('Microphone access denied. Allow microphone access in your browser and try again.');
      }
      const call = clientRef.current.newCall({
        destinationNumber: toNumber,
        callerNumber: user?.phone_number || '',
        // Pass the audio element so the SDK can attach remote audio itself
        // as a fallback in addition to our manual stream handling above
        remoteElement: audioRef.current || undefined,
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
    // Record that we answered this call BEFORE calling answer() so the ringing
    // re-notification guard fires correctly
    answeredCallIdRef.current = incomingCall.id;
    incomingCall.answer({
      remoteElement: audioRef.current || undefined,
    });
    setActiveCall(incomingCall);
    setActiveCallInfo({ callId: incomingCall.id, number: from, direction: 'inbound', startedAt: Date.now(), connected: true });
    setIncomingCall(null);
    setMuted(false);
  }, [incomingCall]);

  const rejectIncoming = useCallback(() => {
    if (!incomingCall) return;
    try { incomingCall.hangup(); } catch (_) {}
    setIncomingCall(null);
  }, [incomingCall]);

  const hangup = useCallback(() => {
    // Clear UI state immediately — don't wait for the SDK hangup event.
    // If the call is already dead (e.g. Telnyx dropped it due to no media),
    // the SDK event may never arrive, leaving the panel stuck on screen.
    const callToHang = activeCall;
    clearCallState();
    answeredCallIdRef.current = null;
    if (callToHang) {
      try { callToHang.hangup(); } catch (_) {}
    }
  }, [activeCall, clearCallState]);

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

  return (
    <TelnyxContext.Provider value={value}>
      {/* Hidden audio element — the remote party's voice plays through this.
          autoPlay + playsInline are required for mobile browsers. */}
      <audio ref={audioRef} autoPlay playsInline style={{ display: 'none' }} />
      {children}
    </TelnyxContext.Provider>
  );
}

export const useTelnyx = () => {
  const ctx = useContext(TelnyxContext);
  if (!ctx) return TELNYX_DEFAULTS;
  return ctx;
};
