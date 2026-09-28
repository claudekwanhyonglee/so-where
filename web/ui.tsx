import { X } from 'lucide-react';
import {
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type FormEvent,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react';
import { errorMessage } from './api.ts';
import { swatch } from './model.ts';

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
  primary: 'bg-tomato text-white shadow-[0_6px_14px_-6px_rgba(232,67,44,.6)] hover:bg-tomato-deep',
  secondary: 'ring-[1.5px] ring-inset ring-[#e2cfc4] hover:bg-soft',
  cream: 'bg-peach text-ink',
  ghost: 'text-muted hover:text-ink',
  danger: 'text-stamp hover:bg-blush',
};

export function Button({ variant = 'primary', className = '', ...props }: { variant?: keyof typeof buttonStyles } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-full px-[18px] py-[11px] font-bold transition active:scale-[.97] disabled:pointer-events-none disabled:opacity-45 ${buttonStyles[variant]} ${className}`}
      {...props}
    />
  );
}

export function IconButton({ label, className = '', ...props }: { label: string } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      aria-label={label}
      title={label}
      className={`grid size-[38px] flex-none place-items-center rounded-full bg-white ring-1 ring-edge hover:bg-soft ${className}`}
      {...props}
    />
  );
}

export const inputBox = 'rounded-2xl bg-white px-3.5 py-2.5 text-base ring-[1.5px] ring-edge outline-none focus:ring-2 focus:ring-tomato';

export function Field({ label, hint, error, ...props }: { label: string; hint?: ReactNode; error?: string } & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[13px] font-bold">
        {label}
      </label>
      <input id={id} aria-invalid={!!error || undefined} className={inputBox} {...props} />
      {error ? (
        <p role="alert" className="text-[13px] font-semibold text-stamp">
          {error}
        </p>
      ) : (
        hint && <p className="text-xs text-muted">{hint}</p>
      )}
    </div>
  );
}

export function Select({ label, children, ...props }: { label: string } & SelectHTMLAttributes<HTMLSelectElement>) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[13px] font-bold">
        {label}
      </label>
      <select id={id} className={inputBox} {...props}>
        {children}
      </select>
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
  return <div className={`rounded-[22px] bg-white p-5 ring-1 ring-edge ${className}`}>{children}</div>;
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id}>
      <Card className="flex flex-col gap-4">
        <h2 id={id} className="font-display text-[22px]/tight">
          {title}
        </h2>
        {children}
      </Card>
    </section>
  );
}

export function Notice({ tone, children }: { tone: 'error' | 'ok' | 'info'; children: ReactNode }) {
  const styles = { error: 'bg-blush text-stamp ring-stamp/30', ok: 'bg-[#e9f6ef] text-leaf ring-[#bfe3cf]', info: 'bg-white text-[#6d5249] ring-edge' };
  return (
    <p role={tone === 'error' ? 'alert' : 'status'} className={`rounded-[14px] px-3 py-2.5 text-[13px] ring-1 ${styles[tone]}`}>
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

export const Eyebrow = ({ children }: { children: ReactNode }) => <span className="text-[11px] font-bold tracking-[.07em] text-muted uppercase">{children}</span>;

/** A person's coloured initial. */
export function Avatar({ person, size = 'sm' }: { person: { id: number; name: string }; size?: 'sm' | 'lg' }) {
  const { bg, fg } = swatch(person.id);
  const sizes = { sm: 'size-7 rounded-full text-xs font-bold ring-2 ring-peach', lg: 'size-16 rounded-[22px] font-display text-[28px]' };
  return (
    <span title={person.name} aria-hidden="true" style={{ background: bg, color: fg }} className={`inline-grid flex-none place-items-center ${sizes[size]}`}>
      {person.name[0]?.toUpperCase()}
    </span>
  );
}

export const Avatars = ({ people }: { people: { id: number; name: string }[] }) => (
  <span className="flex [&>*+*]:-ml-2">
    {people.map((p) => (
      <Avatar key={p.id} person={p} />
    ))}
  </span>
);

/**
 * A modal sheet on the native <dialog>: a bottom sheet on phones, a centred dialog on desktops.
 * Mount it to open it; it calls `onClose` on Esc, the backdrop or its close button.
 */
export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(e) => e.target === e.currentTarget && onClose()}
      className="mx-0 mt-auto mb-0 max-h-[88dvh] w-full max-w-none overflow-y-auto rounded-t-[28px] bg-peach p-0 text-ink shadow-[0_30px_60px_-20px_rgba(0,0,0,.45)] backdrop:bg-ink/40 desk:m-auto desk:max-w-[460px] desk:rounded-[28px]"
    >
      <div className="flex flex-col gap-3.5 p-5 pb-[calc(22px+env(safe-area-inset-bottom,0px))] desk:pb-5">
        <span aria-hidden="true" className="-mt-2 mb-0.5 h-[5px] w-10 self-center rounded-full bg-[#e2cfc4] desk:hidden" />
        <div className="flex items-center gap-2.5">
          <h2 id={titleId} className="flex-1 font-display text-2xl/tight">
            {title}
          </h2>
          <IconButton label="Close" onClick={onClose}>
            <X size={18} />
          </IconButton>
        </div>
        {children}
      </div>
    </dialog>
  );
}
