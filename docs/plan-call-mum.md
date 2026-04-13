# Plan: Call Mum

## Goal

A child can send a message to their parent (Mum, Dad, or any family
member) from their Church Machine, receive a response, and — with
dual approval — receive new capabilities as a result. The entire
interaction is GT-gated, encrypted, and hardware-enforced.

## New Abstractions

### Family (NS slot 28)

**Methods**: Register, Hello, Oversight

| Method | Description |
|--------|-------------|
| **Register** | Creates a child namespace with the parent as root. Mints the Mum GT (Outform+Far, E permission) and places it in the child's c-list. |
| **Hello(target_GT, message)** | Send a message to any family member via their GT. Mum is not a method — Mum is a GT. Hello(Mum_GT) sends to Mum. Hello(Dad_GT) sends to Dad. The same method works for any target. |
| **Oversight** | Returns the parent's view of a child's activity — fault count, abstractions loaded, last MTBF reading. |

**Capability requirements**: Family holds GTs for Tunnel (E), Navana (E),
Mint (E), and UART (R/W).

### Tunnel (NS slot 31)

**Methods**: Connect, Send, Receive, Close

| Method | Description |
|--------|-------------|
| **Connect(outform_GT)** | Establish an encrypted tunnel to the remote namespace identified by the Outform GT. Returns a session GT. |
| **Send(session_GT, data)** | Send data through an established tunnel. Data is framed, encrypted, and CRC-checked. |
| **Receive(session_GT)** | Block until data arrives on the tunnel, or return immediately if data is queued. |
| **Close(session_GT)** | Tear down the tunnel. Session GT is revoked. |

**Capability requirements**: Tunnel holds GTs for UART (R/W), Mint (E)
for session GT creation, and the encryption key material (stored as
Abstract GTs issued by Lambda).

### Negotiate (NS slot 32)

**Methods**: Propose, Approve, Reject, Status

| Method | Description |
|--------|-------------|
| **Propose(resource_GT, permissions, target)** | Teacher or service proposes a grant. Creates a pending proposal. |
| **Approve(proposal_GT)** | Parent approves the proposal. Mint creates the GT, SAVE places it in the child's c-list. |
| **Reject(proposal_GT)** | Parent rejects the proposal. Proposal GT is revoked. |
| **Status(proposal_GT)** | Check proposal status — pending, approved, rejected, expired. |

**Capability requirements**: Negotiate holds GTs for Tunnel (E) to both
parties, Mint (E) for GT creation on approval, Navana (E) for c-list
writes.

## Dependencies

| Abstraction | Slot | Status | Needed for |
|-------------|------|--------|------------|
| UART | 11 | Exists | Physical transport — bytes on the wire |
| Navana | 5 | Exists | NS table writes when installing granted GTs |
| Mint | 6 | Exists | Creating GTs for new grants and session tokens |
| Memory | 7 | Exists | Allocating message buffers |
| Lambda | NEW | Planned | Issuing encryption key Abstract GTs |
| Loader | 19 | Plan 1 | Lazy-loading Family/Tunnel/Negotiate on demand |

## Protocol Design

### Mum Tunnel Wire Format

```
┌────────┬────────┬──────────┬────────────────┬────────┐
│ Magic  │ Length │ Type     │ Payload        │ CRC-32 │
│ 0xCE11 │ 2 byte │ 1 byte  │ variable       │ 4 byte │
└────────┴────────┴──────────┴────────────────┴────────┘
```

Message types:

| Type | Name | Direction | Description |
|------|------|-----------|-------------|
| 0x01 | HELLO | Child → Parent | "Hello Mum" message with text payload |
| 0x02 | REPLY | Parent → Child | Response to a HELLO |
| 0x03 | PROPOSE | Either → Either | Negotiate proposal |
| 0x04 | APPROVE | Parent → Child | Grant approved — GT follows |
| 0x05 | REJECT | Parent → Child | Grant rejected |
| 0x06 | GT_TRANSFER | Parent → Child | Encrypted GT payload |
| 0x07 | OVERSIGHT | Parent → Child | Request child activity report |
| 0x08 | HEARTBEAT | Both | Keep tunnel alive |

### The Outform TRAP Mechanism

When mLoad encounters an Outform GT (gt_type = 10), it does not load
a local namespace entry. Instead:

```
mLoad detects gt_type = 10 (Outform)
  → TRAP to Tunnel handler
  → Tunnel reads the Far address from GT Word 1-2
  → Tunnel.Connect establishes the remote session
  → Message is sent via Tunnel.Send
  → Response arrives via Tunnel.Receive
  → Result is returned to the caller as if it were local
```

The caller does not know whether the resource is local (Inform) or
remote (Outform). Network transparency.

### The Call Mum Flow

```
                    CHILD                              MUM
                    ─────                              ───
1. Family.Hello(Mum_GT, "Can I use SlideRule?")
2. Family dispatches → Tunnel.Send(Mum_session, msg)
3.                     ──── UART → Bridge → Internet → Bridge → UART ────
4.                                                     Tunnel.Receive(msg)
5.                                                     Mum sees: "Can I use SlideRule?"
6.                                                     Mum decides: YES
7.                                                     Negotiate.Approve(SlideRule_proposal)
8.                                                     Mint.Create(SlideRule_GT, E_perm)
9.                     ──── GT_TRANSFER ────────────────────────────────
10. Tunnel.Receive(GT_TRANSFER)
11. Navana installs SlideRule GT in child's c-list
12. Child can now CALL SlideRule
```

## Implementation Steps

### Step 1: Outform TRAP in simulator

- Extend `mLoad()` in app.js to detect gt_type = 10
- On Outform: TRAP to a registered tunnel handler instead of NS lookup
- Log the TRAP with full GT details for debugging

### Step 2: Tunnel abstraction — CLOOMC++ source

- Write `tunnel.cloomc` with Connect, Send, Receive, Close
- Wire format: 0xCE11 magic, length, type, payload, CRC-32
- Connect: allocate session buffer, create session GT via Mint
- Send: frame payload, write to UART
- Receive: read from UART, validate CRC, return payload
- Build lump, register at NS slot 31

### Step 3: Family abstraction — CLOOMC++ source

- Write `family.cloomc` with Register, Hello, Oversight
- Register: create child namespace via Navana, mint Mum GT (Outform+Far)
- Hello: dispatch to Tunnel.Send using the target's Outform GT
- Oversight: query child's fault counters and loaded abstractions
- Build lump, register at NS slot 28

### Step 4: Negotiate abstraction — CLOOMC++ source

- Write `negotiate.cloomc` with Propose, Approve, Reject, Status
- Propose: create pending proposal, send via Tunnel to both parties
- Approve: verify both signatures, call Mint.Create, SAVE to child c-list
- Reject: revoke proposal GT
- Build lump, register at NS slot 32

### Step 5: Bridge extension

- Extend `local_bridge.py` to handle Mum Tunnel message types
- Route HELLO/REPLY between child and parent Church Machines
- Forward GT_TRANSFER with encryption
- Heartbeat keepalive (60-second interval, matching device heartbeat)

### Step 6: Simulator end-to-end test

- Register a parent and child in the simulator
- Child calls Family.Hello(Mum_GT, "Hello Mum")
- Mum receives the message, replies "Hello darling"
- Child receives the reply
- Mum approves a SlideRule grant via Negotiate
- Child receives SlideRule GT, calls SlideRule.Sin successfully

## Success Criteria

1. Child sends "Hello Mum" — message arrives at parent's Church Machine
2. Parent replies — response arrives at child
3. Parent approves a capability grant — GT arrives in child's c-list
4. Child uses the granted capability successfully
5. Revocation: parent revokes the grant — child's GT dies instantly
6. Unauthorized access: child tries to call an abstraction without a
   grant — FAULT, not silent failure
7. MTBF = ∞ for Family, Tunnel, and Negotiate
