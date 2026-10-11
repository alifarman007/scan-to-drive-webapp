import { PassengerFrame } from "@/components/passenger/passenger-frame";

/** Just scanned the code (often on mobile data): the page's shape until the trip arrives. */
export default function PassengerLoading() {
  return (
    <PassengerFrame>
      <div className="flex flex-col gap-4" aria-busy="true">
        <span className="skeleton h-3 w-32 rounded-md" />
        <span className="skeleton h-8 w-4/5 rounded-xl" />
        <span className="skeleton h-6 w-36 rounded-full" />
        <div className="flex flex-col gap-4 rounded-panel bg-navy p-5">
          <span className="h-7 w-28 animate-pulse rounded-lg bg-white/15" />
          <div className="grid grid-cols-2 gap-4">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="flex flex-col gap-1.5">
                <span className="h-3 w-12 animate-pulse rounded bg-white/10" />
                <span className="h-4 w-24 animate-pulse rounded bg-white/15" />
              </div>
            ))}
          </div>
        </div>
        <span className="skeleton h-12 w-full rounded-control" />
        <span className="skeleton h-14 w-full rounded-2xl" />
      </div>
    </PassengerFrame>
  );
}
