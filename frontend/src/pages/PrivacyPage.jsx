import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Shield, ChevronRight, ArrowLeft, Mail, Globe, Lock, Database, Users, FileText, AlertCircle, RefreshCw, Phone } from 'lucide-react';

const SECTIONS = [
  { id: 'overview',        label: 'Overview' },
  { id: 'info-collected',  label: 'Information We Collect' },
  { id: 'how-we-use',      label: 'How We Use Your Information' },
  { id: 'sms-program',     label: 'SMS Communications' },
  { id: 'sharing',         label: 'Information Sharing' },
  { id: 'retention',       label: 'Data Retention' },
  { id: 'security',        label: 'Security Measures' },
  { id: 'your-rights',     label: 'Your Rights' },
  { id: 'minors',          label: 'Minors & Access' },
  { id: 'updates',         label: 'Policy Updates' },
  { id: 'contact',         label: 'Contact Us' },
];

function useActiveSection(ids) {
  const [active, setActive] = useState(ids[0]);

  useEffect(() => {
    const observers = ids.map((id) => {
      const el = document.getElementById(id);
      if (!el) return null;
      const obs = new IntersectionObserver(
        ([entry]) => { if (entry.isIntersecting) setActive(id); },
        { rootMargin: '-20% 0px -70% 0px' }
      );
      obs.observe(el);
      return obs;
    });
    return () => observers.forEach((o) => o?.disconnect());
  }, [ids]);

  return active;
}

function SectionHeading({ id, icon: Icon, title, subtitle }) {
  return (
    <div id={id} className="scroll-mt-24 pt-2 pb-4 border-b border-gray-100">
      <div className="flex items-center gap-3 mb-1">
        <div className="w-8 h-8 rounded-lg bg-brand-50 flex items-center justify-center flex-shrink-0">
          <Icon size={16} className="text-brand-600" />
        </div>
        <h2 className="text-xl font-semibold text-gray-900">{title}</h2>
      </div>
      {subtitle && <p className="text-sm text-gray-500 ml-11">{subtitle}</p>}
    </div>
  );
}

function InfoCard({ title, items }) {
  return (
    <div className="bg-gray-50 rounded-xl p-5 border border-gray-100">
      <h4 className="text-sm font-semibold text-gray-700 mb-3 uppercase tracking-wide">{title}</h4>
      <ul className="space-y-2">
        {items.map((item, i) => (
          <li key={i} className="flex items-start gap-2 text-sm text-gray-600">
            <ChevronRight size={14} className="text-brand-500 mt-0.5 flex-shrink-0" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function HighlightBox({ type, children }) {
  const styles = {
    info:    'bg-brand-50 border-brand-200 text-brand-800',
    warning: 'bg-amber-50 border-amber-200 text-amber-800',
    success: 'bg-emerald-50 border-emerald-200 text-emerald-800',
  };
  return (
    <div className={`rounded-xl border p-4 text-sm leading-relaxed ${styles[type] || styles.info}`}>
      {children}
    </div>
  );
}

export default function PrivacyPage() {
  const activeSection = useActiveSection(SECTIONS.map((s) => s.id));
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const scrollTo = (id) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
    setMobileNavOpen(false);
  };

  return (
    <div className="min-h-screen bg-white flex flex-col">

      {/* ─── Header ─────────────────────────────────────────────── */}
      <header className="sticky top-0 z-40 border-b border-gray-100 bg-white/95 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <Link to="/login" className="flex items-center gap-3 group">
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center shadow-sm"
              style={{ background: 'linear-gradient(135deg, #07438C 0%, #1C94AE 100%)' }}
            >
              <Phone size={18} className="text-white" />
            </div>
            <div className="hidden sm:block">
              <p className="text-sm font-bold text-gray-900 leading-none">AlphaCall</p>
              <p className="text-xs text-gray-500 leading-none mt-0.5">AlphaBridge Consulting</p>
            </div>
          </Link>

          <div className="flex items-center gap-3">
            <nav className="hidden md:flex items-center gap-1">
              <Link to="/privacypolicy" className="px-3 py-1.5 text-sm font-medium text-brand-600 bg-brand-50 rounded-lg">
                Privacy Policy
              </Link>
              <Link to="/termsandconditions" className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-50 rounded-lg transition-colors">
                Terms of Service
              </Link>
            </nav>
            <Link
              to="/login"
              className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-brand-600 transition-colors"
            >
              <ArrowLeft size={15} />
              <span className="hidden sm:inline">Back to Platform</span>
            </Link>
          </div>
        </div>
      </header>

      {/* ─── Hero ────────────────────────────────────────────────── */}
      <div className="border-b border-gray-100" style={{ background: 'linear-gradient(160deg, #f0f4ff 0%, #e8f4f8 100%)' }}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-14 sm:py-20">
          <div className="max-w-2xl">
            <div className="flex items-center gap-2 mb-4">
              <Shield size={18} className="text-brand-600" />
              <span className="text-sm font-medium text-brand-600 uppercase tracking-widest">Legal</span>
            </div>
            <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-gray-900 leading-tight mb-4">
              Privacy Policy
            </h1>
            <p className="text-lg text-gray-600 leading-relaxed mb-6">
              How AlphaBridge Consulting collects, uses, stores, and protects your information
              through the <strong className="text-gray-800">AlphaCall</strong> platform.
            </p>
            <div className="flex flex-wrap items-center gap-4 text-sm text-gray-500">
              <span className="flex items-center gap-1.5">
                <RefreshCw size={13} />
                Last updated: May 19, 2026
              </span>
              <span className="flex items-center gap-1.5">
                <Globe size={13} />
                <a href="https://phone.alphabridgeconsulting.ai" className="text-brand-600 hover:underline" target="_blank" rel="noopener noreferrer">
                  phone.alphabridgeconsulting.ai
                </a>
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* ─── Body ────────────────────────────────────────────────── */}
      <div className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-10 lg:py-14">
        <div className="flex gap-10 lg:gap-16">

          {/* TOC — sticky sidebar */}
          <aside className="hidden lg:block w-56 flex-shrink-0">
            <div className="sticky top-24">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">On this page</p>
              <nav className="space-y-0.5">
                {SECTIONS.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => scrollTo(s.id)}
                    className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-all duration-150 ${
                      activeSection === s.id
                        ? 'bg-brand-50 text-brand-700 font-medium'
                        : 'text-gray-500 hover:text-gray-800 hover:bg-gray-50'
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </nav>

              <div className="mt-6 p-3 rounded-xl bg-gray-50 border border-gray-100">
                <p className="text-xs text-gray-500 leading-relaxed">
                  Questions about your data?{' '}
                  <a href="mailto:legal@alphabridgeconsulting.ai" className="text-brand-600 hover:underline font-medium">
                    Contact us
                  </a>
                </p>
              </div>
            </div>
          </aside>

          {/* Main content */}
          <main className="flex-1 min-w-0 space-y-10 text-gray-700 leading-relaxed">

            {/* Overview */}
            <section>
              <SectionHeading id="overview" icon={FileText} title="Overview" />
              <div className="mt-5 space-y-4">
                <p>
                  AlphaBridge Consulting operates <strong>AlphaCall</strong>, an internal
                  business communication platform available at{' '}
                  <a href="https://phone.alphabridgeconsulting.ai" className="text-brand-600 hover:underline" target="_blank" rel="noopener noreferrer">
                    phone.alphabridgeconsulting.ai
                  </a>. This Privacy Policy describes how we collect, use, store, and protect information
                  in connection with your use of the platform.
                </p>
                <HighlightBox type="info">
                  <strong>AlphaCall is an internal business tool.</strong> Access is restricted to authorized AlphaBridge Consulting personnel. By using the platform, you acknowledge and agree to the practices described in this policy.
                </HighlightBox>
              </div>
            </section>

            {/* Information We Collect */}
            <section>
              <SectionHeading id="info-collected" icon={Database} title="Information We Collect" subtitle="Data you provide directly and data we collect automatically" />
              <div className="mt-5 space-y-4">
                <p>
                  We collect information necessary to operate AlphaCall and provide reliable business communication services. This falls into two categories:
                </p>
                <div className="grid sm:grid-cols-2 gap-4">
                  <InfoCard
                    title="User-Provided Information"
                    items={[
                      'Full name and business email address',
                      'Call recordings and transcripts',
                      'Outbound and inbound text messages',
                      'Contact details (phone numbers, names)',
                      'Communication notes and annotations',
                      'Account credentials and profile settings',
                    ]}
                  />
                  <InfoCard
                    title="Automatically Collected Data"
                    items={[
                      'IP addresses and geolocation data',
                      'Browser type and device information',
                      'Call metadata (duration, timestamps, direction)',
                      'Session tokens and authentication cookies',
                      'Platform usage and activity logs',
                      'Error reports and diagnostic information',
                    ]}
                  />
                </div>
                <p className="text-sm text-gray-600">
                  <strong>Third-Party Processing:</strong> Some data is processed through trusted providers —
                  specifically <strong>Telnyx</strong> for telephony and SMS services, and <strong>Clerk</strong> for
                  authentication. These providers operate under their own privacy policies and handle data only as
                  necessary to deliver their services.
                </p>
              </div>
            </section>

            {/* How We Use */}
            <section>
              <SectionHeading id="how-we-use" icon={Users} title="How We Use Your Information" subtitle="The purposes for which we process collected data" />
              <div className="mt-5 space-y-4">
                <p>We use the information we collect for the following purposes:</p>
                <div className="grid sm:grid-cols-2 gap-3">
                  {[
                    ['Platform Operations', 'To provide, maintain, and improve AlphaCall features and functionality.'],
                    ['Business Communications', 'To facilitate calls, SMS messages, and contact management for authorized users.'],
                    ['Record Keeping', 'To maintain communication logs, recordings, and transcripts as required.'],
                    ['Analytics & Reporting', 'To generate usage analytics and performance dashboards for administrators.'],
                    ['Security & Access Control', 'To authenticate users, prevent unauthorized access, and enforce security policies.'],
                    ['Legal Compliance', 'To meet applicable regulatory, legal, and contractual obligations.'],
                  ].map(([title, desc]) => (
                    <div key={title} className="flex gap-3 p-4 rounded-xl border border-gray-100 bg-gray-50/50">
                      <ChevronRight size={16} className="text-brand-500 mt-0.5 flex-shrink-0" />
                      <div>
                        <p className="text-sm font-semibold text-gray-800">{title}</p>
                        <p className="text-sm text-gray-600 mt-0.5">{desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            {/* SMS Program */}
            <section>
              <SectionHeading id="sms-program" icon={Phone} title="SMS Communications" subtitle="Our business-to-business SMS program and your opt-out rights" />
              <div className="mt-5 space-y-4">
                <p>
                  AlphaBridge Consulting operates a <strong>business-to-business (B2B) SMS program</strong> used for
                  appointment scheduling, follow-ups, and consulting communications. All SMS activity is conducted
                  through the AlphaCall platform.
                </p>
                <div className="grid sm:grid-cols-3 gap-3">
                  <div className="p-4 rounded-xl border border-emerald-100 bg-emerald-50 text-center">
                    <p className="text-2xl font-bold text-emerald-600 mb-1">STOP</p>
                    <p className="text-xs text-emerald-700">Reply to opt out of SMS messages at any time</p>
                  </div>
                  <div className="p-4 rounded-xl border border-brand-100 bg-brand-50 text-center">
                    <p className="text-2xl font-bold text-brand-600 mb-1">HELP</p>
                    <p className="text-xs text-brand-700">Reply for assistance or more information</p>
                  </div>
                  <div className="p-4 rounded-xl border border-gray-100 bg-gray-50 text-center">
                    <p className="text-2xl font-bold text-gray-600 mb-1">No Sale</p>
                    <p className="text-xs text-gray-600">We never sell or share phone numbers for marketing</p>
                  </div>
                </div>
                <HighlightBox type="success">
                  AlphaBridge Consulting does <strong>not</strong> sell or share phone numbers or message content with third parties for marketing purposes.
                </HighlightBox>
              </div>
            </section>

            {/* Sharing */}
            <section>
              <SectionHeading id="sharing" icon={Users} title="Information Sharing" subtitle="When and with whom we may share your data" />
              <div className="mt-5 space-y-4">
                <p>
                  We do not sell your personal information. Information may only be shared in the following limited circumstances:
                </p>
                <div className="space-y-3">
                  {[
                    {
                      title: 'Trusted Service Providers',
                      desc: 'We share data with vetted vendors (e.g., Telnyx for telephony, Clerk for authentication) solely to deliver platform services. These providers are contractually bound to protect your data.',
                    },
                    {
                      title: 'Legal & Regulatory Compliance',
                      desc: 'We may disclose information when required by law, subpoena, court order, or government request, or to protect the rights, property, or safety of AlphaBridge Consulting, its users, or the public.',
                    },
                    {
                      title: 'Business Transfers',
                      desc: 'In the event of a merger, acquisition, or sale of assets, user data may be transferred as part of that transaction. We will provide notice before any such transfer.',
                    },
                  ].map(({ title, desc }) => (
                    <div key={title} className="flex gap-4 p-4 rounded-xl border border-gray-100">
                      <div className="w-2 rounded-full bg-brand-500 flex-shrink-0 self-stretch" />
                      <div>
                        <p className="font-semibold text-gray-800 text-sm">{title}</p>
                        <p className="text-sm text-gray-600 mt-1">{desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            {/* Retention */}
            <section>
              <SectionHeading id="retention" icon={Database} title="Data Retention" subtitle="How long we keep your information" />
              <div className="mt-5 space-y-4">
                <p>
                  We retain personal data only for as long as necessary to fulfill the purposes described in this policy
                  or as required by applicable law.
                </p>
                <div className="overflow-hidden rounded-xl border border-gray-100">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-100">
                        <th className="text-left px-4 py-3 font-semibold text-gray-700">Data Type</th>
                        <th className="text-left px-4 py-3 font-semibold text-gray-700">Retention Period</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {[
                        ['Call Recordings & Transcripts', 'Up to 12 months (longer if legally required)'],
                        ['SMS Message Content', 'Duration of business relationship'],
                        ['Account & Profile Data', 'Duration of access + reasonable period after termination'],
                        ['Usage & Activity Logs', 'Up to 90 days for operational purposes'],
                        ['Authentication Tokens', 'Session duration only'],
                      ].map(([type, period]) => (
                        <tr key={type} className="hover:bg-gray-50/50 transition-colors">
                          <td className="px-4 py-3 text-gray-700">{type}</td>
                          <td className="px-4 py-3 text-gray-600">{period}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>

            {/* Security */}
            <section>
              <SectionHeading id="security" icon={Lock} title="Security Measures" subtitle="How we protect the information we hold" />
              <div className="mt-5 space-y-4">
                <p>
                  We implement industry-standard technical and organizational safeguards to protect your data from
                  unauthorized access, disclosure, alteration, or destruction.
                </p>
                <div className="grid sm:grid-cols-3 gap-3">
                  {[
                    ['TLS Encryption', 'All data in transit is encrypted using Transport Layer Security (TLS).'],
                    ['Access Controls', 'Role-based access ensures users can only access data appropriate to their function.'],
                    ['Secure Cloud Infrastructure', 'Data is stored on enterprise-grade cloud infrastructure with physical and logical controls.'],
                  ].map(([title, desc]) => (
                    <div key={title} className="p-4 rounded-xl border border-gray-100 bg-gradient-to-b from-gray-50 to-white">
                      <Lock size={18} className="text-brand-500 mb-2" />
                      <p className="text-sm font-semibold text-gray-800 mb-1">{title}</p>
                      <p className="text-xs text-gray-600">{desc}</p>
                    </div>
                  ))}
                </div>
                <HighlightBox type="warning">
                  <AlertCircle size={14} className="inline mr-1.5 mb-0.5" />
                  <strong>Important:</strong> While we employ robust security practices, no system can guarantee absolute security. We encourage users to use strong passwords, protect their credentials, and report any suspected security issues immediately.
                </HighlightBox>
              </div>
            </section>

            {/* Your Rights */}
            <section>
              <SectionHeading id="your-rights" icon={Shield} title="Your Rights" subtitle="Your choices and rights regarding your personal information" />
              <div className="mt-5 space-y-4">
                <p>
                  Depending on your jurisdiction, you may have certain rights regarding your personal information.
                  Authorized AlphaCall users may contact us to exercise the following rights:
                </p>
                <div className="grid sm:grid-cols-2 gap-3">
                  {[
                    ['Access', 'Request a copy of personal data we hold about you.'],
                    ['Correction', 'Request correction of inaccurate or incomplete data.'],
                    ['Deletion', 'Request deletion of your personal data, subject to legal obligations.'],
                    ['Restriction', 'Request that we limit how we process your information.'],
                  ].map(([right, desc]) => (
                    <div key={right} className="flex items-start gap-3 p-4 rounded-xl border border-brand-100 bg-brand-50/50">
                      <div className="w-6 h-6 rounded-full bg-brand-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                        <ChevronRight size={12} className="text-brand-600" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-brand-800">{right}</p>
                        <p className="text-xs text-brand-700/80 mt-0.5">{desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
                <p className="text-sm text-gray-600">
                  To exercise any of these rights, contact us at{' '}
                  <a href="mailto:legal@alphabridgeconsulting.ai" className="text-brand-600 hover:underline font-medium">
                    legal@alphabridgeconsulting.ai
                  </a>. We will respond within a reasonable timeframe in accordance with applicable law.
                </p>
              </div>
            </section>

            {/* Minors */}
            <section>
              <SectionHeading id="minors" icon={AlertCircle} title="Minors & Platform Access" />
              <div className="mt-5 space-y-3">
                <p>
                  AlphaCall is intended exclusively for <strong>authorized business users aged 18 and above</strong>.
                  The platform is not designed for, nor does it knowingly collect data from, individuals under 18
                  years of age.
                </p>
                <HighlightBox type="warning">
                  If we become aware that we have inadvertently collected information from a minor, we will take steps to delete that information promptly. Access is granted only to vetted personnel authorized by AlphaBridge Consulting.
                </HighlightBox>
              </div>
            </section>

            {/* Updates */}
            <section>
              <SectionHeading id="updates" icon={RefreshCw} title="Policy Updates" />
              <div className="mt-5 space-y-3">
                <p>
                  AlphaBridge Consulting reserves the right to update this Privacy Policy at any time. When we make
                  material changes, we will update the "Last updated" date at the top of this page.
                </p>
                <p>
                  Continued use of AlphaCall after any revision constitutes your acceptance of the updated policy.
                  We encourage authorized users to review this policy periodically.
                </p>
              </div>
            </section>

            {/* Contact */}
            <section>
              <SectionHeading id="contact" icon={Mail} title="Contact Us" />
              <div className="mt-5">
                <div className="rounded-2xl border border-gray-100 overflow-hidden">
                  <div
                    className="p-6 text-white"
                    style={{ background: 'linear-gradient(135deg, #07438C 0%, #1C94AE 100%)' }}
                  >
                    <h3 className="text-lg font-bold mb-1">Have questions about your privacy?</h3>
                    <p className="text-sm text-white/80">Our team is here to help with any data or privacy inquiries.</p>
                  </div>
                  <div className="p-6 bg-gray-50 grid sm:grid-cols-2 gap-4">
                    <div>
                      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Email</p>
                      <a href="mailto:legal@alphabridgeconsulting.ai" className="text-sm text-brand-600 hover:underline font-medium">
                        legal@alphabridgeconsulting.ai
                      </a>
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Platform</p>
                      <a href="https://phone.alphabridgeconsulting.ai" className="text-sm text-brand-600 hover:underline font-medium" target="_blank" rel="noopener noreferrer">
                        phone.alphabridgeconsulting.ai
                      </a>
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Company</p>
                      <p className="text-sm text-gray-700">AlphaBridge Consulting</p>
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Platform</p>
                      <p className="text-sm text-gray-700">AlphaCall</p>
                    </div>
                  </div>
                </div>
              </div>
            </section>

          </main>
        </div>
      </div>

      {/* ─── Footer ──────────────────────────────────────────────── */}
      <footer className="border-t border-gray-100 bg-gray-50 mt-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
          <div className="flex flex-col sm:flex-row items-center sm:items-start justify-between gap-6">
            <div className="flex items-center gap-3">
              <div
                className="w-8 h-8 rounded-xl flex items-center justify-center"
                style={{ background: 'linear-gradient(135deg, #07438C 0%, #1C94AE 100%)' }}
              >
                <Phone size={15} className="text-white" />
              </div>
              <div>
                <p className="text-sm font-bold text-gray-900">AlphaCall</p>
                <p className="text-xs text-gray-500">by AlphaBridge Consulting</p>
              </div>
            </div>
            <div className="flex flex-wrap justify-center sm:justify-end items-center gap-x-6 gap-y-2 text-sm text-gray-500">
              <Link to="/privacypolicy" className="text-brand-600 font-medium">Privacy Policy</Link>
              <Link to="/termsandconditions" className="hover:text-gray-900 transition-colors">Terms of Service</Link>
              <a href="mailto:legal@alphabridgeconsulting.ai" className="hover:text-gray-900 transition-colors">Legal</a>
            </div>
          </div>
          <div className="mt-6 pt-6 border-t border-gray-200 text-center sm:text-left">
            <p className="text-xs text-gray-400">
              &copy; {new Date().getFullYear()} AlphaBridge Consulting. All rights reserved.
              AlphaCall is an internal business platform restricted to authorized users.
            </p>
          </div>
        </div>
      </footer>

    </div>
  );
}
