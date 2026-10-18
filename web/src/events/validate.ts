// Client checks for the create form (W-E5), the same limits as the API (events.md E2,
// event-description.md DS6). Each returns the error text or null. The server still decides.
import { localToIso } from "./format";

export const ERRORS = {
  title: "Enter a title (1 to 200 characters).",
  description: "Description is too long (2000 characters at most).",
  start: "Choose a start in the future.",
  duration: "Enter whole minutes from 1 to 1440.",
  capacity: "Enter a whole number from 1 to 100000.",
  // capacity-web.md W-CP3, W-CP8: the text holds the registered count.
  capacityBelow: (registered: number) =>
    `Capacity cannot be below ${registered} registered ${registered === 1 ? "person" : "people"}.`,
};

// Code points, as the API counts them.
function length(text: string): number {
  return [...text].length;
}

function wholeNumberIn(value: string, min: number, max: number): boolean {
  const text = value.trim();
  if (!/^[0-9]+$/.test(text)) return false;
  const n = Number(text);
  return n >= min && n <= max;
}

export function validateTitle(value: string): string | null {
  const n = length(value.trim());
  return n >= 1 && n <= 200 ? null : ERRORS.title;
}

export function validateDescription(value: string): string | null {
  return length(value.trim()) <= 2000 ? null : ERRORS.description;
}

// In the future by the browser clock: exactly now is not in the future.
export function validateStart(value: string, now: Date): string | null {
  const iso = localToIso(value);
  if (iso === null || new Date(iso).getTime() <= now.getTime()) return ERRORS.start;
  return null;
}

export function validateDuration(value: string): string | null {
  return wholeNumberIn(value, 1, 1440) ? null : ERRORS.duration;
}

export function validateCapacity(value: string): string | null {
  return wholeNumberIn(value, 1, 100000) ? null : ERRORS.capacity;
}

// W-CP3: not below the people already registered. A value that is not a whole number is
// left to validateCapacity, which runs first.
export function validateCapacityChange(value: string, registered: number): string | null {
  const text = value.trim();
  if (!/^[0-9]+$/.test(text)) return null;
  return Number(text) < registered ? ERRORS.capacityBelow(registered) : null;
}
