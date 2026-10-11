"use client";

import { ErrorView } from "@/components/states/error-view";

/** Inside the admin frame, so the menu stays and the office can go elsewhere. */
export default function AdminError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorView reset={reset} digest={error.digest} compact />;
}
