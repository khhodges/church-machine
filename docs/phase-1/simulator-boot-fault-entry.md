# Simulator Boot fault entry

The ascending-Namespace private simulator supports the approved direct
Boot.Thread stash contract. This is a functional local-memory model, not
evidence of RTL port timing or physical hardware acceptance.

## Use with your Boot Namespace

1. Save your Namespace design and its exact LUMP assignments.
2. In **Selected design · private simulator**, select **Fault entry handler**.
   Select the executable that will handle faults, not necessarily the ordinary
   startup entry. No handler is selected automatically.
3. Choose **Prepare fresh simulation**. The selected handler, root, slot-2
   Boot.Thread and exact resident handler bytes are bound to this preparation.
4. Run or Step. A supported numeric machine fault stashes into Boot.Thread,
   attempts one outgoing save and enters the configured handler at offset zero.

Changing the Namespace or handler requires fresh preparation. This selection
is private-simulation configuration, not a saved Namespace edit or permission
to install hardware. With no handler selected, faults retain stop-on-fault
behavior.

Boot entry exposes original Thread/Namespace in CR1/CR2, fault code/address/
instruction in DR1/DR2/DR4, save status in DR3 (1 complete, 2 failed), and a
known secondary architectural code in DR5. CR13 is untouched. The original
Namespace is used to validate the foreign references before Boot activation.

The handler, not the simulator, decides how to restart application work.
Returning through the poison root is not an application restart.

## Failure boundary

An invalid configuration, unsafe overlap, failed stash/readback, invalid
foreign reference or failed activation enters the terminal catastrophic state.
The panel models LED 1 with a one-second toggle, two-second cycle. There is no
retry or automatic image reset. Software-only faults without an approved
numeric code, or save failures without a known secondary code, also fail
closed rather than inventing hardware error numbers.

The model checks synchronous writes by readback; it does not claim to model
physical arbitration, accepted bus-write drain, clock failure or a timeout.
Those remain separate RTL proof obligations. Cross-root references are carried
for this immediate handoff, not a new portable Thread serialization contract.

Run `node simulator/test_namespace_runtime_core.js` for the fault-entry and
ordinary Namespace SWITCH regression checks.
