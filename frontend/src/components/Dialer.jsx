import { useState, useEffect } from 'react';
import { X, Phone, ChevronLeft } from 'lucide-react';
import { useTwilio } from '../context/TwilioContext';
import { toE164, formatPhone } from '../utils/format';

const KEYS = [
  { digit: '1', sub: '' },
  { digit: '2', sub: 'ABC' },
  { digit: '3', sub: 'DEF' },
  { digit: '4', sub: 'GHI' },
  { digit: '5', sub: 'JKL' },
  { digit: '6', sub: 'MNO' },
  { digit: '7', sub: 'PQRS' },
  { digit: '8', sub: 'TUV' },
  { digit: '9', sub: 'WXYZ' },
  { digit: '*', sub: '' },
  { digit: '0', sub: '+' },
  { digit: '#', sub: '' },
];

export default function Dialer({ onClose, defaultNumber = '' }) {
  const [number, setNumber]   = useState(defaultNumber);
  const [error, setError]     = useState(null);
  const [calling, setCalling] = useState(false);
  const [flash, setFlash]     = useState(null);
  const { makeCall, deviceReady } = useTwilio();

  useEffect(() => {
    const handler = (e) => {
      if (e.target.tagName === 'INPUT') return;
      if (/[0-9*#+]/.test(e.key)) {
        setNumber((n) => n + e.key);
        triggerFlash(e.key);
      } else if (e.key === 'Backspace') {
        setNumber((n) => n.slice(0, -1));
      } else if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const triggerFlash = (k) => {
    setFlash(k);
    setTimeout(() => setFlash(null), 110);
  };

  const pressKey = (k) => {
    setNumber((n) => n + k);
    setError(null);
    triggerFlash(k);
  };

  const handleCall = async () => {
    if (calling || !number || !deviceReady) return;
    setError(null);
    setCalling(true);
    try {
      await makeCall(toE164(number));
      onClose();
    } catch (e) {
      setError(e.message || 'Call failed. Check the number and try again.');
      setCalling(false);
    }
  };

  const canCall = !!number && deviceReady && !calling;

  return (
    <div
      className="fixed bottom-6 right-6 z-50 animate-slide-up"
      style={{ width: 304 }}
    >
      <div
        style={{
          borderRadius: 22,
          background: 'rgba(255,255,255,0.88)',
          backdropFilter: 'blur(48px)',
          WebkitBackdropFilter: 'blur(48px)',
          border: '1px solid rgba(255,255,255,0.75)',
          boxShadow: [
            '0 32px 72px rgba(0,0,0,0.18)',
            '0 8px 24px rgba(37,99,235,0.12)',
            'inset 0 1px 0 rgba(255,255,255,0.95)',
          ].join(', '),
          overflow: 'hidden',
        }}
      >
        {/* ── Blue header ───────────────────────── */}
        <div
          style={{
            background: 'linear-gradient(135deg, #1d4ed8 0%, #3b82f6 100%)',
            padding: '12px 14px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span
              style={{
                width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
                background:  deviceReady ? '#4ade80' : '#fbbf24',
                boxShadow:   deviceReady
                  ? '0 0 7px rgba(74,222,128,1)'
                  : '0 0 7px rgba(251,191,36,1)',
              }}
            />
            <span style={{ fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.85)', letterSpacing: '0.03em' }}>
              {deviceReady ? 'Ready to dial' : 'Connecting…'}
            </span>
          </div>
          <button
            onClick={onClose}
            style={{
              width: 26, height: 26, borderRadius: '50%',
              background: 'rgba(255,255,255,0.18)',
              border: 'none', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'white', transition: 'background 0.15s',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.32)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.18)')}
          >
            <X size={13} />
          </button>
        </div>

        <div style={{ padding: '11px 12px 13px' }}>
          {/* ── Number display ───────────────────── */}
          <div
            style={{
              background: 'rgba(239,246,255,0.7)',
              border: '1.5px solid rgba(147,197,253,0.4)',
              borderRadius: 13,
              padding: '9px 12px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              minHeight: 50,
              marginBottom: 9,
            }}
          >
            <input
              className="font-display"
              type="text"
              value={number}
              placeholder="Enter number to dial"
              onChange={(e) => {
                const filtered = e.target.value.replace(/[^0-9+*#]/g, '');
                setNumber(filtered);
                setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') onClose();
              }}
              style={{
                flex: 1,
                minWidth: 0,
                width: '100%',
                background: 'transparent',
                border: 'none',
                outline: 'none',
                fontWeight: 700,
                fontSize: number.length > 12 ? 17 : 21,
                letterSpacing: '0.1em',
                color: '#1e3a8a',
                textAlign: 'center',
                transition: 'font-size 0.1s',
                caretColor: '#3b82f6',
              }}
            />
            {number && (
              <button
                onClick={() => setNumber((n) => n.slice(0, -1))}
                style={{
                  marginLeft: 8, flexShrink: 0,
                  width: 30, height: 30, borderRadius: 8,
                  background: 'rgba(59,130,246,0.08)',
                  border: '1px solid rgba(59,130,246,0.18)',
                  cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: '#3b82f6', transition: 'all 0.15s',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(59,130,246,0.18)';
                  e.currentTarget.style.color = '#1d4ed8';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'rgba(59,130,246,0.08)';
                  e.currentTarget.style.color = '#3b82f6';
                }}
              >
                <ChevronLeft size={14} />
              </button>
            )}
          </div>

          {/* ── Keypad ───────────────────────────── */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 7, marginBottom: 9 }}>
            {KEYS.map(({ digit, sub }) => {
              const isFlashing = flash === digit;
              return (
                <button
                  key={digit}
                  onClick={() => pressKey(digit)}
                  style={{
                    height: 50,
                    borderRadius: 11,
                    background: isFlashing ? '#dbeafe' : 'white',
                    border: isFlashing
                      ? '1.5px solid #3b82f6'
                      : '1.5px solid rgba(226,232,240,0.9)',
                    cursor: 'pointer',
                    display: 'flex', flexDirection: 'column',
                    alignItems: 'center', justifyContent: 'center',
                    transform: isFlashing ? 'scale(0.91)' : 'scale(1)',
                    transition: 'all 0.09s',
                    boxShadow: isFlashing
                      ? '0 0 0 3px rgba(59,130,246,0.18), 0 2px 6px rgba(59,130,246,0.12)'
                      : '0 1px 3px rgba(0,0,0,0.06)',
                    color: isFlashing ? '#2563eb' : '#1e40af',
                  }}
                  onMouseEnter={(e) => {
                    if (!isFlashing) {
                      e.currentTarget.style.background = '#eff6ff';
                      e.currentTarget.style.border = '1.5px solid #93c5fd';
                      e.currentTarget.style.boxShadow = '0 4px 14px rgba(59,130,246,0.18)';
                      e.currentTarget.style.color = '#2563eb';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isFlashing) {
                      e.currentTarget.style.background = 'white';
                      e.currentTarget.style.border = '1.5px solid rgba(226,232,240,0.9)';
                      e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.06)';
                      e.currentTarget.style.color = '#1e40af';
                    }
                  }}
                >
                  <span className="font-display" style={{ fontSize: 19, fontWeight: 600, lineHeight: 1 }}>
                    {digit}
                  </span>
                  {sub && (
                    <span style={{ fontSize: 7.5, letterSpacing: '0.12em', marginTop: 2.5, color: '#93c5fd', fontWeight: 600 }}>
                      {sub}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* ── Error ────────────────────────────── */}
          {error && (
            <div
              style={{
                marginBottom: 9,
                padding: '7px 11px',
                borderRadius: 9,
                background: 'rgba(239,68,68,0.07)',
                border: '1px solid rgba(239,68,68,0.2)',
                color: '#ef4444',
                fontSize: 11.5,
                textAlign: 'center',
                lineHeight: 1.4,
              }}
            >
              {error}
            </div>
          )}

          {/* ── Call button ──────────────────────── */}
          <button
            onClick={handleCall}
            disabled={!canCall}
            style={{
              width: '100%',
              height: 50,
              borderRadius: 13,
              background: canCall
                ? 'linear-gradient(135deg, #1d4ed8 0%, #3b82f6 100%)'
                : 'rgba(226,232,240,0.55)',
              border: 'none',
              cursor: canCall ? 'pointer' : 'not-allowed',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              color: canCall ? 'white' : '#94a3b8',
              fontWeight: 700, fontSize: 14, letterSpacing: '0.01em',
              boxShadow: canCall
                ? '0 4px 18px rgba(37,99,235,0.42), inset 0 1px 0 rgba(255,255,255,0.22)'
                : 'none',
              transition: 'all 0.18s',
              transform: calling ? 'scale(0.97)' : 'scale(1)',
            }}
            onMouseEnter={(e) => {
              if (canCall) {
                e.currentTarget.style.background = 'linear-gradient(135deg, #1e40af 0%, #2563eb 100%)';
                e.currentTarget.style.boxShadow = '0 6px 24px rgba(37,99,235,0.52), inset 0 1px 0 rgba(255,255,255,0.22)';
                e.currentTarget.style.transform = 'translateY(-1px)';
              }
            }}
            onMouseLeave={(e) => {
              if (canCall) {
                e.currentTarget.style.background = 'linear-gradient(135deg, #1d4ed8 0%, #3b82f6 100%)';
                e.currentTarget.style.boxShadow = '0 4px 18px rgba(37,99,235,0.42), inset 0 1px 0 rgba(255,255,255,0.22)';
                e.currentTarget.style.transform = 'scale(1)';
              }
            }}
          >
            <Phone size={17} fill={canCall ? 'white' : '#94a3b8'} color={canCall ? 'white' : '#94a3b8'} />
            {calling ? 'Calling…' : 'Call'}
          </button>
        </div>
      </div>
    </div>
  );
}
