const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, 'app-lumps.js'), 'utf8');
const index = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

function expect(ok, message) {
  if (!ok) throw new Error(`LUMP draft restore regression: ${message}`);
}

const openStart = source.indexOf('async function openLumpInEditor(token)');
const openSource = source.slice(openStart);

expect(openStart >= 0, 'openLumpInEditor must exist');
expect(
  openSource.includes('typeof saveActiveUserTab === \'function\'') &&
    openSource.includes('saveActiveUserTab();'),
  'a dirty personal tab must be saved before the LUMP takes over the editor'
);
expect(
  openSource.includes('activeUserTabId = null') &&
    openSource.includes('userTabDirty = false'),
  'the previous personal-tab ownership must be cleared'
);
expect(
  openSource.includes("document.querySelectorAll('.example-tab')") &&
    openSource.includes("tab.classList.remove('active')"),
  'no built-in example may remain highlighted over a restored LUMP draft'
);
expect(
  openSource.indexOf("document.querySelectorAll('.example-tab')") <
    openSource.indexOf("switchView('editor')"),
  'editor ownership must be transferred before the saved LUMP is displayed'
);
expect(
  source.includes('delete _lumpEditorDraftText[tk];') &&
    source.includes('if (ta.value !== text) _draftLsSet(token, ta.value);'),
  'discard must clear both draft stores and opening alone must not create a draft'
);
expect(
  index.includes('app-lumps.js?v=sha256-7b7967531766'),
  'the editor must request the corrected draft script'
);

expect(
  source.includes('function _lumpTokenIdentity(token)') &&
    source.includes("return encodeURIComponent(String(token == null ? '' : token));"),
  'all per-LUMP state must use a reversible exact-token identity'
);
expect(
  (source.match(/replace\(\/\[\^a-z0-9\]\/gi, ''\)/g) || []).length === 1,
  'lossy normalization may remain only for detecting ambiguous legacy draft keys'
);
expect(
  source.includes("const _DRAFT_LS_PREFIX = 'cm_lump_draft_v2_';") &&
    source.includes('const lossy = raw.replace(/[^a-z0-9]/gi, \'\');') &&
    source.includes('if (raw !== lossy)'),
  'draft storage must be versioned and migrate only unambiguous legacy raw-token keys'
);

const identity = token => encodeURIComponent(String(token == null ? '' : token));
const collidingTokens = ['AB-CD', 'ab_cd'];
expect(
  collidingTokens.map(identity)[0] !== collidingTokens.map(identity)[1],
  'similarly named tokens must not share draft, open, or tab state'
);

function loadDraftHelpers(storage) {
  const identityStart = source.indexOf('function _lumpTokenIdentity(token)');
  const identityEnd = source.indexOf('\n\nfunction showLumpDetail', identityStart);
  const draftStart = source.indexOf("const _DRAFT_LS_PREFIX = 'cm_lump_draft_v2_';");
  const draftEnd = source.indexOf('\n\nfunction _buildTextEditor', draftStart);
  const context = {
    localStorage: {
      getItem: key => storage.has(key) ? storage.get(key) : null,
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: key => storage.delete(key),
    },
    window: {},
    console,
  };
  vm.runInNewContext(
    'const _lumpEditorDraftText = {}; function exitSavedLumpEditorMode() {' +
      ' window._savedLumpEditorMode = false; window._editorOpenLumpToken = null;' +
      ' window._editorLumpDirtyToken = null; }\n' +
    source.slice(identityStart, identityEnd) +
      source.slice(draftStart, draftEnd) +
      '\nthis.drafts = {_draftLsKey, _draftLsGet, _draftLsSet, _draftLsDel,' +
      ' _commitSavedLumpClientState};',
    context
  );
  return context.drafts;
}

const storage = new Map();
let drafts = loadDraftHelpers(storage);
drafts._draftLsSet(collidingTokens[0], 'dash draft');
drafts._draftLsSet(collidingTokens[1], 'underscore draft');
expect(
  drafts._draftLsGet(collidingTokens[0]) === 'dash draft' &&
    drafts._draftLsGet(collidingTokens[1]) === 'underscore draft',
  'colliding legacy token forms must retain independent drafts'
);

const savedToken = 'fresh123';
const oldDraftToken = 'old-draft-token';
drafts._draftLsSet(oldDraftToken, 'restored source');
const registryEvents = [];
const registryEntries = new Map();
const registry = {
  registerFromServer(items) {
    items.forEach(item => registryEntries.set(item.token, item));
    registryEvents.push('register');
  },
  evictMemory(token) { registryEvents.push(`evict:${token}`); },
  setCurrent(token) { registryEvents.push(`current:${token}`); },
  setPending(token) { registryEvents.push(`pending:${token}`); },
};
const commitContext = loadDraftHelpers(storage);
commitContext._draftLsSet(oldDraftToken, 'restored source');
// The helper is deliberately exercised with the complete canonical response
// returned by POST /api/lumps/save.
const helperSource = source.slice(
  source.indexOf("const _DRAFT_LS_PREFIX = 'cm_lump_draft_v2_';"),
  source.indexOf('\n\nfunction _buildTextEditor')
);
const helperSandbox = {
  localStorage: {
    getItem: key => storage.has(key) ? storage.get(key) : null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: key => storage.delete(key),
  },
  window: {
    LumpRegistry: registry,
    _savedLumpEditorMode: true,
    _editorOpenLumpToken: oldDraftToken,
    _editorLumpDirtyToken: oldDraftToken,
  },
};
vm.runInNewContext(
  "function _lumpTokenIdentity(token) { return encodeURIComponent(String(token == null ? '' : token)); }" +
  'const _lumpEditorDraftText = {}; function exitSavedLumpEditorMode() {' +
  ' window._savedLumpEditorMode = false; window._editorOpenLumpToken = null;' +
  ' window._editorLumpDirtyToken = null; }\n' + helperSource,
  helperSandbox
);
const descriptor = helperSandbox.window._commitSavedLumpClientState({
  token: savedToken,
  abstraction: 'CapabilityTest',
  dot_name: 'Ada.CapabilityTest',
  issue_n: 7,
  filename: 'Ada.CapabilityTest.7.fresh123.lump',
  binary_hash: 'a'.repeat(64),
  lump_version: 8,
}, { ns_slot: 10 }, oldDraftToken);
expect(
  descriptor.dot_name === 'Ada.CapabilityTest' &&
    registryEntries.get(savedToken).filename === 'Ada.CapabilityTest.7.fresh123.lump',
  'a fresh save must be registered immediately with canonical server identity'
);
expect(
  drafts._draftLsGet(oldDraftToken) === null &&
    registryEvents.join('|').includes(`current:${savedToken}|pending:${savedToken}`) &&
    helperSandbox.window._editorOpenLumpToken === null,
  'a successful fresh save must delete the old draft and transfer editor selection'
);

drafts = loadDraftHelpers(storage);
expect(
  drafts._draftLsGet(collidingTokens[0]) === 'dash draft' &&
    drafts._draftLsGet(collidingTokens[1]) === 'underscore draft',
  'independent drafts must survive a page reload'
);
drafts._draftLsDel(collidingTokens[0]);
expect(
  drafts._draftLsGet(collidingTokens[0]) === null &&
    drafts._draftLsGet(collidingTokens[1]) === 'underscore draft',
  'discarding or saving one LUMP must not clear a similarly named LUMP draft'
);

storage.set('cm_lump_draft_old-token', 'legacy exact-token draft');
expect(
  drafts._draftLsGet('old-token') === 'legacy exact-token draft' &&
    !storage.has('cm_lump_draft_old-token'),
  'an unambiguous exact-token legacy draft must migrate to versioned storage'
);
storage.set('cm_lump_draft_ABCD', 'ambiguous legacy draft');
expect(
  drafts._draftLsGet('ABCD') === null &&
    storage.get('cm_lump_draft_ABCD') === 'ambiguous legacy draft',
  'an ambiguous legacy draft must remain recoverable without attaching to a LUMP'
);

console.log('LUMP draft restore regression: PASS');