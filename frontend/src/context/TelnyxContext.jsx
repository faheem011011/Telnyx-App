import { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { TelnyxRTC } from '@telnyx/webrtc';
import { PhoneOff, PhoneMissed, WifiOff } from 'lucide-react';
import { callsApi } from '../services/api';
import { useAuth } from './AuthContext';

const TelnyxContext = createContext(null);

const TELNYX_DEFAULTS = {
  deviceReady: false,
  deviceError: null,
  incomingCall: null,
  activeCall: null,
  activeCallInfo: null,
  activeCallSdkState: null,
  callNotification: null,
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

const TERMINAL_STATES = new Set(['hangup', 'destroy', 'purge']);

// ─── Toast shown when the remote side ends / drops a call ────────────────────
const NOTIFICATION_STYLES = {
  ended:        { bg: '#1e293b', border: '#334155', icon: '#94a3b8',  Icon: PhoneOff },
  'no-answer':  { bg: '#7c2d12', border: '#991b1b', icon: '#fca5a5',  Icon: PhoneMissed },
  declined:     { bg: '#7f1d1d', border: '#991b1b', icon: '#fca5a5',  Icon: PhoneOff },
  failed:       { bg: '#431407', border: '#9a3412', icon: '#fdba74',  Icon: PhoneOff },
  disconnected: { bg: '#1e293b', border: '#475569', icon: '#94a3b8',  Icon: WifiOff },
};

function CallNotificationToast({ notification, onDismiss }) {
  if (!notification) return null;
  const s = NOTIFICATION_STYLES[notification.type] || NOTIFICATION_STYLES.ended;
  const { Icon } = s;
  return (
    <div
      className="animate-slide-up"
      onClick={onDismiss}
      style={{
        position: 'fixed', bottom: 24, right: 24, zIndex: 9999,
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '12px 18px', borderRadius: 12,
        background: s.bg, border: `1px solid ${s.border}`,
        color: 'white', fontSize: 13, fontWeight: 600,
        boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
        cursor: 'pointer', userSelect: 'none',
        minWidth: 180,
      }}
    >
      <Icon size={15} color={s.icon} />
      {notification.message}
    </div>
  );
}

export function TelnyxProvider({ children }) {
  const { user } = useAuth();
  const clientRef = useRef(null);
  const audioRef  = useRef(null);

  // ── Refs that must always reflect the latest value without triggering re-renders
  // activeCallRef: the canonical, always-current SDK call object used for hangup/mute/dtmf.
  //   Using the React state value for these would cause stale-closure bugs when the SDK
  //   replaces the call object (e.g. after the 'active' notification).
  const activeCallRef       = useRef(null);
  // wasConnectedRef: did this call ever reach the 'active' SDK state?
  //   Used to pick the right "call ended" vs "no answer" notification message.
  const wasConnectedRef     = useRef(false);
  // userHangupRef: did the user deliberately click Hang Up?
  //   If so, suppress the "Call ended" toast — they already know.
  const userHangupRef       = useRef(false);
  // answeredCallIdRef: guard against the SDK re-firing 'ringing' after answer()
  const answeredCallIdRef   = useRef(null);

  const [deviceReady,       setDeviceReady]       = useState(false);
  const [deviceError,       setDeviceError]       = useState(null);
  const [incomingCall,      setIncomingCall]      = useState(null);
  const [activeCall,        setActiveCall]        = useState(null);
  const [activeCallInfo,    setActiveCallInfo]    = useState(null);
  // activeCallSdkState mirrors the raw SDK call state so the UI can show
  // "Calling…" → "Ringing…" → timer without polling the call object directly.
  const [activeCallSdkState, setActiveCallSdkState] = useState(null);
  const [callNotification,  setCallNotification] = useState(null);
  const [muted,             setMuted]             = useState(false);
  const [recording,         setRecording]         = useState(false);
  const [tokenVersion,      setTokenVersion]      = useState(0);
  const refreshTimerRef = useRef(null);

  // Auto-dismiss call-end toasts after 4 s
  useEffect(() => {
    if (!callNotification) return;
    const id = setTimeout(() => setCallNotification(null), 4_000);
    return () => clearTimeout(id);
  }, [callNotification]);

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
    setActiveCallSdkState(null);
    setMuted(false);
    setRecording(false);
    if (audioRef.current) audioRef.current.srcObject = null;
  }, []);

  // Helper: cleanly terminate a call that died outside normal hangup flow
  // (WebSocket drop, SDK error, etc.) and optionally show a notification.
  const _forceCleanup = useCallback((message) => {
    const wasConn = wasConnectedRef.current;
    activeCallRef.current   = null;
    wasConnectedRef.current = false;
    userHangupRef.current   = false;
    clearCallState();
    setCallNotification({
      type: wasConn ? 'disconnected' : 'failed',
      message,
    });
  }, [clearCallState]);

  // ── SDK initialisation / token refresh ─────────────────────────────────────
  useEffect(() => {
    if (!user) return;
    let client;
    let cancelled = false;

    const scheduleRefresh = (token) => {
      clearTimeout(refreshTimerRef.current);
      let delay = 23 * 60 * 60 * 1_000;
      try {
        const { exp } = JSON.parse(atob(token.split('.')[1]));
        if (exp) delay = Math.max(60_000, exp * 1_000 - Date.now() - 5 * 60 * 1_000);
      } catch (_) {}

      // When the timer fires, wait until no call is active before refreshing.
      // Refreshing mid-call runs cleanup → client.disconnect() → call drops.
      const attemptRefresh = () => {
        if (activeCallRef.current) {
          // Call in progress — check again in 30 s without disconnecting
          refreshTimerRef.current = setTimeout(attemptRefresh, 30_000);
        } else {
          setTokenVersion((v) => v + 1);
        }
      };
      refreshTimerRef.current = setTimeout(attemptRefresh, delay);
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
          if (!cancelled) {
            setDeviceError(error?.message || 'Telnyx connection error');
            if (activeCallRef.current) _forceCleanup('Call failed');
          }
        });

        client.on('telnyx.notification', (notification) => {
          if (notification.type !== 'callUpdate') return;
          const call  = notification.call;
          const state = call?.state;
          if (!call || !state) return;

          // Attach remote audio whenever the stream becomes available
          if (call.remoteStream) attachAudio(call.remoteStream);

          // ── Ringing ──────────────────────────────────────────────────────
          if (state === 'ringing') {
            if (call.direction === 'inbound') {
              // Guard: SDK re-fires 'ringing' after answer() — ignore it
              if (!cancelled && answeredCallIdRef.current !== call.id) {
                setIncomingCall(call);
              }
            } else {
              // Outbound ringing: keep activeCallRef fresh so hangup works,
              // and show "Ringing…" in the UI.
              activeCallRef.current = call;
              if (!cancelled) {
                setActiveCall(call);
                setActiveCallSdkState('ringing');
              }
            }
          }

          // ── Active (both directions) ──────────────────────────────────────
          if (state === 'active') {
            activeCallRef.current   = call;
            wasConnectedRef.current = true;
            if (!cancelled) {
              setActiveCall(call);
              setActiveCallSdkState('active');
              // Set startedAt on first active event; keep it on subsequent ones
              setActiveCallInfo((prev) =>
                prev
                  ? { ...prev, startedAt: prev.startedAt || Date.now(), connected: true }
                  : prev
              );
            }
          }

          // ── Terminal ──────────────────────────────────────────────────────
          if (TERMINAL_STATES.has(state)) {
            activeCallRef.current = null;
            if (!cancelled) {
              const wasConn      = wasConnectedRef.current;
              const wasUserHangup = userHangupRef.current;
              wasConnectedRef.current = false;
              userHangupRef.current   = false;

              // Only notify when the remote side ended the call
              if (!wasUserHangup) {
                if (wasConn) {
                  setCallNotification({ type: 'ended', message: 'Call ended' });
                } else if (call.direction === 'outbound') {
                  setCallNotification({ type: 'no-answer', message: 'No answer' });
                }
              }

              setIncomingCall((prev) => (prev?.id === call.id ? null : prev));
              clearCallState();
              answeredCallIdRef.current = null;
            }
          }
        });

        client.on('telnyx.socket.close', () => {
          if (!cancelled) {
            setDeviceReady(false);
            if (activeCallRef.current) _forceCleanup('Call disconnected');
          }
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
      if (client) { try { client.disconnect(); } catch (_) {} }
      clientRef.current = null;
      setDeviceReady(false);
    };
  }, [user, tokenVersion, attachAudio, clearCallState, _forceCleanup]);

  // ── Public API ──────────────────────────────────────────────────────────────

  const makeCall = useCallback(async (toNumber) => {
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
      remoteElement: audioRef.current || undefined,
    });

    activeCallRef.current   = call;
    wasConnectedRef.current = false;
    userHangupRef.current   = false;

    setActiveCall(call);
    setActiveCallSdkState(null);   // SDK will drive state via notifications
    setActiveCallInfo({
      callId: call.id,
      number: toNumber,
      direction: 'outbound',
      startedAt: null,     // Set when 'active' fires
      connected: false,
    });
    setMuted(false);
    return call;
  }, [deviceReady, user]);

  const acceptIncoming = useCallback(() => {
    if (!incomingCall) return;

    // Try every field the Telnyx SDK might use for the caller's number
    const from =
      incomingCall.options?.remoteCallerNumber ||
      incomingCall.options?.callerNumber       ||
      incomingCall.options?.displayName        ||
      incomingCall.options?.destinationNumber  ||
      'Unknown';

    answeredCallIdRef.current = incomingCall.id;
    activeCallRef.current     = incomingCall;
    wasConnectedRef.current   = false;
    userHangupRef.current     = false;

    incomingCall.answer({ remoteElement: audioRef.current || undefined });

    setActiveCall(incomingCall);
    setActiveCallSdkState(null);   // SDK will confirm with 'active' notification
    // Do NOT set connected:true yet — the SDK 'active' event does that
    setActiveCallInfo({
      callId: incomingCall.id,
      number: from,
      direction: 'inbound',
      startedAt: null,     // Set when 'active' fires
      connected: false,
    });
    setIncomingCall(null);
    setMuted(false);
  }, [incomingCall]);

  const rejectIncoming = useCallback(() => {
    if (!incomingCall) return;
    try { incomingCall.hangup(); } catch (_) {}
    setIncomingCall(null);
  }, [incomingCall]);

  const hangup = useCallback(() => {
    // Mark user-initiated so the terminal handler doesn't show "Call ended" toast
    userHangupRef.current = true;

    // Use the ref (always current) — reading activeCall state risks a stale
    // closure if the SDK replaced the call object between renders.
    const callToHang      = activeCallRef.current;
    activeCallRef.current = null;
    wasConnectedRef.current = false;

    clearCallState();
    answeredCallIdRef.current = null;

    if (callToHang) {
      try { callToHang.hangup(); } catch (_) {}
    }
  }, [clearCallState]); // No longer depends on activeCall state — stale-closure-safe

  const toggleMute = useCallback(() => {
    const call = activeCallRef.current;
    if (!call) return;
    const next = !muted;
    if (next) call.muteAudio(); else call.unmuteAudio();
    setMuted(next);
  }, [muted]);

  const sendDigit = useCallback(
    (digit) => { if (activeCallRef.current) activeCallRef.current.dtmf(digit); },
    [] // ref is always current — no deps needed
  );

  const toggleRecording = useCallback(async () => {
    if (!activeCallRef.current) return;
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
  }, [recording]);

  const value = {
    deviceReady,
    deviceError,
    incomingCall,
    activeCall,
    activeCallInfo,
    activeCallSdkState,
    callNotification,
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
      {/* Hidden audio element — remote party's voice plays here */}
      <audio ref={audioRef} autoPlay playsInline style={{ display: 'none' }} />
      <CallNotificationToast
        notification={callNotification}
        onDismiss={() => setCallNotification(null)}
      />
      {children}
    </TelnyxContext.Provider>
  );
}

export const useTelnyx = () => {
  const ctx = useContext(TelnyxContext);
  if (!ctx) return TELNYX_DEFAULTS;
  return ctx;
};
