import { DriverFrame } from "@/components/driver/driver-frame";
import { Card } from "@/components/ui/card";

/** Driver pages while they load: the greeting and the card, in soft shimmering blocks. */
export default function DriverLoading() {
  return (
    <DriverFrame
      header={
        <div className="flex flex-col gap-2">
          <span className="h-4 w-28 animate-pulse rounded-md bg-white/10" />
          <span className="h-8 w-48 animate-pulse rounded-xl bg-white/15" />
        </div>
      }
      hideFooter
    >
      <Card className="flex flex-col items-center gap-4 border-0 p-6 shadow-lift" aria-busy="true">
        <span className="skeleton size-28 rounded-3xl" />
        <span className="skeleton h-6 w-40 rounded-lg" />
        <span className="skeleton h-4 w-56 rounded-md" />
        <span className="skeleton h-14 w-full rounded-2xl" />
      </Card>
    </DriverFrame>
  );
}
