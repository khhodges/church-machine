/* Browser-only inspection preference. Never approval or installed evidence. */
(function (root) {
  'use strict';
  const key = 'church_inspected_namespace_v1';
  function read() {
    try { return root.localStorage.getItem(key); } catch (_) { return null; }
  }
  function remember(id) {
    try { root.localStorage.setItem(key, id || ''); } catch (_) {}
  }
  function name(id, fallback) {
    return id === 'inspection-amoeba-retry-image' || id === 'inspection-amoeba-retry'
      ? 'Amoeba retry' : fallback;
  }
  root.NamespaceSelection = {read, remember, name};
})(globalThis);
