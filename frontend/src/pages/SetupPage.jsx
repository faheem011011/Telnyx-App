import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AnimatedForm } from '../components/ui/AnimatedLogin';
import { authApi } from '../services/api';

export default function SetupPage() {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [checking, setChecking] = useState(true);
  const [alreadyDone, setAlreadyDone] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const [networkError, setNetworkError] = useState(false);

  useEffect(() => {
    const TIMEOUT_MS = 5000;
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('timeout')), TIMEOUT_MS)
    );

    let cancelled = false;
    Promise.race([authApi.checkSetup(), timeoutPromise])
      .then(() => { if (!cancelled) setChecking(false); })
      .catch((err) => {
        if (cancelled) return;
        if (err.response?.status === 410) setAlreadyDone(true);
        else if (err.message === 'timeout') setNetworkError(true);
        setChecking(false);
      });
    return () => { cancelled = true; };
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await authApi.setup(name, email, password);
      setEmailSent(true);
    } catch (err) {
      if (err.response?.status === 410) {
        setAlreadyDone(true);
      } else {
        setError(err.response?.data?.detail || 'Setup failed. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  const fields = [
    {
      id: 'name',
      label: 'Full Name',
      required: true,
      type: 'text',
      placeholder: 'Enter your full name',
      autoComplete: 'off',
      onChange: (e) => setName(e.target.value),
    },
    {
      id: 'email',
      label: 'Email',
      required: true,
      type: 'email',
      placeholder: 'Enter your email address',
      autoComplete: 'off',
      onChange: (e) => setEmail(e.target.value),
    },
    {
      id: 'password',
      label: 'Password',
      required: true,
      type: 'password',
      placeholder: 'At least 6 characters',
      autoComplete: 'off',
      onChange: (e) => setPassword(e.target.value),
    },
  ];

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 rounded-full border-2 border-[#07438C] border-t-transparent animate-spin" />
      </div>
    );
  }

  if (networkError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white px-6">
        <div className="text-center max-w-sm">
          <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-red-50 flex items-center justify-center">
            <svg className="w-8 h-8 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 5.636l-12.728 12.728M5.636 5.636l12.728 12.728" />
            </svg>
          </div>
          <h2 className="text-2xl font-display font-bold text-gray-900 mb-3">Cannot reach backend</h2>
          <p className="text-sm text-gray-500 mb-8 leading-relaxed">
            Cannot reach backend. Check your connection and reload.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="inline-block px-6 py-2.5 rounded-lg text-sm font-semibold text-white"
            style={{ background: 'linear-gradient(135deg, #07438C 0%, #1C94AE 100%)' }}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (alreadyDone) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white px-6">
        <div className="text-center max-w-sm">
          <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-amber-50 flex items-center justify-center">
            <svg className="w-8 h-8 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M12 3a9 9 0 100 18A9 9 0 0012 3z" />
            </svg>
          </div>
          <h2 className="text-2xl font-display font-bold text-gray-900 mb-3">Setup already complete</h2>
          <p className="text-sm text-gray-500 mb-8 leading-relaxed">
            An admin account already exists. Additional admins can be created through the Admin Panel after logging in.
          </p>
          <Link
            to="/login"
            className="inline-block px-6 py-2.5 rounded-lg text-sm font-semibold text-white"
            style={{ background: 'linear-gradient(135deg, #07438C 0%, #1C94AE 100%)' }}
          >
            Go to sign in
          </Link>
        </div>
      </div>
    );
  }

  if (emailSent) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white px-6">
        <div className="text-center max-w-sm">
          <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-blue-50 flex items-center justify-center">
            <svg className="w-8 h-8 text-[#07438C]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          </div>
          <h2 className="text-2xl font-display font-bold text-gray-900 mb-3">Check your inbox</h2>
          <p className="text-sm text-gray-500 mb-2 leading-relaxed">
            A verification link has been sent to
          </p>
          <p className="text-sm font-semibold text-gray-800 mb-8">{email}</p>
          <p className="text-xs text-gray-400 mb-6">Click the link in that email to activate your account, then sign in.</p>
          <Link
            to="/login"
            className="inline-block px-6 py-2.5 rounded-lg text-sm font-semibold text-white"
            style={{ background: 'linear-gradient(135deg, #07438C 0%, #1C94AE 100%)' }}
          >
            Go to sign in
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen">
      {/* Left panel */}
      <div className="hidden lg:block w-1/2 relative">
        <img src="/login-side.png" alt="" className="absolute inset-0 w-full h-full object-cover" />
      </div>

      {/* Right panel */}
      <div className="flex w-full lg:w-1/2 min-h-screen flex-col items-center justify-center px-8 py-12 bg-white">
        <div className="mb-8 flex flex-col items-center gap-2 lg:hidden">
          <img src="/logo.png" alt="AlphaCall" className="w-14 h-14 rounded-2xl shadow-lg shadow-blue-500/20" />
          <span className="text-xl font-display font-bold">AlphaCall</span>
        </div>

        <AnimatedForm
          logo="/loginLogo.png"
          header="Create first admin"
          subHeader="This page is only available once, when no users exists!"
          fields={fields}
          submitButton={loading ? 'Creating account…' : 'Create admin account'}
          submitDisabled={loading}
          errorField={error}
          onSubmit={handleSubmit}
          footerNote={
            <Link to="/login" className="text-sm font-medium text-[#07438C] hover:underline">
              ← Back to sign in
            </Link>
          }
        />
      </div>
    </div>
  );
}
