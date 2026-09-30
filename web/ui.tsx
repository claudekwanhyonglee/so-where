import { Check, Lock, MapPin, X } from 'lucide-react';
import {
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type ButtonHTMLAttributes,
  type FormEvent,
  type ComponentProps,
  type ReactNode,
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
  glass: 'bg-white/20 text-peach hover:bg-white/30',
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

export const inputBox = 'rounded-2xl bg-white px-3.5 py-2.5 text-base ring-[1.5px] ring-edge outline-none focus:ring-2 focus:ring-tomato disabled:bg-soft/60 disabled:placeholder:text-muted';

export function Field({ label, hint, error, ...props }: { label: string; hint?: ReactNode; error?: string } & ComponentProps<'input'>) {
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

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-[22px] bg-white p-5 ring-1 ring-edge ${className}`}>{children}</div>;
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
    <p className="flex gap-2 rounded-[14px] bg-white px-3 py-2.5 text-[13px] text-[#6d5249] ring-1 ring-edge">
      <Lock size={18} className="flex-none" aria-hidden="true" />
      <span>Your PIN is a light lock to keep friends out of each other's rankings — it's not real security. Don't reuse a bank or phone PIN.</span>
    </p>
  );
}

/**
 * One real numeric input, drawn as four cells. The 4th digit calls `onComplete`;
 * if that fails, its error shows, the input clears and it's ready for another go.
 */
export function PinInput({ onComplete }: { onComplete: (pin: string) => Promise<void> }) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const change = async (typed: string) => {
    const digits = typed.replace(/\D/g, '').slice(0, 4);
    setPin(digits);
    if (digits.length < 4) return;
    setBusy(true);
    setError('');
    try {
      await onComplete(digits);
    } catch (err) {
      setError(errorMessage(err));
      setPin('');
      input.current?.focus();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col items-center gap-3">
      <label className="group relative flex cursor-text justify-center">
        <input
          ref={input}
          aria-label="4-digit PIN"
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={4}
          autoComplete="off"
          autoFocus
          readOnly={busy}
          value={pin}
          onChange={(e) => void change(e.target.value)}
          className="absolute inset-0 w-full text-base caret-transparent opacity-0"
        />
        <span className="flex gap-3" aria-hidden="true">
          {[0, 1, 2, 3].map((i) => (
            <i
              key={i}
              className={`grid h-[66px] w-[58px] place-items-center rounded-[18px] bg-white ring-[1.5px] ring-edge ${i === Math.min(pin.length, 3) ? 'group-focus-within:ring-[2.5px] group-focus-within:ring-tomato' : ''}`}
            >
              {i < pin.length && <span className="size-3.5 rounded-full bg-ink" />}
            </i>
          ))}
        </span>
      </label>
      {error && (
        <p role="alert" className="text-[13px] font-semibold text-stamp">
          {error}
        </p>
      )}
    </div>
  );
}

export const Eyebrow = ({ children }: { children: ReactNode }) => <span className="text-[11px] font-bold tracking-[.07em] text-muted uppercase">{children}</span>;

/** A person's coloured initial. */
export function Avatar({ person, size = 'sm' }: { person: { id: number; name: string }; size?: 'sm' | 'lg' | 'xl' }) {
  const { bg, fg } = swatch(person.id);
  const sizes = {
    sm: 'size-7 rounded-full text-xs font-bold ring-2 ring-peach',
    lg: 'size-16 rounded-[22px] font-display text-[28px]',
    xl: 'size-[76px] rounded-[28px] font-display text-4xl transition-transform',
  };
  return (
    <span title={person.name} aria-hidden="true" style={{ background: bg, color: fg }} className={`inline-grid flex-none place-items-center ${sizes[size]}`}>
      {person.name[0]?.toUpperCase()}
    </span>
  );
}

export const DESKTOP_QUERY = '(min-width: 760px) and (min-height: 500px)'; // the `desk` variant in index.css

/** Whether the desktop layout applies, following the window as it resizes. */
export function useIsDesktop() {
  return useSyncExternalStore(
    (onChange) => {
      const query = matchMedia(DESKTOP_QUERY);
      query.addEventListener('change', onChange);
      return () => query.removeEventListener('change', onChange);
    },
    () => matchMedia(DESKTOP_QUERY).matches,
  );
}

/** A place's square, in its own colour. */
export function PlaceTile({ place, className = 'size-[42px] rounded-[14px] text-xl' }: { place: { id: number; name: string }; className?: string }) {
  const { bg, fg } = swatch(place.id);
  return (
    <span aria-hidden="true" style={{ background: bg, color: fg }} className={`grid flex-none place-items-center font-display ${className}`}>
      {place.name[0]?.toUpperCase()}
    </span>
  );
}

/** A tickable row, for checklists of sets or places. */
export function CheckOption({ checked, disabled, onToggle, children }: { checked: boolean; disabled?: boolean; onToggle?: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      disabled={disabled}
      onClick={onToggle}
      className="group flex w-full items-center gap-3 rounded-[18px] bg-white p-3 text-left ring-[1.5px] ring-edge aria-checked:ring-[2.5px] aria-checked:ring-tomato disabled:opacity-60 disabled:!ring-[1.5px] disabled:!ring-edge"
    >
      {children}
      <span className="grid size-6 flex-none place-items-center rounded-lg border-2 border-[#e2cfc4] text-white group-aria-checked:border-tomato group-aria-checked:bg-tomato group-disabled:!border-muted group-disabled:!bg-muted">
        <Check size={14} aria-hidden="true" />
      </span>
    </button>
  );
}

/** A set's square: "All places" gets a pin, a named set its initial on its own colour. */
export function SetTile({ set, className = 'size-[42px] rounded-[14px] text-xl' }: { set: { id: number | 'all'; name: string }; className?: string }) {
  const { bg, fg } = set.id === 'all' ? { bg: 'var(--color-ink)', fg: 'var(--color-mustard)' } : swatch(set.id + 1);
  return (
    <span aria-hidden="true" style={{ background: bg, color: fg }} className={`grid flex-none place-items-center font-display ${className}`}>
      {set.id === 'all' ? <MapPin size={18} /> : set.name[0]?.toUpperCase()}
    </span>
  );
}

export const Avatars =({ people }: { people: { id: number; name: string }[] }) => (
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

/** A rubber stamp: "Absolutely not", "Skipped". Its colour comes from the text colour in `className`. */
export const Stamp = ({ large = false, className = '', children }: { large?: boolean; className?: string; children: ReactNode }) => (
  <span
    className={`inline-block -rotate-4 rounded-[5px] border-2 border-current font-extrabold tracking-[.12em] whitespace-nowrap uppercase ${large ? 'px-[7px] text-[11px]/[1.5]' : 'px-[5px] text-[9px]/[1.5]'} ${className}`}
  >
    {children}
  </span>
);
