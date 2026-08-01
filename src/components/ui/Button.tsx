import React from 'react';
import { clsx } from 'clsx';
import { Lock } from 'lucide-react';

export type ButtonVariant =
  | 'primary'      // Solid emerald – main page actions
  | 'secondary'    // White / outlined – secondary actions
  | 'destructive'  // Red outlined or solid
  | 'ghost'        // Text link style
  | 'icon'         // Icon tile / FAB
  | 'muted';       // Locked feature

export type ButtonSize = 'sm' | 'md' | 'lg' | 'icon';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  isLoading?: boolean;
  locked?: boolean;
  lockLabel?: string;
  children: React.ReactNode;
}

const baseStyles =
  'inline-flex items-center justify-center font-medium transition-all active:scale-[0.985] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 disabled:opacity-60 disabled:cursor-not-allowed touch-manipulation';

const variantStyles: Record<ButtonVariant, string> = {
  primary: 'bg-brand-500 text-white shadow-sm hover:bg-brand-600 active:bg-brand-700',
  secondary: 'border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 hover:text-gray-900 shadow-sm',
  destructive: 'border border-red-200 bg-white text-red-600 hover:bg-red-50 hover:text-red-700',
  ghost: 'text-gray-600 hover:text-brand-700 hover:bg-gray-50 px-2',
  icon: 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50 shadow-sm',
  muted: 'bg-gray-100 text-gray-400 border border-gray-200 cursor-not-allowed',
};

const sizeStyles: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-xs rounded-lg gap-1.5',
  md: 'h-10 px-4 text-sm rounded-xl gap-2',
  lg: 'h-12 px-6 text-base rounded-xl gap-2.5',
  icon: 'h-10 w-10 p-0 rounded-xl',
};

export function Button({
  variant = 'primary',
  size = 'md',
  isLoading = false,
  locked = false,
  lockLabel = 'Upgrade required',
  className,
  children,
  disabled,
  ...props
}: ButtonProps) {
  const isDisabled = disabled || isLoading || locked;

  return (
    <button
      className={clsx(
        baseStyles,
        variantStyles[variant],
        sizeStyles[size],
        locked && variantStyles.muted,
        className
      )}
      disabled={isDisabled}
      aria-disabled={isDisabled}
      {...props}
    >
      {locked && <Lock className="h-3.5 w-3.5" />}
      {isLoading ? (
        <span className="flex items-center gap-2">
          <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
          {typeof children === 'string' ? children : null}
        </span>
      ) : (
        children
      )}
      {locked && lockLabel && size !== 'icon' && (
        <span className="ml-1.5 text-[10px] font-normal tracking-wide opacity-75">
          {lockLabel}
        </span>
      )}
    </button>
  );
}

// Convenience exports for common use cases
export const PrimaryButton = (props: Omit<ButtonProps, 'variant'>) => (
  <Button variant="primary" {...props} />
);

export const SecondaryButton = (props: Omit<ButtonProps, 'variant'>) => (
  <Button variant="secondary" {...props} />
);

export const DestructiveButton = (props: Omit<ButtonProps, 'variant'>) => (
  <Button variant="destructive" {...props} />
);

export const GhostButton = (props: Omit<ButtonProps, 'variant'>) => (
  <Button variant="ghost" {...props} />
);
