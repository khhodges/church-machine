# Artix-7 hardware abstraction — Wukong instance

Status: design definition only. No resources, GTs, Namespace slots, FPGA pins,
or register addresses are allocated by this document.

## Boundary

Artix7 describes hardware resources. A concrete Wukong instance binds that
interface to a board revision and exact machine/bitstream profile. Programmers
choose their Namespace membership; Namespace abstractions construct tables;
SecurityRegulator authorizes and validates privileged activation.

Description is not authority. A named device is not automatically accessible.
The hardware resource catalog is not necessarily the abstraction's execution
E-list or any Namespace's construction C-list.

## Proposed descriptive interface

```text
Artix7(boardProfile, machineProfile)
    Identity: family, device, boardRevision, implementationIdentity
    Memory: wordBits, regions, reservedRegions, alignment
    Resources: resource definitions and implementation evidence
    Options: known but unused or unverified expansion resources

    Describe()
    DescribeResource(petName)
    ListOptions()
    CheckCompatibility(requirements)
```

These are proposed methods, not existing callable services. Memory-region sizes
come from the bound profile, not an Artix-7-wide constant. A Namespace requests
its own variable capacity within supported and authorized allocations.

## Resource status

Every resource describes these independent dimensions:

- **Board support:** confirmed, documented but unverified, absent, or unknown.
- **Implementation:** present in the selected bitstream, development-only,
  absent, or unknown.
- **Physical verification:** evidence tied to the exact board/build, or unknown.
- **Namespace access:** whether this Namespace has an authorized binding.
- **Interface:** registers, extent, clocks, pins and supported operations, only
  when established by the selected profile.

Unavailable interfaces have no invented address or usable GT. Missing evidence
is not treated as support. HDL or a passing unit test is not proof that a
feature is in the loaded FPGA.

## Wukong resource catalog

| Resource | Definition and current evidence |
|---|---|
| LEDs | Current Wukong RTL supports LED outputs. Board notes identify two physical user LEDs; additional register placeholders are not additional physical LEDs. |
| Buttons | Include board inputs, but distinguish a physical reset button from a readable BTN_DEV interface. Verify the selected mapping rather than infer it from the Namespace name. |
| Timer | Describe the tick/time/alarm registers actually implemented by the selected machine profile. |
| UART | Describe supported directions and registers separately from the bridge's transport. Current top-level default is 57,600 baud, not a universal family constant. |
| Machine control | Describe M_BIT_DEV as protected; catalog inclusion never grants raw M access. |
| Ethernet | Include as an unused integration option. V3 port-plan documentation specifies GMII and an RTL8211E-compatible PHY. Older Ethernet/CDC development code exists, but does not prove integration in the current minimal top-level or loaded bitstream. Exact V3 pins and integration must be verified. |
| External RAM / DDR | Expansion option; board device, capacity, controller, calibration and usable region are unverified here. Do not add it to available memory. |
| Nonvolatile flash / SPI | Expansion option; board wiring, device geometry, controller and permitted write regions are unverified here. |
| GPIO expansion | Expansion option; header pins, voltage banks, ownership and conflicts must be verified before use. |
| Display / HDMI | Optional profile feature. Connector availability, clocks, controller and buffer requirements are unverified here. |
| Removable storage / SD | Optional profile feature, not a claim that the current board provides an SD interface. Requires board and controller evidence. |

The last five rows are catalog categories for future profiles, not assertions
that every Wukong or Artix-7 board contains those peripherals. Their presence
must be marked unknown until verified, or absent when a board does not support
them. No automatic fallback to a simulated device is allowed.

For Ethernet, the descriptor should eventually include supported link modes,
PHY/MAC interface, link-status operations, RX/TX queues, buffer bounds and
interrupt/polling behavior. Protocol stacks, routing and application policy
belong to programmer-defined networking abstractions.

## Namespace use

A Namespace definition may express an optional resource without activating it.
If Ethernet is required but unavailable, preparation reports the unmet
requirement; it must not create a working-looking Ethernet capability.
If Ethernet is optional, its absence is explicit in the prepared result.

Activating a new option requires the appropriate board evidence, implemented
and verified machine profile, and authorized resource binding. Listing it in
this abstraction does not authorize synthesizing or flashing a new FPGA image.

## Evidence

- `hardware/wukong_top.py`: concrete top-level behavior, target device and
  default clock/UART parameters. Its introductory “LED blink only” comment is
  stale relative to its UART implementation; inspect the executable RTL.
- `docs/wukong-port-plan.md`: V3 pin findings and GMII Ethernet integration plan.
- `hardware/test_wukong_cdc.py`: Ethernet development tests, not evidence of
  the active board image.

The exact running bitstream has not been identified or attested by this review.
