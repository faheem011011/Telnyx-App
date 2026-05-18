import { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { TelnyxRTC } from '@telnyx/webrtc';
import { PhoneOff, PhoneMissed, WifiOff } from 'lucide-react';
import { callsApi } from '../services/api';
import { useAuth } from './AuthContext';

const TelnyxContext = createContext(null);

const TELNYX_DEFAULTS = {
  deviceReady: false,
  deviceError: null,
  incomingCalls: [],      // H-11: queue instead of single incomingCall
  activeCall: null,
  activeCallInfo: null,
  activeCallSdkState: null,
  heldCallInfo: null,
  callNotification: null,
  muted: false,
  recording: false,
  makeCall: () => {},
  acceptIncoming: () => {},
  rejectIncoming: () => {},
  acceptAndHold: () => {},
  unholdCall: () => {},
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
  // H-08: derive a stable primitive so the WebRTC init effect only re-runs
  // when the logged-in identity changes, not on every profile heartbeat.
  const userId = user?.id;
  const clientRef = useRef(null);
  const audioRef  = useRef(null);

  // ── Refs that must always reflect the latest value without triggering re-renders
  // activeCallRef: the canonical, always-current SDK call object used for hangup/mute/dtmf.
  const activeCallRef       = useRef(null);
  // wasConnectedRef: did this call ever reach the 'active' SDK state?
  const wasConnectedRef     = useRef(false);
  // userHangupRef: did the user deliberately click Hang Up?
  const userHangupRef       = useRef(false);
  // answeredCallIdRef: guard against the SDK re-firing 'ringing' after answer()
  const answeredCallIdRef   = useRef(null);
  // micStreamRef: the MediaStream we open with getUserMedia before newCall().
  const micStreamRef        = useRef(null);
  const callTimeoutRef      = useRef(null);
  // H-11: ref for the currently held call + its activeCallInfo snapshot.
  // Stored as { call: SDKCall, info: activeCallInfo } to avoid stale closures.
  const heldCallRef         = useRef(null);
  // H-11: mirrors activeCallInfo state so callbacks can read the latest value
  // without taking activeCallInfo as a dep (which would cause stale closures).
  const activeCallInfoRef   = useRef(null);

  const [deviceReady,        setDeviceReady]        = useState(false);
  const [deviceError,        setDeviceError]        = useState(null);
  const [incomingCalls,      setIncomingCalls]      = useState([]);   // H-11: array
  const [activeCall,         setActiveCall]         = useState(null);
  const [activeCallInfo,     setActiveCallInfo]     = useState(null);
  // activeCallSdkState mirrors the raw SDK call state so the UI can show
  // "Calling…" → "Ringing…" → timer without polling the call object directly.
  const [activeCallSdkState, setActiveCallSdkState] = useState(null);
  const [heldCallInfo,       setHeldCallInfo]       = useState(null); // H-11: held call display info
  const [callNotification,   setCallNotification]   = useState(null);
  const [muted,              setMuted]              = useState(false);
  const [recording,          setRecording]          = useState(false);
  const [tokenVersion,       setTokenVersion]       = useState(0);
  const refreshTimerRef = useRef(null);

  // Keep activeCallInfoRef in sync so stale-closure-safe callbacks can read it
  useEffect(() => { activeCallInfoRef.current = activeCallInfo; }, [activeCallInfo]);

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
    if (!userId) return;
    let client;
    let cancelled = false;

    const scheduleRefresh = (token) => {
      clearTimeout(refreshTimerRef.current);
      // Safe fallback: refresh in 15 min if we cannot read the token's exp.
      const FALLBACK_MS = 15 * 60 * 1_000;
      let delay = FALLBACK_MS;
      try {
        // JWTs use base64url (- and _ instead of + and /, no padding).
        const b64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
        const padded = b64 + '='.repeat((4 - b64.length % 4) % 4);
        const { exp } = JSON.parse(atob(padded));
        if (exp) delay = Math.max(60_000, exp * 1_000 - Date.now() - 5 * 60 * 1_000);
      } catch (err) {
        console.warn('[Telnyx] Failed to decode token payload; will refresh in 15 min', err);
      }

      const attemptRefresh = () => {
        if (activeCallRef.current) {
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
              // Guard: SDK re-fires 'ringing' after answer() — ignore it.
              // H-11: push to queue rather than replace.
              if (!cancelled && answeredCallIdRef.current !== call.id) {
                setIncomingCalls(prev =>
                  prev.some(c => c.id === call.id) ? prev : [...prev, call]
                );
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
              setActiveCallInfo((prev) =>
                prev
                  ? { ...prev, startedAt: prev.startedAt || Date.now(), connected: true }
                  : prev
              );
            }
          }

          // ── Terminal ──────────────────────────────────────────────────────
          if (TERMINAL_STATES.has(state)) {
            // H-11: guard which call is terminating before touching refs.
            // In single-call mode activeCallRef.current was always the terminating
            // call, but in multi-call mode it may be the held call or an incoming
            // call that was never made active — we must not null out the wrong ref.
            releaseLocalMedia(call);
            const isActiveCall = activeCallRef.current?.id === call.id;
            const isHeldCall   = heldCallRef.current?.call?.id === call.id;
            if (isActiveCall) activeCallRef.current = null;

            if (!cancelled) {
              // Only read wasConn/wasUserHangup for the active call
              let wasConn = false;
              let wasUserHangup = false;
              if (isActiveCall) {
                wasConn       = wasConnectedRef.current;
                wasUserHangup = userHangupRef.current;
                wasConnectedRef.current = false;
                userHangupRef.current   = false;
              }

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

              // Only notify when the remote side ended the active call
              if (isActiveCall && !wasUserHangup) {
                if (wasConn) {
                  setCallNotification({ type: 'ended', message: 'Call ended' });
                } else if (call.direction === 'outbound') {
                  const cls = classifyTerminalCause(call);
                  setCallNotification({ type: cls.type, message: cls.message });
                }
              }

              // Remove from ringing queue regardless of which call terminated
              setIncomingCalls(prev => prev.filter(c => c.id !== call.id));

              if (isHeldCall) {
                // Held call terminated on its own (other party hung up while on hold)
                heldCallRef.current = null;
                setHeldCallInfo(null);
              }

              if (isActiveCall) {
                clearCallState();
                answeredCallIdRef.current = null;
                // Auto-restore held call when the active call ends
                const held = heldCallRef.current;
                if (held) {
                  try { held.call.unhold(); } catch (_) {}
                  heldCallRef.current   = null;
                  activeCallRef.current = held.call;
                  setActiveCall(held.call);
                  setActiveCallInfo(held.info);
                  setHeldCallInfo(null);
                }
              }
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
  }, [userId, tokenVersion, attachAudio, clearCallState, _forceCleanup, releaseLocalMedia]);

  // ── Public API ──────────────────────────────────────────────────────────────

  const makeCall = useCallback(async (toNumber) => {
    if (!clientRef.current || !deviceReady) {
      throw new Error('Phone not ready. Try again in a moment.');
    }
    if (activeCallRef.current) {
      throw new Error('A call is already in progress.');
    }

    // Open the mic ourselves and hold onto the stream so we can guarantee it
    // gets stopped on terminal state.
    try {
      micStreamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      const name = err?.name;
      if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
        throw new Error('Microphone access denied. Allow microphone access in your browser and try again.');
      }
      if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
        throw new Error('No microphone found. Connect a microphone and try again.');
      }
      if (name === 'NotReadableError' || name === 'TrackStartError') {
        throw new Error('Microphone is in use by another application. Close it and try again.');
      }
      throw new Error('Could not access microphone. Check browser permissions and try again.');
    }

    // C-06: wrap newCall() so a SDK/network failure does not leak the mic stream.
    let call;
    try {
      call = clientRef.current.newCall({
        destinationNumber: toNumber,
        callerNumber: user?.phone_number || '',
        remoteElement: audioRef.current || undefined,
      });
    } catch (err) {
      console.error('[Telnyx] newCall() failed — releasing mic and resetting state', err);
      releaseLocalMedia(null);
      micStreamRef.current = null;
      clearCallState();
      throw new Error('Failed to initiate call. Please try again.');
    }

    activeCallRef.current   = call;
    wasConnectedRef.current = false;
    userHangupRef.current   = false;

    callTimeoutRef.current = setTimeout(() => {
      if (activeCallRef.current && !wasConnectedRef.current) {
        _forceCleanup('Call timed out — no answer.');
      }
    }, 45_000);

    setActiveCall(call);
    setActiveCallSdkState(null);
    setActiveCallInfo({
      callId: call.id,
      number: toNumber,
      direction: 'outbound',
      startedAt: null,
      connected: false,
    });
    setMuted(false);
    return call;
  }, [deviceReady, user, releaseLocalMedia, clearCallState, _forceCleanup]);

  // H-11: acceptIncoming now takes the specific call to answer (not from state)
  const acceptIncoming = useCallback((call) => {
    if (!call) return;
    const from =
      call.options?.remoteCallerNumber ||
      call.options?.callerNumber       ||
      call.from                        ||
      call.options?.displayName        ||
      'Unknown';
    answeredCallIdRef.current = call.id;
    activeCallRef.current     = call;
    wasConnectedRef.current   = false;
    userHangupRef.current     = false;
    call.answer({ remoteElement: audioRef.current || undefined });
    setActiveCall(call);
    setActiveCallSdkState(null);
    setActiveCallInfo({
      callId: call.id,
      number: from,
      direction: 'inbound',
      startedAt: null,
      connected: false,
    });
    setIncomingCalls(prev => prev.filter(c => c.id !== call.id));
    setMuted(false);
  }, []); // all values from args or refs — no state deps

  // H-11: rejectIncoming now takes the specific call to reject
  const rejectIncoming = useCallback((call) => {
    if (!call) return;
    try { call.hangup(); } catch (e) { console.warn('[Telnyx] reject hangup failed', e); }
    releaseLocalMedia(call);
    setIncomingCalls(prev => prev.filter(c => c.id !== call.id));
  }, [releaseLocalMedia]);

  // H-11: hold the current active call and answer a new incoming call
  const acceptAndHold = useCallback((newCall) => {
    if (!newCall) return;
    const currentActive = activeCallRef.current;
    if (currentActive) {
      try { currentActive.hold(); } catch (e) { console.warn('[Telnyx] hold failed', e); }
      heldCallRef.current = { call: currentActive, info: activeCallInfoRef.current };
      setHeldCallInfo(activeCallInfoRef.current);
    }
    const from =
      newCall.options?.remoteCallerNumber ||
      newCall.options?.callerNumber       ||
      newCall.from                        ||
      newCall.options?.displayName        ||
      'Unknown';
    answeredCallIdRef.current = newCall.id;
    activeCallRef.current     = newCall;
    wasConnectedRef.current   = false;
    userHangupRef.current     = false;
    newCall.answer({ remoteElement: audioRef.current || undefined });
    setActiveCall(newCall);
    setActiveCallSdkState(null);
    setActiveCallInfo({
      callId: newCall.id,
      number: from,
      direction: 'inbound',
      startedAt: null,
      connected: false,
    });
    setIncomingCalls(prev => prev.filter(c => c.id !== newCall.id));
    setMuted(false);
  }, []); // all from refs/args — no state deps

  // H-11: swap held↔active. When there is an active call it is put on hold;
  // when there is no active call the held call is simply resumed.
  const unholdCall = useCallback(() => {
    const held = heldCallRef.current;
    if (!held) return;
    try { held.call.unhold(); } catch (e) { console.warn('[Telnyx] unhold failed', e); }
    const currentActive = activeCallRef.current;
    if (currentActive) {
      try { currentActive.hold(); } catch (e) { console.warn('[Telnyx] hold on swap failed', e); }
      heldCallRef.current = { call: currentActive, info: activeCallInfoRef.current };
      setHeldCallInfo(activeCallInfoRef.current);
    } else {
      heldCallRef.current = null;
      setHeldCallInfo(null);
    }
    activeCallRef.current   = held.call;
    wasConnectedRef.current = false;
    setActiveCall(held.call);
    setActiveCallInfo(held.info);
    setActiveCallSdkState(null);
    setMuted(false);
  }, []); // all from refs — no state deps

  const hangup = useCallback(() => {
    clearTimeout(callTimeoutRef.current);
    callTimeoutRef.current = null;
    userHangupRef.current = true;
    const callToHang      = activeCallRef.current;
    activeCallRef.current = null;
    wasConnectedRef.current = false;
    clearCallState();
    answeredCallIdRef.current = null;
    if (callToHang) {
      try { callToHang.hangup(); } catch (e) { console.warn('[Telnyx] hangup failed', e); }
    }
    releaseLocalMedia(callToHang);
    // H-11: auto-restore held call when user deliberately hangs up the active call
    const held = heldCallRef.current;
    if (held) {
      try { held.call.unhold(); } catch (_) {}
      heldCallRef.current   = null;
      activeCallRef.current = held.call;
      setActiveCall(held.call);
      setActiveCallInfo(held.info);
      setHeldCallInfo(null);
    }
  }, [clearCallState, releaseLocalMedia]);

  const toggleMute = useCallback(() => {
    const call = activeCallRef.current;
    if (!call) return;
    const next = !muted;
    if (next) call.muteAudio(); else call.unmuteAudio();
    setMuted(next);
  }, [muted]);

  const sendDigit = useCallback(
    (digit) => { if (activeCallRef.current) activeCallRef.current.dtmf(digit); },
    []
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
    incomingCalls,
    activeCall,
    activeCallInfo,
    activeCallSdkState,
    heldCallInfo,
    callNotification,
    muted,
    recording,
    makeCall,
    acceptIncoming,
    rejectIncoming,
    acceptAndHold,
    unholdCall,
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
