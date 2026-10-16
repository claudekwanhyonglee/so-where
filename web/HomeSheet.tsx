import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { api } from './api.ts';
import type { Me } from './App.tsx';
import { countryByCode, flagUrl, matchCountries, type Country } from './countries.ts';
import { lookupAnnouncement, MapPreview, SuggestionList, useLookup, type Point } from './search.tsx';
import { Button, Field, inputBox, Notice, notify, Sheet, useSubmit } from './ui.tsx';

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
          notify('Home saved');
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
 * The country, then the address field with suggestions from that country as you type and a map of the one you choose,
 * then the save button (and `children` under it); saving needs a chosen suggestion. Used by the Home address sheet and
 * the sign-up home step.
 */
export function HomeAddressForm({ initial, hint, submitLabel, onSaved, children }: { initial?: Me['home']; hint?: string; submitLabel: string; onSaved: () => void; children?: ReactNode }) {
  const [country, setCountry] = useState(countryByCode(initial?.country));
  const [address, setAddress] = useState(initial?.address ?? '');
  const [query, setQuery] = useState(''); // what was typed; choosing a suggestion clears it
  const [chosen, setChosen] = useState<Point | null>(initial ? { label: initial.address, lat: initial.lat, lng: initial.lng } : null);
  const lookup = useLookup<Point[]>(country && query.trim() ? `/geocode?q=${encodeURIComponent(query)}&country=${country.code}` : null);

  const { submit, error, busy } = useSubmit(async () => {
    if (!chosen || !country) return;
    await api('/me/home', { method: 'PUT', body: { address: chosen.label, lat: chosen.lat, lng: chosen.lng, country: country.code } });
    onSaved();
  });
  const pickCountry = (picked: Country) => {
    if (picked.code !== country?.code) type('');
    setCountry(picked);
  };
  const addressInput = useRef<HTMLInputElement>(null);
  useEffect(() => addressInput.current?.focus(), [country]); // once picked, on to the address
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
      <CountryField country={country} onPick={pickCountry} />
      <Field ref={addressInput} label="Address" value={address} onChange={(e) => type(e.target.value)} autoComplete="off" disabled={!country} placeholder={country ? undefined : "Pick a country first"} error={error} hint={hint} />
      <p data-testid="address-status" role="status" aria-live="polite" className="sr-only">
        {lookupAnnouncement(lookup, 'addresses')}
      </p>
      {lookup.status === 'failed' && <Notice tone="info">Address suggestions are unavailable right now. Try again in a moment.</Notice>}
      {(lookup.status === 'searching' || lookup.status === 'found') && (
        <SuggestionList lookup={lookup} noun="addresses" keyOf={(s) => `${s.label}|${s.lat}|${s.lng}`} render={(s) => s.label} onChoose={choose} />
      )}
      {chosen && <MapPreview point={chosen} />}
      <Button type="submit" disabled={busy || !chosen || !country}>
        {submitLabel}
      </Button>
      {children}
    </form>
  );
}

const Flag = ({ code }: { code: string }) => <img src={flagUrl(code)} alt="" width={20} height={15} className="h-[15px] w-5 flex-none rounded-[3px] object-cover ring-1 ring-black/10" />;

/** Type to find your country; its flag shows next to the name once picked. Nothing is picked until you choose. */
function CountryField({ country, onPick }: { country?: Country; onPick: (country: Country) => void }) {
  const id = useId();
  const [typed, setTyped] = useState<string | null>(null); // null: showing the picked country
  const showingPick = typed === null && country;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[13px] font-bold">
        Country
      </label>
      <div className="relative">
        {showingPick && (
          <span data-testid="picked-flag" className="pointer-events-none absolute top-1/2 left-3.5 flex -translate-y-1/2">
            <Flag code={country.code} />
          </span>
        )}
        <input
          id={id}
          value={typed ?? country?.name ?? ''}
          onChange={(e) => setTyped(e.target.value)}
          placeholder="Start typing your country"
          autoComplete="off"
          autoFocus={!country}
          className={`${inputBox} w-full ${showingPick ? 'pl-11' : ''}`}
        />
      </div>
      {typed?.trim() && (
        <div className="max-h-60 overflow-y-auto rounded-[18px]">
          <SuggestionList
            lookup={{ status: 'found', value: matchCountries(typed) }}
            noun="countries"
            keyOf={(c) => c.code}
            icon={(c) => <Flag code={c.code} />}
            render={(c) => c.name}
            onChoose={(c) => {
              setTyped(null);
              onPick(c);
            }}
          />
        </div>
      )}
    </div>
  );
}
