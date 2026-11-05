/** Development Image is shown inside the Church Machine IDE shell. */
export const IDE_ROUTE = "/simulator/#development-image";

/** True only when the parent is the same-origin IDE view that hosts this app. */
export function isEmbeddedInIde(win: Window = window): boolean {
  if (win.parent === win) return false;
  try {
    return !!win.parent.document.getElementById("developmentImageFrame");
  } catch {
    return false;
  }
}

export function ideUrl(search: string): string {
  const namespace = new URLSearchParams(search).get("namespace");
  return IDE_ROUTE + (namespace ? "?namespace=" + encodeURIComponent(namespace) : "");
}

/**
 * Standalone visits redirect to the integrated IDE view, preserving selection.
 * Embedded copies never redirect, so the IDE frame cannot loop.
 */
export function redirectStandalone(win: Window = window): boolean {
  if (isEmbeddedInIde(win)) return false;
  win.location.replace(ideUrl(win.location.search));
  return true;
}

export function notifyIde(message: Record<string, unknown>, win: Window = window) {
  if (isEmbeddedInIde(win)) win.parent.postMessage(message, win.location.origin);
}

/**
 * One-shot "Load development image" handoff from the IDE Build Approval view.
 * Accepted only from the same-origin hosting parent, only for an explicit
 * request id, and only when it names the exact Namespace already selected.
 * It never installs: it may only start prepare + target check, which ends at
 * the explicit runtime-replacement confirmation dialog.
 */
export type LoadRequest = {type: "development-image:load"; namespace: string; requestId: string};
export function acceptLoadRequest(
  event: {origin: string; source: unknown; data: unknown},
  win: {parent: unknown; location: {origin: string}},
): LoadRequest | null {
  if (win.parent === win || event.source !== win.parent || event.origin !== win.location.origin) return null;
  const data = event.data as Partial<LoadRequest> | null;
  if (!data || data.type !== "development-image:load") return null;
  if (typeof data.namespace !== "string" || !data.namespace) return null;
  if (typeof data.requestId !== "string" || !data.requestId) return null;
  return {type: data.type, namespace: data.namespace, requestId: data.requestId};
}
/** The request runs only once, and only when the loaded inspection is that exact identity. */
export function loadRequestReady(request: LoadRequest | null, loadedId: string | undefined, handled: Set<string>): boolean {
  return !!request && !handled.has(request.requestId) && loadedId === request.namespace;
}
