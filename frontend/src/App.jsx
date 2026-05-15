import { useState, useEffect, useCallback, useRef, Component } from 'react';
import { Routes, Route, Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import api from './services/api';
import { TelnyxProvider } from './context/TelnyxContext';
import Sidebar from './components/Sidebar';
import Dialer from './components/Dialer';
import IncomingCallModal from './components/IncomingCallModal';
import ActiveCallPanel from './components/ActiveCallPanel';
import LoginPage from './pages/LoginPage';
import ForgotPasswordPage from './pages/ForgotPasswordPage';
import ResetPasswordPage from './pages/ResetPasswordPage';
import SetupPage from './pages/SetupPage';
import VerifyEmailPage from './pages/VerifyEmailPage';
import InboxPage from './pages/InboxPage';
import ContactsPage from './pages/ContactsPage';
import MessagesPage from './pages/MessagesPage';
import SettingsPage from './pages/SettingsPage';
import DashboardPage from './pages/DashboardPage';
import AdminPage from './pages/AdminPage';
import RouteErrorBoundary from './components/RouteErrorBoundary';

class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    // L-14: do NOT capture error.message into state — it would render to the
    // user and could leak internal details. Devs see it via componentDidCatch.
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    // Devs only — never surface to UI. Wire to a remote logger if/when added.
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary] caught', error, info?.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex flex-col items-center justify-center p-8 text-center">
          <div className="w-16 h-16 rounded-full bg-red-500/10 flex items-center justify-center mb-4">
            <span className="text-2xl">⚠</span>
          </div>
          <h2 className="text-lg font-display font-semibold mb-2">Something went wrong</h2>
          <p className="text-sm text-muted mb-4 max-w-sm">
            An unexpected error occurred. Please reload the page to try again.
          </p>
          <button
            onClick={() => window.location.reload()}
            className="btn-primary py-2 text-sm"
          >
            Reload page
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function UserLayout() {
  const [dialerOpen, setDialerOpen] = useState(false);
  const location = useLocation();

  return (
    <div className="flex h-screen w-screen overflow-hidden">
      <Sidebar onOpenDialer={() => setDialerOpen(true)} />
      <main className="flex-1 flex flex-col overflow-hidden">
        <Routes>
          {/* Layout route: one boundary per pathname — auto-resets on navigation */}
          <Route
            element={
              <RouteErrorBoundary key={location.pathname}>
                <Outlet />
              </RouteErrorBoundary>
            }
          >
            <Route path="/inbox" element={<InboxPage />} />
            <Route path="/contacts" element={<ContactsPage />} />
            <Route path="/messages" element={<MessagesPage />} />
            <Route path="/messages/:phoneNumber" element={<MessagesPage />} />
            <Route path="/scheduled" element={<ComingSoon title="Scheduled" />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/inbox" replace />} />
          </Route>
        </Routes>
      </main>
      {dialerOpen && <Dialer onClose={() => setDialerOpen(false)} />}
      <IncomingCallModal />
      <ActiveCallPanel />
    </div>
  );
}

function AdminLayout() {
  const [dialerOpen, setDialerOpen] = useState(false);
  const location = useLocation();

  return (
    <div className="flex h-screen w-screen overflow-hidden">
      <Sidebar onOpenDialer={() => setDialerOpen(true)} />
      <main className="flex-1 flex flex-col overflow-hidden">
        <Routes>
          {/* Layout route: one boundary per pathname — auto-resets on navigation */}
          <Route
            element={
              <RouteErrorBoundary key={location.pathname}>
                <Outlet />
              </RouteErrorBoundary>
            }
          >
            <Route path="/analytics" element={<DashboardPage />} />
            <Route path="/admin" element={<AdminPage />} />
            <Route path="/inbox" element={<InboxPage />} />
            <Route path="/contacts" element={<ContactsPage />} />
            <Route path="/messages" element={<MessagesPage />} />
            <Route path="/messages/:phoneNumber" element={<MessagesPage />} />
            <Route path="/scheduled" element={<ComingSoon title="Scheduled" />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/analytics" replace />} />
          </Route>
        </Routes>
      </main>
      {dialerOpen && <Dialer onClose={() => setDialerOpen(false)} />}
      <IncomingCallModal />
      <ActiveCallPanel />
    </div>
  );
}

// AuthenticatedShell wraps both user and admin layouts in a single
// <TelnyxProvider> instance so the SDK does NOT remount when the user
// navigates between routes (or when the role-based layout switches).
// This prevents in-progress calls from dropping due to provider unmount.
function AuthenticatedShell({ user }) {
  const { logout } = useAuth();
  const timerRef = useRef(null);
  const IDLE_MS = 30 * 60 * 1000; // 30 minutes

  const resetTimer = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(logout, IDLE_MS);
  }, [logout]);

  useEffect(() => {
    const events = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'];
    events.forEach((e) => window.addEventListener(e, resetTimer, { passive: true }));
    resetTimer();
    return () => {
      events.forEach((e) => window.removeEventListener(e, resetTimer));
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [resetTimer]);

  return (
    <TelnyxProvider>
      {user.role === 'admin' ? <AdminLayout /> : <UserLayout />}
    </TelnyxProvider>
  );
}

function ComingSoon({ title }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-center p-8 surface">
      <div className="w-16 h-16 rounded-full surface-tertiary flex items-center justify-center mb-4">
        <span className="text-2xl">🚧</span>
      </div>
      <h3 className="font-display font-semibold text-lg">{title}</h3>
      <p className="text-sm text-muted mt-1 max-w-xs">This section is coming in a future release.</p>
    </div>
  );
}

function RedirectToLoginOrSetup() {
  const [target, setTarget] = useState(null);

  useEffect(() => {
    api.get('/api/auth/setup')
      .then(() => setTarget('/setup'))
      .catch(() => setTarget('/login'));
  }, []);

  if (!target) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-10 h-10 rounded-full border-2 border-brand-600 border-t-transparent animate-spin" />
      </div>
    );
  }
  return <Navigate to={target} replace />;
}

export default function App() {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-10 h-10 rounded-full border-2 border-brand-600 border-t-transparent animate-spin" />
      </div>
    );
  }

  const defaultPath = user?.role === 'admin' ? '/analytics' : '/inbox';

  return (
    <ErrorBoundary>
      <Routes>
        <Route
          path="/login"
          element={user ? <Navigate to={defaultPath} replace /> : <LoginPage />}
        />
        <Route path="/setup" element={<SetupPage />} />
        <Route path="/verify-email" element={<VerifyEmailPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route
          path="/*"
          element={
            !user ? (
              <RedirectToLoginOrSetup />
            ) : (
              <AuthenticatedShell user={user} />
            )
          }
        />
      </Routes>
    </ErrorBoundary>
  );
}
