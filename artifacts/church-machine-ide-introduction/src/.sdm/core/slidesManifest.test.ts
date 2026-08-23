import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseSlidesManifest } from './slidesManifest.js';

const VALID_ENTRY = {
  id: 'intro',
  position: 1,
  filepath: 'slides/intro.sdm.yaml',
  title: 'Introduction',
  description: 'The opening slide',
};

test('parseSlidesManifest — valid manifest returns ok with normalised entries', () => {
  const result = parseSlidesManifest([VALID_ENTRY]);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0].id, 'intro');
  assert.equal(result.entries[0].title, 'Introduction');
});

test('parseSlidesManifest — valid manifest with optional fields returns ok', () => {
  const result = parseSlidesManifest([
    { ...VALID_ENTRY, kind: 'sdm', speakerNotes: 'Hello audience' },
  ]);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.entries[0].kind, 'sdm');
  assert.equal(result.entries[0].speakerNotes, 'Hello audience');
});

test('parseSlidesManifest — empty array returns ok with zero entries', () => {
  const result = parseSlidesManifest([]);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.entries.length, 0);
});

test('parseSlidesManifest — missing required title field returns failure with issues', () => {
  const { title: _omitted, ...withoutTitle } = VALID_ENTRY;
  const result = parseSlidesManifest([withoutTitle]);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(result.issues.length > 0, 'should report at least one issue');
});

test('parseSlidesManifest — blank id (whitespace-only) returns failure with issues', () => {
  const result = parseSlidesManifest([{ ...VALID_ENTRY, id: '   ' }]);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(result.issues.length > 0, 'should report at least one issue');
  const idIssue = result.issues.find((i) => i.path.includes('id'));
  assert.ok(idIssue !== undefined, 'should include an issue mentioning the id field');
});

test('parseSlidesManifest — non-array input returns failure with issues', () => {
  const result = parseSlidesManifest({ entries: [VALID_ENTRY] });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(result.issues.length > 0, 'should report at least one issue');
});

test('parseSlidesManifest — position below minimum returns failure with issues', () => {
  const result = parseSlidesManifest([{ ...VALID_ENTRY, position: 0 }]);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(result.issues.length > 0, 'should report at least one issue');
});
