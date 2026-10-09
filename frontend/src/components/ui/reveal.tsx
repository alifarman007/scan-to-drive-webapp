"use client";

import { motion, type Variants } from "motion/react";

const EASE = [0.22, 1, 0.36, 1] as const;

/** Fades and rises into place. Use `delay` to line several up. */
export function Reveal({
  children,
  delay = 0,
  className,
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
}) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: EASE, delay }}
    >
      {children}
    </motion.div>
  );
}

const container: Variants = {
  hidden: {},
  shown: { transition: { staggerChildren: 0.055, delayChildren: 0.04 } },
};
const item: Variants = {
  hidden: { opacity: 0, y: 14, scale: 0.985 },
  shown: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.42, ease: EASE } },
};

/** Children wrapped in <StaggerItem> appear one after another (cards, list rows, car bays). */
export function Stagger({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <motion.div className={className} variants={container} initial="hidden" animate="shown">
      {children}
    </motion.div>
  );
}

export function StaggerItem({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <motion.div className={className} variants={item}>
      {children}
    </motion.div>
  );
}
