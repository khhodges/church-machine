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
