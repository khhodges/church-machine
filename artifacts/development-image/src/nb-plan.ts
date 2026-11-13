// Design-only co-residency plan: Namespace A and B run on one FPGA image
// without memory replacement, so every resident object gets its own disjoint
// proposed interval in ONE pool. Saved inputs are never mutated; addresses
// are proposals only — no relocation, rebinding or image generation happens.
import type { Slot } from "./image-api";
import type { Side } from "./nb-association";
import { rowKind, wordValue } from "./nb-geometry";

export const MAX_WORD_ADDRESS = 0xffffffff;
export type Zone = "namespaceA" | "namespaceB" | "lumpZone";
export type PlanInput = {side: Side; rows: Slot[]; layoutSource?: string};
export type PlanItem = {
  side: Side; slot: number; name: string; kind: string; zone: Zone;
  words: number | null; sourceStart: number | null;
  start: number | null; // proposed; null when blocked by an earlier unresolved size
  problem?: string;
};
export type PlanStatus = "empty" | "unresolved" | "overflow" | "insufficient" | "required-only" | "fits";
export type Plan = {
  items: PlanItem[]; external: PlanItem[]; notProvisioned: PlanItem[];
  requiredWords: number | null; zoneWords: Record<Zone, number | null>;
  status: PlanStatus; messages: string[];
};

const KIND_ORDER: Record<string, number> = {namespace: 0, thread: 1};

function classify(side: Side, row: Slot, layoutSource?: string): {bucket: "item" | "external" | "lazy"; item: PlanItem} {
  const kind = rowKind(row);
  const raw = row.allocationWords;
  const words = typeof raw === "number" && Number.isSafeInteger(raw) && raw > 0 ? raw : null;
  const zone: Zone = kind === "lump" ? "lumpZone" : side === "A" ? "namespaceA" : "namespaceB";
  const item: PlanItem = {side, slot: row.slot, name: row.name, kind, zone, words, sourceStart: wordValue(row.location), start: null};
  if (kind === "mmio") return {bucket: "external", item};
  const policy = row.policy ?? row.load_policy;
  if (kind === "lump" && words === null && (policy === "Lazy" || row.resident === false))
    return {bucket: "lazy", item};
  if (kind === "namespace" && layoutSource !== "saved-design-layout") {
    // Saved descriptors may express the enclosing authority range, not the table.
    item.words = null;
    item.problem = "Physical table extent not supplied (saved descriptor may be an authority range).";
  } else if (words === null) item.problem = "Allocation size unknown; no size is assumed.";
  if ((row as {unresolved?: boolean}).unresolved) item.problem = "Saved layout marks this allocation unresolved.";
  return {bucket: "item", item};
}

export function planCoResidency(inputs: PlanInput[], totalWords: number | null): Plan {
  const items: PlanItem[] = [], external: PlanItem[] = [], notProvisioned: PlanItem[] = [];
  for (const input of [...inputs].sort((a, b) => a.side.localeCompare(b.side)))
    for (const row of input.rows) {
      const {bucket, item} = classify(input.side, row, input.layoutSource);
      (bucket === "item" ? items : bucket === "external" ? external : notProvisioned).push(item);
    }
  // Deterministic: A tables/Threads, B tables/Threads, then LUMP pool (A then B), by slot.
  const zoneRank: Record<Zone, number> = {namespaceA: 0, namespaceB: 1, lumpZone: 2};
  items.sort((a, b) => zoneRank[a.zone] - zoneRank[b.zone] || a.side.localeCompare(b.side) ||
    (KIND_ORDER[a.kind] ?? 2) - (KIND_ORDER[b.kind] ?? 2) || a.slot - b.slot);
  const messages: string[] = [];
  let cursor: number | null = 0, overflow = false;
  for (const item of items) {
    if (cursor === null) continue;
    if (item.problem || item.words === null) { cursor = null; continue; }
    if (cursor + item.words - 1 > MAX_WORD_ADDRESS) { overflow = true; cursor = null; continue; }
    item.start = cursor;
    cursor += item.words;
  }
  const unresolved = items.filter(i => i.problem);
  const zoneWords = {namespaceA: null, namespaceB: null, lumpZone: null} as Record<Zone, number | null>;
  for (const zone of Object.keys(zoneWords) as Zone[]) {
    const members = items.filter(i => i.zone === zone);
    if (members.every(i => !i.problem && i.words !== null))
      zoneWords[zone] = members.reduce((n, i) => n + i.words!, 0);
  }
  const requiredWords = cursor;
  let status: PlanStatus;
  if (!items.length) status = "empty";
  else if (unresolved.length) { status = "unresolved"; messages.push(`${unresolved.length} resident entr${unresolved.length === 1 ? "y has" : "ies have"} no established size; later entries are not placed and no fit is claimed.`); }
  else if (overflow) { status = "overflow"; messages.push("Required allocation exceeds the 32-bit word address range. Plan is invalid."); }
  else if (totalWords === null) { status = "required-only"; messages.push("No proposed total memory: showing the required span only, not a hardware capacity."); }
  else if (requiredWords! > totalWords) { status = "insufficient"; messages.push(`Plan needs ${requiredWords!.toLocaleString()} words; proposed total is ${totalWords.toLocaleString()} (short by ${(requiredWords! - totalWords).toLocaleString()}).`); }
  else status = "fits";
  return {items, external, notProvisioned, requiredWords, zoneWords, status, messages};
}

/** Disjointness check used by tests and as a runtime guard. */
export function overlaps(items: PlanItem[]): boolean {
  const placed = items.filter(i => i.start !== null && i.words).sort((a, b) => a.start! - b.start!);
  return placed.some((item, i) => i > 0 && placed[i - 1].start! + placed[i - 1].words! > item.start!);
}
