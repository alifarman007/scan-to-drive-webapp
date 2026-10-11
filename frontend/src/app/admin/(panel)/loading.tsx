/** While an admin page is being fetched: the page's shape in soft shimmering blocks (the menu stays). */
export default function AdminLoading() {
  return (
    <div className="flex flex-col gap-section" aria-busy="true" aria-live="polite">
      <div className="flex flex-col gap-2">
        <span className="skeleton h-9 w-56 rounded-xl" />
        <span className="skeleton h-4 w-72 max-w-full rounded-lg" />
      </div>
      <div className="flex gap-3">
        <span className="skeleton h-11 w-full max-w-80 rounded-control" />
        <span className="skeleton hidden h-11 w-96 rounded-control md:block" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="flex flex-col gap-4 rounded-card border border-border bg-card p-4" style={{ opacity: 1 - i * 0.12 }}>
            <div className="flex items-center gap-3">
              <span className="skeleton size-12 rounded-full" />
              <div className="flex flex-1 flex-col gap-2">
                <span className="skeleton h-4 w-2/3 rounded-md" />
                <span className="skeleton h-3 w-1/3 rounded-md" />
              </div>
            </div>
            <span className="skeleton h-8 w-full rounded-lg" />
          </div>
        ))}
      </div>
    </div>
  );
}
