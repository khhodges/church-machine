import type {PreparedImage, Slot} from "./image-api";

/** Never fill missing prepared evidence from saved rows or another build. */
export function builtSlots(image: PreparedImage): Slot[] {
  const map = image.memory_map;
  if (!map || map.artifact_sha256 !== image.artifact_sha256 ||
      map.namespace_revision_id !== image.namespace_revision_id ||
      map.size !== image.size || map.address_unit !== "byte" ||
      !Number.isSafeInteger(image.size) || image.size <= 0 || image.size % 4)
    throw Error("Built-image map is unavailable or does not match this exact image. Prepare again; saved locations are not a substitute.");
  return map.regions.map(region => {
    const address = region.byteAddress;
    if ((address !== null && (!Number.isSafeInteger(address) || address < 0 || address % 4)) ||
        !Number.isSafeInteger(region.byteLength) || region.byteLength < 0 || region.byteLength % 4 ||
        (region.resident && (address === null || address + region.byteLength > image.size)))
      throw Error("Built-image map contains an invalid byte range. Prepare again.");
    return {...region, location: address === null ? null : address / 4,
      allocationWords: region.byteLength / 4, limit: region.byteLength / 4 - 1};
  });
}

export function byteToWord(text: string): number | null {
  if (!/^(?:0x[0-9a-f]+|[0-9]+)$/i.test(text.trim())) return null;
  const bytes = Number(text.trim());
  return Number.isSafeInteger(bytes) && bytes >= 0 && bytes <= 0xffffffff ? bytes / 4 : null;
}

export function containingRegion(rows: Slot[], word: number): Slot | undefined {
  // The Namespace table is not the enclosing Namespace authority range.
  // MMIO remains explicitly outside resident RAM, even at an aliased address.
  return rows.find(row => row.kind !== "mmio" && row.location !== null &&
    row.allocationWords !== null && word >= row.location &&
    word < row.location + row.allocationWords);
}
