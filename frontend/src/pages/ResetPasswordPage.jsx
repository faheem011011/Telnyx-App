import { useState, useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Eye, EyeOff } from 'lucide-react';
import { AnimatedInput, AnimatedLabel } from '../components/ui/AnimatedLogin';
import { authApi } from '../services/api';

function _strength(pw) {
  if (!pw) return 0;
  let s = 0;
  if (pw.length >= 8)  s++;
  if (pw.length >= 12) s++;
  if (/[A-Z]/.test(pw) && /[0-9]/.test(pw)) s++;
  if (/[^A-Za-z0-9]/.test(pw)) s++;
  return s;
}

const _STRENGTH_LABEL = ['', 'Weak', 'Fair', 'Good', 'Strong'];
const _STRENGTH_TEXT  = ['', 'text-red-500', 'text-orange-400', 'text-yellow-500', 'text-green-500'];
const _STRENGTH_BAR   = ['', 'bg-red-500',   'bg-orange-400',   'bg-yellow-400',   'bg-green-500'];

export default function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get('token');

  const [password,     setPassword]     = useState('');
  const [confirm,      setConfirm]      = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm,  setShowConfirm]  = useState(false);
  const [loading,      setLoading]      = useState(false);
  const [error,        setError]        = useState(null);
  const [done,         setDone]         = useState(false);

  useEffect(() => {
    if (!token) navigate('/login', { replace: true });
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

  const strength = _strength(password);

  return (
    <div className="flex min-h-screen">
      {/* Left panel */}
      <div className="hidden lg:block w-1/2 relative">
        <img src="/login-side.png" alt="" className="absolute inset-0 w-full h-full object-cover" />
      </div>

      {/* Right panel */}
      <div className="flex w-full lg:w-1/2 min-h-screen flex-col items-center justify-center px-8 py-12 bg-white">
        {/* Mobile logo */}
        <div className="mb-8 flex flex-col items-center gap-2 lg:hidden">
          <img src="/logo.png" alt="AlphaCall" className="w-14 h-14 rounded-2xl shadow-lg shadow-blue-500/20" />
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
          <section className="flex flex-col gap-4 w-full max-w-sm mx-auto">
            <div className="hidden lg:flex justify-center mb-1">
              <img src="/loginLogo.png" alt="App logo" className="h-16 w-auto object-contain" />
            </div>
            <h2 className="font-bold text-3xl text-neutral-800">Set new password</h2>
            <p className="text-neutral-500 text-sm">Choose a strong password for your account</p>

            <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
              {/* New password */}
              <div className="flex flex-col gap-1.5">
                <AnimatedLabel htmlFor="password">
                  New password <span className="text-red-500 ml-0.5">*</span>
                </AnimatedLabel>
                <div className="relative">
                  <AnimatedInput
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    placeholder="At least 12 chars (A-z, 0-9, special)"
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute inset-y-0 right-0 pr-3 flex items-center text-neutral-400 hover:text-neutral-600"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                {password && (
                  <div className="mt-1">
                    <div className="flex gap-1">
                      {[1, 2, 3, 4].map((n) => (
                        <div
                          key={n}
                          className={`h-1 flex-1 rounded-full transition-colors duration-200 ${n <= strength ? _STRENGTH_BAR[strength] : 'bg-gray-200'}`}
                        />
                      ))}
                    </div>
                    <p className={`text-xs mt-1 ${_STRENGTH_TEXT[strength]}`}>
                      {_STRENGTH_LABEL[strength]}
                    </p>
                  </div>
                )}
              </div>

              {/* Confirm password */}
              <div className="flex flex-col gap-1.5">
                <AnimatedLabel htmlFor="confirm">
                  Confirm new password <span className="text-red-500 ml-0.5">*</span>
                </AnimatedLabel>
                <div className="relative">
                  <AnimatedInput
                    id="confirm"
                    type={showConfirm ? 'text' : 'password'}
                    placeholder="Repeat your new password"
                    autoComplete="new-password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirm((v) => !v)}
                    className="absolute inset-y-0 right-0 pr-3 flex items-center text-neutral-400 hover:text-neutral-600"
                  >
                    {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {error && <p className="text-red-500 text-sm">{error}</p>}

              <button
                type="submit"
                disabled={loading}
                className="relative group/btn w-full h-10 rounded-md font-medium text-white outline-none disabled:opacity-60 disabled:cursor-not-allowed overflow-hidden"
                style={{ background: 'linear-gradient(135deg, #07438C 0%, #1C94AE 100%)' }}
              >
                <span className="relative z-10">{loading ? 'Saving…' : 'Set new password'} &rarr;</span>
              </button>
            </form>

            <p className="text-center text-xs text-neutral-500 pt-1">
              <Link to="/login" className="text-sm font-medium text-[#07438C] hover:underline">
                ← Back to sign in
              </Link>
            </p>
          </section>
        )}
      </div>
    </div>
  );
}
