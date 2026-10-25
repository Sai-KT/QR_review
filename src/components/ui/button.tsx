import * as React from 'react';
import { cn } from '../../lib/utils.ts';

export type ButtonVariant =
  'default' | 'secondary' | 'outline' | 'ghost' | 'destructive' | 'accent' | 'link';

export type ButtonSize = 'default' | 'sm' | 'lg' | 'touch' | 'icon' | 'icon-touch';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  isLoading?: boolean;
}

const variantStyles: Record<ButtonVariant, string> = {
  default: 'bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 active:scale-[0.98]',
  secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80 active:scale-[0.98]',
  outline:
    'border border-border bg-surface-base text-foreground shadow-sm hover:bg-muted active:scale-[0.98]',
  ghost: 'text-foreground hover:bg-muted active:scale-[0.98]',
  destructive:
    'bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90 active:scale-[0.98]',
  accent: 'bg-brand-accent text-white shadow-sm hover:bg-brand-accent/90 active:scale-[0.98]',
  link: 'text-brand-accent underline-offset-4 hover:underline p-0 h-auto font-normal',
};

const sizeStyles: Record<ButtonSize, string> = {
  default: 'h-10 px-4 py-2 text-sm pointer-coarse:min-h-[44px] pointer-coarse:min-w-[44px]',
  sm: 'h-8 px-3 text-xs rounded-md pointer-coarse:min-h-[44px] pointer-coarse:min-w-[44px]',
  lg: 'h-11 min-h-[44px] min-w-[44px] px-8 text-base rounded-md',
  touch: 'min-h-[48px] min-w-[48px] px-6 text-base rounded-md touch-target-preferred',
  icon: 'h-10 w-10 p-0 pointer-coarse:min-h-[44px] pointer-coarse:min-w-[44px]',
  'icon-touch': 'h-12 w-12 min-h-[48px] min-w-[48px] p-0 touch-target-preferred',
};

const buttonVariants = (options?: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
}): string => {
  const variant = options?.variant ?? 'default';
  const size = options?.size ?? 'default';
  return cn(
    'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md font-medium transition-all duration-150',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background',
    'disabled:pointer-events-none disabled:opacity-50 disabled:cursor-not-allowed',
    'motion-reduce:transition-none motion-reduce:active:scale-100',
    variantStyles[variant],
    sizeStyles[size],
    options?.className,
  );
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant = 'default',
      size = 'default',
      type = 'button',
      disabled,
      isLoading,
      'aria-busy': ariaBusyProp,
      ...props
    },
    ref,
  ) => {
    const isBusy = isLoading || ariaBusyProp === true || ariaBusyProp === 'true';

    return (
      <button
        ref={ref}
        type={type}
        disabled={disabled || isLoading}
        aria-disabled={disabled || isLoading}
        aria-busy={isBusy ? true : undefined}
        className={buttonVariants({ variant, size, className })}
        {...props}
      />
    );
  },
);
Button.displayName = 'Button';
