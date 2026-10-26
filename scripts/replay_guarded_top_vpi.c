/* Drive the retained production top without rewriting/recompiling its RTL.
 * Logical clock cycles only: the existing executable has time precision 1s.
 * The design's counters retain the production 50 MHz/57600 baud parameters.
 * No internal signal is written; UART RX stays idle. Not an upload test.
 */
#include <vpi_user.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>

static vpiHandle clk, reset_n, rx, init, boot, fault, code, nia, rv, rn, ri;
static unsigned cycles, level, seen_init, seen_boot;
static int stopped;
static int handoff_probe;
static int stop_at_boot;
static int program_trial;
static vpiHandle dread_start, dread_done;
static vpiHandle handoff[17];
static const char *handoff_names[] = {
    "core.boot_state", "core.boot_thread_activated", "core.guarded_call_ready",
    "core.halt_req", "step_mode", "step_halted", "trace_stall",
    "tq_len", "tq_ptr", "tq_bidx", "trace_tx_ack", "tx_free",
    "uart_tx.busy", "sentinel_req", "fault_recovery.fault_pending",
    "imem_settled", "core.thread_switch_busy"
};
static PLI_INT32 tick(p_cb_data);
static vpiHandle fetch[8];
static const char *fetch_names[] = {
    "core.imem_addr", "core.imem_fetch_address", "core.imem_valid",
    "core.imem_data", "imem_from_dmem", "imem_rd__data",
    "boot_rom.addr", "boot_rom.data"
};

static vpiHandle find(vpiHandle top, const char *name) {
    int kinds[] = {vpiNet, vpiReg};
    for (unsigned k=0;k<2;k++) {
        vpiHandle it=vpi_iterate(kinds[k],top), h;
        if (!it) continue;
        while ((h=vpi_scan(it))) {
            const char *n=vpi_get_str(vpiName,h);
            if (n && (!strcmp(n,name) || (*n=='\\' && !strcmp(n+1,name)))) {
                vpi_free_object(it); return h;
            }
        }
    }
    vpi_printf("MISSING_SIGNAL %s\n",name); stopped=1; return NULL;
}
static void drive(vpiHandle h, int x) {
    s_vpi_value v={.format=vpiIntVal}; v.value.integer=x;
    vpi_put_value(h,&v,NULL,vpiForceFlag);
}
static uint32_t read32(vpiHandle h, int *unknown) {
    s_vpi_value v={.format=vpiVectorVal}; vpi_get_value(h,&v);
    if (v.value.vector[0].bval) *unknown=1;
    return v.value.vector[0].aval;
}
static unsigned retire_opcode(int *unknown) {
    /* The frozen mapped top declares retire_instr[26:0] unused and removes
     * their drivers. Observe only its actual five-bit opcode interface;
     * do not fabricate a full retired instruction from fetch data or zeros.
     * The launch check must verify this boundary against the frozen netlist.
     */
    s_vpi_value v={.format=vpiVectorVal}; vpi_get_value(ri,&v);
    *unknown=!!((uint32_t)v.value.vector[0].bval & UINT32_C(0xf8000000));
    return (uint32_t)v.value.vector[0].aval >> 27;
}
static void dump(vpiHandle h) {
    s_vpi_value v={.format=vpiVectorVal}; vpi_get_value(h,&v);
    vpi_printf("DETAIL cycle=%u field=%s width=%d aval=%08x xz_mask=%08x\n",
        cycles,vpi_get_str(vpiName,h),vpi_get(vpiSize,h),
        (unsigned)v.value.vector[0].aval,(unsigned)v.value.vector[0].bval);
}
static void snapshot(void) {
    vpiHandle controls[]={init,boot,fault,code,nia,rv,rn,ri};
    for (unsigned i=0;i<8;i++) dump(controls[i]);
    for (unsigned i=0;i<8;i++) dump(fetch[i]);
}
static PLI_INT32 sample(p_cb_data unused) {
    (void)unused; int x=0;
    unsigned initialized=read32(init,&x), booted=read32(boot,&x);
    if (!x && initialized && !seen_init) {
        seen_init=1; vpi_printf("INITIALIZED cycle=%u\n",cycles);
    }
    if (!x && booted && !seen_boot) {
        seen_boot=1; vpi_printf("BOOT_COMPLETE cycle=%u\n",cycles);
    }
    if (seen_init) {
        if (program_trial) {
            int dx=0;
            unsigned ds=read32(dread_start,&dx), dd=read32(dread_done,&dx);
            if (dx) {
                vpi_printf("UNKNOWN_DREAD_CONTROL cycle=%u\n",cycles); stopped=1;
            } else if (ds || dd) {
                vpi_printf("UNEXPECTED_DREAD cycle=%u start=%u done=%u\n",cycles,ds,dd);
                stopped=1;
            }
        }
        unsigned f=read32(fault,&x), c=read32(code,&x), pc=read32(nia,&x);
        if (x) {
            vpi_printf("UNKNOWN_CONTROL cycle=%u\n",cycles); stopped=1;
        } else if (f) {
            vpi_printf("FAULT cycle=%u code=%u nia=%08x\n",cycles,c,pc); stopped=1;
        } else {
            int vx=0, px=0, ix=0;
            unsigned valid=read32(rv,&vx);
            if (vx) {
                vpi_printf("UNKNOWN_RETIRE cycle=%u field=valid\n",cycles);stopped=1;
            } else if (valid) {
                unsigned pc2=read32(rn,&px), opcode=retire_opcode(&ix);
                if (px || ix) {
                    vpi_printf("UNKNOWN_RETIRE cycle=%u nia_unknown=%d opcode_unknown=%d\n",
                               cycles,px,ix);stopped=1;
                }
                else vpi_printf("RETIRE_PENDING cycle=%u nia=%08x opcode=%02x lower27=unavailable\n",
                                cycles,pc2,opcode);
            }
        }
    }
    if (!(cycles%50000)) vpi_printf("PROGRESS cycle=%u initialized=%u boot=%u\n",cycles,seen_init,seen_boot);
    if (handoff_probe && !(cycles%(program_trial ? 50000u : 10000u))) {
        vpi_printf("HANDOFF_SAMPLE cycle=%u\n",cycles);
        snapshot();
        for (unsigned i=0;i<17;i++) dump(handoff[i]);
    }
    if (stop_at_boot && seen_init && booted && !x && !stopped) {
        vpi_printf("BOOT_HANDOFF_OBSERVED cycle=%u (not a program or upload pass)\n",cycles);
        for (unsigned i=0;i<17;i++) dump(handoff[i]);
        stopped=1;
    }
    if (handoff_probe && !stopped && cycles>=(program_trial ? 6000000u : stop_at_boot ? 600000u : 130000u)) {
        vpi_printf("DIAGNOSTIC_LIMIT cycles=%u (not a pass)\n",cycles);
        stopped=1;
    }
    if (stopped) {
        snapshot();
        if (program_trial) { dump(dread_start); dump(dread_done); }
    }
    fflush(stdout);
    if (stopped) vpi_control(vpiFinish,0);
    return 0;
}
static void schedule(void) {
    s_vpi_time t={.type=vpiSimTime,.low=1};
    s_cb_data cb={.reason=cbAfterDelay,.cb_rtn=tick,.time=&t};
    vpi_register_cb(&cb);
}
static PLI_INT32 tick(p_cb_data unused) {
    (void)unused;
    if (stopped) return 0;
    level=!level; drive(clk,level);
    if (!level) {
        cycles++;
        if (cycles>=(program_trial ? 6000000u : 2000000u)) {
            vpi_printf("CYCLE_LIMIT cycles=%u (not a pass)\n",cycles);
            stopped=1;vpi_control(vpiFinish,0);return 0;
        }
        s_vpi_time zero={.type=vpiSimTime};
        s_cb_data cb={.reason=cbReadOnlySynch,.cb_rtn=sample,.time=&zero};
        vpi_register_cb(&cb);
    }
    schedule(); return 0;
}
static PLI_INT32 start(p_cb_data unused) {
    (void)unused;
    s_vpi_vlog_info info;
    if (vpi_get_vlog_info(&info))
        for (int i=0;i<info.argc;i++) {
            if (!strcmp(info.argv[i],"+handoff-probe")) handoff_probe=1;
            if (!strcmp(info.argv[i],"+stop-at-boot")) handoff_probe=stop_at_boot=1;
            if (!strcmp(info.argv[i],"+program-trial")) handoff_probe=program_trial=1;
        }
    vpiHandle top=vpi_handle_by_name("church_wukong_xc7a100t",NULL);
    if (!top) {vpi_printf("MISSING_TOP\n");vpi_control(vpiFinish,0);return 0;}
    clk=find(top,"clk");reset_n=find(top,"rst_n");rx=find(top,"uart_rx_pin");
    init=find(top,"hw_init_done");boot=find(top,"core.boot_complete");
    fault=find(top,"core.fault_valid");code=find(top,"core.fault");nia=find(top,"core.nia");
    rv=find(top,"core.retire_valid");rn=find(top,"core.retire_nia");ri=find(top,"core.retire_instr");
    for (unsigned i=0;i<8;i++) fetch[i]=find(top,fetch_names[i]);
    if (handoff_probe)
        for (unsigned i=0;i<17;i++) handoff[i]=find(top,handoff_names[i]);
    if (program_trial) {
        dread_start=find(top,"core.u_dread.start");
        dread_done=find(top,"core.u_dread.done");
    }
    if (stopped) {vpi_control(vpiFinish,0);return 0;}
    drive(clk,0);drive(reset_n,1);drive(rx,1);
    vpi_printf("REPLAY_START external pins only; pre-edge observations; no UART commands\n");
    schedule();return 0;
}
static void registration(void) {
    s_cb_data cb={.reason=cbStartOfSimulation,.cb_rtn=start};vpi_register_cb(&cb);
}
void (*vlog_startup_routines[])(void)={registration,0};
