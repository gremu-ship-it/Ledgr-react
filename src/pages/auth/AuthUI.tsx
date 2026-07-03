import { useState, type InputHTMLAttributes, type ReactNode } from 'react';
import { Eye, EyeOff, AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
import { clsx } from 'clsx';

interface FormFieldProps {
  id: string;
  label: string;
  error?: string;
  children: ReactNode;
}

export function FormField({ id, label, error, children }: FormFieldProps) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-gray-700">
        {label}
      </label>
      {children}
      {error && (
        <p className="mt-1.5 flex items-center gap-1 text-xs text-red-600">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          {error}
        </p>
      )}
    </div>
  );
}

export function Input({
  className,
  hasError,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { hasError?: boolean }) {
  return (
    <input
      className={clsx(
        'block w-full rounded-lg border px-3 py-2 text-sm text-gray-900',
        'placeholder:text-gray-400',
        'focus:outline-none focus:ring-1',
        hasError
          ? 'border-red-300 focus:border-red-400 focus:ring-red-400'
          : 'border-gray-300 focus:border-brand-500 focus:ring-brand-500',
        className,
      )}
      {...props}
    />
  );
}

export function PasswordInput({
  id,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & { id: string }) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input type={show ? 'text' : 'password'} id={id} className="pr-10" {...props} />
      <button
        type="button"
        onClick={() => setShow((v) => !v)}
        className="absolute inset-y-0 right-0 flex items-center pr-3 text-gray-400 hover:text-gray-600"
        aria-label={show ? 'Hide password' : 'Show password'}
        tabIndex={-1}
      >
        {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}

interface StrengthResult {
  score: 0 | 1 | 2 | 3 | 4;
  label: string;
  color: string;
}

export function measureStrength(password: string): StrengthResult {
  if (!password) return { score: 0, label: '', color: 'bg-gray-200' };
  let score = 0;
  if (password.length >= 8) score++;
  if (password.length >= 12) score++;
  if (/[A-Z]/.test(password) && /[a-z]/.test(password)) score++;
  if (/\d/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;
  const clamped = Math.min(4, score) as StrengthResult['score'];
  const map: Record<StrengthResult['score'], Omit<StrengthResult, 'score'>> = {
    0: { label: '', color: 'bg-gray-200' },
    1: { label: 'Very weak', color: 'bg-red-400' },
    2: { label: 'Weak', color: 'bg-orange-400' },
    3: { label: 'Good', color: 'bg-yellow-400' },
    4: { label: 'Strong', color: 'bg-brand-500' },
  };
  return { score: clamped, ...map[clamped] };
}

export function PasswordStrengthMeter({ password }: { password: string }) {
  const { score, label, color } = measureStrength(password);
  if (!password) return null;
  return (
    <div className="mt-2">
      <div className="flex gap-1">
        {[1, 2, 3, 4].map((n) => (
          <div
            key={n}
            className={clsx(
              'h-1 flex-1 rounded-full transition-all duration-300',
              score >= n ? color : 'bg-gray-200',
            )}
          />
        ))}
      </div>
      <p className={clsx('mt-1 text-xs font-medium',
        score <= 2 ? 'text-red-500' : score === 3 ? 'text-yellow-600' : 'text-brand-600')}>
        {label}
      </p>
    </div>
  );
}

interface AuthAlertProps {
  type: 'error' | 'success' | 'info';
  message: string;
}

export function AuthAlert({ type, message }: AuthAlertProps) {
  const styles = {
    error:   { bg: 'bg-red-50',    border: 'border-red-200',   icon: 'text-red-500',   text: 'text-red-700',   Icon: AlertCircle  },
    success: { bg: 'bg-brand-50',  border: 'border-brand-200', icon: 'text-brand-500', text: 'text-brand-700', Icon: CheckCircle2 },
    info:    { bg: 'bg-blue-50',   border: 'border-blue-200',  icon: 'text-blue-500',  text: 'text-blue-700',  Icon: AlertCircle  },
  };
  const { bg, border, icon, text, Icon } = styles[type];
  return (
    <div className={clsx('flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-sm', bg, border)}>
      <Icon className={clsx('mt-0.5 h-4 w-4 shrink-0', icon)} />
      <span className={text}>{message}</span>
    </div>
  );
}

interface SubmitButtonProps {
  loading: boolean;
  label: string;
  loadingLabel?: string;
}

export function SubmitButton({ loading, label, loadingLabel }: SubmitButtonProps) {
  return (
    <button
      type="submit"
      disabled={loading}
      className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand-500 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" />}
      {loading ? (loadingLabel ?? label) : label}
    </button>
  );
}

interface OTPInputProps {
  value: string;
  onChange: (val: string) => void;
  disabled?: boolean;
}

export function OTPInput({ value, onChange, disabled }: OTPInputProps) {
  const digits = value.padEnd(6, '').slice(0, 6).split('');

  function handleChange(index: number, char: string) {
    const newDigits = [...digits];
    newDigits[index] = char.replace(/\D/g, '').slice(-1);
    onChange(newDigits.join('').slice(0, 6));
    if (char && index < 5) {
      (document.getElementById(`otp-${index + 1}`) as HTMLInputElement)?.focus();
    }
  }

  function handleKeyDown(index: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace') {
      if (!digits[index] && index > 0) {
        (document.getElementById(`otp-${index - 1}`) as HTMLInputElement)?.focus();
      }
      const newDigits = [...digits];
      newDigits[index] = '';
      onChange(newDigits.join(''));
    } else if (e.key === 'ArrowLeft' && index > 0) {
      (document.getElementById(`otp-${index - 1}`) as HTMLInputElement)?.focus();
    } else if (e.key === 'ArrowRight' && index < 5) {
      (document.getElementById(`otp-${index + 1}`) as HTMLInputElement)?.focus();
    }
  }

  function handlePaste(e: React.ClipboardEvent) {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    onChange(pasted.padEnd(6, '').slice(0, 6));
    const last = Math.min(pasted.length - 1, 5);
    (document.getElementById(`otp-${last}`) as HTMLInputElement)?.focus();
  }

  return (
    <div className="flex justify-center gap-2">
      {digits.map((digit, i) => (
        <input
          key={i}
          id={`otp-${i}`}
          type="text"
          inputMode="numeric"
          pattern="\d*"
          maxLength={1}
          value={digit}
          disabled={disabled}
          onChange={(e) => handleChange(i, e.target.value)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          onPaste={i === 0 ? handlePaste : undefined}
          className="h-12 w-10 rounded-lg border border-gray-300 text-center text-lg font-semibold text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:bg-gray-50 disabled:text-gray-400"
        />
      ))}
    </div>
  );
}