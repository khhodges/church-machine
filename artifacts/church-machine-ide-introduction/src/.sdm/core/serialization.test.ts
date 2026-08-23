import { test } from 'node:test';
import assert from 'node:assert/strict';

import { decodeSlideDocumentText } from './serialization.js';

// Minimal valid slide document YAML
const VALID_YAML = `\
format: replit.sdm
version: 1
size:
  width: 1920
  height: 1080
background:
  kind: none
elements: []`;

test('decodeSlideDocumentText — valid YAML returns ok with parsed document', () => {
  const result = decodeSlideDocumentText(VALID_YAML);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.document.format, 'replit.sdm');
  assert.equal(result.document.version, 1);
  assert.deepEqual(result.document.size, { width: 1920, height: 1080 });
  assert.deepEqual(result.document.elements, []);
});

test('decodeSlideDocumentText — invalid YAML syntax returns syntax failure', () => {
  // Unclosed flow sequence is a definitive YAML syntax error
  const result = decodeSlideDocumentText('key: [unclosed');
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, 'syntax');
  assert.ok(result.message.length > 0, 'message should be non-empty');
});

test('decodeSlideDocumentText — unsupported version returns unsupportedVersion failure', () => {
  const yaml = `\
format: replit.sdm
version: 999
size:
  width: 1920
  height: 1080
background:
  kind: none
elements: []`;
  const result = decodeSlideDocumentText(yaml);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, 'unsupportedVersion');
  if (result.reason === 'unsupportedVersion') {
    assert.equal(result.version, 999);
  }
});

test('decodeSlideDocumentText — schema-invalid document returns invalid failure with issues', () => {
  // size.width: 0 violates exclusiveMinimum: 0
  const yaml = `\
format: replit.sdm
version: 1
size:
  width: 0
  height: 1080
background:
  kind: none
elements: []`;
  const result = decodeSlideDocumentText(yaml);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, 'invalid');
  if (result.reason === 'invalid') {
    assert.ok(result.issues.length > 0, 'should report at least one issue');
    const widthIssue = result.issues.find((i) => i.path.includes('width'));
    assert.ok(widthIssue !== undefined, 'should include an issue at the width path');
  }
});
