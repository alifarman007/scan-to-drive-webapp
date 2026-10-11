import { QrCodeIcon } from "@phosphor-icons/react/ssr";

import { cn } from "@/lib/utils";

/** A QR code in a viewfinder with a scan line gliding over it ("point your camera at the sticker"). */
export function ScanVisual({ small = false }: { small?: boolean }) {
  return (
    <div aria-hidden="true" className={cn("relative mx-auto", small ? "size-24 [--scan-travel:4.5rem]" : "size-32 [--scan-travel:6.5rem]")}>
      {/* corner brackets */}
      <span className="absolute top-0 left-0 size-7 rounded-tl-2xl border-t-4 border-l-4 border-signal" />
      <span className="absolute top-0 right-0 size-7 rounded-tr-2xl border-t-4 border-r-4 border-signal" />
      <span className="absolute bottom-0 left-0 size-7 rounded-bl-2xl border-b-4 border-l-4 border-signal" />
      <span className="absolute right-0 bottom-0 size-7 rounded-br-2xl border-r-4 border-b-4 border-signal" />
      <span className={cn("absolute flex items-center justify-center rounded-xl bg-soft text-title", small ? "inset-3" : "inset-4")}>
        <QrCodeIcon size={small ? 46 : 64} weight="duotone" />
      </span>
      <span className="absolute inset-x-3 top-3 h-0.5 rounded-full bg-signal shadow-[0_0_12px_2px_rgb(21_93_252/0.55)] motion-safe:animate-scan" />
    </div>
  );
}
