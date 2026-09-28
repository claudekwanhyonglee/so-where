import { Check, ChevronDown, ChevronRight } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from './api.ts';
import type { Me } from './App.tsx';
import { plural, relativeDay } from './model.ts';
import { Link, navigate } from './router.tsx';
import { useSets, type SetSummary } from './Sets.tsx';
import { Avatars, Button, Eyebrow, Notice, SetTile, Sheet, useSubmit } from './ui.tsx';

type RecentSession = { id: string; setId: number | null; setName: string; createdAt: number; members: { id: number; name: string }[]; topPick: string | null };

export const MIN_PLACES_TO_PICK = 2;

export function Home({ me }: { me: Me }) {
  return (
    <>
      <h1 className="font-display text-[30px]/[1.1] desk:text-[38px]">Where to, {me.name}?</h1>
      <div className="grid gap-5 desk:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] desk:items-start">
        <StartCard />
        <RecentSessions />
      </div>
    </>
  );
}

function StartCard() {
  const sets = useSets();
  const [chosenId, setChosenId] = useState<SetSummary['id']>('all');
  const [choosing, setChoosing] = useState(false);
  const chosen = sets.find((s) => s.id === chosenId) ?? sets[0];
  const start = useSubmit(async () => {
    const { id } = await api<{ id: string }>('/sessions', { body: { setId: chosen.id } });
    navigate(`/s/${id}`);
  });

  return (
    <section aria-label="Start picking" className="relative flex flex-col gap-4 overflow-hidden rounded-[30px] bg-tomato p-[22px] text-peach desk:p-8">
      <span aria-hidden="true" className="absolute -right-10 -bottom-10 size-[170px] rounded-full bg-mustard/95">
        <span className="absolute inset-[26px] rounded-full border-[3px] border-dashed border-ink/25" />
      </span>
      <h2 className="relative max-w-[12ch] font-display text-[30px]/[1.05] desk:text-[42px]">Let's pick somewhere.</h2>
      {chosen && (
        <button
          aria-label={`Pick from ${chosen.name}, ${plural(chosen.placeCount, 'place')}`}
          aria-haspopup="dialog"
          onClick={() => setChoosing(true)}
          className="relative inline-flex items-center gap-2 self-start rounded-full bg-white/20 px-3.5 py-[9px] font-bold"
        >
          {chosen.name} <small className="font-medium opacity-80">{plural(chosen.placeCount, 'place')}</small>
          <ChevronDown size={18} aria-hidden="true" />
        </button>
      )}
      <Button variant="cream" className="relative self-start" disabled={!chosen || chosen.placeCount < MIN_PLACES_TO_PICK || start.busy} onClick={() => start.submit()}>
        Start picking <ChevronRight size={18} aria-hidden="true" />
      </Button>
      {start.error && <Notice tone="error">{start.error}</Notice>}
      <span className="relative max-w-[calc(100%-110px)] text-[13px] opacity-85">You'll get a link so everyone picks on their own phone.</span>
      {choosing && (
        <SetChooser
          sets={sets}
          chosenId={chosen?.id}
          onChoose={(id) => {
            setChosenId(id);
            setChoosing(false);
          }}
          onClose={() => setChoosing(false)}
        />
      )}
    </section>
  );
}

function SetChooser({ sets, chosenId, onChoose, onClose }: { sets: SetSummary[]; chosenId?: SetSummary['id']; onChoose: (id: SetSummary['id']) => void; onClose: () => void }) {
  return (
    <Sheet title="Pick from" onClose={onClose}>
      <div role="radiogroup" aria-label="Sets" className="flex flex-col gap-2">
        {sets.map((s) => {
          const tooSmall = s.placeCount < MIN_PLACES_TO_PICK;
          return (
            <button
              key={s.id}
              role="radio"
              aria-checked={s.id === chosenId}
              disabled={tooSmall}
              onClick={() => onChoose(s.id)}
              className="group flex w-full items-center gap-3 rounded-[18px] bg-white p-3 text-left ring-[1.5px] ring-edge disabled:opacity-50 aria-checked:ring-[2.5px] aria-checked:ring-tomato"
            >
              <SetTile set={s} />
              <span className="min-w-0 flex-1">
                <b className="block truncate">{s.name}</b>
                <small className="text-muted">{tooSmall ? `Add at least ${MIN_PLACES_TO_PICK} places to pick from this` : plural(s.placeCount, 'place')}</small>
              </span>
              <span className="grid size-6 flex-none place-items-center rounded-full border-2 border-[#e2cfc4] text-white group-aria-checked:border-tomato group-aria-checked:bg-tomato">
                <Check size={14} aria-hidden="true" />
              </span>
            </button>
          );
        })}
      </div>
    </Sheet>
  );
}

function RecentSessions() {
  const [sessions, setSessions] = useState<RecentSession[]>([]);
  useEffect(() => void api<RecentSession[]>('/sessions').then(setSessions), []);
  if (sessions.length === 0) return null;
  return (
    <section aria-label="Recent" className="flex flex-col gap-1.5">
      <span className="px-1.5">
        <Eyebrow>Recent</Eyebrow>
      </span>
      <ul className="flex flex-col divide-y divide-divider overflow-hidden rounded-[22px] bg-white ring-1 ring-edge">
        {sessions.map((s) => (
          <li key={s.id}>
            <Link to={`/s/${s.id}`} className="flex items-center gap-3 px-3.5 py-3 hover:bg-[#fffaf6]">
              <SetTile set={{ id: s.setId ?? 'all', name: s.setName }} />
              <span className="min-w-0 flex-1">
                <b className="block truncate">{s.setName}</b>
                <small className="block truncate text-[13px] text-muted">
                  {s.topPick ? `Top: ${s.topPick} · ` : ''}
                  {relativeDay(s.createdAt)}
                </small>
              </span>
              <Avatars people={s.members} />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
