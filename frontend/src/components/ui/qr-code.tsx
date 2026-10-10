"use client";

import QRCode from "qrcode";
import { useMemo } from "react";

import { cn } from "@/lib/utils";

/**
 * QR code drawn as SVG in the app's colours: ink modules, rounded corner eyes with an Epic-blue centre.
 * Modules stay square (only slightly softened) so every phone camera reads it quickly.
 */
export function QrCode({ value, size = 220, label, className }: { value: string; size?: number; label?: string; className?: string }) {
  const { n, path } = useMemo(() => {
    const qr = QRCode.create(value, { errorCorrectionLevel: "M" });
    const count = qr.modules.size;
    const isEye = (r: number, c: number) =>
      (r < 7 && c < 7) || (r < 7 && c >= count - 7) || (r >= count - 7 && c < 7);
    let d = "";
    for (let r = 0; r < count; r++) {
      for (let c = 0; c < count; c++) {
        if (qr.modules.get(r, c) && !isEye(r, c)) d += `M${c + 0.06} ${r + 0.06}h0.88v0.88h-0.88z`;
      }
    }
    return { n: count, path: d };
  }, [value]);

  const eyes: [number, number][] = [
    [0, 0],
    [n - 7, 0],
    [0, n - 7],
  ];
  return (
    <svg
      viewBox={`-1 -1 ${n + 2} ${n + 2}`}
      width={size}
      height={size}
      role="img"
      aria-label={label}
      className={cn("block", className)}
      shapeRendering="geometricPrecision"
    >
      <rect x={-1} y={-1} width={n + 2} height={n + 2} fill="#ffffff" />
      <path d={path} fill="#0f1a3d" />
      {eyes.map(([x, y]) => (
        <g key={`${x}-${y}`}>
          <rect x={x + 0.5} y={y + 0.5} width={6} height={6} rx={1.6} fill="none" stroke="#0f1a3d" strokeWidth={1} />
          <rect x={x + 2} y={y + 2} width={3} height={3} rx={0.8} fill="#284dae" />
        </g>
      ))}
    </svg>
  );
}
