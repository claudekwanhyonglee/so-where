import { Check, ChevronLeft, ChevronRight } from 'lucide-react';
import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { api } from './api.ts';
import type { Me } from './App.tsx';
import { guideSteps, isFinished, isPassed, routeCount, type GuideState, type GuideStep, type StepId } from './guide-steps.ts';
import { HomeSheet } from './HomeSheet.tsx';
import { GuideHomeArt, GuidePickArt, GuidePlacesArt, SkipArrow, TramIcon } from './illustrations.tsx';
import { plural } from './model.ts';
import { AddPlaceSheet, ImportSheet } from './PlaceSheets.tsx';
import { isNamed, useSets } from './Places.tsx';
import { navigate } from './router.tsx';
import { Button, Notice, Stamp, useSubmit } from './ui.tsx';
import { usePolling } from './usePolling.ts';

const GUIDE_POLL_MS = 3000; // steps done on another device show up without a reload

const STEP_INFO: Record<StepId, { title: string; short: string; Art: typeof GuideHomeArt }> = {
  home: { title: 'Set your home', short: 'Home', Art: GuideHomeArt },
  places: { title: 'Add 2 places', short: 'Places', Art: GuidePlacesArt },
  pick: { title: 'Start picking', short: 'Pick', Art: GuidePickArt },
};

/** A stop's name for screen readers: the step, and whether it was skipped. */
const stopLabel = (s: GuideStep) => `${STEP_INFO[s.id].title}${s.status === 'skipped' ? ', skipped' : ''}`;

type Actions = { addHome: () => void; skipHome: () => void; addPlace: () => void; importPlaces: () => void; startPicking: () => void; closeGuide: () => void };

/** Home for someone who hasn't finished getting started: a heading, then the guide card, which replaces the start card. */
export function Guide({ me, onMeChanged }: { me: Me; onMeChanged: () => void }) {
  const [version, setVersion] = useState(0);
  const state = usePolling(useCallback(() => api<GuideState>(`/guide?v=${version}`), [version]), GUIDE_POLL_MS);
  const reload = () => setVersion((v) => v + 1);
  const [sheet, setSheet] = useState<'home' | 'add-place' | 'import' | null>(null);
  const { sets, reload: reloadSets } = useSets();
  const start = useSubmit(async () => {
    const { id } = await api<{ id: string }>('/sessions', { body: { setId: 'all' } });
    navigate(`/s/${id}`);
  });
  const skip = useSubmit(async () => {
    await api('/me/skip-home', { body: {} });
    reload();
  });
  const close = useSubmit(async () => {
    await api('/guide/close', { body: {} });
    onMeChanged();
  });
  if (!state) return null;

  const steps = guideSteps(state);
  const finished = isFinished(steps);
  const actions: Actions = {
    addHome: () => setSheet('home'),
    skipHome: () => void skip.submit(),
    addPlace: () => setSheet('add-place'),
    importPlaces: () => setSheet('import'),
    startPicking: () => void start.submit(),
    closeGuide: () => void close.submit(),
  };
  const error = start.error || skip.error || close.error;
  const closeSheet = () => setSheet(null);
  const reloadAll = () => Promise.all([reloadSets(), reload()]);

  return (
    <>
      <div className="flex flex-col gap-0.5 desk:flex-row desk:flex-wrap desk:items-baseline desk:gap-x-4">
        <h1 className="font-display text-[30px]/[1.1] wrap-break-word desk:text-[38px]">Pull up a chair, {me.name}.</h1>
        <p className="font-semibold text-muted desk:text-[15px]">{finished ? 'Your table is ready.' : `${steps.length === 2 ? 'Two' : 'Three'} quick stops and you're picking.`}</p>
      </div>
      <section aria-label="Getting started" className="flex flex-col gap-2">
        <GuideCard steps={steps} state={state} actions={actions} finished={finished} />
        {error && <Notice tone="error">{error}</Notice>}
        {!finished && (
          <button onClick={actions.closeGuide} className="self-start px-1.5 text-sm font-bold text-muted underline underline-offset-3 hover:text-ink">
            Close the guide
          </button>
        )}
      </section>
      {sheet === 'home' && (
        <HomeSheet
          me={me}
          onSaved={() => {
            onMeChanged();
            reload();
          }}
          close={closeSheet}
        />
      )}
      {sheet === 'add-place' && <AddPlaceSheet named={(sets ?? []).filter(isNamed)} close={closeSheet} reload={reloadAll} />}
      {sheet === 'import' && <ImportSheet showFirstSet={false} close={closeSheet} reload={reloadAll} />}
    </>
  );
}

const smoothUnlessReduced = (): ScrollBehavior => (matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth');

/**
 * One tomato card: the route, the steps side by side in a snap-scrolling row (swipe on a phone; arrows, dots and stops
 * scroll it), and the arrows. The scroll position is the only record of which step is shown. The steps share one row,
 * so the card is as tall as its tallest step, whichever is showing.
 */
function GuideCard({ steps, state, actions, finished }: { steps: GuideStep[]; state: GuideState; actions: Actions; finished: boolean }) {
  const scroller = useRef<HTMLDivElement>(null);
  const current = steps.findIndex((s) => s.status === 'current');
  const [viewed, setViewed] = useState(Math.max(current, 0));
  const show = (i: number, behavior: ScrollBehavior = smoothUnlessReduced()) => {
    const el = scroller.current!;
    el.scrollTo({ left: i * el.clientWidth, behavior });
  };

  // Open on the current step, and move on to the next one as each gets done.
  const opened = useRef(false);
  useEffect(() => {
    if (current < 0 || !scroller.current) return;
    show(current, opened.current ? smoothUnlessReduced() : 'instant');
    opened.current = true;
  }, [current]);

  const shownStop = finished ? -1 : viewed;
  return (
    <div data-testid="guide-card" className="relative grid overflow-hidden rounded-[30px] bg-tomato text-peach desk:grid-cols-[minmax(0,1fr)_310px] desk:grid-rows-[1fr_auto]">
      <span aria-hidden="true" className="absolute -right-10 -bottom-10 size-[150px] rounded-full bg-mustard desk:right-auto desk:-bottom-[70px] desk:-left-[60px] desk:size-[220px]" />
      <RoutePanel steps={steps} viewed={shownStop} onView={(i) => show(i)} />
      <div
        ref={scroller}
        data-testid="guide-steps"
        onScroll={(e) => setViewed(Math.round(e.currentTarget.scrollLeft / e.currentTarget.clientWidth))}
        className="relative flex snap-x snap-mandatory overflow-x-auto overscroll-x-contain [scrollbar-width:none] desk:col-start-1 desk:row-start-1"
      >
        {finished ? (
          <AllSet steps={steps} state={state} actions={actions} />
        ) : (
          steps.map((s, i) => <StepPane key={s.id} step={s} number={i + 1} total={steps.length} shown={i === viewed} state={state} actions={actions} />)
        )}
      </div>
      <StepNav steps={steps} viewed={viewed} onView={(i) => show(i)} hidden={finished} />
    </div>
  );
}

/** One step, laid out the same way as every other so their parts line up: label, drawing, title, text, extra line, buttons. */
function Pane({ label, badge, art, faded = false, title, text, extra, buttons, shown = true }: { label: string; badge?: ReactNode; art: ReactNode; faded?: boolean; title: string; text: string; extra?: ReactNode; buttons: ReactNode; shown?: boolean }) {
  return (
    <section
      aria-label={title}
      aria-hidden={!shown || undefined}
      inert={!shown}
      className="flex w-full flex-none snap-start snap-always flex-col items-start gap-2.5 px-[22px] pt-5 desk:gap-3 desk:px-9 desk:pt-8"
    >
      <span className="flex min-h-[22px] items-center gap-2">
        <span className="text-[11px] font-bold tracking-[.07em] uppercase opacity-85">{label}</span>
        {badge}
      </span>
      <span className={`rounded-[22px] bg-peach p-2 desk:p-3 ${faded ? 'opacity-70 saturate-50' : ''}`}>{art}</span>
      <h3 className="font-display text-2xl/[1.1] desk:text-[32px]">{title}</h3>
      <p className="max-w-[36ch] text-[13.5px] desk:text-[15px]">{text}</p>
      <div className="min-h-6">{extra}</div>
      <div className="mt-auto flex flex-wrap items-center gap-2 desk:gap-2.5">{buttons}</div>
    </section>
  );
}

const artSize = 'size-[84px] desk:size-28';

function StepPane({ step, number, total, shown, state, actions }: { step: GuideStep; number: number; total: number; shown: boolean; state: GuideState; actions: Actions }) {
  const { title, Art } = STEP_INFO[step.id];
  const { text, extra, buttons } = STEP_CONTENT[step.id](step, state, actions);
  const optional = step.id === 'home' && step.status !== 'done' ? ' · optional' : '';
  return (
    <Pane
      shown={shown}
      label={step.status === 'upcoming' ? 'Coming up' : `Step ${number} of ${total}${optional}`}
      badge={step.status === 'skipped' ? <Stamp large className="text-mustard">Skipped</Stamp> : step.status === 'done' ? <DoneBadge /> : null}
      art={<Art className={artSize} />}
      faded={step.status === 'upcoming'}
      title={title}
      text={text}
      extra={extra}
      buttons={buttons}
    />
  );
}

const DoneBadge = () => (
  <span className="inline-flex items-center gap-1 rounded-full bg-peach px-2 py-0.5 text-[11px] font-extrabold tracking-[.05em] text-leaf uppercase">
    <Check size={12} strokeWidth={3} aria-hidden="true" /> Done
  </span>
);

const TextButton = ({ onClick, children }: { onClick: () => void; children: ReactNode }) => (
  <button onClick={onClick} className="px-1.5 py-[11px] font-bold underline underline-offset-3">
    {children}
  </button>
);

type Content = { text: string; extra?: ReactNode; buttons?: ReactNode };

/** What each step says and offers, by where the person is. The order is a suggestion: only picking waits (for 2 places). */
const STEP_CONTENT: Record<StepId, (step: GuideStep, state: GuideState, actions: Actions) => Content> = {
  home: (step, state, a) => {
    if (step.status === 'done') return { text: `Home is ${state.home}. Change it any time on the You page.` };
    if (step.status === 'skipped') return { text: 'No problem. Add it whenever you like to see travel times on every card.', buttons: <AddHomeButton onClick={a.addHome} /> };
    return {
      text: 'See how long public transport takes to each place, from your door.',
      buttons: (
        <>
          <AddHomeButton onClick={a.addHome} />
          <TextButton onClick={a.skipHome}>Skip for now</TextButton>
        </>
      ),
    };
  },
  places: (step, state, a) => {
    if (step.status === 'done') return { text: `${plural(state.placeCount, 'place')} added. Add more any time on the Places page.` };
    return {
      text: 'Paste a Google Maps link, or import your saved lists.',
      extra: state.placeCount === 1 && <OneOfTwo />,
      buttons: (
        <>
          <Button variant="cream" onClick={a.addPlace}>
            Add a place
          </Button>
          <Button variant="glass" onClick={a.importPlaces}>
            Import
          </Button>
        </>
      ),
    };
  },
  pick: (step, state, a) => ({
    text: step.status === 'done' ? 'Your first session is going.' : "Tap whichever of two places you'd rather go to. Then share the link so friends can pick too.",
    buttons:
      step.status === 'done' ? null : state.placeCount >= 2 ? (
        <Button variant="cream" onClick={a.startPicking}>
          Start picking <ChevronRight size={18} aria-hidden="true" />
        </Button>
      ) : (
        <span className="rounded-full bg-peach/20 px-[18px] py-[11px] font-bold text-peach/85">Add 2 places first</span>
      ),
  }),
};

const AddHomeButton = ({ onClick }: { onClick: () => void }) => (
  <Button variant="cream" onClick={onClick}>
    Add home
  </Button>
);

const OneOfTwo = () => (
  <span className="flex items-center gap-1.5 text-xs font-bold">
    <i className="h-1.5 w-[26px] rounded-full bg-peach" />
    <i className="h-1.5 w-[26px] rounded-full bg-peach/30" />
    1 of 2 added
  </span>
);

/** Every step passed: all the drawings in a row, and the way out. */
function AllSet({ steps, state, actions }: { steps: GuideStep[]; state: GuideState; actions: Actions }) {
  const homeless = state.home === null;
  return (
    <Pane
      label="All done"
      art={
        <span className="flex items-center gap-1">
          {steps.map((s) => {
            const { Art } = STEP_INFO[s.id];
            return <Art key={s.id} className="size-[46px] desk:size-[60px]" />;
          })}
        </span>
      }
      title="You're all set!"
      text={`Your first session is going. Share its link from the session page so friends can pick too.${homeless ? ' You skipped your home: add it to see travel times.' : ''}`}
      buttons={
        homeless ? (
          <>
            <AddHomeButton onClick={actions.addHome} />
            <TextButton onClick={actions.closeGuide}>Close the guide</TextButton>
          </>
        ) : (
          <Button variant="cream" onClick={actions.closeGuide}>
            Close the guide
          </Button>
        )
      }
    />
  );
}

/** Round arrows either side; on phones, a dot per step between them. */
function StepNav({ steps, viewed, onView, hidden }: { steps: GuideStep[]; viewed: number; onView: (i: number) => void; hidden: boolean }) {
  return (
    <div className={`relative flex items-center justify-between px-3.5 pt-3 pb-3.5 desk:col-start-1 desk:row-start-2 desk:px-6 desk:pb-5 ${hidden ? 'invisible' : ''}`}>
      <ArrowButton label="Previous step" disabled={viewed <= 0} onClick={() => onView(viewed - 1)}>
        <ChevronLeft size={20} aria-hidden="true" />
      </ArrowButton>
      <div role="group" aria-label="Steps" className="flex items-center desk:hidden">
        {steps.map((s, i) => (
          <button key={s.id} aria-label={stopLabel(s)} aria-current={i === viewed ? 'step' : undefined} onClick={() => onView(i)} className="group p-[5px]">
            <span className="block h-2 w-2 rounded-full bg-peach/40 transition-[width] group-aria-[current=step]:w-[22px] group-aria-[current=step]:bg-peach" />
          </button>
        ))}
      </div>
      <ArrowButton label="Next step" disabled={viewed >= steps.length - 1} onClick={() => onView(viewed + 1)}>
        <ChevronRight size={20} aria-hidden="true" />
      </ArrowButton>
    </div>
  );
}

const ArrowButton = ({ label, disabled, onClick, children }: { label: string; disabled: boolean; onClick: () => void; children: ReactNode }) => (
  <button aria-label={label} title={label} disabled={disabled} onClick={onClick} className="grid size-9 place-items-center rounded-full bg-peach/20 hover:bg-peach/30 disabled:opacity-30 desk:size-10">
    {children}
  </button>
);

/** The peach panel: the route across the top on phones, down the side on desktops. `viewed` is -1 when no step is showing. */
function RoutePanel({ steps, viewed, onView }: { steps: GuideStep[]; viewed: number; onView: (i: number) => void }) {
  return (
    <section
      aria-label="Your route to dinner"
      className="relative m-1.5 flex flex-col gap-2 rounded-[22px] bg-peach p-3 pb-2 text-ink desk:col-start-2 desk:row-span-2 desk:row-start-1 desk:gap-[18px] desk:rounded-[20px] desk:p-6"
    >
      <div className="flex items-baseline justify-between gap-2 px-0.5 desk:flex-col desk:gap-0 desk:px-0">
        <h2 className="font-display text-[17px]/tight">Your route to dinner</h2>
        <span className="text-xs font-extrabold text-muted">{routeCount(steps)}</span>
      </div>
      <AcrossRoute steps={steps} viewed={viewed} onView={onView} />
      <DownRoute steps={steps} viewed={viewed} onView={onView} />
    </section>
  );
}

/** The track from one stop to the next: filled once the first is passed (dashed mustard if it was skipped), dashed track otherwise. */
function trackStyle(from: GuideStep, to: GuideStep) {
  if (!isPassed(from) || to.status === 'upcoming') return 'route-dashes';
  return from.status === 'skipped' ? 'route-dashes [--dash-color:var(--color-mustard)]' : 'bg-leaf';
}

function StopDot({ step, className }: { step: GuideStep; className: string }) {
  const look = {
    done: 'bg-leaf text-white',
    current: 'bg-white ring-3 ring-tomato ring-inset',
    skipped: 'bg-peach text-skip ring-[2.5px] ring-skip ring-inset',
    upcoming: 'bg-white ring-[2.5px] ring-track ring-inset',
  }[step.status];
  return (
    <span className={`relative z-[1] grid flex-none place-items-center rounded-full ${look} ${className}`}>
      {step.status === 'done' && <Check className="size-[55%]" strokeWidth={3} aria-hidden="true" />}
      {step.status === 'skipped' && <SkipArrow className="size-[45%]" />}
      {step.status === 'current' && <TramIcon className="size-[60%]" />}
    </span>
  );
}

function AcrossRoute({ steps, viewed, onView }: { steps: GuideStep[]; viewed: number; onView: (i: number) => void }) {
  return (
    <div className="flex items-start desk:hidden">
      {steps.map((s, i) => (
        <Fragment key={s.id}>
          {i > 0 && <span aria-hidden="true" className={`-mx-0.5 mt-[13px] h-1 flex-1 rounded ${trackStyle(steps[i - 1], s)}`} />}
          <button aria-label={stopLabel(s)} aria-current={i === viewed ? 'step' : undefined} onClick={() => onView(i)} className="group -mx-3.5 flex w-16 flex-none flex-col items-center gap-[5px] first:ml-0 last:mr-0">
            <StopDot step={s} className="size-[30px]" />
            <span className="relative pb-1.5 text-center text-[11px]/tight font-bold text-muted group-aria-[current=step]:font-extrabold group-aria-[current=step]:text-ink">
              {STEP_INFO[s.id].short}
              {i === viewed && <span aria-hidden="true" className="absolute bottom-0 left-1/2 h-[3px] w-4 -translate-x-1/2 rounded-full bg-tomato" />}
              {s.status === 'skipped' && (
                <span className="mt-[3px] block">
                  <Stamp className="text-skip">Skipped</Stamp>
                </span>
              )}
            </span>
          </button>
        </Fragment>
      ))}
    </div>
  );
}

function DownRoute({ steps, viewed, onView }: { steps: GuideStep[]; viewed: number; onView: (i: number) => void }) {
  const note = (s: GuideStep) =>
    ({
      done: <small className="block text-xs text-muted">Done</small>,
      skipped: (
        <small className="mt-0.5 flex items-center gap-1.5 text-xs text-muted">
          <Stamp className="text-skip">Skipped</Stamp> add any time
        </small>
      ),
      current: <small className="block text-xs font-bold text-tomato">You're here</small>,
      upcoming: <small className="block text-xs text-muted">Coming up</small>,
    })[s.status];
  return (
    <div className="hidden flex-col desk:flex">
      {steps.map((s, i) => (
        <Fragment key={s.id}>
          {i > 0 && <span aria-hidden="true" className={`ml-[17px] h-5 w-1 rounded [--dash-direction:180deg] ${trackStyle(steps[i - 1], s)}`} />}
          <div className="relative">
            {i === viewed && <span aria-hidden="true" className="absolute top-1/2 -left-6 -mt-[9px] border-y-[9px] border-r-[10px] border-y-transparent border-r-tomato" />}
            <button aria-label={stopLabel(s)} aria-current={i === viewed ? 'step' : undefined} onClick={() => onView(i)} className="group flex items-center gap-3 text-left">
              <StopDot step={s} className="size-[38px]" />
              <span>
                <b className={`block text-[14.5px] group-aria-[current=step]:text-[15.5px] group-aria-[current=step]:font-extrabold ${s.status === 'upcoming' ? 'text-muted' : ''}`}>{STEP_INFO[s.id].title}</b>
                {note(s)}
              </span>
            </button>
          </div>
        </Fragment>
      ))}
    </div>
  );
}
