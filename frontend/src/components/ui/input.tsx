import { cn } from "@/lib/utils";

type InputProps = React.ComponentProps<"input"> & {
  /** Numbers, IDs and phone numbers: monospaced so digits are easy to check. */
  mono?: boolean;
  invalid?: boolean;
};

export function Input({ className, mono, invalid, ...props }: InputProps) {
  return (
    <input
      aria-invalid={invalid || undefined}
      className={cn(
        "h-[3.25rem] w-full rounded-control border-[1.5px] border-border-strong bg-card px-4 text-base text-text placeholder:text-muted/70",
        "transition-[border-color,box-shadow] duration-150 outline-none",
        "focus:border-ring focus:shadow-[0_0_0_4px_var(--ring-soft)]",
        "aria-invalid:border-bad-dot aria-invalid:shadow-[0_0_0_4px_var(--bad-bg)]",
        mono && "font-mono text-lg tracking-wide",
        className,
      )}
      {...props}
    />
  );
}

export function Label({ className, ...props }: React.ComponentProps<"label">) {
  return <label className={cn("text-sm font-semibold text-text", className)} {...props} />;
}

/** Label + control + hint or error, stacked. */
export function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
  className,
}: {
  label: React.ReactNode;
  htmlFor: string;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {error ? (
        <p role="alert" className="text-sm font-medium text-bad-fg">
          {error}
        </p>
      ) : hint ? (
        <p className="text-sm text-muted">{hint}</p>
      ) : null}
    </div>
  );
}
