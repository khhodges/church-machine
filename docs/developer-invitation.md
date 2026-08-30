# Developer Invitation — Email & Social Copy

> **PROMOTIONAL DRAFT / NON-AUTHORITATIVE.** Absolute security claims below are
> marketing concepts, not claims about proven or shipped guarantees.

**The Church Machine Abstraction Challenge**

---

## Email

**Subject: The computer that cannot be hacked. We need your abstraction.**

---

Every year, billions of lines of code get shipped with the same fundamental
flaw: the computer running them has no idea whether they are allowed to do
what they are doing. Buffer overflows. Privilege escalation. Memory
corruption. Root exploits. These are not programmer mistakes — they are
what happens when a machine has no security model below the software.

The Church Machine has one.

It is a real processor — running on FPGA silicon — in which every memory
access, every function call, and every data read is validated by hardware
before the instruction executes. Not by an operating system. Not by a
runtime. By the silicon itself, on every clock cycle. There is no root.
There is no kernel to exploit. There is no way to forge a capability. If
your code does not have permission, the machine refuses. Safely.
Immediately. Every time.

We call this capability-based security. We have been building it for
years. It works. And now we need you.

---

**The Church Machine Abstraction Challenge — 2026**

The Church Machine is only as powerful as its library of abstractions —
the verified, capability-secured programs that other developers build on.
Right now that library has gaps. Important gaps. And this is where you
come in.

**The challenge is simple: write the abstraction that matters most.**

We are not looking for demos. We are not looking for toy programs. We are
looking for abstractions that solve real problems — sensor drivers, network
protocols, mathematical libraries, cryptographic tools, educational programs
— built to the standard the hardware demands: minimum permissions, zero
capability faults, MTBF = ∞.

The best abstraction submitted this quarter wins:

- **Permanent credit** in the Mum Tunnel Library — your name on
  an abstraction that every Church Machine user can build on, forever
- **Recognition** at CLOOMC.org as the Abstraction Challenge winner
- **A Wukong A7 development board** — the full Church Machine on silicon,
  so you can run your winning abstraction on real hardware

---

**What does a great abstraction look like?**

It solves something people actually need. It runs on both the IoT profile
(Tang Nano 20K, ~£5) and the full profile (Wukong A7, ~£50) so it reaches
the widest audience. It requests the minimum permissions it needs — no
more. And it runs clean: zero capability faults across every test case you
can throw at it.

The world is still waiting for:

- A verified MQTT client that can never silently leak credentials
- A LoRa tunnel implementation with capability-isolated send and receive
- A cryptographic hash wrapped in a Church Machine capability contract
- A display driver that cannot scribble outside its allocated screen region
- An educational abstraction that teaches a twelve-year-old what a
  capability is, by showing them what happens when you try to break one

These are not trivial. That is the point. Gaining your spurs in computing
means building something that mattered, not something that compiled.

---

**How to enter**

1. Open the Church Machine IDE at **cloomc.org** in Chrome or Edge
2. Work through the tutorials — the simulator is free, runs in your
   browser, and enforces every security rule the hardware does
3. Write your abstraction in English, JavaScript, Haskell, Symbolic Math,
   or Lambda Calculus — the compiler handles the rest
4. Test until MTBF = ∞: zero faults across every input you can imagine
5. Publish to the **Mum Tunnel Library** — click Publish in the IDE
6. Email **challenge@cloomc.org** with your library entry and a short
   note explaining what it does and why it matters

Submissions close **30 September 2026**.

You do not need to own a board to enter. The simulator is the full Church
Machine. If your abstraction runs clean in the simulator, it will run clean
on silicon — the hardware guarantees it.

---

**Why this matters**

Every verified abstraction in the Mum Tunnel Library is a brick in the
foundation of computing that does not need patching. The architecture
that the Church Machine demonstrates — capability-based, hardware-enforced,
fail-safe by design — is where computing needs to go. The developers who
learn it now, who build the first library of verified abstractions, will
be the ones who define what that future looks like.

This is how you get on the right side of history in the Information Age.

Write something that matters. We will meet you there.

**→ cloomc.org**

---

*The Church Machine is open source. The IDE, the simulator, the compiler,
the hardware — all of it. No gatekeeping. You join by contributing.*

---
---

## Short Text / Social Post

### Twitter / X (under 280 characters)

> Every buffer overflow, every root exploit, every CVE — the Church
> Machine hardware makes them impossible by design. We're challenging
> developers to write the abstraction that proves it. Best entry wins a
> Wukong A7 FPGA board. cloomc.org #CapabilitySecurity

---

### LinkedIn / Mastodon (slightly longer)

> **The computer that cannot be hacked needs your abstraction.**
>
> The Church Machine is a real processor where capability-based security
> is enforced by silicon on every clock cycle — no root, no kernel to
> exploit, no way to forge a permission.
>
> We're running an Abstraction Challenge for developers who want to build
> something that matters: verified, capability-secured programs that other
> developers can build on forever. Best submission wins a Wukong A7 FPGA
> development board and permanent credit in the Mum Tunnel Library.
>
> No board required to enter. The simulator runs in Chrome, enforces every
> security rule the hardware does, and is completely free.
>
> This is how you gain your spurs in secure computing.
> Submissions close 30 September 2026.
>
> → cloomc.org

---

### SMS (under 160 characters)

> Church Machine challenge: write a verified secure abstraction, win an
> FPGA board. The hardware enforces security. Prove it. cloomc.org

---

### Discord / Slack / Forum post

> **Challenge: write the abstraction the Church Machine is missing.**
>
> The Church Machine is an FPGA processor where capability-based security
> is enforced by hardware — not the OS, not the runtime — on every single
> instruction. Buffer overflows, privilege escalation, forged pointers: the
> silicon says no.
>
> The processor is real. The IDE runs in Chrome. The simulator enforces
> every security rule the hardware does — for free, in your browser, right
> now.
>
> **We need abstractions.** Real ones. Things the world actually needs:
>
> - A verified MQTT client that cannot leak credentials
> - A LoRa tunnel with capability-isolated send/receive
> - A cryptographic hash in a proper capability contract
> - An educational sequence that teaches a kid what a capability IS
>   by showing them what happens when they try to break one
>
> Best abstraction wins a **Wukong A7 FPGA board** and permanent credit in
> the Mum Tunnel Library — your name on an abstraction every Church Machine
> user can build on, forever.
>
> How to enter: cloomc.org → tutorials → write → publish → email
> challenge@cloomc.org before 30 September 2026.
>
> This is the kind of computing the next generation of developers needs
> to understand. Be one of the first to build it.
