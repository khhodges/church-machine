#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { generateFeedSource, parseLatestRelease } = require('./sync-whats-new.js');

const history = `# History

## Older release (2026-07-09)

This summary must not appear in the current feed.

## First current release (2026-07-10)

The first current summary includes \`code\` and **emphasis**.

## Second current release (2026-07-10)

The second current summary.
`;

const release = parseLatestRelease(history);
assert.strictEqual(release.version, '2026-07-10');
assert.deepStrictEqual(release.features.map(feature => feature.title), [
    'First current release',
    'Second current release'
]);
assert.match(release.features[0].html, /<code>code<\/code>/);
assert.match(release.features[0].html, /<strong>emphasis<\/strong>/);
assert.match(generateFeedSource(release), /window\.CHURCH_WHATS_NEW_RELEASE/);
assert.throws(
    () => parseLatestRelease('## Missing summary (2026-07-10)\n'),
    /has no summary paragraph/
);

const root = path.resolve(__dirname, '..');
const feedSource = fs.readFileSync(path.join(root, 'simulator', 'whats-new-feed.js'), 'utf8');
const browser = { window: {} };
vm.runInNewContext(feedSource, browser);
assert.ok(Array.isArray(browser.window.CHURCH_WHATS_NEW_RELEASE.features));
assert.ok(browser.window.CHURCH_WHATS_NEW_RELEASE.features.length > 0);

const index = fs.readFileSync(path.join(root, 'simulator', 'index.html'), 'utf8');
assert.ok(
    index.indexOf('src="whats-new-feed.js') < index.indexOf('src="app-run.js'),
    'the generated feed must load before app-run.js'
);

const appRun = fs.readFileSync(path.join(root, 'simulator', 'app-run.js'), 'utf8');
assert.match(appRun, /const WHATS_NEW_VERSION = WHATS_NEW_RELEASE\.version;/);
assert.match(appRun, /localStorage\.setItem\('church_whatsnew_dismissed_perm', '1'\)/);
assert.match(appRun, /localStorage\.setItem\('church_whatsnew_version', WHATS_NEW_VERSION\)/);

console.log('sync-whats-new parser tests passed');