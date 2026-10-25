import * as React from 'react';
import { cn } from '../../lib/utils.ts';

export type InputSize = 'default' | 'sm' | 'touch';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  inputSize?: InputSize;
  isInvalid?: boolean;
}

const inputSizeStyles: Record<InputSize, string> = {
  default: 'h-10 text-sm px-3 py-2 pointer-coarse:min-h-[44px]',
  sm: 'h-8 text-xs px-2.5 py-1 pointer-coarse:min-h-[44px]',
  touch: 'h-12 min-h-[48px] text-base px-4 py-3 touch-target-preferred',
};

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  (
    {
      className,
      type = 'text',
      inputSize = 'default',
      isInvalid,
      disabled,
      'aria-invalid': ariaInvalidProp,
      ...props
    },
    ref,
  ) => {
    const hasError = isInvalid || ariaInvalidProp === true || ariaInvalidProp === 'true';

    return (
      <input
        ref={ref}
        type={type}
        disabled={disabled}
        aria-invalid={hasError ? true : undefined}
        className={cn(
          'flex w-full rounded-md border border-input bg-surface-base text-foreground shadow-sm transition-colors',
          'placeholder:text-muted-foreground',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background',
          'disabled:cursor-not-allowed disabled:opacity-50',
          'file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground',
          inputSizeStyles[inputSize],
          hasError && 'border-state-danger focus-visible:ring-state-danger',
          className,
        )}
        {...props}
      />
    );
  },
);
Input.displayName = 'Input';
