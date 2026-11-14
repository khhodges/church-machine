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
/** Reviewed staging reservation: lives OUTSIDE application RAM, never counted in it. */
export const STAGING_WORDS = 4096; // 16 KiB
/** Provisional application RAM target; does not replace the user's proposed total. */
export const APP_TARGET_WORDS = 32768; // 128 KiB
export type PendingInput = {side: Side; state: "loading" | "error"; message?: string};
export type PlanItem = {
  side: Side; slot: number; name: string; kind: string; zone: Zone;
  words: number | null; sourceStart: number | null;
  start: number | null; // proposed; null when blocked by an earlier unresolved size
  problem?: string;
  lazy?: boolean; plannedWords?: number | null; binaryWords?: number | null;
};
export type PlanStatus = "incomplete" | "empty" | "unresolved" | "overflow" | "insufficient" | "required-only" | "fits";
export type Plan = {
  items: PlanItem[]; external: PlanItem[]; notProvisioned: PlanItem[];
  requiredWords: number | null; zoneWords: Record<Zone, number | null>;
  status: PlanStatus; messages: string[];
  /** Sum of every resident size that IS known, even when addresses are blocked. */
  knownResidentWords: number;
  /** Lazy runtime demand: separate, never resident, never part of requiredWords. */
  lazyWords: number; lazyUnresolved: number;
  stagingWords: number; appTargetWords: number;
  targetStatus: "fits" | "exceeds" | "not-assessed";
};

const KIND_ORDER: Record<string, number> = {namespace: 0, thread: 1};

function classify(side: Side, row: Slot, layoutSource?: string): {bucket: "item" | "external" | "lazy"; item: PlanItem} {
  const kind = rowKind(row);
  const raw = row.allocationWords;
  const words = typeof raw === "number" && Number.isSafeInteger(raw) && raw > 0 ? raw : null;
  const zone: Zone = kind === "lump" ? "lumpZone" : side === "A" ? "namespaceA" : "namespaceB";
  const pos = (v: unknown) => typeof v === "number" && Number.isSafeInteger(v) && v > 0 ? v : null;
  const item: PlanItem = {side, slot: row.slot, name: row.name, kind, zone, words, sourceStart: wordValue(row.location), start: null,
    plannedWords: pos(row.plannedWords), binaryWords: pos(row.geometry?.sizeWords)};
  if (kind === "mmio") return {bucket: "external", item};
  const policy = row.policy ?? row.load_policy;
  const resolutionProblem = row.unresolved ? row.resolutionError || "Latest verified compilation could not be resolved." : undefined;
  if (kind === "lump" && (policy === "Lazy" || row.resident === false)) {
    item.lazy = true; item.words = null; // lazy demand is never resident
    if (resolutionProblem) item.problem = resolutionProblem;
    else if (item.plannedWords == null) item.problem = "Runtime requirement not supplied; no size is assumed.";
    return {bucket: "lazy", item};
  }
  if (kind === "lump" && words === null && item.plannedWords != null) item.words = item.plannedWords;
  if (kind === "namespace" && layoutSource !== "saved-design-layout") {
    // Saved descriptors may express the enclosing authority range, not the table.
    item.words = null;
    item.problem = layoutSource
      ? `Layout source "${layoutSource}" gives saved locations only; physical table extent is not supplied, so none is assumed.`
      : "No layout source recorded; physical table extent is not supplied, so none is assumed.";
  }
  else if (item.words === null) item.problem = "Allocation size unknown; no size is assumed.";
  if (row.unresolved) { item.words = null; item.problem = resolutionProblem ?? "Saved layout marks this allocation unresolved."; }
  return {bucket: "item", item};
}

export function planCoResidency(inputs: PlanInput[], totalWords: number | null, pending: PendingInput[] = []): Plan {
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
  for (const input of pending) zoneWords[input.side === "A" ? "namespaceA" : "namespaceB"] = null;
  if (pending.length) zoneWords.lumpZone = null;
  const requiredWords = cursor;
  let status: PlanStatus;
  if (pending.length) {
    status = "incomplete";
    for (const p of pending) messages.push(p.state === "loading"
      ? `Namespace ${p.side} is still loading; no fit is claimed.`
      : `Namespace ${p.side} failed to load${p.message ? `: ${p.message}` : ""}. No fit is claimed and it is not treated as empty.`);
  }
  else if (!items.length) status = "empty";
  else if (unresolved.length) { status = "unresolved"; messages.push(`${unresolved.length} resident entr${unresolved.length === 1 ? "y has" : "ies have"} no established size; later entries are not placed and no fit is claimed.`); }
  else if (overflow) { status = "overflow"; messages.push("Required allocation exceeds the 32-bit word address range. Plan is invalid."); }
  else if (totalWords === null) { status = "required-only"; messages.push("No proposed total memory: showing the required span only, not a hardware capacity."); }
  else if (requiredWords! > totalWords) { status = "insufficient"; messages.push(`Plan needs ${requiredWords!.toLocaleString()} words; proposed total is ${totalWords.toLocaleString()} (short by ${(requiredWords! - totalWords).toLocaleString()}).`); }
  else status = "fits";
  const knownResidentWords = items.reduce((n, i) => n + (i.problem ? 0 : i.words ?? 0), 0);
  const lazyWords = notProvisioned.reduce((n, i) => n + (i.problem ? 0 : i.plannedWords ?? 0), 0);
  const lazyUnresolved = notProvisioned.filter(i => i.problem).length;
  const complete = status === "fits" || status === "required-only" || status === "insufficient";
  const targetStatus = !complete ? "not-assessed" : requiredWords! <= APP_TARGET_WORDS ? "fits" : "exceeds";
  return {items, external, notProvisioned, requiredWords: status === "incomplete" ? null : requiredWords, zoneWords, status, messages,
    knownResidentWords, lazyWords, lazyUnresolved, stagingWords: STAGING_WORDS, appTargetWords: APP_TARGET_WORDS, targetStatus};
}

/** Disjointness check used by tests and as a runtime guard. */
export function overlaps(items: PlanItem[]): boolean {
  const placed = items.filter(i => i.start !== null && i.words).sort((a, b) => a.start! - b.start!);
  return placed.some((item, i) => i > 0 && placed[i - 1].start! + placed[i - 1].words! > item.start!);
}
