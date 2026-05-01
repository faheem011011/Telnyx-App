import { useState, useEffect, Component } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import api from './services/api';
import { TwilioProvider } from './context/TwilioContext';
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

class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
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
            {this.state.error?.message || 'An unexpected error occurred.'}
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

  return (
    <TwilioProvider>
      <div className="flex h-screen w-screen overflow-hidden">
        <Sidebar onOpenDialer={() => setDialerOpen(true)} />
        <main className="flex-1 flex flex-col overflow-hidden">
          <Routes>
            <Route path="/inbox" element={<InboxPage />} />
            <Route path="/contacts" element={<ContactsPage />} />
            <Route path="/messages" element={<MessagesPage />} />
            <Route path="/messages/:phoneNumber" element={<MessagesPage />} />
            <Route path="/scheduled" element={<ComingSoon title="Scheduled" />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/inbox" replace />} />
          </Routes>
        </main>
        {dialerOpen && <Dialer onClose={() => setDialerOpen(false)} />}
        <IncomingCallModal />
        <ActiveCallPanel />
      </div>
    </TwilioProvider>
  );
}

function AdminLayout() {
  const [dialerOpen, setDialerOpen] = useState(false);

  return (
    <TwilioProvider>
      <div className="flex h-screen w-screen overflow-hidden">
        <Sidebar onOpenDialer={() => setDialerOpen(true)} />
        <main className="flex-1 flex flex-col overflow-hidden">
          <Routes>
            <Route path="/analytics" element={<DashboardPage />} />
            <Route path="/admin" element={<AdminPage />} />
            <Route path="/inbox" element={<InboxPage />} />
            <Route path="/contacts" element={<ContactsPage />} />
            <Route path="/messages" element={<MessagesPage />} />
            <Route path="/messages/:phoneNumber" element={<MessagesPage />} />
            <Route path="/scheduled" element={<ComingSoon title="Scheduled" />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/analytics" replace />} />
          </Routes>
        </main>
        {dialerOpen && <Dialer onClose={() => setDialerOpen(false)} />}
        <IncomingCallModal />
        <ActiveCallPanel />
      </div>
    </TwilioProvider>
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
            ) : user.role === 'admin' ? (
              <AdminLayout />
            ) : (
              <UserLayout />
            )
          }
        />
      </Routes>
    </ErrorBoundary>
  );
}
