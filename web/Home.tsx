import { useEffect, useState } from 'react';
import { api } from './api.ts';
import type { Me } from './App.tsx';
import { Link, navigate } from './router.tsx';
import { useSets } from './Sets.tsx';
import { Button, Card, Notice, Section, Select, useSubmit } from './ui.tsx';

type RecentSession = { id: string; setName: string; createdAt: number; memberCount: number };

export function Home({ me }: { me: Me }) {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-3xl font-black tracking-tight">Where to, {me.name}?</h1>
      <StartSession />
      <RecentSessions />
    </div>
  );
}

function StartSession() {
  const sets = useSets();
  const [setId, setSetId] = useState('all');
  const start = useSubmit(async () => {
    const { id } = await api<{ id: string }>('/sessions', { body: { setId } });
    navigate(`/s/${id}`);
  });
  return (
    <Section title="Start picking">
      <form onSubmit={start.submit} className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1">
          <Select label="Set" value={setId} onChange={(e) => setSetId(e.target.value)}>
            {sets.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </div>
        <Button type="submit" disabled={start.busy}>
          Start picking
        </Button>
      </form>
      {start.error && <Notice tone="error">{start.error}</Notice>}
      <p className="text-sm text-stone-500">You'll get a link to share, so everyone can pick on their own phone.</p>
    </Section>
  );
}

function RecentSessions() {
  const [sessions, setSessions] = useState<RecentSession[]>([]);
  useEffect(() => void api<RecentSession[]>('/sessions').then(setSessions), []);
  if (sessions.length === 0) return null;
  return (
    <Card>
      <h2 className="mb-3 text-lg font-bold">Recent sessions</h2>
      <ul className="flex flex-col divide-y divide-stone-100">
        {sessions.map((s) => (
          <li key={s.id}>
            <Link to={`/s/${s.id}`} className="flex items-center justify-between gap-3 py-2.5 hover:text-orange-700">
              <span className="font-semibold">{s.setName}</span>
              <span className="text-sm text-stone-500">
                {new Date(s.createdAt).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })} · {s.memberCount}{' '}
                {s.memberCount === 1 ? 'person' : 'people'}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}
