import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Users, Phone, Plus, Search, Trash2, Edit2, X, Check,
  RefreshCw, UserCheck, PhoneCall, Shield, UserCircle,
  Building2, ChevronDown, Loader2, AlertCircle, MailCheck,
  Eye, EyeOff, ClipboardList, ChevronLeft, ChevronRight,
} from 'lucide-react';
import { adminApi } from '../services/api';
import { useDepartments } from '../hooks/useDepartments';
import Avatar from '../components/Avatar';
import { formatPhone } from '../utils/format';
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

function UserForm({ form, setForm, actionError, actionLoading, onCancel, onSubmit, submitLabel, isEdit = false, departments = [] }) {
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
          {departments.map((d) => (
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
  const { departmentNames: departments } = useDepartments();
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
      setActionError(formatApiError(err, 'Failed to update user status. Please try again.'));
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
        {['', ...departments].map((d) => (
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
            departments={departments}
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
            departments={departments}
          />
        </Modal>
      )}

      {deleteUser && (
        <Modal title="Delete User" onClose={() => setDeleteUser(null)}>
          <p className="text-sm text-muted mb-5">
            This will deactivate <strong>{deleteUser.name}</strong>'s account and prevent them from signing in. Their call history and data are retained and remain visible in audit logs.
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
  const [pendingAssign,   setPendingAssign]   = useState(null); // { numberId, userId, phone, userName }
  const [pendingRelease,  setPendingRelease]  = useState(null); // number row object
  const [releaseLoading,  setReleaseLoading]  = useState(false);

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

  const confirmRelease = async () => {
    setReleaseLoading(true);
    try {
      await adminApi.releaseNumber(pendingRelease.id);
      setPendingRelease(null);
      onRefresh();
    } catch (err) {
      setActionError(err.response?.data?.detail || 'Release failed');
      setPendingRelease(null);
    } finally {
      setReleaseLoading(false);
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

      {pendingRelease && (
        <Modal title="Release Number" onClose={() => !releaseLoading && setPendingRelease(null)}>
          <div className="flex flex-col items-center text-center mb-5 gap-3">
            <div className="w-12 h-12 rounded-full bg-red-500/10 flex items-center justify-center flex-shrink-0">
              <AlertCircle className="w-6 h-6 text-red-500" />
            </div>
            <div>
              <p className="font-semibold text-sm mb-1">{formatPhone(pendingRelease.phone_number)}</p>
              <p className="text-sm text-muted leading-relaxed">
                This will permanently release this number from your Telnyx account.
                Any calls or messages routed to it will stop working immediately.
              </p>
              <p className="text-sm font-semibold mt-2">This cannot be undone.</p>
            </div>
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => setPendingRelease(null)}
              disabled={releaseLoading}
              className="flex-1 btn-ghost surface-tertiary py-2.5 text-sm disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              onClick={confirmRelease}
              disabled={releaseLoading}
              className="flex-1 py-2.5 text-sm font-medium rounded-xl bg-red-500 text-white hover:bg-red-600 transition-colors disabled:opacity-60"
            >
              {releaseLoading ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : 'Release Number'}
            </button>
          </div>
        </Modal>
      )}

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
                        {(users || []).map((u) => (
                          <option key={u.id} value={u.id}>{u.name}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted">
                      {new Date(n.purchased_at).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => { setPendingRelease(n); setActionError(null); }}
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

// ─── DepartmentsTab ──────────────────────────────────────────────────────────

function DepartmentsTab() {
  const { departments, loading, refetch } = useDepartments();
  const [showCreate, setShowCreate]   = useState(false);
  const [newName, setNewName]         = useState('');
  const [editDept, setEditDept]       = useState(null);
  const [deleteDept, setDeleteDept]   = useState(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState(null);
  const [successMsg, setSuccessMsg]   = useState(null);

  const showSuccess = (msg) => {
    setSuccessMsg(msg);
    setTimeout(() => setSuccessMsg(null), 4000);
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!newName.trim()) return;
    setActionLoading(true);
    setActionError(null);
    try {
      await adminApi.createDepartment({ name: newName.trim() });
      setNewName('');
      setShowCreate(false);
      showSuccess(`Department "${newName.trim()}" created.`);
      refetch();
    } catch (err) {
      setActionError(formatApiError(err, 'Failed to create department'));
    } finally {
      setActionLoading(false);
    }
  };

  const handleUpdate = async (e) => {
    e.preventDefault();
    if (!editDept) return;
    setActionLoading(true);
    setActionError(null);
    try {
      await adminApi.updateDepartment(editDept.id, {
        name: editDept.name,
        is_active: editDept.is_active,
      });
      setEditDept(null);
      showSuccess('Department updated.');
      refetch();
    } catch (err) {
      setActionError(formatApiError(err, 'Failed to update department'));
    } finally {
      setActionLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteDept) return;
    setActionLoading(true);
    setActionError(null);
    try {
      await adminApi.deleteDepartment(deleteDept.id);
      setDeleteDept(null);
      showSuccess(`Department "${deleteDept.name}" deleted.`);
      refetch();
    } catch (err) {
      setActionError(formatApiError(err, 'Failed to delete department'));
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div>
      {successMsg && (
        <div className="mb-4 px-4 py-3 rounded-xl text-sm bg-green-500/10 text-green-700 border border-green-500/20 flex items-center gap-2">
          <Check className="w-4 h-4 flex-shrink-0" />
          {successMsg}
          <button onClick={() => setSuccessMsg(null)} className="ml-auto"><X className="w-4 h-4" /></button>
        </div>
      )}
      {actionError && !editDept && !deleteDept && (
        <div className="mb-4 px-4 py-3 rounded-xl text-sm bg-red-500/10 text-red-500 border border-red-500/20 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {actionError}
          <button onClick={() => setActionError(null)} className="ml-auto"><X className="w-4 h-4" /></button>
        </div>
      )}

      <div className="flex items-center justify-between mb-5">
        <p className="text-sm text-muted">
          Departments with active users cannot be deleted or deactivated.
        </p>
        <button
          onClick={() => { setShowCreate(true); setNewName(''); setActionError(null); }}
          className="btn-primary py-2.5 px-4 text-sm whitespace-nowrap"
        >
          <Plus className="w-4 h-4" />
          Add Department
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
                {['Department Name', 'Status', 'Actions'].map((h) => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-muted uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {departments.length === 0 ? (
                <tr>
                  <td colSpan={3} className="text-center py-12 text-muted text-sm">
                    No departments found. Add one above.
                  </td>
                </tr>
              ) : departments.map((d) => (
                <tr
                  key={d.id}
                  className="border-t transition-colors hover:surface-secondary"
                  style={{ borderColor: 'rgb(var(--border-primary))' }}
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Building2 className="w-4 h-4 text-muted" />
                      <span className="font-medium">{d.name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge active={d.is_active} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => { setEditDept({ ...d }); setActionError(null); }}
                        title="Edit department"
                        className="p-1.5 rounded-lg hover:surface-tertiary transition-colors text-muted hover:text-primary"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => { setDeleteDept(d); setActionError(null); }}
                        title="Delete department"
                        className="p-1.5 rounded-lg hover:surface-tertiary transition-colors text-muted hover:text-red-500"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Create modal */}
      {showCreate && (
        <Modal title="Add Department" onClose={() => { setShowCreate(false); setActionError(null); }}>
          <form onSubmit={handleCreate} className="space-y-4">
            <FormField label="Department Name" htmlFor="dept-name">
              <input
                id="dept-name"
                required
                autoFocus
                className="input"
                placeholder="e.g. Engineering"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
            </FormField>
            {actionError && (
              <div className="px-3 py-2.5 rounded-lg text-sm bg-red-500/10 text-red-500 border border-red-500/20 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" /> {actionError}
              </div>
            )}
            <div className="flex gap-3 pt-1">
              <button type="button" onClick={() => { setShowCreate(false); setActionError(null); }} className="flex-1 btn-ghost surface-tertiary py-2.5 text-sm">Cancel</button>
              <button type="submit" disabled={actionLoading || !newName.trim()} className="flex-1 btn-primary py-2.5 text-sm disabled:opacity-60">
                {actionLoading ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : 'Create'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Edit modal */}
      {editDept && (
        <Modal title="Edit Department" onClose={() => { setEditDept(null); setActionError(null); }}>
          <form onSubmit={handleUpdate} className="space-y-4">
            <FormField label="Department Name" htmlFor="edit-dept-name">
              <input
                id="edit-dept-name"
                required
                className="input"
                value={editDept.name}
                onChange={(e) => setEditDept((d) => ({ ...d, name: e.target.value }))}
              />
            </FormField>
            <div
              className="flex items-center justify-between py-2.5 px-3 rounded-lg"
              style={{ background: 'rgb(var(--bg-tertiary))' }}
            >
              <span className="text-sm font-medium">Active</span>
              <button
                type="button"
                onClick={() => setEditDept((d) => ({ ...d, is_active: !d.is_active }))}
                className={`relative w-10 h-5 rounded-full transition-colors ${editDept.is_active ? 'bg-brand-600' : 'bg-zinc-300'}`}
                style={{ background: editDept.is_active ? '#1454F6' : undefined }}
              >
                <span
                  className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform"
                  style={{ transform: editDept.is_active ? 'translateX(20px)' : 'translateX(2px)' }}
                />
              </button>
            </div>
            {actionError && (
              <div className="px-3 py-2.5 rounded-lg text-sm bg-red-500/10 text-red-500 border border-red-500/20 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" /> {actionError}
              </div>
            )}
            <div className="flex gap-3 pt-1">
              <button type="button" onClick={() => { setEditDept(null); setActionError(null); }} className="flex-1 btn-ghost surface-tertiary py-2.5 text-sm">Cancel</button>
              <button type="submit" disabled={actionLoading || !editDept.name.trim()} className="flex-1 btn-primary py-2.5 text-sm disabled:opacity-60">
                {actionLoading ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : 'Save Changes'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Delete modal */}
      {deleteDept && (
        <Modal title="Delete Department" onClose={() => { setDeleteDept(null); setActionError(null); }}>
          <p className="text-sm text-muted mb-5">
            Delete <strong>{deleteDept.name}</strong>? This cannot be undone.
            Departments with active users cannot be deleted.
          </p>
          {actionError && (
            <div className="mb-4 px-3 py-2.5 rounded-lg text-sm bg-red-500/10 text-red-500 border border-red-500/20">
              {actionError}
            </div>
          )}
          <div className="flex gap-3">
            <button onClick={() => { setDeleteDept(null); setActionError(null); }} className="flex-1 btn-ghost surface-tertiary py-2.5 text-sm">Cancel</button>
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

// ─── AuditLogsTab ────────────────────────────────────────────────────────────

const AUDIT_ACTIONS = [
  'user.create', 'user.update', 'user.delete', 'user.resend_verification',
  'number.sync', 'number.purchase', 'number.assign', 'number.unassign', 'number.release',
  'department.create', 'department.update', 'department.delete',
  'call.recording.start', 'call.recording.stop',
];

const ACTION_COLORS = {
  'user.create':              { bg: 'bg-green-500/10',  text: 'text-green-600' },
  'user.update':              { bg: 'bg-blue-500/10',   text: 'text-blue-600'  },
  'user.delete':              { bg: 'bg-red-500/10',    text: 'text-red-500'   },
  'user.resend_verification': { bg: 'bg-amber-500/10',  text: 'text-amber-600' },
  'number.sync':              { bg: 'bg-purple-500/10', text: 'text-purple-600'},
  'number.purchase':          { bg: 'bg-teal-500/10',   text: 'text-teal-600'  },
  'number.assign':            { bg: 'bg-indigo-500/10', text: 'text-indigo-600'},
  'number.unassign':          { bg: 'bg-orange-500/10', text: 'text-orange-600'},
  'number.release':           { bg: 'bg-red-500/10',    text: 'text-red-500'   },
  'department.create':        { bg: 'bg-green-500/10',  text: 'text-green-600' },
  'department.update':        { bg: 'bg-blue-500/10',   text: 'text-blue-600'  },
  'department.delete':        { bg: 'bg-red-500/10',    text: 'text-red-500'   },
  'call.recording.start':     { bg: 'bg-rose-500/10',   text: 'text-rose-600'  },
  'call.recording.stop':      { bg: 'bg-slate-500/10',  text: 'text-slate-600' },
};

function ActionBadge({ action }) {
  const c = ACTION_COLORS[action] || { bg: 'bg-zinc-100', text: 'text-zinc-600' };
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold ${c.bg} ${c.text}`}>
      {action}
    </span>
  );
}

const PAGE_SIZE = 25;

function AuditLogsTab() {
  const [logs, setLogs]           = useState([]);
  const [total, setTotal]         = useState(0);
  const [page, setPage]           = useState(0);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState(null);
  const [actionFilter, setAction] = useState('');
  const [emailFilter, setEmail]   = useState('');
  const [emailInput, setEmailInput] = useState('');
  const debounceRef = useRef(null);

  const fetch = useCallback(async (pg, action, email) => {
    setLoading(true);
    setError(null);
    try {
      const params = { limit: PAGE_SIZE, skip: pg * PAGE_SIZE };
      if (action) params.action = action;
      if (email)  params.actor_email = email;
      const data = await adminApi.listAuditLogs(params);
      setLogs(data.items);
      setTotal(data.total);
    } catch {
      setError('Failed to load audit logs.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetch(page, actionFilter, emailFilter);
  }, [fetch, page, actionFilter, emailFilter]);

  const handleActionChange = (e) => {
    setAction(e.target.value);
    setPage(0);
  };

  const handleEmailInput = (e) => {
    const val = e.target.value;
    setEmailInput(val);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setEmailFilter(val.trim());
      setPage(0);
    }, 400);
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const from = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const to   = Math.min(page * PAGE_SIZE + PAGE_SIZE, total);

  return (
    <div>
      {/* Filters */}
      <div className="flex items-center gap-3 mb-5 flex-wrap">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-faint" />
          <input
            className="input pl-9 w-56"
            placeholder="Filter by actor email…"
            value={emailInput}
            onChange={handleEmailInput}
          />
        </div>
        <select className="input w-52" value={actionFilter} onChange={handleActionChange}>
          <option value="">All actions</option>
          {AUDIT_ACTIONS.map((a) => (
            <option key={a} value={a}>{a}</option>
          ))}
        </select>
        <button
          onClick={() => { setAction(''); setEmail(''); setEmailInput(''); setPage(0); }}
          className="btn-ghost text-sm px-3 py-2"
          disabled={!actionFilter && !emailFilter}
        >
          <X className="w-3.5 h-3.5" /> Clear
        </button>
        <span className="ml-auto text-xs text-muted">
          {total > 0 ? `${from}–${to} of ${total.toLocaleString()}` : '0 entries'}
        </span>
      </div>

      {error && (
        <div className="mb-4 px-4 py-3 rounded-xl text-sm bg-red-500/10 text-red-500 border border-red-500/20 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 flex-shrink-0" /> {error}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="w-8 h-8 animate-spin text-muted" />
        </div>
      ) : logs.length === 0 ? (
        <div className="text-center py-16 text-sm text-muted">No audit log entries match your filters.</div>
      ) : (
        <div className="rounded-xl overflow-hidden border" style={{ borderColor: 'rgb(var(--border-primary))' }}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: 'rgb(var(--bg-tertiary))' }}>
                {['Timestamp', 'Actor', 'Action', 'Resource', 'IP'].map((h) => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-muted uppercase tracking-wide whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {logs.map((entry) => (
                <AuditRow key={entry.id} entry={entry} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      <div className="flex items-center justify-end gap-2 mt-4">
        <button
          onClick={() => setPage((p) => p - 1)}
          disabled={page === 0}
          className="p-1.5 rounded-lg hover:surface-tertiary transition-colors text-muted disabled:opacity-30"
          aria-label="Previous page"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <span className="text-xs text-muted px-1">Page {page + 1} / {totalPages}</span>
        <button
          onClick={() => setPage((p) => p + 1)}
          disabled={page >= totalPages - 1}
          className="p-1.5 rounded-lg hover:surface-tertiary transition-colors text-muted disabled:opacity-30"
          aria-label="Next page"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

function AuditRow({ entry }) {
  const [expanded, setExpanded] = useState(false);
  const ts = new Date(entry.created_at);
  const dateStr = ts.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  const timeStr = ts.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  return (
    <>
      <tr
        className="border-t transition-colors hover:surface-secondary cursor-pointer"
        style={{ borderColor: 'rgb(var(--border-primary))' }}
        onClick={() => setExpanded((v) => !v)}
      >
        <td className="px-4 py-3 whitespace-nowrap">
          <div className="text-xs font-medium">{dateStr}</div>
          <div className="text-[11px] text-muted">{timeStr}</div>
        </td>
        <td className="px-4 py-3">
          <div className="text-xs font-medium truncate max-w-[160px]">{entry.actor_email}</div>
          {entry.actor_id && (
            <div className="text-[11px] text-muted">id:{entry.actor_id}</div>
          )}
        </td>
        <td className="px-4 py-3">
          <ActionBadge action={entry.action} />
        </td>
        <td className="px-4 py-3">
          <div className="text-xs text-muted">{entry.resource_type}</div>
          {entry.resource_id && (
            <div className="text-[11px] text-muted font-mono truncate max-w-[120px]">{entry.resource_id}</div>
          )}
        </td>
        <td className="px-4 py-3 text-[11px] text-muted font-mono">{entry.ip_address || '—'}</td>
      </tr>
      {expanded && entry.detail && (
        <tr style={{ borderColor: 'rgb(var(--border-primary))' }} className="border-t">
          <td colSpan={5} className="px-4 py-3" style={{ background: 'rgb(var(--bg-secondary))' }}>
            <pre className="text-[11px] text-muted overflow-x-auto whitespace-pre-wrap break-words">
              {JSON.stringify(entry.detail, null, 2)}
            </pre>
          </td>
        </tr>
      )}
    </>
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
    { id: 'users',       label: 'Users',         Icon: Users,         count: users.length },
    { id: 'departments', label: 'Departments',    Icon: Building2,     count: null },
    { id: 'numbers',     label: 'Phone Numbers',  Icon: Phone,         count: numbers.length },
    { id: 'audit',       label: 'Audit Logs',     Icon: ClipboardList, count: null },
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
              {count !== null && (
                <span
                  className="px-1.5 py-0.5 rounded-full text-[11px] font-semibold"
                  style={{
                    background: tab === id ? 'rgba(7,67,140,0.12)' : 'rgba(255,255,255,0.2)',
                    color: tab === id ? '#07438C' : 'rgba(255,255,255,0.9)',
                  }}
                >
                  {count}
                </span>
              )}
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
        {tab === 'users'       && <UsersTab users={users} loading={loading} onRefresh={loadData} />}
        {tab === 'departments' && <DepartmentsTab />}
        {tab === 'numbers'     && <NumbersTab numbers={numbers} users={users} loading={loading} onRefresh={loadData} />}
        {tab === 'audit'       && <AuditLogsTab />}
      </div>
    </div>
  );
}
