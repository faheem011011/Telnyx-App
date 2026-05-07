import { createContext, useContext, useEffect, useState } from 'react';
import { authApi } from '../services/api';

const AuthContext = createContext(null);

// L-13: 5 min instead of 30 s — server-side deactivation propagation is now
// eventually-consistent within 5 min. The authoritative revocation mechanism
// is the JWT `tv` (token_version) claim — bumping it on the user row forces
// re-login on the very next request regardless of polling cadence (see H-03).
const SESSION_CHECK_INTERVAL = 5 * 60 * 1000;

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // Initial session restore on mount
  useEffect(() => {
    const token = localStorage.getItem('auth_token');
    if (!token) {
      setLoading(false);
      return;
    }
    authApi
      .me()
      .then(setUser)
      .catch(() => localStorage.removeItem('auth_token'))
      .finally(() => setLoading(false));
  }, []);

  // Periodic heartbeat — detects deactivation within ~5 min (L-13).
  // If the user is deactivated or token_version is bumped, /api/auth/me
  // returns 401 and the api.js interceptor clears the token and redirects
  // to /login. Even with the relaxed cadence, immediate revocation is
  // available server-side via token_version bumps (H-03).
  useEffect(() => {
    if (!user) return;
    const id = setInterval(async () => {
      try {
        const updated = await authApi.me();
        setUser(updated); // keeps role / profile data fresh
      } catch {
        // 401 interceptor handles token clear + redirect
      }
    }, SESSION_CHECK_INTERVAL);
    return () => clearInterval(id);
  }, [user]);

  // Cross-tab logout: if the auth_token is removed in another tab
  // (e.g. user clicked Logout there), log this tab out as well so
  // we don't leave authenticated UI orphaned in a second window.
  // Note: the 'storage' event only fires in OTHER tabs — never in the
  // tab that performed the change, so this won't recursively redirect.
  useEffect(() => {
    const handleStorage = (e) => {
      if (e.key === 'auth_token' && !e.newValue) {
        // Token cleared in another tab — log out here too
        setUser(null);
        window.location.href = '/login';
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  const login = async (email, password) => {
    const data = await authApi.login(email, password);
    // ── KNOWN RISK: localStorage is XSS-readable ────────────────────────────
    // Storing the JWT in localStorage means any successful XSS injection
    // can exfiltrate the token. This is an accepted trade-off for now,
    // pending a Phase 2 migration to HttpOnly + Secure + SameSite=Strict
    // cookies (which would require backend changes — server-set cookie on
    // /api/auth/login, CSRF protection, and a same-site/proxied frontend).
    // Mitigations currently in place:
    //   1. Strict CSP in main.py blocks inline/external script execution.
    //   2. 24h JWT lifetime caps blast radius.
    //   3. Cross-tab 'storage' listener below propagates logout.
    //   4. /api/auth/me heartbeat detects server-side deactivation in ≤5 min;
    //      token_version bumps on the user row force re-login on next request.
    // ────────────────────────────────────────────────────────────────────────
    localStorage.setItem('auth_token', data.access_token);
    setUser(data.user);
    return data.user;
  };

  const logout = async () => {
    await authApi.logout();
    localStorage.removeItem('auth_token');
    setUser(null);
    window.location.href = '/login';
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
};
