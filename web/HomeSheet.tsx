import { MapPin } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { api } from './api.ts';
import type { Me } from './App.tsx';
import { Button, Field, Notice, Sheet, useSubmit } from './ui.tsx';

type Suggestion = { label: string; lat: number; lng: number };

const SUGGEST_DELAY_MS = 300;

/** Setting your home: address suggestions as you type, and a map of the one you choose. */
export function HomeSheet({ me, onSaved, close, offerNotNow = false }: { me: Me; onSaved: () => void; close: () => void; offerNotNow?: boolean }) {
  const [address, setAddress] = useState(me.home?.address ?? '');
  const [query, setQuery] = useState(''); // what was typed; choosing a suggestion clears it
  const [chosen, setChosen] = useState<Suggestion | null>(null);
  const { suggestions, unavailable } = useAddressSuggestions(query);

  const { submit, error, busy } = useSubmit(async () => {
    const fromSuggestion = chosen?.label === address ? { lat: chosen.lat, lng: chosen.lng } : {};
    await api('/me/home', { method: 'PUT', body: { address, ...fromSuggestion } });
    onSaved();
    close();
    toast('Home saved');
  });
  const type = (text: string) => {
    setAddress(text);
    setQuery(text);
    setChosen(null);
  };
  const choose = (s: Suggestion) => {
    setAddress(s.label);
    setQuery('');
    setChosen(s);
  };

  return (
    <Sheet title="Home address" onClose={close}>
      <form noValidate onSubmit={submit} className="flex flex-col gap-3.5">
        <Field
          label="Address"
          value={address}
          onChange={(e) => type(e.target.value)}
          autoComplete="off"
          autoFocus
          error={error}
          hint="Used to show how long public transport takes from your place, leaving now. Only you see your travel times."
        />
        {unavailable && <Notice tone="info">Address suggestions are unavailable right now. You can still type your full address and save it.</Notice>}
        {suggestions.length > 0 && (
          <ul aria-label="Suggestions" className="flex flex-col divide-y divide-divider overflow-hidden rounded-[18px] bg-white ring-1 ring-edge">
            {suggestions.map((s) => (
              <li key={`${s.label}|${s.lat}|${s.lng}`}>
                <button type="button" onClick={() => choose(s)} className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left hover:bg-[#fffaf6]">
                  <MapPin size={16} className="flex-none text-muted" aria-hidden="true" />
                  {s.label}
                </button>
              </li>
            ))}
          </ul>
        )}
        {chosen && <MapPreview point={chosen} />}
        <Button type="submit" disabled={busy}>
          Save address
        </Button>
        {offerNotNow && (
          <Button type="button" variant="ghost" onClick={close}>
            Not now
          </Button>
        )}
      </form>
    </Sheet>
  );
}

/** Suggestions for what's been typed, once typing pauses. */
function useAddressSuggestions(query: string) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    let alive = true;
    if (!query.trim()) {
      setSuggestions([]);
      return;
    }
    const timer = setTimeout(
      () =>
        api<Suggestion[]>(`/geocode?q=${encodeURIComponent(query)}`).then(
          (found) => {
            if (!alive) return;
            setSuggestions(found);
            setUnavailable(false);
          },
          () => {
            if (!alive) return;
            setSuggestions([]);
            setUnavailable(true);
          },
        ),
      SUGGEST_DELAY_MS,
    );
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [query]);
  return { suggestions, unavailable };
}

const ZOOM = 16;
const TILE = 256;

/** Where a point falls on the OpenStreetMap tile grid at ZOOM, in tiles (Web Mercator). */
function tileXY({ lat, lng }: { lat: number; lng: number }) {
  const n = 2 ** ZOOM;
  const latRad = (lat * Math.PI) / 180;
  return { x: ((lng + 180) / 360) * n, y: ((1 - Math.asinh(Math.tan(latRad)) / Math.PI) / 2) * n };
}

/**
 * A static map: the 3×3 OpenStreetMap tiles around the point, shifted so the point sits in the middle, under a pin.
 * ponytail: ignores the antimeridian and the poles; nobody's home is there.
 */
function MapPreview({ point }: { point: Suggestion }) {
  const { x, y } = tileXY(point);
  const tiles = [-1, 0, 1].flatMap((dy) => [-1, 0, 1].map((dx) => ({ tx: Math.floor(x) + dx, ty: Math.floor(y) + dy })));
  return (
    <figure className="relative h-40 overflow-hidden rounded-[18px] bg-soft ring-1 ring-edge">
      <div role="img" aria-label={`Map of ${point.label}`} className="absolute inset-0">
        {tiles.map(({ tx, ty }) => (
          <img
            key={`${tx},${ty}`}
            src={`https://tile.openstreetmap.org/${ZOOM}/${tx}/${ty}.png`}
            alt=""
            width={TILE}
            height={TILE}
            className="absolute max-w-none"
            style={{ left: `calc(50% + ${(tx - x) * TILE}px)`, top: `calc(50% + ${(ty - y) * TILE}px)` }}
          />
        ))}
        <MapPin
          data-testid="map-marker"
          size={32}
          aria-hidden="true"
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-full fill-tomato text-ink"
        />
      </div>
      <figcaption className="absolute right-0 bottom-0 rounded-tl-lg bg-white/85 px-1.5 py-0.5 text-[11px]">
        <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
          © OpenStreetMap contributors
        </a>
      </figcaption>
    </figure>
  );
}
