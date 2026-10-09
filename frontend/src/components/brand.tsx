import { cn } from "@/lib/utils";

/**
 * App mark: a rounded square with a steering-wheel-and-QR glyph, plus the wordmark.
 * The Epic Group logo file goes next to it once we have it (public/epic-logo.svg).
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn("inline-flex size-9 items-center justify-center rounded-xl bg-epic text-white shadow-sm", className)}
    >
      <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <circle cx="12" cy="12" r="8.5" />
        <circle cx="12" cy="12" r="2.2" />
        <path d="M4 11.5c2.5-1 5.2-1.4 8-1.4s5.5.4 8 1.4M12 14.2V20.5" />
      </svg>
    </span>
  );
}

export function Wordmark({
  name,
  company,
  tone = "onDark",
  className,
}: {
  name: string;
  company: string;
  tone?: "onDark" | "onLight";
  className?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <BrandMark />
      <span className="flex flex-col leading-tight">
        <span className={cn("font-display text-base font-semibold", tone === "onDark" ? "text-white" : "text-title")}>
          {name}
        </span>
        <span
          className={cn(
            "text-[0.68rem] font-semibold tracking-[0.16em] uppercase",
            tone === "onDark" ? "text-sky" : "text-muted",
          )}
        >
          {company}
        </span>
      </span>
    </span>
  );
}
