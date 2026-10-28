'use strict';

// Candidate sources only. Nothing in this module publishes or selects a LUMP.
// Data offsets are resolved by the offline builder from unique .word markers.
const privateLoad = 'LOAD CR2, CR6, #1';
function sources() {
    const checks = `
LOAD CR0, CR6, #1
LOAD CR1, CR6, #2
LOAD CR2, CR6, #3
LOAD CR3, CR6, #4
LOAD CR4, CR6, #5
LOAD CR11, CR6, #6
TPERM CR11, EXACT, CR4
TPERM CR0, E
TPERM CR1, RW
TPERM CR2, RW
TPERM CR4, RW
TPERM CR0, L
LOADEQ CR0, CR6, #2
LOADNE CR0, CR6, #1
IADD DR1, DR0, #42
IADD DR2, DR1, #8
ISUB DR3, DR2, DR1
MCMP DR1, DR2
IADD DR4, DR0, #1
SHL DR4, DR4, 3
SHR DR4, DR4, 1
CALL CR6[ide.SelfTest], #0
`;
    let serial = 0;
    const tx = value => {
        const label = `poll_${serial++}`;
        return `${value == null ? '' : `IADD DR5, DR0, #${value}\n`}
DWRITE DR5, CR4, 0, DR0
${label}:
DREAD DR6, CR4, 0, DR1
ISUB DR7, DR6, #1
BRANCHEQ ${label}
`;
    };
    const text = value => [...value].map(c => tx(c.charCodeAt(0))).join('');
    // Decimal unsigned conversion: at most nine subtractions per place.
    // Compare via carry (unsigned), not the sign bit of a 32-bit value.
    const decimal = Array.from({length:10}, (_, i) => {
        const suffix = 9 - i;
        return `
DREAD DR9, CR2, #@div${suffix}@
IADD DR5, DR0, #0
digit_${suffix}:
MCMP DR8, DR9
BRANCHCC ready_${suffix}
ISUB DR8, DR8, DR9
IADD DR5, DR5, #1
BRANCH digit_${suffix}
ready_${suffix}:
${suffix ? `IADD DR10, DR10, DR5\nBRANCHEQ skip_${suffix}` : ''}
IADD DR5, DR5, #48
${tx(null)}
skip_${suffix}:
`;
    }).join('');
    return {
        'ide.Alice': `abstraction ide.Alice {
capabilities { SELF E, ide.Alice RW }
method Stash() {
LOAD CR1, CR6, #1
DWRITE DR1, CR1, #9
RETURN
}
method Reveal() {
LOAD CR1, CR6, #1
DREAD DR1, CR1, #9
RETURN
; Fresh-image initialization only. This data word is never executed.
.word 41
}
}`,
        'ide.AliceDriver': `abstraction ide.AliceDriver {
capabilities { SELF E, ide.AliceDriver RW, ide.Alice E }
method Run() {
LOAD CR1, CR6, #2
CALL CR1, #1
${privateLoad}
DREAD DR2, CR2, #@expected@
MCMP DR1, DR2
BRANCHNE Failed
; A mismatch stops before Stash; never repair lost state.
IADD DR1, DR1, #1
LOAD CR1, CR6, #2
CALL CR1, #0
LOAD CR1, CR6, #2
CALL CR1, #1
${privateLoad}
DREAD DR2, CR2, #@expected@
IADD DR2, DR2, #1
MCMP DR1, DR2
BRANCHNE Failed
DWRITE DR1, CR2, #@expected@
RETURN
Failed:
HALT
.word 0x4eca0001
}
}`,
        'ide.MalloryDriver': `abstraction ide.MalloryDriver {
capabilities { SELF E, ide.Mallory E }
method Run() {
LOAD CR1, CR6, #1
CALL CR1, #0
; Missing-row LOAD must fault, never return here.
HALT
}
}`,
        'ide.WukongCallHome': `abstraction ide.WukongCallHome {
; Only local diagnostic storage, LED and UART. No Alice authority.
capabilities { SELF E, ide.WukongCallHome RW, ide.LED_DEV RW, ide.UART_DEV RW }
method Run() {
${privateLoad}
LOAD CR3, CR6, #2
LOAD CR4, CR6, #3
IADD DR1, DR0, #1
DWRITE DR1, CR3, 0, DR0
${text('CM:WUKONG Alice=')}
DREAD DR8, CR2, #@valid@
ISUB DR8, DR8, #1
BRANCHNE no_sample
DREAD DR8, CR2, #@sample@
IADD DR10, DR0, #0
${decimal}
BRANCH fault_field
no_sample:
${text('unavailable')}
fault_field:
${text(' HF=')}
DREAD DR8, CR2, #@fault@
ISUB DR8, DR8, #0
BRANCHNE known_fault
${text('none')}
BRANCH line_end
known_fault:
; No FPGA wall clock or host-to-board time interface is assumed.
${text('unavailable')}
line_end:
${text('\r\n')}
RETURN
}
method Sample() {
; DR1 is the verified unsigned Alice read-back. Store numeric data only.
${privateLoad}
DWRITE DR1, CR2, #@sample@
IADD DR2, DR0, #1
DWRITE DR2, CR2, #@valid@
RETURN
}
method Fault() {
; Known event, unavailable event date/time. Retain until fresh image.
${privateLoad}
IADD DR2, DR0, #1
DWRITE DR2, CR2, #@fault@
RETURN
.word 0x4eca0002
.word 0x4eca0003
.word 0x4eca0004
${Array.from({length:10}, (_, i) => `.word ${10 ** i}`).join('\n')}
}
}`,
        'ide.CapabilityTest': `abstraction ide.CapabilityTest {
capabilities {
SELF E, ide.SelfTest E, ide.LED_DEV RW, ide.UART_DEV RW,
ide.BTN_DEV R, ide.TIMER_DEV RW, ide.M_BIT_DEV RW,
ide.WukongCallHome E, ide.Thread2, ide.Thread3, ide.BootThread,
ide.AliceDriver E, ide.MalloryDriver E
}
method Run() {
Start:
; Preserve the selected baseline's capability/arithmetic checks and calls.
${checks}
CALL CR6[ide.WukongCallHome], #0
CHANGE CR6, #8
BRANCH Start
}
method AliceRun() {
AliceTurn:
${checks}
CALL CR6[ide.AliceDriver], #0
CALL CR6[ide.WukongCallHome], #1
CALL CR6[ide.WukongCallHome], #0
CHANGE CR6, #9
BRANCH AliceTurn
}
method MalloryRun() {
MalloryTurn:
${checks}
CALL CR6[ide.WukongCallHome], #0
CALL CR6[ide.MalloryDriver], #0
; Unreachable on the deliberate attack. No skip or normal return is assumed.
HALT
}
}`,
        'ide.AmoebaStartup': `abstraction ide.AmoebaStartup {
capabilities { SELF E, ide.CapabilityTest E, ide.WukongCallHome E }
method Start() {
; Fresh Threads have DR3=0. Existing fault entry supplies save status 1/2.
; This executes once per entry, never on ordinary CapabilityTest turns.
ISUB DR4, DR3, #0
BRANCHEQ Init
CALL CR6[ide.WukongCallHome], #2
Init:
CALL CR6[ide.CapabilityTest], #0
HALT
}
method AliceStart() {
CALL CR6[ide.CapabilityTest], #1
HALT
}
method MalloryStart() {
CALL CR6[ide.CapabilityTest], #2
HALT
}
}`,
    };
}
module.exports = {sources};
