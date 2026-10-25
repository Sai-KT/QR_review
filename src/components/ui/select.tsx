import * as React from 'react';
import { cn } from '../../lib/utils.ts';

export type SelectSize = 'default' | 'sm' | 'touch';

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  selectSize?: SelectSize;
  isInvalid?: boolean;
}

const selectSizeStyles: Record<SelectSize, string> = {
  default: 'h-10 text-sm pl-3 pr-8 py-2 pointer-coarse:min-h-[44px]',
  sm: 'h-8 text-xs pl-2.5 pr-7 py-1 pointer-coarse:min-h-[44px]',
  touch: 'h-12 min-h-[48px] text-base pl-4 pr-10 py-3 touch-target-preferred',
};

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  (
    {
      className,
      selectSize = 'default',
      isInvalid,
      disabled,
      'aria-invalid': ariaInvalidProp,
      children,
      ...props
    },
    ref,
  ) => {
    const hasError = isInvalid || ariaInvalidProp === true || ariaInvalidProp === 'true';

    return (
      <div className="relative w-full">
        <select
          ref={ref}
          disabled={disabled}
          aria-invalid={hasError ? true : undefined}
          className={cn(
            'flex w-full appearance-none rounded-md border border-input bg-surface-base text-foreground shadow-sm transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background',
            'disabled:cursor-not-allowed disabled:opacity-50',
            selectSizeStyles[selectSize],
            hasError && 'border-state-danger focus-visible:ring-state-danger',
            className,
          )}
          {...props}
        >
          {children}
        </select>
        <div
          className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
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
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </div>
      </div>
    );
  },
);
Select.displayName = 'Select';

export const SelectOption = React.forwardRef<
  HTMLOptionElement,
  React.OptionHTMLAttributes<HTMLOptionElement>
>(({ className, ...props }, ref) => (
  <option ref={ref} className={cn('bg-surface-base text-foreground py-1', className)} {...props} />
));
SelectOption.displayName = 'SelectOption';

export const SelectOptgroup = React.forwardRef<
  HTMLOptGroupElement,
  React.OptgroupHTMLAttributes<HTMLOptGroupElement>
>(({ className, ...props }, ref) => (
  <optgroup
    ref={ref}
    className={cn('bg-surface-base text-muted-foreground font-semibold', className)}
    {...props}
  />
));
SelectOptgroup.displayName = 'SelectOptgroup';
