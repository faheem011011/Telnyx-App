import { useState, useEffect, useCallback } from 'react';
import {
  Users, Phone, Plus, Search, Trash2, Edit2, X, Check,
  RefreshCw, UserCheck, PhoneCall, Shield, UserCircle,
  Building2, ChevronDown, Loader2, AlertCircle, MailCheck,
  Eye, EyeOff,
} from 'lucide-react';
import { adminApi } from '../services/api';
import Avatar from '../components/Avatar';
import { formatPhone } from '../utils/format';

const DEPARTMENTS = ['', 'Data Team', 'HR Team', 'BD Team', 'AI/ML Team', 'DevOps Team'];
const ROLES = ['user', 'admin'];
// Must match backend UserAdminCreate.password Field min_length — keep in sync.
const MIN_PASSWORD_LENGTH = 12;

// FastAPI returns 422 validation errors as an array of {type, loc, msg, input, ctx}
// objects. Rendering that array directly as React children throws error #31
// ("Objects are not valid as a React child"), which bubbles to ErrorBoundary
// and shows the generic "Something went wrong" page — burying the actual
// validation message that would have told the admin what to fix.
function formatApiError(err, fallback) {
  const detail = err?.response?.data?.detail;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    return detail
      .map((d) => {
        if (typeof d === 'string') return d;
        const field = Array.isArray(d?.loc) ? d.loc.filter((p) => p !== 'body').join('.') : '';
        const msg = d?.msg || 'invalid value';
        return field ? `${field}: ${msg}` : msg;
      })
      .join('; ');
  }
  return fallback;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function RoleBadge({ role }) {
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold ${
        role === 'admin'
          ? 'bg-brand-100 text-brand-700'
          : 'bg-zinc-100 text-zinc-600'
      }`}
    >
      {role === 'admin' ? <Shield className="w-3 h-3" /> : <UserCircle className="w-3 h-3" />}
      {role === 'admin' ? 'Admin' : 'User'}
    </span>
  );
}

function StatusBadge({ active }) {
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold ${
        active
          ? 'bg-green-100 text-green-700'
          : 'bg-red-100 text-red-600'
      }`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${active ? 'bg-green-500' : 'bg-red-400'}`} />
      {active ? 'Active' : 'Inactive'}
    </span>
  );
}

function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div
        className="w-full max-w-md rounded-2xl shadow-2xl animate-slide-up"
        style={{ background: 'rgb(var(--bg-primary))', border: '1px solid rgb(var(--border-primary))' }}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b" style={{ borderColor: 'rgb(var(--border-primary))' }}>
          <h3 className="font-display font-semibold text-base">{title}</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:surface-tertiary transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="px-6 py-5">{children}</div>
      </div>
    </div>
  );
}

function FormField({ label, htmlFor, optional, children }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="text-xs font-medium text-muted uppercase tracking-wide">
        {label} {optional && <span className="normal-case font-normal">(optional)</span>}
      </label>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

// Password input with show/hide toggle. Visible-state is owned by the caller
// so the same toggle can drive both the create and edit fields without
// double-tracking state inside this component.
function PasswordInputWithToggle({ id, required, placeholder, value, onChange, visible, onToggleVisible }) {
  return (
    <div className="relative">
      <input
        id={id}
        required={required}
        type={visible ? 'text' : 'password'}
        minLength={MIN_PASSWORD_LENGTH}
        className="input pr-10"
        placeholder={placeholder}
        autoComplete="new-password"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <button
        type="button"
        onClick={onToggleVisible}
        aria-label={visible ? 'Hide password' : 'Show password'}
        title={visible ? 'Hide password' : 'Show password'}
        className="absolute inset-y-0 right-2 flex items-center text-faint hover:text-foreground transition-colors"
        tabIndex={-1}
      >
        {visible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
      </button>
    </div>
  );
}

// ─── UserForm — defined at module level to avoid focus-loss on every render ───

function UserForm({ form, setForm, actionError, actionLoading, onCancel, onSubmit, submitLabel, isEdit = false }) {
  const [showPassword, setShowPassword] = useState(false);
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <FormField label="Full Name" htmlFor="uf-name">
        <input
          id="uf-name"
          required
          className="input"
          placeholder="Enter full name"
          autoComplete="off"
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
        />
      </FormField>
      {!isEdit && (
        <FormField label="Email" htmlFor="uf-email">
          <input
            id="uf-email"
            required
            type="email"
            className="input"
            placeholder="Enter email address"
            autoComplete="off"
            value={form.email}
            onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
          />
        </FormField>
      )}
      {!isEdit && (
        <FormField label="Password" htmlFor="uf-password">
          <PasswordInputWithToggle
            id="uf-password"
            required
            placeholder={`Create a password (min. ${MIN_PASSWORD_LENGTH} characters)`}
            value={form.password}
            onChange={(v) => setForm((f) => ({ ...f, password: v }))}
            visible={showPassword}
            onToggleVisible={() => setShowPassword((v) => !v)}
          />
          {form.password.length > 0 && form.password.length < MIN_PASSWORD_LENGTH && (
            <p className="mt-1 text-xs text-amber-500">
              Password must be at least {MIN_PASSWORD_LENGTH} characters.
            </p>
          )}
        </FormField>
      )}
      {isEdit && (
        <FormField label="New Password" htmlFor="uf-new-password" optional>
          <PasswordInputWithToggle
            id="uf-new-password"
            placeholder="Leave blank to keep current password"
            value={form.password}
            onChange={(v) => setForm((f) => ({ ...f, password: v }))}
            visible={showPassword}
            onToggleVisible={() => setShowPassword((v) => !v)}
          />
          {form.password.length > 0 && form.password.length < MIN_PASSWORD_LENGTH && (
            <p className="mt-1 text-xs text-amber-500">
              Password must be at least {MIN_PASSWORD_LENGTH} characters.
            </p>
          )}
          {form.password.length >= MIN_PASSWORD_LENGTH && (
            <p className="mt-1 text-xs text-green-500">New password will be set on save.</p>
          )}
        </FormField>
      )}
      <FormField label="Role" htmlFor="uf-role">
        <select
          id="uf-role"
          className="input"
          value={form.role}
          onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
        >
          <option value="user">User</option>
          <option value="admin">Admin</option>
        </select>
      </FormField>
      <FormField label="Department" htmlFor="uf-dept">
        <select
          id="uf-dept"
          required
          className="input"
          value={form.department}
          onChange={(e) => setForm((f) => ({ ...f, department: e.target.value }))}
        >
          <option value="">Select department…</option>
          {DEPARTMENTS.slice(1).map((d) => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>
      </FormField>

      {actionError && (
        <div className="px-3 py-2.5 rounded-lg text-sm bg-red-500/10 text-red-500 border border-red-500/20 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          {actionError}
        </div>
      )}

      <div className="flex gap-3 pt-1">
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 btn-ghost surface-tertiary py-2.5 text-sm"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={actionLoading}
          className="flex-1 btn-primary py-2.5 text-sm disabled:opacity-60"
        >
          {actionLoading ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : submitLabel}
        </button>
      </div>
    </form>
  );
}

// ─── Users Tab ────────────────────────────────────────────────────────────────

function UsersTab({ users, loading, onRefresh }) {
  const [search, setSearch] = useState('');
  const [deptFilter, setDeptFilter] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [editUser, setEditUser] = useState(null);
  const [deleteUser, setDeleteUser] = useState(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState(null);
  const [successBanner, setSuccessBanner] = useState(null);

  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'user', department: '' });

  const filtered = (users || []).filter((u) => {
    const matchDept = !deptFilter || u.department === deptFilter;
    const q = search.toLowerCase();
    const matchSearch =
      !search ||
      u.name.toLowerCase().includes(q) ||
      u.email.toLowerCase().includes(q) ||
      (u.department || '').toLowerCase().includes(q);
    return matchDept && matchSearch;
  });

  const openEdit = (u) => {
    setEditUser(u);
    setForm({ name: u.name, email: u.email, password: '', role: u.role, department: u.department || '' });
    setActionError(null);
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!form.password || form.password.length < MIN_PASSWORD_LENGTH) {
      setActionError(`Password is required and must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (!form.department) {
      setActionError('Department is required.');
      return;
    }
    setActionLoading(true);
    setActionError(null);
    try {
      const created = await adminApi.createUser({
        name: form.name,
        email: form.email,
        password: form.password,
        role: form.role,
        department: form.department,
      });
      setShowCreate(false);
      setForm({ name: '', email: '', password: '', role: 'user', department: '' });
      setSuccessBanner(`User created. Verification email sent to ${created.email}.`);
      setTimeout(() => setSuccessBanner(null), 6000);
      onRefresh();
    } catch (err) {
      setActionError(formatApiError(err, 'Failed to create user'));
    } finally {
      setActionLoading(false);
    }
  };

  const handleUpdate = async (e) => {
    e.preventDefault();
    if (form.password && form.password.length < MIN_PASSWORD_LENGTH) {
      setActionError(`New password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    setActionLoading(true);
    setActionError(null);
    try {
      const payload = {
        name: form.name,
        role: form.role,
        department: form.department || null,
        is_active: editUser.is_active,
      };
      if (form.password) payload.password = form.password;
      await adminApi.updateUser(editUser.id, payload);
      setEditUser(null);
      onRefresh();
    } catch (err) {
      setActionError(formatApiError(err, 'Failed to update user'));
    } finally {
      setActionLoading(false);
    }
  };

  const handleToggleActive = async (u) => {
    try {
      await adminApi.updateUser(u.id, { is_active: !u.is_active });
      onRefresh();
    } catch (err) {
      setActionError(err.response?.data?.detail || 'Failed to update user status. Please try again.');
    }
  };

  const handleDelete = async () => {
    setActionLoading(true);
    setActionError(null);
    try {
      await adminApi.deleteUser(deleteUser.id);
      setDeleteUser(null);
      onRefresh();
    } catch (err) {
      setActionError(err.response?.data?.detail || 'Failed to delete user');
    } finally {
      setActionLoading(false);
    }
  };

  const cancelForm = () => { setShowCreate(false); setEditUser(null); setActionError(null); };

  return (
    <div>
      {successBanner && (
        <div className="mb-4 px-4 py-3 rounded-xl text-sm bg-green-500/10 text-green-700 border border-green-500/20 flex items-center gap-2">
          <MailCheck className="w-4 h-4 flex-shrink-0" />
          {successBanner}
          <button onClick={() => setSuccessBanner(null)} className="ml-auto"><X className="w-4 h-4" /></button>
        </div>
      )}
      {actionError && !showCreate && !editUser && !deleteUser && (
        <div className="mb-4 px-4 py-3 rounded-xl text-sm bg-red-500/10 text-red-500 border border-red-500/20 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {actionError}
          <button onClick={() => setActionError(null)} className="ml-auto"><X className="w-4 h-4" /></button>
        </div>
      )}
      {/* Department filter tabs */}
      <div className="flex items-center gap-1.5 mb-4 flex-wrap">
        {['', ...DEPARTMENTS.slice(1)].map((d) => (
          <button
            key={d}
            onClick={() => setDeptFilter(d)}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-150"
            style={{
              background: deptFilter === d ? '#1454F6' : 'rgb(var(--bg-tertiary))',
              color: deptFilter === d ? '#fff' : 'rgb(var(--text-muted))',
              border: deptFilter === d ? 'none' : '1px solid rgb(var(--border-primary))',
            }}
          >
            {d || 'All Departments'}
            <span className="ml-1.5 opacity-70">
              {d
                ? (users || []).filter((u) => u.department === d).length
                : (users || []).length}
            </span>
          </button>
        ))}
      </div>

      <div className="flex items-center gap-3 mb-5">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-faint" />
          <input
            className="input pl-9"
            placeholder="Search by name, email or department…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <button
          onClick={() => { setShowCreate(true); setForm({ name: '', email: '', password: '', role: 'user', department: deptFilter }); setActionError(null); }}
          className="btn-primary py-2.5 px-4 text-sm whitespace-nowrap"
        >
          <Plus className="w-4 h-4" />
          Add User
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="w-8 h-8 animate-spin text-muted" />
        </div>
      ) : (
        <div className="rounded-xl overflow-hidden border" style={{ borderColor: 'rgb(var(--border-primary))' }}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: 'rgb(var(--bg-tertiary))' }}>
                {['User', 'Department', 'Role', 'Status', 'Numbers', 'Actions'].map((h) => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-muted uppercase tracking-wide">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-12 text-muted text-sm">
                    {deptFilter ? `No users in ${deptFilter}` : 'No users found'}
                  </td>
                </tr>
              ) : (
                filtered.map((u) => (
                  <tr
                    key={u.id}
                    className="border-t transition-colors hover:surface-secondary"
                    style={{ borderColor: 'rgb(var(--border-primary))' }}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <Avatar name={u.name} seed={u.email} size="sm" />
                        <div>
                          <div className="font-medium">{u.name}</div>
                          <div className="text-xs text-muted">{u.email}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted">{u.department || '—'}</td>
                    <td className="px-4 py-3"><RoleBadge role={u.role} /></td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-1">
                        <StatusBadge active={u.is_active} />
                        {!u.email_verified && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-100 text-amber-700">
                            Unverified
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-sm font-medium">{u.assigned_numbers?.length || 0}</span>
                      {u.assigned_numbers?.length > 0 && (
                        <div className="text-xs text-muted truncate max-w-[120px]">
                          {formatPhone(u.assigned_numbers[0].phone_number)}
                          {u.assigned_numbers.length > 1 && ` +${u.assigned_numbers.length - 1}`}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => openEdit(u)}
                          title="Edit user"
                          className="p-1.5 rounded-lg hover:surface-tertiary transition-colors text-muted hover:text-primary"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleToggleActive(u)}
                          title={u.is_active ? 'Deactivate' : 'Activate'}
                          className="p-1.5 rounded-lg hover:surface-tertiary transition-colors text-muted hover:text-primary"
                        >
                          <UserCheck className="w-3.5 h-3.5" />
                        </button>
                        {!u.email_verified && (
                          <button
                            onClick={async () => {
                              try {
                                await adminApi.resendVerification(u.id);
                                setSuccessBanner(`Verification email resent to ${u.email}.`);
                                setTimeout(() => setSuccessBanner(null), 6000);
                              } catch (err) {
                                setActionError(err.response?.data?.detail || 'Failed to resend verification email.');
                              }
                            }}
                            title="Resend verification email"
                            className="p-1.5 rounded-lg hover:surface-tertiary transition-colors text-amber-500 hover:text-amber-600"
                          >
                            <MailCheck className="w-3.5 h-3.5" />
                          </button>
                        )}
                        <button
                          onClick={() => { setDeleteUser(u); setActionError(null); }}
                          title="Delete user"
                          className="p-1.5 rounded-lg hover:surface-tertiary transition-colors text-muted hover:text-red-500"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {showCreate && (
        <Modal title="Add New User" onClose={cancelForm}>
          <UserForm
            form={form}
            setForm={setForm}
            actionError={actionError}
            actionLoading={actionLoading}
            onCancel={cancelForm}
            onSubmit={handleCreate}
            submitLabel="Create User"
          />
        </Modal>
      )}

      {editUser && (
        <Modal title={`Edit - ${editUser.name}`} onClose={cancelForm}>
          <UserForm
            form={form}
            setForm={setForm}
            actionError={actionError}
            actionLoading={actionLoading}
            onCancel={cancelForm}
            onSubmit={handleUpdate}
            submitLabel="Save Changes"
            isEdit
          />
        </Modal>
      )}

      {deleteUser && (
        <Modal title="Delete User" onClose={() => setDeleteUser(null)}>
          <p className="text-sm text-muted mb-5">
            Are you sure you want to delete <strong>{deleteUser.name}</strong>? This will permanently remove their account and all associated data.
          </p>
          {actionError && (
            <div className="mb-4 px-3 py-2.5 rounded-lg text-sm bg-red-500/10 text-red-500 border border-red-500/20">
              {actionError}
            </div>
          )}
          <div className="flex gap-3">
            <button
              onClick={() => setDeleteUser(null)}
              className="flex-1 btn-ghost surface-tertiary py-2.5 text-sm"
            >
              Cancel
            </button>
            <button
              onClick={handleDelete}
              disabled={actionLoading}
              className="flex-1 py-2.5 text-sm font-medium rounded-xl bg-red-500 text-white hover:bg-red-600 transition-colors disabled:opacity-60"
            >
              {actionLoading ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : 'Delete'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─── Numbers Tab ──────────────────────────────────────────────────────────────

function NumbersTab({ numbers, users, loading, onRefresh }) {
  const [searchArea, setSearchArea] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(null);
  const [purchasing, setPurchasing] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [actionError, setActionError] = useState(null);
  const [pendingAssign, setPendingAssign] = useState(null); // { numberId, userId, phone, userName }

  const handleSearch = async () => {
    setSearching(true);
    setSearchError(null);
    setSearchResults([]);
    try {
      const results = await adminApi.searchNumbers({ area_code: searchArea, limit: 10 });
      setSearchResults(results);
    } catch (err) {
      setSearchError(err.response?.data?.detail || 'Search failed. Check your Telnyx credentials.');
    } finally {
      setSearching(false);
    }
  };

  const handlePurchase = async (phoneNumber) => {
    setPurchasing(phoneNumber);
    setActionError(null);
    try {
      await adminApi.purchaseNumber(phoneNumber);
      setSearchResults((r) => r.filter((n) => n.phone_number !== phoneNumber));
      onRefresh();
    } catch (err) {
      setActionError(err.response?.data?.detail || 'Purchase failed');
    } finally {
      setPurchasing(null);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    setActionError(null);
    try {
      await adminApi.syncNumbers();
      onRefresh();
    } catch (err) {
      setActionError(err.response?.data?.detail || 'Sync failed. Check your Telnyx credentials.');
    } finally {
      setSyncing(false);
    }
  };

  const confirmAssign = async () => {
    const { numberId, userId } = pendingAssign;
    setPendingAssign(null);
    try {
      if (userId) {
        await adminApi.assignNumber(numberId, parseInt(userId));
      } else {
        await adminApi.unassignNumber(numberId);
      }
      onRefresh();
    } catch (err) {
      setActionError(err.response?.data?.detail || 'Assignment failed');
    }
  };

  const handleRelease = async (numberId) => {
    if (!window.confirm('Release this number from your Telnyx account? This cannot be undone.')) return;
    try {
      await adminApi.releaseNumber(numberId);
      onRefresh();
    } catch (err) {
      setActionError(err.response?.data?.detail || 'Release failed');
    }
  };

  return (
    <div className="space-y-6">
      {actionError && (
        <div className="px-4 py-3 rounded-xl text-sm bg-red-500/10 text-red-500 border border-red-500/20 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {actionError}
          <button onClick={() => setActionError(null)} className="ml-auto"><X className="w-4 h-4" /></button>
        </div>
      )}

      {/* Search & Purchase */}
      <div
        className="rounded-2xl p-5 border"
        style={{ borderColor: 'rgb(var(--border-primary))', background: 'rgb(var(--bg-secondary))' }}
      >
        <h3 className="font-display font-semibold text-sm mb-1">Search & Purchase Numbers</h3>
        <p className="text-xs text-muted mb-4">Search Telnyx's available US numbers and purchase directly</p>

        <div className="flex gap-3 mb-4">
          <div className="relative flex-1">
            <PhoneCall className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-faint" />
            <input
              className="input pl-9"
              placeholder="Enter area code (e.g. 415)"
              value={searchArea}
              onChange={(e) => setSearchArea(e.target.value.replace(/\D/g, '').slice(0, 3))}
              onKeyDown={(e) => e.key === 'Enter' && searchArea.length === 3 && handleSearch()}
              maxLength={3}
            />
          </div>
          <button
            onClick={handleSearch}
            disabled={searching || searchArea.length < 3}
            className="btn-primary px-5 py-2.5 text-sm disabled:opacity-60"
          >
            {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            {searching ? 'Searching…' : 'Search'}
          </button>
        </div>

        {searchError && (
          <p className="text-sm text-red-500 mb-3">{searchError}</p>
        )}

        {searchResults.length > 0 && (
          <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
            {searchResults.map((n) => (
              <div
                key={n.phone_number}
                className="flex items-center justify-between px-4 py-2.5 rounded-xl border"
                style={{ borderColor: 'rgb(var(--border-primary))', background: 'rgb(var(--bg-primary))' }}
              >
                <div>
                  <div className="font-medium text-sm">{formatPhone(n.phone_number)}</div>
                  <div className="text-xs text-muted">
                    {[n.locality, n.region].filter(Boolean).join(', ') || 'US number'}
                    {' · '}
                    {[n.cap_voice && 'Voice', n.cap_sms && 'SMS', n.cap_mms && 'MMS']
                      .filter(Boolean)
                      .join(', ')}
                  </div>
                </div>
                <button
                  onClick={() => handlePurchase(n.phone_number)}
                  disabled={purchasing === n.phone_number}
                  className="btn-primary py-1.5 px-3 text-xs disabled:opacity-60"
                >
                  {purchasing === n.phone_number ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : 'Purchase'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {pendingAssign && (
        <Modal title="Confirm Assignment" onClose={() => setPendingAssign(null)}>
          <p className="text-sm text-muted mb-5">
            {pendingAssign.userId
              ? <>Assign <strong>{formatPhone(pendingAssign.phone)}</strong> to <strong>{pendingAssign.userName}</strong>?</>
              : <>Unassign <strong>{formatPhone(pendingAssign.phone)}</strong>?</>}
          </p>
          <div className="flex gap-3">
            <button
              onClick={() => setPendingAssign(null)}
              className="flex-1 btn-ghost surface-tertiary py-2.5 text-sm"
            >
              Cancel
            </button>
            <button
              onClick={confirmAssign}
              className="flex-1 btn-primary py-2.5 text-sm"
            >
              Confirm
            </button>
          </div>
        </Modal>
      )}

      {/* Inventory */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-display font-semibold text-sm">
            Number Inventory
            <span className="ml-2 text-xs font-normal text-muted">({(numbers || []).length} total)</span>
          </h3>
          <button
            onClick={handleSync}
            disabled={syncing}
            className="flex items-center gap-1.5 text-xs text-muted hover:text-primary transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
            Sync from Telnyx
          </button>
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="w-7 h-7 animate-spin text-muted" />
          </div>
        ) : (numbers || []).length === 0 ? (
          <div className="text-center py-12 text-muted text-sm rounded-xl border border-dashed" style={{ borderColor: 'rgb(var(--border-primary))' }}>
            No numbers in inventory. Search and purchase above, or sync from Telnyx.
          </div>
        ) : (
          <div className="rounded-xl overflow-hidden border" style={{ borderColor: 'rgb(var(--border-primary))' }}>
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: 'rgb(var(--bg-tertiary))' }}>
                  {['Phone Number', 'Capabilities', 'Assigned To', 'Purchased', 'Actions'].map((h) => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-muted uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {numbers.map((n) => (
                  <tr
                    key={n.id}
                    className="border-t transition-colors hover:surface-secondary"
                    style={{ borderColor: 'rgb(var(--border-primary))' }}
                  >
                    <td className="px-4 py-3">
                      <div className="font-medium font-mono">{formatPhone(n.phone_number)}</div>
                      <div className="text-xs text-muted">{n.friendly_name}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1 flex-wrap">
                        {n.cap_voice && <span className="text-[11px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-700">Voice</span>}
                        {n.cap_sms   && <span className="text-[11px] px-1.5 py-0.5 rounded bg-green-100 text-green-700">SMS</span>}
                        {n.cap_mms   && <span className="text-[11px] px-1.5 py-0.5 rounded bg-purple-100 text-purple-700">MMS</span>}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <select
                        className="input text-sm py-1.5 max-w-[180px]"
                        value={n.assigned_to_user_id || ''}
                        onChange={(e) => {
                          const userId = e.target.value;
                          const newUser = (users || []).find((u) => u.id === parseInt(userId));
                          setPendingAssign({
                            numberId: n.id,
                            userId,
                            phone: n.phone_number,
                            userName: newUser?.name || 'this user',
                          });
                        }}
                      >
                        <option value="">Unassigned</option>
                        {(users || []).filter(u => u.role === 'user').map((u) => (
                          <option key={u.id} value={u.id}>{u.name}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted">
                      {new Date(n.purchased_at).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => handleRelease(n.id)}
                        title="Release number"
                        className="p-1.5 rounded-lg hover:surface-tertiary transition-colors text-muted hover:text-red-500"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main AdminPage ───────────────────────────────────────────────────────────

export default function AdminPage() {
  const [tab, setTab] = useState('users');
  const [users, setUsers] = useState([]);
  const [numbers, setNumbers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [u, n] = await Promise.all([adminApi.listUsers(), adminApi.listNumbers()]);
      setUsers(u);
      setNumbers(n);
    } catch (err) {
      setLoadError(err.response?.data?.detail || 'Failed to load admin data. Please refresh.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const TABS = [
    { id: 'users',   label: 'Users',         Icon: Users,  count: users.length },
    { id: 'numbers', label: 'Phone Numbers',  Icon: Phone,  count: numbers.length },
  ];

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-6xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-display font-bold mb-1">Admin Panel</h1>
          <p className="text-sm text-muted">Manage users, roles, departments, and Telnyx phone number assignments.</p>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-6 p-1 rounded-xl w-fit" style={{ background: 'linear-gradient(135deg, #07438C 0%, #1C94AE 100%)' }}>
          {TABS.map(({ id, label, Icon, count }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium transition-all duration-200"
              style={{
                background: tab === id ? 'rgba(255,255,255,0.95)' : 'transparent',
                color: tab === id ? '#07438C' : 'rgba(255,255,255,0.85)',
                boxShadow: tab === id ? '0 2px 8px rgba(0,0,0,0.12)' : 'none',
              }}
            >
              <Icon className="w-4 h-4" />
              {label}
              <span
                className="px-1.5 py-0.5 rounded-full text-[11px] font-semibold"
                style={{
                  background: tab === id ? 'rgba(7,67,140,0.12)' : 'rgba(255,255,255,0.2)',
                  color: tab === id ? '#07438C' : 'rgba(255,255,255,0.9)',
                }}
              >
                {count}
              </span>
            </button>
          ))}
        </div>

        {/* Load error */}
        {loadError && (
          <div className="mb-6 px-4 py-3 rounded-xl text-sm bg-red-500/10 text-red-500 border border-red-500/20 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            {loadError}
            <button onClick={loadData} className="ml-auto text-xs underline">Retry</button>
          </div>
        )}

        {/* Tab content */}
        {tab === 'users' && (
          <UsersTab users={users} loading={loading} onRefresh={loadData} />
        )}
        {tab === 'numbers' && (
          <NumbersTab numbers={numbers} users={users} loading={loading} onRefresh={loadData} />
        )}
      </div>
    </div>
  );
}
