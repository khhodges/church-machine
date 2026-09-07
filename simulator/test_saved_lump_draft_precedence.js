'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const source = fs.readFileSync(path.join(__dirname, 'app-lumps.js'), 'utf8');
const branchStart = source.indexOf('if (_hasDraft) {', source.indexOf('async function openLumpInEditor'));
const branchEnd = source.indexOf('} else {', branchStart);
assert(branchStart >= 0 && branchEnd > branchStart, 'saved-LUMP draft branch exists');
const branch = source.slice(branchStart, branchEnd);

const savedSourcePos = branch.indexOf('_setSavedLumpEditorSource(_recoveredSource)');
const draftSourcePos = branch.indexOf('_setSavedLumpEditorSource(_savedDraft)');
assert(savedSourcePos >= 0, 'latest saved source is loaded when a draft exists');
assert(draftSourcePos > savedSourcePos,
    'draft is loaded only later from the explicit Restore Draft action');
assert(branch.includes('The editor is showing the latest saved LUMP source'),
    'banner explains which version is currently editable');
assert(branch.includes('id="_lumpDraftBannerRestore"'),
    'draft remains recoverable without silently taking precedence');

console.log('PASS saved LUMP source takes precedence over a stale browser draft');