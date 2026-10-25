import * as React from 'react';
import { cn } from '../../lib/utils.ts';

export interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  shimmer?: boolean;
}

export const Skeleton = React.forwardRef<HTMLDivElement, SkeletonProps>(
  ({ className, shimmer = false, ...props }, ref) => {
    return (
      <div
        ref={ref}
        aria-hidden="true"
        className={cn(
          'rounded-md bg-surface-muted transition-colors',
          shimmer
            ? 'relative overflow-hidden before:absolute before:inset-0 before:-translate-x-full before:animate-[shimmer_1.8s_infinite] motion-reduce:before:animate-none before:bg-gradient-to-r before:from-transparent before:via-white/40 before:to-transparent'
            : 'animate-pulse motion-reduce:animate-none',
          className,
        )}
        {...props}
      />
    );
  },
);
Skeleton.displayName = 'Skeleton';
