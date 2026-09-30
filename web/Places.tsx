import { ChevronLeft, Ellipsis, Plus, Upload } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { api } from './api.ts';
import { plural, type Place } from './model.ts';
import { AddPlaceSheet, AddToSetSheet, ImportSheet, NewSetSheet, PlaceActionsSheet, SetActionsSheet } from './PlaceSheets.tsx';
import { Link } from './router.tsx';
import { Button, Card, Eyebrow, IconButton, Notice, PlaceTile, SetTile, useIsDesktop } from './ui.tsx';

export type SetId = number | 'all';
export type SetSummary = { id: SetId; name: string; builtIn: boolean; placeCount: number };
export type NamedSet = SetSummary & { id: number };
export type PlaceWithSets = Place & { setIds: number[] };

export function useSets() {
  const [sets, setSets] = useState<SetSummary[] | null>(null);
  const reload = useCallback(() => api<SetSummary[]>('/sets').then(setSets), []);
  useEffect(() => void reload(), [reload]);
  return { sets, reload };
}

function usePlaces() {
  const [places, setPlaces] = useState<PlaceWithSets[] | null>(null);
  const reload = useCallback(() => api<PlaceWithSets[]>('/places').then(setPlaces), []);
  useEffect(() => void reload(), [reload]);
  return { places, reload };
}

export const isNamed = (s: SetSummary): s is NamedSet => s.id !== 'all';
export const placesIn = (set: SetSummary, places: PlaceWithSets[]) => (isNamed(set) ? places.filter((p) => p.setIds.includes(set.id)) : places);

/** Which sheet is open on the Places tab, and what it's about. */
export type OpenSheet =
  | { kind: 'add-place'; setId?: number }
  | { kind: 'import' }
  | { kind: 'new-set' }
  | { kind: 'set-actions'; setId: number }
  | { kind: 'add-to-set'; setId: number }
  | { kind: 'place-actions'; placeId: number; setId: SetId };

/** Places, organised by sets. `setId` is the set in the URL (/places/<setId>), if any. */
export function Places({ setId }: { setId?: string }) {
  const desktop = useIsDesktop();
  const { sets, reload: reloadSets } = useSets();
  const { places, reload: reloadPlaces } = usePlaces();
  const [sheet, setSheet] = useState<OpenSheet | null>(null);
  const reload = () => Promise.all([reloadSets(), reloadPlaces()]);

  if (!sets || !places) return null;
  const selected = sets.find((s) => String(s.id) === (setId ?? (desktop ? 'all' : undefined)));
  if (setId && !selected) return <Notice tone="error">That set doesn't exist any more.</Notice>;

  const open = setSheet;
  const header = <PlacesHeader places={places} sets={sets} open={open} />;
  const detail = selected && <SetDetail set={selected} places={places} sets={sets} showBack={!desktop} open={open} />;

  return (
    <>
      {desktop ? (
        <>
          {header}
          <div className="grid grid-cols-[250px_minmax(0,1fr)] items-start gap-6">
            <SetsRail sets={sets} selected={selected!} open={open} />
            {detail}
          </div>
        </>
      ) : (
        (detail ?? (
          <>
            {header}
            <SetCards sets={sets} places={places} open={open} />
          </>
        ))
      )}
      {sheet && <Sheets sheet={sheet} sets={sets} places={places} open={open} close={() => setSheet(null)} reload={reload} />}
    </>
  );
}

function Sheets({
  sheet,
  sets,
  places,
  open,
  close,
  reload,
}: {
  sheet: OpenSheet;
  sets: SetSummary[];
  places: PlaceWithSets[];
  open: (sheet: OpenSheet) => void;
  close: () => void;
  reload: () => Promise<unknown>;
}) {
  const named = sets.filter(isNamed);
  const setById = (id: number) => named.find((s) => s.id === id);
  switch (sheet.kind) {
    case 'add-place':
      return <AddPlaceSheet named={named} into={sheet.setId === undefined ? undefined : setById(sheet.setId)} open={open} close={close} reload={reload} />;
    case 'import':
      return <ImportSheet close={close} reload={reload} />;
    case 'new-set':
      return <NewSetSheet open={open} close={close} reload={reload} />;
    case 'set-actions': {
      const set = setById(sheet.setId);
      return set ? <SetActionsSheet set={set} close={close} reload={reload} /> : null;
    }
    case 'add-to-set': {
      const set = setById(sheet.setId);
      return set ? <AddToSetSheet set={set} places={places} open={open} close={close} reload={reload} /> : null;
    }
    case 'place-actions': {
      const place = places.find((p) => p.id === sheet.placeId);
      const from = sheet.setId === 'all' ? undefined : setById(sheet.setId);
      return place ? <PlaceActionsSheet place={place} from={from} named={named} close={close} reload={reload} /> : null;
    }
  }
}

function PlacesHeader({ places, sets, open }: { places: PlaceWithSets[]; sets: SetSummary[]; open: (s: OpenSheet) => void }) {
  return (
    <div className="flex items-end gap-3">
      <div className="min-w-0 flex-1">
        <h1 className="font-display text-[30px]/[1.1] desk:text-[38px]">Places</h1>
        <p className="mt-0.5 text-muted">
          {plural(places.length, 'place')} in {plural(sets.filter(isNamed).length, 'set')}
        </p>
      </div>
      <Button variant="ghost" aria-label="Import" onClick={() => open({ kind: 'import' })} className="!p-[11px] desk:!px-[18px]">
        <Upload size={18} aria-hidden="true" />
        <span className="hidden desk:inline">Import</span>
      </Button>
      <Button onClick={() => open({ kind: 'add-place' })}>
        <Plus size={18} aria-hidden="true" />
        Add place
      </Button>
    </div>
  );
}

/** Desktop: the sets down the left, "All places" first. */
function SetsRail({ sets, selected, open }: { sets: SetSummary[]; selected: SetSummary; open: (s: OpenSheet) => void }) {
  return (
    <div className="sticky top-4 flex flex-col rounded-[22px] bg-white p-2 ring-1 ring-edge">
      <nav aria-label="Sets" className="flex flex-col gap-0.5">
        {sets.map((s) => (
          <Link
            key={s.id}
            to={`/places/${s.id}`}
            aria-current={s.id === selected.id ? 'page' : undefined}
            className="flex items-center gap-2.5 rounded-[14px] px-2.5 py-2 hover:bg-[#fffaf6] aria-[current=page]:bg-blush"
          >
            <SetTile set={s} className="size-8 rounded-[10px] text-[15px]" />
            <b className="min-w-0 flex-1 truncate">{s.name}</b>
            <small className="font-semibold text-muted tabular-nums">{s.placeCount}</small>
          </Link>
        ))}
      </nav>
      <button onClick={() => open({ kind: 'new-set' })} className="mt-1 flex items-center gap-2.5 border-t border-divider px-2.5 pt-3 pb-2 font-bold text-muted">
        <Plus size={18} aria-hidden="true" /> New set
      </button>
    </div>
  );
}

/** Phones: a card per set, "All places" first; each opens the set's page. */
function SetCards({ sets, places, open }: { sets: SetSummary[]; places: PlaceWithSets[]; open: (s: OpenSheet) => void }) {
  const cardStyle = 'flex flex-col gap-3.5 rounded-[24px] p-[18px] text-left transition-transform hover:-translate-y-0.5';
  const newStyle = `${cardStyle} min-h-[120px] items-center justify-center border-2 border-dashed border-[#e2cfc4] font-bold text-muted`;
  return (
    <div className="flex flex-col gap-3">
      <ul aria-label="Sets" className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3">
        {sets.map((s) => (
          <li key={s.id}>
            <Link to={`/places/${s.id}`} className={`${cardStyle} bg-white ring-1 ring-edge`}>
              <span className="flex items-center gap-2.5">
                <SetTile set={s} className="size-11 rounded-[14px] text-xl" />
                <span className="flex [&>*]:ring-[3px] [&>*]:ring-white [&>*+*]:-ml-1.5">
                  {placesIn(s, places)
                    .slice(0, 4)
                    .map((p) => (
                      <PlaceTile key={p.id} place={p} className="size-[30px] rounded-[10px] text-sm" />
                    ))}
                </span>
              </span>
              <b className="font-display text-[22px]/[1.1] font-normal">{s.name}</b>
              <span className="text-sm text-muted">
                {plural(s.placeCount, 'place')}
                {s.builtIn && " · everything you've added"}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <button onClick={() => open({ kind: 'new-set' })} className={newStyle}>
        <span className="flex items-center gap-2">
          <Plus size={18} aria-hidden="true" /> New set
        </span>
      </button>
      {places.length < 5 && (
        <button onClick={() => open({ kind: 'import' })} className={newStyle}>
          <span className="flex items-center gap-2">
            <Upload size={18} aria-hidden="true" /> Import your Google Maps lists
          </span>
        </button>
      )}
    </div>
  );
}

function SetDetail({ set, places, sets, showBack, open }: { set: SetSummary; places: PlaceWithSets[]; sets: SetSummary[]; showBack: boolean; open: (s: OpenSheet) => void }) {
  const inSet = placesIn(set, places);

  return (
    <section aria-labelledby="set-title" className="flex min-w-0 flex-col gap-3.5">
      <div className="flex items-center gap-2.5">
        {showBack && (
          <Link to="/places" aria-label="All sets" className="grid size-[38px] flex-none place-items-center rounded-full bg-white ring-1 ring-edge">
            <ChevronLeft size={18} aria-hidden="true" />
          </Link>
        )}
        <div className="min-w-0 flex-1">
          <Eyebrow>
            {set.builtIn ? "Everything you've added" : 'Set'} · {plural(inSet.length, 'place')}
          </Eyebrow>
          <h1 id="set-title" className="truncate font-display text-2xl/tight desk:text-3xl/tight">
            {set.name}
          </h1>
        </div>
        {isNamed(set) && (
          <IconButton label="Set options" onClick={() => open({ kind: 'set-actions', setId: set.id })}>
            <Ellipsis size={18} />
          </IconButton>
        )}
      </div>
      {inSet.length === 0 ? (
        <EmptySet set={set} open={open} />
      ) : (
        <>
          {isNamed(set) ? (
            <AddButton onClick={() => open({ kind: 'add-to-set', setId: set.id })}>Add to set</AddButton>
          ) : (
            // All places uses the header's Add place, which phones don't show alongside the detail.
            showBack && <AddButton onClick={() => open({ kind: 'add-place' })}>Add place</AddButton>
          )}
          <ul aria-label={`Places in ${set.name}`} className="flex flex-col divide-y divide-divider overflow-hidden rounded-[22px] bg-white ring-1 ring-edge">
            {inSet.map((p) => (
              <PlaceRow key={p.id} place={p} otherSets={sets.filter((s) => isNamed(s) && s.id !== set.id && p.setIds.includes(s.id))} onMore={() => open({ kind: 'place-actions', placeId: p.id, setId: set.id })} />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

const AddButton = ({ onClick, children }: { onClick: () => void; children: string }) => (
  <Button variant="secondary" onClick={onClick} className="self-start">
    <Plus size={18} aria-hidden="true" />
    {children}
  </Button>
);

function EmptySet({ set, open }: { set: SetSummary; open: (s: OpenSheet) => void }) {
  const into = isNamed(set) ? set.id : undefined;
  return (
    <Card className="flex flex-col items-center gap-2.5 py-8 text-center">
      <span aria-hidden="true" className="grid size-[76px] -rotate-6 place-items-center rounded-[26px] bg-mustard font-display text-[34px]">
        +
      </span>
      <b>Nothing in {set.name} yet</b>
      <span className="text-muted">{into ? "Pick from places you've already added, or paste a new Google Maps link." : 'Paste a Google Maps link, or import your saved lists.'}</span>
      <div className="flex flex-wrap justify-center gap-2.5">
        {into ? (
          <Button onClick={() => open({ kind: 'add-to-set', setId: into })}>Choose places</Button>
        ) : (
          <Button onClick={() => open({ kind: 'import' })}>Import</Button>
        )}
        <Button variant="secondary" onClick={() => open({ kind: 'add-place', setId: into })}>
          Paste a link
        </Button>
      </div>
    </Card>
  );
}

function PlaceRow({ place, otherSets, onMore }: { place: PlaceWithSets; otherSets: SetSummary[]; onMore: () => void }) {
  const locating = place.suburb === null && place.lat === null;
  return (
    <li className="flex items-start gap-3 px-3.5 py-3">
      <PlaceTile place={place} />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <b className="font-bold wrap-anywhere">{place.name}</b>
        <small className="text-[13px] text-muted">
          {locating ? (
            <span className="inline-flex items-center gap-1.5 before:size-2 before:animate-pulse before:rounded-full before:bg-mustard">Finding suburb…</span>
          ) : (
            (place.suburb ?? 'Suburb unknown')
          )}
        </small>
        {place.note && <i className="text-[13px] text-[#6d5249]">“{place.note}”</i>}
        {otherSets.length > 0 && (
          <span className="mt-1.5 flex flex-wrap gap-1">
            {otherSets.map((s) => (
              <span key={s.id} className="rounded-full bg-soft px-2 py-0.5 text-[11px] font-bold text-muted">
                {s.name}
              </span>
            ))}
          </span>
        )}
      </span>
      <IconButton label={`More for ${place.name}`} onClick={onMore}>
        <Ellipsis size={18} />
      </IconButton>
    </li>
  );
}
