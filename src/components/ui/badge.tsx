import * as React from 'react';
import { cn } from '../../lib/utils.ts';

export type BadgeVariant =
  'default' | 'secondary' | 'outline' | 'destructive' | 'success' | 'warning' | 'accent';

export type BadgeShape = 'default' | 'pill';
export type BadgeSize = 'default' | 'sm' | 'lg';

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: BadgeVariant;
  shape?: BadgeShape;
  size?: BadgeSize;
}

const variantStyles: Record<BadgeVariant, string> = {
  default: 'border-transparent bg-primary text-primary-foreground',
  secondary: 'border-transparent bg-secondary text-secondary-foreground',
  outline: 'border-border text-foreground',
  destructive: 'border-transparent bg-state-danger text-destructive-foreground',
  success: 'border-state-success/20 bg-state-success-bg text-state-success',
  warning: 'border-state-warning/20 bg-state-warning-bg text-state-warning',
  accent: 'border-brand-accent/20 bg-brand-accent/10 text-blue-700',
};

const shapeStyles: Record<BadgeShape, string> = {
  default: 'rounded-sm',
  pill: 'rounded-full',
};

const sizeStyles: Record<BadgeSize, string> = {
  default: 'px-2.5 py-0.5 text-xs font-semibold',
  sm: 'px-2 py-0.5 text-[11px] font-medium',
  lg: 'px-3 py-1 text-sm font-semibold',
};

const badgeVariants = (options?: {
  variant?: BadgeVariant;
  shape?: BadgeShape;
  size?: BadgeSize;
  className?: string;
}): string => {
  const variant = options?.variant ?? 'default';
  const shape = options?.shape ?? 'default';
  const size = options?.size ?? 'default';
  return cn(
    'inline-flex items-center gap-1 border font-medium transition-colors',
    variantStyles[variant],
    shapeStyles[shape],
    sizeStyles[size],
    options?.className,
  );
};

export const Badge = React.forwardRef<HTMLDivElement, BadgeProps>(
  ({ className, variant = 'default', shape = 'default', size = 'default', ...props }, ref) => {
    return (
      <div ref={ref} className={badgeVariants({ variant, shape, size, className })} {...props} />
    );
  },
);
Badge.displayName = 'Badge';
