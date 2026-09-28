import { Plus } from 'lucide-react';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { api } from './api.ts';
import { Avatar, Button, Field, PinInput, PinWarning } from './ui.tsx';

type Person = { id: number; name: string };

type Step = { kind: 'who' } | { kind: 'pin'; person: Person } | { kind: 'new-name'; name: string } | { kind: 'new-pin'; name: string };

/** Someone who doesn't exist yet still gets a colour: the swatch the prototype used for newcomers. */
const newcomer = (name: string): Person => ({ id: 3, name });

export function SignIn({ onSignedIn }: { onSignedIn: () => void }) {
  const [people, setPeople] = useState<Person[]>([]);
  const [step, setStep] = useState<Step>({ kind: 'who' });
  const back = () => setStep({ kind: 'who' });

  useEffect(() => {
    api<Person[]>('/people').then(setPeople);
  }, []);

  switch (step.kind) {
    case 'who':
      return <WhoIsHungry people={people} onChoose={(person) => setStep({ kind: 'pin', person })} onNew={() => setStep({ kind: 'new-name', name: '' })} />;
    case 'pin':
      return (
        <PinStep person={step.person} title={`Hey ${step.person.name}, your PIN?`} backLabel={`Not ${step.person.name}?`} onBack={back}>
          <PinInput
            onComplete={async (pin) => {
              await api('/signin', { body: { name: step.person.name, pin } });
              onSignedIn();
            }}
          />
        </PinStep>
      );
    case 'new-name':
      return <NewName initial={step.name} onContinue={(name) => setStep({ kind: 'new-pin', name })} onBack={back} />;
    case 'new-pin':
      return (
        <PinStep person={newcomer(step.name)} title="Pick a 4-digit PIN" backLabel="Back" onBack={() => setStep({ kind: 'new-name', name: step.name })}>
          <PinInput
            onComplete={async (pin) => {
              await api('/people', { body: { name: step.name, pin } });
              onSignedIn();
            }}
          />
          <PinWarning />
        </PinStep>
      );
  }
}

/** Centred on the screen; `top` keeps it in the top half on phones so the keyboard doesn't cover it. */
function Screen({ top = false, children }: { top?: boolean; children: ReactNode }) {
  return (
    <main className={`flex min-h-dvh flex-col items-center px-[22px] py-8 desk:justify-center ${top ? 'justify-start pt-[max(12vh,env(safe-area-inset-top))]' : 'justify-center'}`}>
      <div className="flex w-full max-w-[380px] flex-col gap-[26px]">{children}</div>
    </main>
  );
}

const screenTitle = 'font-display text-[30px]/[1.1] desk:text-[38px]';

function WhoIsHungry({ people, onChoose, onNew }: { people: Person[]; onChoose: (p: Person) => void; onNew: () => void }) {
  return (
    <Screen>
      <div>
        <p className="font-display text-[46px]/none text-tomato">So Where?</p>
        <p className="mt-2 text-muted">Where should we eat? Let's actually decide.</p>
      </div>
      <h1 className={screenTitle}>Who's hungry?</h1>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(80px,1fr))] gap-x-2 gap-y-[18px]">
        {people.map((p) => (
          <PersonButton key={p.id} onClick={() => onChoose(p)} icon={<Avatar person={p} size="xl" />}>
            {p.name}
          </PersonButton>
        ))}
        <PersonButton
          onClick={onNew}
          icon={
            <span className="grid size-[76px] place-items-center rounded-[28px] border-2 border-dashed border-[#d9bfb1] text-muted transition-transform">
              <Plus aria-hidden="true" />
            </span>
          }
        >
          I'm new here
        </PersonButton>
      </div>
    </Screen>
  );
}

function PersonButton({ icon, children, onClick }: { icon: ReactNode; children: ReactNode; onClick: () => void }) {
  return (
    <button onClick={onClick} className="group flex flex-col items-center gap-2 rounded-[20px] py-1.5 font-bold [&>span:first-child]:group-hover:-translate-y-0.5 [&>span:first-child]:group-hover:-rotate-2">
      {icon}
      <span className="max-w-full truncate">{children}</span>
    </button>
  );
}

function PinStep({ person, title, backLabel, onBack, children }: { person: Person; title: string; backLabel: string; onBack: () => void; children: ReactNode }) {
  return (
    <Screen top>
      <div className="flex flex-col items-center gap-2.5 text-center">
        <Avatar person={person} size="xl" />
        <h1 className="font-display text-[22px]/tight">{title}</h1>
      </div>
      {children}
      <Button variant="ghost" onClick={onBack}>
        {backLabel}
      </Button>
    </Screen>
  );
}

function NewName({ initial, onContinue, onBack }: { initial: string; onContinue: (name: string) => void; onBack: () => void }) {
  const [name, setName] = useState(initial);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (name.trim()) onContinue(name.trim());
  };
  return (
    <Screen>
      <h1 className={screenTitle}>What should we call you?</h1>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field
          label="Your name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          maxLength={40}
          autoComplete="nickname"
          autoFocus
          hint="It's how you'll show up on everyone's leaderboard."
        />
        <Button type="submit">Continue</Button>
      </form>
      <Button variant="ghost" onClick={onBack}>
        Back
      </Button>
    </Screen>
  );
}
