import { useEffect, useRef, useState } from 'react';
import { PhoneOff, Mic, MicOff, Grid3x3, Circle, Square } from 'lucide-react';
import { useTelnyx } from '../context/TelnyxContext';
import { formatPhone, formatDuration } from '../utils/format';
import Avatar from './Avatar';
import { useFocusTrap } from '../hooks/useFocusTrap';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'];

function ControlBtn({ onClick, active, activeColor = '#2563eb', children, title, danger }) {
  const base = {
    width: 46, height: 46, borderRadius: '50%',
    border: 'none', cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    transition: 'all 0.15s',
    boxShadow: '0 2px 8px rgba(0,0,0,0.07)',
  };
  const idle = {
    background: 'white',
    border: '1.5px solid rgba(226,232,240,0.9)',
    color: '#64748b',
  };
  const activeStyle = {
    background: active ? `rgba(${activeColor === '#ef4444' ? '239,68,68' : '37,99,235'},0.1)` : 'white',
    border: active
      ? `1.5px solid rgba(${activeColor === '#ef4444' ? '239,68,68' : '37,99,235'},0.28)`
      : '1.5px solid rgba(226,232,240,0.9)',
    color: active ? activeColor : '#64748b',
  };

  return (
    <button
      onClick={onClick}
      title={title}
      style={{ ...base, ...activeStyle }}
      onMouseEnter={(e) => {
        if (!active) {
          e.currentTarget.style.background = '#eff6ff';
          e.currentTarget.style.border = '1.5px solid #93c5fd';
          e.currentTarget.style.color = '#2563eb';
        } else {
          e.currentTarget.style.opacity = '0.8';
        }
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.opacity = '1';
        if (!active) {
          e.currentTarget.style.background = 'white';
          e.currentTarget.style.border = '1.5px solid rgba(226,232,240,0.9)';
          e.currentTarget.style.color = '#64748b';
        }
      }}
    >
      {children}
    </button>
  );
}

export default function ActiveCallPanel() {
  const { activeCall, activeCallInfo, activeCallSdkState, muted, toggleMute, hangup, sendDigit, recording, toggleRecording } = useTelnyx();
  const [elapsed, setElapsed]       = useState(0);
  const [showKeypad, setShowKeypad] = useState(false);
  const containerRef = useRef(null);
  useFocusTrap(containerRef);

  useEffect(() => {
    if (!activeCallInfo?.connected) { setElapsed(0); return; }
    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - activeCallInfo.startedAt) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [activeCallInfo]);

  if (!activeCall || !activeCallInfo) return null;

  const { number, direction, connected } = activeCallInfo;
  const statusLabel = connected
    ? formatDuration(elapsed)
    : activeCallSdkState === 'ringing' && direction === 'outbound'
      ? 'Ringing…'
      : direction === 'outbound'
        ? 'Calling…'
        : 'Connecting…';

  return (
    <div
      ref={containerRef}
      role="dialog"
      aria-modal="true"
      aria-label={`Active call with ${formatPhone(number)}`}
      className="fixed bottom-6 right-6 z-40 animate-slide-up"
      style={{ width: 296 }}
    >
      <div
        style={{
          borderRadius: 20,
          background: 'rgba(255,255,255,0.9)',
          backdropFilter: 'blur(48px)',
          WebkitBackdropFilter: 'blur(48px)',
          border: '1px solid rgba(255,255,255,0.78)',
          boxShadow: [
            '0 24px 64px rgba(0,0,0,0.16)',
            '0 6px 20px rgba(37,99,235,0.12)',
            'inset 0 1px 0 rgba(255,255,255,0.95)',
          ].join(', '),
          overflow: 'hidden',
        }}
      >
        {/* Blue header */}
        <div
          style={{
            background: 'linear-gradient(135deg, #1d4ed8 0%, #3b82f6 100%)',
            padding: '12px 14px',
            display: 'flex',
            alignItems: 'center',
            gap: 11,
          }}
        >
          <Avatar name={number} seed={number} size="sm" />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              className="font-display"
              style={{ fontWeight: 700, fontSize: 14, color: 'white', letterSpacing: '0.01em' }}
            >
              {formatPhone(number)}
            </div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.72)', marginTop: 1 }}>
              {direction === 'inbound' ? 'Inbound' : 'On call'} · {statusLabel}
            </div>
          </div>
          {/* Live indicator */}
          <span
            style={{
              width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
              background: connected ? '#4ade80' : '#fbbf24',
              boxShadow: connected ? '0 0 7px rgba(74,222,128,1)' : '0 0 7px rgba(251,191,36,1)',
            }}
          />
        </div>

        {/* Controls */}
        <div style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-around' }}>
          {/* Mute */}
          <ControlBtn
            onClick={toggleMute}
            active={muted}
            activeColor="#ef4444"
            title={muted ? 'Unmute' : 'Mute'}
          >
            {muted ? <MicOff size={19} /> : <Mic size={19} />}
          </ControlBtn>

          {/* Hang up */}
          <button
            onClick={hangup}
            title="Hang up"
            style={{
              width: 54, height: 54, borderRadius: '50%',
              background: 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)',
              border: 'none', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'white',
              boxShadow: '0 4px 18px rgba(239,68,68,0.45)',
              transition: 'all 0.15s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'linear-gradient(135deg, #dc2626 0%, #b91c1c 100%)';
              e.currentTarget.style.boxShadow = '0 6px 22px rgba(239,68,68,0.58)';
              e.currentTarget.style.transform = 'translateY(-1px)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)';
              e.currentTarget.style.boxShadow = '0 4px 18px rgba(239,68,68,0.45)';
              e.currentTarget.style.transform = 'scale(1)';
            }}
          >
            <PhoneOff size={21} />
          </button>

          {/* Record toggle */}
          <ControlBtn
            onClick={toggleRecording}
            active={recording}
            activeColor="#ef4444"
            title={recording ? 'Stop recording' : 'Record call'}
          >
            {recording
              ? <Square size={15} fill="#ef4444" />
              : <Circle size={19} />}
          </ControlBtn>

          {/* Keypad toggle */}
          <ControlBtn
            onClick={() => setShowKeypad((s) => !s)}
            active={showKeypad}
            title="Keypad"
          >
            <Grid3x3 size={19} />
          </ControlBtn>
        </div>

        {/* DTMF keypad */}
        {showKeypad && (
          <div
            style={{
              padding: '8px 12px 12px',
              borderTop: '1px solid rgba(226,232,240,0.5)',
              background: 'rgba(239,246,255,0.45)',
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: 6,
            }}
          >
            {KEYS.map((k) => (
              <button
                key={k}
                onClick={() => sendDigit(k)}
                style={{
                  padding: '9px 0',
                  borderRadius: 9,
                  background: 'white',
                  border: '1.5px solid rgba(226,232,240,0.9)',
                  cursor: 'pointer',
                  fontWeight: 600, fontSize: 15,
                  color: '#1e40af',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
                  transition: 'all 0.1s',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = '#eff6ff';
                  e.currentTarget.style.border = '1.5px solid #93c5fd';
                  e.currentTarget.style.color = '#2563eb';
                  e.currentTarget.style.boxShadow = '0 3px 10px rgba(59,130,246,0.16)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'white';
                  e.currentTarget.style.border = '1.5px solid rgba(226,232,240,0.9)';
                  e.currentTarget.style.color = '#1e40af';
                  e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.05)';
                }}
              >
                {k}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
