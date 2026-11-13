// Saved-layout comparison geometry. Uses each saved row's own location and
// allocationWords exactly (word units); nothing is relocated or combined.
import type { Slot } from "./image-api";
import type { Side } from "./nb-association";

export const DEFAULT_SCALE_WORDS = 16384; // same fallback as Namespace memory glass
export type Placement = "extent" | "marker" | "unplaced" | "out-of-range";
export type SavedObject = {side: Side; slot: number; name: string; kind: string; start: number | null; words: number | null; placement: Placement};

export function wordValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = /^0x/i.test(value) ? Number.parseInt(value, 16) : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function rowKind(row: Slot): string {
  return row.kind ?? (row.filename ? "lump" : row.name.includes("DEV") ? "mmio" : row.name.includes("Thread") ? "thread" : "namespace");
}

/** Shared scale: largest supplied capacity, else the original 16,384-word fallback. */
export function sharedScale(capacities: Array<number | null | undefined>): {words: number; source: "capacity" | "fallback"} {
  const caps = capacities.filter((c): c is number => typeof c === "number" && c > 0);
  return caps.length ? {words: Math.max(...caps), source: "capacity"} : {words: DEFAULT_SCALE_WORDS, source: "fallback"};
}

export function savedObjects(side: Side, rows: Slot[] | null | undefined, scaleWords: number): SavedObject[] {
  return (rows ?? []).filter(row => rowKind(row) !== "mmio").map(row => {
    const start = wordValue(row.location);
    const words = typeof row.allocationWords === "number" && row.allocationWords > 0 ? row.allocationWords : null;
    const placement: Placement = start === null ? "unplaced"
      : start < 0 || start >= scaleWords || (words !== null && start + words > scaleWords) ? "out-of-range"
      : words === null ? "marker" : "extent";
    return {side, slot: row.slot, name: row.name, kind: rowKind(row), start, words, placement};
  });
}

/** SVG y/height for an extent, word 0 at the bottom like the original glass. */
export function extentToY(start: number, words: number, scaleWords: number, top: number, height: number) {
  return {y: top + (scaleWords - start - words) / scaleWords * height, h: words / scaleWords * height};
}
export const markerY = (start: number, scaleWords: number, top: number, height: number) =>
  top + (scaleWords - start) / scaleWords * height;

export const hexWord = (n: number) => `0x${n.toString(16).toUpperCase().padStart(8, "0")}`;
