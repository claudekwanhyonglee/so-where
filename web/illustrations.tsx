/** Small flat drawings in the app's palette. All decorative: hidden from screen readers. */

/** Home, a tram on its way and a "25 min" tag: how far dinner is from your door (the sign-up home step). */
export function HomeTramScene({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 220 120" aria-hidden="true" className={className}>
      <rect x="0" y="92" width="220" height="6" rx="3" className="fill-edge" />
      <path d="M18 92V58l26-20 26 20v34z" className="fill-tomato" />
      <rect x="36" y="70" width="16" height="22" rx="2" className="fill-ink" />
      <path d="M70 60 C 110 20, 140 20, 176 44" fill="none" strokeWidth="3" strokeDasharray="6 6" strokeLinecap="round" className="stroke-tomato" />
      <rect x="96" y="58" width="60" height="30" rx="8" className="fill-tomato" />
      {[102, 120].map((x) => (
        <rect key={x} x={x} y="64" width="14" height="10" rx="2" className="fill-peach" />
      ))}
      <rect x="138" y="64" width="12" height="10" rx="2" className="fill-peach" />
      <circle cx="108" cy="92" r="4" className="fill-ink" />
      <circle cx="144" cy="92" r="4" className="fill-ink" />
      <path d="M126 58v-10M116 48h20" strokeWidth="2.5" strokeLinecap="round" className="stroke-ink" />
      <path d="M186 20c0 13-12 24-12 24s-12-11-12-24a12 12 0 0 1 24 0z" className="fill-ink" />
      <circle cx="174" cy="20" r="4.5" className="fill-mustard" />
      <rect x="160" y="52" width="44" height="22" rx="11" className="fill-white stroke-edge" />
      <text x="182" y="67" textAnchor="middle" fontSize="11" className="fill-ink font-sans font-extrabold">
        25 min
      </text>
    </svg>
  );
}

/** The guide's home step: the house, a pin and a "25m" tag. */
export function GuideHomeArt({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" className={className}>
      <rect x="0" y="50" width="64" height="4" rx="2" className="fill-ink/15" />
      <path d="M8 50V30l16-12 16 12v20z" className="fill-tomato" />
      <rect x="19" y="36" width="10" height="14" rx="2" className="fill-ink" />
      <path d="M52 16c0 8-7 14-7 14s-7-6-7-14a7 7 0 0 1 14 0z" className="fill-ink" />
      <circle cx="45" cy="16" r="3" className="fill-peach" />
      <rect x="38" y="38" width="22" height="12" rx="6" className="fill-white stroke-edge" />
      <text x="49" y="47" textAnchor="middle" fontSize="7" className="fill-ink font-sans font-extrabold">
        25m
      </text>
    </svg>
  );
}

/** The guide's places step: two place cards, mustard behind, white in front with a tomato pin. */
export function GuidePlacesArt({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" className={className}>
      <rect x="8" y="18" width="30" height="36" rx="8" transform="rotate(-8 23 36)" className="fill-mustard" />
      <rect x="24" y="12" width="30" height="36" rx="8" strokeWidth="2" className="fill-white stroke-ink" />
      <path d="M39 22c0 6-5 10-5 10s-5-4-5-10a5 5 0 0 1 10 0z" className="fill-tomato" />
      <rect x="29" y="36" width="20" height="3" rx="1.5" className="fill-ink/30" />
      <rect x="29" y="41" width="13" height="3" rx="1.5" className="fill-ink/30" />
    </svg>
  );
}

/** The guide's picking step: a mustard and a leaf card with the ink "OR" badge, as on the picking screen. */
export function GuidePickArt({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" className={className}>
      <rect x="4" y="14" width="26" height="36" rx="8" className="fill-mustard" />
      <rect x="34" y="14" width="26" height="36" rx="8" className="fill-leaf" />
      <circle cx="32" cy="32" r="9" strokeWidth="3" className="fill-ink stroke-peach" />
      <text x="32" y="35" textAnchor="middle" fontSize="8" className="fill-mustard font-sans font-extrabold">
        OR
      </text>
    </svg>
  );
}

/** A little tram that bobs (unless motion is reduced): where you are on the guide's route. */
export function TramIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={`motion-safe:animate-bob ${className}`}>
      <rect x="4" y="5" width="16" height="13" rx="3" strokeWidth="1.2" className="fill-tomato stroke-ink" />
      <rect x="6.5" y="7.5" width="4.5" height="4" rx="1" className="fill-peach" />
      <rect x="13" y="7.5" width="4.5" height="4" rx="1" className="fill-peach" />
      <path d="M12 5V2M9 2h6" strokeWidth="1.8" strokeLinecap="round" className="stroke-ink" />
      <circle cx="8" cy="20" r="1.8" className="fill-ink" />
      <circle cx="16" cy="20" r="1.8" className="fill-ink" />
    </svg>
  );
}

/** A curved arrow hopping over: a skipped stop. */
export function SkipArrow({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
      <path d="M4 17a8 8 0 0 1 14-6" />
      <path d="M19 5v6h-6" />
    </svg>
  );
}
