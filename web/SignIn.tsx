import { useEffect, useState } from 'react';
import { api } from './api.ts';
import { Button, Card, Field, Notice, PinField, PinWarning, useSubmit } from './ui.tsx';

type Person = { id: number; name: string };

export function SignIn({ onSignedIn }: { onSignedIn: () => void }) {
  const [people, setPeople] = useState<Person[]>([]);
  const [chosen, setChosen] = useState<string | 'new' | null>(null);

  useEffect(() => {
    api<Person[]>('/people').then(setPeople);
  }, []);

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 p-4">
      <header className="text-center">
        <h1 className="font-display text-5xl text-tomato">So Where?</h1>
        <p className="mt-2 text-stone-600">Where should we eat? Let's actually decide.</p>
      </header>
      <Card className="flex flex-col gap-4">
        {chosen === null && (
          <>
            <h2 className="font-bold">Who are you?</h2>
            <div className="flex flex-wrap gap-2">
              {people.map((p) => (
                <Button key={p.id} variant="secondary" onClick={() => setChosen(p.name)}>
                  {p.name}
                </Button>
              ))}
            </div>
            <Button variant="ghost" onClick={() => setChosen('new')}>
              I'm new here
            </Button>
          </>
        )}
        {chosen === 'new' && <NewPersonForm onDone={onSignedIn} onBack={people.length ? () => setChosen(null) : undefined} />}
        {chosen !== null && chosen !== 'new' && <PinForm name={chosen} onDone={onSignedIn} onBack={() => setChosen(null)} />}
      </Card>
    </main>
  );
}

function NewPersonForm({ onDone, onBack }: { onDone: () => void; onBack?: () => void }) {
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  const { submit, error, busy } = useSubmit(async () => {
    await api('/people', { body: { name, pin } });
    onDone();
  });
  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <h2 className="font-bold">Welcome! Pick a name and PIN</h2>
      <Field label="Your name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={40} autoComplete="nickname" />
      <PinField label="Choose a 4-digit PIN" value={pin} onChange={setPin} />
      <PinWarning />
      {error && <Notice tone="error">{error}</Notice>}
      <Button type="submit" disabled={busy}>
        Start
      </Button>
      {onBack && (
        <Button type="button" variant="ghost" onClick={onBack}>
          Back
        </Button>
      )}
    </form>
  );
}

function PinForm({ name, onDone, onBack }: { name: string; onDone: () => void; onBack: () => void }) {
  const [pin, setPin] = useState('');
  const { submit, error, busy } = useSubmit(async () => {
    try {
      await api('/signin', { body: { name, pin } });
      onDone();
    } finally {
      setPin('');
    }
  });
  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <h2 className="font-bold">Hey {name}, what's your PIN?</h2>
      <PinField label="PIN" value={pin} onChange={setPin} />
      {error && <Notice tone="error">{error}</Notice>}
      <Button type="submit" disabled={busy}>
        Sign in
      </Button>
      <Button type="button" variant="ghost" onClick={onBack}>
        Not {name}?
      </Button>
    </form>
  );
}
