import { cn } from "@/lib/utils";

/** A dot with a soft ring that keeps spreading out: "this is happening right now". */
export function LiveDot({ className }: { className?: string }) {
  return (
    <span className="relative inline-flex size-2">
      <span className={cn("absolute inset-0 rounded-full opacity-60 motion-safe:animate-ping", className)} />
      <span className={cn("relative inline-flex size-2 rounded-full", className)} />
    </span>
  );
}
