import { useCallback, useEffect, useState } from 'react';
import { api } from './api.ts';
import { Leaderboard } from './Leaderboard.tsx';
import { googleMapsUrl, transitDirectionsUrl } from './model.ts';
import { Button, Card, Notice, Sheet } from './ui.tsx';
import { usePolling } from './usePolling.ts';

export type CardPlace = { id: number; name: string; suburb: string | null; note: string; key: string; lat: number | null; lng: number | null };
type SessionInfo = { id: string; setName: string; members: { id: number; name: string }[]; sharePath: string };
type PairResponse = { pair: CardPlace[] | null; picks: number };

export function SessionPage({ id }: { id: string }) {
  const info = usePolling(useCallback(() => api<SessionInfo>(`/sessions/${id}`), [id]), 3000);
  const [version, setVersion] = useState(0);
  if (!info) return null;
  return (
    <div className="flex flex-col gap-6">
      <SessionHeader info={info} />
      <Picker sessionId={id} onPicked={() => setVersion((v) => v + 1)} />
      <Leaderboard sessionId={id} version={version} />
    </div>
  );
}

function SessionHeader({ info }: { info: SessionInfo }) {
  const [sharing, setSharing] = useState(false);
  const [copied, setCopied] = useState(false);
  const link = `${location.origin}${info.sharePath}`;
  const copy = () => navigator.clipboard?.writeText(link).then(() => setCopied(true), () => undefined);

  return (
    <header className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-orange-700">Picking from</p>
          <h1 className="text-2xl font-black tracking-tight">{info.setName}</h1>
        </div>
        <Button variant="secondary" onClick={() => setSharing(!sharing)}>
          Share
        </Button>
      </div>
      {sharing && (
        <Sheet title="Invite your group" onClose={() => setSharing(false)}>
          <label className="text-sm font-medium text-stone-700" htmlFor="share-link">
            Share link
          </label>
          <div className="flex gap-2">
            <input id="share-link" readOnly value={link} onFocus={(e) => e.target.select()} className="min-w-0 flex-1 rounded-xl border border-stone-300 bg-stone-50 px-3 py-2 text-sm" />
            <Button onClick={copy}>{copied ? 'Copied' : 'Copy'}</Button>
          </div>
          <p className="text-xs text-stone-500">Anyone with this link can get in, so share it only with your group.</p>
        </Sheet>
      )}
      <div className="flex flex-wrap items-center gap-1.5 text-sm">
        <span className="font-semibold text-stone-600">Here:</span>
        <ul aria-label="Who's here" className="flex flex-wrap gap-1.5">
          {info.members.map((m) => (
            <li key={m.id} className="rounded-full bg-white px-2.5 py-0.5 font-medium ring-1 ring-stone-200">
              {m.name}
            </li>
          ))}
        </ul>
      </div>
    </header>
  );
}

function Picker({ sessionId, onPicked }: { sessionId: string; onPicked?: () => void }) {
  const [state, setState] = useState<PairResponse | null>(null);
  const [vetoed, setVetoed] = useState<CardPlace | null>(null);
  const [error, setError] = useState('');
  const base = `/sessions/${sessionId}`;

  const run = (request: Promise<PairResponse>) => {
    setError('');
    request.then(
      (next) => {
        setState(next);
        onPicked?.();
      },
      (err: Error) => setError(err.message),
    );
  };
  useEffect(() => run(api<PairResponse>(`${base}/pair`)), [base]);

  if (!state) return null;
  const { pair, picks } = state;
  const choose = (winner: number | null) => pair && run(api<PairResponse>(`${base}/picks`, { body: { a: pair[0].id, b: pair[1].id, winner } }));
  const veto = (place: CardPlace) => {
    setVetoed(place);
    run(api<PairResponse>(`${base}/vetoes`, { body: { placeId: place.id } }));
  };
  const undoVeto = (place: CardPlace) => {
    setVetoed(null);
    run(api<PairResponse>(`${base}/vetoes/${place.id}`, { method: 'DELETE' }));
  };

  return (
    <section aria-label="Pick" className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between px-1">
        <h2 className="text-lg font-bold">Tap the one you'd rather</h2>
        <span className="text-sm text-stone-500">{picks === 1 ? '1 pick' : `${picks} picks`}</span>
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      {pair ? (
        <>
          <div className="grid gap-3 md:grid-cols-2">
            {pair.map((place) => (
              <PlaceCard key={place.id} sessionId={sessionId} place={place} onPick={() => choose(place.id)} onVeto={() => veto(place)} />
            ))}
          </div>
          <Button variant="secondary" className="self-center" onClick={() => choose(null)}>
            🤷 Too close to call
          </Button>
        </>
      ) : (
        <Card className="text-center text-stone-600">Not enough places left to compare. Add places to the set, or undo an "Absolutely not".</Card>
      )}
      {vetoed && (
        <Notice tone="info">
          {vetoed.name} is out for you tonight.{' '}
          <button className="font-semibold underline" onClick={() => undoVeto(vetoed)}>
            Undo
          </button>
        </Notice>
      )}
    </section>
  );
}

type TransitAnswer = { minutes: number } | { minutes: null; reason: string };

function useTransitTime(sessionId: string, placeId: number) {
  const [answer, setAnswer] = useState<TransitAnswer | null>(null);
  useEffect(() => {
    let alive = true;
    setAnswer(null);
    api<TransitAnswer>(`/sessions/${sessionId}/transit?place=${placeId}`).then(
      (a) => alive && setAnswer(a),
      () => alive && setAnswer({ minutes: null, reason: 'unavailable' }),
    );
    return () => {
      alive = false;
    };
  }, [sessionId, placeId]);
  return answer;
}

const linkStyle = 'rounded-lg px-2 py-1 text-sm font-semibold text-orange-700 hover:bg-orange-50';

function PlaceCard({ sessionId, place, onPick, onVeto }: { sessionId: string; place: CardPlace; onPick: () => void; onVeto: () => void }) {
  const transit = useTransitTime(sessionId, place.id);
  return (
    <article className="group relative flex min-h-48 flex-col gap-2 rounded-3xl bg-white p-5 shadow-sm ring-1 ring-stone-200 transition hover:-translate-y-0.5 hover:shadow-md hover:ring-orange-300">
      <h3 className="text-2xl font-black leading-tight tracking-tight">{place.name}</h3>
      <p className="text-stone-500">{place.suburb ?? 'Suburb unknown'}</p>
      {transit?.minutes != null && (
        <p className="font-semibold text-emerald-800">
          🚆 {transit.minutes} min <span className="font-normal text-stone-500">by public transport from home, leaving now</span>
        </p>
      )}
      {place.note && <p className="text-stone-700 italic">“{place.note}”</p>}
      {/* The whole card picks it; the links below sit above this button. */}
      <button aria-label={`Pick ${place.name}`} onClick={onPick} className="absolute inset-0 rounded-3xl focus-visible:outline-4 focus-visible:outline-orange-400" />
      <div className="pointer-events-none relative mt-auto flex flex-wrap gap-2 pt-3 [&>*]:pointer-events-auto">
        <a href={googleMapsUrl(place)} target="_blank" rel="noreferrer" className={linkStyle}>
          Open in Google Maps ↗
        </a>
        {transit && transit.minutes === null && (
          <a href={transitDirectionsUrl(place)} target="_blank" rel="noreferrer" className={linkStyle}>
            🚆 Directions ↗
          </a>
        )}
        <button onClick={onVeto} className="ml-auto rounded-lg px-2 py-1 text-sm font-semibold text-rose-700 hover:bg-rose-50">
          🚫 Absolutely not
        </button>
      </div>
    </article>
  );
}
