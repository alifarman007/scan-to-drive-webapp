/** A soft road curve with dashes drifting along it, for navy panels (welcome page, admin sign-in). */
export function Road({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 600 800"
      preserveAspectRatio="xMidYMid slice"
      className={className ?? "pointer-events-none absolute inset-0 h-full w-full opacity-60"}
    >
      <defs>
        <linearGradient id="road-fade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#284dae" stopOpacity="0" />
          <stop offset="0.5" stopColor="#284dae" stopOpacity="0.55" />
          <stop offset="1" stopColor="#284dae" stopOpacity="0.15" />
        </linearGradient>
      </defs>
      <path d="M640 -40 C 420 160, 560 360, 330 520 S 120 760, -60 860" fill="none" stroke="url(#road-fade)" strokeWidth="120" strokeLinecap="round" />
      <path
        d="M640 -40 C 420 160, 560 360, 330 520 S 120 760, -60 860"
        fill="none"
        stroke="#9fb4f5"
        strokeOpacity="0.55"
        strokeWidth="3"
        strokeDasharray="18 22"
        className="road-dash"
      />
    </svg>
  );
}
