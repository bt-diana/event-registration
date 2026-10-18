// Dates and durations for the event screens (W-E19). No date library.
// The app passes no time zone, so the browser's zone is used; tests pass "UTC".

function parts(date: Date, options: Intl.DateTimeFormatOptions, timeZone?: string) {
  const list = new Intl.DateTimeFormat("en-GB", { ...options, timeZone }).formatToParts(date);
  return (type: Intl.DateTimeFormatPartTypes) => list.find((p) => p.type === type)?.value ?? "";
}

// "Sat, 1 Jan 2030, 10:00 CET": always with the zone name, so a viewer in another zone
// is not misled.
export function formatDateTime(iso: string, timeZone?: string): string {
  const get = parts(
    new Date(iso),
    {
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      timeZoneName: "short",
    },
    timeZone,
  );
  return `${get("weekday")}, ${get("day")} ${get("month")} ${get("year")}, ${get("hour")}:${get("minute")} ${get("timeZoneName")}`;
}

// "45 min", "1 h", "1 h 30 min".
export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

// The browser's zone name, for the start hint ("Your local time (CET)").
export function localZoneName(date: Date = new Date(), timeZone?: string): string {
  return parts(date, { timeZoneName: "short" }, timeZone)("timeZoneName");
}

// A datetime-local value ("2030-01-01T10:00", local time) as a UTC instant with Z,
// or null when it is not a valid date and time.
export function localToIso(value: string): string | null {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

// The local "YYYY-MM-DDTHH:mm" of a date, for the min hint of the datetime-local input.
export function toLocalInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}
