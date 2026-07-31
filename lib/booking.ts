// Typed surface over the pure booking engine.
//
// COUPLING: the implementation lives in lib/core/booking.mjs (plain ESM so
// `node --test` can execute it — see tests/booking.test.mjs). Change behaviour
// there, not here. This file only adds TypeScript types.

// @ts-ignore -- pure JS module, unit-tested (lib/core/booking.mjs)
import * as core from "./core/booking.mjs";

export type BookingHours = Record<string, [string, string] | null>;
export type BusyInterval = { start: string | null; end: string | null };
export type ServiceArea = { area_type: "zip" | "city" | "polygon"; values_json: unknown; active?: boolean };
export type BookingSlot = { start: string; end: string; label: string };
export type ServiceAreaVerdict = "match" | "outside" | "unevaluable";

export interface BookingSlotInput {
  date: string;
  hours: BookingHours;
  intervalMin: number;
  durationMin: number;
  arrivalWindowMin: number;
  minNoticeHours: number;
  maxDaysAhead: number;
  capacity: number;
  busy: BusyInterval[];
  /** IANA name from `booking_settings.timezone`. Invalid/missing falls back to the default. */
  timeZone?: string | null;
  /** Injectable clock. Instant, not wall clock. */
  now?: Date | number;
}

export type ServiceAreaEnforcement = {
  total: number;
  polygons: number;
  enforceable: number;
  unenforceable: boolean;
};

export const normalizePhone: (value: string) => string = core.normalizePhone;

export const addMinutes: (time: string, minutes: number) => string = core.addMinutes;

export const buildBookingSlots: (input: BookingSlotInput) => BookingSlot[] = core.buildBookingSlots;

/**
 * Tri-state service-area check. Prefer this over `matchesServiceArea` so a
 * polygon-only configuration is handled deliberately instead of silently
 * accepting every address.
 */
export const evaluateServiceArea: (
  postalCode: string,
  city: string,
  areas: ServiceArea[],
) => ServiceAreaVerdict = core.evaluateServiceArea;

/** @deprecated collapses "unevaluable" into accept — that collapse is the bug. */
export const matchesServiceArea: (postalCode: string, city: string, areas: ServiceArea[]) => boolean =
  core.matchesServiceArea;

/** Counts polygon vs. checkable areas so the settings UI can stop the toggle lying. */
export const serviceAreaEnforcementGaps: (areas: ServiceArea[]) => ServiceAreaEnforcement =
  core.serviceAreaEnforcementGaps;

export const DEFAULT_BOOKING_TIMEZONE: string = core.DEFAULT_BOOKING_TIMEZONE;

export const resolveTimeZone: (timeZone: string | null | undefined) => string = core.resolveTimeZone;

export const createBookingReference: () => string = core.createBookingReference;
