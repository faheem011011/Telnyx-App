import axios from 'axios';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000';

const api = axios.create({
  baseURL: API_BASE,
  headers: { 'Content-Type': 'application/json' },
  timeout: 15000,
});

// Attach JWT on every request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('auth_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// On 401, clear token and reload
api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('auth_token');
      if (window.location.pathname !== '/login') {
        window.location.href = '/login';
      }
    }
    return Promise.reject(err);
  }
);

// ============================================================
// Auth
// ============================================================
export const authApi = {
  login: (email, password) =>
    api.post('/api/auth/login', { email, password }).then((r) => r.data),
  me: () => api.get('/api/auth/me').then((r) => r.data),
  logout: () => api.post('/api/auth/logout').catch(() => {}),
  forgotPassword: (email) =>
    api.post('/api/auth/forgot-password', { email }).then((r) => r.data),
  resetPassword: (token, new_password) =>
    api.post('/api/auth/reset-password', { token, new_password }).then((r) => r.data),
  checkSetup: () => api.get('/api/auth/setup').then((r) => r.data),
  setup: (name, email, password) =>
    api.post('/api/auth/setup', { name, email, password }).then((r) => r.data),
  verifyEmail: (token) =>
    api.get('/api/auth/verify-email', { params: { token } }).then((r) => r.data),
};

// ============================================================
// Calls
// ============================================================
export const callsApi = {
  getToken: () => api.get('/api/calls/token').then((r) => r.data),
  list: (filter = 'all', search = '') =>
    api.get('/api/calls', { params: { filter, search: search || undefined } }).then((r) => r.data),
  get: (id) => api.get(`/api/calls/${id}`).then((r) => r.data),
  unreadCount: () => api.get('/api/calls/unread-count').then((r) => r.data),
  update: (id, data) => api.patch(`/api/calls/${id}`, data).then((r) => r.data),
  markAllRead: () => api.post('/api/calls/mark-all-read').then((r) => r.data),
  remove: (id) => api.delete(`/api/calls/${id}`).then((r) => r.data),
  startRecording: () =>
    api.post('/api/calls/recording/start').then((r) => r.data),
  stopRecording: () =>
    api.post('/api/calls/recording/stop').then((r) => r.data),
};

// ============================================================
// Contacts
// ============================================================
export const contactsApi = {
  list: (search = '', favoritesOnly = false) =>
    api
      .get('/api/contacts', { params: { search, favorites_only: favoritesOnly } })
      .then((r) => r.data),
  get: (id) => api.get(`/api/contacts/${id}`).then((r) => r.data),
  create: (data) => api.post('/api/contacts', data).then((r) => r.data),
  update: (id, data) => api.patch(`/api/contacts/${id}`, data).then((r) => r.data),
  remove: (id) => api.delete(`/api/contacts/${id}`).then((r) => r.data),
};

// ============================================================
// Messages
// ============================================================
export const messagesApi = {
  conversations: () => api.get('/api/messages/conversations').then((r) => r.data),
  thread: (phoneNumber) =>
    api.get(`/api/messages/thread/${encodeURIComponent(phoneNumber)}`).then((r) => r.data),
  send: (toNumber, body) =>
    api.post('/api/messages/send', { to_number: toNumber, body }).then((r) => r.data),
  deleteThread: (phoneNumber) =>
    api.delete(`/api/messages/thread/${encodeURIComponent(phoneNumber)}`).then((r) => r.data),
};

// ============================================================
// Analytics
// ============================================================
// Minutes east of UTC (e.g. +300 for Pakistan UTC+5)
const _utcOffset = () => -new Date().getTimezoneOffset();

export const analyticsApi = {
  get: (params = {}) =>
    api.get('/api/analytics', { params: { utc_offset: _utcOffset(), ...params } }).then((r) => r.data),
  usersSummary: (params = {}) =>
    api.get('/api/analytics/users-summary', { params: { utc_offset: _utcOffset(), ...params } }).then((r) => r.data),
};

// ============================================================
// Admin
// ============================================================
export const adminApi = {
  // Users
  listUsers: () => api.get('/api/admin/users').then((r) => r.data),
  createUser: (data) => api.post('/api/admin/users', data).then((r) => r.data),
  updateUser: (id, data) => api.patch(`/api/admin/users/${id}`, data).then((r) => r.data),
  deleteUser: (id) => api.delete(`/api/admin/users/${id}`).then((r) => r.data),
  resendVerification: (id) => api.post(`/api/admin/users/${id}/resend-verification`).then((r) => r.data),

  // Numbers
  listNumbers: () => api.get('/api/admin/numbers').then((r) => r.data),
  syncNumbers: () => api.post('/api/admin/numbers/sync').then((r) => r.data),
  searchNumbers: (params) =>
    api.get('/api/admin/numbers/search', { params }).then((r) => r.data),
  purchaseNumber: (phoneNumber) =>
    api.post('/api/admin/numbers/purchase', { phone_number: phoneNumber }).then((r) => r.data),
  assignNumber: (numberId, userId) =>
    api.post(`/api/admin/numbers/${numberId}/assign`, { user_id: userId }).then((r) => r.data),
  unassignNumber: (numberId) =>
    api.post(`/api/admin/numbers/${numberId}/unassign`).then((r) => r.data),
  releaseNumber: (numberId) => api.delete(`/api/admin/numbers/${numberId}`).then((r) => r.data),
};

export default api;
