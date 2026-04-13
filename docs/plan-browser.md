# Plan: Browser

## Goal

A child can browse approved web content from their Church Machine. The
parent controls which sites are reachable by placing Outform+Far GTs
in the child's c-list. No GT means no access — the hardware enforces
it. The Browser abstraction renders content on whatever display device
is connected (UART terminal, LCD, or IDE simulator).

## New Abstractions

### Browser (NS slot 37)

**Methods**: Navigate, Back, Bookmark, Search

| Method | Description |
|--------|-------------|
| **Navigate(site_GT)** | Fetch and render the resource identified by the Outform GT. Opens a Tunnel, sends an HTTP GET, parses the response, renders to display. |
| **Back** | Return to the previous page. Maintains a history stack (bounded, GT-gated). |
| **Bookmark(site_GT, name)** | Save a site GT with a human-readable label into a bookmark c-list. |
| **Search(query_GT, terms)** | Send a search query through an approved search engine GT. Returns results as a list of navigable GTs. |

**Capability requirements**: Browser holds GTs for Tunnel (E),
HTTP (E), Renderer (E), Display (W), and its own bookmark storage
via Memory (R/W).

### HTTP (NS slot 38 — replaces Messenger in the current spec)

**Methods**: Request, ParseResponse, ParseHeaders

| Method | Description |
|--------|-------------|
| **Request(method, path, headers)** | Build an HTTP/1.1 request string. Methods: GET, POST, HEAD. Returns the framed request bytes ready for Tunnel.Send. |
| **ParseResponse(raw_bytes)** | Parse an HTTP response into status code, headers, and body. Returns structured data. |
| **ParseHeaders(header_block)** | Parse header key-value pairs. Extract Content-Type, Content-Length, Location (for redirects). |

**Capability requirements**: HTTP holds GTs for PackedString (E) for
text manipulation. Pure computation — no I/O capabilities needed.

### Renderer (NS slot 39 — replaces Photos in the current spec)

**Methods**: RenderText, RenderTable, RenderList, Clear

| Method | Description |
|--------|-------------|
| **RenderText(text, style)** | Render plain text to the display device. Style: normal, bold, heading. |
| **RenderTable(rows, cols, data)** | Render a table with borders (ASCII art on UART, structured on LCD). |
| **RenderList(items)** | Render a numbered or bulleted list. |
| **Clear** | Clear the display. |

**Capability requirements**: Renderer holds GT for Display (W) and
PackedString (E). Output-only — no network access.

## Dependencies

| Abstraction | Slot | Status | Needed for |
|-------------|------|--------|------------|
| Tunnel | 31 | Plan 2 | All network traffic goes through encrypted tunnels |
| Family | 28 | Plan 2 | Parent controls which site GTs exist in child's c-list |
| Negotiate | 32 | Plan 2 | Child requests access to a new site — parent approves or rejects |
| UART | 11 | Exists | Physical I/O for text display (Tang Nano) |
| Display | 15 | Spec exists | Output device abstraction |
| Memory | 7 | Exists | History stack, bookmark storage |
| PackedString | — | JS example exists | Text encoding and manipulation |
| Loader | 19 | Plan 1 | Browser arrives via lazy load — not resident at boot |
| Lambda | NEW | Planned | Verify site certificate Abstract GTs |

## Architecture

### How Parental Control Works

The parent's c-list contains S permission on the child's internet
c-list slots. The parent SAVEs Outform+Far GTs for approved sites:

```
Parent:
  Mint.Create(Outform+Far GT for "cloomc.org", R permission)
  → SAVE to child's c-list slot 0 (internet section)

  Mint.Create(Outform+Far GT for "wikipedia.org", R permission)
  → SAVE to child's c-list slot 1

  Slot 2: NULL  ← no third site approved
```

The child's Browser can only navigate to slots 0 and 1. Slot 2 is
NULL — any attempt to navigate there triggers FAULT NULL_CAP. The
child cannot forge a GT for an unapproved site. The hardware makes
it impossible.

### The Navigate Flow

```
Child: Browser.Navigate(cloomc_org_GT)

1. Browser validates: is this GT live? (Lambda.Verify)
2. Browser calls Tunnel.Connect(cloomc_org_GT)
   → Tunnel extracts Far address from GT Words 1-2
   → Tunnel establishes encrypted session to cloomc.org via bridge

3. Browser calls HTTP.Request("GET", "/", {Host: "cloomc.org"})
   → Returns formatted HTTP/1.1 request bytes

4. Browser calls Tunnel.Send(session_GT, request_bytes)
   → Framed, encrypted, CRC-checked, sent over UART

5. Tunnel.Receive(session_GT) → raw HTTP response bytes

6. Browser calls HTTP.ParseResponse(raw_bytes)
   → Returns: {status: 200, contentType: "text/plain", body: "..."}

7. Browser calls Renderer.RenderText(body, "normal")
   → Text appears on UART terminal / LCD / IDE simulator

8. Browser pushes cloomc_org_GT to history stack (for Back)

9. Tunnel stays open for subsequent requests to the same site
```

### Blocked Navigation

```
Child: Browser.Navigate(evil_site_GT)

1. evil_site_GT does not exist in child's c-list
2. LOAD attempts to read it → FAULT NULL_CAP
3. Browser never sees the GT — the hardware refused before
   Browser code even ran
4. Fault is logged in the child's fault counter
5. Parent sees the attempt via Family.Oversight
```

### Display Targets

| Board | Display device | Renderer output |
|-------|---------------|-----------------|
| Tang Nano 20K | UART terminal (115200 baud) | ASCII text, 80-column, VT100 escape codes for bold/heading |
| Ti60 F225 | UART or SPI LCD | ASCII text or pixel-addressed rendering |
| Simulator (IDE) | Browser panel in the IDE | HTML-rendered text in a dedicated output area |

The Renderer abstraction is the same on all targets. Only the Display
driver changes — and Display is a device abstraction (NS slot 15) that
adapts to the connected hardware.

## Implementation Steps

### Step 1: PackedString as a real abstraction

- Promote the existing JS PackedString example to a full CLOOMC++
  abstraction with NS slot and lump
- Methods: Pack4, Unpack, IsLetter, ToUpper, Concat, Length, Substring
- This is the text foundation for HTTP and Renderer

### Step 2: HTTP abstraction — CLOOMC++ source

- Write `http.cloomc` with Request, ParseResponse, ParseHeaders
- Minimal HTTP/1.1: GET and HEAD only at first
- Parse status line, extract Content-Type and Content-Length
- Body extraction: read Content-Length bytes after header block
- Build lump, register at NS slot 38

### Step 3: Renderer abstraction — CLOOMC++ source

- Write `renderer.cloomc` with RenderText, RenderTable, RenderList, Clear
- UART output: VT100 escape codes for bold (\e[1m), heading (\e[1;33m)
- Table rendering: ASCII box-drawing characters
- Build lump, register at NS slot 39

### Step 4: Display device abstraction

- Write `display.cloomc` for NS slot 15
- Tang Nano: UART write (reuse existing UART infrastructure)
- Ti60: UART write initially, SPI LCD later
- Simulator: write to a dedicated Browser output div in the IDE

### Step 5: Browser abstraction — CLOOMC++ source

- Write `browser.cloomc` with Navigate, Back, Bookmark, Search
- Navigate: validate GT → Tunnel.Connect → HTTP.Request → Tunnel.Send →
  Tunnel.Receive → HTTP.ParseResponse → Renderer.RenderText
- Back: pop history stack → Navigate to previous GT
- Bookmark: SAVE site GT with label to bookmark c-list
- Search: Navigate to search engine GT with query parameter
- Build lump, register at NS slot 37

### Step 6: Parental control integration

- Extend Family.Register to create internet c-list slots (NULL by default)
- Parent uses SAVE to place approved site GTs in child's c-list
- Browser.Navigate checks the GT before calling Tunnel
- Family.Oversight reports navigation history and blocked attempts

### Step 7: Simulator end-to-end test

- Parent approves "cloomc.org" — SAVEs Outform GT to child's c-list
- Child calls Browser.Navigate(cloomc_org_GT)
- HTTP GET is built, sent through Tunnel (simulated), response parsed
- Renderer displays: "Welcome to CLOOMC.org — Church Machine IDE"
- Child tries unapproved site — FAULT NULL_CAP, logged
- Parent sees the blocked attempt via Family.Oversight

### Step 8: Hardware test (Tang Nano 20K)

- Connect UART terminal to Tang Nano
- Parent approves "cloomc.org" via bridge
- Child navigates — text renders on UART terminal at 115200 baud
- Back button returns to previous page
- Bookmark saves the site for quick access

## NS Slot Reassignment

The original Layer 7 spec allocated slots 37-42 for internet
abstractions. With the Browser plan, some slots are repurposed:

| Slot | Original spec | Browser plan | Reason |
|------|--------------|--------------|--------|
| 37 | Browser | **Browser** (unchanged) | Navigate, Back, Bookmark, Search |
| 38 | Messenger | **HTTP** | HTTP parsing is a prerequisite for Browser and all internet abstractions |
| 39 | Photos | **Renderer** | Display rendering is shared by Browser and all content abstractions |
| 40 | Social | Social (unchanged, future) | Deferred — depends on Browser + Tunnel working first |
| 41 | Video | Video (unchanged, future) | Deferred |
| 42 | Email | Email (unchanged, future) | Deferred |

Messenger, Photos are not removed — they are deferred. HTTP and
Renderer are more fundamental and must exist first.

## Memory Budget

| Component | Estimated lump size | Notes |
|-----------|-------------------|-------|
| Browser | 2048 words (8 KB) | Navigate + history stack + bookmark c-list |
| HTTP | 512 words (2 KB) | Request builder + response parser |
| Renderer | 512 words (2 KB) | Text + table + list rendering |
| PackedString | 256 words (1 KB) | Text utilities |
| Display | 128 words (512 B) | Thin driver layer |
| **Total** | **~14 KB** | Fits on Tang Nano with lazy load |

With lazy load (Plan 1), only Browser needs to be resident during
browsing. HTTP and Renderer load on first call and can be evicted
when the child stops browsing.

## Success Criteria

1. Parent approves a site — child navigates, text renders
2. Parent does not approve a site — child gets FAULT NULL_CAP
3. Back button works — history stack maintains last N pages
4. Bookmark saves a site GT — Navigate(bookmark) works
5. Search sends a query to an approved search engine GT
6. Family.Oversight shows navigation log and blocked attempts
7. Works on all three targets: simulator, Tang Nano UART, Ti60 UART
8. MTBF = ∞ for Browser, HTTP, Renderer, and Display
9. Total memory footprint under 14 KB with lazy load
