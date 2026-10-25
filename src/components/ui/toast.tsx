import * as React from 'react';
import { cn } from '../../lib/utils.ts';

export type ToastVariant = 'default' | 'info' | 'success' | 'warning' | 'destructive';

export interface ToastData {
  id: string;
  title?: React.ReactNode;
  description?: React.ReactNode;
  variant?: ToastVariant;
  duration?: number;
}

export interface ToastProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: ToastVariant;
  duration?: number;
  onDismiss?: () => void;
}

const variantStyles: Record<ToastVariant, string> = {
  default: 'bg-card text-card-foreground border-border shadow-lg',
  info: 'bg-surface-base text-foreground border-border shadow-lg',
  success:
    'bg-surface-base text-foreground border-state-success/40 ring-1 ring-state-success/20 shadow-lg',
  warning:
    'bg-surface-base text-foreground border-state-warning/40 ring-1 ring-state-warning/20 shadow-lg',
  destructive: 'border-transparent bg-state-danger text-destructive-foreground shadow-lg',
};

export const Toast = React.forwardRef<HTMLDivElement, ToastProps>(
  (
    {
      className,
      variant = 'default',
      duration = 5000,
      onDismiss,
      children,
      onMouseEnter,
      onMouseLeave,
      onFocus,
      onBlur,
      ...props
    },
    ref,
  ) => {
    const isAlert = variant === 'destructive';
    const [isPaused, setIsPaused] = React.useState(false);

    React.useEffect(() => {
      if (!duration || duration <= 0 || isPaused) return;
      const timer = window.setTimeout(() => {
        onDismiss?.();
      }, duration);
      return () => {
        window.clearTimeout(timer);
      };
    }, [duration, isPaused, onDismiss]);

    const handleMouseEnter = (e: React.MouseEvent<HTMLDivElement>) => {
      setIsPaused(true);
      onMouseEnter?.(e);
    };

    const handleMouseLeave = (e: React.MouseEvent<HTMLDivElement>) => {
      setIsPaused(false);
      onMouseLeave?.(e);
    };

    const handleFocus = (e: React.FocusEvent<HTMLDivElement>) => {
      setIsPaused(true);
      onFocus?.(e);
    };

    const handleBlur = (e: React.FocusEvent<HTMLDivElement>) => {
      setIsPaused(false);
      onBlur?.(e);
    };

    return (
      <div
        ref={ref}
        role={isAlert ? 'alert' : 'status'}
        aria-live={isAlert ? 'assertive' : 'polite'}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onFocus={handleFocus}
        onBlur={handleBlur}
        className={cn(
          'pointer-events-auto flex w-full items-start justify-between gap-3 rounded-lg border p-4 shadow-lg transition-all duration-150 motion-reduce:transition-none',
          variantStyles[variant],
          className,
        )}
        {...props}
      >
        <div className="grid gap-1">{children}</div>
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss notification"
            className="inline-flex h-8 w-8 min-h-[44px] min-w-[44px] pointer-coarse:min-h-[44px] pointer-coarse:min-w-[44px] shrink-0 items-center justify-center rounded-md opacity-70 transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        )}
      </div>
    );
  },
);
Toast.displayName = 'Toast';

export const ToastTitle = React.forwardRef<
  HTMLHeadingElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <h4
    ref={ref}
    className={cn('text-sm font-semibold leading-tight text-foreground', className)}
    {...props}
  />
));
ToastTitle.displayName = 'ToastTitle';

export const ToastDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p
    ref={ref}
    className={cn('text-xs text-muted-foreground leading-normal', className)}
    {...props}
  />
));
ToastDescription.displayName = 'ToastDescription';

export const ToastViewport = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'fixed bottom-4 right-4 z-50 flex max-h-screen w-full max-w-[420px] flex-col gap-2 p-4 pointer-events-none sm:bottom-4 sm:right-4',
        className,
      )}
      {...props}
    />
  ),
);
ToastViewport.displayName = 'ToastViewport';

interface ToastContextValue {
  toasts: ToastData[];
  toast: (options: Omit<ToastData, 'id'>) => void;
  dismiss: (id: string) => void;
}

const ToastContext = React.createContext<ToastContextValue | null>(null);

export const ToastProvider = ({ children }: { children: React.ReactNode }) => {
  const [toasts, setToasts] = React.useState<ToastData[]>([]);

  const dismiss = React.useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = React.useCallback(
    ({ title, description, variant = 'default', duration = 5000 }: Omit<ToastData, 'id'>) => {
      const id = Math.random().toString(36).substring(2, 9);
      setToasts((prev) => [...prev, { id, title, description, variant, duration }]);
    },
    [],
  );

  return (
    <ToastContext.Provider value={{ toasts, toast, dismiss }}>
      {children}
      <ToastViewport>
        {toasts.map((t) => (
          <Toast
            key={t.id}
            variant={t.variant}
            duration={t.duration}
            onDismiss={() => dismiss(t.id)}
          >
            {t.title && <ToastTitle>{t.title}</ToastTitle>}
            {t.description && <ToastDescription>{t.description}</ToastDescription>}
          </Toast>
        ))}
      </ToastViewport>
    </ToastContext.Provider>
  );
};

// eslint-disable-next-line react-refresh/only-export-components
export const useToast = () => {
  const context = React.useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
};
