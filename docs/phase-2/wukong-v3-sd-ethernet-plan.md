# Wukong V3 SD and Ethernet dependency review

Started 11 November 2026; target revision confirmed 13 November 2026.
Equipment baseline supplied 13 November 2026. **Desktop dependency plan complete;
implementation and physical qualification are not authorized or completed.**
No hardware access, provisioning, UART relocation, runtime edit, synthesis,
programming or physical measurements were performed. This is separate from
Ti60 call-home integration and remote-control authentication.

## Evidence and disposition

The retained manufacturer schematic is available:
`generated-artifacts/wukong-v3-schematic.pdf`, SHA-256
`bec53e6201c5c47a7059ce5b5af86e0f3a48535ebdf5643af7583171f7331aee`.
It is the seven-sheet QMTECH-XC7A100T_200T-WUKONG-BOARD, revision 3.0,
with sheet dates December 12, 2023, distributed as
QMTECH-XC7A100T_200T-Wukong-Board-V03-20240121 in the manufacturer's
[V3 hardware directory](https://github.com/ChinaQMTECH/QM_XC7A100T_WUKONG_BOARD/tree/master/V3/Hardware).
The local PDF was inspected as rendered wiring diagrams, including enlarged
Ethernet, SD and bank-supply regions; extracted text alone was not used to
associate wires. The ignored local PDF must accompany an offline handoff.

The owner confirmed **V3** and a **microSD slot** on 13 November 2026.
This resolves the target-revision question: use this V3 schematic, not the
previously mentioned V2 manual filename. The schematic establishes the
documented component population and wiring, not physical inspection of
modifications, card identity or connected test equipment.

Key findings:

- Sheet 5 specifies **U14 RTL8211EG**, **P1 HR911130A** magnetics/RJ45,
  PHY address `001b`, `COL/Mode=0` (**GMII**, not RGMII),
  `SELRGV=1` (3.3 V I/O), and all-capabilities autonegotiation straps.
  Its RXDLY/TXDLY annotations are not permission to apply RGMII timing to GMII.
- Sheet 6 specifies **J9 onboard microSD**, not an unspecified external module.
  It also connects U23 CH340N TXD to FPGA F3 and RXD to E3 through J4 USB.
- Sheet 1 connects VCCO banks **34 and 35 to 3V3**. Sheet 6 supplies
  the SD socket at 3V3; no 1.8 V SD signaling is proposed.
- `hardware/rgmii_mac.py` explicitly describes a v1.1 pin map. Its E3/F3
  Ethernet assignment conflicts with UART only if that obsolete map is used.
  **V3 has separate GMII pins. Preserve UART E3/F3; no mux or relocation needed.**
  Changing pin names cannot convert that DDR/nibble MAC into a GMII controller.
  Its existing runtime TX extension/RX logic does not establish general GMII
  service readiness.
- The frozen `generated-artifacts/combined-vendor-mmcm-corrected-20261111/board.xdc`
  and maintained `cooperative-retry/combined-board.xdc` retain
  M21 clock, M6 maintenance, F3 RX, E3 TX. Preserve the frozen package.

## Proposed pin ownership

Directions are relative to FPGA. All listed user I/O use proposed LVCMOS33,
subject to confirming the board matches the schematic. This table is not XDC
and does not authorize generating a new wrapper.

| Interface / signal | Package pin(s), in bit order where applicable | Direction / bank |
|---|---|---|
| Existing 50 MHz clock | M21 | input; preserve frozen constraint |
| Existing maintenance | M6 | input; preserve held-button semantics |
| Existing UART TX / RX | E3 / F3 | output / input; 35 |
| GMII TXD[0..7] | R2 P1 N2 N1 M1 L2 K2 K1 | output; 34 |
| GMII TXEN / TXER | T2 / J1 | output; 34 |
| GMII GTX_CLK | U1 | output; 34 |
| PHY TXCLK (10/100) | M2 | input; 34 |
| GMII RXD[0..7] | M4 N3 N4 P3 R3 T3 T4 T5 | input; 34 |
| GMII RXDV / RXER / RXCLK | L3 / U5 / P4 | input; 34 |
| PHY COL / CRS | U4 / U2 | input; 34 |
| PHY MDC / MDIO / PHYRSTB | H2 / H1 / R1 | output / bidirectional / output; 34 |
| SD CLK, J9.5 | L4 | output; 34 |
| SD CMD, J9.3; SPI MOSI | J8 | output in SPI; 35 |
| SD DAT0, J9.7; SPI MISO | M5 | input in SPI; 34 |
| SD DAT3, J9.2; SPI CS_n | J6 | output in SPI; 35 |
| SD card detect, J9.9 | N6 | input; 34 |
| SD DAT1 / DAT2, J9.8 / J9.1 | M7 / H6 | reserved, high impedance in SPI; 34 / 35 |

Ethernet is 28 FPGA signals, not the legacy 15. The proposed active port count
is 37 (existing four + 28 Ethernet + five SD); reserving/exporting DAT1/2 makes
39. No pin is duplicated, including the two reserved SD pins. PHY CLK125,
INTB and PMEB are not routed to FPGA on sheet 5; do not invent those inputs.
GMII clock-pin legality/dedicated routing and all timing remain qualification
gates, not established by a uniqueness check.

SD pull-ups: R74/R73/R72/R70/R69 are 4.7 kΩ on DAT2/DAT3/CMD/DAT0/DAT1;
R68 is 4.7 kΩ on CD. CLK has no shown pull-up. J9 VDD is pin 4 and VSS pin 6;
shield grounds are 10–13. There is no separate write-protect signal or shown
FPGA-controlled card-power switch. Confirm CD contact polarity from the fitted
socket documentation before freezing the driver. Do not confuse DAT3's
`CD/DAT3` label with the separate mechanical detect at pin 9.

## Proposed controller, clock and reset plan

**Ethernet:** use a dedicated GMII/MII MAC interface, not the legacy RGMII
ODDR/IDDR path. Select a **10/100/1000 full-duplex GMII/MII MAC architecture**
for the proposal, since the owner identifies a router but not its port speeds.
Gigabit operation uses 125 MHz TX generated
from the 50 MHz board oscillator by a separately reviewed clock configuration.
Receive is source-synchronous to P4 RXCLK. The PHY has its own Y2 25 MHz crystal;
the FPGA must not drive that crystal or assume PHY CLK125 is available.
Keep execution at 25 MHz. Do not assume the present MMCM already supplies the
new clock or that existing timing slack covers it.

Initial service should admit traffic only after MDIO verifies PHY identity,
link, speed and full duplex; unsupported negotiated modes report unavailable,
not malformed traffic. Advertise only implemented full-duplex modes.
For 10/100 use the MII nibble datapath and PHY TXCLK at M2 (2.5/25 MHz);
for gigabit use eight-bit GMII and generated GTX_CLK at U1. RXCLK at P4
follows negotiated speed. Stop admission, drain/discard in-flight frames and
reset affected queues before glitch-free clock-mode transitions. Half duplex
is not proposed and must not be advertised. Do not silently reduce this
proposal to gigabit-only service. Controller choice is an in-project bounded
GMII/MII MAC plus Clause 22 management, not reuse of the RGMII datapath or an
unreviewed third-party IP dependency. RTL implementation remains separately
authorized; exact timing and PHY programming require datasheet review.

Use Clause 22 MDIO with turnaround tri-state handling and MDC ≤2.5 MHz.
Hold PHYRSTB asserted while supplies/clocks settle; release only after the
RTL8211EG reset/strap timing requirements are captured from its exact datasheet.
The legacy 500 ms reset counter is not evidence of correct V3 sequencing.
Keep strap-bearing receive pins as inputs through reset. Assert resets safely,
deassert synchronously in each clock domain, invalidate queued descriptors
across reset/link changes and never forward a partial/error frame.
Budget source-synchronous input/output delays, clock uncertainty, CDC and
reset-domain checks explicitly. No blanket false paths across payload data.

**SD:** select a bounded in-project **SPI-mode SDHC controller** for the proposal,
on the onboard socket,
with no DMA and single-block 512-byte reads/writes initially. This uses the
existing socket without an external module and limits implementation complexity.
Controller implementation remains subject to approval; none is found wired
into the frozen wrapper. Use the 25 MHz execution domain and clock enables,
not a fabric-generated internal clock. An initial divider of 128 gives
195.3125 kHz; a proposed transfer divider of four gives 6.25 MHz, increased only
after card/board timing qualification. No throughput guarantee is implied.
Initialize in SPI mode with required deselected startup clocks, card type/
capacity detection and checked addressing; implement CRC/error reporting,
bounded command/data timeouts, write response and busy completion, removal
abort, and explicit Sync semantics. Hold CS high and CLK low when idle/reset;
keep DAT1/2 high impedance. A controller reset is not a physical card power cycle.
Native four-bit SD would require a new controller/timing/buffer review, not
different package pins. Persistence guarantees require the selected card and
power-interruption testing; command completion alone is not proof of durability.

## Bus and buffer budget revision

Retain one serialized application-RAM write owner and existing three read
replicas. No new peripheral DMA port. SYSTEM-authorized bounded MMIO accesses
copy between application RAM and peripheral buffers; descriptors contain checked
length/ownership, not arbitrary physical write authority. Exact MMIO addresses,
interrupt allocation and service grants remain unassigned pending integration.
Use bounded arbitration and explicit buffer ownership/completion across clock
domains; preserve SYSTEM/watchdog progress. RX cannot backpressure the wire:
drop/count whole frames when full; do not overwrite a CPU-owned buffer.
TX underflow, RX FCS/error/oversize and reset must discard or fail explicitly.
Two RX/two TX buffers do not promise sustained gigabit software throughput.

| Allocation | BRAM36 planning cap |
|---|---:|
| A and B, 64 KiB each, three copies | 96 |
| 16 KiB staging, conservative three copies | 12 |
| Two 512-byte SD sectors, one tile per buffer | 2 |
| Two RX/two TX Ethernet frames, 2 KiB each, one tile each | 4 |
| **New explicit Ethernet CDC/elastic allowance**: two 2 KiB queues, one tile each | **2** |
| **New SD/controller protocol scratch allowance**, up to 8 KiB single-copy | **2** |
| Control/queue/diagnostic storage, up to 16 KiB single-copy | 4 |
| ROM/Outform/integration allowance retained | 6 |
| **Revised total / available** | **128 / 135** |
| **Unallocated margin** | **7** |

This adds four tiles to the earlier 124-tile estimate without reducing either
Namespace or staging. The explicit new caps must not be charged again to the
six-tile integration allowance. Payload RAM remains 108 tiles. FIFO
pointer/synchronizer logic and controller LUT/FF costs still need measurement.
Do not assume inferred multiport RAM or duplicated buffers fit these caps;
return to review if the selected controller requires more.
With separately approved single-copy staging, the corresponding alternative
would be 120 tiles, not 116 after these additions. Neither figure is a routed
result. Per-Namespace resident workload fit remains a separate work item.

## Equipment baseline and physical acceptance gates

### Equipment follow-up

On 13 November 2026 the owner clarified “Micro SD slot,” then explicitly
confirmed “V3.” The earlier local path naming a V2 manual is not the target
revision authority. No V2 manual upload is needed to resolve this question.
The owner subsequently supplied:

| Item | Owner-provided baseline | Planning consequence |
|---|---|---|
| Card | SanDisk 32GB Ultra 100MBs SDHC Memory Card | Plan SPI SDHC, 512-byte block addressing after OCR/CCS verification; read CSD capacity rather than hardcode nominal GB |
| Network peer | Router | Plan full-duplex 10/100/1000 negotiation; exact router model, port speed and cable availability are not confirmed |
| Power | Manual | Operator-assisted cold-start/interruption tests only; no automated power-cut claims |

The card description does not independently establish micro versus full-size
form factor or a specific SKU. J9 accepts **microSD**: check physical fit before
testing; a full-size SD card cannot be inserted, and an SD-size adapter is not
a solution for a microSD socket. The advertised 100 MB/s is not SPI performance.
At proposed 6.25 MHz SPI, raw serial throughput is at most 0.78125 MB/s before
protocol, busy time and software overhead. No speed or durability benchmark
has been run. Do not interpret this inventory as permission to erase a card,
access hardware or purchase replacements.

Existing `attached_assets/wukong-connected-board.jpg` shows a QMTECH Wukong
board with a fitted HanRun HR911130A connector, consistent with schematic P1.
The visible connector has no Ethernet cable inserted at the time of that photo.
The photograph does not establish current cabling, readable PHY suffix,
microSD card model/capacity, socket population, board modifications or the
currently selected physical target. Multiple boards are visible.
`attached_assets/wukong-laptop-ide-setup.jpg` adds no reliable evidence for
these peripheral details.

The engineering choices above complete the proposed wiring/controller/budget
plan without requiring the owner to select controller IP. They are not claims
of working peripherals. Before a separately authorized physical acceptance run:

1. Confirm target population against the V3 schematic and card fit/SKU.
2. Obtain explicit permission for writes/destructive persistence tests; record
   the card identity and protected data. Start with read-only identification.
3. Provide a suitable Ethernet cable and router LAN port; observe negotiated
   speed/duplex and test every claimed supported speed with appropriate peers.
4. Arrange operator-assisted power interruption and evidence capture; no
   remotely switchable equipment was supplied. Reset is not power removal.
5. Complete controller implementation, PHY reset/strap and I/O timing review,
   socket-detect polarity, CDC/reset-domain checks, authority/bus tests and
   exact resource qualification before seeking build/programming approval.

**Closure:** schematic dependencies and the proposed equipment/controller plan
are resolved at desktop-review level. Card fit, negotiated link, electrical
behavior and actual resource use remain explicitly unmeasured acceptance gates,
not hidden assumptions or permission to freeze/program the next BIT.
