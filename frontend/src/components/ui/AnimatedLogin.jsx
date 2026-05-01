import { memo, useState, useEffect, useRef, forwardRef } from 'react';
import {
  motion,
  useAnimation,
  useInView,
  useMotionTemplate,
  useMotionValue,
} from 'motion/react';
import { Eye, EyeOff } from 'lucide-react';

function cn(...classes) {
  return classes.filter(Boolean).join(' ');
}

// ── Input ────────────────────────────────────────────────────────────────────

export const AnimatedInput = memo(
  forwardRef(function AnimatedInput({ className, type, ...props }, ref) {
    const radius = 100;
    const [visible, setVisible] = useState(false);
    const mouseX = useMotionValue(0);
    const mouseY = useMotionValue(0);

    function handleMouseMove({ currentTarget, clientX, clientY }) {
      const { left, top } = currentTarget.getBoundingClientRect();
      mouseX.set(clientX - left);
      mouseY.set(clientY - top);
    }

    return (
      <motion.div
        style={{
          background: useMotionTemplate`
            radial-gradient(
              ${visible ? radius + 'px' : '0px'} circle at ${mouseX}px ${mouseY}px,
              #3b82f6,
              transparent 80%
            )
          `,
        }}
        onMouseMove={handleMouseMove}
        onMouseEnter={() => setVisible(true)}
        onMouseLeave={() => setVisible(false)}
        className="group/input rounded-lg p-[2px] transition duration-300"
      >
        <input
          type={type}
          className={cn(
            'flex h-10 w-full rounded-md border-none bg-gray-50 px-3 py-2 text-sm text-black transition duration-300 placeholder:text-neutral-400 focus-visible:ring-2 focus-visible:ring-neutral-400 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50:ring-neutral-600',
            className
          )}
          ref={ref}
          {...props}
        />
      </motion.div>
    );
  })
);

AnimatedInput.displayName = 'AnimatedInput';

// ── BoxReveal ─────────────────────────────────────────────────────────────────

export const BoxReveal = memo(function BoxReveal({
  children,
  width = 'fit-content',
  boxColor,
  duration,
  overflow = 'hidden',
  position = 'relative',
  className,
}) {
  const mainControls = useAnimation();
  const slideControls = useAnimation();
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true });

  useEffect(() => {
    if (isInView) {
      slideControls.start('visible');
      mainControls.start('visible');
    } else {
      slideControls.start('hidden');
      mainControls.start('hidden');
    }
  }, [isInView, mainControls, slideControls]);

  return (
    <section
      ref={ref}
      style={{ position, width, overflow }}
      className={className}
    >
      <motion.div
        variants={{
          hidden: { opacity: 0, y: 75 },
          visible: { opacity: 1, y: 0 },
        }}
        initial="hidden"
        animate={mainControls}
        transition={{ duration: duration ?? 0.5, delay: 0.25 }}
      >
        {children}
      </motion.div>
      <motion.div
        variants={{ hidden: { left: 0 }, visible: { left: '100%' } }}
        initial="hidden"
        animate={slideControls}
        transition={{ duration: duration ?? 0.5, ease: 'easeIn' }}
        style={{
          position: 'absolute',
          top: 4,
          bottom: 4,
          left: 0,
          right: 0,
          zIndex: 20,
          background: boxColor ?? '#5046e6',
          borderRadius: 4,
        }}
      />
    </section>
  );
});

// ── Ripple ────────────────────────────────────────────────────────────────────

export const Ripple = memo(function Ripple({
  mainCircleSize = 210,
  mainCircleOpacity = 0.24,
  numCircles = 8,
  className = '',
}) {
  return (
    <section
      className={cn(
        'pointer-events-none absolute inset-0 flex items-center justify-center',
        className
      )}
    >
      {Array.from({ length: numCircles }, (_, i) => {
        const size = mainCircleSize + i * 70;
        const opacity = mainCircleOpacity - i * 0.025;
        const animationDelay = `${i * 0.2}s`;
        const borderStyle = i === numCircles - 1 ? 'dashed' : 'solid';

        return (
          <span
            key={i}
            className="absolute animate-ripple rounded-full border border-foreground/10"
            style={{
              width: `${size}px`,
              height: `${size}px`,
              opacity: Math.max(opacity, 0),
              animationDelay,
              borderStyle,
              borderWidth: '1px',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
            }}
          />
        );
      })}
    </section>
  );
});

// ── OrbitingCircles ───────────────────────────────────────────────────────────

export const OrbitingCircles = memo(function OrbitingCircles({
  className,
  children,
  reverse = false,
  duration = 20,
  delay = 10,
  radius = 50,
  path = true,
}) {
  return (
    <>
      {path && (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="pointer-events-none absolute inset-0 size-full"
        >
          <circle
            className="stroke-foreground/10 stroke-1"
            cx="50%"
            cy="50%"
            r={radius}
            fill="none"
          />
        </svg>
      )}
      <div
        style={{
          '--duration': duration,
          '--radius': radius,
          '--delay': -delay,
        }}
        className={cn(
          'absolute flex size-full transform-gpu animate-orbit items-center justify-center rounded-full [animation-delay:calc(var(--delay)*1000ms)]',
          reverse && '[animation-direction:reverse]',
          className
        )}
      >
        {children}
      </div>
    </>
  );
});

// ── BottomGradient ────────────────────────────────────────────────────────────

export const BottomGradient = () => (
  <>
    <span className="group-hover/btn:opacity-100 block transition duration-500 opacity-0 absolute h-px w-full -bottom-px inset-x-0 bg-gradient-to-r from-transparent via-cyan-500 to-transparent" />
    <span className="group-hover/btn:opacity-100 blur-sm block transition duration-500 opacity-0 absolute h-px w-1/2 mx-auto -bottom-px inset-x-10 bg-gradient-to-r from-transparent via-indigo-500 to-transparent" />
  </>
);

// ── Label ─────────────────────────────────────────────────────────────────────

export const AnimatedLabel = memo(function AnimatedLabel({ className, ...props }) {
  return (
    <label
      className={cn(
        'text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70',
        className
      )}
      {...props}
    />
  );
});

// ── AnimatedForm ──────────────────────────────────────────────────────────────

export const AnimatedForm = memo(function AnimatedForm({
  logo,
  header,
  subHeader,
  fields,
  submitButton,
  submitDisabled = false,
  errorField,
  onSubmit,
  footerNote,
  forgotPasswordLink,
}) {
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [errors, setErrors] = useState({});

  const validate = (event) => {
    const currentErrors = {};
    fields.forEach((field) => {
      const value = event.target[field.id]?.value;
      if (field.required && !value) {
        currentErrors[field.id] = `${field.label} is required`;
      }
      if (field.type === 'email' && value && !/\S+@\S+\.\S+/.test(value)) {
        currentErrors[field.id] = 'Invalid email address';
      }
    });
    return currentErrors;
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    const formErrors = validate(event);
    if (Object.keys(formErrors).length > 0) {
      setErrors(formErrors);
    } else {
      setErrors({});
      onSubmit(event);
    }
  };

  return (
    <section className="flex flex-col gap-4 w-full max-w-sm mx-auto">
      {logo && (
        <BoxReveal boxColor="var(--skeleton)" duration={0.3} width="100%">
          <div className="hidden lg:flex justify-center mb-1">
            <img src={logo} alt="App logo" className="h-16 w-auto object-contain" />
          </div>
        </BoxReveal>
      )}

      <BoxReveal boxColor="var(--skeleton)" duration={0.3}>
        <h2 className="font-bold text-3xl text-neutral-800">
          {header}
        </h2>
      </BoxReveal>

      {subHeader && (
        <BoxReveal boxColor="var(--skeleton)" duration={0.3} className="pb-1">
          <p className="text-neutral-500 text-sm">
            {subHeader}
          </p>
        </BoxReveal>
      )}

      <form onSubmit={handleSubmit} noValidate autoComplete="off" className="flex flex-col gap-4">
        {fields.map((field) => (
          <section key={field.id} className="flex flex-col gap-1.5">
            <BoxReveal boxColor="var(--skeleton)" duration={0.3}>
              <AnimatedLabel htmlFor={field.id}>
                {field.label}
                {field.required && <span className="text-red-500 ml-0.5">*</span>}
              </AnimatedLabel>
            </BoxReveal>

            <BoxReveal
              width="100%"
              boxColor="var(--skeleton)"
              duration={0.3}
              className="w-full"
            >
              <div className="relative">
                <AnimatedInput
                  id={field.id}
                  name={field.id}
                  type={
                    field.type === 'password'
                      ? passwordVisible
                        ? 'text'
                        : 'password'
                      : field.type
                  }
                  placeholder={field.placeholder}
                  autoComplete={field.autoComplete}
                  onChange={field.onChange}
                  {...(field.inputProps || {})}
                />
                {field.type === 'password' && (
                  <button
                    type="button"
                    onClick={() => setPasswordVisible((v) => !v)}
                    className="absolute inset-y-0 right-0 pr-3 flex items-center text-neutral-400 hover:text-neutral-600:text-neutral-200"
                  >
                    {passwordVisible ? (
                      <Eye className="h-4 w-4" />
                    ) : (
                      <EyeOff className="h-4 w-4" />
                    )}
                  </button>
                )}
              </div>
              {errors[field.id] && (
                <p className="text-red-500 text-xs mt-1">{errors[field.id]}</p>
              )}
            </BoxReveal>
          </section>
        ))}

        {forgotPasswordLink && (
          <BoxReveal width="100%" boxColor="var(--skeleton)" duration={0.3}>
            <div className="flex justify-end">
              {forgotPasswordLink}
            </div>
          </BoxReveal>
        )}

        {errorField && (
          <BoxReveal width="100%" boxColor="var(--skeleton)" duration={0.3}>
            <p className="text-red-500 text-sm">{errorField}</p>
          </BoxReveal>
        )}

        <BoxReveal width="100%" boxColor="var(--skeleton)" duration={0.3} overflow="visible">
          <button
            type="submit"
            disabled={submitDisabled}
            className="relative group/btn w-full h-10 rounded-md font-medium text-white outline-none disabled:opacity-60 disabled:cursor-not-allowed overflow-hidden"
            style={{ background: 'linear-gradient(135deg, #07438C 0%, #1C94AE 100%)' }}
          >
            {/* Grain / noise overlay */}
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-0"
              style={{
                backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='250' height='250'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='4' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='250' height='250' filter='url(%23n)' opacity='1'/%3E%3C/svg%3E")`,
                mixBlendMode: 'overlay',
                opacity: 0.18,
              }}
            />
            {/* Soft blur glow */}
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 rounded-md"
              style={{
                background: 'radial-gradient(ellipse at 50% 0%, rgba(255,255,255,0.22) 0%, transparent 70%)',
              }}
            />
            <span className="relative z-10">{submitButton} &rarr;</span>
            <BottomGradient />
          </button>
        </BoxReveal>
      </form>

      {footerNote && (
        <BoxReveal boxColor="var(--skeleton)" duration={0.3} width="100%">
          <p className="text-center text-xs text-neutral-500 pt-1">
            {footerNote}
          </p>
        </BoxReveal>
      )}
    </section>
  );
});
