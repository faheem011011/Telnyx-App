import { useEffect, useRef } from 'react';
import { Phone, PhoneOff } from 'lucide-react';
import { useTelnyx } from '../context/TelnyxContext';
import { formatPhone } from '../utils/format';
import Avatar from './Avatar';
import { useFocusTrap } from '../hooks/useFocusTrap';

// Play a US-standard dual-tone ring (440 Hz + 480 Hz, 2 s on / 4 s off)
// using the Web Audio API — no audio file required.
//
// Browser limitations:
//   Some browsers (Safari < 14) require a user gesture before AudioContext
//   can play; in that case the modal will appear silently. The visual ring
//   still pulses to draw attention.
function useRingtone() {
  useEffect(() => {
    let active = true;
    let nextTimer = null;
    let ctx = null;

    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) {
        console.warn('[Ringtone] AudioContext unavailable; modal still active');
        return;
      }

      ctx = new AC();

      const ring = () => {
        if (!active) return;

        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.12, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1.9);
        gain.connect(ctx.destination);

        [440, 480].forEach((freq) => {
          const osc = ctx.createOscillator();
          osc.frequency.value = freq;
          osc.connect(gain);
          osc.start(ctx.currentTime);
          osc.stop(ctx.currentTime + 2);
        });

        // 2 s ring + 4 s silence = 6 s cycle
        nextTimer = setTimeout(ring, 6_000);
      };

      // ctx may be suspended until the first user gesture — resume it silently.
      // On Safari < 14 (no prior gesture) this rejects; degrade gracefully.
      ctx.resume()
        .then(ring)
        .catch((err) => console.warn('[Ringtone] AudioContext blocked:', err));
    } catch (err) {
      console.warn('Ringtone unavailable on this browser; modal still active', err);
    }

    return () => {
      active = false;
      clearTimeout(nextTimer);
      if (ctx) {
        try { ctx.close(); } catch (e) { console.warn('[Ringtone] ctx.close failed', e); }
      }
    };
  }, []); // runs on mount; the inner content component is only mounted while incomingCall is set, so the ring loop starts on call arrival and is torn down on unmount.
}

function IncomingCallContent({ incomingCall, onAccept, onReject }) {
  useRingtone();

  const containerRef = useRef(null);
  useFocusTrap(containerRef);

  // For inbound calls the Telnyx WebRTC SDK exposes the caller's E.164 on
  // `incomingCall.from`. Never fall back to `destinationNumber` — that is
  // the receiver's own DID, not the caller.
  const from =
    incomingCall.options?.remoteCallerNumber ||
    incomingCall.options?.callerNumber       ||
    incomingCall.from                        ||
    incomingCall.options?.displayName        ||
    'Unknown caller';

  const titleId = 'incoming-call-title';

  return (
    <div
      ref={containerRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-live="assertive"
      className="fixed top-4 right-4 z-50 animate-slide-down"
      style={{ width: 308 }}
    >
      <span id={titleId} className="sr-only">Incoming call from {formatPhone(from)}</span>
      <div
        style={{
          borderRadius: 20,
          background: 'rgba(255,255,255,0.92)',
          backdropFilter: 'blur(48px)',
          WebkitBackdropFilter: 'blur(48px)',
          border: '1px solid rgba(255,255,255,0.8)',
          boxShadow: [
            '0 24px 64px rgba(0,0,0,0.16)',
            '0 6px 20px rgba(37,99,235,0.14)',
            'inset 0 1px 0 rgba(255,255,255,0.95)',
          ].join(', '),
          overflow: 'hidden',
        }}
      >
        {/* Blue header with pulse */}
        <div
          style={{
            background: 'linear-gradient(135deg, #1d4ed8 0%, #3b82f6 100%)',
            padding: '10px 14px',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}
        >
          {/* Pulsing phone icon */}
          <div style={{ position: 'relative', flexShrink: 0 }}>
            <span
              className="animate-pulse-ring"
              style={{
                position: 'absolute', inset: -5, borderRadius: '50%',
                background: 'rgba(255,255,255,0.28)',
              }}
            />
            <span
              className="animate-pulse-ring"
              style={{
                position: 'absolute', inset: -5, borderRadius: '50%',
                background: 'rgba(255,255,255,0.18)',
                animationDelay: '0.6s',
              }}
            />
            <div
              style={{
                width: 30, height: 30, borderRadius: '50%',
                background: 'rgba(255,255,255,0.22)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                position: 'relative', zIndex: 1,
              }}
            >
              <Phone size={14} color="white" fill="white" />
            </div>
          </div>

          <div>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.72)', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              Incoming Call
            </div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)', marginTop: 1 }}>
              Ringing…
            </div>
          </div>
        </div>

        {/* Caller info */}
        <div style={{ padding: '13px 15px 12px', display: 'flex', alignItems: 'center', gap: 12 }}>
          <Avatar name={from} seed={from} size="md" />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              className="font-display"
              style={{ fontWeight: 700, fontSize: 15, color: '#1e3a8a', marginBottom: 2, letterSpacing: '0.01em' }}
            >
              {formatPhone(from)}
            </div>
            <div style={{ fontSize: 11.5, color: '#64748b' }}>
              calling you
            </div>
          </div>
        </div>

        {/* Accept / Decline buttons */}
        <div
          style={{
            display: 'flex',
            borderTop: '1px solid rgba(226,232,240,0.55)',
          }}
        >
          {/* Decline */}
          <button
            onClick={onReject}
            style={{
              flex: 1, padding: '11px 0',
              border: 'none',
              borderRight: '1px solid rgba(226,232,240,0.55)',
              background: 'transparent',
              cursor: 'pointer',
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5,
              transition: 'background 0.15s',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(239,68,68,0.055)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          >
            <div
              style={{
                width: 38, height: 38, borderRadius: '50%',
                background: 'rgba(239,68,68,0.09)',
                border: '1.5px solid rgba(239,68,68,0.22)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                transition: 'all 0.15s',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(239,68,68,0.18)';
                e.currentTarget.style.border = '1.5px solid rgba(239,68,68,0.4)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'rgba(239,68,68,0.09)';
                e.currentTarget.style.border = '1.5px solid rgba(239,68,68,0.22)';
              }}
            >
              <PhoneOff size={16} color="#ef4444" />
            </div>
            <span style={{ fontSize: 11, fontWeight: 700, color: '#ef4444', letterSpacing: '0.01em' }}>Decline</span>
          </button>

          {/* Accept */}
          <button
            onClick={onAccept}
            style={{
              flex: 1, padding: '11px 0',
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5,
              transition: 'background 0.15s',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(34,197,94,0.055)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          >
            <div
              style={{
                width: 38, height: 38, borderRadius: '50%',
                background: 'rgba(34,197,94,0.09)',
                border: '1.5px solid rgba(34,197,94,0.22)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                transition: 'all 0.15s',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(34,197,94,0.18)';
                e.currentTarget.style.border = '1.5px solid rgba(34,197,94,0.4)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'rgba(34,197,94,0.09)';
                e.currentTarget.style.border = '1.5px solid rgba(34,197,94,0.22)';
              }}
            >
              <Phone size={16} color="#16a34a" fill="#16a34a" />
            </div>
            <span style={{ fontSize: 11, fontWeight: 700, color: '#16a34a', letterSpacing: '0.01em' }}>Accept</span>
          </button>
        </div>
      </div>
    </div>
  );
}

export default function IncomingCallModal() {
  const { incomingCall, acceptIncoming, rejectIncoming } = useTelnyx();
  if (!incomingCall) return null;
  return (
    <IncomingCallContent
      incomingCall={incomingCall}
      onAccept={acceptIncoming}
      onReject={rejectIncoming}
    />
  );
}
