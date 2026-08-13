---
name: Dot pet name identity architecture
description: How LUMP identity, correctness, and ownership are encoded — petname.Abstraction#n, two independent seals, self Inform GT at c-list row 0
---

# Dot Pet Name Identity Architecture

## The design (from session documents)

**Global identity lives in the dot pet name**, not in the GT or NS slot:
- GT is local, transient, 32-bit, meaningful only on one machine — never an identity carrier
- The stable cross-machine identity is `petname.Abstraction#n`
- `petname` = programmer or org's hierarchical identity (`ken`, `ibm.research.ai`)
- `Abstraction` = the short abstraction name
- `#n` = issue number (which specific valid issuance — acts as serial number)

**Two independent seals:**
1. `identity_hash = sha256(petname.Abstraction#n)` — covers identity string ONLY, not binary bytes. Public, secretless, static. Proves "this is the genuine issue #7 of ken.SelfTest." Anyone can verify without authority.
2. `binary_hash = sha256(binary bytes)` — content fingerprint. Proves the bytes haven't changed since compile time.
3. Passkey/acid-test — separate ownership check (dynamic, secret-based) — NOT yet implemented.

**Why**:  keeping them independent is structurally required. Making integrity require the secret breaks public verifiability. Making ownership derivable from the static artifact breaks copy-resistance.

## Self Inform GT at c-list row 0

By convention, c-list row 0 of every LUMP binary is the **self Inform GT**:
- v2.0 GT layout: `bits[31:28]=0b0000, bits[27]=1 (dom=Church), bits[26:25]=0b01 (Inform), bits[24:0]=low 25 bits of identity_hash`
- Constant upper mask: `0x0A000000`
- Formula: `self_gt = 0x0A000000 | (int(identity_hash[:8], 16) & 0x1FFFFFF)`
- Written by `save_lump()` server-side into `words[lumpSize - cc]` (c-list row 0)
- If cc==0, bumped to 1 and the padding zone word is used

## What changed in the codebase

**`server/app.py` — `save_lump()`**:
- Reads `petname` and `issue_number` from POST metadata
- Computes `identity_string` and `identity_hash`
- Injects self Inform GT into c-list row 0 before writing binary
- Stores `petname`, `issue_number`, `identity_string`, `identity_hash` in sidecar + manifest

**`server/app.py` — `get_lump_words()`**:
- Returns all four identity fields alongside `binary_hash`

**`simulator/app-lumps.js` — proof bar**:
- "Identity" chip shows `petname.Abstraction#n` with truncated identity_hash seal
- "Content" chip shows binary_hash with ✓/✗/— verification
- Tooltips explain the two-seal architecture

**`simulator/app-compile.js`**:
- Reads `church_petname` and `church_issue_number` from localStorage, sends in save payload

## How programmer sets their petname

`localStorage.setItem('church_petname', 'ken')` — or `church_issue_number` for issue.
No UI yet; set manually in browser console. SelfTest sidecar backfilled with `petname=""`, `identity_string="SelfTest#1"`.

## Open: hardware resolution
The self GT bits[24:0] are an identity fingerprint. The hardware resolution path (how the CM uses this GT to verify on CALL) is not yet specified. The IDE-side proof bar works entirely in Python/JS without hardware involvement.
