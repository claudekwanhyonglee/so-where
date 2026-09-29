import { Check, ExternalLink, ListChecks, Pencil, Plus, Trash2, Upload, X } from 'lucide-react';
import { useState, type KeyboardEvent, type ReactNode } from 'react';
import { toast } from 'sonner';
import { api, errorMessage } from './api.ts';
import { googleMapsUrl, plural, type Place } from './model.ts';
import type { NamedSet, OpenSheet, PlaceWithSets } from './Places.tsx';
import { navigate } from './router.tsx';
import { lookupAnnouncement, MapPreview, Spinner, SuggestionList, useLookup } from './search.tsx';
import { Button, CheckOption, Field, inputBox, Notice, PlaceTile, SetTile, Sheet, useSubmit } from './ui.tsx';

type SheetProps = { close: () => void; reload: () => Promise<unknown> };

const HOW_TO_COPY = 'In Google Maps, open the place, tap Share and copy the link.';

const createSet = (name: string) => api<{ id: number }>('/sets', { body: { name } });
const setMembership = (setId: number, placeId: number, member: boolean) => api(`/sets/${setId}/places/${placeId}`, { method: member ? 'PUT' : 'DELETE' });

/** Add a place found by name or from its link, choosing its sets in the same sheet. */
export function AddPlaceSheet({ named, into, open, close, reload }: SheetProps & { named: NamedSet[]; into?: NamedSet; open?: (s: OpenSheet) => void }) {
  const [note, setNote] = useState('');
  const [checked, setChecked] = useState<ReadonlySet<number>>(new Set(into ? [into.id] : []));
  const { box, chosen } = usePlaceBox();
  const { submit, error, busy } = useSubmit(async () => {
    if (!chosen) return;
    const res = await api<{ place: Place; message?: string }>('/places', { body: { ...chosen.add, note, setIds: [...checked] } });
    await reload();
    close();
    toast(res.message ?? `Added ${res.place.name}`);
  });
  const toggle = (id: number) => setChecked((was) => (was.has(id) ? new Set([...was].filter((x) => x !== id)) : new Set([...was, id])));

  return (
    <Sheet title={into ? `Add to ${into.name}` : 'Add a place'} onClose={close}>
      <form noValidate onSubmit={submit} className="flex flex-col gap-3.5">
        {box}
        {error && <Notice tone="error">{error}</Notice>}
        <Field label="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Get the dumplings" />
        <SetChecklist
          named={named}
          checked={checked}
          onToggle={toggle}
          onCreate={async (name) => {
            const { id } = await createSet(name);
            await reload();
            setChecked((was) => new Set([...was, id]));
          }}
        />
        <Button type="submit" disabled={busy || !chosen}>
          {busy ? 'Adding…' : 'Add place'}
        </Button>
      </form>
      {into && open && (
        <Button variant="ghost" onClick={() => open({ kind: 'add-to-set', setId: into.id })}>
          Choose from places you've added
        </Button>
      )}
    </Sheet>
  );
}

type PlaceResult = { key: string; name: string; address: string; lat: number; lng: number };
type LinkedPlace = { name: string; lat: number; lng: number };
type ChosenPlace = LinkedPlace & { add: { key: string; name: string; lat: number; lng: number } | { url: string } };

const isLink = (text: string) => /^\s*https?:\/\//i.test(text);

/**
 * One box for finding a place: typing a name suggests places to choose from, and pasting a Google Maps link finds the
 * place it points to. Either way the place is shown on a map, and `chosen` is what to add (null until there is one).
 */
function usePlaceBox(): { box: ReactNode; chosen: ChosenPlace | null } {
  const [text, setText] = useState('');
  const [picked, setPicked] = useState<PlaceResult | null>(null);
  const link = isLink(text) ? text.trim() : null;
  const search = useLookup<PlaceResult[]>(!link && !picked && text.trim() ? `/places/search?q=${encodeURIComponent(text)}` : null);
  const linked = useLookup<LinkedPlace>(link && `/places/link?url=${encodeURIComponent(link)}`);
  const chosen: ChosenPlace | null = picked
    ? { ...picked, add: { key: picked.key, name: picked.name, lat: picked.lat, lng: picked.lng } }
    : link && linked.status === 'found'
      ? { ...linked.value, add: { url: link } }
      : null;

  const type = (value: string) => {
    setText(value);
    setPicked(null);
  };
  const choose = (place: PlaceResult) => {
    setText(place.name);
    setPicked(place);
  };

  const box = (
    <>
      <Field
        label="Name or Google Maps link"
        value={text}
        onChange={(e) => type(e.target.value)}
        autoComplete="off"
        placeholder="Pretend Trattoria, or https://maps.app.goo.gl/…"
        autoFocus
        error={link && linked.status === 'failed' ? linked.error : undefined}
        hint={`Search by name, or paste a link. ${HOW_TO_COPY}`}
      />
      <p role="status" aria-live="polite" className="sr-only">
        {link ? (linked.status === 'searching' ? 'Finding that place…' : '') : lookupAnnouncement(search, 'places')}
      </p>
      {search.status === 'failed' && <Notice tone="info">Place search is unavailable right now. Paste a Google Maps link instead: {HOW_TO_COPY.toLowerCase()}</Notice>}
      {(search.status === 'searching' || search.status === 'found') && (
        <SuggestionList
          lookup={search}
          noun="places"
          keyOf={(p) => p.key}
          render={(p) => <OptionText title={p.name} detail={p.address} />}
          onChoose={choose}
        />
      )}
      {link && linked.status === 'searching' && (
        <p className="flex items-center gap-2.5 font-semibold text-muted">
          <Spinner />
          Finding that place…
        </p>
      )}
      {chosen && (
        <>
          {link && <p className="font-bold">{chosen.name}</p>}
          <MapPreview point={{ label: chosen.name, lat: chosen.lat, lng: chosen.lng }} />
        </>
      )}
    </>
  );
  return { box, chosen };
}

/** "All places" (always ticked), each named set, and a field to make a new one. */
function SetChecklist({ named, checked, onToggle, onCreate }: { named: NamedSet[]; checked: ReadonlySet<number>; onToggle: (id: number) => void; onCreate: (name: string) => Promise<void> }) {
  return (
    <div role="group" aria-label="Sets" className="flex flex-col gap-2">
      <span className="text-[13px] font-bold">Sets</span>
      <CheckOption checked disabled>
        <SetTile set={{ id: 'all', name: 'All places' }} />
        <OptionText title="All places" detail="Always included" />
      </CheckOption>
      {named.map((s) => (
        <CheckOption key={s.id} checked={checked.has(s.id)} onToggle={() => onToggle(s.id)}>
          <SetTile set={s} />
          <OptionText title={s.name} detail={plural(s.placeCount, 'place')} />
        </CheckOption>
      ))}
      <NewSetInline onCreate={onCreate} />
    </div>
  );
}

const OptionText = ({ title, detail }: { title: string; detail?: string | null }) => (
  <span className="min-w-0 flex-1">
    <b className="block truncate">{title}</b>
    {detail && <small className="text-muted">{detail}</small>}
  </span>
);

/** Makes a set without leaving the sheet (Enter creates it too, rather than submitting the form around it). */
function NewSetInline({ onCreate }: { onCreate: (name: string) => Promise<void> }) {
  const [name, setName] = useState('');
  const { submit, error, busy } = useSubmit(async () => {
    if (!name.trim()) return;
    await onCreate(name.trim());
    setName('');
  });
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    void submit();
  };
  return (
    <>
      <div className={`flex items-center gap-2 !py-1 !pr-1 focus-within:ring-2 focus-within:ring-tomato ${inputBox}`}>
        <input
          aria-label="New set name"
          maxLength={60}
          placeholder="New set, e.g. Birthday dinner"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={onKeyDown}
          className="min-w-0 flex-1 bg-transparent py-1.5 outline-none"
        />
        <button type="button" disabled={busy} onClick={() => void submit()} className="inline-flex items-center gap-1 rounded-xl bg-soft px-3 py-2 text-[13px] font-bold">
          <Plus size={16} aria-hidden="true" /> Create
        </button>
      </div>
      {error && <Notice tone="error">{error}</Notice>}
    </>
  );
}

type ImportReport = { added: number; existing: number; skipped: number; sets: { id: number; name: string }[] };

function describeImport({ added, existing, skipped, sets }: ImportReport) {
  const parts = [added ? `Added ${plural(added, 'place')}` : 'No new places'];
  if (existing) parts.push(`${existing} ${existing === 1 ? 'was' : 'were'} already there`);
  if (skipped) parts.push(`${plural(skipped, 'entry', 'entries')} skipped (not a place)`);
  const newSets = sets.length ? ` ${sets.length === 1 ? 'Set' : 'Sets'}: ${sets.map((s) => s.name).join(', ')}.` : '';
  return `${parts.join(', ')}.${newSets} Suburbs fill in over the next few minutes.`;
}

/** Google Takeout import: each saved list becomes a set, and the first one is shown (unless `showFirstSet` is false). */
export function ImportSheet({ close, reload, showFirstSet = true }: SheetProps & { showFirstSet?: boolean }) {
  const [report, setReport] = useState<ImportReport | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const importFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    setError('');
    try {
      const form = new FormData();
      for (const file of files) form.append('files', file);
      const result = await api<ImportReport>('/import', { body: form });
      await reload();
      setReport(result);
      if (result.sets[0] && showFirstSet) navigate(`/places/${result.sets[0].id}`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet title="Import from Google Maps" onClose={close}>
      {report ? (
        <>
          <p className="flex gap-2 rounded-[14px] bg-[#e9f6ef] px-3 py-2.5 text-[13px] text-leaf ring-1 ring-[#bfe3cf]">
            <Check size={18} className="flex-none" aria-hidden="true" />
            <span>{describeImport(report)}</span>
          </p>
          <Button onClick={close}>{showFirstSet ? 'See your sets' : 'Done'}</Button>
        </>
      ) : (
        <>
          <p className="text-muted">
            From{' '}
            <a className="font-bold text-ink underline" href="https://takeout.google.com" target="_blank" rel="noreferrer">
              takeout.google.com
            </a>
            , export <b>Saved</b> (one CSV per list) and <b>Maps (your places)</b>. Each saved list becomes a set here; importing again only adds what's new.
          </p>
          <label className="relative flex cursor-pointer flex-col items-center gap-1.5 rounded-[22px] border-2 border-dashed border-[#e2cfc4] p-[22px] text-center focus-within:ring-2 focus-within:ring-tomato">
            <Upload aria-hidden="true" />
            <b>{busy ? 'Importing…' : 'Choose .csv or .json files'}</b>
            <span className="text-[13px] text-muted">e.g. Date night.csv, Saved Places.json</span>
            <input
              type="file"
              multiple
              accept=".csv,.json"
              aria-label="Takeout files (.csv, .json)"
              disabled={busy}
              onChange={(e) => void importFiles(e.target.files)}
              className="absolute size-px opacity-0"
            />
          </label>
          {error && <Notice tone="error">{error}</Notice>}
        </>
      )}
    </Sheet>
  );
}

/** Name a new set, then go straight to choosing its places. */
export function NewSetSheet({ open, close, reload }: SheetProps & { open: (s: OpenSheet) => void }) {
  const [name, setName] = useState('');
  const { submit, error, busy } = useSubmit(async () => {
    if (!name.trim()) throw new Error('Give the set a name.');
    const { id } = await createSet(name);
    await reload();
    navigate(`/places/${id}`);
    open({ kind: 'add-to-set', setId: id });
  });
  return (
    <Sheet title="New set" onClose={close}>
      <form noValidate onSubmit={submit} className="flex flex-col gap-3.5">
        <Field label="Set name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="Date night" autoFocus error={error} hint="Next you'll pick which places go in it." />
        <Button type="submit" disabled={busy}>
          Create set
        </Button>
      </form>
    </Sheet>
  );
}

/** A named set's … menu: rename, or delete (its places stay). */
export function SetActionsSheet({ set, close, reload }: SheetProps & { set: NamedSet }) {
  const [mode, setMode] = useState<'menu' | 'rename' | 'confirm'>('menu');
  const [name, setName] = useState(set.name);
  const rename = useSubmit(async () => {
    if (!name.trim()) throw new Error('Give the set a name.');
    await api(`/sets/${set.id}`, { method: 'PATCH', body: { name } });
    await reload();
    close();
  });
  const remove = useSubmit(async () => {
    await api(`/sets/${set.id}`, { method: 'DELETE' });
    navigate('/places');
    await reload();
    close();
    toast('Set deleted');
  });

  if (mode === 'rename') {
    return (
      <Sheet title="Rename set" onClose={close}>
        <form noValidate onSubmit={rename.submit} className="flex flex-col gap-3.5">
          <Field label="Set name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoFocus error={rename.error} />
          <Button type="submit" disabled={rename.busy}>
            Save
          </Button>
        </form>
      </Sheet>
    );
  }
  return (
    <Sheet title={set.name} onClose={close}>
      {mode === 'confirm' ? (
        <Confirm
          question={
            <>
              Delete the set <b>{set.name}</b>? Its places stay in All places.
            </>
          }
          action="Delete set"
          busy={remove.busy}
          error={remove.error}
          onConfirm={() => remove.submit()}
          onCancel={close}
        />
      ) : (
        <ActionList>
          <ActionButton icon={<Pencil size={18} />} onClick={() => setMode('rename')}>
            Rename
          </ActionButton>
          <ActionButton icon={<Trash2 size={18} />} danger onClick={() => setMode('confirm')}>
            Delete set
          </ActionButton>
        </ActionList>
      )}
    </Sheet>
  );
}

/** Fill a named set from the places already added: a searchable checklist that saves as you tick. */
export function AddToSetSheet({ set, places, open, close, reload }: SheetProps & { set: NamedSet; places: PlaceWithSets[]; open: (s: OpenSheet) => void }) {
  const [query, setQuery] = useState('');
  const [members, setMembers] = useState<ReadonlySet<number>>(new Set(places.filter((p) => p.setIds.includes(set.id)).map((p) => p.id)));
  const [error, setError] = useState('');
  const q = query.trim().toLowerCase();
  const shown = places.filter((p) => `${p.name} ${p.suburb ?? ''}`.toLowerCase().includes(q));

  const toggle = (placeId: number) => {
    const member = !members.has(placeId);
    setMembers((was) => (member ? new Set([...was, placeId]) : new Set([...was].filter((id) => id !== placeId))));
    setError('');
    setMembership(set.id, placeId, member).then(reload, (err) => setError(errorMessage(err)));
  };

  return (
    <Sheet title={`Add to ${set.name}`} onClose={close}>
      <input aria-label="Search your places" placeholder="Search your places" autoComplete="off" value={query} onChange={(e) => setQuery(e.target.value)} className={inputBox} />
      {error && <Notice tone="error">{error}</Notice>}
      <div className="flex flex-col gap-2">
        {shown.map((p) => (
          <CheckOption key={p.id} checked={members.has(p.id)} onToggle={() => toggle(p.id)}>
            <PlaceTile place={p} />
            <OptionText title={p.name} detail={p.suburb} />
          </CheckOption>
        ))}
        {shown.length === 0 && <p className="py-2 text-center text-muted">{places.length ? 'No places match.' : 'No places yet.'}</p>}
      </div>
      <Button variant="ghost" onClick={() => open({ kind: 'add-place', setId: set.id })}>
        <Plus size={18} aria-hidden="true" /> Not here? Paste a Google Maps link
      </Button>
      <Button onClick={close}>Done · {plural(members.size, 'place')}</Button>
    </Sheet>
  );
}

/** A place's … menu. `from` is the named set it was opened in, if any. */
export function PlaceActionsSheet({ place, from, named, close, reload }: SheetProps & { place: PlaceWithSets; from?: NamedSet; named: NamedSet[] }) {
  const [mode, setMode] = useState<'menu' | 'sets' | 'note' | 'confirm'>('menu');
  const [note, setNote] = useState(place.note);
  const [error, setError] = useState('');
  const saveNote = useSubmit(async () => {
    await api(`/places/${place.id}`, { method: 'PATCH', body: { note } });
    await reload();
    close();
    toast('Note saved');
  });
  const removeFromSet = useSubmit(async () => {
    await setMembership(from!.id, place.id, false);
    await reload();
    close();
    toast(`Removed from ${from!.name}`);
  });
  const remove = useSubmit(async () => {
    await api(`/places/${place.id}`, { method: 'DELETE' });
    await reload();
    close();
    toast('Place deleted');
  });
  const toggleSet = (setId: number) => {
    setError('');
    setMembership(setId, place.id, !place.setIds.includes(setId)).then(reload, (err) => setError(errorMessage(err)));
  };

  if (mode === 'sets') {
    return (
      <Sheet title={`Sets for ${place.name}`} onClose={close}>
        {error && <Notice tone="error">{error}</Notice>}
        <SetChecklist
          named={named}
          checked={new Set(place.setIds)}
          onToggle={toggleSet}
          onCreate={async (name) => {
            const { id } = await createSet(name);
            await setMembership(id, place.id, true);
            await reload();
          }}
        />
        <Button onClick={close}>Done</Button>
      </Sheet>
    );
  }
  if (mode === 'note') {
    return (
      <Sheet title={place.name} onClose={close}>
        <form onSubmit={saveNote.submit} className="flex flex-col gap-3.5">
          <Field label="Note" value={note} onChange={(e) => setNote(e.target.value)} autoFocus error={saveNote.error} />
          <Button type="submit" disabled={saveNote.busy}>
            Save note
          </Button>
        </form>
      </Sheet>
    );
  }

  const setNames = named.filter((s) => place.setIds.includes(s.id)).map((s) => s.name);
  return (
    <Sheet title={place.name} onClose={close}>
      {mode === 'confirm' ? (
        <Confirm
          question={
            <>
              Delete <b>{place.name}</b> for everyone? It's removed from every set too.
            </>
          }
          action="Delete place"
          busy={remove.busy}
          error={remove.error}
          onConfirm={() => remove.submit()}
          onCancel={close}
        />
      ) : (
        <ActionList>
          <ActionButton icon={<ListChecks size={18} />} detail={setNames.join(', ') || 'None yet'} onClick={() => setMode('sets')}>
            Sets
          </ActionButton>
          <ActionButton icon={<Pencil size={18} />} onClick={() => setMode('note')}>
            Edit note
          </ActionButton>
          <a href={googleMapsUrl(place)} target="_blank" rel="noreferrer" className={actionStyle}>
            <ExternalLink size={18} aria-hidden="true" />
            Open in Google Maps
          </a>
          {from && (
            <ActionButton icon={<X size={18} />} onClick={() => removeFromSet.submit()}>
              Remove from {from.name}
            </ActionButton>
          )}
          <ActionButton icon={<Trash2 size={18} />} danger onClick={() => setMode('confirm')}>
            Delete place
          </ActionButton>
        </ActionList>
      )}
      {removeFromSet.error && <Notice tone="error">{removeFromSet.error}</Notice>}
    </Sheet>
  );
}

const actionStyle = 'flex w-full items-center gap-2.5 px-1.5 py-3.5 text-left font-semibold';

const ActionList = ({ children }: { children: ReactNode }) => <div className="flex flex-col divide-y divide-divider">{children}</div>;

function ActionButton({ icon, detail, danger = false, onClick, children }: { icon: ReactNode; detail?: string; danger?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button onClick={onClick} className={`${actionStyle} ${danger ? 'text-stamp' : ''}`}>
      <span aria-hidden="true">{icon}</span>
      <span className="flex-1">{children}</span>
      {detail && <small className="max-w-1/2 truncate font-medium text-muted">{detail}</small>}
    </button>
  );
}

export function Confirm({ question, action, busy, error, onConfirm, onCancel }: { question: ReactNode; action: string; busy: boolean; error: string; onConfirm: () => void; onCancel: () => void }) {
  return (
    <>
      <p>{question}</p>
      {error && <Notice tone="error">{error}</Notice>}
      <Button disabled={busy} onClick={onConfirm} className="!bg-stamp">
        {action}
      </Button>
      <Button variant="ghost" onClick={onCancel}>
        Keep it
      </Button>
    </>
  );
}

