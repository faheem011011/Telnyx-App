import { Phone, PhoneOff } from 'lucide-react';
import { useTwilio } from '../context/TwilioContext';
import { formatPhone } from '../utils/format';
import Avatar from './Avatar';

export default function IncomingCallModal() {
  const { incomingCall, acceptIncoming, rejectIncoming } = useTwilio();

  if (!incomingCall) return null;

  const from = incomingCall.parameters?.From || 'Unknown caller';

  return (
    <div
      className="fixed top-4 right-4 z-50 animate-slide-down"
      style={{ width: 308 }}
    >
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
              calling your Twilio number
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
            onClick={rejectIncoming}
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
            onClick={acceptIncoming}
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
