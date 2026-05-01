import { Phone, Mail, User as UserIcon, ExternalLink } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useTwilio } from '../context/TwilioContext';
import { formatPhone } from '../utils/format';

export default function SettingsPage() {
  const { user, logout } = useAuth();
  const { deviceReady, deviceError } = useTwilio();

  return (
    <div className="flex-1 overflow-y-auto surface">
      <div className="max-w-2xl mx-auto px-6 py-8 space-y-8">
        <header>
          <h1 className="text-2xl font-display font-bold">Settings</h1>
          <p className="text-sm text-muted mt-1">Manage your profile and app preferences.</p>
        </header>

        {/* Profile */}
        <Section title="Profile">
          <Field label="Name" icon={UserIcon}>
            {user?.name}
          </Field>
          <Field label="Email" icon={Mail}>
            {user?.email}
          </Field>
          <Field label="Phone number" icon={Phone}>
            {user?.phone_number ? formatPhone(user.phone_number) : 'Not configured'}
          </Field>
        </Section>

        {/* Phone status */}
        <Section title="Phone status">
          <div
            className="p-4 rounded-xl flex items-center gap-3"
            style={{ background: 'rgb(var(--bg-secondary))' }}
          >
            <span
              className={`w-3 h-3 rounded-full ${
                deviceError ? 'bg-red-500' : deviceReady ? 'bg-green-500' : 'bg-amber-500'
              }`}
            />
            <div className="flex-1">
              <div className="font-medium text-sm">
                {deviceError ? 'Disconnected' : deviceReady ? 'Connected' : 'Connecting…'}
              </div>
              {deviceError && (
                <div className="text-xs text-red-500 mt-0.5">{deviceError}</div>
              )}
              {!deviceError && (
                <div className="text-xs text-muted mt-0.5">
                  {deviceReady
                    ? 'Ready to make and receive calls'
                    : 'Registering with Twilio…'}
                </div>
              )}
            </div>
          </div>
        </Section>

        {/* Links — admin only */}
        {user?.role === 'admin' && (
          <Section title="Resources">
            <a
              href="https://www.twilio.com/console"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-between p-4 rounded-xl hover:surface-tertiary transition-colors"
              style={{ background: 'rgb(var(--bg-secondary))' }}
            >
              <span className="text-sm font-medium">Open Twilio Console</span>
              <ExternalLink className="w-4 h-4 text-faint" />
            </a>
          </Section>
        )}

        <div className="pt-4">
          <button
            onClick={logout}
            className="w-full py-3 rounded-lg border border-red-500/30 text-red-500 hover:bg-red-500 hover:text-white transition-colors text-sm font-medium"
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <section>
      <h2 className="text-xs uppercase tracking-wider font-semibold text-muted mb-3">{title}</h2>
      <div className="rounded-xl overflow-hidden" style={{ border: '1px solid rgb(var(--border-primary))' }}>
        {children}
      </div>
    </section>
  );
}

function Field({ label, icon: Icon, children }) {
  return (
    <div
      className="px-4 py-3.5 flex items-center gap-3 border-b last:border-b-0"
      style={{ borderColor: 'rgb(var(--border-primary))' }}
    >
      {Icon && <Icon className="w-4 h-4 text-faint flex-shrink-0" />}
      <div className="flex-1">
        <div className="text-xs text-muted">{label}</div>
        <div className="text-sm font-medium mt-0.5">{children}</div>
      </div>
    </div>
  );
}

