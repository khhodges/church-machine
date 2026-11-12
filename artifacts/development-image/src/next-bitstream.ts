// Pure planning geometry for the Next Bitstream Design workspace.
// Nothing here is approved, built, or sent; blank values stay unspecified.
export type DraftInputs = {total: string; namespaceA: string; namespaceB: string; lumpZone: string};
export type DraftRegionKey = "namespaceA" | "namespaceB" | "lumpZone";
export type DraftRegion = {key: DraftRegionKey; label: string; words: number | null; start: number | null};
export type DraftCheck = {
  total: number | null;
  regions: DraftRegion[];
  errors: string[];
  notes: string[];
  specifiedWords: number;
  remainingWords: number | null;
  scaleWords: number;
  scaleSource: "proposed-total" | "sum-of-regions" | "none";
};

export const REGION_LABELS: Record<DraftRegionKey, string> = {
  namespaceA: "Resident Namespace A",
  namespaceB: "Resident Namespace B",
  lumpZone: "Common LUMP zone",
};

/** Blank -> null (unspecified). Decimal or 0x hex word counts; otherwise an error string. */
export function parseWords(value: string): number | null | string {
  const text = value.trim().replace(/[_,\s]/g, "");
  if (!text) return null;
  const n = /^0x[0-9a-f]+$/i.test(text) ? Number.parseInt(text, 16) : /^\d+$/.test(text) ? Number(text) : NaN;
  if (!Number.isSafeInteger(n)) return "must be a whole number of words (decimal or 0x hex)";
  if (n <= 0) return "must be greater than zero";
  return n;
}

export function checkDraft(inputs: DraftInputs): DraftCheck {
  const errors: string[] = [];
  const notes: string[] = [];
  const read = (value: string, label: string) => {
    const parsed = parseWords(value);
    if (typeof parsed === "string") { errors.push(`${label} ${parsed}.`); return null; }
    return parsed;
  };
  const total = read(inputs.total, "Proposed total memory");
  const keys: DraftRegionKey[] = ["namespaceA", "namespaceB", "lumpZone"];
  let cursor = 0;
  let contiguous = true;
  const regions = keys.map(key => {
    const words = read(inputs[key], REGION_LABELS[key]);
    const region: DraftRegion = {key, label: REGION_LABELS[key], words, start: null};
    if (words === null) contiguous = false;
    else if (contiguous) { region.start = cursor; cursor += words; }
    return region;
  });
  const specifiedWords = regions.reduce((sum, r) => sum + (r.words ?? 0), 0);
  const unspecified = regions.filter(r => r.words === null).length;
  if (total !== null && specifiedWords > total)
    errors.push(`Proposed regions need ${specifiedWords.toLocaleString()} words, exceeding the proposed total of ${total.toLocaleString()} by ${(specifiedWords - total).toLocaleString()}.`);
  if (total === null) notes.push("Proposed total memory is unspecified; no fit can be assessed.");
  if (unspecified) notes.push(`${unspecified} region size${unspecified === 1 ? " is" : "s are"} unspecified; placement after the first gap is not drawn.`);
  const remainingWords = total !== null && !errors.length && unspecified === 0 ? total - specifiedWords : null;
  const scaleWords = total ?? specifiedWords;
  return {total, regions, errors, notes, specifiedWords, remainingWords,
    scaleWords, scaleSource: total !== null ? "proposed-total" : specifiedWords > 0 ? "sum-of-regions" : "none"};
}
