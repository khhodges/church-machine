// Pure A/B LUMP association for Next Bitstream planning. Saved Namespaces
// have independent address spaces: nothing here merges addresses or invents
// placements. Two rows are "shared" only when an exact artifact identity
// (filename + revision, plus token when both record one) matches.
import type { Slot } from "./image-api";

export type Side = "A" | "B";
export type LumpPick = {side: Side; slot: number};
export type LumpMember = {side: Side; slot: number; name: string; words: number | null; identity: string | null};
export type GlassLump = {key: string; identity: string | null; name: string; members: LumpMember[]};

export function isLumpRow(row: Slot): boolean {
  return (row.kind ?? (row.filename ? "lump" : "")) === "lump";
}

/** Exact artifact identity, or null when the saved row cannot prove one. */
export function lumpIdentity(row: Slot): string | null {
  const file = row.selection?.filename ?? row.filename;
  const rev = row.selection?.revision ?? row.lump_version;
  if (!file || rev === undefined || rev === null) return null;
  const token = row.selection?.token ?? row.token;
  return `${file}@${rev}${token ? `#${token}` : ""}`;
}

export function lumpMembers(side: Side, rows: Slot[] | null | undefined): LumpMember[] {
  return (rows ?? []).filter(isLumpRow).sort((a, b) => a.slot - b.slot).map(row => ({
    side, slot: row.slot, name: row.name,
    words: typeof row.allocationWords === "number" && row.allocationWords > 0 ? row.allocationWords : null,
    identity: lumpIdentity(row),
  }));
}

/** One glass entry per exact identity; unidentified rows always stay per-side. */
export function associate(a: LumpMember[], b: LumpMember[]): GlassLump[] {
  const out: GlassLump[] = [];
  const byIdentity = new Map<string, GlassLump>();
  for (const m of [...a, ...b]) {
    if (m.identity) {
      const found = byIdentity.get(m.identity);
      // Same side twice with one identity = two resident copies; keep separate.
      if (found && !found.members.some(x => x.side === m.side)) { found.members.push(m); continue; }
      if (!found) {
        const item = {key: `id:${m.identity}`, identity: m.identity, name: m.name, members: [m]};
        byIdentity.set(m.identity, item); out.push(item); continue;
      }
    }
    out.push({key: `${m.side}:${m.slot}`, identity: m.identity, name: m.name, members: [m]});
  }
  return out;
}

export const sideOf = (item: GlassLump): "A" | "B" | "AB" =>
  item.members.length > 1 ? "AB" : item.members[0].side;

export function glassKeyFor(items: GlassLump[], pick: LumpPick | null): string | null {
  if (!pick) return null;
  return items.find(i => i.members.some(m => m.side === pick.side && m.slot === pick.slot))?.key ?? null;
}

/** Glass -> left: keep the current tab if it holds the LUMP, else switch tabs. */
export function pickFromGlass(item: GlassLump, tab: Side): {tab: Side; pick: LumpPick} {
  const m = item.members.find(x => x.side === tab) ?? item.members[0];
  return {tab: m.side, pick: {side: m.side, slot: m.slot}};
}
