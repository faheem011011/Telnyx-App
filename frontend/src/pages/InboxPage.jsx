import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Phone,
  PhoneIncoming,
  PhoneOutgoing,
  PhoneMissed,
  Voicemail,
  Star,
  Search,
  CheckCheck,
  MessageCircle,
  X,
} from 'lucide-react';
import { callsApi } from '../services/api';
import { useTelnyx as useTwilio } from '../context/TelnyxContext';
import { formatPhone, formatCallDate, formatDuration, toE164 } from '../utils/format';
import Avatar from '../components/Avatar';

const TABS = [
  { key: 'unread', label: 'Unread' },
  { key: 'all', label: 'All' },
  { key: 'missed', label: 'Missed' },
  { key: 'voicemails', label: 'Voicemails' },
  { key: 'recordings', label: 'Recordings' },
  { key: 'starred', label: 'Starred' },
];

export default function InboxPage() {
  const [tab, setTab] = useState('unread');
  const [calls, setCalls] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [selected, setSelected] = useState(null);
  const { makeCall } = useTwilio();
  const navigate = useNavigate();

  const handleSelect = useCallback(async (call) => {
    setSelected(call);
    if (!call.is_read) {
      try {
        await callsApi.update(call.id, { is_read: true });
        setCalls((prev) => prev.map((c) => c.id === call.id ? { ...c, is_read: true } : c));
        // Tell Sidebar to refresh its unread badge immediately
        window.dispatchEvent(new CustomEvent('calls:read'));
      } catch {
        // Non-critical
      }
    }
  }, []);

  // Debounce search input
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(() => {
    setLoading(true);
    callsApi
      .list(tab, debouncedSearch)
      .then((data) => setCalls(data))
      .catch(() => setCalls([]))
      .finally(() => setLoading(false));
  }, [tab, debouncedSearch]);

  useEffect(() => {
    load();
  }, [load]);

  const handleCallBack = async (call) => {
    const number = call.direction === 'inbound' ? call.from_number : call.to_number;
    try {
      await makeCall(toE164(number));
    } catch (e) {
      alert(e.message || 'Could not place call');
    }
  };

  const handleMessage = (call) => {
    const number = call.direction === 'inbound' ? call.from_number : call.to_number;
    navigate(`/messages/${encodeURIComponent(number)}`);
  };

  const handleMarkAllRead = async () => {
    try {
      await callsApi.markAllRead();
      window.dispatchEvent(new CustomEvent('calls:read'));
      load();
    } catch {
      alert('Failed to mark all as read. Please try again.');
    }
  };

  const toggleStar = async (call) => {
    try {
      await callsApi.update(call.id, { is_starred: !call.is_starred });
      load();
    } catch {
      alert('Failed to update. Please try again.');
    }
  };

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* Main list column */}
      <div className="flex-1 flex flex-col overflow-hidden surface">
        {/* Header with tabs */}
        <div
          className="border-b flex-shrink-0"
          style={{ borderColor: 'rgb(var(--border-primary))' }}
        >
          <div className="px-6 pt-4 pb-0 flex items-center justify-between">
            <h1 className="text-xl font-display font-bold">Inbox</h1>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-faint" />
                <input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search by phone number or contact…"
                  className="input pl-9 w-64 py-2"
                />
              </div>
              <button
                onClick={handleMarkAllRead}
                className="btn-ghost py-2"
                title="Mark all as read"
              >
                <CheckCheck className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="px-4 flex overflow-x-auto">
            {TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`tab-item ${tab === t.key ? 'active' : ''}`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Call list */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <SkeletonList />
          ) : calls.length === 0 ? (
            <EmptyState tab={tab} />
          ) : (
            <div>
              {calls.map((call) => (
                <CallRow
                  key={call.id}
                  call={call}
                  selected={selected?.id === call.id}
                  onSelect={() => handleSelect(call)}
                  onCallBack={() => handleCallBack(call)}
                  onToggleStar={() => toggleStar(call)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Detail panel */}
      {selected && (
        <CallDetailPanel
          call={selected}
          onClose={() => setSelected(null)}
          onCallBack={() => handleCallBack(selected)}
          onMessage={() => handleMessage(selected)}
          onUpdated={load}
        />
      )}
    </div>
  );
}

/* ============================================================ */
/* Single call row                                              */
/* ============================================================ */
function CallRow({ call, selected, onSelect, onCallBack, onToggleStar }) {
  const otherNumber = call.direction === 'inbound' ? call.from_number : call.to_number;
  const displayName = call.contact?.name || formatPhone(otherNumber);
  const isMissed = ['missed', 'no-answer', 'busy', 'failed'].includes(call.status);
  const hasVoicemail = !!call.voicemail_url;

  const getIcon = () => {
    if (hasVoicemail) return <Voicemail className="w-4 h-4" />;
    if (isMissed) return <PhoneMissed className="w-4 h-4 text-red-500" />;
    if (call.direction === 'inbound') return <PhoneIncoming className="w-4 h-4" />;
    return <PhoneOutgoing className="w-4 h-4" />;
  };

  const subtitle = hasVoicemail
    ? 'Voicemail'
    : isMissed
    ? 'Missed call'
    : call.direction === 'inbound'
    ? 'Incoming call'
    : 'Outgoing call';

  return (
    <div
      onClick={onSelect}
      className={`group flex items-center gap-4 px-6 py-3 cursor-pointer border-b transition-colors ${
        selected ? 'bg-brand-50' : 'hover:surface-tertiary'
      } ${!call.is_read ? 'font-medium' : ''}`}
      style={{ borderColor: 'rgb(var(--border-primary))' }}
    >
      <Avatar name={displayName} seed={otherNumber} />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <div className="truncate text-sm">{displayName}</div>
          {call.is_starred && <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />}
        </div>
        <div className={`flex items-center gap-1.5 text-xs mt-0.5 ${isMissed ? 'text-red-500' : 'text-muted'}`}>
          {getIcon()}
          <span className="truncate">{subtitle}</span>
          {call.duration_seconds > 0 && (
            <span className="text-faint">· {formatDuration(call.duration_seconds)}</span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 flex-shrink-0">
        <div className="text-xs text-faint">{formatCallDate(call.started_at)}</div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onCallBack();
          }}
          className="opacity-0 group-hover:opacity-100 transition-opacity w-8 h-8 rounded-full flex items-center justify-center hover:bg-green-500 hover:text-white surface-tertiary"
          title="Call back"
        >
          <Phone className="w-4 h-4" />
        </button>
        {!call.is_read && <span className="w-2 h-2 rounded-full bg-brand-600 flex-shrink-0" />}
      </div>
    </div>
  );
}

/* ============================================================ */
/* Right-side detail panel                                      */
/* ============================================================ */
function CallDetailPanel({ call, onClose, onCallBack, onMessage, onUpdated }) {
  const otherNumber = call.direction === 'inbound' ? call.from_number : call.to_number;
  const displayName = call.contact?.name || formatPhone(otherNumber);

  return (
    <div
      className="w-80 flex-shrink-0 border-l flex flex-col overflow-hidden"
      style={{
        borderColor: 'rgb(var(--border-primary))',
        background: 'rgb(var(--bg-secondary))',
      }}
    >
      <div className="p-6 text-center border-b flex-shrink-0" style={{ borderColor: 'rgb(var(--border-primary))' }}>
        <Avatar name={displayName} seed={otherNumber} size="2xl" className="mx-auto mb-3" />
        <div className="font-display font-semibold text-lg">{displayName}</div>
        {call.contact?.company && (
          <div className="text-sm text-muted">{call.contact.company}</div>
        )}
        <div className="text-sm text-muted mt-0.5">{formatPhone(otherNumber)}</div>

        <div className="flex justify-center gap-3 mt-5">
          <button
            onClick={onCallBack}
            className="w-11 h-11 rounded-full bg-brand-600 hover:bg-brand-700 flex items-center justify-center text-white transition-colors"
            title="Call"
          >
            <Phone className="w-5 h-5" />
          </button>
          <button
            onClick={onMessage}
            className="w-11 h-11 rounded-full surface-tertiary hover:opacity-80 flex items-center justify-center transition-opacity"
            title="Message"
          >
            <MessageCircle className="w-5 h-5" />
          </button>
          <button
            onClick={async () => {
              await callsApi.update(call.id, { is_starred: !call.is_starred });
              onUpdated();
            }}
            className="w-11 h-11 rounded-full surface-tertiary hover:opacity-80 flex items-center justify-center transition-opacity"
            title={call.is_starred ? 'Unstar' : 'Star'}
          >
            <Star className={`w-5 h-5 ${call.is_starred ? 'fill-amber-400 text-amber-400' : ''}`} />
          </button>
          <button
            onClick={onClose}
            className="w-11 h-11 rounded-full surface-tertiary hover:opacity-80 flex items-center justify-center transition-opacity"
            title="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Voicemail */}
        {call.voicemail_url && (
          <section className="p-5 border-b" style={{ borderColor: 'rgb(var(--border-primary))' }}>
            <div className="text-xs uppercase tracking-wider font-semibold text-muted mb-2">
              Voicemail
            </div>
            <audio
              controls
              src={call.voicemail_url}
              className="w-full h-10"
              onError={(e) => { e.target.src = `${call.voicemail_url}.mp3`; }}
            />
            {call.voicemail_transcription && (
              <div className="text-sm mt-3 p-3 rounded-lg surface-tertiary leading-relaxed">
                {call.voicemail_transcription}
              </div>
            )}
          </section>
        )}

        {/* Recording */}
        {call.recording_url && (
          <section className="p-5 border-b" style={{ borderColor: 'rgb(var(--border-primary))' }}>
            <div className="text-xs uppercase tracking-wider font-semibold text-muted mb-2">
              Call recording
            </div>
            <audio
              controls
              src={call.recording_url}
              className="w-full h-10"
              onError={(e) => { e.target.src = `${call.recording_url}.mp3`; }}
            />
          </section>
        )}

        {/* Details */}
        <section className="p-5 space-y-3">
          <DetailRow label="Direction" value={call.direction === 'inbound' ? 'Incoming' : 'Outgoing'} />
          <DetailRow label="Status" value={call.status} />
          <DetailRow label="Duration" value={formatDuration(call.duration_seconds)} />
          <DetailRow label="Started" value={new Date(call.started_at).toLocaleString()} />
          {call.ended_at && (
            <DetailRow label="Ended" value={new Date(call.ended_at).toLocaleString()} />
          )}
        </section>
      </div>
    </div>
  );
}

function DetailRow({ label, value }) {
  return (
    <div className="flex justify-between items-center text-sm">
      <span className="text-muted">{label}</span>
      <span className="font-medium capitalize">{value}</span>
    </div>
  );
}

/* ============================================================ */
/* Skeletons and empty state                                    */
/* ============================================================ */
function SkeletonList() {
  return (
    <div>
      {[...Array(8)].map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-4 px-6 py-3 border-b"
          style={{ borderColor: 'rgb(var(--border-primary))' }}
        >
          <div className="w-10 h-10 rounded-full animate-pulse surface-tertiary" />
          <div className="flex-1 space-y-2">
            <div className="h-3.5 rounded animate-pulse w-1/3 surface-tertiary" />
            <div className="h-3 rounded animate-pulse w-1/4 surface-tertiary" />
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyState({ tab }) {
  return (
    <div className="h-full flex flex-col items-center justify-center text-center p-8">
      <div className="w-16 h-16 rounded-full surface-tertiary flex items-center justify-center mb-4">
        <Phone className="w-7 h-7 text-faint" />
      </div>
      <h3 className="font-display font-semibold text-lg">No {tab} calls</h3>
      <p className="text-sm text-muted mt-1 max-w-xs">
        When you make or receive calls, they'll show up here.
      </p>
    </div>
  );
}
