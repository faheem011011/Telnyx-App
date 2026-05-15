import { useEffect, useState, useRef, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Send, Phone, ArrowLeft, MessageCircle, Search, MailOpen } from 'lucide-react';
import { messagesApi } from '../services/api';
import { useTelnyx } from '../context/TelnyxContext';
import { formatPhone, formatCallDate, toE164 } from '../utils/format';
import Avatar from '../components/Avatar';

/**
 * Messages page with left-side conversation list and right-side thread.
 */
export default function MessagesPage() {
  const { phoneNumber } = useParams();
  const navigate = useNavigate();
  const [conversations, setConversations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const load = useCallback((showSpinner = false) => {
    if (showSpinner) setLoading(true);
    messagesApi
      .conversations()
      .then((next) => {
        setConversations((prev) => {
          const byKey = new Map(prev.map((c) => [c.phone_number, c]));
          for (const c of next) byKey.set(c.phone_number, c);
          // Drop any conversations that no longer exist server-side
          const validKeys = new Set(next.map((c) => c.phone_number));
          return [...byKey.values()].filter((c) => validKeys.has(c.phone_number));
        });
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load(true);
    const id = setInterval(() => load(false), 10000);
    return () => clearInterval(id);
  }, [load]);

  // When the user opens a thread, the ThreadView fires mark-read on the backend —
  // refresh the conversation list shortly after so the unread badge clears.
  useEffect(() => {
    if (phoneNumber && phoneNumber !== 'new') {
      const t = setTimeout(() => load(false), 600);
      return () => clearTimeout(t);
    }
  }, [phoneNumber, load]);

  const filtered = conversations.filter((c) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      c.phone_number.toLowerCase().includes(q) ||
      c.contact?.name?.toLowerCase().includes(q) ||
      c.last_message?.body?.toLowerCase().includes(q)
    );
  });

  const isNew = phoneNumber === 'new';

  return (
    <div className="flex-1 flex overflow-hidden surface">
      {/* Conversation list */}
      <div
        className="w-80 flex flex-col border-r flex-shrink-0"
        style={{ borderColor: 'rgb(var(--border-primary))' }}
      >
        <div
          className="px-5 py-4 border-b"
          style={{ borderColor: 'rgb(var(--border-primary))' }}
        >
          <div className="flex items-center justify-between mb-3">
            <h1 className="text-lg font-display font-bold">Messages</h1>
            <button
              onClick={() => navigate('/messages/new')}
              className="btn-primary py-1.5 px-3 text-xs"
            >
              New
            </button>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-faint" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name or phone"
              className="input pl-9 py-2"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-4 text-sm text-muted">Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="p-6 text-center">
              <MessageCircle className="w-10 h-10 text-faint mx-auto mb-2" />
              <p className="text-sm text-muted">No conversations</p>
            </div>
          ) : (
            filtered.map((conv) => (
              <div
                key={conv.phone_number}
                onClick={() => navigate(`/messages/${encodeURIComponent(conv.phone_number)}`)}
                className={`flex items-center gap-3 px-4 py-3 cursor-pointer border-b transition-colors ${
                  phoneNumber === conv.phone_number
                    ? 'bg-brand-50'
                    : 'hover:surface-tertiary'
                }`}
                style={{ borderColor: 'rgb(var(--border-primary))' }}
              >
                <Avatar
                  name={conv.contact?.name || conv.phone_number}
                  seed={conv.phone_number}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={`text-sm truncate ${
                        conv.unread_count > 0 ? 'font-semibold' : 'font-medium'
                      }`}
                    >
                      {conv.contact?.name || formatPhone(conv.phone_number)}
                    </span>
                    <span className="text-xs text-faint flex-shrink-0">
                      {formatCallDate(conv.last_message.created_at)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2 mt-0.5">
                    <span className="text-xs text-muted truncate">
                      {conv.last_message.direction === 'outbound' && 'You: '}
                      {conv.last_message.body}
                    </span>
                    {conv.unread_count > 0 && (
                      <span className="px-1.5 rounded-full text-xs font-semibold bg-brand-600 text-white min-w-[18px] h-[18px] flex items-center justify-center">
                        {conv.unread_count}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Thread view */}
      <div className="flex-1 flex flex-col">
        {isNew ? (
          <NewMessageComposer onSent={() => load(false)} />
        ) : phoneNumber ? (
          <ThreadView phoneNumber={phoneNumber} onSent={() => load(false)} />
        ) : (
          <EmptyThread />
        )}
      </div>
    </div>
  );
}

/* ============================================================ */
/* Empty state                                                  */
/* ============================================================ */
function EmptyThread() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
      <div className="w-16 h-16 rounded-full surface-tertiary flex items-center justify-center mb-4">
        <MessageCircle className="w-7 h-7 text-faint" />
      </div>
      <h3 className="font-display font-semibold text-lg">Select a conversation</h3>
      <p className="text-sm text-muted mt-1">Pick one from the left, or start a new message.</p>
    </div>
  );
}

/* ============================================================ */
/* New message composer                                         */
/* ============================================================ */
function NewMessageComposer({ onSent }) {
  const [to, setTo] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const navigate = useNavigate();

  const handleSend = async (e) => {
    e.preventDefault();
    setError(null);
    setSending(true);
    try {
      const toNumber = toE164(to);
      await messagesApi.send(toNumber, body);
      onSent();
      navigate(`/messages/${encodeURIComponent(toNumber)}`);
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to send');
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <div
        className="px-6 py-4 border-b"
        style={{ borderColor: 'rgb(var(--border-primary))' }}
      >
        <div className="text-xs uppercase text-muted font-semibold tracking-wide">New message</div>
        <input
          type="text"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          placeholder="Enter recipient's phone number (e.g. +1 555 000 1234)"
          autoFocus
          className="w-full mt-2 py-2 bg-transparent border-none outline-none font-display text-lg"
        />
      </div>
      <div className="flex-1 flex items-center justify-center text-center p-8">
        <div>
          <div className="w-16 h-16 rounded-full surface-tertiary flex items-center justify-center mb-4 mx-auto">
            <MessageCircle className="w-7 h-7 text-faint" />
          </div>
          <h3 className="font-display font-semibold text-lg">What's on your mind?</h3>
          <p className="text-sm text-muted mt-1">Enter a number above to start chatting.</p>
        </div>
      </div>
      <MessageComposer
        value={body}
        onChange={setBody}
        onSend={handleSend}
        sending={sending}
        error={error}
        disabled={!to}
      />
    </>
  );
}

/* ============================================================ */
/* Thread view — messages for one phone number                  */
/* ============================================================ */
function ThreadView({ phoneNumber, onSent }) {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const { makeCall } = useTelnyx();
  const bottomRef = useRef(null);
  const navigate = useNavigate();

  const load = useCallback((showSpinner = false) => {
    if (showSpinner) setLoading(true);
    messagesApi
      .thread(phoneNumber)
      .then((next) => {
        setMessages((prev) => {
          const optimistic = prev.filter((m) => typeof m.id === 'string' && m.id.startsWith('opt-'));
          const merged = [...next];
          for (const opt of optimistic) {
            // M-18: use client_id as the sole dedup key — body+direction matching
            // would incorrectly drop one of two identical rapid messages.
            const confirmed = next.some((m) => m.client_id && m.client_id === opt.client_id);
            if (!confirmed) merged.push(opt);
          }
          return merged.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
        });
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [phoneNumber]);

  useEffect(() => {
    load(true);
    const id = setInterval(() => load(false), 8000);
    return () => clearInterval(id);
  }, [load]);

  useEffect(() => {
    if (!phoneNumber) return;
    messagesApi.markThreadRead(phoneNumber).catch(() => {});
    window.dispatchEvent(new CustomEvent('calls:read'));
  }, [phoneNumber]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async (e) => {
    e.preventDefault();
    const text = body.trim();
    if (!text) return;
    setError(null);
    setSending(true);

    // Optimistic update — show message immediately
    // M-18: generate a UUID so the polling dedup can match by client_id, not body+direction.
    const clientId = crypto.randomUUID();
    const optimisticId = `opt-${Date.now()}`;
    const optimistic = {
      id: optimisticId,
      direction: 'outbound',
      body: text,
      status: 'sending',
      _optimistic: true,
      client_id: clientId,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimistic]);
    setBody('');

    try {
      const sent = await messagesApi.send(phoneNumber, text, clientId);
      // Replace optimistic entry with confirmed message from server (preserve client_id).
      setMessages((prev) => prev.map((m) => (m.client_id === clientId ? { ...sent, client_id: clientId } : m)));
      onSent();
    } catch (err) {
      // Roll back optimistic entry and restore draft
      setMessages((prev) => prev.filter((m) => m.id !== optimisticId));
      setBody(text);
      setError(err.response?.data?.detail || 'Failed to send');
    } finally {
      setSending(false);
    }
  };

  const handleCall = async () => {
    try {
      await makeCall(phoneNumber);
    } catch (e) {
      setError(e.message || 'Call failed. Check the number and try again.');
    }
  };

  const handleMarkUnread = () => {
    messagesApi.markThreadUnread(phoneNumber).catch(() => {});
    window.dispatchEvent(new CustomEvent('calls:read'));
    navigate('/messages');
  };

  return (
    <>
      {/* Thread header */}
      <div
        className="px-6 py-3 border-b flex items-center gap-3 flex-shrink-0"
        style={{ borderColor: 'rgb(var(--border-primary))' }}
      >
        <Avatar name={phoneNumber} seed={phoneNumber} />
        <div className="flex-1 min-w-0">
          <div className="font-medium text-sm truncate">{formatPhone(phoneNumber)}</div>
          <div className="text-xs text-muted">{messages.length} messages</div>
        </div>
        <button
          onClick={handleMarkUnread}
          title="Mark as unread"
          className="w-9 h-9 rounded-full surface-tertiary hover:bg-brand-500 hover:text-white flex items-center justify-center transition-colors"
        >
          <MailOpen className="w-4 h-4" />
        </button>
        <button
          onClick={handleCall}
          className="w-9 h-9 rounded-full surface-tertiary hover:bg-green-500 hover:text-white flex items-center justify-center transition-colors"
        >
          <Phone className="w-4 h-4" />
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-2">
        {loading ? (
          <div className="text-sm text-muted text-center">Loading…</div>
        ) : messages.length === 0 ? (
          <div className="text-sm text-muted text-center py-8">
            No messages yet. Say hi!
          </div>
        ) : (
          messages.map((m, i) => {
            const prev = messages[i - 1];
            const showDate =
              !prev ||
              new Date(m.created_at).toDateString() !== new Date(prev.created_at).toDateString();
            return (
              <div key={m.id}>
                {showDate && (
                  <div className="flex justify-center my-4">
                    <span className="px-3 py-1 rounded-full text-xs text-muted surface-tertiary">
                      {new Date(m.created_at).toLocaleDateString('en-US', {
                        weekday: 'long',
                        month: 'short',
                        day: 'numeric',
                      })}
                    </span>
                  </div>
                )}
                <MessageBubble message={m} />
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      <MessageComposer
        value={body}
        onChange={setBody}
        onSend={handleSend}
        sending={sending}
        error={error}
      />
    </>
  );
}

function MessageBubble({ message }) {
  const isOut = message.direction === 'outbound';
  const isSending = message.status === 'sending';
  return (
    <div className={`flex ${isOut ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[70%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed transition-opacity ${
          isOut
            ? 'bg-brand-600 text-white rounded-br-md'
            : 'surface-tertiary rounded-bl-md'
        } ${isSending ? 'opacity-60' : 'opacity-100'}`}
      >
        {message.body}
        <div className={`text-[10px] mt-1 ${isOut ? 'text-white/60' : 'text-faint'}`}>
          {isSending
            ? 'Sending…'
            : new Date(message.created_at).toLocaleTimeString('en-US', {
                hour: 'numeric',
                minute: '2-digit',
              })}
        </div>
      </div>
    </div>
  );
}

function MessageComposer({ value, onChange, onSend, sending, error, disabled }) {
  return (
    <div className="p-4 border-t flex-shrink-0" style={{ borderColor: 'rgb(var(--border-primary))' }}>
      {error && (
        <div className="mb-2 px-3 py-2 rounded-lg text-sm bg-red-500/10 text-red-500 border border-red-500/20">
          {error}
        </div>
      )}
      <form onSubmit={onSend} className="flex items-end gap-2">
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              onSend(e);
            }
          }}
          placeholder="Type your message here…"
          rows={1}
          className="input resize-none"
          style={{ minHeight: '44px' }}
          disabled={disabled}
        />
        <button
          type="submit"
          disabled={sending || !value.trim() || disabled}
          className="btn-primary h-11 w-11 !p-0 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Send className="w-4 h-4" />
        </button>
      </form>
    </div>
  );
}
