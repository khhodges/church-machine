#!/usr/bin/env node
/**
 * Builds the browser-facing What's New feed from the newest dated CHANGELOG
 * entries. Run with --write after editing release history, and use --check in
 * CI to reject a stale or missing generated feed.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CHANGELOG_PATH = path.join(ROOT, 'CHANGELOG.md');
const OUTPUT_PATH = path.join(ROOT, 'simulator', 'whats-new-feed.js');

function escapeHtml(value) {
    return value.replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function renderInlineMarkdown(value) {
    return escapeHtml(value)
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}

function firstParagraph(body) {
    const lines = body.split(/\r?\n/);
    const start = lines.findIndex(line => line.trim() && line.trim() !== '---');
    if (start < 0) return '';

    const paragraph = [];
    for (let i = start; i < lines.length && lines[i].trim(); i += 1) {
        paragraph.push(lines[i].trim());
    }
    return paragraph.join(' ').replace(/\s+/g, ' ').trim();
}

function parseLatestRelease(changelog) {
    const headingPattern = /^##\s+(.+?)\s+\((\d{4}-\d{2}-\d{2})\)\s*$/gm;
    const headings = [];
    let match;
    while ((match = headingPattern.exec(changelog)) !== null) {
        headings.push({
            title: match[1].trim(),
            version: match[2],
            start: match.index + match[0].length,
            headingStart: match.index
        });
    }

    if (headings.length === 0) {
        throw new Error('CHANGELOG.md has no dated level-two release headings.');
    }

    const version = headings.reduce((latest, entry) =>
        entry.version > latest ? entry.version : latest, headings[0].version);
    const entries = headings.filter(entry => entry.version === version).map((entry, index, all) => {
        const nextHeading = headings.find(heading => heading.headingStart > entry.headingStart);
        const end = nextHeading ? nextHeading.headingStart : changelog.length;
        const summary = firstParagraph(changelog.slice(entry.start, end));
        if (!summary) {
            throw new Error(`Latest release entry "${entry.title}" (${version}) has no summary paragraph.`);
        }
        return {
            title: entry.title,
            html: `<div style="font-weight:700;color:var(--church-gold);font-size:1.05rem;margin-bottom:0.75rem;">${renderInlineMarkdown(entry.title)}</div>` +
                `<p style="font-size:0.9rem;line-height:1.65;margin:0;">${renderInlineMarkdown(summary)}</p>`
        };
    });

    if (entries.length === 0) {
        throw new Error(`CHANGELOG.md has no entries for latest release ${version}.`);
    }

    return { version, features: entries };
}

function generateFeedSource(release) {
    const features = JSON.stringify(release.features, null, 4);
    return `// Generated from CHANGELOG.md by scripts/sync-whats-new.js. Do not edit directly.\n` +
        `// Run: node scripts/sync-whats-new.js --write\n` +
        `window.CHURCH_WHATS_NEW_RELEASE = Object.freeze({\n` +
        `    version: ${JSON.stringify(release.version)},\n` +
        `    features: Object.freeze(${features})\n` +
        `});\n`;
}

function sync({ check }) {
    const release = parseLatestRelease(fs.readFileSync(CHANGELOG_PATH, 'utf8'));
    const generated = generateFeedSource(release);

    if (check) {
        if (!fs.existsSync(OUTPUT_PATH)) {
            throw new Error('simulator/whats-new-feed.js is missing. Run: node scripts/sync-whats-new.js --write');
        }
        if (fs.readFileSync(OUTPUT_PATH, 'utf8') !== generated) {
            throw new Error('simulator/whats-new-feed.js is stale. Run: node scripts/sync-whats-new.js --write');
        }
        console.log(`What's New feed is current for ${release.version} (${release.features.length} entries).`);
        return;
    }

    fs.writeFileSync(OUTPUT_PATH, generated);
    console.log(`Wrote simulator/whats-new-feed.js for ${release.version} (${release.features.length} entries).`);
}

if (require.main === module) {
    const args = new Set(process.argv.slice(2));
    if (args.size !== 1 || (!args.has('--check') && !args.has('--write'))) {
        console.error('Usage: node scripts/sync-whats-new.js --check|--write');
        process.exit(1);
    }
    try {
        sync({ check: args.has('--check') });
    } catch (error) {
        console.error(`What's New feed check failed: ${error.message}`);
        process.exit(1);
    }
}

module.exports = { firstParagraph, generateFeedSource, parseLatestRelease, sync };