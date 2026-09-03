const fs = require('fs');
const path = require('path');

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
    source.includes('if (ta.value !== text) _draftLsSet(tk, ta.value);'),
  'discard must clear both draft stores and opening alone must not create a draft'
);
expect(
  index.includes('app-lumps.js?v=20260903-draft-context1'),
  'the editor must request the corrected draft script'
);

console.log('LUMP draft restore regression: PASS');