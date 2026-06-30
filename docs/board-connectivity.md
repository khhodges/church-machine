# Connecting a Board to the IDE — The Big Picture

The Church Machine IDE lives at **lab.cloomc.org**. When you run a program,
it needs to reach your physical board. How that happens depends on what kind
of board you have — and understanding the difference explains a lot about
where the project is headed.

---

## Two kinds of boards, two very different experiences

### The Ti60 F225 — a local, tethered board

The Efinix Ti60 F225 is a compact FPGA development board connected to your
computer by a **USB cable**. It has no network port of its own.

Because the IDE lives on the internet and the board is on your desk, something
has to carry data between them. That something is a small script called the
**bridge**. You run it in a terminal on your local machine, it listens on the
USB serial port, and it forwards what the board says up to the IDE over the
internet.

```
Your desk                             lab.cloomc.org
──────────────────────────────        ──────────────────────────
Ti60 board  ──USB cable──▶  bridge    ──HTTP──▶  IDE database
                            (runs in               IDE dashboard
                             your terminal)        IDE stream panel
```

**What this means in practice:**

- You must run the bridge script whenever you want the IDE to see your board
- The bridge only works while your terminal is open
- Only people with a USB cable to the board can connect

The Ti60 is ideal for **private development** — building, testing, and
validating the Church Machine on your own bench. It is not designed for
sharing with others over the internet.

---

### Ethernet boards — the end game

Boards with a built-in Ethernet port (such as the QMTECH Wukong) take a
completely different approach. When the Church Machine boots, the board
**sends a network packet directly to lab.cloomc.org** — no USB, no bridge
script, no terminal.

```
Any location in the world           lab.cloomc.org
───────────────────────             ──────────────────────────
Ethernet board  ──UDP──▶ internet ──▶  IDE database
                                       IDE dashboard  (appears
                                       IDE stream panel  automatically)
```

**What this means in practice:**

- The board appears in the IDE dashboard the moment it boots
- No software to install, no terminal to keep open
- Works from any location with an internet connection
- Multiple boards from multiple users all register independently
- Any browser, any device — nothing special required

This is the architecture that makes the Church Machine IDE a real product
rather than a developer's workbench.

---

## Why the Ti60 exists at all, then

The Ti60 is a **stepping stone** — its purpose is to prove that the Church
Machine core works correctly before committing to a larger hardware effort.

Everything validated on the Ti60 carries forward unchanged:

| What the Ti60 proves | How it carries forward |
|---|---|
| Boot sequence is correct | Same boot ROM, same LUMP format, all boards |
| Capability security works | Same Golden Token hardware, all boards |
| CALLHOME protocol is sound | Same wire format, just a different transport |
| LUMP loading is reliable | Same Locator logic, all boards |
| Fault recovery works | Same three-tier recovery, all boards |

The Ti60 changes nothing about the architecture. It just uses USB where
Ethernet boards use a network packet. When you see the CALLHOME message
arrive cleanly on the Ti60, you know the same message will arrive cleanly
from an Ethernet board — because the CM core that sends it is identical.

---

## The bridge will become invisible

For Ti60 users who want a smoother experience, the plan is to make the
bridge a one-time install:

```
First time only, from any browser:

  curl -fsSL lab.cloomc.org/get-bridge | python3 - --install

This installs a background service. From then on:
  - The bridge starts automatically when you log in
  - It reconnects if the IDE goes offline and comes back
  - Your board appears in the IDE without any terminal
```

After that one command, the Ti60 behaves like an Ethernet board from the
user's perspective — the local USB detail is completely hidden.

---

## Summary

| | Ti60 F225 | Ethernet board |
|---|---|---|
| Connection | USB cable | Network (Ethernet / WiFi) |
| Bridge required | Yes (today) / Auto-start (soon) | No — never |
| Works remotely | No | Yes |
| Best for | Private development and testing | Shared, deployed use |
| Status | Shipping today | In development |

The Ti60 is where the Church Machine is proven. Ethernet boards are where
it is deployed. Both run the same CM core, the same CLOOMC programs, and
connect to the same IDE — they just arrive there differently.
