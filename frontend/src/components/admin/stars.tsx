import { StarIcon } from "@phosphor-icons/react/ssr";

import { cn } from "@/lib/utils";

/**
 * Five stars showing a rating (read only). A part star shows the fraction, so an average of 4.6 fills
 * four stars and most of the fifth.
 */
export function Stars({ value, size = 16, label, className }: { value: number; size?: number; label?: string; className?: string }) {
  return (
    <span role="img" aria-label={label ?? `${value} / 5`} className={cn("inline-flex items-center gap-px", className)}>
      {[0, 1, 2, 3, 4].map((i) => {
        const fill = Math.max(0, Math.min(1, value - i));
        return (
          <span key={i} className="relative inline-flex" style={{ width: size, height: size }}>
            <StarIcon size={size} weight="fill" className="text-border-strong" />
            {fill > 0 ? (
              <span className="absolute inset-y-0 left-0 overflow-hidden text-star" style={{ width: `${fill * 100}%` }}>
                <StarIcon size={size} weight="fill" />
              </span>
            ) : null}
          </span>
        );
      })}
    </span>
  );
}
