import { createContext, useContext, useEffect, useState } from 'react';
import { authApi } from '../services/api';

const AuthContext = createContext(null);

const SESSION_CHECK_INTERVAL = 30_000; // 30 seconds

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

  // Periodic heartbeat — detects deactivation within 30 s.
  // If the user is deactivated, /api/auth/me returns 401 and the
  // api.js interceptor clears the token and redirects to /login.
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

  const login = async (email, password) => {
    const data = await authApi.login(email, password);
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
