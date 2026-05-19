import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { FileText, ChevronRight, ArrowLeft, Mail, Globe, Shield, Lock, AlertTriangle, RefreshCw, Phone, Scale, Briefcase, Mic } from 'lucide-react';

const SECTIONS = [
  { id: 'acceptance',    label: 'Acceptance of Terms' },
  { id: 'account',       label: 'Account Security & Access' },
  { id: 'acceptable',    label: 'Acceptable Use' },
  { id: 'sms',           label: 'SMS & Telephony Compliance' },
  { id: 'recording',     label: 'Call Recording' },
  { id: 'ip',            label: 'Intellectual Property' },
  { id: 'confidential',  label: 'Confidentiality' },
  { id: 'third-party',   label: 'Third-Party Integrations' },
  { id: 'disclaimers',   label: 'Disclaimers & Liability' },
  { id: 'indemnify',     label: 'Indemnification' },
  { id: 'termination',   label: 'Termination' },
  { id: 'governing',     label: 'Governing Law' },
  { id: 'contact',       label: 'Contact Us' },
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

function SectionHeading({ id, icon: Icon, number, title, subtitle }) {
  return (
    <div id={id} className="scroll-mt-24 pt-2 pb-4 border-b border-gray-100">
      <div className="flex items-center gap-3 mb-1">
        <div className="w-8 h-8 rounded-lg bg-brand-50 flex items-center justify-center flex-shrink-0">
          <Icon size={16} className="text-brand-600" />
        </div>
        <div className="flex items-baseline gap-2">
          {number && <span className="text-xs font-bold text-brand-400 tabular-nums">{String(number).padStart(2, '0')}</span>}
          <h2 className="text-xl font-semibold text-gray-900">{title}</h2>
        </div>
      </div>
      {subtitle && <p className="text-sm text-gray-500 ml-11">{subtitle}</p>}
    </div>
  );
}

function Rule({ children }) {
  return (
    <li className="flex items-start gap-2 text-sm text-gray-700">
      <ChevronRight size={14} className="text-brand-500 mt-0.5 flex-shrink-0" />
      <span>{children}</span>
    </li>
  );
}

function Prohibited({ children }) {
  return (
    <li className="flex items-start gap-2 text-sm text-gray-700">
      <span className="w-4 h-4 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0 mt-0.5">
        <span className="text-red-500 text-xs font-bold leading-none">✕</span>
      </span>
      <span>{children}</span>
    </li>
  );
}

function HighlightBox({ type, children }) {
  const styles = {
    info:    'bg-brand-50 border-brand-200 text-brand-800',
    warning: 'bg-amber-50 border-amber-200 text-amber-800',
    danger:  'bg-red-50 border-red-200 text-red-800',
    success: 'bg-emerald-50 border-emerald-200 text-emerald-800',
  };
  return (
    <div className={`rounded-xl border p-4 text-sm leading-relaxed ${styles[type] || styles.info}`}>
      {children}
    </div>
  );
}

export default function TermsPage() {
  const activeSection = useActiveSection(SECTIONS.map((s) => s.id));

  const scrollTo = (id) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
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
              <Link to="/privacypolicy" className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-50 rounded-lg transition-colors">
                Privacy Policy
              </Link>
              <Link to="/termsandconditions" className="px-3 py-1.5 text-sm font-medium text-brand-600 bg-brand-50 rounded-lg">
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
              <Scale size={18} className="text-brand-600" />
              <span className="text-sm font-medium text-brand-600 uppercase tracking-widest">Legal</span>
            </div>
            <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-gray-900 leading-tight mb-4">
              Terms of Service
            </h1>
            <p className="text-lg text-gray-600 leading-relaxed mb-6">
              The rules, rights, and responsibilities governing your use of{' '}
              <strong className="text-gray-800">AlphaCall</strong> - AlphaBridge Consulting's
              internal business communication platform.
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
                {SECTIONS.map((s, i) => (
                  <button
                    key={s.id}
                    onClick={() => scrollTo(s.id)}
                    className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-all duration-150 flex items-center gap-2 ${
                      activeSection === s.id
                        ? 'bg-brand-50 text-brand-700 font-medium'
                        : 'text-gray-500 hover:text-gray-800 hover:bg-gray-50'
                    }`}
                  >
                    <span className="text-xs tabular-nums opacity-60">{String(i + 1).padStart(2, '0')}</span>
                    <span>{s.label}</span>
                  </button>
                ))}
              </nav>

              <div className="mt-6 p-3 rounded-xl bg-gray-50 border border-gray-100">
                <p className="text-xs text-gray-500 leading-relaxed">
                  Questions about these terms?{' '}
                  <a href="mailto:legal@alphabridgeconsulting.ai" className="text-brand-600 hover:underline font-medium">
                    Contact legal
                  </a>
                </p>
              </div>
            </div>
          </aside>

          {/* Main content */}
          <main className="flex-1 min-w-0 space-y-10 text-gray-700 leading-relaxed">

            {/* Acceptance */}
            <section>
              <SectionHeading id="acceptance" icon={FileText} number={1} title="Acceptance of Terms" />
              <div className="mt-5 space-y-4">
                <p>
                  These Terms of Service ("Terms") govern access to and use of <strong>AlphaCall</strong>,
                  the internal web application of AlphaBridge Consulting, available at{' '}
                  <a href="https://phone.alphabridgeconsulting.ai" className="text-brand-600 hover:underline" target="_blank" rel="noopener noreferrer">
                    phone.alphabridgeconsulting.ai
                  </a>.
                </p>
                <HighlightBox type="info">
                  By accessing or using AlphaCall, you confirm that you are an <strong>authorized AlphaBridge Consulting user aged 18 or older</strong> and that you agree to comply with these Terms and all applicable laws and regulations.
                </HighlightBox>
                <p>
                  If you do not agree to these Terms, you must immediately cease use of the platform and
                  notify your administrator.
                </p>
              </div>
            </section>

            {/* Account Security */}
            <section>
              <SectionHeading id="account" icon={Lock} number={2} title="Account Security & Access" subtitle="Your responsibilities for keeping your account secure" />
              <div className="mt-5 space-y-4">
                <p>
                  Access to AlphaCall is limited to personnel who have been expressly approved by
                  AlphaBridge Consulting. As an authorized user, you are responsible for:
                </p>
                <ul className="space-y-2">
                  <Rule>Maintaining the strict confidentiality of your login credentials and access tokens.</Rule>
                  <Rule>Not sharing your account with any other individual under any circumstances.</Rule>
                  <Rule>Immediately reporting any unauthorized access, suspected breach, or security concern to your administrator and to <a href="mailto:legal@alphabridgeconsulting.ai" className="text-brand-600 hover:underline">legal@alphabridgeconsulting.ai</a>.</Rule>
                  <Rule>Ensuring you log out of the platform when not in use, particularly on shared or public devices.</Rule>
                  <Rule>Using strong, unique passwords and enabling any additional security measures provided.</Rule>
                </ul>
                <p className="text-sm text-gray-600">
                  AlphaBridge Consulting reserves the right to suspend or terminate access to any account it
                  reasonably believes has been compromised or misused.
                </p>
              </div>
            </section>

            {/* Acceptable Use */}
            <section>
              <SectionHeading id="acceptable" icon={Briefcase} number={3} title="Acceptable Use" subtitle="Permitted and prohibited activities on the platform" />
              <div className="mt-5 space-y-5">
                <p>
                  AlphaCall is provided exclusively for <strong>lawful business purposes</strong> in compliance
                  with all applicable communication and data protection laws.
                </p>

                <div>
                  <h4 className="text-sm font-semibold text-gray-800 mb-3 flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-red-100 flex items-center justify-center">
                      <span className="text-red-500 text-xs font-bold">✕</span>
                    </span>
                    Prohibited Activities
                  </h4>
                  <ul className="space-y-2">
                    <Prohibited>Sending unsolicited commercial messages (spam) or engaging in bulk messaging campaigns without authorization.</Prohibited>
                    <Prohibited>Misrepresenting your identity, department, or affiliation during communications.</Prohibited>
                    <Prohibited>Attempting to gain unauthorized access to other accounts, systems, or data within the platform.</Prohibited>
                    <Prohibited>Disrupting, degrading, or interfering with platform operations or network infrastructure.</Prohibited>
                    <Prohibited>Using the system for any activity outside approved AlphaBridge Consulting business functions.</Prohibited>
                    <Prohibited>Violating any applicable federal, state, or local laws, including the TCPA and CAN-SPAM Act.</Prohibited>
                  </ul>
                </div>

                <HighlightBox type="warning">
                  <AlertTriangle size={14} className="inline mr-1.5 mb-0.5" />
                  Violations of this Acceptable Use policy may result in immediate account suspension, termination, and referral to appropriate legal authorities.
                </HighlightBox>
              </div>
            </section>

            {/* SMS & Telephony */}
            <section>
              <SectionHeading id="sms" icon={Phone} number={4} title="SMS & Telephony Compliance" subtitle="Rules governing outbound calls and text messages" />
              <div className="mt-5 space-y-4">
                <p>
                  AlphaCall's telephony and SMS features carry significant legal obligations. When using these
                  features, you must:
                </p>
                <ul className="space-y-2">
                  <Rule>Obtain proper prior express consent before contacting any individual via SMS or phone call.</Rule>
                  <Rule>Immediately honor all STOP requests and opt-outs — no further messages may be sent after a STOP reply.</Rule>
                  <Rule>Comply with all Do Not Call (DNC) registry regulations at federal and state levels.</Rule>
                  <Rule>Clearly identify yourself as a representative of AlphaBridge Consulting at the start of each call.</Rule>
                  <Rule>Adhere to all applicable time-of-day restrictions for calls and texts.</Rule>
                  <Rule>Maintain accurate records of consent as required by TCPA and related regulations.</Rule>
                </ul>
                <div className="grid sm:grid-cols-2 gap-3">
                  <div className="p-4 rounded-xl border border-gray-100 bg-gray-50">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">TCPA</p>
                    <p className="text-sm text-gray-700">Telephone Consumer Protection Act — governs autodialed calls and texts to consumers.</p>
                  </div>
                  <div className="p-4 rounded-xl border border-gray-100 bg-gray-50">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">CAN-SPAM Act</p>
                    <p className="text-sm text-gray-700">Federal law regulating commercial email and electronic messages sent for business purposes.</p>
                  </div>
                </div>
              </div>
            </section>

            {/* Call Recording */}
            <section>
              <SectionHeading id="recording" icon={Mic} number={5} title="Call Recording" subtitle="Notice and consent requirements for recorded calls" />
              <div className="mt-5 space-y-4">
                <p>
                  Calls made through AlphaCall <strong>may be recorded or monitored</strong> for quality assurance,
                  compliance, and training purposes.
                </p>
                <HighlightBox type="warning">
                  <AlertTriangle size={14} className="inline mr-1.5 mb-0.5" />
                  <strong>User Responsibility:</strong> You are solely responsible for ensuring compliance with all applicable call recording notice and consent laws in your jurisdiction — including one-party and two-party consent states. Some states require you to inform all parties that a call is being recorded before recording begins.
                </HighlightBox>
                <ul className="space-y-2">
                  <Rule>Provide legally required recording notices to all call participants before initiating recording.</Rule>
                  <Rule>Obtain explicit consent where required by applicable state or federal law.</Rule>
                  <Rule>Never use recordings for any purpose other than authorized business activities.</Rule>
                  <Rule>Handle all recordings in accordance with AlphaBridge Consulting data protection policies.</Rule>
                </ul>
              </div>
            </section>

            {/* Intellectual Property */}
            <section>
              <SectionHeading id="ip" icon={Shield} number={6} title="Intellectual Property" />
              <div className="mt-5 space-y-4">
                <p>
                  All software, content, designs, workflows, trademarks, and materials associated with AlphaCall
                  are the exclusive intellectual property of <strong>AlphaBridge Consulting</strong> or its
                  licensed vendors.
                </p>
                <div className="rounded-xl border border-gray-100 overflow-hidden">
                  <div className="bg-gray-50 px-4 py-3 border-b border-gray-100">
                    <p className="text-sm font-semibold text-gray-700">License Grant</p>
                  </div>
                  <div className="p-4 text-sm text-gray-700 space-y-2">
                    <p>You are granted a <strong>limited, non-exclusive, non-transferable, revocable license</strong> to access and use AlphaCall solely for authorized internal business purposes.</p>
                    <p>This license does not permit you to: copy, modify, distribute, sell, reverse engineer, or create derivative works from any part of the platform or its underlying software.</p>
                  </div>
                </div>
              </div>
            </section>

            {/* Confidentiality */}
            <section>
              <SectionHeading id="confidential" icon={Lock} number={7} title="Confidentiality" />
              <div className="mt-5 space-y-4">
                <p>
                  By using AlphaCall, you gain access to sensitive and proprietary business information.
                  You agree to maintain strict confidentiality regarding:
                </p>
                <div className="grid sm:grid-cols-2 gap-3">
                  {[
                    'Call records and transcripts',
                    'Analytics and performance data',
                    'Contact and client information',
                    'Company strategies and operations',
                    'Internal communications',
                    'Platform configuration and features',
                  ].map((item) => (
                    <div key={item} className="flex items-center gap-2 px-4 py-3 rounded-lg border border-gray-100 bg-gray-50 text-sm text-gray-700">
                      <Lock size={13} className="text-brand-500 flex-shrink-0" />
                      {item}
                    </div>
                  ))}
                </div>
                <p className="text-sm text-gray-600">
                  Confidentiality obligations survive the termination of your access to AlphaCall.
                </p>
              </div>
            </section>

            {/* Third-Party Integrations */}
            <section>
              <SectionHeading id="third-party" icon={Globe} number={8} title="Third-Party Integrations" />
              <div className="mt-5 space-y-4">
                <p>
                  AlphaCall integrates with third-party services to deliver its core functionality. Your use of
                  the platform constitutes indirect use of these services:
                </p>
                <div className="grid sm:grid-cols-2 gap-4">
                  <div className="p-5 rounded-xl border border-gray-100 bg-gradient-to-b from-gray-50 to-white">
                    <div className="flex items-center gap-2 mb-2">
                      <Phone size={16} className="text-brand-500" />
                      <p className="font-semibold text-gray-800">Telnyx</p>
                    </div>
                    <p className="text-sm text-gray-600">
                      Powers all telephony and SMS capabilities, including call routing, phone number management, and message delivery.
                    </p>
                  </div>
                  <div className="p-5 rounded-xl border border-gray-100 bg-gradient-to-b from-gray-50 to-white">
                    <div className="flex items-center gap-2 mb-2">
                      <Lock size={16} className="text-brand-500" />
                      <p className="font-semibold text-gray-800">Clerk</p>
                    </div>
                    <p className="text-sm text-gray-600">
                      Provides secure user authentication, session management, and access control for the platform.
                    </p>
                  </div>
                </div>
                <p className="text-sm text-gray-600">
                  AlphaBridge Consulting is not responsible for the availability or performance of third-party
                  services. Each provider operates under its own terms of service and privacy policy.
                </p>
              </div>
            </section>

            {/* Disclaimers */}
            <section>
              <SectionHeading id="disclaimers" icon={AlertTriangle} number={9} title="Disclaimers & Limitation of Liability" />
              <div className="mt-5 space-y-4">
                <HighlightBox type="warning">
                  <p className="font-semibold mb-2">Service Disclaimer</p>
                  <p>AlphaCall is provided <strong>"as is"</strong> and <strong>"as available"</strong> without warranties of any kind, express or implied. AlphaBridge Consulting does not warrant that the platform will be uninterrupted, error-free, or free from security vulnerabilities.</p>
                </HighlightBox>
                <div className="p-5 rounded-xl border border-gray-100">
                  <h4 className="text-sm font-semibold text-gray-800 mb-3">Limitation of Liability</h4>
                  <p className="text-sm text-gray-700">
                    To the maximum extent permitted by applicable law, AlphaBridge Consulting shall not be liable
                    for any indirect, incidental, special, consequential, or punitive damages — including but not
                    limited to loss of profits, data, business opportunities, or goodwill — arising from:
                  </p>
                  <ul className="mt-3 space-y-1.5">
                    <Rule>Your use of or inability to use AlphaCall</Rule>
                    <Rule>Unauthorized access to or alteration of your data</Rule>
                    <Rule>Service interruptions or technical failures</Rule>
                    <Rule>Actions of third-party service providers</Rule>
                  </ul>
                </div>
              </div>
            </section>

            {/* Indemnification */}
            <section>
              <SectionHeading id="indemnify" icon={Scale} number={10} title="Indemnification" />
              <div className="mt-5 space-y-3">
                <p>
                  You agree to indemnify, defend, and hold harmless AlphaBridge Consulting and its officers,
                  directors, employees, and agents from and against any claims, liabilities, damages, losses,
                  and expenses — including reasonable legal fees — arising out of or in connection with:
                </p>
                <ul className="space-y-2">
                  <Rule>Your violation of these Terms or any applicable law or regulation.</Rule>
                  <Rule>Your misuse of the AlphaCall platform or its communications features.</Rule>
                  <Rule>Any claim by a third party arising from your use of telephony, SMS, or recording features.</Rule>
                  <Rule>Your infringement of any intellectual property or other rights of any person or entity.</Rule>
                </ul>
              </div>
            </section>

            {/* Termination */}
            <section>
              <SectionHeading id="termination" icon={AlertTriangle} number={11} title="Termination" />
              <div className="mt-5 space-y-3">
                <p>
                  AlphaBridge Consulting reserves the right, at its sole discretion, to <strong>suspend or
                  terminate your access</strong> to AlphaCall at any time, with or without cause and with or
                  without notice.
                </p>
                <p>
                  Grounds for suspension or termination include, but are not limited to: violation of these
                  Terms, misuse of the platform, security concerns, employment separation, or business necessity.
                </p>
                <HighlightBox type="info">
                  Upon termination, your license to use AlphaCall ceases immediately. Provisions of these Terms that by their nature should survive termination — including confidentiality, indemnification, and intellectual property clauses — shall remain in effect.
                </HighlightBox>
              </div>
            </section>

            {/* Governing Law */}
            <section>
              <SectionHeading id="governing" icon={Scale} number={12} title="Governing Law & Updates" />
              <div className="mt-5 space-y-4">
                <div className="flex gap-4 p-4 rounded-xl border border-gray-100">
                  <div className="w-2 rounded-full bg-brand-500 flex-shrink-0 self-stretch" />
                  <div>
                    <p className="font-semibold text-gray-800 text-sm">California Law</p>
                    <p className="text-sm text-gray-600 mt-1">
                      These Terms are governed by and construed in accordance with the laws of the State of
                      California, without regard to its conflict of law provisions.
                    </p>
                  </div>
                </div>
                <div className="flex gap-4 p-4 rounded-xl border border-gray-100">
                  <div className="w-2 rounded-full bg-brand-500 flex-shrink-0 self-stretch" />
                  <div>
                    <p className="font-semibold text-gray-800 text-sm">Updates to These Terms</p>
                    <p className="text-sm text-gray-600 mt-1">
                      AlphaBridge Consulting may update these Terms periodically. Continued use of AlphaCall
                      after any modification constitutes acceptance of the revised Terms. The current version
                      is always available at this URL.
                    </p>
                  </div>
                </div>
              </div>
            </section>

            {/* Contact */}
            <section>
              <SectionHeading id="contact" icon={Mail} number={13} title="Contact Us" />
              <div className="mt-5">
                <div className="rounded-2xl border border-gray-100 overflow-hidden">
                  <div
                    className="p-6 text-white"
                    style={{ background: 'linear-gradient(135deg, #07438C 0%, #1C94AE 100%)' }}
                  >
                    <h3 className="text-lg font-bold mb-1">Questions about these Terms?</h3>
                    <p className="text-sm text-white/80">Our legal team is available to address any questions regarding these Terms of Service.</p>
                  </div>
                  <div className="p-6 bg-gray-50 grid sm:grid-cols-2 gap-4">
                    <div>
                      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Legal Email</p>
                      <a href="mailto:legal@alphabridgeconsulting.ai" className="text-sm text-brand-600 hover:underline font-medium">
                        legal@alphabridgeconsulting.ai
                      </a>
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Platform URL</p>
                      <a href="https://phone.alphabridgeconsulting.ai" className="text-sm text-brand-600 hover:underline font-medium" target="_blank" rel="noopener noreferrer">
                        phone.alphabridgeconsulting.ai
                      </a>
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Company</p>
                      <p className="text-sm text-gray-700">AlphaBridge Consulting</p>
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Governing Jurisdiction</p>
                      <p className="text-sm text-gray-700">State of California, United States</p>
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
              <Link to="/privacypolicy" className="hover:text-gray-900 transition-colors">Privacy Policy</Link>
              <Link to="/termsandconditions" className="text-brand-600 font-medium">Terms of Service</Link>
              <a href="mailto:legal@alphabridgeconsulting.ai" className="hover:text-gray-900 transition-colors">Legal</a>
            </div>
          </div>
          <div className="mt-6 pt-6 border-t border-gray-200 text-center sm:text-left">
            <p className="text-xs text-gray-400">
              &copy; {new Date().getFullYear()} AlphaBridge Consulting. All rights reserved.
              AlphaCall is an internal business platform restricted to authorized users.
              Governed by the laws of the State of California.
            </p>
          </div>
        </div>
      </footer>

    </div>
  );
}
