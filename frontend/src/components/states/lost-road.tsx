"use client";

import { motion } from "motion/react";

/**
 * A road that winds in from the bottom and stops at a barrier; a little car rolls up, stops, and its
 * hazard lights blink. For "page not found" and "something went wrong".
 */
export function LostRoad({ tone = "lost" }: { tone?: "lost" | "broken" }) {
  const road = "M40 260 C 120 250, 150 190, 230 180 S 330 120, 360 70";
  return (
    <svg viewBox="0 0 420 280" className="h-auto w-full max-w-[22rem]" aria-hidden="true">
      <defs>
        <linearGradient id="lr-road" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="var(--soft)" />
          <stop offset="1" stopColor="var(--bay)" />
        </linearGradient>
      </defs>
      {/* the road */}
      <path d={road} fill="none" stroke="url(#lr-road)" strokeWidth="46" strokeLinecap="round" />
      <path d={road} fill="none" stroke="var(--border-strong)" strokeWidth="3" strokeDasharray="14 16" className="road-dash" />
      {/* barrier at the end */}
      <motion.g initial={{ y: -16, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.3, type: "spring", stiffness: 300, damping: 16 }}>
        <rect x="318" y="44" width="84" height="20" rx="5" fill={tone === "lost" ? "var(--wait-dot)" : "var(--bad-dot)"} />
        {[0, 1, 2, 3].map((i) => (
          <rect key={i} x={326 + i * 20} y="44" width="9" height="20" fill="#fff" transform={`skewX(-20)`} style={{ transformBox: "fill-box" }} />
        ))}
        <rect x="326" y="64" width="6" height="26" rx="2" fill="var(--muted)" />
        <rect x="388" y="64" width="6" height="26" rx="2" fill="var(--muted)" />
      </motion.g>
      {/* the car rolls along the road and stops before the barrier */}
      <motion.g
        initial={{ offsetDistance: "0%" }}
        animate={{ offsetDistance: "74%" }}
        transition={{ duration: 2.2, ease: [0.22, 1, 0.36, 1], delay: 0.2 }}
        style={{ offsetPath: `path("${road}")`, offsetRotate: "auto" } as React.CSSProperties}
      >
        <rect x="-22" y="-12" width="44" height="24" rx="8" fill="var(--accent)" />
        <rect x="-4" y="-9" width="14" height="18" rx="3" fill="#cfe0ff" />
        <motion.circle
          cx="20" cy="-8" r="3.2" fill="#ffc145"
          animate={{ opacity: [0, 1, 0] }} transition={{ delay: 2.4, duration: 0.9, repeat: Infinity }}
        />
        <motion.circle
          cx="20" cy="8" r="3.2" fill="#ffc145"
          animate={{ opacity: [0, 1, 0] }} transition={{ delay: 2.4, duration: 0.9, repeat: Infinity }}
        />
      </motion.g>
    </svg>
  );
}
