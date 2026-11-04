export type Slot = {
  slot: number; name: string; kind: string; type?: string;
  location: number | null; limit?: number | string; allocationWords: number | null;
  policy?: string; load_policy?: string; resident?: boolean; token?: string;
  seq?: number; sequence?: number; boot?: boolean; filename?: string; lump_version?: number;
  selection?: {filename?: string; revision?: number; token?: string};
};
export type CatalogEntry = {id: string; name: string; saved_at: string; preparation: string};
export type PreparedImage = {
  profile: string; namespace_revision_id: string; artifact_sha256: string;
  required_bitstream_sha256: string; size: number;
};
export type Inspection = {
  id: string; name: string; rows: Slot[]; fingerprint: string;
  capacityWords: number; capacitySource: string; image: PreparedImage | null;
  imageSha256: string | null; imageBytes: number | null;
  hardwareError: string | null; warnings: string[]; metadata: Record<string, unknown>;
};
export type Target = {device_uid: string; session_id: string; live: boolean};
export type BoardStatus = {
  physical_target?: Target;
  command_delivery?: Record<string, unknown>;
  runtime_upload_ack?: Record<string, unknown>;
};
export type Receipt = {
  id: number; artifact_sha256: string; namespace_revision_id: string;
  target: Target;
};

export async function request<T>(url: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {...options, cache: "no-store"});
  const data = await response.json().catch(() => {
    throw Error(`The server returned an unreadable response (${response.status}). Nothing was confirmed.`);
  });
  if (!response.ok || data.ok === false) throw Error(data.error || `Request failed (${response.status}).`);
  return data as T;
}

export const PROFILE = "amoeba-retry-25mhz-uart-v1";
export async function prepareExact(image: PreparedImage, token: string) {
  const prepared = await request<PreparedImage>("/api/namespace-image/uart-prepare", {
    method: "POST", headers: {"Content-Type": "application/json", Authorization: `Bearer ${token}`},
    body: JSON.stringify({profile: image.profile, namespace_revision_id: image.namespace_revision_id}),
  });
  if (prepared.artifact_sha256 !== image.artifact_sha256 ||
      prepared.namespace_revision_id !== image.namespace_revision_id ||
      prepared.profile !== PROFILE || prepared.size !== 65536) {
    throw Error("Prepared image identity changed. Nothing was sent. Reload this exact Namespace before retrying.");
  }
  return prepared;
}

export async function installExact(image: PreparedImage, target: Target, token: string): Promise<Receipt> {
  const sent = await request<Receipt & {queued: boolean}>("/api/namespace-image/uart-install", {
    method: "POST", headers: {"Content-Type": "application/json", Authorization: `Bearer ${token}`},
    body: JSON.stringify({
      profile: image.profile, namespace_revision_id: image.namespace_revision_id,
      artifact_sha256: image.artifact_sha256, confirm_runtime_memory_replacement: true,
      target_device_uid: target.device_uid, target_session_id: target.session_id,
    }),
  });
  if (!sent.queued || sent.namespace_revision_id !== image.namespace_revision_id ||
      sent.artifact_sha256 !== image.artifact_sha256 || !Number.isInteger(sent.id)) {
    throw Error("The transfer response did not match the selected image. Check FPGA status before retrying; delivery is unknown.");
  }
  return {...sent, target};
}

export function receiptState(receipt: Receipt, board: BoardStatus): string {
  const delivery = board.command_delivery;
  // Never attribute a previous or a different operator's command to this send.
  if (!delivery || delivery.id !== receipt.id ||
      delivery.artifact_sha256 !== receipt.artifact_sha256 ||
      delivery.target_device_uid !== receipt.target.device_uid ||
      delivery.target_session_id !== receipt.target.session_id) return "Queued — awaiting matching delivery evidence.";
  if (delivery.write_ok === false) return `Transfer failed: ${String(delivery.write_error || "bridge write failed")}. Inspect FPGA status before retrying.`;
  const ack = board.runtime_upload_ack;
  if (ack && (ack.id === receipt.id || ack.command_id === receipt.id) &&
      ack.artifact_sha256 === receipt.artifact_sha256) {
    if (ack.ok === false) return `Upload failed: ${String(ack.error || "board rejected the upload")}.`;
    if (ack.ok === true) return "Upload acknowledged — full memory readback and startup are not verified.";
  }
  if (delivery.write_ok === true) return "Sent by bridge — awaiting matching upload acknowledgement. Contents unverified.";
  return delivery.consumed_ts ? "Delivered to bridge — board acknowledgement pending." : "Queued — waiting for bridge.";
}
