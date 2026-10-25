import * as React from 'react';
import { cn } from '../../lib/utils.ts';

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  isInvalid?: boolean;
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, isInvalid, disabled, 'aria-invalid': ariaInvalidProp, ...props }, ref) => {
    const hasError = isInvalid || ariaInvalidProp === true || ariaInvalidProp === 'true';

    return (
      <textarea
        ref={ref}
        disabled={disabled}
        aria-invalid={hasError ? true : undefined}
        className={cn(
          'flex min-h-[80px] w-full rounded-md border border-input bg-surface-base px-3 py-2 text-sm text-foreground shadow-sm transition-colors',
          'placeholder:text-muted-foreground',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background',
          'disabled:cursor-not-allowed disabled:opacity-50',
          hasError && 'border-state-danger focus-visible:ring-state-danger',
          className,
        )}
        {...props}
      />
    );
  },
);
Textarea.displayName = 'Textarea';
