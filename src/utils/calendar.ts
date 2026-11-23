export interface CalendarFunctionInput {
  id: string;
  name: string;
  date: string;
  time: string;
  venue: string;
  maps_url?: string;
}

const MONTHS: Record<string, number> = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function formatUtcIcs(date: Date): string {
  return (
    date.getUTCFullYear() +
    pad2(date.getUTCMonth() + 1) +
    pad2(date.getUTCDate()) +
    "T" +
    pad2(date.getUTCHours()) +
    pad2(date.getUTCMinutes()) +
    pad2(date.getUTCSeconds()) +
    "Z"
  );
}

export function buildFunctionIcs(fn: CalendarFunctionInput): string {
  const dateMatch = fn.date.match(/(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})/);
  const timeMatch = fn.time.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);

  const day = dateMatch ? Number(dateMatch[1]) : 28;
  const monthIdx = dateMatch ? (MONTHS[dateMatch[2].toLowerCase()] ?? 10) : 10;
  const year = dateMatch ? Number(dateMatch[3]) : 2026;

  let hour = timeMatch ? Number(timeMatch[1]) : 18;
  const minute = timeMatch ? Number(timeMatch[2]) : 0;
  const ampm = timeMatch ? timeMatch[3].toUpperCase() : "PM";
  if (ampm === "PM" && hour < 12) hour += 12;
  if (ampm === "AM" && hour === 12) hour = 0;

  // Interpret local time as IST (+05:30) and convert to UTC
  const istMillis = Date.UTC(year, monthIdx, day, hour, minute, 0) - 5.5 * 3600 * 1000;
  const start = new Date(istMillis);
  const end = new Date(istMillis + 3 * 3600 * 1000);

  const description = [
    `Sharma & Reddy Wedding: ${fn.name}`,
    `Venue: ${fn.venue}`,
    fn.maps_url ? `Map: ${fn.maps_url}` : "",
  ]
    .filter(Boolean)
    .join("\\n");

  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//HaanJi//Wedding Concierge//EN",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:haanji-${fn.id}-2026@haanji.local`,
    `DTSTAMP:${formatUtcIcs(new Date())}`,
    `DTSTART:${formatUtcIcs(start)}`,
    `DTEND:${formatUtcIcs(end)}`,
    `SUMMARY:${fn.name} (Sharma & Reddy Wedding)`,
    `LOCATION:${fn.venue}`,
    `DESCRIPTION:${description}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
}

export function downloadFunctionIcs(fn: CalendarFunctionInput): void {
  const ics = buildFunctionIcs(fn);
  const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `haanji-${fn.id}.ics`;
  link.click();
  URL.revokeObjectURL(url);
}
