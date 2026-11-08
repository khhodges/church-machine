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
  const designKey = 'church_selected_namespace_v2';
  function current() {
    try { return root.localStorage.getItem(designKey); } catch (_) { return null; }
  }
  function select(id) {
    if (!/^namespace:(legacy|ascending|phase1|copy:[^:]+)$/.test(id)) return false;
    try { root.localStorage.setItem(designKey, id); } catch (_) {}
    if (root.dispatchEvent && root.CustomEvent)
      root.dispatchEvent(new root.CustomEvent('namespace-selection', {detail: id}));
    return true;
  }
  function name(id, fallback) {
    return id === 'inspection-amoeba-retry-image' || id === 'inspection-amoeba-retry'
      ? 'Amoeba retry' : fallback;
  }
  root.NamespaceSelection = {read, remember, name, current, select, designKey};
})(globalThis);
