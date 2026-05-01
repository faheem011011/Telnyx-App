import { getInitials, getAvatarColor } from '../utils/format';

/**
 * Circular avatar with deterministic color and initials.
 */
export default function Avatar({ name, seed, size = 'md', className = '' }) {
  const sizes = {
    xs: 'w-7 h-7 text-xs',
    sm: 'w-9 h-9 text-sm',
    md: 'w-10 h-10 text-sm',
    lg: 'w-12 h-12 text-base',
    xl: 'w-16 h-16 text-lg',
    '2xl': 'w-20 h-20 text-2xl',
  };

  const colorClass = getAvatarColor(seed || name);
  const initials = getInitials(name);

  return (
    <div
      className={`${sizes[size]} ${colorClass} rounded-full flex items-center justify-center text-white font-semibold flex-shrink-0 ${className}`}
    >
      {initials}
    </div>
  );
}
