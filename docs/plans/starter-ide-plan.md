# Church Machine Starter IDE — Deliverable Plan

**v1.0 — May 2026**

---

## The Problem

The full Church Machine IDE is powerful. It is also intimidating. Eighteen
views, five languages, capability registers, namespace tables, pipeline
diagrams, hardware deployment, garbage collection traces. A developer who
already knows what they are doing finds it rich. A child, an OAP, or a
young developer opening it for the first time finds it overwhelming and
closes the tab.

The goal of this deliverable is to fix that without rebuilding anything.
The simulator engine, the compiler, the security model — all of it stays
exactly as it is. What changes is the front door.

---

## The Deliverable

**A Starter IDE** — a simplified, focused view of the Church Machine that
puts a first-time user in front of running, secure code in under five
minutes. No manual. No tutorial to read first. No choices to make before
the machine boots.

The Starter IDE is not a toy and not a dumbed-down version. It runs the
same simulator. It enforces the same Six Laws. The code you write in it
is real Church Machine code. The difference is what it shows you —
and, more importantly, what it hides until you are ready.

---

## Target Users

| User | Starting point | Goal |
|------|---------------|------|
| Child (8–14) | Curious, no prior coding | Write something, see it run, feel the security kick in |
| OAP / first-time programmer | Patient but easily lost | Boot the machine and understand what it did |
| Young developer | Knows JS/Python, wants to prove themselves | Write a real abstraction without wading through 18 tabs |
| Teacher / parent | Setting up for a class or a child | Done in 10 minutes, no support call needed |

---

## What Gets Stripped Out (Phase 1)

The following views are hidden by default in the Starter IDE. They remain
in the codebase — toggling to "Advanced Mode" reveals them all.

| Hidden in Starter | Why |
|-------------------|-----|
| Namespace table | Too much machinery for a first session |
| Memory view | Confusing without context |
| Pipeline diagram | Visual noise before the concept lands |
| Abstraction library browser | Too wide; introduce via guided step |
| LUMP editor | Advanced hardware tooling |
| GC trace | Specialist; not relevant until lambda calculus |
| GitHub sync | Contributor workflow, not learner workflow |
| GT Inspector | Hardware internals |
| Sitemap | Navigation aid for the full IDE |
| Devices / Builder | Hardware deployment — Step 2, not Step 1 |
| REPL | Useful but not the entry point |

**What stays:**

| Kept in Starter | Why |
|-----------------|-----|
| Code editor | The whole point |
| Boot / Step / Run / Walk controls | Immediate interaction |
| Output / trace panel | See what the machine did |
| Fault popup | The security lesson lands here |
| Tutorial (guided) | One structured path through |
| CR14 summary (read-only, simplified) | "This is what the machine is running" |
| Language selector | English first; others accessible |
| Settings (student profile) | Needed for parent / teacher setup |

---

## Phase Plan

### Phase 1 — Starter Mode (the stripped-down IDE)

**Goal:** A first-time user opens the IDE, clicks Boot, writes three lines
of English, clicks Run, and sees the output. In under five minutes. No
instructions read first.

**What gets built:**

- **Starter Mode flag** — a URL parameter (`?starter=1`) or a localStorage
  setting that hides advanced views and simplifies the toolbar
- **Simplified toolbar** — Boot, Run, Step, Walk, Fault only. Everything
  else moves behind a single "More →" button
- **Welcome card** — replaces the dashboard on first load. One sentence
  about what the Church Machine is. One big "Write your first program →"
  button. Nothing else
- **Guided first program** — English language, pre-loaded:

  ```
  add 3 and 5
  store the result
  show the result
  ```

  With inline annotations: "This is a capability-secured memory write.
  The machine just checked it was allowed."

- **Simplified fault popup** — strips the pipeline stage / GT internals
  from the fault display. Shows: "You tried to [read/write] memory you
  were not given permission for. That is what a capability fault looks
  like. Here is how to fix it."

- **"Explore more →" persistent link** — always visible at the bottom.
  One click switches to Advanced Mode. Nothing is lost; the full IDE
  loads with the same program already in the editor.

**Done looks like:**
A user with no prior Church Machine knowledge opens the Starter IDE URL,
boots the machine, writes a three-line English program, runs it, sees the
output, and optionally triggers a capability fault — all without reading
any documentation. Time to first "Run": under 5 minutes.

---

### Phase 2 — Hardware Connection (one board, one button)

**Goal:** A user who has a Tang Nano 20K or Wukong A7 can connect it to
the Starter IDE without switching to Advanced Mode.

**What gets built:**

- **"Connect my board" card** — appears in Starter Mode after the first
  successful simulator run. "Your code works in the simulator. Want to run
  it on real silicon?"
- **Simplified Devices panel** — shows one board, one status light (online
  / offline), one "Deploy" button. None of the multi-board, boot-count,
  firmware-version detail of the full Devices panel
- **Auto-detected port hint** — when the bridge is running, the Starter IDE
  shows the board name and a single green dot. No configuration required
- **Deploy confirmation** — "Sending your program to the board..." → LEDs
  respond → "It's running on real silicon. The same capability rules apply."

**Done looks like:**
A user who owns a Tang Nano 20K or Wukong A7 and has run `./bridge.sh` can see
their board in the Starter IDE and deploy their first program with one click,
without touching Advanced Mode.

---

### Phase 3 — The Challenge Integration

**Goal:** Turn the Starter IDE into the entry point for the Abstraction
Challenge. A young developer opening the challenge link lands in a Starter
IDE pre-loaded with context, has a clear path from "first program" to
"published abstraction", and can submit without leaving the IDE.

**What gets built:**

- **Challenge landing mode** (`?challenge=1`) — Starter Mode with a
  challenge-specific welcome card: the problem statement, the prize,
  the deadline. One button: "Start building →"
- **Abstraction meter** — a simple progress bar in the Starter toolbar:
  Write → Test → Zero faults → Publish. Lights up each step as it is
  completed
- **Guided path to MTBF = ∞** — after a successful first run, the Starter
  IDE surfaces one prompt: "Run 1,000 cycles without a fault to qualify."
  The fault counter is visible and counts down
- **One-click publish** — when the fault counter reaches zero and 1,000
  clean cycles are logged, a "Publish to Mum Tunnel Library" button
  appears. The submission includes source, compiled words, capability list,
  and cycle count. No manual form
- **Challenge submission confirmation** — "Your abstraction is in the
  Library. Here is your permanent link. Email it to challenge@cloomc.org
  to enter."

**Done looks like:**
A developer who opens the challenge link, has never used the Church Machine
before, can go from zero to published, qualifying abstraction in a single
session — staying in the Starter IDE the entire time.

---

## Technical Approach

### No new simulator. No fork.

The Starter IDE is a **rendering mode** of the existing IDE, not a separate
codebase. It is controlled by a single flag (`starterMode = true`) that:

1. Hides views not in the Starter set (CSS `display:none` on nav items,
   not deletion)
2. Shows the welcome card instead of the dashboard on first load
3. Loads the simplified toolbar layout (a CSS class swap on the toolbar)
4. Pre-loads the English language and the guided first program
5. Replaces the fault popup template with the simplified version

Switching to Advanced Mode is `starterMode = false` plus a page refresh —
state is preserved in localStorage as it is today.

### URL scheme

| URL | What it opens |
|-----|---------------|
| `/simulator/` | Full IDE (existing behaviour) |
| `/simulator/?starter=1` | Starter Mode, general |
| `/simulator/?starter=1&challenge=1` | Challenge landing mode |
| `/simulator/?starter=1&challenge=1&lang=en` | Challenge, English pre-selected |

---

## What "Done" Looks Like — Overall

A ten-year-old with a Tang Nano 20K plugged in and Chrome open can:

1. Open the Starter IDE URL
2. Read one sentence about what the Church Machine is
3. Click Boot
4. Write a three-line English program
5. Click Run and see the output
6. Trigger a capability fault and read a one-sentence explanation
7. Click "Connect my board" and deploy to real silicon
8. Click "Explore more →" and graduate to the full IDE

All of that without reading any documentation, without configuring
anything, and without asking anyone for help.

---

## Phased Delivery

| Phase | What ships | When |
|-------|-----------|------|
| 1 — Starter Mode | Simplified IDE, welcome card, guided first program, simplified fault popup | 4–6 weeks |
| 2 — Hardware | Simplified Devices panel, one-click deploy from Starter Mode | +3 weeks |
| 3 — Challenge | Challenge landing, abstraction meter, one-click publish, submission flow | +4 weeks |

Total: approximately **11–13 weeks** from first line of code to a running
Abstraction Challenge with hardware deployment.

---

## Dependencies

- Phase 1 has no external dependencies — all work is inside the existing
  simulator directory
- Phase 2 depends on `local_bridge.py` (already shipped in the Wukong A7 and
  Tang Nano packages) and the existing `/api/call-home` endpoint (already
  implemented)
- Phase 3 depends on the Mum Tunnel Library publish API and the
  challenge@cloomc.org submission address being live

---

## Risks

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Starter Mode feels like a different product — confusing when you switch to Advanced | Medium | "More →" button always visible; switching is instant and lossless |
| The guided first program is too easy to be useful | Low | English language programs do real work — the capability fault is a genuine security lesson |
| Phase 2 hardware connection fails silently in Starter Mode | Medium | Bridge connection has a visible status light; failure shows a one-line fix hint |
| Challenge deadline drives artificial submissions | Low | Judging criteria are explicit: zero faults, clean capability design, real utility |
