import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Join class names; later Tailwind classes win over earlier ones (px-4 then px-6 → px-6). */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
