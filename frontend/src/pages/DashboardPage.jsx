import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  BarChart, Bar, AreaChart, Area, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, PieChart, Pie, Cell,
} from 'recharts';
import {
  Phone, Voicemail, MessageCircle, Users, BarChart2,
  Download, RefreshCw, PhoneIncoming, PhoneOutgoing, PhoneMissed,
  CheckCircle2, ChevronUp, ChevronDown, Star, UserPlus,
  Mic, PhoneOff, MailOpen, MapPin,
} from 'lucide-react';
import { analyticsApi, adminApi } from '../services/api';
import { useDepartments } from '../hooks/useDepartments';
import { useAuth } from '../context/AuthContext';
import Avatar from '../components/Avatar';

// ─── Hooks ────────────────────────────────────────────────────────────────────

function useDebounce(value, delay = 600) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

function useLazySection(rootMargin = '150px') {
  const ref = useRef(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!ref.current || visible) return;
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setVisible(true); obs.disconnect(); } },
      { rootMargin }
    );
    obs.observe(ref.current);
    return () => obs.disconnect();
  }, [rootMargin, visible]);
  return [ref, visible];
}

// ─── Formatters ────────────────────────────────────────────────────────────────

function fmtNum(n) {
  if (n === undefined || n === null) return '0';
  return Number(n).toLocaleString();
}
function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
function fmtTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}
function fmtShortDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}
function fmtHour(h) {
  if (h === 0)  return '12 AM';
  if (h === 12) return '12 PM';
  return h < 12 ? `${h} AM` : `${h - 12} PM`;
}
function pctChange(current, prev) {
  if (!prev) return null;
  return Math.round(((current - prev) / prev) * 100);
}

// ─── Theme colors ──────────────────────────────────────────────────────────────

function useChartColors() {
  return useMemo(() => ({
    accent:    '#1454F6',
    green:     '#10b981',
    red:       '#ef4444',
    amber:     '#f59e0b',
    blue:      '#3b82f6',
    teal:      '#14b8a6',
    pink:      '#ec4899',
    orange:    '#f97316',
    muted:     '#e5e7eb',
    textMuted: '#9ca3af',
    bg:        '#ffffff',
    border:    '#e5e7eb',
  }), []);
}

// ─── Design helpers ────────────────────────────────────────────────────────────

function cardBorder() {
  return '1px solid rgba(0,0,0,0.07)';
}
function cardShadow() {
  return '0 1px 3px rgba(0,0,0,0.06), 0 2px 8px rgba(0,0,0,0.04)';
}
function cardShadowHover() {
  return '0 4px 16px rgba(0,0,0,0.09), 0 1px 4px rgba(0,0,0,0.05)';
}

// ─── Skeleton ──────────────────────────────────────────────────────────────────

function Skeleton({ className = '' }) {
  return <div className={`animate-pulse rounded-lg bg-gray-200 ${className}`} />;
}
function SkeletonCard() {
  return (
    <div className="rounded-2xl p-4 border border-zinc-200 bg-white">
      <Skeleton className="h-3 w-20 mb-3" />
      <Skeleton className="h-8 w-16 mb-2" />
      <Skeleton className="h-2.5 w-14" />
    </div>
  );
}
function SkeletonChart({ tall = false }) {
  return (
    <div className="rounded-2xl p-5 border border-zinc-200 bg-white">
      <Skeleton className="h-4 w-44 mb-1.5" />
      <Skeleton className="h-3 w-64 mb-5" />
      <Skeleton className={`w-full ${tall ? 'h-64' : 'h-52'}`} />
    </div>
  );
}

// ─── Lazy Section wrapper ──────────────────────────────────────────────────────

function LazySection({ children, fallback = null }) {
  const [ref, visible] = useLazySection();
  return <div ref={ref}>{visible ? children : fallback}</div>;
}

// ─── Tooltip ───────────────────────────────────────────────────────────────────

function ChartTooltip({ active, payload, label, bg, border, text }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl px-3 py-2.5 shadow-2xl text-xs backdrop-blur-sm"
      style={{ background: bg, border: `1px solid ${border}`, color: text, minWidth: 130 }}>
      {label !== undefined && label !== '' && (
        <p className="font-semibold mb-1.5 opacity-60 text-[10px] uppercase tracking-wide">{label}</p>
      )}
      {payload.map((entry, i) => (
        <div key={i} className="flex items-center gap-2 py-0.5">
          <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: entry.color || entry.fill }} />
          <span className="opacity-70 capitalize">{entry.name}</span>
          <span className="ml-auto font-bold pl-3">{fmtNum(entry.value)}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Change Badge ──────────────────────────────────────────────────────────────

function ChangeBadge({ change }) {
  if (change === null || change === undefined) return <span className="text-[11px] text-zinc-400">— vs prev</span>;
  if (change === 0) return <span className="text-[11px] text-zinc-400">No change</span>;
  const up = change > 0;
  return (
    <span className={`inline-flex items-center gap-0.5 text-[11px] font-semibold ${up ? 'text-emerald-400' : 'text-red-400'}`}>
      {up ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
      {Math.abs(change)}% vs prev
    </span>
  );
}

// ─── KPI Stat Card ─────────────────────────────────────────────────────────────

function StatCard({ icon: Icon, label, value, color, change, sub, colors }) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="rounded-2xl p-4 cursor-default transition-all duration-200"
      style={{
        background: '#ffffff',
        border:     cardBorder(),
        boxShadow:  hovered ? cardShadowHover() : cardShadow(),
        transform:  hovered ? 'translateY(-1px)' : 'translateY(0)',
      }}
    >
      <div className="flex items-center justify-between mb-3">
        <span className="text-[10px] font-bold uppercase tracking-widest opacity-45">
          {label}
        </span>
        <div className="w-7 h-7 rounded-lg flex items-center justify-center"
          style={{ background: color + '15' }}>
          <Icon className="w-3.5 h-3.5" style={{ color }} />
        </div>
      </div>

      <div className="text-2xl font-black tabular-nums leading-none mb-1.5"
        style={{ color: 'rgb(var(--text-primary))' }}>
        {value}
      </div>

      {sub && <div className="text-[11px] mb-1 opacity-60" style={{ color }}>{sub}</div>}
      {change !== undefined && <ChangeBadge change={change} />}
    </div>
  );
}

// ─── Chart Card ────────────────────────────────────────────────────────────────

function ChartCard({ title, subtitle, accentColor, children, className = '', colors }) {
  const [hovered, setHovered] = useState(false);
  const ac = accentColor || BRAND;
  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={`rounded-2xl overflow-hidden transition-all duration-200 ${className}`}
      style={{
        background: `linear-gradient(160deg, ${ac}07 0%, #ffffff 40%)`,
        border:    cardBorder(),
        boxShadow: hovered ? cardShadowHover() : cardShadow(),
        transform: hovered ? 'translateY(-1px)' : 'translateY(0)',
      }}
    >
      <div className="h-0.5 w-full" style={{
        background: `linear-gradient(90deg, transparent, ${ac}70, transparent)`,
      }} />
      <div className="p-5">
        <div className="flex items-start gap-2 mb-4">
          <div className="w-1 h-8 rounded-full flex-shrink-0 mt-0.5"
            style={{ background: `linear-gradient(180deg, ${ac}, ${ac}40)` }} />
          <div>
            <h3 className="font-bold text-sm leading-tight" style={{ color: 'rgb(var(--text-primary))' }}>{title}</h3>
            {subtitle && <p className="text-xs mt-0.5 opacity-50">{subtitle}</p>}
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}

function EmptyChart({ label = 'No data for this period' }) {
  return (
    <div className="h-52 flex flex-col items-center justify-center gap-2 opacity-30">
      <BarChart2 className="w-8 h-8" />
      <span className="text-xs">{label}</span>
    </div>
  );
}

// ─── Individual Charts ─────────────────────────────────────────────────────────

function CallVolumeChart({ data, colors }) {
  const hasData = data?.some(d => d.inbound + d.outbound > 0);
  if (!hasData) return <EmptyChart />;
  const formatted = data.map(d => ({ ...d, label: fmtShortDate(d.date) }));
  return (
    <div className="h-60">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={formatted} margin={{ top: 4, right: 4, left: -18, bottom: 0 }} barSize={6} barGap={2}>
          <CartesianGrid strokeDasharray="3 3" stroke={colors.muted} vertical={false} opacity={0.5} />
          <XAxis dataKey="label" tick={{ fontSize: 10, fill: colors.textMuted }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 10, fill: colors.textMuted }} axisLine={false} tickLine={false} allowDecimals={false} />
          <Tooltip content={<ChartTooltip bg={colors.bg} border={colors.border} text={colors.textMuted} />} />
          <Legend iconType="circle" iconSize={7} wrapperStyle={{ fontSize: 11, opacity: 0.8 }} />
          <Bar dataKey="inbound"  name="Incoming" fill={colors.accent} radius={[3, 3, 0, 0]} />
          <Bar dataKey="outbound" name="Outgoing" fill={colors.green}  radius={[3, 3, 0, 0]} />
          <Bar dataKey="missed"   name="Missed"   fill={colors.red}    radius={[3, 3, 0, 0]} />
          <Bar dataKey="declined" name="Declined" fill={colors.amber}  radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function CallTypeChart({ data, colors }) {
  if (!data?.length || data.every(d => d.count === 0)) return <EmptyChart />;
  const colorMap = {
    Incoming: colors.accent,
    Outgoing: colors.green,
    Missed:   colors.red,
    Declined: colors.amber,
  };
  const RADIAN = Math.PI / 180;
  const renderLabel = ({ cx, cy, midAngle, innerRadius, outerRadius, percent }) => {
    if (percent < 0.05) return null;
    const r = innerRadius + (outerRadius - innerRadius) * 0.5;
    return (
      <text x={cx + r * Math.cos(-midAngle * RADIAN)} y={cy + r * Math.sin(-midAngle * RADIAN)}
        textAnchor="middle" dominantBaseline="central"
        style={{ fontSize: 10, fill: '#fff', fontWeight: 800 }}>
        {`${(percent * 100).toFixed(0)}%`}
      </text>
    );
  };
  const total = data.reduce((s, d) => s + d.count, 0);
  return (
    <div className="h-56 flex items-center gap-4">
      <ResponsiveContainer width="52%" height="100%">
        <PieChart>
          <Pie data={data} dataKey="count" nameKey="type" innerRadius="40%" outerRadius="72%"
            paddingAngle={3} labelLine={false} label={renderLabel}>
            {data.map(entry => (
              <Cell key={entry.type} fill={colorMap[entry.type] || colors.textMuted} />
            ))}
          </Pie>
          <Tooltip content={<ChartTooltip bg={colors.bg} border={colors.border} text={colors.textMuted} />} />
        </PieChart>
      </ResponsiveContainer>
      <div className="flex-1 space-y-3">
        {data.map(entry => {
          const c = colorMap[entry.type] || colors.textMuted;
          const pct = total ? Math.round(entry.count / total * 100) : 0;
          return (
            <div key={entry.type}>
              <div className="flex items-center gap-2 mb-1">
                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: c }} />
                <span className="text-xs flex-1 opacity-70">{entry.type}</span>
                <span className="text-xs font-bold tabular-nums">{fmtNum(entry.count)}</span>
                <span className="text-[10px] tabular-nums w-8 text-right opacity-50">{pct}%</span>
              </div>
              <div className="h-1 rounded-full overflow-hidden" style={{ background: c + '22' }}>
                <div className="h-full rounded-full transition-all duration-500"
                  style={{ width: `${pct}%`, background: c }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function HourlyChart({ data, colors }) {
  const hasData = data?.some(d => d.inbound + d.outbound + d.missed + d.declined > 0);
  if (!hasData) return <EmptyChart />;
  const formatted = data.map(d => ({ ...d, label: fmtHour(d.hour) }));
  return (
    <div className="h-56">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={formatted} margin={{ top: 6, right: 4, left: -18, bottom: 0 }}>
          <defs>
            <linearGradient id="hourGradInbound" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor={colors.accent} stopOpacity={0.28} />
              <stop offset="100%" stopColor={colors.accent} stopOpacity={0.02} />
            </linearGradient>
            <linearGradient id="hourGradOutbound" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor={colors.green} stopOpacity={0.24} />
              <stop offset="100%" stopColor={colors.green} stopOpacity={0.02} />
            </linearGradient>
            <linearGradient id="hourGradMissed" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor={colors.red} stopOpacity={0.2} />
              <stop offset="100%" stopColor={colors.red} stopOpacity={0.02} />
            </linearGradient>
            <linearGradient id="hourGradDeclined" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor={colors.amber} stopOpacity={0.2} />
              <stop offset="100%" stopColor={colors.amber} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="4 3" stroke={colors.muted} vertical={false} opacity={0.45} />
          <XAxis dataKey="label" tick={{ fontSize: 9, fill: colors.textMuted }} axisLine={false} tickLine={false} interval={2} />
          <YAxis tick={{ fontSize: 10, fill: colors.textMuted }} axisLine={false} tickLine={false} allowDecimals={false} />
          <Tooltip content={<ChartTooltip bg={colors.bg} border={colors.border} text={colors.textMuted} />} />
          <Legend iconType="circle" iconSize={7} wrapperStyle={{ fontSize: 11, opacity: 0.8 }} />
          <Area type="monotone" dataKey="inbound"  name="Incoming" stroke={colors.accent} strokeWidth={2}   fill="url(#hourGradInbound)"  dot={false} activeDot={{ r: 4, fill: colors.accent, strokeWidth: 0 }} />
          <Area type="monotone" dataKey="outbound" name="Outgoing" stroke={colors.green}  strokeWidth={2}   fill="url(#hourGradOutbound)" dot={false} activeDot={{ r: 4, fill: colors.green,  strokeWidth: 0 }} />
          <Area type="monotone" dataKey="missed"   name="Missed"   stroke={colors.red}    strokeWidth={1.5} fill="url(#hourGradMissed)"   dot={false} activeDot={{ r: 3, fill: colors.red,    strokeWidth: 0 }} />
          <Area type="monotone" dataKey="declined" name="Declined" stroke={colors.amber}  strokeWidth={1.5} fill="url(#hourGradDeclined)" dot={false} activeDot={{ r: 3, fill: colors.amber,  strokeWidth: 0 }} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function DowChart({ data, colors }) {
  const hasData = data?.some(d => d.count > 0);
  if (!hasData) return <EmptyChart />;
  return (
    <div className="h-56">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 4, right: 4, left: -18, bottom: 0 }} barSize={24}>
          <CartesianGrid strokeDasharray="3 3" stroke={colors.muted} vertical={false} opacity={0.5} />
          <XAxis dataKey="day" tick={{ fontSize: 11, fill: colors.textMuted }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 10, fill: colors.textMuted }} axisLine={false} tickLine={false} allowDecimals={false} />
          <Tooltip content={<ChartTooltip bg={colors.bg} border={colors.border} text={colors.textMuted} />} />
          <Bar dataKey="count" name="Calls" fill={colors.teal} radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ─── Top Area Codes (location cards) ──────────────────────────────────────────

function TopAreaCodesCards({ data, colors }) {
  const maxCount = Math.max(...(data?.map(d => d.count) ?? [1]), 1);
  const slots    = Array.from({ length: 3 }, (_, i) => data?.[i] ?? null);

  return (
    <div className="flex flex-col gap-2">
      {slots.map((item, idx) =>
        item ? (
          /* ── Filled slot ── */
          <div key={item.area_code}
            className="flex items-center gap-3 p-3 rounded-xl transition-all duration-200"
            style={{
              background: `${BRAND}06`,
              border:     `1px solid ${BRAND}25`,
            }}>
            {/* Rank badge */}
            <div className="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center font-black text-xs"
              style={{
                background: `linear-gradient(135deg, ${BRAND}, ${BRAND}aa)`,
                color:      '#fff',
                boxShadow:  `0 0 10px ${BRAND}50`,
              }}>
              {idx + 1}
            </div>

            {/* Info */}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap mb-1">
                <MapPin className="w-3 h-3 flex-shrink-0" style={{ color: BRAND }} />
                <span className="text-sm font-bold truncate">{item.city_state}</span>
                <span className="text-[10px] font-black px-1.5 py-0.5 rounded-full"
                  style={{ background: BRAND + '20', color: BRAND, border: `1px solid ${BRAND}40` }}>
                  +{item.area_code}
                </span>
                <span className="ml-auto text-xs font-black tabular-nums flex-shrink-0">
                  {fmtNum(item.count)} calls
                </span>
              </div>

              <div className="flex items-center gap-2 text-[10px] opacity-55 mb-1.5">
                <span style={{ color: BRAND }}>{Math.round((item.inbound  / (item.count || 1)) * 100)}% in</span>
                <span>·</span>
                <span style={{ color: BRAND + 'bb' }}>{Math.round((item.outbound / (item.count || 1)) * 100)}% out</span>
                <span>·</span>
                <span>{item.unique_numbers} unique numbers</span>
              </div>

              <div className="h-1.5 rounded-full overflow-hidden"
                style={{ background: '#e5e7eb', width: `${Math.round((item.count / maxCount) * 100)}%`, minWidth: 24 }}>
                <div className="h-full flex">
                  <div className="h-full transition-all duration-700"
                    style={{ width: `${Math.round((item.inbound  / (item.count || 1)) * 100)}%`, background: BRAND }} />
                  <div className="h-full transition-all duration-700"
                    style={{ width: `${Math.round((item.outbound / (item.count || 1)) * 100)}%`, background: BRAND + '70' }} />
                </div>
              </div>
            </div>
          </div>
        ) : (
          /* ── Empty placeholder slot ── */
          <div key={`empty-${idx}`}
            className="flex items-center gap-3 p-3 rounded-xl"
            style={{
              border:     '1.5px dashed rgba(0,0,0,0.08)',
              background: 'rgba(0,0,0,0.015)',
            }}>
            {/* Rank badge — dimmed */}
            <div className="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center font-black text-xs"
              style={{
                background: 'rgba(0,0,0,0.05)',
                color:      'rgba(0,0,0,0.2)',
              }}>
              {idx + 1}
            </div>

            {/* Placeholder content */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1.5">
                <div className="h-2.5 rounded-full w-24"
                  style={{ background: 'rgba(0,0,0,0.07)' }} />
                <div className="h-2 rounded-full w-10 ml-1"
                  style={{ background: 'rgba(0,0,0,0.05)' }} />
              </div>
              <div className="h-1.5 rounded-full w-full"
                style={{ background: 'rgba(0,0,0,0.05)' }} />
            </div>
          </div>
        )
      )}

      {/* Legend */}
      <div className="flex items-center gap-4 pt-0.5 px-1">
        <div className="flex items-center gap-1.5 text-[10px] opacity-50">
          <span className="w-2 h-2 rounded-full" style={{ background: BRAND }} />
          Incoming
        </div>
        <div className="flex items-center gap-1.5 text-[10px] opacity-50">
          <span className="w-2 h-2 rounded-full" style={{ background: BRAND + '70' }} />
          Outgoing
        </div>
        <span className="text-[10px] opacity-35 ml-auto"></span> 
      </div>
    </div>
  );
}

// ─── Recent Messages ───────────────────────────────────────────────────────────

function RecentMessages({ messages, colors }) {
  if (!messages?.length) {
    return (
      <div className="py-14 text-center opacity-30">
        <MessageCircle className="w-8 h-8 mx-auto mb-2" />
        <p className="text-sm">No messages yet.</p>
      </div>
    );
  }
  return (
    <div>
      {messages.map((m, idx) => {
        const other    = m.direction === 'inbound' ? m.from_number : m.to_number;
        const display  = m.contact_name || other;
        const isIn     = m.direction === 'inbound';
        const isUnread = !m.is_read && isIn;
        return (
          <div key={m.id}
            className="flex items-start gap-3 px-5 py-3 transition-all duration-150 cursor-default"
            style={{
              borderBottom: idx < messages.length - 1 ? '1px solid #f4f4f5' : 'none',
              background: isUnread ? `${BRAND}06` : 'transparent',
            }}>
            <Avatar name={display} seed={other} size="sm" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-semibold truncate">{display}</span>
                {m.contact_name && (
                  <span className="text-[10px] opacity-40 truncate hidden sm:block">{other}</span>
                )}
                {isUnread && (
                  <span className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                    style={{ background: BRAND }} />
                )}
                <span className="ml-auto flex-shrink-0 flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full"
                  style={{
                    background: isIn ? colors.accent + '18' : colors.green + '18',
                    color:      isIn ? colors.accent        : colors.green,
                  }}>
                  {isIn ? <PhoneIncoming className="w-2.5 h-2.5" /> : <PhoneOutgoing className="w-2.5 h-2.5" />}
                  {isIn ? 'Received' : 'Sent'}
                </span>
              </div>
              <p className="text-xs mt-0.5 truncate opacity-50">{m.body}</p>
            </div>
            <div className="flex-shrink-0 flex flex-col items-end gap-1 ml-2 min-w-fit">
              <span className="text-[10px] opacity-40 whitespace-nowrap">
                {fmtDate(m.created_at)} {fmtTime(m.created_at)}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Contacts Overview ─────────────────────────────────────────────────────────

function ContactsOverview({ overview, colors }) {
  if (!overview) return null;
  const items = [
    { icon: Users,    label: 'Total Contacts', value: fmtNum(overview.total),     color: BRAND },
    { icon: UserPlus, label: 'New This Period', value: `+${fmtNum(overview.new)}`, color: BRAND },
    { icon: Star,     label: 'Favourites',      value: fmtNum(overview.favorites), color: BRAND },
    { icon: PhoneOff, label: 'Blocked',         value: fmtNum(overview.blocked),   color: BRAND },
  ];
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-px"
      style={{ background: '#f4f4f5' }}>
      {items.map(({ icon: Icon, label, value, color }) => (
        <div key={label}
          className="flex flex-col items-center py-6 gap-2 relative overflow-hidden transition-all duration-200"
          style={{ background: `${color}06` }}>
          <div className="absolute inset-0 opacity-0 hover:opacity-100 transition-opacity duration-300"
            style={{ background: `linear-gradient(135deg, ${color}10 0%, transparent 100%)` }} />
          <div className="relative w-10 h-10 rounded-xl flex items-center justify-center"
            style={{ background: color + '15', boxShadow: `0 0 12px ${color}30` }}>
            <Icon className="w-5 h-5" style={{ color }} />
          </div>
          <span className="relative text-2xl font-black tabular-nums">{value}</span>
          <span className="relative text-xs opacity-50 text-center px-2">{label}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Brand color ──────────────────────────────────────────────────────────────

const BRAND = '#1454F6';

// ─── Period filter constants ───────────────────────────────────────────────────

const RANGES = [
  { key: '1d',     label: '1 Day'   },
  { key: '7d',     label: '7 Days'  },
  { key: '30d',    label: '30 Days' },
  { key: '90d',    label: '90 Days' },
  { key: 'custom', label: 'Custom'  },
];

// ─── Section Heading ───────────────────────────────────────────────────────────

function SectionHeading({ label, color }) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <div className="h-px flex-1" style={{ background: `linear-gradient(90deg, ${color}60, transparent)` }} />
      <span className="text-[10px] font-black uppercase tracking-widest px-1" style={{ color }}>
        {label}
      </span>
      <div className="h-px flex-1" style={{ background: `linear-gradient(270deg, ${color}60, transparent)` }} />
    </div>
  );
}

// ─── Main Dashboard ────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { user }  = useAuth();
  const colors    = useChartColors();
  const isAdmin   = user?.role === 'admin';
  const { departmentNames: departments } = useDepartments();

  const [range,        setRange]        = useState('7d');
  const [customStart,  setCustomStart]  = useState('');
  const [customEnd,    setCustomEnd]    = useState('');
  const [filterUserId, setFilterUserId] = useState('');
  const [filterDept,   setFilterDept]   = useState('');
  const [allUsers,     setAllUsers]     = useState([]);
  const [data,         setData]         = useState(null);
  const [loading,       setLoading]       = useState(true);
  const [refreshing,    setRefreshing]    = useState(false);
  const [error,         setError]         = useState(null);
  const [exportingCSV,  setExportingCSV]  = useState(false);

  const debouncedStart = useDebounce(customStart);
  const debouncedEnd   = useDebounce(customEnd);

  // Load user list for admin filters
  useEffect(() => {
    if (!isAdmin) return;
    adminApi.listUsers().then(setAllUsers).catch(() => {});
  }, [isAdmin]);

  const fetchData = useCallback(async (silent = false) => {
    if (range === 'custom' && (!debouncedStart || !debouncedEnd)) return;
    if (silent) {
      setRefreshing(true);
    } else {
      setLoading(true);
      setError(null);
    }
    try {
      const params = { range };
      if (range === 'custom' && debouncedStart && debouncedEnd) {
        params.start = debouncedStart;
        params.end   = debouncedEnd;
      }
      if (isAdmin && filterUserId) params.user_id = filterUserId;
      else if (isAdmin && filterDept) params.department = filterDept;
      const result = await analyticsApi.get(params);
      setData(result);
    } catch (e) {
      if (!silent) setError(e.message || 'Failed to load analytics');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [range, debouncedStart, debouncedEnd, filterUserId, filterDept, isAdmin]);

  // Initial + filter-change load
  useEffect(() => { fetchData(false); }, [fetchData]);

  // 30-second polling (stale-while-revalidate, skip custom range)
  useEffect(() => {
    if (range === 'custom') return;
    const id = setInterval(() => fetchData(true), 30000);
    return () => clearInterval(id);
  }, [range, fetchData]);

  const exportCSV = async () => {
    if (!data || exportingCSV) return;

    const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const toCSV = (headers, rows) =>
      [headers, ...rows].map(r => r.map(q).join(',')).join('\n');
    const download = (csv, label) => {
      const blob = new Blob([csv], { type: 'text/csv' });
      const url  = URL.createObjectURL(blob);
      Object.assign(document.createElement('a'), {
        href: url, download: `analytics-${label}-${range}-${Date.now()}.csv`,
      }).click();
      URL.revokeObjectURL(url);
    };

    // Non-admin: single-row summary of current user's own data
    if (!isAdmin) {
      const s = data.summary;
      const headers = ['Total Calls','Incoming','Outgoing','Answered','Missed','Declined','Total Messages','Unread Messages','Voicemails','Recordings'];
      const rows    = [[s.total_calls, s.inbound_calls, s.outbound_calls, s.answered_calls, s.missed_calls, s.declined_calls, s.total_messages, s.unread_messages, s.voicemails, s.recordings]];
      download(toCSV(headers, rows), 'my-stats');
      return;
    }

    // Admin: fetch per-user breakdown from backend
    setExportingCSV(true);
    try {
      const params = { range };
      if (range === 'custom' && debouncedStart && debouncedEnd) {
        params.start = debouncedStart;
        params.end   = debouncedEnd;
      }
      if (filterUserId)      params.user_id    = filterUserId;
      else if (filterDept)   params.department = filterDept;

      const users = await analyticsApi.usersSummary(params);

      const DATA_COLS = ['Total Calls','Incoming','Outgoing','Answered','Missed','Declined','Total Messages','Unread Messages','Voicemails','Recordings'];
      const dataRow = u => [u.total_calls, u.incoming, u.outgoing, u.answered, u.missed, u.declined, u.total_messages, u.unread_messages, u.voicemails, u.recordings];

      if (filterUserId || filterDept) {
        // One row per user, with Department + User columns
        const headers = ['Department', 'User', 'Email', ...DATA_COLS];
        const rows    = users.map(u => [u.department, u.user_name, u.user_email, ...dataRow(u)]);
        download(toCSV(headers, rows), filterUserId ? 'user' : filterDept.replace(/\s+/g, '-'));
      } else {
        // Aggregate totals per department
        const deptMap = {};
        for (const u of users) {
          const dept = u.department || 'Unassigned';
          if (!deptMap[dept]) deptMap[dept] = Array(DATA_COLS.length).fill(0);
          dataRow(u).forEach((v, i) => { deptMap[dept][i] += v; });
        }
        const headers = ['Department', ...DATA_COLS];
        const rows    = Object.entries(deptMap).map(([dept, vals]) => [dept, ...vals]);
        download(toCSV(headers, rows), 'all-departments');
      }
    } catch {
      setError('CSV export failed. Please check your connection and try again.');
    } finally {
      setExportingCSV(false);
    }
  };

  const s  = data?.summary;
  const ps = data?.previous_period_summary;

  const kpisRow1 = useMemo(() => s ? [
    { icon: Phone,         label: 'Total Calls', value: fmtNum(s.total_calls),    change: pctChange(s.total_calls,    ps?.total_calls)    },
    { icon: PhoneIncoming, label: 'Incoming',    value: fmtNum(s.inbound_calls),  change: pctChange(s.inbound_calls,  ps?.inbound_calls)   },
    { icon: PhoneOutgoing, label: 'Outgoing',    value: fmtNum(s.outbound_calls), change: pctChange(s.outbound_calls, ps?.outbound_calls)  },
    { icon: CheckCircle2,  label: 'Answered',    value: fmtNum(s.answered_calls), change: pctChange(s.answered_calls, ps?.answered_calls)  },
    { icon: PhoneMissed,   label: 'Missed',      value: fmtNum(s.missed_calls),   change: pctChange(s.missed_calls,   ps?.missed_calls)    },
    { icon: PhoneOff,      label: 'Declined',    value: fmtNum(s.declined_calls), change: pctChange(s.declined_calls, ps?.declined_calls)  },
  ] : [], [s, ps]);

  const kpisRow2 = useMemo(() => s ? [
    { icon: MessageCircle, label: 'Total Messages',  value: fmtNum(s.total_messages),  change: pctChange(s.total_messages,  ps?.total_messages)  },
    { icon: MailOpen,      label: 'Unread Messages', value: fmtNum(s.unread_messages), change: pctChange(s.unread_messages, ps?.unread_messages) },
    { icon: Voicemail,     label: 'Voicemails',      value: fmtNum(s.voicemails),      change: pctChange(s.voicemails,      ps?.voicemails)      },
    { icon: Mic,           label: 'Recordings',      value: fmtNum(s.recordings),      change: pctChange(s.recordings,      ps?.recordings)      },
  ] : [], [s, ps]);

  const dateRangeInvalid = range === 'custom' && (
    !debouncedStart || !debouncedEnd || debouncedStart > debouncedEnd
  );

  const pageBg = 'linear-gradient(160deg, #fafafa 0%, #f5f0ff 40%, #f0f9ff 70%, #fafafa 100%)';

  return (
    <div className="flex-1 overflow-y-auto" style={{ background: pageBg }}>
      <div className="max-w-7xl mx-auto px-6 py-8">

        {/* ── Page Header ─────────────────────────────────────────────────── */}
        <div className="flex items-start justify-between mb-8 relative">
          <div className="absolute -top-8 -left-8 w-64 h-32 rounded-full blur-3xl pointer-events-none opacity-20"
            style={{ background: `radial-gradient(ellipse, ${colors.accent}, transparent)` }} />
          <div className="absolute -top-4 left-32 w-48 h-24 rounded-full blur-3xl pointer-events-none opacity-10"
            style={{ background: `radial-gradient(ellipse, ${colors.blue}, transparent)` }} />

          <div className="relative">
            <div className="flex items-center gap-3 mb-1">
              <div className="w-8 h-8 rounded-xl flex items-center justify-center"
                style={{ background: BRAND }}>
                <BarChart2 className="w-4 h-4 text-white" />
              </div>
              <h1 className="text-3xl font-black font-display tracking-tight"
                style={{ color: BRAND }}>
                Analytics
              </h1>
            </div>
            <p className="text-sm opacity-40 ml-11">Real-time insights</p>
          </div>

          <div className="flex items-center gap-2">
            {refreshing && (
              <span className="text-[11px] font-semibold flex items-center gap-1.5"
                style={{ color: BRAND, opacity: 0.7 }}>
                <RefreshCw className="w-3 h-3 animate-spin" />
                Refreshing…
              </span>
            )}
            <button
              onClick={() => fetchData(false)}
              disabled={loading}
              title="Refresh data"
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all duration-200 hover:-translate-y-0.5 active:scale-95 disabled:opacity-40"
              style={{
                background: '#ffffff',
                border:     `1px solid ${BRAND}30`,
                boxShadow:  cardShadow(),
                color:      BRAND,
              }}
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>
        </div>

        {/* ── Filter Bar ──────────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-center gap-3 mb-8 p-3 rounded-2xl"
          style={{
            background: 'linear-gradient(135deg, #07438C 0%, #1C94AE 100%)',
            boxShadow:  '0 4px 20px rgba(7,67,140,0.35)',
          }}>

          <div className="flex items-center gap-1 p-1 rounded-xl flex-wrap"
            style={{
              background: 'rgba(255,255,255,0.12)',
              border:     '1px solid rgba(255,255,255,0.18)',
            }}>
            <span className="px-2 text-[9px] font-black uppercase tracking-widest select-none" style={{ color: 'rgba(255,255,255,0.6)' }}>Period</span>
            {RANGES.map(r => (
              <button key={r.key} onClick={() => setRange(r.key)}
                className="px-3 py-1.5 rounded-lg text-xs font-bold transition-all duration-150"
                style={{
                  background: range === r.key ? 'rgba(255,255,255,0.95)' : 'transparent',
                  color:      range === r.key ? '#07438C' : 'rgba(255,255,255,0.85)',
                  boxShadow:  range === r.key ? '0 2px 8px rgba(0,0,0,0.15)' : 'none',
                }}>
                {r.label}
              </button>
            ))}
          </div>

          {range === 'custom' && (
            <div className="flex items-center gap-2 flex-wrap">
              {['Start date', 'End date'].map((aria, i) => (
                <input key={i} type="date"
                  value={i === 0 ? customStart : customEnd}
                  onChange={e => i === 0 ? setCustomStart(e.target.value) : setCustomEnd(e.target.value)}
                  aria-label={aria}
                  className="px-3 py-1.5 rounded-lg text-xs outline-none transition-all"
                  style={{
                    background: 'rgba(255,255,255,0.15)',
                    border:     dateRangeInvalid ? `1px solid ${colors.red}` : '1px solid rgba(255,255,255,0.3)',
                    color:      '#fff',
                    colorScheme: 'dark',
                  }} />
              ))}
              {dateRangeInvalid && (
                <span className="text-[11px] font-semibold" style={{ color: '#fca5a5' }}>
                  Start must be before end
                </span>
              )}
            </div>
          )}

          {/* Admin-only: Department → User drill-down filters */}
          {isAdmin && (
            <div className="flex items-center gap-2 flex-wrap">
              <div className="w-px h-5 self-center rounded-full"
                style={{ background: 'rgba(255,255,255,0.25)' }} />
              <span className="px-2 text-[9px] font-black uppercase tracking-widest select-none" style={{ color: 'rgba(255,255,255,0.6)' }}>Dept</span>
              <select
                value={filterDept}
                onChange={(e) => {
                  setFilterDept(e.target.value);
                  setFilterUserId(''); // reset user when dept changes
                }}
                className="px-2 py-1.5 rounded-lg text-xs outline-none transition-all"
                style={{
                  background: 'rgba(255,255,255,0.15)',
                  border: '1px solid rgba(255,255,255,0.3)',
                  color: '#fff',
                  minWidth: 140,
                  fontWeight: filterDept ? 700 : 400,
                }}
              >
                {/*
                  The `<select>` itself renders on the blue gradient header so its
                  selected text is white. When the menu is open the browser pops
                  the options on a white system surface — white text would be
                  invisible. Style each <option> with the brand blue
                  (#07438C, the start stop of the gradient) so the menu list
                  reads as gradient-blue while open, then snaps back to white
                  once an item is picked because the parent `<select>` color wins. */}
                <option value="" style={{ color: '#07438C', background: '#fff' }}>All Departments</option>
                {departments.map((d) => (
                  <option key={d} value={d} style={{ color: '#07438C', background: '#fff' }}>{d}</option>
                ))}
              </select>
              <span className="px-2 text-[9px] font-black uppercase tracking-widest select-none" style={{ color: 'rgba(255,255,255,0.6)' }}>User</span>
              <select
                value={filterUserId}
                onChange={(e) => setFilterUserId(e.target.value)}
                disabled={!filterDept}
                className="px-2 py-1.5 rounded-lg text-xs outline-none transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                style={{
                  background: 'rgba(255,255,255,0.15)',
                  border: '1px solid rgba(255,255,255,0.3)',
                  color: '#fff',
                  minWidth: 160,
                  fontWeight: filterUserId ? 700 : 400,
                }}
                title={!filterDept ? 'Select a department first' : undefined}
              >
                <option value="" style={{ color: '#07438C', background: '#fff' }}>
                  {filterDept ? `All in ${filterDept}` : 'Select dept first'}
                </option>
                {filterDept &&
                  allUsers
                    .filter((u) => u.department === filterDept)
                    .map((u) => (
                      <option key={u.id} value={u.id} style={{ color: '#07438C', background: '#fff' }}>{u.name}</option>
                    ))}
              </select>
            </div>
          )}

          <div className="flex-1" />

          <button onClick={exportCSV} disabled={!data || loading || exportingCSV}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg active:scale-95 disabled:opacity-30"
            style={{
              background: 'rgba(255,255,255,0.95)',
              boxShadow:  '0 2px 8px rgba(0,0,0,0.15)',
              color:      '#07438C',
            }}>
            {exportingCSV
              ? <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              : <Download className="w-3.5 h-3.5" />}
            {exportingCSV ? 'Exporting…' : 'Export CSV'}
          </button>
        </div>

        {/* ── Truncated warning ───────────────────────────────────────────── */}
        {data?.truncated && (
          <div className="mb-6 px-4 py-3 rounded-xl text-sm font-medium flex items-center gap-2"
            style={{ background: 'rgba(234,179,8,0.12)', border: '1px solid rgba(234,179,8,0.35)', color: '#92400e' }}>
            <span>⚠️</span>
            <span>Time-series charts show only the most recent 5,000 calls. Summary KPI totals are exact.</span>
          </div>
        )}

        {/* ── Error State ─────────────────────────────────────────────────── */}
        {error && (
          <div className="flex flex-col items-center justify-center py-20 gap-5">
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center"
              style={{
                background: 'rgba(239,68,68,0.07)',
                border:     cardBorder(),
                boxShadow:  cardShadow(),
              }}>
              <BarChart2 className="w-7 h-7" style={{ color: colors.red }} />
            </div>
            <div className="text-center">
              <p className="font-bold">{error}</p>
              <p className="text-sm opacity-40 mt-1">Check that the backend is running.</p>
            </div>
            <button onClick={() => fetchData(false)}
              className="px-5 py-2 rounded-xl text-sm font-bold transition-all hover:-translate-y-0.5"
              style={{
                background: BRAND,
                boxShadow:  `0 4px 16px ${BRAND}40`,
                color:      '#fff',
              }}>
              Retry
            </button>
          </div>
        )}

        {!error && (
          <>
            {/* ── Period KPI Grid ───────────────────────────────────────── */}
            <SectionHeading label="Summary" color={BRAND} />
            <div className="space-y-3 mb-10">
              {loading ? (
                <>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                    {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)}
                  </div>
                </>
              ) : (
                <>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                    {kpisRow1.map(kpi => <StatCard key={kpi.label} {...kpi} color={BRAND} colors={colors} />)}
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {kpisRow2.map(kpi => <StatCard key={kpi.label} {...kpi} color={BRAND} colors={colors} />)}
                  </div>
                </>
              )}
            </div>

            {/* ── Charts ────────────────────────────────────────────────── */}
            <SectionHeading label="Call Analytics" color={BRAND} />
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-10">
              {loading ? (
                <>
                  <SkeletonChart tall />
                  <SkeletonChart />
                  <SkeletonChart />
                  <SkeletonChart />
                  <SkeletonChart />
                </>
              ) : (
                <>
                  <ChartCard title="Call Volume Over Time"
                    subtitle="Incoming, outgoing, missed and declined by day"
                    accentColor={BRAND} colors={colors} className="lg:col-span-2">
                    <CallVolumeChart data={data?.call_volume_by_day} colors={colors} />
                  </ChartCard>

                  <ChartCard title="Call Type Breakdown"
                    subtitle="Incoming · Outgoing · Missed · Declined with ratios"
                    accentColor={BRAND} colors={colors}>
                    <CallTypeChart data={data?.call_type_breakdown} colors={colors} />
                  </ChartCard>

                  <LazySection fallback={<SkeletonChart />}>
                    <ChartCard title="Calls by Hour of Day"
                      subtitle="24-hour call distribution"
                      accentColor={BRAND} colors={colors}>
                      <HourlyChart data={data?.calls_by_hour} colors={colors} />
                    </ChartCard>
                  </LazySection>

                  <LazySection fallback={<SkeletonChart />}>
                    <ChartCard title="Calls by Day of Week"
                      subtitle="Days that drive the most call volume"
                      accentColor={BRAND} colors={colors}>
                      <DowChart data={data?.calls_by_day_of_week} colors={colors} />
                    </ChartCard>
                  </LazySection>

                  <LazySection fallback={<SkeletonChart />}>
                    <ChartCard title="Top Locations by Area Code"
                      subtitle="Top 3 calling areas (city, state, inbound vs outbound split)"
                      accentColor={BRAND} colors={colors}>
                      <TopAreaCodesCards data={data?.top_area_codes} colors={colors} />
                    </ChartCard>
                  </LazySection>
                </>
              )}
            </div>

            {/* ── Recent Messages ───────────────────────────────────────── */}
            {!loading && (
              <LazySection>
                <>
                  <SectionHeading label="Recent Messages" color={BRAND} />
                  <div className="rounded-2xl overflow-hidden mb-10"
                    style={{
                      border:    cardBorder(),
                      boxShadow: cardShadow(),
                      background: `linear-gradient(160deg, ${BRAND}07 0%, #ffffff 35%)`,
                    }}>
                    <div className="h-0.5" style={{
                      background: `linear-gradient(90deg, transparent, ${BRAND}70, transparent)`,
                    }} />
                    <div className="px-5 py-4 flex items-center justify-between border-b"
                      style={{ borderColor: '#f4f4f5' }}>
                      <div>
                        <h3 className="font-bold text-sm">Recent Messages</h3>
                        <p className="text-xs opacity-40 mt-0.5">Read and Unread</p>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="flex items-center gap-1.5 text-xs opacity-50">
                          <span className="w-1.5 h-1.5 rounded-full" style={{ background: BRAND }} />
                          Unread
                        </div>
                        <span className="px-2.5 py-1 rounded-full text-xs font-bold"
                          style={{
                            background: BRAND + '18',
                            color:      BRAND,
                            border:     `1px solid ${BRAND}35`,
                          }}>
                          {data?.recent_messages?.length ?? 0} messages
                        </span>
                      </div>
                    </div>
                    <RecentMessages messages={data?.recent_messages} colors={colors} />
                  </div>
                </>
              </LazySection>
            )}

            {/* ── Contacts Overview ─────────────────────────────────────── */}
            {!loading && data?.contacts_overview && (
              <LazySection>
                <>
                  <SectionHeading label="Contacts Overview" color={BRAND} />
                  <div className="rounded-2xl overflow-hidden mb-10"
                    style={{
                      border:    cardBorder(),
                      boxShadow: cardShadow(),
                    }}>
                    <div className="h-0.5" style={{
                      background: `linear-gradient(90deg, transparent, ${BRAND}70, transparent)`,
                    }} />
                    <div className="px-5 py-4 border-b"
                      style={{
                        borderColor: '#f4f4f5',
                        background: `linear-gradient(160deg, ${BRAND}07 0%, #ffffff 40%)`,
                      }}>
                      <h3 className="font-bold text-sm">Contacts Overview</h3>
                      <p className="text-xs opacity-40 mt-0.5">Total · new · favourites · blocked</p>
                    </div>
                    <ContactsOverview overview={data.contacts_overview} colors={colors} />
                  </div>
                </>
              </LazySection>
            )}
          </>
        )}
      </div>
    </div>
  );
}
