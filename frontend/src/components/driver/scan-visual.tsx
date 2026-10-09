import { QrCodeIcon } from "@phosphor-icons/react/ssr";

/** A QR code in a viewfinder with a scan line gliding over it ("point your camera at the sticker"). */
export function ScanVisual() {
  return (
    <div aria-hidden="true" className="relative mx-auto size-32 [--scan-travel:6.5rem]">
      {/* corner brackets */}
      <span className="absolute top-0 left-0 size-7 rounded-tl-2xl border-t-4 border-l-4 border-signal" />
      <span className="absolute top-0 right-0 size-7 rounded-tr-2xl border-t-4 border-r-4 border-signal" />
      <span className="absolute bottom-0 left-0 size-7 rounded-bl-2xl border-b-4 border-l-4 border-signal" />
      <span className="absolute right-0 bottom-0 size-7 rounded-br-2xl border-r-4 border-b-4 border-signal" />
      <span className="absolute inset-4 flex items-center justify-center rounded-xl bg-soft text-title">
        <QrCodeIcon size={64} weight="duotone" />
      </span>
      <span className="absolute inset-x-3 top-3 h-0.5 rounded-full bg-signal shadow-[0_0_12px_2px_rgb(21_93_252/0.55)] motion-safe:animate-scan" />
    </div>
  );
}
