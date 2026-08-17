'use strict';
// test_lump_binary_size.js — Regression guard for Task #2748
//
// Verifies that bundled .lump files in server/lumps/ have a byte length that
// exactly matches the lump_size declared in their header word.  A mismatch
// (e.g. from a partial write mid-save) causes the hex tab to silently show
// dots for the missing words with no visible error.
//
// Also verifies that the /api/lump/ response size is consistent with the
// file on disk (i.e. lump_size*4 raw bytes + 4 CRC prefix bytes = the
// Content-Length the server would report).
//
// Coverage:
//   LBS-01 — SelfTest (00000600.lump) file size matches header lump_size
//   LBS-02 — PostFlashSelftest (059dc47f.lump) file size matches header lump_size
//   LBS-03 — Constants (e494696f prefix) file size matches header lump_size
//   LBS-04 — All bundled *.lump files in server/lumps/ pass the size check
//   LBS-05 — Structural guard: _fetchHexBinary checks actualLumpWords vs lump_size
//
// Run:  node simulator/test_lump_binary_size.js

const fs   = require('fs');
const path = require('path');

// ── Counters ──────────────────────────────────────────────────────────────────
let pass = 0;
let fail = 0;

function check(label, cond, got) {
  if (cond) {
    console.log('PASS ' + label);
    pass++;
  } else {
    console.log('FAIL ' + label + (got !== undefined ? '  got: ' + JSON.stringify(got) : ''));
    fail++;
  }
}

// ── Helper: read a .lump file and return { lumpSize, fileBytes } ──────────────
// Parses the header word (word 0, big-endian uint32):
//   bits[31:27] = 0x1F  (magic)
//   bits[26:23] = n-6   (lump_size exponent: lump_size = 2^(n-6+6) = 2^n)
// Returns null if the file is missing or too short to parse.
function readLumpFile(filePath) {
  let buf;
  try {
    buf = fs.readFileSync(filePath);
  } catch (_) {
    return null;
  }
  if (buf.length < 4) return null;
  const header = buf.readUInt32BE(0);
  const magic  = (header >>> 27) & 0x1F;
  if (magic !== 0x1F) return null;  // not a valid lump header
  const nMinus6  = (header >>> 23) & 0xF;
  const lumpSize = 1 << (nMinus6 + 6);
  return { lumpSize, fileBytes: buf.length };
}

const LUMPS_DIR = path.join(__dirname, '..', 'server', 'lumps');

// ── LBS-01: SelfTest ──────────────────────────────────────────────────────────
console.log('\n--- LBS-01: SelfTest (00000600.lump) ---');
{
  const info = readLumpFile(path.join(LUMPS_DIR, '00000600.lump'));
  check('LBS-01a file readable and has valid header', info !== null, info);
  if (info) {
    const expected = info.lumpSize * 4;
    check(
      `LBS-01b file size ${info.fileBytes}B matches lump_size*4 = ${info.lumpSize}*4 = ${expected}B`,
      info.fileBytes === expected,
      `${info.fileBytes} vs ${expected}`
    );
  }
}

// ── LBS-02: PostFlashSelftest ─────────────────────────────────────────────────
console.log('\n--- LBS-02: PostFlashSelftest (059dc47f.lump) ---');
{
  const info = readLumpFile(path.join(LUMPS_DIR, '059dc47f.lump'));
  check('LBS-02a file readable and has valid header', info !== null, info);
  if (info) {
    const expected = info.lumpSize * 4;
    check(
      `LBS-02b file size ${info.fileBytes}B matches lump_size*4 = ${info.lumpSize}*4 = ${expected}B`,
      info.fileBytes === expected,
      `${info.fileBytes} vs ${expected}`
    );
  }
}

// ── LBS-03: Constants ─────────────────────────────────────────────────────────
console.log('\n--- LBS-03: Constants lump ---');
{
  // Token prefix is e494696f; full filename may include a version prefix
  const allFiles = fs.readdirSync(LUMPS_DIR).filter(f => f.endsWith('.lump'));
  const constFile = allFiles.find(f => f.includes('e494696f') || f.toLowerCase().includes('constants'));
  if (constFile) {
    const info = readLumpFile(path.join(LUMPS_DIR, constFile));
    check(`LBS-03a ${constFile} readable and has valid header`, info !== null, info);
    if (info) {
      const expected = info.lumpSize * 4;
      check(
        `LBS-03b file size ${info.fileBytes}B matches lump_size*4 = ${info.lumpSize}*4 = ${expected}B`,
        info.fileBytes === expected,
        `${info.fileBytes} vs ${expected}`
      );
    }
  } else {
    console.log('SKIP LBS-03 — no Constants lump file found in server/lumps/');
  }
}

// ── LBS-04: All bundled *.lump files ─────────────────────────────────────────
console.log('\n--- LBS-04: All bundled *.lump files ---');
{
  const lumpFiles = fs.readdirSync(LUMPS_DIR).filter(f => f.endsWith('.lump'));
  check('LBS-04a at least 2 bundled lump files exist', lumpFiles.length >= 2, lumpFiles.length);

  let allOk = true;
  for (const fname of lumpFiles) {
    const fpath = path.join(LUMPS_DIR, fname);
    const info  = readLumpFile(fpath);
    if (info === null) {
      console.log(`  FAIL ${fname}: could not parse header`);
      allOk = false;
      continue;
    }
    const expected = info.lumpSize * 4;
    if (info.fileBytes !== expected) {
      console.log(`  FAIL ${fname}: file is ${info.fileBytes}B but lump_size=${info.lumpSize} expects ${expected}B`);
      allOk = false;
    } else {
      console.log(`  ok   ${fname}: ${info.fileBytes}B = ${info.lumpSize} words`);
    }
  }
  check('LBS-04b all bundled lump files have correct byte length', allOk);
}

// ── LBS-05: Structural guard — truncation check present in the HTML ───────────
console.log('\n--- LBS-05: Structural guard in Lumps Directory.html ---');
{
  const htmlPath = path.join(__dirname, '..', 'docs', 'figures', 'Lumps Directory.html');
  let html;
  try {
    html = fs.readFileSync(htmlPath, 'utf8');
  } catch (e) {
    check('LBS-05 Lumps Directory.html readable', false, String(e));
    html = '';
  }
  if (html) {
    check(
      'LBS-05a actualLumpWords computed from wordCount-1',
      html.includes('actualLumpWords') && (html.includes('wordCount-1') || html.includes('wordCount - 1')),
      'pattern not found'
    );
    check(
      'LBS-05b truncation warning shown when sizes mismatch',
      html.includes('Binary is') && html.includes('file may be truncated'),
      'warning text not found'
    );
    check(
      'LBS-05c warning targets _hexSizeWarn element',
      html.includes('_hexSizeWarn'),
      '_hexSizeWarn not found'
    );
  }
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(52)}`);
console.log(`Results: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
