export type BookingHours = Record<string, [string, string] | null>;
export type BusyInterval = { start: string | null; end: string | null };
export type ServiceArea = { area_type: "zip" | "city" | "polygon"; values_json: unknown; active?: boolean };

export function normalizePhone(value: string) { return value.replace(/\D/g, "").slice(-10); }

export function addMinutes(time: string, minutes: number) {
  const [hour, minute] = time.slice(0, 5).split(":").map(Number);
  const total = hour * 60 + minute + minutes;
  return `${String(Math.floor(total / 60) % 24).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function minutes(time: string | null) {
  if (!time) return null;
  const [hour, minute] = time.slice(0, 5).split(":").map(Number);
  return Number.isFinite(hour + minute) ? hour * 60 + minute : null;
}

export function buildBookingSlots(input: {
  date: string;
  hours: BookingHours;
  intervalMin: number;
  durationMin: number;
  arrivalWindowMin: number;
  minNoticeHours: number;
  maxDaysAhead: number;
  capacity: number;
  busy: BusyInterval[];
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const day = new Date(`${input.date}T12:00:00`);
  if (Number.isNaN(day.valueOf())) return [];
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const daysAhead = Math.round((day.getTime() - today.getTime()) / 864e5);
  if (daysAhead < 0 || daysAhead > input.maxDaysAhead) return [];
  const isoDay = day.getDay() === 0 ? 7 : day.getDay();
  const open = input.hours[String(isoDay)];
  if (!open) return [];
  const start = minutes(open[0]), close = minutes(open[1]);
  if (start === null || close === null || close <= start) return [];
  const earliest = now.getTime() + input.minNoticeHours * 3600_000;
  const busy = input.busy.map((row) => ({ start: minutes(row.start), end: minutes(row.end) })).filter((row): row is {start:number;end:number} => row.start !== null && row.end !== null);
  const slots: { start: string; end: string; label: string }[] = [];
  for (let cursor = start; cursor + input.durationMin <= close; cursor += input.intervalMin) {
    const slotDate = new Date(`${input.date}T${String(Math.floor(cursor / 60)).padStart(2,"0")}:${String(cursor % 60).padStart(2,"0")}:00`);
    if (slotDate.getTime() < earliest) continue;
    const overlap = busy.filter((row) => cursor < row.end && cursor + input.durationMin > row.start).length;
    if (overlap >= Math.max(1, input.capacity)) continue;
    const startText = `${String(Math.floor(cursor / 60)).padStart(2,"0")}:${String(cursor % 60).padStart(2,"0")}`;
    const endText = addMinutes(startText, input.arrivalWindowMin);
    slots.push({ start: startText, end: endText, label: `${startText}–${endText}` });
  }
  return slots;
}

export function matchesServiceArea(postalCode: string, city: string, areas: ServiceArea[]) {
  const active = areas.filter((area) => area.active !== false && area.area_type !== "polygon");
  if (!active.length) return true;
  const postal = postalCode.trim().toLowerCase();
  const normalizedCity = city.trim().toLowerCase();
  return active.some((area) => {
    const values = Array.isArray(area.values_json) ? area.values_json.map(String) : [];
    if (area.area_type === "zip") return values.some((value) => value.trim().toLowerCase() === postal);
    return values.some((value) => value.trim().toLowerCase() === normalizedCity);
  });
}

export function createBookingReference() {
  return `SP-${Date.now().toString(36).toUpperCase()}-${crypto.randomUUID().slice(0,4).toUpperCase()}`;
}
