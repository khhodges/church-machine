"""hardware/wukong_xc7a100t.py — QMTECH Wukong XC7A100T top-level
======================================================================

Top-level Amaranth module for the QMTECH Wukong XC7A100T (Xilinx XC7A100T).
Wires the MMCM, RgmiiMac, Church Machine core, and the MMIO EthernetDevice
register block that the CM accesses via its capability.

Board: QMTECH Wukong v1.1
  System clock: 200 MHz oscillator (W19)
  RGMII PHY:    RTL8211E (Gigabit, run at 100BASE-T)
  FPGA:         Xilinx XC7A100T-2FGG676C
  No Sapphire SoC — the CM runs directly on the FPGA fabric

Clock domains
─────────────
  'sync'  100 MHz  — Church Machine core clock
  'eth'    25 MHz  — RGMII TX/RX clock (100BASE-T)

MMIO EthernetDevice register block (base 0x40001000)
─────────────────────────────────────────────────────
The CM accesses the Ethernet hardware via a capability (EthernetDevice GT,
token 00003300).  DREAD/DWRITE instructions to the GT's MMIO base reach the
registers below.  Only the CM core (in the 'sync' domain) touches these
registers; values crossing to the 'eth' domain use 2-FF synchronisers.

  Offset  Width  Register        Direction
  ------  -----  ---------       ---------
  0       32     ETH_CTRL        W  bit[0]=enable, bit[1]=reset (sync→eth via FF)
  1       32     ETH_STATUS      R  0=down, 1=up, 2=negotiating  (eth→sync via FF)
  2       32     ETH_TX_LEN      W  write byte length to trigger TX
  3       32     ETH_RX_LEN      R  byte count of pending frame (0 = empty)
  4       32     ETH_IP_ADDR     W  packed IPv4 (network byte order)
  5       32     ETH_PORT        W  UDP port number
  6       32     ETH_TX_DATA     W  TX FIFO (write before ETH_TX_LEN)
  7       32     ETH_RX_DATA     R  RX FIFO (drain after ETH_RX_LEN != 0)

RGMII pin map (QMTECH Wukong v1.1 schematic)
─────────────────────────────────────────────
  ETH_TXC    F4     ETH_TXCTL  G1
  ETH_TXD[0] E3     ETH_TXD[1] E1     ETH_TXD[2] F3     ETH_TXD[3] F1
  ETH_RXC    D4     ETH_RXCTL  C4
  ETH_RXD[0] D3     ETH_RXD[1] D1     ETH_RXD[2] E4     ETH_RXD[3] E2
  ETH_MDC    K1     ETH_MDIO   L1     ETH_RSTN   H1
  SYS_CLK    W19
"""

from amaranth import *
from amaranth.lib.cdc import FFSynchronizer
import amaranth.lib.memory as _lib_mem
from .rgmii_mac import RgmiiMac

# Board MAC address (locally administered, CE:11 prefix)
_BOARD_MAC = b'\x02\xce\x11\x00\x00\x01'

# Default callhome payload token embedded in the fixed UDP payload
_ETH_TOKEN = 0x00003300

# Callhome UDP payload (minimal, N=0 requests; Locator fills in real requests at run time)
_CALLHOME_PAYLOAD = (
    (0xCE110001).to_bytes(4, 'big') +  # CALLHOME_MAGIC (server parser requires this)
    _ETH_TOKEN .to_bytes(4, 'big') +   # sender token (ETHERNET_TOKEN 0x00003300)
    b'\x00\x00\x00\x00' +              # CM version (filled by firmware at runtime)
    _BOARD_MAC +                        # MAC
    b'\x00\x00' +                       # pad
    b'\x00\x00\x00\x00' +              # uptime
    b'\x00\x00'                         # N=0 requests
)


class WukongXC7A100T(Elaboratable):
    """QMTECH Wukong XC7A100T top-level module.

    Instantiates an MMCM (200→100/25 MHz), RgmiiMac, and the MMIO register
    block that the Church Machine core uses to access Ethernet via capability.

    Top-level ports
    ---------------
    clk_200mhz  in   200 MHz system clock (W19)
    rst_n       in   Active-low reset button

    rgmii_txc   out  25 MHz TX clock to PHY
    rgmii_txd   out  TX data nibble [3:0]
    rgmii_txctl out  TX control / TX-EN
    rgmii_rxc   in   25 MHz RX clock from PHY
    rgmii_rxd   in   RX data nibble [3:0]
    rgmii_rxctl in   RXDV / RXDV^RXER
    eth_mdc     out  MDIO management clock
    eth_mdio_o  out  MDIO data output
    eth_mdio_oe out  MDIO output-enable (1 = drive, 0 = tristate)
    eth_mdio_i  in   MDIO data input
    eth_rstn    out  PHY active-low reset

    MMIO interface (CM core → EthernetDevice register block)
    ---------------------------------------------------------
    mmio_addr   in   4-bit register offset (0–7)
    mmio_wdata  in   32-bit write data
    mmio_we     in   Write enable
    mmio_rdata  out  32-bit read data
    mmio_re     in   Read enable (combinational)

    Status
    ------
    link_up     out  1 = Ethernet link established
    eth_busy    out  1 = MAC is busy (reset / MDIO / TX in progress)
    """

    def __init__(self, src_mac=_BOARD_MAC, payload=_CALLHOME_PAYLOAD):
        self.src_mac = src_mac
        self.payload = payload

        # Top-level clock / reset
        self.clk_200mhz = Signal()
        self.rst_n       = Signal(init=1)

        # RGMII TX
        self.rgmii_txc   = Signal()
        self.rgmii_txd   = Signal(4)
        self.rgmii_txctl = Signal()

        # RGMII RX
        self.rgmii_rxc   = Signal()
        self.rgmii_rxd   = Signal(4)
        self.rgmii_rxctl = Signal()

        # MDIO
        self.eth_mdc     = Signal()
        self.eth_mdio_o  = Signal()
        self.eth_mdio_oe = Signal()
        self.eth_mdio_i  = Signal()
        self.eth_rstn    = Signal()

        # MMIO register interface (from CM core, 'sync' domain)
        self.mmio_addr  = Signal(4)
        self.mmio_wdata = Signal(32)
        self.mmio_we    = Signal()
        self.mmio_rdata = Signal(32)
        self.mmio_re    = Signal()

        # Status outputs (registered, 'sync' domain after 2-FF sync)
        self.link_up  = Signal()
        self.eth_busy = Signal()

    def elaborate(self, platform):
        m = Module()

        # ── Clock domains ──────────────────────────────────────────────────────
        # 'sync' = 100 MHz Church Machine core clock
        # 'eth'  = 25 MHz RGMII TX/RX clock (RgmiiMac runs here)
        m.domains.sync = cd_sync = ClockDomain("sync")
        m.domains.eth  = cd_eth  = ClockDomain("eth")

        # ── MMCM: 200 MHz → 100 MHz (sync) + 25 MHz (eth) ────────────────────
        # VCO = 200 × 5.0 = 1000 MHz  (within 7-series 600–1200 MHz range)
        # CLKOUT0 = 1000 / 10.0 = 100 MHz
        # CLKOUT1 = 1000 / 40   = 25 MHz
        mmcm_clkfb   = Signal()
        mmcm_clk100  = Signal()
        mmcm_clk25   = Signal()
        mmcm_locked  = Signal()

        m.submodules.mmcm = Instance(
            "MMCME2_ADV",
            p_BANDWIDTH          = "OPTIMIZED",
            p_CLKFBOUT_MULT_F    = 5.0,
            p_CLKFBOUT_PHASE     = 0.0,
            p_DIVCLK_DIVIDE      = 1,
            p_CLKIN1_PERIOD      = 5.0,    # 200 MHz → 5 ns period
            p_CLKOUT0_DIVIDE_F   = 10.0,
            p_CLKOUT0_DUTY_CYCLE = 0.5,
            p_CLKOUT0_PHASE      = 0.0,
            p_CLKOUT1_DIVIDE     = 40,
            p_CLKOUT1_DUTY_CYCLE = 0.5,
            p_CLKOUT1_PHASE      = 0.0,
            p_STARTUP_WAIT       = "FALSE",
            i_CLKIN1  = self.clk_200mhz,
            i_CLKFBIN = mmcm_clkfb,
            i_RST     = ~self.rst_n,
            o_CLKFBOUT = mmcm_clkfb,
            o_CLKOUT0  = mmcm_clk100,
            o_CLKOUT1  = mmcm_clk25,
            o_LOCKED   = mmcm_locked,
        )

        # BUFG on each output clock
        m.submodules.bufg_sync = Instance(
            "BUFG", i_I=mmcm_clk100, o_O=cd_sync.clk)
        m.submodules.bufg_eth  = Instance(
            "BUFG", i_I=mmcm_clk25,  o_O=cd_eth.clk)

        # Reset: de-assert after MMCM locks (synchronised to each domain)
        m.d.comb += [
            cd_sync.rst.eq(~mmcm_locked | ~self.rst_n),
            cd_eth.rst.eq(~mmcm_locked  | ~self.rst_n),
        ]

        # ── RgmiiMac in the 'eth' domain ──────────────────────────────────────
        # RgmiiMac's 'sync' domain maps to 'eth' via Amaranth hierarchy rules.
        mac = m.submodules.mac = DomainRenamer("eth")(
            RgmiiMac(src_mac=self.src_mac, payload=self.payload,
                     clk_freq=25_000_000))

        m.d.comb += [
            # TX outputs
            self.rgmii_txc.eq(mac.rgmii_txc),
            self.rgmii_txd.eq(mac.rgmii_txd),
            self.rgmii_txctl.eq(mac.rgmii_txctl),
            # RX inputs
            mac.rgmii_rxc.eq(self.rgmii_rxc),
            mac.rgmii_rxd.eq(self.rgmii_rxd),
            mac.rgmii_rxctl.eq(self.rgmii_rxctl),
            # MDIO
            self.eth_mdc.eq(mac.mdc),
            self.eth_mdio_o.eq(mac.mdio_o),
            self.eth_mdio_oe.eq(mac.mdio_oe),
            mac.mdio_i.eq(self.eth_mdio_i),
            # PHY reset
            self.eth_rstn.eq(mac.phy_rst_n),
        ]

        # ── 2-FF synchronisers: eth → sync ────────────────────────────────────
        link_up_sync = Signal()
        m.submodules.sync_link_up = FFSynchronizer(
            mac.link_up, link_up_sync, o_domain="sync")
        m.d.comb += self.link_up.eq(link_up_sync)

        busy_sync = Signal()
        m.submodules.sync_busy = FFSynchronizer(
            mac.busy, busy_sync, o_domain="sync")
        m.d.comb += self.eth_busy.eq(busy_sync)

        # ── RX Memory: dual-clock BRAM (eth write, sync read) ─────────────────
        # mac.rx_valid/rx_data fire in the 'eth' clock domain.
        # Bytes are assembled into 32-bit big-endian words and stored via the eth
        # write port of an Amaranth lib.memory.Memory (maps to Xilinx SDP BRAM with
        # independent clocks on synthesis — CDC-correct at the hardware level).
        # Only the single-bit frame-ready flag crosses the domain boundary via
        # FFSynchronizer; the multi-bit data bus never crosses directly.
        rx_mem = _lib_mem.Memory(shape=32, depth=64, init=[])
        m.submodules.rx_mem = rx_mem
        rx_wp = rx_mem.write_port(domain="eth")
        rx_rp = rx_mem.read_port(domain="sync", transparent_for=[])

        # eth domain: byte phase + word accumulator + write pointer
        rx_byte_phase    = Signal(2)    # 0-3: byte position within current word
        rx_word_acc      = Signal(32)   # partial word accumulator
        rx_wptr          = Signal(6)    # memory write pointer (counts words written)
        rx_len_words     = Signal(7)    # words in most-recently completed frame
        rx_frame_rdy_eth = Signal()     # set on rx_done, cleared on drain-ack

        # Write port defaults: disabled
        m.d.comb += [rx_wp.addr.eq(rx_wptr), rx_wp.data.eq(0), rx_wp.en.eq(0)]

        # Byte → word assembly in eth domain
        with m.If(mac.rx_valid):
            m.d.eth += rx_byte_phase.eq(rx_byte_phase + 1)
            with m.Switch(rx_byte_phase):
                with m.Case(0):
                    m.d.eth += rx_word_acc[24:32].eq(mac.rx_data)
                with m.Case(1):
                    m.d.eth += rx_word_acc[16:24].eq(mac.rx_data)
                with m.Case(2):
                    m.d.eth += rx_word_acc[8:16].eq(mac.rx_data)
                with m.Case(3):
                    # Combinatorially assert write enable; Memory clocks the write
                    # on the eth rising edge — no cross-domain path for the data.
                    m.d.comb += [
                        rx_wp.en.eq(1),
                        rx_wp.data.eq(Cat(mac.rx_data,
                                          rx_word_acc[8:16],
                                          rx_word_acc[16:24],
                                          rx_word_acc[24:32])),
                    ]
                    m.d.eth += rx_wptr.eq(rx_wptr + 1)

        # Frame done: latch word count and set ready flag
        with m.If(mac.rx_done):
            m.d.eth += [
                rx_len_words.eq(
                    Mux(rx_byte_phase != 0,
                        rx_wptr + 1,     # partial word pending
                        rx_wptr)),
                rx_frame_rdy_eth.eq(1),
                rx_byte_phase.eq(0),
                rx_wptr.eq(0),
            ]
            # Flush any partial word (less than 4 bytes) as a zero-padded word.
            # rx_valid and rx_done are mutually exclusive so rx_wp.en has no conflict.
            with m.If(rx_byte_phase != 0):
                m.d.comb += [
                    rx_wp.en.eq(1),
                    rx_wp.data.eq(Cat(Const(0, 8),
                                      rx_word_acc[8:16],
                                      rx_word_acc[16:24],
                                      rx_word_acc[24:32])),
                ]

        # sync domain: FFSynchronizer for frame-ready flag (1 bit — safe CDC)
        rx_frame_rdy_sync = Signal()
        m.submodules.sync_rx_frame_rdy = FFSynchronizer(
            rx_frame_rdy_eth, rx_frame_rdy_sync, o_domain="sync")

        # sync domain: latch word count when frame_rdy arrives.
        # rx_len_words is written in 'eth' atomically with rx_frame_rdy_eth, so it
        # is stable for ≥2 eth cycles (≥8 sync cycles at 100/25 MHz) before
        # rx_frame_rdy_sync rises — metastability risk is negligible.
        rx_len_words_sync  = Signal(7)
        rx_rptr            = Signal(6)    # read pointer (CM drains via ETH_RX_DATA)
        rx_words_remaining = Signal(7)    # = rx_len_words_sync - rx_rptr

        m.d.comb += rx_words_remaining.eq(rx_len_words_sync - rx_rptr)

        # Latch word count on first cycle frame_rdy_sync is high
        rx_frame_rdy_prev = Signal()
        m.d.sync += rx_frame_rdy_prev.eq(rx_frame_rdy_sync)
        with m.If(rx_frame_rdy_sync & ~rx_frame_rdy_prev):
            m.d.sync += [rx_len_words_sync.eq(rx_len_words), rx_rptr.eq(0)]

        # Drain-ack: once rptr reaches len, signal eth domain to clear ready flag
        rx_drain_done = Signal()
        m.d.comb += rx_drain_done.eq(
            rx_frame_rdy_sync & (rx_rptr >= rx_len_words_sync))
        rx_drain_done_eth = Signal()
        m.submodules.sync_drain_done = FFSynchronizer(
            rx_drain_done, rx_drain_done_eth, o_domain="eth")
        with m.If(rx_drain_done_eth):
            m.d.eth += rx_frame_rdy_eth.eq(0)

        # RX read port address is driven from rx_rptr (1-cycle latency):
        # rx_rp.data at sync cycle N = memory[rx_rptr at sync cycle N-1].
        # The CLOOMC drain loop (dread + increment = ≥2 sync cycles per word)
        # satisfies the latency: rptr is stable for ≥1 cycle before next read.
        m.d.comb += rx_rp.addr.eq(rx_rptr)

        # ── MMIO register block (EthernetDevice capability, CM 'sync' domain) ─
        # The CM core accesses these registers via DREAD/DWRITE to the
        # EthernetDevice capability GT (MMIO base 0x40001000).
        eth_ctrl_reg     = Signal(32)   # ETH_CTRL
        eth_ip_reg       = Signal(32)   # ETH_IP_ADDR
        eth_port_reg     = Signal(16)   # ETH_PORT
        eth_tx_len_reg   = Signal(11)   # ETH_TX_LEN byte count (informational)
        tx_wptr          = Signal(7)    # write pointer into tx_sync_buf
        tx_len_bytes_reg = Signal(11)   # byte count of current TX frame
        tx_toggle        = Signal()     # flips each time CM writes ETH_TX_LEN
        tx_trigger       = Signal()

        # ── Sync-domain TX word buffer ──────────────────────────────────────
        # The CM fills this buffer word-by-word via ETH_TX_DATA (reg 6) writes,
        # then writes ETH_TX_LEN (reg 2) to trigger TX.
        # All MMIO writes are in the 'sync' domain.  The buffer is NEVER read
        # directly by the eth domain; instead the copy FSM below registers each
        # word into an eth-domain Array (tx_eth_buf) before TX starts.
        TX_BUF_WORDS = 128
        tx_sync_buf = Array(Signal(32, name=f"tsb{i}") for i in range(TX_BUF_WORDS))

        # MMIO write
        with m.If(self.mmio_we):
            with m.Switch(self.mmio_addr):
                with m.Case(0):   # ETH_CTRL
                    m.d.sync += eth_ctrl_reg.eq(self.mmio_wdata)
                with m.Case(2):   # ETH_TX_LEN — byte count; triggers copy + TX
                    m.d.sync += [
                        eth_tx_len_reg.eq(self.mmio_wdata[:11]),
                        tx_len_bytes_reg.eq(self.mmio_wdata[:11]),
                        tx_trigger.eq(1),
                        tx_wptr.eq(0),      # reset write pointer for next frame
                    ]
                with m.Case(4):   # ETH_IP_ADDR
                    m.d.sync += eth_ip_reg.eq(self.mmio_wdata)
                with m.Case(5):   # ETH_PORT
                    m.d.sync += eth_port_reg.eq(self.mmio_wdata[:16])
                with m.Case(6):   # ETH_TX_DATA — write one 32-bit word, advance pointer
                    # Write the word and advance the pointer in the same cycle.
                    # All writes are fully in the sync domain — no CDC here.
                    m.d.sync += [
                        tx_sync_buf[tx_wptr].eq(self.mmio_wdata),
                        tx_wptr.eq(tx_wptr + 1),
                    ]

        # Flip toggle one cycle after ETH_TX_LEN write (tx_trigger pulse)
        with m.If(tx_trigger):
            m.d.sync += [
                tx_toggle.eq(~tx_toggle),
                tx_trigger.eq(0),
            ]

        # ── TX CDC: toggle synchronizer + copy FSM ──────────────────────────
        #
        # When the CM writes ETH_TX_LEN, tx_toggle flips (sync domain).
        # The toggle propagates to the 'eth' domain through an FFSynchronizer
        # (adds ~3 eth cycles ≈ 120 ns of latency).  Because the CM writes ALL
        # ETH_TX_DATA words BEFORE writing ETH_TX_LEN, tx_sync_buf is fully
        # stable for ≥3 eth cycles by the time the copy FSM starts.
        #
        # The copy FSM (eth domain) then:
        #   1. Registers each tx_sync_buf word into the eth-domain tx_eth_buf,
        #      one word per eth cycle.  (Stable data window → safe multi-bit capture.)
        #   2. After the last word is copied, pulses mac.send for one eth cycle.
        #
        # mac.tx_ext_word is driven combinatorially from tx_eth_buf[mac.tx_word_addr].
        # The MAC's TX FSM reads one nibble per eth cycle from the word, so the entire
        # TX data path is in the eth domain after the copy — no further CDC.

        tx_toggle_eth      = Signal()
        tx_toggle_eth_prev = Signal()
        m.submodules.sync_tx_toggle = FFSynchronizer(
            tx_toggle, tx_toggle_eth, o_domain="eth")
        m.d.eth += tx_toggle_eth_prev.eq(tx_toggle_eth)
        tx_copy_trigger = Signal()   # one-cycle pulse in eth domain
        m.d.comb += tx_copy_trigger.eq(tx_toggle_eth ^ tx_toggle_eth_prev)

        # Eth-domain copy buffer (purely in eth domain; read by MAC TX FSM)
        tx_eth_buf  = Array(Signal(32, name=f"teb{i}") for i in range(TX_BUF_WORDS))
        tx_copy_idx = Signal(7)      # copy loop counter (eth domain)
        tx_len_words_eth = Signal(7) # words to copy (eth domain, latched at copy start)
        tx_n_nibs_eth    = Signal(12)# nibble count (eth domain, latched at copy start)

        # Compute sync-domain values; sampled by eth domain at copy trigger.
        # Both are stable for ≥3 eth cycles before tx_copy_trigger rises.
        tx_len_words_comb = Signal(7)
        tx_n_nibs_comb    = Signal(12)
        m.d.comb += [
            tx_len_words_comb.eq((tx_len_bytes_reg + 3) >> 2),  # ceil(len/4)
            tx_n_nibs_comb.eq(tx_len_bytes_reg << 1),           # bytes × 2
        ]

        # mac.send default (driven HIGH only in TRIGGER state below)
        m.d.comb += mac.send.eq(0)

        with m.FSM(domain="eth", name="tx_copy_fsm"):
            with m.State("IDLE"):
                # On toggle edge: latch frame dimensions and start copy
                with m.If(tx_copy_trigger):
                    m.d.eth += [
                        tx_copy_idx.eq(0),
                        tx_len_words_eth.eq(tx_len_words_comb),
                        tx_n_nibs_eth.eq(tx_n_nibs_comb),
                    ]
                    m.next = "COPY"

            with m.State("COPY"):
                # Register one sync-domain word into the eth-domain buffer.
                # tx_sync_buf data is stable (written before ETH_TX_LEN toggle),
                # so this single-cycle register capture is CDC-safe.
                m.d.eth += [
                    tx_eth_buf[tx_copy_idx].eq(tx_sync_buf[tx_copy_idx]),
                    tx_copy_idx.eq(tx_copy_idx + 1),
                ]
                with m.If(tx_copy_idx == tx_len_words_eth - 1):
                    m.next = "TRIGGER"

            with m.State("TRIGGER"):
                # All words are in the eth buffer.  Pulse mac.send for one eth cycle.
                m.d.comb += mac.send.eq(1)
                m.next = "IDLE"

        # Drive MAC ext-TX ports (combinatorial from eth-domain tx_eth_buf)
        # tx_eth_buf[mac.tx_word_addr] is a same-domain Array read — no CDC.
        m.d.comb += [
            mac.tx_ext_word.eq(tx_eth_buf[mac.tx_word_addr]),
            mac.tx_use_ext.eq(1),           # always use eth buffer (boot ROM pre-fills it)
            mac.tx_n_nibs_ext.eq(tx_n_nibs_eth),
        ]

        # MMIO read (combinational)
        # ETH_RX_DATA (reg 7) uses the dual-clock Memory read port (rx_rp) with
        # 1-cycle latency: rx_rp.data reflects memory[rx_rptr from the previous
        # sync cycle].  The CLOOMC drain loop (dread + increment = ≥2 sync cycles
        # per word) ensures at least 1 idle cycle between consecutive reads.
        with m.Switch(self.mmio_addr):
            with m.Case(0):
                m.d.comb += self.mmio_rdata.eq(eth_ctrl_reg)
            with m.Case(1):
                # ETH_STATUS: 0=down, 1=up, 2=negotiating/busy
                # Matches Ethernet.Status() → 0|1|2 contract in locator_ethernet.cloomc
                m.d.comb += self.mmio_rdata.eq(
                    Mux(link_up_sync, 1, Mux(busy_sync, 2, 0)))
            with m.Case(2):
                m.d.comb += self.mmio_rdata.eq(eth_tx_len_reg)
            with m.Case(3):   # ETH_RX_LEN: byte count of pending frame (per API spec)
                # rx_words_remaining × 4 converts word count to byte count.
                # This matches the Ethernet abstraction API contract: Receive()
                # returns byte count, and ETH_RX_LEN gives the same measure.
                m.d.comb += self.mmio_rdata.eq(
                    Mux(rx_frame_rdy_sync, rx_words_remaining << 2, 0))
            with m.Case(4):
                m.d.comb += self.mmio_rdata.eq(eth_ip_reg)
            with m.Case(5):
                m.d.comb += self.mmio_rdata.eq(eth_port_reg)
            with m.Case(7):   # ETH_RX_DATA: drain one word from RX Memory per read.
                # rx_rp.data = memory[rx_rptr_{prev}] — see latency note above.
                m.d.comb += self.mmio_rdata.eq(
                    Mux(rx_frame_rdy_sync & (rx_rptr < rx_len_words_sync),
                        rx_rp.data,
                        0))
                # Advance read pointer when CM reads this register
                with m.If(self.mmio_re & rx_frame_rdy_sync &
                          (rx_rptr < rx_len_words_sync)):
                    m.d.sync += rx_rptr.eq(rx_rptr + 1)
            with m.Default():
                m.d.comb += self.mmio_rdata.eq(0)

        return m
