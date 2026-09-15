#!/usr/bin/env node
'use strict';

const assert = require('assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { checkCacheKeys, updateCacheKeys } = require('./check_assembler_browser_freshness');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'browser-freshness-'));
const tag = url => `<script src="${url}"></script>`;
try {
    fs.mkdirSync(path.join(root, 'simulator'));
    fs.mkdirSync(path.join(root, 'scripts'));
    const source = 'window.fixture = true;\n';
    fs.writeFileSync(path.join(root, 'simulator', 'fixture.js'), source);
    const key = crypto.createHash('sha256').update(source).digest('hex').slice(0, 12);
    const fresh = tag(`fixture.js?v=sha256-${key}`);
    assert.deepEqual(checkCacheKeys(fresh, root), { count: 1, failures: [] });
    assert.equal(updateCacheKeys(fresh, root).updatedCount, 0);

    for (const prefix of ['', '/simulator/', './']) {
        for (const pin of ['1', '', 'sha256-INVALID', 'sha256-000000000000']) {
            const original = tag(`${prefix}fixture.js?v=${pin}`);
            assert.equal(checkCacheKeys(original, root).failures.length, 1);
            const result = updateCacheKeys(original, root);
            assert.equal(result.updatedIndex, tag(`${prefix}fixture.js?v=sha256-${key}`));
            assert.equal(result.updatedCount, 1);
            assert.deepEqual(result.failures, []);
            assert.equal(updateCacheKeys(result.updatedIndex, root).updatedCount, 0);
        }
    }

    const preserved = [
        'https://cdn.example/app.js?v=1', 'http://cdn.example/app.js?v=1',
        '//cdn.example/app.js?v=1', 'data:text/javascript,void(0)?v=1',
        'fixture.js',
    ].map(tag).join('\n');
    assert.equal(updateCacheKeys(fresh + preserved, root).updatedIndex, fresh + preserved);
    assert.deepEqual(checkCacheKeys(fresh + preserved, root).failures, []);

    for (const url of [
        'missing.js?v=1', 'fixture.js?v=1&mode=debug',
        'fixture.js?mode=debug&v=1', 'fixture.js?v=1#fragment',
        '../outside.js?v=sha256-000000000000',
        '/elsewhere/fixture.js?v=sha256-000000000000',
    ]) {
        const input = fresh + tag(url);
        const result = updateCacheKeys(input, root);
        assert.equal(result.updatedIndex, input);
        assert.equal(result.failures.length, 1, url);
    }

    // Exercise the actual CLI against private fixtures, never the live index.
    const cli = path.join(root, 'scripts', 'check_assembler_browser_freshness.js');
    fs.copyFileSync(path.join(__dirname, 'check_assembler_browser_freshness.js'), cli);
    const index = path.join(root, 'simulator', 'index.html');
    fs.writeFileSync(index, tag('/simulator/fixture.js?v=1'));
    let run = spawnSync(process.execPath, [cli, '--update'], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /1 pinned first-party browser script cache keys are fresh/);
    fs.appendFileSync(index, tag('missing.js?v=1'));
    run = spawnSync(process.execPath, [cli, '--update'], { encoding: 'utf8' });
    assert.equal(run.status, 1);
    assert.match(run.stderr, /missing\.js/);
    assert.doesNotMatch(run.stdout, /are fresh/);
    console.log('Browser script freshness regression tests passed');
} finally {
    fs.rmSync(root, { recursive: true, force: true });
}