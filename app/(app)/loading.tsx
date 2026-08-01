/**
 * The streaming fallback for every screen in the signed-in app.
 *
 * Every page under `(app)` is `force-dynamic` and reads Supabase before it can
 * render anything, so without a `loading.tsx` a navigation simply does nothing
 * visible until the data arrives — on a technician's phone on mobile data, for
 * several seconds. Next.js renders this instantly inside the shell, so the
 * sidebar and tab bar stay live and the content area shows that work is
 * happening.
 *
 * It is deliberately not a spinner: a skeleton in roughly the shape of a list
 * avoids the layout jump when the real rows arrive.
 */
export default function AppSectionLoading() {
  return (
    <div className="loading-skeleton" role="status" aria-live="polite">
      <span className="sr-only">Loading · טוען</span>
      {[0, 1, 2, 3, 4].map((row) => (
        <div key={row} className="loading-skeleton-row" aria-hidden="true" />
      ))}
    </div>
  );
}
