import { useCallback, useEffect, useState } from 'react';
import { api } from './api.ts';
import { googleMapsUrl, type Place } from './model.ts';
import { Button, Card, Field, Notice, Section, useSubmit } from './ui.tsx';

export function usePlaces() {
  const [places, setPlaces] = useState<Place[]>([]);
  const reload = useCallback(() => api<Place[]>('/places').then(setPlaces), []);
  useEffect(() => void reload(), [reload]);
  return { places, reload };
}

export function Places() {
  const { places, reload } = usePlaces();
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 md:grid-cols-2">
        <AddPlace onAdded={reload} />
        <ImportTakeout onImported={reload} />
      </div>
      <PlaceList places={places} onChanged={reload} />
    </div>
  );
}

type ImportReport = { added: number; existing: number; skipped: number; lists: string[] };

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function describeImport({ added, existing, skipped }: ImportReport) {
  const parts = [added ? `Added ${plural(added, 'place', 'places')}` : 'No new places'];
  if (existing) parts.push(`${existing} ${existing === 1 ? 'was' : 'were'} already there`);
  if (skipped) parts.push(`${plural(skipped, 'entry', 'entries')} skipped (not a place)`);
  return `${parts.join(', ')}.`;
}

function ImportTakeout({ onImported }: { onImported: () => void }) {
  const [files, setFiles] = useState<FileList | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const { submit, error, busy } = useSubmit(async () => {
    setReport(null);
    const form = new FormData();
    for (const file of files ?? []) form.append('files', file);
    setReport(await api<ImportReport>('/import', { body: form }));
    onImported();
  });
  return (
    <Section title="Import from Google Takeout">
      <form onSubmit={submit} className="flex flex-col gap-3">
        <p className="text-sm text-stone-600">
          From <a className="font-semibold text-orange-700 underline" href="https://takeout.google.com" target="_blank" rel="noreferrer">Google Takeout</a>,
          export <b>Saved</b> (one CSV per list) and <b>Maps (your places)</b> (<i>Saved Places.json</i>). Each list becomes a set. Re-importing only adds
          what's new.
        </p>
        <Field label="Takeout files (.csv, .json)" type="file" multiple accept=".csv,.json" required onChange={(e) => setFiles(e.target.files)} />
        {error && <Notice tone="error">{error}</Notice>}
        {report && (
          <Notice tone="ok">
            {describeImport(report)} Suburbs and locations fill in over the next few minutes.
          </Notice>
        )}
        <Button type="submit" disabled={busy}>
          {busy ? 'Importing…' : 'Import'}
        </Button>
      </form>
    </Section>
  );
}

function AddPlace({ onAdded }: { onAdded: () => void }) {
  const [url, setUrl] = useState('');
  const [note, setNote] = useState('');
  const [message, setMessage] = useState('');
  const { submit, error, busy } = useSubmit(async () => {
    setMessage('');
    const res = await api<{ place: Place; existing?: boolean; message?: string }>('/places', { body: { url, note } });
    setMessage(res.message ?? `Added ${res.place.name}.`);
    setUrl('');
    setNote('');
    onAdded();
  });
  return (
    <Section title="Add a place">
      <form onSubmit={submit} className="flex flex-col gap-3">
        <Field
          label="Google Maps link"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          required
          inputMode="url"
          placeholder="https://maps.app.goo.gl/…"
          hint="In Google Maps, open the restaurant, tap Share, and paste the link here."
        />
        <Field label="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Get the dumplings" />
        {error && <Notice tone="error">{error}</Notice>}
        {message && <Notice tone="ok">{message}</Notice>}
        <Button type="submit" disabled={busy}>
          {busy ? 'Adding…' : 'Add place'}
        </Button>
      </form>
    </Section>
  );
}

function PlaceList({ places, onChanged }: { places: Place[]; onChanged: () => void }) {
  if (places.length === 0) {
    return <Card className="text-center text-stone-500">No places yet. Paste a Google Maps link above to add the first one.</Card>;
  }
  return (
    <section aria-label="All places">
      <h2 className="mb-2 px-1 text-sm font-semibold uppercase tracking-wide text-stone-500">{places.length} places</h2>
      <ul className="grid gap-3 sm:grid-cols-2">
        {places.map((p) => (
          <PlaceItem key={p.id} place={p} onChanged={onChanged} />
        ))}
      </ul>
    </section>
  );
}

function PlaceItem({ place, onChanged }: { place: Place; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState(place.note);
  const save = useSubmit(async () => {
    await api(`/places/${place.id}`, { method: 'PATCH', body: { note } });
    setEditing(false);
    onChanged();
  });
  const remove = async () => {
    if (!confirm(`Delete ${place.name} for everyone?`)) return;
    await api(`/places/${place.id}`, { method: 'DELETE' });
    onChanged();
  };

  return (
    <li className="flex flex-col gap-2 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-stone-200">
      <div>
        <h3 className="font-bold leading-tight">{place.name}</h3>
        <p className="text-sm text-stone-500">{place.suburb ?? 'Suburb unknown'}</p>
      </div>
      {editing ? (
        <form onSubmit={save.submit} className="flex flex-col gap-2">
          <Field label="Note" value={note} onChange={(e) => setNote(e.target.value)} autoFocus />
          <div className="flex gap-2">
            <Button type="submit" disabled={save.busy}>
              Save
            </Button>
            <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        place.note && <p className="text-sm italic text-stone-700">“{place.note}”</p>
      )}
      <div className="mt-auto flex flex-wrap gap-1 pt-1">
        <a href={googleMapsUrl(place)} target="_blank" rel="noreferrer" className="rounded-lg px-2 py-1 text-sm font-semibold text-orange-700 hover:bg-orange-50">
          Open in Google Maps ↗
        </a>
        {!editing && (
          <Button variant="ghost" className="!px-2 !py-1" onClick={() => setEditing(true)}>
            Edit note
          </Button>
        )}
        <Button variant="danger" className="!px-2 !py-1" onClick={remove}>
          Delete
        </Button>
      </div>
    </li>
  );
}
