import { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { Device } from '@twilio/voice-sdk';
import { callsApi } from '../services/api';
import { useAuth } from './AuthContext';

const TwilioContext = createContext(null);

const TWILIO_DEFAULTS = {
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

/**
 * Twilio Voice SDK provider.
 *
 * Manages the Device (browser softphone registration), active Call state,
 * and incoming call notifications.
 */
export function TwilioProvider({ children }) {
  const { user } = useAuth();
  const deviceRef = useRef(null);
  const [deviceReady, setDeviceReady] = useState(false);
  const [deviceError, setDeviceError] = useState(null);
  const [incomingCall, setIncomingCall] = useState(null); // Twilio Call object
  const [activeCall, setActiveCall] = useState(null);
  const [activeCallInfo, setActiveCallInfo] = useState(null); // { number, direction, startedAt }
  const [muted, setMuted] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordingSid, setRecordingSid] = useState(null);

  // Register device when user logs in
  useEffect(() => {
    if (!user) return;

    let device;
    let cancelled = false;

    const setup = async () => {
      try {
        const { token } = await callsApi.getToken();
        if (cancelled) return;

        device = new Device(token, {
          codecPreferences: ['opus', 'pcmu'],
          logLevel: 1,
          edge: ['ashburn', 'dublin', 'singapore', 'sydney', 'roaming'],
          enableImprovedSignalingErrorPrecision: true,
        });

        device.on('registered', () => {
          if (!cancelled) setDeviceReady(true);
        });

        device.on('error', (err) => {
          const orig = err.originalError;
          const detail = orig
            ? `[${orig.code}] ${orig.message}`
            : null;
          console.error('[Twilio] Device error', err, orig);
          if (!cancelled) setDeviceError(detail || err.message || String(err));
        });

        device.on('incoming', (call) => {
          setIncomingCall(call);
          call.on('cancel', () => setIncomingCall(null));
          call.on('reject', () => setIncomingCall(null));
          call.on('disconnect', () => setIncomingCall(null));
        });

        device.on('tokenWillExpire', async () => {
          try {
            const { token: newToken } = await callsApi.getToken();
            device.updateToken(newToken);
          } catch (e) {
            console.error('[Twilio] Failed to refresh token', e);
          }
        });

        await device.register();
        deviceRef.current = device;
      } catch (err) {
        console.error('[Twilio] Setup failed', err);
        if (!cancelled) {
          setDeviceError(
            err.response?.data?.detail ||
              err.message ||
              'Failed to connect to Twilio. Check credentials in backend .env.'
          );
        }
      }
    };

    setup();

    return () => {
      cancelled = true;
      if (device) {
        try {
          device.destroy();
        } catch (e) {
          /* ignore */
        }
      }
      deviceRef.current = null;
      setDeviceReady(false);
    };
  }, [user]);

  const attachCallHandlers = useCallback((call, info) => {
    setActiveCall(call);
    // For inbound calls accepted immediately; for outbound, startedAt resets on 'accept'
    setActiveCallInfo({ ...info, startedAt: Date.now(), connected: false });
    setMuted(false);

    call.on('accept', () => {
      setActiveCallInfo((prev) => (prev ? { ...prev, startedAt: Date.now(), connected: true } : prev));
    });

    call.on('disconnect', () => {
      setActiveCall(null);
      setActiveCallInfo(null);
      setMuted(false);
      setRecording(false);
      setRecordingSid(null);
    });

    call.on('cancel', () => {
      setActiveCall(null);
      setActiveCallInfo(null);
    });

    call.on('reject', () => {
      setActiveCall(null);
      setActiveCallInfo(null);
    });

    call.on('error', (err) => {
      console.error('[Twilio] Call error', err);
      setActiveCall(null);
      setActiveCallInfo(null);
    });
  }, []);

  const makeCall = useCallback(
    async (toNumber) => {
      if (!deviceRef.current || !deviceReady) {
        throw new Error('Phone not ready. Try again in a moment.');
      }
      const call = await deviceRef.current.connect({ params: { To: toNumber } });
      attachCallHandlers(call, { number: toNumber, direction: 'outbound' });
      return call;
    },
    [deviceReady, attachCallHandlers]
  );

  const acceptIncoming = useCallback(() => {
    if (!incomingCall) return;
    const from = incomingCall.parameters?.From || 'Unknown';
    attachCallHandlers(incomingCall, { number: from, direction: 'inbound' });
    incomingCall.accept();
    setIncomingCall(null);
  }, [incomingCall, attachCallHandlers]);

  const rejectIncoming = useCallback(() => {
    if (!incomingCall) return;
    incomingCall.reject();
    setIncomingCall(null);
  }, [incomingCall]);

  const hangup = useCallback(() => {
    if (activeCall) {
      activeCall.disconnect();
    }
  }, [activeCall]);

  const toggleMute = useCallback(() => {
    if (!activeCall) return;
    const next = !muted;
    activeCall.mute(next);
    setMuted(next);
  }, [activeCall, muted]);

  const sendDigit = useCallback(
    (digit) => {
      if (activeCall) activeCall.sendDigits(digit);
    },
    [activeCall]
  );

  const toggleRecording = useCallback(async () => {
    if (!activeCall) return;
    const callSid = activeCall.parameters?.CallSid;
    if (!callSid) return;
    try {
      if (!recording) {
        const { recording_sid } = await callsApi.startRecording(callSid);
        setRecording(true);
        setRecordingSid(recording_sid);
      } else {
        if (!recordingSid) return;
        await callsApi.stopRecording(callSid, recordingSid);
        setRecording(false);
        setRecordingSid(null);
      }
    } catch (e) {
      console.error('[Twilio] Recording error', e);
    }
  }, [activeCall, recording, recordingSid]);

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

  return <TwilioContext.Provider value={value}>{children}</TwilioContext.Provider>;
}

export const useTwilio = () => {
  const ctx = useContext(TwilioContext);
  if (!ctx) return TWILIO_DEFAULTS;
  return ctx;
};
