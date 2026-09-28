import { useId, useState, type ButtonHTMLAttributes, type FormEvent, type InputHTMLAttributes, type ReactNode } from 'react';
import { errorMessage } from './api.ts';

/** Form submit handler with busy + error state. */
export function useSubmit(action: () => Promise<void>) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return { submit, error, busy };
}

const buttonStyles = {
  primary: 'bg-orange-600 text-white hover:bg-orange-700 shadow-sm',
  secondary: 'bg-white text-stone-800 ring-1 ring-stone-300 hover:bg-stone-50',
  ghost: 'text-stone-600 hover:bg-stone-100',
  danger: 'text-rose-700 hover:bg-rose-50',
};

export function Button({ variant = 'primary', className = '', ...props }: { variant?: keyof typeof buttonStyles } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition disabled:opacity-50 ${buttonStyles[variant]} ${className}`}
      {...props}
    />
  );
}

export function Field({ label, hint, ...props }: { label: string; hint?: ReactNode } & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-stone-700">
        {label}
      </label>
      <input
        id={id}
        className="rounded-xl border border-stone-300 bg-white px-3 py-2.5 text-base shadow-inner outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-200"
        {...props}
      />
      {hint && <p className="text-xs text-stone-500">{hint}</p>}
    </div>
  );
}

export const PinField = (props: { label: string; value: string; onChange: (pin: string) => void }) => (
  <Field
    label={props.label}
    type="password"
    inputMode="numeric"
    autoComplete="off"
    pattern="\d{4}"
    maxLength={4}
    required
    value={props.value}
    onChange={(e) => props.onChange(e.target.value.replace(/\D/g, ''))}
  />
);

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-2xl bg-white p-5 shadow-sm ring-1 ring-stone-200 ${className}`}>{children}</div>;
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id}>
      <Card className="flex flex-col gap-4">
        <h2 id={id} className="text-lg font-bold">
          {title}
        </h2>
        {children}
      </Card>
    </section>
  );
}

export function Notice({ tone, children }: { tone: 'error' | 'ok' | 'info'; children: ReactNode }) {
  const styles = { error: 'bg-rose-50 text-rose-800 ring-rose-200', ok: 'bg-emerald-50 text-emerald-800 ring-emerald-200', info: 'bg-amber-50 text-amber-900 ring-amber-200' };
  return (
    <p role={tone === 'error' ? 'alert' : 'status'} className={`rounded-xl px-3 py-2 text-sm ring-1 ${styles[tone]}`}>
      {children}
    </p>
  );
}

export function PinWarning() {
  return (
    <Notice tone="info">
      🔓 Your PIN is a light lock to keep friends out of each other's rankings — it's not real security. Don't reuse a bank or phone PIN.
    </Notice>
  );
}
