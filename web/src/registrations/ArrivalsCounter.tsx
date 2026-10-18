// The arrivals counter of the scan screen and the registrations page (checkin-web.md
// W-C1-W-C3, W-C9, W-C10, W-C12-W-C14, W-C18, W-C19). Numbers only, exactly as the
// arrivals route sent them. No live region: the only change while the organizer looks
// is after a check-in, which the scan screen already announces (W-R34). Rendered only
// after the screen's guard, so it has no me check of its own.
import { isAuthError, statusOf } from "../events/queries";
import { useEventArrivals } from "./arrivals";

export function ArrivalsCounter({ eventId }: { eventId: string }) {
  const arrivals = useEventArrivals(eventId);

  // 401/403: me is read again and the guard decides; no text of our own (W-C9).
  if (arrivals.isError && isAuthError(arrivals.error)) return null;

  // One block in every state, so a refetch never re-mounts it (W-C13).
  return (
    <div className="arrivals">
      <Body arrivals={arrivals} />
    </div>
  );
}

function Body({ arrivals }: { arrivals: ReturnType<typeof useEventArrivals> }) {
  if (arrivals.isError && statusOf(arrivals.error) === 404) {
    return <p className="arrivals-missing">Event not found</p>;
  }

  const { data } = arrivals;
  if (data === undefined) {
    // First load of this account and event (W-C12): never a number of another one.
    if (arrivals.isError && !arrivals.isFetching) {
      return (
        <>
          <p className="arrivals-error">Could not load arrivals</p>
          <button
            type="button"
            className="button-secondary arrivals-retry"
            onClick={() => void arrivals.refetch()}
          >
            Retry
          </button>
        </>
      );
    }
    return <p className="arrivals-loading">Loading arrivals...</p>;
  }

  return (
    <>
      <p className="arrivals-count">
        <span className="arrivals-label">Arrived:</span>{" "}
        <strong>{`${data.arrived} / ${data.registered} registered`}</strong>
      </p>
      <p className="arrivals-capacity">{`Capacity: ${data.capacity}`}</p>
      {data.registered > 0 && data.arrived === data.registered && (
        <p className="arrivals-all">Everyone has arrived.</p>
      )}
      {/* A failed refetch keeps the last numbers (W-C10, W-C13). */}
      {arrivals.isError && <p className="arrivals-note">Could not refresh</p>}
    </>
  );
}
