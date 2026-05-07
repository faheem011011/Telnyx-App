/**
 * Format a phone number in a readable US format.
 * Accepts input with or without country code.
 */
export function formatPhone(raw) {
  if (!raw) return '';
  const s = String(raw);
  const digits = s.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) {
    const n = digits.slice(1);
    return `+1 (${n.slice(0, 3)}) ${n.slice(3, 6)}-${n.slice(6)}`;
  }
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  // Non-US E.164: keep `+`, group the rest in 3s for legibility
  if (s.startsWith('+') && digits.length >= 7) {
    const groups = digits.match(/.{1,3}/g) || [];
    return `+${groups.join(' ')}`;
  }
  return s;
}

/**
 * Normalize a phone number to E.164 (+1XXXXXXXXXX for US, or international
 * +<country><subscriber> for non-US). Returns '' for invalid input — caller
 * must handle empty.
 */
export function toE164(raw) {
  if (!raw) return '';
  const s = String(raw).trim();
  const digits = s.replace(/\D/g, '');
  // Already E.164: rebuild from cleaned digits to normalize whitespace/punctuation.
  if (s.startsWith('+') && digits.length >= 7 && digits.length <= 15) {
    return `+${digits}`;
  }
  // 10-digit US local: prepend +1
  if (digits.length === 10) return `+1${digits}`;
  // 11-digit starting with 1: NANPA, just prepend +
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  // Best-effort international (no country detection)
  if (digits.length >= 7 && digits.length <= 15) return `+${digits}`;
  return '';
}

/**
 * Format ISO datetime as a friendly relative label.
 * Today -> time. This week -> day name. Older -> date.
 */
export function formatCallDate(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  const now = new Date();
  const diffMs = now - date;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  const sameDay =
    date.getDate() === now.getDate() &&
    date.getMonth() === now.getMonth() &&
    date.getFullYear() === now.getFullYear();

  if (sameDay) {
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }
  if (diffDays < 7) {
    return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  }
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function formatDuration(seconds) {
  if (!seconds || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Return initials (1-2 chars) for an avatar circle.
 */
export function getInitials(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * Return a deterministic avatar color class from a string.
 * Used so the same name/number always shows the same color.
 */
const AVATAR_COLORS = [
  'bg-blue-500',
  'bg-pink-500',
  'bg-green-500',
  'bg-amber-500',
  'bg-cyan-500',
  'bg-rose-500',
  'bg-indigo-500',
  'bg-teal-500',
  'bg-purple-500',
  'bg-orange-500',
];

export function getAvatarColor(seed) {
  if (!seed) return AVATAR_COLORS[0];
  const str = String(seed);
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = (hash * 31 + str.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}
