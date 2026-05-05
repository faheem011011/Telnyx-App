import { NavLink, useNavigate } from 'react-router-dom';
import {
  Inbox,
  Contact,
  MessageCircle,
  Calendar,
  Phone,
  LogOut,
  Settings,
  ChevronDown,
  LayoutDashboard,
  ShieldCheck,
} from 'lucide-react';
import { useEffect, useState, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { useTelnyx as useTwilio } from '../context/TelnyxContext';
import { callsApi } from '../services/api';
import Avatar from './Avatar';
import { formatPhone } from '../utils/format';

const USER_NAV = [
  { to: '/inbox',     icon: Inbox,         label: 'Inbox',       showBadge: true },
  { to: '/contacts',  icon: Contact,        label: 'Contacts' },
  { to: '/messages',  icon: MessageCircle,  label: 'Messages' },
  { to: '/scheduled', icon: Calendar,       label: 'Scheduled' },
];

const ADMIN_NAV = [
  { to: '/analytics', icon: LayoutDashboard, label: 'Analytics' },
  { to: '/admin',     icon: ShieldCheck,     label: 'Admin Panel' },
  { to: '/inbox',     icon: Inbox,           label: 'Inbox',       showBadge: true },
  { to: '/contacts',  icon: Contact,         label: 'Contacts' },
  { to: '/messages',  icon: MessageCircle,   label: 'Messages' },
  { to: '/scheduled', icon: Calendar,        label: 'Scheduled' },
];

export default function Sidebar({ onOpenDialer }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [unread, setUnread] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  const { deviceReady, deviceError } = useTwilio();
  const isAdmin = user?.role === 'admin';
  const navItems = isAdmin ? ADMIN_NAV : USER_NAV;

  // Fetch unread count
  useEffect(() => {
    const fetchUnread = () =>
      callsApi.unreadCount().then((r) => setUnread(r.count)).catch(() => {});
    fetchUnread();
    const id = setInterval(fetchUnread, 15000);
    window.addEventListener('calls:read', fetchUnread);
    return () => {
      clearInterval(id);
      window.removeEventListener('calls:read', fetchUnread);
    };
  }, [isAdmin]);

  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
    };
    window.addEventListener('mousedown', handler);
    return () => window.removeEventListener('mousedown', handler);
  }, [menuOpen]);

  const GRAD = 'linear-gradient(135deg, #07438C 0%, #1C94AE 100%)';

  const navLinkClass = ({ isActive }) =>
    `flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm transition-all duration-150 no-underline ${
      isActive ? 'font-semibold' : 'font-medium hover:bg-white/10'
    }`;
  const navLinkStyle = ({ isActive }) => ({
    background: isActive ? 'rgba(255,255,255,0.95)' : undefined,
    color: isActive ? '#07438C' : 'rgba(255,255,255,0.85)',
    boxShadow: isActive ? '0 2px 8px rgba(0,0,0,0.12)' : undefined,
  });

  return (
    <aside className="w-64 flex flex-col flex-shrink-0" style={{ background: GRAD }}>

      {/* Top brand bar */}
      <div className="h-16 px-4 flex items-center gap-3"
        style={{ borderBottom: '1px solid rgba(255,255,255,0.15)' }}>
        <img src="/logo.png" alt="AlphaCall" className="w-9 h-9 rounded-lg object-cover flex-shrink-0" />
        <div className="min-w-0">
          <div className="font-display font-bold text-base truncate text-white">AlphaCall</div>
          <div className="text-xs truncate" style={{ color: 'rgba(255,255,255,0.65)' }}>{user?.name}</div>
        </div>
      </div>

      {/* Quick actions */}
      <div className="px-3 pt-3 pb-2 flex gap-2">
        <button
          onClick={onOpenDialer}
          title="New call"
          className="flex-1 py-2 text-sm flex items-center justify-center gap-1.5 rounded-xl font-semibold transition-all duration-150 hover:-translate-y-px active:scale-95"
          style={{ background: 'rgba(255,255,255,0.95)', color: '#07438C', boxShadow: '0 2px 8px rgba(0,0,0,0.15)' }}
        >
          <Phone className="w-4 h-4" />
          Call
        </button>
        <button
          onClick={() => navigate('/messages/new')}
          title="New message"
          className="flex-1 py-2 text-sm flex items-center justify-center gap-1.5 rounded-xl font-medium transition-all duration-150 hover:-translate-y-px active:scale-95"
          style={{ background: 'rgba(255,255,255,0.15)', color: 'rgba(255,255,255,0.9)', border: '1px solid rgba(255,255,255,0.2)' }}
        >
          <MessageCircle className="w-4 h-4" />
          Text
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-3 py-2 space-y-0.5">
        {navItems.map(({ to, icon: Icon, label, showBadge }) => (
          <NavLink key={to} to={to} className={navLinkClass} style={navLinkStyle}>
            <Icon className="w-5 h-5 flex-shrink-0" strokeWidth={2} />
            <span className="flex-1 truncate">{label}</span>
            {showBadge && unread > 0 && (
              <span className="px-2 py-0.5 rounded-full text-xs font-semibold"
                style={{ background: 'rgba(255,255,255,0.95)', color: '#07438C' }}>
                {unread > 99 ? '99+' : unread}
              </span>
            )}
          </NavLink>
        ))}
        <NavLink to="/settings" className={navLinkClass} style={navLinkStyle}>
          <Settings className="w-5 h-5 flex-shrink-0" strokeWidth={2} />
          <span className="flex-1 truncate">Settings</span>
        </NavLink>
      </nav>

      {/* Device status pill */}
      {deviceError ? (
        <div className="mx-3 mb-2 px-3 py-2 rounded-lg text-xs"
          style={{ background: 'rgba(239,68,68,0.2)', border: '1px solid rgba(239,68,68,0.35)', color: '#fca5a5' }}>
          <div className="font-medium mb-0.5">⚠ Phone offline</div>
          <div className="opacity-75 break-all">{deviceError}</div>
        </div>
      ) : (
        <div className="mx-3 mb-2 px-3 py-2 rounded-lg text-xs flex items-center gap-2"
          style={{ background: 'rgba(0,0,0,0.18)', color: 'rgba(255,255,255,0.7)' }}>
          <span className={`w-2 h-2 rounded-full ${deviceReady ? 'bg-green-400' : 'bg-amber-400'}`} />
          <span>{deviceReady ? 'Phone ready' : 'Connecting…'}</span>
        </div>
      )}

      {/* User menu footer */}
      <div className="p-3 relative" style={{ borderTop: '1px solid rgba(255,255,255,0.15)' }} ref={menuRef}>
        <button
          onClick={() => setMenuOpen((o) => !o)}
          className={`w-full flex items-center gap-3 px-2 py-2 rounded-lg transition-colors ${menuOpen ? '' : 'hover:bg-white/10'}`}
          style={{ background: menuOpen ? 'rgba(255,255,255,0.12)' : undefined }}
        >
          <Avatar name={user?.name} seed={user?.email} size="sm" />
          <div className="min-w-0 flex-1 text-left">
            <div className="text-sm font-medium truncate text-white">{user?.name}</div>
            <div className="text-xs truncate" style={{ color: 'rgba(255,255,255,0.6)' }}>
              {user?.phone_number ? formatPhone(user.phone_number) : user?.email}
            </div>
          </div>
          <ChevronDown className="w-4 h-4" style={{ color: 'rgba(255,255,255,0.5)' }} />
        </button>

        {menuOpen && (
          <div className="absolute bottom-16 left-3 right-3 rounded-xl shadow-2xl py-1.5 animate-slide-up"
            style={{ background: '#ffffff', border: '1px solid rgba(0,0,0,0.1)' }}>
            <button
              onClick={logout}
              className="w-full flex items-center gap-3 px-3 py-2.5 text-sm text-red-500 hover:bg-red-50 transition-colors"
            >
              <LogOut className="w-4 h-4" />
              Sign out
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
