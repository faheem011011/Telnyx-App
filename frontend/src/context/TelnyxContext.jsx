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

// SIP/Telnyx cause strings that indicate "the call failed to set up"
// rather than "the remote party didn't pick up". The SDK exposes these on
// the terminal call notification as `call.cause` (string) and `call.causeCode`
// (numeric Q.850 cause code).
//   408 NO_USER_RESPONSE / 480 TEMPORARILY_UNAVAILABLE — true no-answer
//   486 USER_BUSY / 600 BUSY                            — busy
//   404 UNALLOCATED_NUMBER / 503 SERVICE_UNAVAILABLE    — routing failure
//   603 DECLINE / 487 REQUEST_TERMINATED                — rejected or cancelled
const FAILURE_CAUSES = new Set([
  'CALL_REJECTED',
  'UNALLOCATED_NUMBER',
  'NO_ROUTE_DESTINATION',
  'NO_ROUTE_TRANSIT_NET',
  'INCOMPATIBLE_DESTINATION',
  'SERVICE_UNAVAILABLE',
  'NETWORK_OUT_OF_ORDER',
  'NORMAL_TEMPORARY_FAILURE',
  'RECOVERY_ON_TIMER_EXPIRE',
  'BEARERCAPABILITY_NOTAUTH',
  'BEARERCAPABILITY_NOTAVAIL',
  'CHAN_NOT_IMPLEMENTED',
  'FACILITY_NOT_IMPLEMENTED',
  'REQUESTED_CHAN_UNAVAIL',
]);

function classifyTerminalCause(call) {
  // Telnyx SDK exposes either `cause` (string), `causeCode` (number),
  // or hangs both on `call.cause` / `call.params.cause`. Be defensive.
  const cause =
    (call?.cause ||
      call?.params?.cause ||
      call?.options?.cause ||
      '')
      .toString()
      .toUpperCase();
  const code = Number(call?.causeCode ?? call?.params?.causeCode ?? 0) || 0;

  if (cause === 'USER_BUSY' || code === 486 || code === 600) {
    return { type: 'failed', message: 'Line busy', cause, code };
  }
  if (FAILURE_CAUSES.has(cause) || (code >= 400 && code !== 408 && code !== 480 && code !== 487)) {
    return { type: 'failed', message: `Call failed (${cause || `code ${code}`})`, cause, code };
  }
  // Fall back to the "didn't pick up" bucket — covers NO_USER_RESPONSE,
  // ORIGINATOR_CANCEL, NORMAL_CLEARING-before-active, etc.
  return { type: 'no-answer', message: 'No answer', cause, code };
}

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
  // micStreamRef: the MediaStream we open with getUserMedia before newCall().
  //   On failed call setups the Telnyx SDK does not always release the mic
  //   tracks, so the browser keeps the "microphone in use" indicator on. We
  //   keep an explicit handle and stop the tracks ourselves on terminal state.
  const micStreamRef        = useRef(null);
  const callTimeoutRef      = useRef(null);

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

  // Stop any MediaStreamTrack we (or the SDK) opened so the browser drops the
  // "microphone in use" indicator. Safe to call multiple times.
  const releaseLocalMedia = useCallback((call) => {
    const sdkLocal = call?.options?.localStream || call?.localStream;
    [sdkLocal, micStreamRef.current].forEach((stream) => {
      if (!stream) return;
      try {
        stream.getTracks().forEach((t) => {
          try { t.stop(); } catch (_) {}
        });
      } catch (_) {}
    });
    micStreamRef.current = null;
  }, []);

  const clearCallState = useCallback(() => {
    answeredCallIdRef.current = null;
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
    clearTimeout(callTimeoutRef.current);
    callTimeoutRef.current  = null;
    const wasConn = wasConnectedRef.current;
    const dyingCall = activeCallRef.current;
    activeCallRef.current   = null;
    wasConnectedRef.current = false;
    userHangupRef.current   = false;
    releaseLocalMedia(dyingCall);
    clearCallState();
    setCallNotification({
      type: wasConn ? 'disconnected' : 'failed',
      message,
    });
  }, [clearCallState, releaseLocalMedia]);

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
            clearTimeout(callTimeoutRef.current);
            callTimeoutRef.current  = null;
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
            // Release the mic immediately — the SDK does not reliably stop the
            // local stream when a call fails before reaching 'active' (e.g. the
            // connection has no outbound webhook configured and Telnyx replies
            // 503/CALL_REJECTED). Without this, the browser shows the mic-in-use
            // indicator until the tab is reloaded.
            releaseLocalMedia(call);
            activeCallRef.current = null;
            if (!cancelled) {
              const wasConn      = wasConnectedRef.current;
              const wasUserHangup = userHangupRef.current;
              wasConnectedRef.current = false;
              userHangupRef.current   = false;

              // Log the SDK cause/causeCode so the real reason behind an instant
              // failure is visible in the browser console. Common values:
              //   USER_BUSY                    — destination busy
              //   NO_USER_RESPONSE             — rang, never picked up
              //   ORIGINATOR_CANCEL            — caller hung up before pickup
              //   CALL_REJECTED / 603          — Telnyx routing rejected the call
              //   NO_ROUTE_DESTINATION         — no outbound voice webhook is
              //                                  configured on the Telnyx
              //                                  Connection (the most common
              //                                  cause of "instant No answer"
              //                                  for fresh setups).
              const causeStr =
                call?.cause || call?.params?.cause || call?.options?.cause;
              const causeCode =
                call?.causeCode ?? call?.params?.causeCode ?? null;
              if (!wasConn && call.direction === 'outbound') {
                console.warn(
                  '[Telnyx] Outbound call ended before connecting',
                  { cause: causeStr, causeCode, callId: call?.id },
                );
              }

              // Only notify when the remote side ended the call
              if (!wasUserHangup) {
                if (wasConn) {
                  setCallNotification({ type: 'ended', message: 'Call ended' });
                } else if (call.direction === 'outbound') {
                  const cls = classifyTerminalCause(call);
                  setCallNotification({ type: cls.type, message: cls.message });
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
      releaseLocalMedia(activeCallRef.current);
      if (client) { try { client.disconnect(); } catch (e) { console.warn('[Telnyx] disconnect on cleanup failed', e); } }
      clientRef.current = null;
      setDeviceReady(false);
    };
  }, [user, tokenVersion, attachAudio, clearCallState, _forceCleanup, releaseLocalMedia]);

  // ── Public API ──────────────────────────────────────────────────────────────

  const makeCall = useCallback(async (toNumber) => {
    if (!clientRef.current || !deviceReady) {
      throw new Error('Phone not ready. Try again in a moment.');
    }
    if (activeCallRef.current) {
      throw new Error('A call is already in progress.');
    }
    // Open the mic ourselves and hold onto the stream so we can guarantee it
    // gets stopped on terminal state. The SDK opens its own internal stream
    // but does not always release it on failed setups, leaving the browser's
    // microphone indicator stuck until reload.
    try {
      micStreamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true });
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

    // Auto-cancel if the call never connects within 45 seconds.
    callTimeoutRef.current = setTimeout(() => {
      if (activeCallRef.current && !wasConnectedRef.current) {
        _forceCleanup('Call timed out — no answer.');
      }
    }, 45_000);

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

    // Try every field the Telnyx SDK might use for the caller's number.
    // For inbound calls the SDK exposes the caller's E.164 on `incomingCall.from`.
    // Never fall back to `destinationNumber` — that is the *user's own* number.
    const from =
      incomingCall.options?.remoteCallerNumber ||
      incomingCall.options?.callerNumber       ||
      incomingCall.from                        ||
      incomingCall.options?.displayName        ||
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
    try { incomingCall.hangup(); } catch (e) { console.warn('[Telnyx] reject hangup failed', e); }
    releaseLocalMedia(incomingCall);
    setIncomingCall(null);
  }, [incomingCall, releaseLocalMedia]);

  const hangup = useCallback(() => {
    clearTimeout(callTimeoutRef.current);
    callTimeoutRef.current = null;
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
      try { callToHang.hangup(); } catch (e) { console.warn('[Telnyx] hangup failed', e); }
    }
    // Always release mic tracks — even if the SDK call object was already gone
    // or hangup() threw, we own the getUserMedia stream and must close it.
    releaseLocalMedia(callToHang);
  }, [clearCallState, releaseLocalMedia]); // No longer depends on activeCall state — stale-closure-safe

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
    const callSid = activeCallRef.current?.id;
    if (!callSid) {
      console.warn('[Telnyx] No SDK call id known; cannot record');
      return;
    }
    try {
      if (!recording) {
        await callsApi.startRecording(callSid);
        setRecording(true);
      } else {
        await callsApi.stopRecording(callSid);
        setRecording(false);
      }
    } catch (e) {
      console.error('[Telnyx] Recording error', e);
      setCallNotification({
        type: 'failed',
        message: `Recording ${recording ? 'stop' : 'start'} failed`,
      });
    }
  }, [recording, setCallNotification]);

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
