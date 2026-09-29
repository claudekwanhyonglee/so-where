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
