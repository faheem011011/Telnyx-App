import { useEffect, useState } from 'react';
import { Phone, Mail, User as UserIcon, ExternalLink, Loader2, Check, AlertCircle } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useTelnyx as useTwilio } from '../context/TelnyxContext';
import { adminApi } from '../services/api';
import { formatPhone } from '../utils/format';

const DEPARTMENTS = ['Data Team', 'HR Team', 'BD Team', 'AI/ML Team', 'DevOps Team'];

export default function SettingsPage() {
  const { user, logout, refreshUser } = useAuth();
  const { deviceReady, deviceError } = useTwilio();
  const isAdmin = user?.role === 'admin';

  return (
    <div className="flex-1 overflow-y-auto surface">
      <div className="max-w-2xl mx-auto px-6 py-8 space-y-8">
        <header>
          <h1 className="text-2xl font-display font-bold">Settings</h1>
          <p className="text-sm text-muted mt-1">Manage your profile and app preferences.</p>
        </header>

        {/* Profile */}
        <Section title="Profile">
          <Field label="Name" icon={UserIcon}>{user?.name}</Field>
          <Field label="Email" icon={Mail}>{user?.email}</Field>
          <Field label="Phone number" icon={Phone}>
            {user?.phone_number ? formatPhone(user.phone_number) : 'Not configured'}
          </Field>
        </Section>

        {/* Admin self-management — change own team, assign own number */}
        {isAdmin && (
          <>
            <DepartmentEditor user={user} onSaved={refreshUser} />
            <SelfNumberEditor user={user} onSaved={refreshUser} />
          </>
        )}

        {/* Phone status */}
        <Section title="Phone status">
          <div
            className="p-4 rounded-xl flex items-center gap-3"
            style={{ background: 'rgb(var(--bg-secondary))' }}
          >
            <span
              className={`w-3 h-3 rounded-full ${
                deviceError ? 'bg-red-500' : deviceReady ? 'bg-green-500' : 'bg-amber-500'
              }`}
            />
            <div className="flex-1">
              <div className="font-medium text-sm">
                {deviceError ? 'Disconnected' : deviceReady ? 'Connected' : 'Connecting…'}
              </div>
              {deviceError && (
                <div className="text-xs text-red-500 mt-0.5">{deviceError}</div>
              )}
              {!deviceError && (
                <div className="text-xs text-muted mt-0.5">
                  {deviceReady
                    ? 'Ready to make and receive calls'
                    : 'Registering with Telnyx…'}
                </div>
              )}
            </div>
          </div>
        </Section>

        {/* Links — admin only */}
        {isAdmin && (
          <Section title="Resources">
            <a
              href="https://portal.telnyx.com"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-between p-4 rounded-xl hover:surface-tertiary transition-colors"
              style={{ background: 'rgb(var(--bg-secondary))' }}
            >
              <span className="text-sm font-medium">Open Telnyx Portal</span>
              <ExternalLink className="w-4 h-4 text-faint" />
            </a>
          </Section>
        )}

        <div className="pt-4">
          <button
            onClick={logout}
            className="w-full py-3 rounded-lg border border-red-500/30 text-red-500 hover:bg-red-500 hover:text-white transition-colors text-sm font-medium"
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Admin self-editor: change own department ───────────────────────────────
function DepartmentEditor({ user, onSaved }) {
  const [value, setValue] = useState(user?.department || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [savedFlash, setSavedFlash] = useState(false);
  const dirty = value && value !== (user?.department || '');

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await adminApi.updateUser(user.id, { department: value });
      await onSaved?.();
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2000);
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to update department.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Section title="Team">
      <div className="p-4 space-y-3">
        <label className="block text-xs text-muted">Your department</label>
        <div className="flex gap-2">
          <select
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="input flex-1"
            disabled={saving}
          >
            <option value="" disabled>Select a team</option>
            {DEPARTMENTS.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
          <button
            onClick={save}
            disabled={!dirty || saving}
            className="btn-primary px-4 py-2 text-sm disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : savedFlash ? <Check className="w-4 h-4" /> : null}
            {savedFlash ? 'Saved' : 'Save'}
          </button>
        </div>
        {error && (
          <div className="flex items-center gap-2 text-xs text-red-500">
            <AlertCircle className="w-3.5 h-3.5" /> {error}
          </div>
        )}
      </div>
    </Section>
  );
}

// ─── Admin self-editor: assign / unassign own phone number ─────────────────
function SelfNumberEditor({ user, onSaved }) {
  const [numbers, setNumbers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [picked, setPicked] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [savedFlash, setSavedFlash] = useState(false);

  const ownNumber = numbers.find((n) => n.assigned_to_user_id === user?.id);
  const unassigned = numbers.filter((n) => !n.assigned_to_user_id);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    adminApi.listNumbers()
      .then((data) => { if (!cancelled) setNumbers(Array.isArray(data) ? data : []); })
      .catch(() => { if (!cancelled) setError('Could not load phone numbers.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const flash = () => {
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 2000);
  };

  const reload = async () => {
    try {
      const data = await adminApi.listNumbers();
      setNumbers(Array.isArray(data) ? data : []);
    } catch { /* non-fatal */ }
  };

  const assign = async () => {
    if (!picked) return;
    setBusy(true);
    setError(null);
    try {
      await adminApi.assignNumber(picked, user.id);
      await reload();
      await onSaved?.();
      setPicked('');
      flash();
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to assign number.');
    } finally {
      setBusy(false);
    }
  };

  const unassign = async () => {
    if (!ownNumber) return;
    setBusy(true);
    setError(null);
    try {
      await adminApi.unassignNumber(ownNumber.id);
      await reload();
      await onSaved?.();
      flash();
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to unassign number.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title="Your phone number">
      <div className="p-4 space-y-3">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading numbers…
          </div>
        ) : ownNumber ? (
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold">{formatPhone(ownNumber.phone_number)}</div>
              <div className="text-xs text-muted">Currently assigned to you.</div>
            </div>
            <button
              onClick={unassign}
              disabled={busy}
              className="px-3 py-1.5 rounded-lg text-sm border border-red-500/30 text-red-500 hover:bg-red-500 hover:text-white transition-colors disabled:opacity-40"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Unassign'}
            </button>
          </div>
        ) : (
          <>
            <label className="block text-xs text-muted">Pick an unassigned number</label>
            <div className="flex gap-2">
              <select
                value={picked}
                onChange={(e) => setPicked(e.target.value)}
                className="input flex-1"
                disabled={busy || unassigned.length === 0}
              >
                <option value="">
                  {unassigned.length === 0 ? 'No unassigned numbers available' : 'Select a number'}
                </option>
                {unassigned.map((n) => (
                  <option key={n.id} value={n.id}>{formatPhone(n.phone_number)}</option>
                ))}
              </select>
              <button
                onClick={assign}
                disabled={!picked || busy}
                className="btn-primary px-4 py-2 text-sm disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : savedFlash ? <Check className="w-4 h-4" /> : null}
                {savedFlash ? 'Assigned' : 'Assign'}
              </button>
            </div>
          </>
        )}
        {error && (
          <div className="flex items-center gap-2 text-xs text-red-500">
            <AlertCircle className="w-3.5 h-3.5" /> {error}
          </div>
        )}
      </div>
    </Section>
  );
}

function Section({ title, children }) {
  return (
    <section>
      <h2 className="text-xs uppercase tracking-wider font-semibold text-muted mb-3">{title}</h2>
      <div className="rounded-xl overflow-hidden" style={{ border: '1px solid rgb(var(--border-primary))' }}>
        {children}
      </div>
    </section>
  );
}

function Field({ label, icon: Icon, children }) {
  return (
    <div
      className="px-4 py-3.5 flex items-center gap-3 border-b last:border-b-0"
      style={{ borderColor: 'rgb(var(--border-primary))' }}
    >
      {Icon && <Icon className="w-4 h-4 text-faint flex-shrink-0" />}
      <div className="flex-1">
        <div className="text-xs text-muted">{label}</div>
        <div className="text-sm font-medium mt-0.5">{children}</div>
      </div>
    </div>
  );
}
