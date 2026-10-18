// The event selector of the organizer screens (registration-web.md W-R20, W-R29).
// The choice lives in the `event` query parameter, so links keep it.
import { useId } from "react";
import { useSearchParams } from "react-router";
import type { OrganizerEvent } from "../events/api";

// The `event` parameter when it is one of the organizer's events, else the first event;
// null when there are no events.
export function useChosenEvent(
  events: OrganizerEvent[] | undefined,
): [OrganizerEvent | null, (id: string) => void] {
  const [params, setParams] = useSearchParams();
  const wanted = params.get("event");
  const list = events ?? [];
  const chosen = list.find((event) => event.id === wanted) ?? list[0] ?? null;
  const choose = (id: string) => setParams({ event: id }, { replace: true });
  return [chosen, choose];
}

type Props = {
  events: OrganizerEvent[];
  value: string;
  onChange: (id: string) => void;
};

export function EventSelect({ events, value, onChange }: Props) {
  const id = useId();
  return (
    <div className="field event-select">
      <label htmlFor={id}>Event</label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        {events.map((event) => (
          <option key={event.id} value={event.id}>
            {event.title}
          </option>
        ))}
      </select>
    </div>
  );
}
