import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { api } from './api.ts';
import type { Me } from './App.tsx';
import { lookupAnnouncement, MapPreview, SuggestionList, useLookup, type Point } from './search.tsx';
import { Button, Field, Notice, Sheet, useSubmit } from './ui.tsx';

/** Setting your home in a sheet: from the You page, and when a session asks. */
export function HomeSheet({ me, onSaved, close, offerNotNow = false }: { me: Me; onSaved: () => void; close: () => void; offerNotNow?: boolean }) {
  return (
    <Sheet title="Home address" onClose={close}>
      <HomeAddressForm
        initial={me.home ?? undefined}
        hint="Used to show how long public transport takes from your place, leaving now. Only you see your travel times."
        submitLabel="Save address"
        onSaved={() => {
          onSaved();
          close();
          toast('Home saved');
        }}
      >
        {offerNotNow && (
          <Button type="button" variant="ghost" onClick={close}>
            Not now
          </Button>
        )}
      </HomeAddressForm>
    </Sheet>
  );
}

/**
 * The address field with suggestions as you type and a map of the one you choose, then the save button
 * (and `children` under it); saving needs a chosen suggestion. Used by the Home address sheet and the sign-up home step.
 */
export function HomeAddressForm({ initial, hint, submitLabel, onSaved, children }: { initial?: { address: string; lat: number; lng: number }; hint?: string; submitLabel: string; onSaved: () => void; children?: ReactNode }) {
  const [address, setAddress] = useState(initial?.address ?? '');
  const [query, setQuery] = useState(''); // what was typed; choosing a suggestion clears it
  const [chosen, setChosen] = useState<Point | null>(initial ? { label: initial.address, lat: initial.lat, lng: initial.lng } : null);
  const lookup = useLookup<Point[]>(query.trim() ? `/geocode?q=${encodeURIComponent(query)}` : null);

  const { submit, error, busy } = useSubmit(async () => {
    if (!chosen) return;
    await api('/me/home', { method: 'PUT', body: { address: chosen.label, lat: chosen.lat, lng: chosen.lng } });
    onSaved();
  });
  const type = (text: string) => {
    setAddress(text);
    setQuery(text);
    setChosen(null);
  };
  const choose = (s: Point) => {
    setAddress(s.label);
    setQuery('');
    setChosen(s);
  };

  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-3.5">
      <Field label="Address" value={address} onChange={(e) => type(e.target.value)} autoComplete="off" autoFocus error={error} hint={hint} />
      <p data-testid="address-status" role="status" aria-live="polite" className="sr-only">
        {lookupAnnouncement(lookup, 'addresses')}
      </p>
      {lookup.status === 'failed' && <Notice tone="info">Address suggestions are unavailable right now. Try again in a moment.</Notice>}
      {(lookup.status === 'searching' || lookup.status === 'found') && (
        <SuggestionList lookup={lookup} noun="addresses" keyOf={(s) => `${s.label}|${s.lat}|${s.lng}`} render={(s) => s.label} onChoose={choose} />
      )}
      {chosen && <MapPreview point={chosen} />}
      <Button type="submit" disabled={busy || !chosen}>
        {submitLabel}
      </Button>
      {children}
    </form>
  );
}
