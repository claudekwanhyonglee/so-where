import { useCallback, useEffect, useState } from 'react';
import { api } from './api.ts';
import { usePlaces } from './Places.tsx';
import { Link, navigate } from './router.tsx';
import { Button, Card, Field, Notice, Section, useSubmit } from './ui.tsx';

export type SetSummary = { id: number | 'all'; name: string; builtIn: boolean; placeCount: number };
type SetDetail = { id: number | 'all'; name: string; builtIn: boolean; placeIds: number[] };

export function useSets() {
  const [sets, setSets] = useState<SetSummary[]>([]);
  useEffect(() => void api<SetSummary[]>('/sets').then(setSets), []);
  return sets;
}

export function Sets() {
  const sets = useSets();
  const [name, setName] = useState('');
  const create = useSubmit(async () => {
    const { id } = await api<{ id: number }>('/sets', { body: { name } });
    navigate(`/sets/${id}`);
  });

  return (
    <div className="flex flex-col gap-4">
      <Section title="New set">
        <form onSubmit={create.submit} className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <Field label="New set name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Date night" required maxLength={60} />
          </div>
          <Button type="submit" disabled={create.busy}>
            Create set
          </Button>
        </form>
        {create.error && <Notice tone="error">{create.error}</Notice>}
      </Section>
      <ul className="grid gap-3 sm:grid-cols-2">
        {sets.map((s) => (
          <li key={s.id}>
            <Link to={`/sets/${s.id}`} className="flex items-center justify-between rounded-2xl bg-white p-4 shadow-sm ring-1 ring-stone-200 hover:ring-orange-300">
              <span className="font-bold">
                {s.name}
                {s.builtIn && <span className="ml-2 rounded-full bg-stone-100 px-2 py-0.5 text-xs font-medium text-stone-500">built-in</span>}
              </span>
              <span className="text-sm text-stone-500">{s.placeCount} places</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function SetPage({ id }: { id: string }) {
  const { places } = usePlaces();
  const [set, setSet] = useState<SetDetail | null>(null);
  const reload = useCallback(() => api<SetDetail>(`/sets/${id}`).then(setSet), [id]);
  useEffect(() => void reload(), [reload]);

  if (!set) return null;
  const members = new Set(set.placeIds);

  const toggle = (placeId: number, include: boolean) => {
    const placeIds = include ? [...set.placeIds, placeId] : set.placeIds.filter((p) => p !== placeId);
    setSet({ ...set, placeIds });
    api(`/sets/${id}/places/${placeId}`, { method: include ? 'PUT' : 'DELETE' }).catch(reload);
  };

  return (
    <div className="flex flex-col gap-4">
      <Link to="/sets" className="text-sm font-semibold text-orange-700">
        ← Sets
      </Link>
      {set.builtIn ? (
        <Card>
          <h1 className="text-2xl font-black">{set.name}</h1>
          <p className="text-stone-600">This set always contains every place, so it can't be edited.</p>
        </Card>
      ) : (
        <SetHeader set={set} onRenamed={reload} />
      )}
      <p className="px-1 text-sm font-semibold uppercase tracking-wide text-stone-500">
        {members.size} {members.size === 1 ? 'place' : 'places'} in this set
      </p>
      <ul className="grid gap-2 sm:grid-cols-2">
        {places.map((p) => (
          <li key={p.id} className="rounded-xl bg-white px-4 py-3 shadow-sm ring-1 ring-stone-200">
            {set.builtIn ? (
              <span className="font-semibold">{p.name}</span>
            ) : (
              <label className="flex cursor-pointer items-center gap-3">
                <input type="checkbox" className="size-5 accent-orange-600" checked={members.has(p.id)} onChange={(e) => toggle(p.id, e.target.checked)} />
                <span className="font-semibold">{p.name}</span>
                <span className="ml-auto text-sm text-stone-500">{p.suburb}</span>
              </label>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function SetHeader({ set, onRenamed }: { set: SetDetail; onRenamed: () => void }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(set.name);
  const rename = useSubmit(async () => {
    await api(`/sets/${set.id}`, { method: 'PATCH', body: { name } });
    setEditing(false);
    onRenamed();
  });
  const remove = async () => {
    if (!confirm(`Delete the set "${set.name}"? Its places stay in the list.`)) return;
    await api(`/sets/${set.id}`, { method: 'DELETE' });
    navigate('/sets');
  };

  return (
    <Card className="flex flex-col gap-3">
      {editing ? (
        <form onSubmit={rename.submit} className="flex flex-col gap-3">
          <Field label="Set name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={60} autoFocus />
          {rename.error && <Notice tone="error">{rename.error}</Notice>}
          <div className="flex gap-2">
            <Button type="submit">Save</Button>
            <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <h1 className="text-2xl font-black">{set.name}</h1>
      )}
      {!editing && (
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setEditing(true)}>
            Rename
          </Button>
          <Button variant="danger" onClick={remove}>
            Delete set
          </Button>
        </div>
      )}
    </Card>
  );
}
