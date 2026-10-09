import Image from "next/image";

import { cn } from "@/lib/utils";

/**
 * Epic Group logo + "Scan-to-Drive". The cream logo is for navy backgrounds, the navy one for light ones.
 * Files: public/brand/epic-logo-light.png and epic-logo-navy.png (a sharper SVG can replace them later).
 */
export function Wordmark({
  name,
  tone = "onDark",
  size = "md",
  className,
}: {
  name: string;
  tone?: "onDark" | "onLight";
  size?: "md" | "lg";
  className?: string;
}) {
  const h = size === "lg" ? 40 : 30;
  return (
    <span className={cn("inline-flex items-center gap-3", className)}>
      <Image
        src={tone === "onDark" ? "/brand/epic-logo-light.png" : "/brand/epic-logo-navy.png"}
        alt="Epic Group"
        width={Math.round((h * 286) / 124)}
        height={h}
        priority
        className="h-auto select-none"
        style={{ height: h, width: "auto" }}
      />
      <span aria-hidden="true" className={cn("h-7 w-px", tone === "onDark" ? "bg-white/25" : "bg-border-strong")} />
      <span
        className={cn(
          "font-display font-semibold leading-tight",
          size === "lg" ? "text-lg" : "text-[0.95rem]",
          tone === "onDark" ? "text-white" : "text-title",
        )}
      >
        {name}
      </span>
    </span>
  );
}
