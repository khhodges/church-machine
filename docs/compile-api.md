# CLOOMC Compile API

**`POST /api/compile`**

Compiles CLOOMC source text into an **unsaved standalone LUMP candidate**. The
response includes the word array and the same bytes encoded as base64.
Compilation does not install an artifact or assign a Namespace slot.

## Standalone output requirement

The [Standalone Compiler Output Contract](CM_LUMP_SPECIFICATION.md#standalone-compiler-output-contract)
is normative. Output must preserve declared capability PetNames, immutable
identity references, authored rights, and local C-list row order without relying
on the compiling machine's Namespace. References need not be installed locally.
Save and Export preserve the artifact; destination resolution is separate.
Capabilities retain PetName and ID through INFORM/OUTSFORM transitions.
LUMPs missing PetNames require **programmer recompilation**, not automatic repair.

**Implementation status:** the pre-save CLOOMC candidate path now derives
capability metadata from authenticated binary definitions, without destination
materialization or live Namespace validation. Other frontend/save/activation
paths still need end-to-end conformance checks. Zero numeric placeholders do
not establish standalone conformance. A successful HTTP
response or structural audit alone is not proof that every required identity
reference was preserved. See the contract's conformance checks.

---

## Authentication

Authentication is optional. If the server was started with the `COMPILE_API_TOKEN` secret set, every request must carry the token either as a header or a query parameter.

| Method | Example |
|---|---|
| `Authorization` header | `Authorization: Bearer <token>` |
| Query string | `?token=<token>` |

Without a valid token the server returns **HTTP 401**. When `COMPILE_API_TOKEN` is unset (the default), the endpoint is open to all callers.

---

## Request

**Method:** `POST`  
**Path:** `/api/compile`  
**Content-Type:** `application/json`

### Fields

| Field | Type | Required | Description |
|---|---|---|---|
| `source` | string | **yes** | Raw source text. Must be non-empty. |
| `language` | string | no | Front-end language hint. Auto-detected from source when omitted or empty. Must be one of the six canonical values if supplied (see below). |
| `abstraction_name` | string | no | Legacy field; do not rely on it to supply missing PetNames. The current worker does not implement this override. |
| `namespace_hint` | object | no | Legacy-named packing hints only; not a Namespace assignment or a source of capability identity. |

#### `namespace_hint` sub-fields

| Field | Type | Default | Description |
|---|---|---|---|
| `allocation_words` | integer | derived from complete emitted content | Packing-size hint. The complete allocation must fit header, dispatch/code, embedded content, and C-list. It is not a memory address. |

Historical `gt_type` and nested `clist_slots` fields must not be interpreted as
establishing an INFORM capability or a destination slot; the current worker does
not use them to assign authority. The C-list comes from compiler declarations.

### Supported languages

| `language` value | Front-end | Notes |
|---|---|---|
| `"assembly"` | CLOOMC assembly | Direct instruction mnemonics (IADD, CALL, HALT, …) |
| `"english"` | English CLOOMC++ | Natural-language abstraction syntax |
| `"javascript"` | JS CLOOMC++ | JavaScript-style abstraction syntax |
| `"haskell"` | Haskell CLOOMC++ | Haskell-style method syntax |
| `"symbolic"` | Symbolic Math (Ada) | Pure-math / Ada-style let-bindings |
| `"lambda"` | Lambda Calculus | λ-expression front-end |

When `language` is omitted the compiler runs all detectors and picks the best match automatically. An explicitly supplied value that is not one of the six above is rejected with **HTTP 400**.

### Example request

```json
{
  "source": "IADD DR1, DR0, #42\nHALT\n",
  "language": "assembly",
  "namespace_hint": {
    "allocation_words": 64
  }
}
```

---

## Response

Compiler results normally use HTTP 200; request, authorization, and service
failures can return other statuses. Check both HTTP status and the JSON `ok` field.

### Success (`ok: true`)

```json
{
  "ok":          true,
  "language":    "assembly",
  "words":       [2164260864, 0, 0, …],
  "lump_binary": "CAABAAAA…",
  "warnings":    []
}
```

| Field | Type | Description |
|---|---|---|
| `ok` | `true` | The compiler reports success for this candidate; see the standalone requirement and implementation-gap notice above. |
| `language` | string | The language that was detected or used. |
| `words` | number[] | The complete Lump binary as an array of unsigned 32-bit integers (big-endian word order). `words[0]` is the Lump header word encoding `cw` (code words) and `cc` (C-List slots). |
| `lump_binary` | string | Base64-encoded form of the same binary. `base64decode(lump_binary)` equals `words` packed as big-endian uint32s. Size is always `len(words) * 4` bytes. |
| `warnings` | array | Compiler diagnostics; entries may be structured objects. Neither an empty list nor `ok: true` establishes destination binding, installation, hardware certification, or execution success. |
| `verified_references` | array | Per-row exact reference evidence (`row`, `N`, `T`, `binary_hash`, `identity_hash`) checked against actual target bytes and canonical identity before compiler attestation. An empty array does not mean name-only references have been verified. |

Pinned reference verification is rechecked even when compilation is cached.
A missing, ambiguous, altered, or identity-mismatched target produces `ok: false`
with `unchanged_data: true`, without returning an attested candidate or selecting
another revision. It supports active records and exact hash-indexed canonical
archives, including standard `_vN` archive filenames backed by the original
hash-bound identity evidence. Archived bootstrap runtime-GT identities and
unindexed history files remain unsupported. Historical bytes and approval
records are never changed. It never requires Namespace assignment.

Reference failures include `reference_verification: {status, reason}` with status
`failed` or `unsupported`. The pre-save console renders this separately from a
server connection failure and retains the previous candidate.
Successful CLOOMC candidate reports label each external row VERIFIED, SYMBOLIC,
or UNVERIFIED. VERIFIED requires one exact matching row/name/token/hash evidence
record from the compile response and unchanged candidate words. Missing evidence
is never treated as verification; SELF and an empty external-reference list do
not claim external identity verification. These labels are presentation only and
are not embedded in, or used to rewrite, the LUMP bytes.

SYMBOLIC is a valid programmer-declared PetName, not an incomplete or invalid
capability. It may refer to an idea whose target has not been created and might
never be created. Neither compilation nor saving requires that target to exist.
Explicit identity/hash claims are checked when supplied; they are not required
for every symbolic declaration. Runtime use still requires the appropriate
authority. This differs from inventing a name for the containing abstraction.

Pre-save reports must label this result **UNSAVED COMPILE CANDIDATE**, display
declared capability PetNames and local row numbers, and distinguish embedded
API/source from unused space. They must not print inferred `NS[...]` assignments,
conflate an abstraction-owner setting with declaration PetNames, or claim that
Save/Export installs the artifact. Zero numeric rows must not be described as
destroyed identities or as proof that names are missing; inspect the full binary.

Abstraction names must be explicitly declared. CLOOMC/JavaScript, Symbolic,
Lambda and Haskell use their `abstraction Name` syntax; English accepts its
explicit abstraction declaration (for example, `Create an abstraction called Name`).
Assembly and IDX1 require `; @abstraction Name` or `; Abstraction: Name`.
Method names, arbitrary comments, labels and disassembly location headers do not
declare an abstraction identity. Missing declarations fail compilation without
rewriting source or producing a candidate. Names such as `Assembly`, `Symbolic`,
`English`, or `LocalIDX1` remain valid when explicitly declared.

#### Decoding `words[0]` — the Lump header

```
bits 22..10  →  cw  (code-word count, 13 bits)
bits  7..0   →  cc  (C-List slot count, 8 bits)
```

```python
header = words[0]
cw = (header >> 10) & 0x1FFF
cc =  header        & 0xFF
```

### Failure (`ok: false`)

```json
{
  "ok":       false,
  "language": "assembly",
  "error":    "Line 3: unknown mnemonic BADOP"
}
```

| Field | Type | Description |
|---|---|---|
| `ok` | `false` | Compile failed. |
| `language` | string | The language detected or supplied. Empty string (`""`) when the request itself was malformed. |
| `error` | string | Human-readable description of what went wrong. May contain multiple errors separated by `; `. |

Failure cases include: syntax errors, unknown mnemonics, type mismatches, internal compiler errors, and request timeout.

---

## HTTP error responses

These are returned **before** the compiler runs when the request itself is invalid.

| Status | Cause |
|---|---|
| 400 | `source` missing or empty |
| 400 | `language` supplied but not one of the six valid values |
| 400 | Request body is not valid JSON or `Content-Type` is not `application/json` |
| 401 | `COMPILE_API_TOKEN` is set on the server and the supplied token is wrong or absent |

---

## Examples

The short assembly examples below demonstrate transport and instruction
compilation only. They do not by themselves demonstrate the complete PetName/ID
contract. Do not treat an unnamed example candidate as a conforming standalone
artifact; the programmer must supply the required declarations and recompile.

### curl

```bash
curl -s -X POST https://lab.cloomc.org/api/compile \
  -H 'Content-Type: application/json' \
  -d '{
    "source": "IADD DR1, DR0, #42\nHALT\n",
    "language": "assembly"
  }' | python3 -m json.tool
```

With authentication:

```bash
curl -s -X POST https://lab.cloomc.org/api/compile \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer my-token' \
  -d '{"source": "IADD DR1, DR0, #1\nHALT\n", "language": "assembly"}'
```

### Python

```python
import requests, base64, struct

resp = requests.post("https://lab.cloomc.org/api/compile", json={
    "source":   "IADD DR1, DR0, #42\nHALT\n",
    "language": "assembly",
})
data = resp.json()

if data["ok"]:
    words  = data["words"]           # list of uint32
    binary = base64.b64decode(data["lump_binary"])
    print(f"Lump: {len(words)} words, language={data['language']}")
    print(f"Warnings: {data['warnings']}")
    # write to disk
    with open("output.lump", "wb") as f:
        f.write(binary)
else:
    print("Compile failed:", data["error"])
```

### JavaScript / Node

```javascript
const res  = await fetch("/api/compile", {
  method:  "POST",
  headers: { "Content-Type": "application/json" },
  body:    JSON.stringify({ source: "IADD DR1, DR0, #42\nHALT\n", language: "assembly" }),
});
const data = await res.json();

if (data.ok) {
  const words  = data.words;                         // Uint32Array-compatible
  const binary = Uint8Array.from(atob(data.lump_binary), c => c.charCodeAt(0));
  console.log(`Lump: ${words.length} words, lang=${data.language}`);
  if (data.warnings.length) console.warn("Warnings:", data.warnings);
} else {
  console.error("Compile error:", data.error);
}
```

### Auto-detecting the language

Omit `language` entirely — the compiler runs all six detectors and picks the best fit:

```json
{
  "source": "abstraction Counter {\n  method Increment { DR0 += 1; return DR0 }\n}"
}
```

---

## Timeout

The compiler subprocess is given **30 seconds**. If it exceeds that, the response is:

```json
{
  "ok":       false,
  "language": "",
  "error":    "Compile timed out after 30s — reduce source complexity or try again"
}
```

---

## Related

- `server/compile_worker.js` — the Node.js subprocess that runs the compiler
- `server/compile_api.py` — Python wrapper that spawns the worker
- `simulator/cloomc_compiler.js` — the multi-language CLOOMC++ compiler
- `simulator/assembler.js` — the CLOOMC assembly assembler
- `simulator/lump_builder.js` — packs compiler output into the binary Lump format
- `tests/server/test_compile_api.py` — compile API regression tests; not evidence that all standalone requirements are implemented
