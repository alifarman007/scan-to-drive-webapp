import { DriverFrame } from "@/components/driver/driver-frame";
import { Card } from "@/components/ui/card";

/** Scanned a sticker: the car's page shape while it loads (checking the car and the sign-in). */
export default function CarLoading() {
  return (
    <DriverFrame
      header={
        <div className="flex flex-col gap-2">
          <span className="h-8 w-40 animate-pulse rounded-xl bg-white/15" />
          <span className="h-4 w-56 animate-pulse rounded-lg bg-white/10" />
        </div>
      }
      hideFooter
    >
      <Card className="flex flex-col gap-4 border-0 p-5 shadow-lift" aria-busy="true">
        <span className="skeleton h-14 w-52 rounded-xl" />
        <span className="skeleton h-12 w-full rounded-control" />
        <span className="skeleton h-12 w-full rounded-control" />
        <span className="skeleton h-32 w-full rounded-2xl" />
        <span className="skeleton h-14 w-full rounded-2xl" />
      </Card>
    </DriverFrame>
  );
}
