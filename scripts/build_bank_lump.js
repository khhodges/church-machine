#!/usr/bin/env node
'use strict';

/**
 * Build the canonical dynamic Bank LUMP.
 *
 * Bank's executable custody policy is compiled from bank.cloomc, while the
 * browser/system binding remains the only implementation allowed to mint
 * proofs, allocate private backing storage, or issue a live lockbox authority.
 * This script publishes only the static, self-defining LUMP identity.
 *
 * Run: node scripts/build_bank_lump.js
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const LUMPS_DIR = path.join(ROOT, 'server', 'lumps');
const MANIFEST_PATH = path.join(LUMPS_DIR, 'manifest.json');
const SOURCE_FILE = path.join(ROOT, 'simulator', 'cloomc', 'bank.cloomc');
const IDENTITY_PROJECTION_PATH = path.join(ROOT, 'simulator', 'bank_lump_identity.js');
const DOT_NAME = 'Bank';
const ISSUE_N = 1;

global.ChurchAssembler = require(path.join(ROOT, 'simulator', 'assembler.js'));
const CLOOMCCompiler = require(path.join(ROOT, 'simulator', 'cloomc_compiler.js'));
const {
    buildLump,
    buildApiDefinition,
    embedSelfDefinition,
} = require(path.join(ROOT, 'simulator', 'lump_builder.js'));

function sha256(value) {
    return crypto.createHash('sha256').update(value).digest('hex');
}

function packWords(words) {
    const out = Buffer.alloc(words.length * 4);
    words.forEach((word, index) => out.writeUInt32BE(word >>> 0, index * 4));
    return out;
}

function selfIdentityGT(identityString) {
    const hash32 = Number.parseInt(sha256(identityString).slice(0, 8), 16) >>> 0;
    return (0x0A000000 | (hash32 & 0x01FFFFFF)) >>> 0;
}

function stringifyAsciiJson(value) {
    return JSON.stringify(value, null, 2).replace(
        /[\u007f-\uffff]/g,
        char => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`,
    );
}

function buildBankArtifact() {
    const source = fs.readFileSync(SOURCE_FILE, 'utf8');
    const compiled = new CLOOMCCompiler().compile(source);
    if (compiled.errors.length) {
        throw new Error(`Bank CLOOMC compilation failed:\n${JSON.stringify(compiled.errors, null, 2)}`);
    }
    if (compiled.abstractionName !== DOT_NAME) {
        throw new Error(`Bank source compiled as ${compiled.abstractionName || '<unnamed>'}, expected ${DOT_NAME}`);
    }

    const built = buildLump(compiled, { allocationWords: 64 });
    const api = buildApiDefinition(compiled, built.words);
    const identityString = `${DOT_NAME}#${ISSUE_N}`;
    const selfGT = selfIdentityGT(identityString);

    // Row zero is compiler-owned symbolic identity, not a dynamic lockbox
    // authority. A real E-GT is minted only when Bank is installed/called.
    built.words[built.clistStart] = selfGT;
    const words = embedSelfDefinition(built.words, api, source, 2);
    const binary = packWords(words);
    const token = sha256(Buffer.concat([Buffer.from(DOT_NAME, 'utf8'), binary])).slice(0, 8);
    const filename = `${DOT_NAME}.${ISSUE_N}.${token}.lump`;
    const sidecarFile = `${DOT_NAME}.${ISSUE_N}.${token}.json`;
    const binaryHash = sha256(binary);
    const identityHash = sha256(identityString);
    const methods = api.methods;
    const runtimeBinding = {
        registry_index: 54,
        dispatch: 'SystemAbstractions',
        authority: 'proof-bound dynamic custody',
        fixed_hardware_boot_slot: false,
    };
    const permissions = {
        caller_grants: ['E'],
        c_list_row_0: {
            role: 'compiler-owned symbolic SELF identity',
            gt: `0x${selfGT.toString(16).padStart(8, '0')}`,
            live_lockbox_authority: false,
        },
    };

    const shared = {
        token,
        abstraction: DOT_NAME,
        dot_name: DOT_NAME,
        issue_n: ISSUE_N,
        ns_slot: null,
        ns_slot_policy: 'dynamic',
        boot_resident: false,
        lump_size: words.length,
        cw: built.cw,
        cc: built.cc,
        typ: 0,
        status: 'released',
        language: 'CLOOMC',
        author: 'Church Machine',
        grants: ['E'],
        methods,
        permissions,
        self_gt: selfGT,
        runtime_binding: runtimeBinding,
        filename,
        sidecar_file: sidecarFile,
        binary_hash: binaryHash,
        identity_hash: identityHash,
    };

    const sidecar = {
        ...shared,
        identity_string: identityString,
        identity_seal_location: 'c-list[0]',
        sourceStorageTier: 2,
        source_file: 'simulator/cloomc/bank.cloomc',
        source,
        compiler_language: compiled.language,
        capabilities: [{
            row: 0,
            name: 'SELF',
            rights: [],
            role: 'compiler-owned symbolic identity',
            compiler_owned: true,
        }],
        compiler_owned_self: true,
        description: 'Dynamic Namespace-backed lockbox custody service. The LUMP models lifecycle policy; the proof-bound runtime binding owns private storage, zeroization, and recovery.',
        documentation_case: 'fully_documented',
        docs: ['CM_LUMP_SPECIFICATION.md', 'golden-tokens.md'],
    };

    return {
        binary,
        sidecar,
        manifestEntry: shared,
        compiled,
        words,
        selfGT,
    };
}

function writeAtomic(filePath, data) {
    const temporary = `${filePath}.tmp`;
    fs.writeFileSync(temporary, data);
    fs.renameSync(temporary, filePath);
}

function identityProjection(artifact) {
    const entry = artifact.manifestEntry;
    return {
        dot_name: entry.dot_name,
        issue_n: entry.issue_n,
        token: entry.token,
        binary_hash: entry.binary_hash,
        identity_hash: entry.identity_hash,
        self_gt: artifact.selfGT,
        ns_slot: entry.ns_slot,
        ns_slot_policy: entry.ns_slot_policy,
        boot_resident: entry.boot_resident,
        runtime_binding: entry.runtime_binding,
    };
}

function renderIdentityProjection(artifact) {
    return `'use strict';\n` +
        `// Generated by scripts/build_bank_lump.js. Do not hand edit.\n` +
        `(function exposeBankLumpIdentity(root) {\n` +
        `    const identity = Object.freeze(${stringifyAsciiJson(identityProjection(artifact))});\n` +
        `    if (typeof module !== 'undefined' && module.exports) module.exports = identity;\n` +
        `    root.BankLumpIdentity = identity;\n` +
        `})(typeof window !== 'undefined' ? window : globalThis);\n`;
}

function writeBankArtifact() {
    const artifact = buildBankArtifact();
    const oldManifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
    const manifest = oldManifest.filter(entry =>
        entry.abstraction !== DOT_NAME && entry.dot_name !== DOT_NAME);

    const oldFiles = fs.readdirSync(LUMPS_DIR).filter(filename =>
        new RegExp(`^${DOT_NAME}\\.${ISSUE_N}\\.[0-9a-f]{8}\\.(?:lump|json)$`).test(filename));

    // Publish replacement files before atomically switching the manifest. If
    // any write fails, the prior manifest and its artifacts remain usable.
    writeAtomic(path.join(LUMPS_DIR, artifact.sidecar.filename), artifact.binary);
    writeAtomic(
        path.join(LUMPS_DIR, artifact.sidecar.sidecar_file),
        `${stringifyAsciiJson(artifact.sidecar)}\n`,
    );
    writeAtomic(IDENTITY_PROJECTION_PATH, renderIdentityProjection(artifact));
    manifest.push(artifact.manifestEntry);
    // Switch the manifest last, after every artifact and the browser/runtime
    // identity projection have been staged successfully.
    writeAtomic(MANIFEST_PATH, `${stringifyAsciiJson(manifest)}\n`);
    for (const filename of oldFiles) {
        if (filename !== artifact.sidecar.filename && filename !== artifact.sidecar.sidecar_file) {
            fs.unlinkSync(path.join(LUMPS_DIR, filename));
        }
    }
    return artifact;
}

if (require.main === module) {
    const artifact = writeBankArtifact();
    console.log(
        `${artifact.sidecar.dot_name}: ${artifact.sidecar.filename} ` +
        `(${artifact.sidecar.lump_size} words, cw=${artifact.sidecar.cw}, cc=${artifact.sidecar.cc})`,
    );
}

module.exports = {
    buildBankArtifact, identityProjection, renderIdentityProjection, selfIdentityGT, writeBankArtifact,
};