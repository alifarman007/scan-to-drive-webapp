import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Join class names; later Tailwind classes win over earlier ones (px-4 then px-6 → px-6). */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Titles that come before the name in Bangladesh ("Md. Rashed", "Mst. Rina"): not used for initials.
const NAME_TITLES = new Set(["md", "mohammad", "mohammed", "muhammad", "mohd", "mst", "most", "mosammat", "sk", "sheikh", "dr", "mr", "mrs", "ms"]);

/** Letters for an avatar: "Md. Dainul Haque" → "DH", "Md. Nayon" → "N", "Md. Sirajul Islam (Liton)" → "SI". */
export function personInitials(name: string) {
  const words = name
    .replace(/\(.*?\)/g, " ")
    .split(/[\s.]+/)
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter(Boolean);
  const named = words.filter((w) => !NAME_TITLES.has(w.toLowerCase()));
  const use = named.length ? named : words;
  if (!use.length) return "?";
  if (use.length === 1) return use[0][0].toUpperCase();
  return (use[0][0] + use[1][0]).toUpperCase();
}
