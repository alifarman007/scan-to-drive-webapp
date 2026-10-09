"use client";

import { MotionConfig } from "motion/react";
import { ThemeProvider } from "next-themes";

/** Light/dark (follows the computer, with a switch) and one motion setting for the whole app:
 *  animations are skipped for people who turned on "reduce motion" on their phone or computer. */
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <MotionConfig reducedMotion="user" transition={{ type: "spring", stiffness: 380, damping: 32 }}>
        {children}
      </MotionConfig>
    </ThemeProvider>
  );
}
