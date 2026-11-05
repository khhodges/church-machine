import {request, requireLatestBuild} from "./image-api";
import type {CatalogEntry, Inspection, PreparedImage} from "./image-api";

export const sourceId = (id: string) => id.startsWith("latest:") ? id.slice(7) : id;
export function latestChoices(entries: CatalogEntry[]): CatalogEntry[] {
  return [...entries.filter(e => e.id.startsWith("design:")).map(e => ({
    ...e, id: `latest:${e.id}`, name: `Latest Development Image — ${e.name}`,
    preparation: "Freshly compiled image; not verified installed",
  })), ...entries];
}

export async function inspectChoice(id: string, signal: AbortSignal): Promise<Inspection> {
  const original = sourceId(id);
  const saved = await request<Inspection>("/api/development-image/inspect?id=" + encodeURIComponent(original), {signal});
  if (original === id) return saved;
  const image = await request<PreparedImage>("/api/development-image/prepare", {
    method: "POST", signal, headers: {"Content-Type": "application/json"},
    body: JSON.stringify({id: original}),
  });
  requireLatestBuild(image);
  if (image.namespace_revision_id !== original || !image.layout_rows?.length)
    throw Error("The latest image has no matching built layout. Nothing was sent.");
  return {...saved, name: `Latest Development Image — ${saved.name}`,
    image, rows: image.layout_rows, layoutRows: image.layout_rows,
    layoutSource: "latest-built-image", fingerprint: image.artifact_sha256,
    capacityWords: image.size / 4, capacitySource: "Exact freshly built image",
    imageSha256: image.artifact_sha256, imageBytes: image.size,
    hardwareError: null, warnings: ["Freshly prepared image. Installation is not verified."]};
}
