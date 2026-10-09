import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";

import { cn } from "@/lib/utils";

// Buttons press down a little when tapped (a CSS transform, so it costs nothing).
const buttonVariants = cva(
  "inline-flex select-none items-center justify-center gap-2 whitespace-nowrap font-bold transition-[transform,background-color,box-shadow,color] duration-150 ease-out active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "bg-accent text-accent-text hover:bg-accent-hover shadow-[0_1px_0_rgb(255_255_255/0.12)_inset]",
        secondary: "border-[1.5px] border-border-strong bg-card text-title hover:bg-soft",
        ghost: "text-accent hover:bg-soft",
        danger: "bg-bad-bg text-bad-fg hover:brightness-95",
        inverse: "bg-navy-2 text-white hover:bg-[#33489a]",
        outlineInverse: "border-[1.5px] border-[#6e86c9] text-white hover:bg-white/10",
      },
      size: {
        sm: "h-9 rounded-[0.65rem] px-3 text-sm",
        md: "h-11 rounded-control px-5 text-[0.9375rem]",
        lg: "h-[3.25rem] rounded-control px-6 text-base",
        xl: "h-[3.625rem] w-full rounded-2xl px-6 text-[1.0625rem]",
        icon: "size-11 rounded-control",
      },
      lift: { true: "shadow-press", false: "" },
    },
    defaultVariants: { variant: "primary", size: "md", lift: false },
  },
);

export type ButtonProps = React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean };

export function Button({ className, variant, size, lift, asChild = false, type, ...props }: ButtonProps) {
  const Comp = asChild ? Slot.Root : "button";
  return (
    <Comp
      className={cn(buttonVariants({ variant, size, lift }), className)}
      {...(asChild ? {} : { type: type ?? "button" })}
      {...props}
    />
  );
}

export { buttonVariants };
