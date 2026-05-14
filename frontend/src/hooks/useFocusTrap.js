import { useEffect } from 'react';

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

/**
 * Traps keyboard focus within `containerRef` while the component is mounted.
 * Restores focus to the previously-focused element on unmount.
 */
export function useFocusTrap(containerRef) {
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const previously = document.activeElement;

    const getFocusable = () => Array.from(container.querySelectorAll(FOCUSABLE));

    // Move focus into the trap on mount
    const first = getFocusable()[0];
    if (first) first.focus();

    const handleKeyDown = (e) => {
      if (e.key !== 'Tab') return;
      const nodes = getFocusable();
      if (!nodes.length) { e.preventDefault(); return; }
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    container.addEventListener('keydown', handleKeyDown);
    return () => {
      container.removeEventListener('keydown', handleKeyDown);
      if (previously && previously.focus) previously.focus();
    };
  }, [containerRef]);
}
