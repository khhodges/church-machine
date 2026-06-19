# CLOOMC Compile API

**`POST /api/compile`**

Compiles CLOOMC source text (any supported front-end language) into a ready-to-deploy Lump binary. The response includes both the raw 32-bit word array and a base64-encoded binary for direct download or upload.

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
| `abstraction_name` | string | no | Override the abstraction name embedded in the source. Useful when the source doesn't declare one. |
| `namespace_hint` | object | no | Hints to the Lump builder (see below). |

#### `namespace_hint` sub-fields

| Field | Type | Default | Description |
|---|---|---|---|
| `gt_type` | string | `"inform"` | Golden Token type for the allocated Lump. |
| `allocation_words` | integer | next power-of-2 ≥ code size | Total Lump size in 32-bit words. Must be a power of two and large enough to hold the compiled code + header. |
| `clist_slots` | integer | derived from source | Number of C-List slots to reserve. |

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
  "abstraction_name": "Add42",
  "namespace_hint": {
    "gt_type": "inform",
    "allocation_words": 64
  }
}
```

---

## Response

**HTTP status is always 200.** Check the `ok` field in the JSON body to distinguish success from failure.

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
| `ok` | `true` | Compile succeeded. |
| `language` | string | The language that was detected or used. |
| `words` | number[] | The complete Lump binary as an array of unsigned 32-bit integers (big-endian word order). `words[0]` is the Lump header word encoding `cw` (code words) and `cc` (C-List slots). |
| `lump_binary` | string | Base64-encoded form of the same binary. `base64decode(lump_binary)` equals `words` packed as big-endian uint32s. Size is always `len(words) * 4` bytes. |
| `warnings` | string[] | Soft warnings — typically lazy-resolve notices for symbols not yet in the namespace. Empty when none. A non-empty list does **not** mean the compile failed; the Lump is valid and ready to deploy. |

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

- `simulator/compile_worker.js` — the Node.js subprocess that runs the compiler
- `server/compile_api.py` — Python wrapper that spawns the worker
- `simulator/cloomc_compiler.js` — the multi-language CLOOMC++ compiler
- `simulator/assembler.js` — the CLOOMC assembly assembler
- `simulator/lump_builder.js` — packs compiler output into the binary Lump format
- `tests/server/test_compile_api.py` — full test suite (24 tests + 1 xfail)
