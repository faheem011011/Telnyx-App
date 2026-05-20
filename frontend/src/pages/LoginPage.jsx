import { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { AnimatedForm } from '../components/ui/AnimatedLogin';

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const setupSuccess = location.state?.setupSuccess;

  const from = location.state?.from?.pathname;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const user = await login(email, password);
      navigate(from || (user.role === 'admin' ? '/analytics' : '/inbox'), { replace: true });
    } catch (err) {
      setError(err.response?.data?.detail || 'Login failed. Please check your credentials.');
    } finally {
      setLoading(false);
    }
  };

  const fields = [
    {
      id: 'email',
      label: 'Email',
      required: true,
      type: 'email',
      placeholder: 'Enter your email address',
      autoComplete: 'email',
      onChange: (e) => setEmail(e.target.value),
    },
    {
      id: 'password',
      label: 'Password',
      required: true,
      type: 'password',
      placeholder: 'Enter your password',
      autoComplete: 'current-password',
      onChange: (e) => setPassword(e.target.value),
    },
  ];

  return (
    <div className="flex min-h-screen">
      {/* Left panel - hidden on small screens */}
      <div className="hidden lg:block w-1/2 relative">
        <img
          src="/login-side.png"
          alt=""
          className="absolute inset-0 w-full h-full object-cover"
        />
      </div>

      {/* Right panel - the form */}
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

        {setupSuccess && (
          <div className="w-full max-w-sm mb-4 px-4 py-3 rounded-xl text-sm bg-green-50 text-green-700 border border-green-200 text-center">
            Admin account created successfully. Sign in below.
          </div>
        )}

        <AnimatedForm
          logo="/loginLogo.png"
          header="Welcome to Alpha Call"
          subHeader="Sign in to your account to continue"
          fields={fields}
          submitButton={loading ? 'Signing in…' : 'Sign in'}
          submitDisabled={loading}
          errorField={error}
          onSubmit={handleSubmit}
          forgotPasswordLink={
            <Link
              to="/forgot-password"
              className="text-xs font-medium text-[#07438C] hover:underline"
            >
              Forgot password?
            </Link>
          }
          footerNote="Contact Admin, if you need access!"
        />
      </div>
    </div>
  );
}
