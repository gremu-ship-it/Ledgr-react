import { useState, type InputHTMLAttributes, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Eye, EyeOff, AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
import { clsx } from 'clsx';

interface FormFieldProps {
  id: string;
  label: string;
  error?: string;
  children: ReactNode;
  hint?: string;
}

export function FormField({ id, label, error, hint, children }: FormFieldProps) {
  const errorId = error ? `${id}-error` : undefined;
  const hintId = hint ? `${id}-hint` : undefined;
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-gray-700">
        {label}
      </label>
      {hint && (
        <p id={hintId} className="mb-1.5 text-xs text-gray-600">
          {hint}
        </p>
      )}
      {children}
      {error && (
        <p
          id={errorId}
          role="alert"
          className="mt-1.5 flex items-center gap-1 text-xs font-medium text-red-700"
        >
          <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {error}
        </p>
      )}
    </div>
  );
}

export function Input({
  className,
  hasError,
  'aria-invalid': ariaInvalid,
  'aria-describedby': ariaDescribedBy,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { hasError?: boolean }) {
  return (
    <input
      aria-invalid={ariaInvalid ?? (hasError ? true : undefined)}
      aria-describedby={ariaDescribedBy}
      className={clsx(
        'block w-full rounded-lg border px-3 py-2 text-sm text-gray-900',
        'placeholder:text-gray-500',
        hasError
          ? 'border-red-400 focus:border-red-500 focus:ring-red-500'
          : 'border-gray-300 focus:border-brand-600 focus:ring-brand-600',
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
  const { t } = useTranslation();
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input type={show ? 'text' : 'password'} id={id} className="pr-10" {...props} />
      <button
        type="button"
        onClick={() => setShow((v) => !v)}
        className="absolute inset-y-0 right-0 flex items-center pr-3 text-gray-400 hover:text-gray-600"
        aria-label={show ? t('auth.hidePassword') : t('auth.showPassword')}
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

// Shared by register/reset validation as well as the visual meter.
// eslint-disable-next-line react-refresh/only-export-components
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
    1: { label: 'auth.strengthVeryWeak', color: 'bg-red-400' },
    2: { label: 'auth.strengthWeak', color: 'bg-orange-400' },
    3: { label: 'auth.strengthGood', color: 'bg-yellow-400' },
    4: { label: 'auth.strengthStrong', color: 'bg-brand-500' },
  };
  return { score: clamped, ...map[clamped] };
}

export function PasswordStrengthMeter({ password }: { password: string }) {
  const { t } = useTranslation();
  const { score, label, color } = measureStrength(password);
  if (!password) return null;
  return (
    <div className="mt-2" aria-label="Password strength">
      <div className="flex gap-1" role="meter" aria-valuemin={0} aria-valuemax={4} aria-valuenow={score} aria-label="Password strength">
        {[1, 2, 3, 4].map((n) => (
          <div
            key={n}
            aria-hidden="true"
            className={clsx(
              'h-1 flex-1 rounded-full transition-all duration-300',
              score >= n ? color : 'bg-gray-200',
            )}
          />
        ))}
      </div>
      <p
        aria-live="polite"
        className={clsx('mt-1 text-xs font-medium',
          score <= 2 ? 'text-red-700' : score === 3 ? 'text-amber-800' : 'text-brand-700')}
      >
        {label ? t(label) : ''}
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
    error:   { bg: 'bg-red-50',    border: 'border-red-200',   icon: 'text-red-700',   text: 'text-red-800',   Icon: AlertCircle,  role: 'alert' as const },
    success: { bg: 'bg-brand-50',  border: 'border-brand-200', icon: 'text-brand-700', text: 'text-brand-800', Icon: CheckCircle2, role: 'status' as const },
    info:    { bg: 'bg-blue-50',   border: 'border-blue-200',  icon: 'text-blue-800',  text: 'text-blue-800',  Icon: AlertCircle,  role: 'status' as const },
  };
  const { bg, border, icon, text, Icon, role } = styles[type];
  return (
    <div
      role={role}
      aria-live={type === 'error' ? 'assertive' : 'polite'}
      className={clsx('flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-sm', bg, border)}
    >
      <Icon className={clsx('mt-0.5 h-4 w-4 shrink-0', icon)} aria-hidden="true" />
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
      aria-busy={loading}
      className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
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
    <div
      className="flex justify-center gap-2"
      role="group"
      aria-label="One-time passcode, 6 digits"
    >
      {digits.map((digit, i) => (
        <input
          key={i}
          id={`otp-${i}`}
          type="text"
          inputMode="numeric"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          pattern="\d*"
          maxLength={1}
          value={digit}
          disabled={disabled}
          aria-label={i === 0 ? 'One-time passcode. Digit 1 of 6.' : `Digit ${i + 1} of 6`}
          onChange={(e) => handleChange(i, e.target.value)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          onPaste={i === 0 ? handlePaste : undefined}
          className="h-12 w-10 rounded-lg border border-gray-300 text-center text-lg font-semibold text-gray-900 focus:border-brand-600 focus:outline-none focus:ring-1 focus:ring-brand-600 disabled:bg-gray-50 disabled:text-gray-500"
        />
      ))}
    </div>
  );
}