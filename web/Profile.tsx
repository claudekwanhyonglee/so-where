import { ChevronRight, House, Lock } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { api } from './api.ts';
import type { Me } from './App.tsx';
import { Avatar, Button, Eyebrow, Field, PinInput, PinWarning, Sheet, useSubmit } from './ui.tsx';

export function Profile({ me, onChanged, onSignedOut }: { me: Me; onChanged: () => void; onSignedOut: () => void }) {
  const [sheet, setSheet] = useState<'home' | 'pin' | null>(null);
  const close = () => setSheet(null);
  return (
    <div className="flex w-full flex-col gap-5 desk:max-w-[560px]">
      <div className="flex items-center gap-3.5">
        <Avatar person={me} size="lg" />
        <div>
          <h1 className="font-display text-[22px]/tight">{me.name}</h1>
          <span className="text-muted">Signed in on this device</span>
        </div>
      </div>
      <Group title="Getting there" hint="Used for public transport times on each card. Only you see them.">
        <Row icon={<House size={18} />} label="Home address" value={me.home?.address ?? 'Not set'} onClick={() => setSheet('home')} />
      </Group>
      <Group title="Security">
        <Row icon={<Lock size={18} />} label="Change PIN" onClick={() => setSheet('pin')} />
      </Group>
      <div className="overflow-hidden rounded-[22px] bg-white ring-1 ring-edge">
        <button onClick={() => api('/signout', { body: {} }).then(onSignedOut)} className="w-full p-3.5 text-center font-bold text-stamp hover:bg-[#fffaf6]">
          Sign out on this device
        </button>
      </div>
      {sheet === 'home' && <HomeSheet me={me} onSaved={onChanged} close={close} />}
      {sheet === 'pin' && <PinSheet close={close} />}
    </div>
  );
}

function Group({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-1.5">
      <span className="px-1.5">
        <Eyebrow>{title}</Eyebrow>
      </span>
      <div className="overflow-hidden rounded-[22px] bg-white ring-1 ring-edge">{children}</div>
      {hint && <span className="px-1.5 text-xs text-muted">{hint}</span>}
    </section>
  );
}

function Row({ icon, label, value, onClick }: { icon: ReactNode; label: string; value?: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex w-full items-center gap-3 p-3.5 text-left hover:bg-[#fffaf6]">
      <span aria-hidden="true" className="grid size-8 flex-none place-items-center rounded-[10px] bg-blush text-tomato-deep">
        {icon}
      </span>
      <span className="flex-1 whitespace-nowrap">{label}</span>
      {value && <span className="max-w-[45%] truncate text-sm text-muted">{value}</span>}
      <ChevronRight size={18} aria-hidden="true" />
    </button>
  );
}

function HomeSheet({ me, onSaved, close }: { me: Me; onSaved: () => void; close: () => void }) {
  const [address, setAddress] = useState(me.home?.address ?? '');
  const { submit, error, busy } = useSubmit(async () => {
    await api('/me/home', { method: 'PUT', body: { address } });
    onSaved();
    close();
    toast('Home saved');
  });
  return (
    <Sheet title="Home address" onClose={close}>
      <form noValidate onSubmit={submit} className="flex flex-col gap-3.5">
        <Field
          label="Address"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          autoComplete="street-address"
          autoFocus
          error={error}
          hint="Used to show how long public transport takes from your place, leaving now. Only you see your travel times."
        />
        <Button type="submit" disabled={busy}>
          Save address
        </Button>
      </form>
    </Sheet>
  );
}

function PinSheet({ close }: { close: () => void }) {
  return (
    <Sheet title="New PIN" onClose={close}>
      <PinInput
        onComplete={async (pin) => {
          await api('/me/pin', { method: 'PUT', body: { pin } });
          close();
          toast('PIN changed');
        }}
      />
      <PinWarning />
    </Sheet>
  );
}
