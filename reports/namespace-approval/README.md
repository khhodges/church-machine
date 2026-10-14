# Namespace approval status

This is historical evidence for the image digest below, not an approval of
the current Phase 1 inputs. During integration, the newer main-project
Namespace state and generated provenance were preserved unchanged.

The exact installed image was re-saved through `/api/boot-image/save-ns`
using its required 428 review and session-bound confirmation handshake.
No raw image bytes, selected artifacts, boot configuration, manifest, or
Namespace abstraction rows changed. Slots 8 and 9 remain empty.

- Image SHA-256: `0ff1b24d76b7010c13b8b50737f4513a771b586be73b8d0fa80a748087070a5b`
- `binding.json`: raw/decoded binding and unchanged-input evidence.
- `simulator.json`: persisted-byte execution, five complete cycles, ten returns,
  zero faults, and CapabilityTest CR0/Enter targets for Thread.2 and Thread.3.
- `freeze-result.json`: actual authenticated freeze endpoint response.

**Not approved:** freeze returns 409 because existing generated Verilog
provenance does not bind this image and the current source commit. No approved
revision identifier or B.1 label was issued. The endpoint has no label field.
No RTL regeneration, synthesis, bitstream generation, or flashing was performed.

The user explicitly declined RTL generation and Yosys processing, kept all
synthesis-related tools prohibited, and directed that approval remain blocked.
This approval work is superseded by the Phase 1 bitstream work. The binding fix
and regression coverage are retained; no approval retry or separate follow-up
build is authorized here. Do not stamp old RTL with new provenance merely to
pass this check.
