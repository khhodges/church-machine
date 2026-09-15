#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { checkCacheKeys, updateCacheKeys } = require('./check_assembler_browser_freshness.js');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'browser-freshness-'));
const tag = url => `<script src="${url}"></script>`;
try {
    fs.mkdirSync(path.join(root, 'simulator'));
    fs.mkdirSync(path.join(root, 'scripts'));
    fs.writeFileSync(path.join(root, 'simulator', 'demo.js'), 'window.demo = 1;');
    fs.copyFileSync(__dirname + '/check_assembler_browser_freshness.js',
        path.join(root, 'scripts', 'check_assembler_browser_freshness.js'));
    for (const prefix of ['demo.js', '/simulator/demo.js']) {
        for (const value of ['1', '', 'sha256-invalid', 'sha256-000000000000']) {
            const input = tag(`${prefix}?v=${value}`);
            assert.ok(checkCacheKeys(input, root).failures.length);
            const result = updateCacheKeys(input, root);
            assert.equal(result.updatedCount, 1);
            assert.deepEqual(checkCacheKeys(result.updatedIndex, root).failures, []);
            assert.equal(updateCacheKeys(result.updatedIndex, root).updatedCount, 0);
        }
    }
    for (const url of ['demo.js', 'https://cdn.example/demo.js?v=1', '//cdn.example/demo.js?v=1']) {
        assert.equal(updateCacheKeys(tag(url), root).updatedIndex, tag(url));
    }
    for (const url of ['missing.js?v=1', '../outside.js?v=1', 'demo.js?v=1&other=2']) {
        const result = updateCacheKeys(tag(url), root);
        assert.equal(result.updatedIndex, tag(url));
        assert.ok(checkCacheKeys(result.updatedIndex, root).failures.length);
    }
    const cli = path.join(root, 'scripts', 'check_assembler_browser_freshness.js');
    const index = path.join(root, 'simulator', 'index.html');
    fs.writeFileSync(index, tag('/simulator/demo.js?v=1'));
    assert.equal(spawnSync(process.execPath, [cli, '--update']).status, 0);
    assert.equal(spawnSync(process.execPath, [cli]).status, 0);
    fs.writeFileSync(index, tag('missing.js?v=1'));
    const failure = spawnSync(process.execPath, [cli, '--update'], { encoding: 'utf8' });
    assert.equal(failure.status, 1);
    assert.match(failure.stderr, /could not be updated/);
    assert.equal(spawnSync(process.execPath, [cli, '--help']).status, 0);
    console.log('PASS browser freshness: normalization, root paths, idempotence, exclusions, fail-closed CLI');
} finally {
    fs.rmSync(root, { recursive: true, force: true });
}