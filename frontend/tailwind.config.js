/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        foreground: 'rgb(var(--text-primary) / <alpha-value>)',
        background: 'rgb(var(--bg-primary) / <alpha-value>)',
        brand: {
          50:  '#EEF2FF',
          100: '#DAE5FF',
          200: '#BDCFFF',
          300: '#8CABFF',
          400: '#5582FA',
          500: '#2D65F7',
          600: '#1454F6',
          700: '#1043C5',
          800: '#0B3196',
          900: '#072067',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        display: ['"Plus Jakarta Sans"', 'Inter', 'sans-serif'],
      },
      animation: {
        'fade-in':    'fade-in 0.2s ease-out',
        'slide-up':   'slide-up 0.25s ease-out',
        'slide-down': 'slide-down 0.28s cubic-bezier(0.16, 1, 0.3, 1)',
        'pulse-ring': 'pulse-ring 1.5s cubic-bezier(0.215, 0.61, 0.355, 1) infinite',
        'ripple':     'ripple 2s ease infinite',
        'orbit':      'orbit calc(var(--duration) * 1s) linear infinite',
      },
      keyframes: {
        'fade-in': {
          '0%':   { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'slide-up': {
          '0%':   { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'slide-down': {
          '0%':   { opacity: '0', transform: 'translateY(-14px) scale(0.96)' },
          '100%': { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
        'pulse-ring': {
          '0%':   { transform: 'scale(0.8)', opacity: '1' },
          '100%': { transform: 'scale(2.2)', opacity: '0' },
        },
        'ripple': {
          '0%, 100%': { transform: 'translate(-50%, -50%) scale(1)' },
          '50%':      { transform: 'translate(-50%, -50%) scale(0.9)' },
        },
        'orbit': {
          '0%':   { transform: 'rotate(0deg) translateY(calc(var(--radius) * 1px)) rotate(0deg)' },
          '100%': { transform: 'rotate(360deg) translateY(calc(var(--radius) * 1px)) rotate(-360deg)' },
        },
      },
    },
  },
  plugins: [],
};
