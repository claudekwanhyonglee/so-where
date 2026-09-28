import { useState } from 'react';
import { api } from './api.ts';
import type { Me } from './App.tsx';
import { Button, Field, Notice, PinField, PinWarning, Section, useSubmit } from './ui.tsx';

export function Profile({ me, onChanged, onSignedOut }: { me: Me; onChanged: () => void; onSignedOut: () => void }) {
  return (
    <div className="flex flex-col gap-4">
      <HomeAddress me={me} onChanged={onChanged} />
      <ChangePin />
      <Button variant="secondary" onClick={() => api('/signout', { body: {} }).then(onSignedOut)}>
        Sign out on this device
      </Button>
    </div>
  );
}

function HomeAddress({ me, onChanged }: { me: Me; onChanged: () => void }) {
  const [address, setAddress] = useState(me.home?.address ?? '');
  const [saved, setSaved] = useState(false);
  const { submit, error, busy } = useSubmit(async () => {
    setSaved(false);
    await api('/me/home', { method: 'PUT', body: { address } });
    setSaved(true);
    onChanged();
  });
  return (
    <Section title="Home">
      <form onSubmit={submit} className="flex flex-col gap-3">
        <Field
          label="Home address"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          required
          autoComplete="street-address"
          hint="Used to show how long public transport takes from your place. Only you see your travel times."
        />
        {error && <Notice tone="error">{error}</Notice>}
        {saved && <Notice tone="ok">Home saved.</Notice>}
        <Button type="submit" disabled={busy}>
          Save address
        </Button>
      </form>
    </Section>
  );
}

function ChangePin() {
  const [pin, setPin] = useState('');
  const [changed, setChanged] = useState(false);
  const { submit, error, busy } = useSubmit(async () => {
    setChanged(false);
    await api('/me/pin', { method: 'PUT', body: { pin } });
    setPin('');
    setChanged(true);
  });
  return (
    <Section title="Change PIN">
      <form onSubmit={submit} className="flex flex-col gap-3">
        <PinField label="New 4-digit PIN" value={pin} onChange={setPin} />
        <PinWarning />
        {error && <Notice tone="error">{error}</Notice>}
        {changed && <Notice tone="ok">PIN changed.</Notice>}
        <Button type="submit" disabled={busy}>
          Change PIN
        </Button>
      </form>
    </Section>
  );
}
