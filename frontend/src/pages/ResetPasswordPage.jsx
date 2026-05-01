import { useState, useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AnimatedForm } from '../components/ui/AnimatedLogin';
import { authApi } from '../services/api';

export default function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const token = searchParams.get('token');

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!token) {
      navigate('/login', { replace: true });
    }
  }, [token, navigate]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (password !== confirm) {
      setError('Passwords do not match');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      await authApi.resetPassword(token, password);
      setDone(true);
    } catch (err) {
      setError(err.response?.data?.detail || 'This reset link is invalid or has expired.');
    } finally {
      setLoading(false);
    }
  };

  const fields = [
    {
      id: 'password',
      label: 'New password',
      required: true,
      type: 'password',
      placeholder: 'At least 6 characters',
      autoComplete: 'new-password',
      onChange: (e) => setPassword(e.target.value),
    },
    {
      id: 'confirm',
      label: 'Confirm new password',
      required: true,
      type: 'password',
      placeholder: 'Repeat your new password',
      autoComplete: 'new-password',
      onChange: (e) => setConfirm(e.target.value),
    },
  ];

  return (
    <div className="flex min-h-screen">
      {/* Left panel */}
      <div className="hidden lg:block w-1/2 relative">
        <img
          src="/login-side.png"
          alt=""
          className="absolute inset-0 w-full h-full object-cover"
        />
      </div>

      {/* Right panel */}
      <div className="flex w-full lg:w-1/2 min-h-screen flex-col items-center justify-center px-8 py-12 bg-white">
        {/* Mobile logo */}
        <div className="mb-8 flex flex-col items-center gap-2 lg:hidden">
          <img
            src="/logo.png"
            alt="AlphaCall"
            className="w-14 h-14 rounded-2xl shadow-lg shadow-blue-500/20"
          />
          <span className="text-xl font-display font-bold">AlphaCall</span>
        </div>

        {done ? (
          <div className="w-full max-w-sm text-center">
            <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-green-50 flex items-center justify-center">
              <svg className="w-8 h-8 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h2 className="text-2xl font-display font-bold text-gray-900 mb-3">Password updated</h2>
            <p className="text-sm text-gray-500 mb-8 leading-relaxed">
              Your password has been reset successfully. You can now sign in with your new password.
            </p>
            <Link
              to="/login"
              className="inline-block px-6 py-2.5 rounded-lg text-sm font-semibold text-white"
              style={{ background: 'linear-gradient(135deg, #07438C 0%, #1C94AE 100%)' }}
            >
              Sign in
            </Link>
          </div>
        ) : (
          <AnimatedForm
            logo="/loginLogo.png"
            header="Set new password"
            subHeader="Choose a strong password for your account"
            fields={fields}
            submitButton={loading ? 'Saving…' : 'Set new password'}
            submitDisabled={loading}
            errorField={error}
            onSubmit={handleSubmit}
            footerNote={
              <Link to="/login" className="text-sm font-medium text-[#07438C] hover:underline">
                ← Back to sign in
              </Link>
            }
          />
        )}
      </div>
    </div>
  );
}
