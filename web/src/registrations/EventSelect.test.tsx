// design-alignment.md DA54: the own chevron (DA51-DA53) is CSS only, so the select keeps
// its native role, label and change handling, and the arrow adds no markup. The CSS values
// are checked by hand (jsdom has no layout).
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { OrganizerEvent } from "../events/api";
import { organizerEvent } from "../events/test-helpers";
import { EventSelect } from "./EventSelect";

function sample(id: string, title: string): OrganizerEvent {
  return { ...organizerEvent({ id, title }), description: "" };
}

const FIRST = sample("11111111-1111-4111-8111-111111111111", "Spring meetup");
const SECOND = sample("22222222-2222-4222-8222-222222222222", "Autumn talk");

describe("design-alignment.md DA54: the event select structure", () => {
  it("a native combobox labelled Event inside .field.event-select; onChange gets the id; no arrow markup", () => {
    const onChange = vi.fn();
    render(<EventSelect events={[FIRST, SECOND]} value={FIRST.id} onChange={onChange} />);

    const select = screen.getByRole("combobox", { name: "Event" });
    expect(select.tagName).toBe("SELECT");
    expect(screen.getByLabelText("Event")).toBe(select);
    const field = select.closest(".field.event-select");
    expect(field).not.toBeNull();

    fireEvent.change(select, { target: { value: SECOND.id } });
    expect(onChange).toHaveBeenCalledWith(SECOND.id);

    const inField = within(field as HTMLElement);
    expect(inField.queryAllByRole("img")).toHaveLength(0);
    expect((field as HTMLElement).querySelector("svg")).toBeNull();
  });
});
