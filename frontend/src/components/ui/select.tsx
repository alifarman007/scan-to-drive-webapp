import { CaretDownIcon } from "@phosphor-icons/react/ssr";

import { cn } from "@/lib/utils";

/** The phone's or browser's own drop-down (best on phones, works with the keyboard), dressed in our style.
 *  `active` gives it the accent border, so a filter that is in use stands out. */
export function Select({
  className,
  active,
  children,
  ...props
}: React.ComponentProps<"select"> & { active?: boolean }) {
  return (
    <span className={cn("relative inline-flex min-w-0", className)}>
      <select
        className={cn(
          "h-10 w-full min-w-0 cursor-pointer appearance-none truncate rounded-[0.7rem] border-[1.5px] bg-card pr-9 pl-3 text-sm font-semibold text-text",
          "transition-[border-color,box-shadow] outline-none focus-visible:border-ring focus-visible:shadow-[0_0_0_4px_var(--ring-soft)]",
          active ? "border-accent text-title" : "border-border-strong",
        )}
        {...props}
      >
        {children}
      </select>
      <CaretDownIcon size={14} weight="bold" className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-muted" />
    </span>
  );
}
