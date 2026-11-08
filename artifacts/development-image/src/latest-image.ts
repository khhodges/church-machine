import {request} from "./image-api";
import type {CatalogEntry, Inspection} from "./image-api";

export const sourceId = (id: string) => id.startsWith("latest:") ? id.slice(7) : id;
export function latestChoices(entries: CatalogEntry[]): CatalogEntry[] {
  // One creation-defined name per design. Builds are a view/action, not
  // extra Namespaces. Historical entries remain available to explicit links.
  return entries;
}

export async function inspectChoice(id: string, signal: AbortSignal): Promise<Inspection> {
  const original = sourceId(id);
  const saved = await request<Inspection>("/api/development-image/inspect?id=" + encodeURIComponent(original), {signal});
  // Even an old latest: link is navigation only. Preparation is explicit.
  return saved;
}
