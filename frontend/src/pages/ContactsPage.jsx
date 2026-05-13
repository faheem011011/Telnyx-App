import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Search, Phone, MessageCircle, Star, Trash2, Edit2, X } from 'lucide-react';
import { contactsApi } from '../services/api';
import { useTelnyx as useTwilio } from '../context/TelnyxContext';
import { formatPhone, toE164 } from '../utils/format';
import { useAuth } from '../context/AuthContext';
import Avatar from '../components/Avatar';

export default function ContactsPage() {
  const [contacts, setContacts] = useState([]);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null); // contact being edited (or {} for new)
  const { makeCall } = useTwilio();
  const navigate = useNavigate();
  const { user: currentUser } = useAuth();
  const isAdmin = currentUser?.role === 'admin';

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(() => {
    setLoading(true);
    contactsApi
      .list(debouncedSearch, favoritesOnly)
      .then(setContacts)
      .catch(() => setContacts([]))
      .finally(() => setLoading(false));
  }, [debouncedSearch, favoritesOnly]);

  useEffect(() => {
    load();
  }, [load]);

  const handleCall = async (contact) => {
    try {
      await makeCall(toE164(contact.phone_number));
    } catch (e) {
      alert(e.message || 'Call failed');
    }
  };

  const handleMessage = (contact) => {
    navigate(`/messages/${encodeURIComponent(contact.phone_number)}`);
  };

  const handleDelete = async (contact) => {
    if (!confirm(`Delete ${contact.name}?`)) return;
    try {
      await contactsApi.remove(contact.id);
      load();
    } catch {
      alert('Failed to delete contact. Please try again.');
    }
  };

  const handleToggleFavorite = async (contact) => {
    try {
      await contactsApi.update(contact.id, { is_favorite: !contact.is_favorite });
      load();
    } catch {
      alert('Failed to update contact. Please try again.');
    }
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden surface">
      {/* Header */}
      <div
        className="px-6 py-4 border-b flex items-center justify-between flex-shrink-0"
        style={{ borderColor: 'rgb(var(--border-primary))' }}
      >
        <div>
          <h1 className="text-xl font-display font-bold">Contacts</h1>
          <p className="text-sm text-muted mt-0.5">
            {isAdmin && ' All users '}
            ({contacts.length} total)
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-faint" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name or phone"
              className="input pl-9 w-64 py-2"
            />
          </div>
          <button
            onClick={() => setFavoritesOnly((f) => !f)}
            className={`btn-ghost py-2 ${favoritesOnly ? 'text-amber-500' : ''}`}
            title="Favorites only"
          >
            <Star className={`w-4 h-4 ${favoritesOnly ? 'fill-amber-400' : ''}`} />
          </button>
          <button onClick={() => setEditing({})} className="btn-primary py-2 text-sm">
            <Plus className="w-4 h-4" />
            New
          </button>
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-6 text-muted">Loading…</div>
        ) : contacts.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-8">
            <div className="w-16 h-16 rounded-full surface-tertiary flex items-center justify-center mb-4">
              <Plus className="w-7 h-7 text-faint" />
            </div>
            <h3 className="font-display font-semibold text-lg">No contacts yet</h3>
            <p className="text-sm text-muted mt-1 max-w-xs">
              Click "New" above to add your first contact.
            </p>
          </div>
        ) : (
          <div>
            {contacts.map((c) => (
              <div
                key={c.id}
                className="group flex items-center gap-4 px-6 py-3 border-b hover:surface-tertiary transition-colors"
                style={{ borderColor: 'rgb(var(--border-primary))' }}
              >
                <Avatar name={c.name} seed={c.phone_number} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm truncate">{c.name}</span>
                    {c.is_favorite && <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />}
                    {isAdmin && c.owner_name && (
                      <span
                        className="text-xs font-medium px-1.5 py-0.5 rounded-md flex-shrink-0"
                        style={{
                          background: 'rgba(59,130,246,0.1)',
                          color: '#2563eb',
                          border: '1px solid rgba(59,130,246,0.2)',
                        }}
                      >
                        {c.owner_name}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-muted truncate">
                    {formatPhone(c.phone_number)}
                    {c.company && <span className="text-faint"> · {c.company}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => handleCall(c)}
                    className="w-9 h-9 rounded-lg surface-tertiary hover:bg-green-500 hover:text-white flex items-center justify-center transition-colors"
                    title="Call"
                  >
                    <Phone className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleMessage(c)}
                    className="w-9 h-9 rounded-lg surface-tertiary hover:opacity-80 flex items-center justify-center transition-opacity"
                    title="Message"
                  >
                    <MessageCircle className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleToggleFavorite(c)}
                    className="w-9 h-9 rounded-lg surface-tertiary hover:opacity-80 flex items-center justify-center transition-opacity"
                    title="Star"
                  >
                    <Star className={`w-4 h-4 ${c.is_favorite ? 'fill-amber-400 text-amber-400' : ''}`} />
                  </button>
                  <button
                    onClick={() => setEditing(c)}
                    className="w-9 h-9 rounded-lg surface-tertiary hover:opacity-80 flex items-center justify-center transition-opacity"
                    title="Edit"
                  >
                    <Edit2 className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleDelete(c)}
                    className="w-9 h-9 rounded-lg surface-tertiary hover:bg-red-500 hover:text-white flex items-center justify-center transition-colors"
                    title="Delete"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {editing && (
        <ContactFormModal
          contact={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}
    </div>
  );
}

/* ============================================================ */
/* Create/edit contact modal                                    */
/* ============================================================ */
function ContactFormModal({ contact, onClose, onSaved }) {
  const isNew = !contact.id;
  const [form, setForm] = useState({
    name: contact.name || '',
    phone_number: contact.phone_number || '',
    email: contact.email || '',
    company: contact.company || '',
    notes: contact.notes || '',
    is_favorite: contact.is_favorite || false,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const payload = { ...form, phone_number: toE164(form.phone_number) };
      if (isNew) {
        await contactsApi.create(payload);
      } else {
        await contactsApi.update(contact.id, payload);
      }
      onSaved();
    } catch (err) {
      setError(err.response?.data?.detail || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center animate-fade-in"
      style={{ background: 'rgb(0 0 0 / 0.6)' }}
      onClick={onClose}
    >
      {/* Compacted: smaller padding, denser grid (name+phone, email+company
          side-by-side on >=sm), a 2-row notes textarea, and a max-h with
          overflow-y so the modal always fits the viewport — never pushes
          off-screen on shorter laptop displays. */}
      <div
        className="w-full max-w-lg mx-4 rounded-2xl p-4 sm:p-5 animate-slide-up max-h-[92vh] overflow-y-auto"
        style={{
          background: 'rgb(var(--bg-primary))',
          border: '1px solid rgb(var(--border-primary))',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-display font-bold">
            {isNew ? 'New contact' : 'Edit contact'}
          </h2>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-full surface-tertiary flex items-center justify-center hover:opacity-80"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-2.5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <Field label="Name" required>
              <input
                autoFocus
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Contact name"
                className="input"
              />
            </Field>
            <Field label="Phone number" required>
              <input
                required
                value={form.phone_number}
                onChange={(e) => setForm({ ...form, phone_number: e.target.value })}
                placeholder="+1 555 000 1234"
                className="input"
              />
            </Field>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <Field label="Email">
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="name@example.com"
                className="input"
              />
            </Field>
            <Field label="Company">
              <input
                value={form.company}
                onChange={(e) => setForm({ ...form, company: e.target.value })}
                placeholder="Company name"
                className="input"
              />
            </Field>
          </div>
          <Field label="Notes">
            <textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder="Any notes about this contact…"
              rows={2}
              className="input resize-none"
            />
          </Field>

          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={form.is_favorite}
              onChange={(e) => setForm({ ...form, is_favorite: e.target.checked })}
              className="w-4 h-4 accent-brand-600"
            />
            Mark as favorite
          </label>

          {error && (
            <div className="px-3 py-2 rounded-lg text-xs bg-red-500/10 text-red-500 border border-red-500/20">
              {error}
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose} className="btn-ghost surface-tertiary flex-1 py-2 text-sm">
              Cancel
            </button>
            <button type="submit" disabled={saving} className="btn-primary flex-1 py-2 text-sm disabled:opacity-60">
              {saving ? 'Saving…' : isNew ? 'Create contact' : 'Save changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({ label, required, children }) {
  return (
    <div>
      <label className="text-[11px] font-medium text-muted uppercase tracking-wide">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      <div className="mt-1">{children}</div>
    </div>
  );
}
