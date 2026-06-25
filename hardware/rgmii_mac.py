"""hardware/rgmii_mac.py — Minimal RGMII MAC for QMTECH Wukong XC7A100T
=======================================================================

Targets the on-board Realtek RTL8211E Gigabit Ethernet PHY via RGMII.

Release 1 scope (step 1 — this file only):
  - PHY hardware reset held low ≥500 ms, then released
  - MDIO init sequence: ANAR advertisement + BMCR autoneg-enable/restart
  - Periodic BMSR poll (every ~2 s) to track link_up
  - 100BASE-T TX path: pre-built Ethernet/IPv4/UDP/call-home frame
  - Xilinx 7-series ODDR instances for RGMII TXC, TXD[3:0], TXCTL
  - All RTL stored in the caller's 'eth' clock domain (25 MHz)

NOT in release 1 (future steps):
  - RGMII RX / IDDR deserialisation
  - Gigabit (125 MHz DDR) TX path
  - Dynamic payload TX
  - IP or UDP checksum over the payload (UDP checksum is optional in IPv4)

Wiring in wukong_xc7a100t.py (step 2):
  - MMCM CLKOUT0 = 100 MHz ('sync' domain), CLKOUT1 = 25 MHz ('eth' domain)
  - Declare top-level ports rgmii_txc / txd / txctl / mdc / mdio / rstn
  - Instantiate RgmiiMac in the 'eth' domain, wire ports to top-level signals
  - Add MDIO bidir mux: drive when mdio_oe=1, sample when mdio_oe=0
  - send/link_up cross from 'eth' → 'sync' via 2-FF synchronisers

RTL8211E RGMII pin map (QMTECH Wukong v1.1 schematic):
  ETH_TXC    F4     ETH_TXCTL  G1
  ETH_TXD[0] E3     ETH_TXD[1] E1     ETH_TXD[2] F3     ETH_TXD[3] F1
  ETH_RXC    D4     ETH_RXCTL  C4
  ETH_RXD[0] D3     ETH_RXD[1] D1     ETH_RXD[2] E4     ETH_RXD[3] E2
  ETH_MDC    K1     ETH_MDIO   L1     ETH_RSTN   H1
  (verify pin letters against your exact schematic revision before synthesis)

MDIO init sequence (IEEE 802.3 Clause 22, PHY address 1):
  1. Write ANAR  (reg 4) = 0x01E1  — advertise 100FD + 100HD + 10FD + 10HD
  2. Write BMCR  (reg 0) = 0x1200  — autoneg-enable + restart-autoneg
  Poll BMSR (reg 1): bit 2 = link status, bit 5 = autoneg complete
"""

import struct
from amaranth import *


# ── Ethernet frame builder (runs at elaboration time, not in hardware) ────────

def _eth_crc32(data: bytes) -> int:
    """CRC-32/ISO-HDLC — Ethernet FCS polynomial, reflected."""
    crc = 0xFFFFFFFF
    for byte in data:
        crc ^= byte
        for _ in range(8):
            crc = (crc >> 1) ^ 0xEDB88320 if (crc & 1) else (crc >> 1)
    return crc ^ 0xFFFFFFFF


def _build_udp_frame(src_mac: bytes, payload: bytes) -> bytes:
    """Build a complete Ethernet II / IPv4 / UDP frame (preamble → FCS)."""
    dst_mac  = b'\xff\xff\xff\xff\xff\xff'          # broadcast
    eth_type = b'\x08\x00'                           # IPv4
    udp_sport, udp_dport = 5900, 5900
    udp_len   = 8 + len(payload)
    ip_total  = 20 + udp_len

    # IPv4 header: src=0.0.0.0, dst=255.255.255.255, proto=UDP, TTL=64
    ip_raw = struct.pack(
        '>BBHHHBBH4s4s',
        0x45, 0, ip_total,          # ver/ihl, dscp, total length
        0xCE11, 0,                  # id, flags/frag
        64, 17, 0,                  # ttl, proto=UDP, checksum placeholder
        b'\x00\x00\x00\x00',
        b'\xff\xff\xff\xff',
    )
    s = sum(struct.unpack('>10H', ip_raw))
    while s >> 16:
        s = (s & 0xFFFF) + (s >> 16)
    ip_hdr = ip_raw[:10] + struct.pack('>H', (~s) & 0xFFFF) + ip_raw[12:]

    udp_hdr  = struct.pack('>HHHH', udp_sport, udp_dport, udp_len, 0)
    eth_body = ip_hdr + udp_hdr + payload
    raw      = dst_mac + src_mac + eth_type + eth_body
    if len(raw) < 60:                                # minimum Ethernet frame
        raw += b'\x00' * (60 - len(raw))
    fcs = struct.pack('<I', _eth_crc32(raw))          # FCS LSB-first

    return b'\x55\x55\x55\x55\x55\x55\x55\xD5' + raw + fcs


# ── MDIO frame builders ───────────────────────────────────────────────────────
# IEEE 802.3 Clause 22: 32-bit preamble + 32-bit payload = 64 bits per frame.
# All integers fit in Python int (unlimited precision) — stored as C(val, 64).

def _mdio_write(phy_addr: int, reg_addr: int, data: int) -> int:
    inner = (0b01 << 30) | (0b01 << 28) \
          | ((phy_addr & 0x1F) << 23) \
          | ((reg_addr & 0x1F) << 18) \
          | (0b10 << 16) \
          | (data & 0xFFFF)
    return (0xFFFFFFFF << 32) | inner


def _mdio_read(phy_addr: int, reg_addr: int) -> int:
    inner = (0b01 << 30) | (0b10 << 28) \
          | ((phy_addr & 0x1F) << 23) \
          | ((reg_addr & 0x1F) << 18)
    return (0xFFFFFFFF << 32) | inner


# PHY address 1 (RTL8211E default on QMTECH Wukong)
_PHY_ADDR  = 1
_MDIO_INIT = [
    (_PHY_ADDR, 4, 0x01E1),   # ANAR: 100FD+100HD+10FD+10HD+IEEE802.3 selector
    (_PHY_ADDR, 0, 0x1200),   # BMCR: autoneg-enable + restart-autoneg
]
_MDIO_POLL = (_PHY_ADDR, 1)   # BMSR: bit2=link-status, bit5=autoneg-complete


# ── Module ────────────────────────────────────────────────────────────────────

class RgmiiMac(Elaboratable):
    """Minimal 100BASE-T RGMII MAC — PHY reset, MDIO init, fixed-payload TX.

    All logic runs in the caller's 'sync' clock domain, which MUST be 25 MHz
    for 100BASE-T RGMII (4 bits per clock × 25 MHz = 100 Mbps).  The parent
    module creates an 'eth' ClockDomain at 25 MHz and instantiates this module
    so that its 'sync' domain maps to 'eth' via Amaranth's hierarchy rules.

    Parameters
    ----------
    src_mac : bytes
        6-byte source MAC (default 02:CE:11:00:00:01 — locally administered).
    payload : bytes
        Fixed UDP payload (the call-home binary packet).
    clk_freq : int
        Frequency of the driving clock in Hz (default 25_000_000 for 100BASE-T).

    Ports
    -----
    send        in   Pulse high one cycle to queue a TX.  No effect while busy
                     or link_up is de-asserted.
    busy        out  High during PHY reset, MDIO, or TX.
    link_up     out  High once BMSR link-status reads 1.

    phy_rst_n   out  Active-LOW PHY reset (held low ≥500 ms at power-up).
    mdc         out  MDIO management clock (≤2.5 MHz).
    mdio_o      out  MDIO serial data output (to PHY / bidir mux).
    mdio_oe     out  1 = drive mdio_o; 0 = tristate (sample mdio_i).
    mdio_i      in   MDIO serial data input (from PHY / bidir mux).

    rgmii_txc   out  25 MHz TX clock to PHY (driven by ODDR, D1=1/D2=0).
    rgmii_txd   out  4-bit TX data nibble (ODDR, D1=D2=nibble for 100BASE-T).
    rgmii_txctl out  TX control / TX-EN (ODDR, D1=D2=txen, no errors).
    """

    def __init__(self,
                 src_mac: bytes = b'\x02\xce\x11\x00\x00\x01',
                 payload: bytes = b'',
                 clk_freq: int = 25_000_000):
        self.src_mac  = src_mac
        self.payload  = payload
        self.clk_freq = clk_freq

        self.send    = Signal()
        self.busy    = Signal()
        self.link_up = Signal()

        self.phy_rst_n = Signal()           # active-LOW; init=0 (reset asserted)
        self.mdc       = Signal()
        self.mdio_o    = Signal(init=1)     # idle-high
        self.mdio_oe   = Signal(init=1)     # drive by default
        self.mdio_i    = Signal()

        self.rgmii_txc   = Signal()
        self.rgmii_txd   = Signal(4)
        self.rgmii_txctl = Signal()

        # ── Runtime TX extension interface ──────────────────────────────────
        # Top-level fills an eth-domain copy buffer and supplies nibble data.
        # tx_word_addr outputs the current word index (nib_idx >> 3) so the
        # top-level can drive tx_ext_word combinatorially from its eth buffer.
        # When tx_use_ext=0 the MAC falls back to the elaboration-time FRAME_ROM.
        self.tx_ext_word   = Signal(32)  # current TX word from eth-domain buffer
        self.tx_word_addr  = Signal(7)   # output: nib_idx[11:3] (word address)
        self.tx_use_ext    = Signal()    # 1 = use tx_ext_word; 0 = FRAME_ROM
        self.tx_n_nibs_ext = Signal(12)  # total nibble count when tx_use_ext=1

        # ── RGMII RX ports ──────────────────────────────────────────────────
        # RXC is the 25 MHz clock received from the PHY (independent input clock).
        # RXDV is encoded on RXCTL rising edge; RXDV^RXER on falling edge.
        self.rgmii_rxc   = Signal()         # RX clock input (from PHY, 25 MHz)
        self.rgmii_rxd   = Signal(4)        # RX nibble input
        self.rgmii_rxctl = Signal()         # RXDV (rising) / RXDV^RXER (falling)

        # Streaming RX output (consumer assembles into a frame buffer externally)
        self.rx_valid    = Signal()         # high for one 'sync' cycle per valid byte
        self.rx_data     = Signal(8)        # RX byte (combinational, valid with rx_valid)
        self.rx_done     = Signal()         # high one cycle when frame ends (RXDV falls)
        self.rx_len      = Signal(11)       # byte count of the just-completed frame

    def elaborate(self, platform):
        m = Module()

        # ── Pre-build Ethernet frame at Python elaboration time ───────────────
        frame_bytes  = _build_udp_frame(self.src_mac, self.payload)
        # RGMII transmits each byte LSB-nibble first, then MSB-nibble
        nibs = []
        for byte in frame_bytes:
            nibs.append(byte & 0x0F)
            nibs.append((byte >> 4) & 0x0F)
        N_NIBS    = len(nibs)
        FRAME_ROM = Array([C(n, 4) for n in nibs])

        # ── Xilinx 7-series ODDR instances for RGMII TX ───────────────────────
        # SAME_EDGE mode: D1 is clocked on rising edge, D2 on falling edge.
        # TXC  : D1=1, D2=0  → 25 MHz clock edge-aligned with data (IAW RGMII spec)
        # TXD/TXCTL: D1=D2=data → same value on both edges (100BASE-T rule)
        tx_nibble = Signal(4)    # internal: nibble being sent this cycle
        txen      = Signal()     # internal: TX enable

        m.submodules.oddr_txc = Instance(
            "ODDR",
            p_DDR_CLK_EDGE="SAME_EDGE", p_INIT=0, p_SRTYPE="SYNC",
            i_C=ClockSignal("sync"), i_CE=Const(1, 1),
            i_D1=Const(1, 1), i_D2=Const(0, 1),
            i_R=Const(0, 1),  i_S=Const(0, 1),
            o_Q=self.rgmii_txc,
        )
        for i in range(4):
            m.submodules[f"oddr_txd{i}"] = Instance(
                "ODDR",
                p_DDR_CLK_EDGE="SAME_EDGE", p_INIT=0, p_SRTYPE="SYNC",
                i_C=ClockSignal("sync"), i_CE=Const(1, 1),
                i_D1=tx_nibble[i], i_D2=tx_nibble[i],
                i_R=Const(0, 1),   i_S=Const(0, 1),
                o_Q=self.rgmii_txd[i],
            )
        m.submodules.oddr_txctl = Instance(
            "ODDR",
            p_DDR_CLK_EDGE="SAME_EDGE", p_INIT=0, p_SRTYPE="SYNC",
            i_C=ClockSignal("sync"), i_CE=Const(1, 1),
            i_D1=txen, i_D2=txen,
            i_R=Const(0, 1), i_S=Const(0, 1),
            o_Q=self.rgmii_txctl,
        )

        # ── MDC generator ─────────────────────────────────────────────────────
        # Target ≤2.5 MHz MDC from clk_freq.  At 25 MHz: MDC_DIV=10 → 2.5 MHz.
        # mdc_reg toggles every MDC_DIV cycles.
        # mdc_rise/mdc_fall are combinational single-cycle pulses.
        MDC_DIV  = max(10, self.clk_freq // 2_500_000)
        mdc_ctr  = Signal(range(MDC_DIV))
        mdc_reg  = Signal()
        mdc_rise = Signal()
        mdc_fall = Signal()

        m.d.comb += [mdc_rise.eq(0), mdc_fall.eq(0)]
        with m.If(mdc_ctr == MDC_DIV - 1):
            m.d.sync += [mdc_ctr.eq(0), mdc_reg.eq(~mdc_reg)]
            # mdc_reg not yet updated this cycle: ~mdc_reg = future state
            m.d.comb += [
                mdc_rise.eq(~mdc_reg),   # was 0, about to go 1
                mdc_fall.eq(mdc_reg),     # was 1, about to go 0
            ]
        with m.Else():
            m.d.sync += mdc_ctr.eq(mdc_ctr + 1)
        m.d.comb += self.mdc.eq(mdc_reg)

        # ── PHY hardware reset ────────────────────────────────────────────────
        # RTL8211E requires RSTN held low ≥10 ms; we hold for 500 ms to be safe.
        RST_HOLD = self.clk_freq // 2       # 500 ms at clk_freq
        rst_ctr  = Signal(range(RST_HOLD + 1))
        rst_done = Signal()

        with m.If(~rst_done):
            with m.If(rst_ctr < RST_HOLD - 1):
                m.d.sync += rst_ctr.eq(rst_ctr + 1)
            with m.Else():
                m.d.sync += rst_done.eq(1)
        m.d.comb += self.phy_rst_n.eq(rst_done)

        # ── MDIO state ────────────────────────────────────────────────────────
        # IEEE 802.3 Clause 22: 64 bits per transaction (32 preamble + 32 payload).
        # Transmitted MSB-first.  mdio_shift[63] is output each MDC cycle.
        # On mdc_fall: shift left (new[63] = old[62]), present next bit.
        # On mdc_rise: PHY samples our output (write) or we sample PHY (read).
        MDIO_BITS  = 64
        mdio_shift    = Signal(MDIO_BITS, init=0xFFFFFFFFFFFFFFFF)
        mdio_bits_rem = Signal(7)          # counts 63..0
        mdio_rd_mode  = Signal()           # 1 = read transaction
        mdio_rd_shift = Signal(16)         # captures 16 data bits from PHY
        mdio_busy     = Signal()

        link_up_reg   = Signal()
        m.d.comb += self.link_up.eq(link_up_reg)

        # MDIO output defaults (overridden inside FSM states)
        m.d.comb += [self.mdio_o.eq(1), self.mdio_oe.eq(1)]

        # ── TX state ──────────────────────────────────────────────────────────
        # nib_idx is 12 bits to span both FRAME_ROM (fixed) and runtime ext frames
        # (up to 2 KB = 4096 nibbles).
        nib_idx  = Signal(12)
        tx_run   = Signal()
        ifg_ctr  = Signal(5)

        # Runtime nibble count: elaboration-time (FRAME_ROM) or ext buffer
        tx_n_nibs = Signal(12)
        m.d.comb += tx_n_nibs.eq(Mux(self.tx_use_ext, self.tx_n_nibs_ext, N_NIBS))

        # Nibble selection from the ext word: nib_idx[2:0] selects one of 8 nibbles
        tx_ext_nib = Signal(4)
        with m.Switch(nib_idx[:3]):
            for ni in range(8):
                with m.Case(ni):
                    m.d.comb += tx_ext_nib.eq(
                        self.tx_ext_word[ni * 4:(ni + 1) * 4])

        m.d.comb += [
            self.tx_word_addr.eq(nib_idx[3:]),
            tx_nibble.eq(Mux(tx_run,
                             Mux(self.tx_use_ext, tx_ext_nib, FRAME_ROM[nib_idx]),
                             0)),
            txen.eq(tx_run),
            self.busy.eq(~rst_done | mdio_busy | tx_run),
        ]

        # ── Poll counter (2-second interval from IDLE) ────────────────────────
        POLL_CYCLES = self.clk_freq * 2
        poll_ctr    = Signal(range(POLL_CYCLES + 1))

        # ── MDIO init index ───────────────────────────────────────────────────
        init_idx = Signal(range(len(_MDIO_INIT) + 1))

        # ── Pre-compute MDIO frame constants for the init sequence ────────────
        MDIO_WRITE_FRAMES = [
            C(_mdio_write(pa, ra, d), MDIO_BITS)
            for pa, ra, d in _MDIO_INIT
        ]
        MDIO_READ_FRAME = C(_mdio_read(*_MDIO_POLL), MDIO_BITS)

        # ── Main FSM ──────────────────────────────────────────────────────────
        with m.FSM(name="rgmii_mac"):

            # Wait for hardware reset to complete ─────────────────────────────
            with m.State("WAIT_RST"):
                with m.If(rst_done):
                    m.d.sync += init_idx.eq(0)
                    m.next = "MDIO_LOAD"

            # Load next MDIO write frame into shift register ───────────────────
            with m.State("MDIO_LOAD"):
                with m.If(init_idx < len(_MDIO_INIT)):
                    with m.Switch(init_idx):
                        for i, frame_c in enumerate(MDIO_WRITE_FRAMES):
                            with m.Case(i):
                                m.d.sync += [
                                    mdio_shift.eq(frame_c),
                                    mdio_bits_rem.eq(MDIO_BITS - 1),
                                    mdio_rd_mode.eq(0),
                                    mdio_busy.eq(1),
                                ]
                    m.next = "MDIO_TX"
                with m.Else():
                    # All init writes done — start idle/poll loop
                    m.d.sync += poll_ctr.eq(0)
                    m.next = "IDLE"

            # Clock out MDIO frame — advance on mdc_fall, PHY samples on mdc_rise
            with m.State("MDIO_TX"):
                # Drive MDIO: always when write; master drives bits [63..17] on read.
                # In read mode, bits_rem 16..0 → master tristates (PHY drives TA+data).
                m.d.comb += [
                    self.mdio_o.eq(mdio_shift[63]),
                    self.mdio_oe.eq(~mdio_rd_mode | (mdio_bits_rem > 16)),
                ]
                with m.If(mdc_fall):
                    with m.If(mdio_bits_rem > 0):
                        # Capture a read-data bit if in the DATA window (bits_rem 15..1)
                        with m.If(mdio_rd_mode & (mdio_bits_rem <= 15)):
                            # Insert mdio_i at bit 0; existing bits shift up by 1
                            m.d.sync += mdio_rd_shift.eq(
                                Cat(self.mdio_i, mdio_rd_shift[:15]))
                        # Shift register left (MSB-first): bit 63 was just output
                        m.d.sync += [
                            mdio_shift.eq(Cat(C(0, 1), mdio_shift[:63])),
                            mdio_bits_rem.eq(mdio_bits_rem - 1),
                        ]
                    with m.Else():
                        # Last bit (bits_rem == 0): capture final data bit if reading
                        with m.If(mdio_rd_mode):
                            m.d.sync += mdio_rd_shift.eq(
                                Cat(self.mdio_i, mdio_rd_shift[:15]))
                            m.d.sync += mdio_busy.eq(0)
                            m.next = "MDIO_RD_DONE"
                        with m.Else():
                            m.d.sync += [
                                mdio_busy.eq(0),
                                init_idx.eq(init_idx + 1),
                            ]
                            m.next = "MDIO_LOAD"

            # Update link_up from captured BMSR value ─────────────────────────
            # BMSR bit 2: Link Status (latching-low; 1 = link up since last read)
            # BMSR bit 5: Auto-Negotiation Complete
            with m.State("MDIO_RD_DONE"):
                m.d.sync += [
                    link_up_reg.eq(mdio_rd_shift[2]),
                    poll_ctr.eq(0),
                ]
                m.next = "IDLE"

            # Idle: wait for TX request or poll timer ─────────────────────────
            with m.State("IDLE"):
                m.d.comb += [self.mdio_o.eq(1), self.mdio_oe.eq(0)]

                with m.If(self.send & link_up_reg):
                    m.d.sync += [tx_run.eq(1), nib_idx.eq(0)]
                    m.next = "TX"
                with m.Elif(poll_ctr == POLL_CYCLES - 1):
                    m.d.sync += [
                        poll_ctr.eq(0),
                        mdio_shift.eq(MDIO_READ_FRAME),
                        mdio_bits_rem.eq(MDIO_BITS - 1),
                        mdio_rd_mode.eq(1),
                        mdio_busy.eq(1),
                    ]
                    m.next = "MDIO_TX"
                with m.Else():
                    m.d.sync += poll_ctr.eq(poll_ctr + 1)

            # Transmit nibbles from pre-built frame ROM ───────────────────────
            # At 25 MHz, one nibble per clock = 100 Mbps.
            # TXEN (rgmii_txctl) is high for the entire frame including preamble.
            with m.State("TX"):
                with m.If(nib_idx < tx_n_nibs - 1):
                    m.d.sync += nib_idx.eq(nib_idx + 1)
                with m.Else():
                    m.d.sync += [tx_run.eq(0), ifg_ctr.eq(0)]
                    m.next = "IFG"

            # Inter-frame gap: IEEE 802.3 requires ≥96 bit times
            # At 100 Mbps (4 bits/clock): 96 bits = 24 nibble clocks
            with m.State("IFG"):
                with m.If(ifg_ctr < 23):
                    m.d.sync += ifg_ctr.eq(ifg_ctr + 1)
                with m.Else():
                    m.d.sync += poll_ctr.eq(0)
                    m.next = "IDLE"

        # ── RGMII RX IDDR instances ───────────────────────────────────────────
        # SAME_EDGE_PIPELINED: D1 (rising) and D2 (falling) both registered on
        # the rising edge of C with one-cycle pipeline delay.
        # RXC is an independent input clock from the PHY.  In a full design it
        # drives a separate ClockDomain("rxc"); here the BUFG output is wired
        # directly to each IDDR C pin so the synthesiser infers the correct clock
        # topology.  At 100BASE-T D1 == D2 — only D1 (rxd_d1) is used.
        rxc_buf  = Signal()
        rxd_d1   = Signal(4)
        rxd_d2   = Signal(4)    # reserved for 1 Gbps upgrade path
        rxctl_d1 = Signal()     # RXDV (rising edge of RXCTL)
        rxctl_d2 = Signal()     # RXDV ^ RXER (falling edge of RXCTL)

        m.submodules.bufg_rxc = Instance(
            "BUFG",
            i_I=self.rgmii_rxc,
            o_O=rxc_buf,
        )
        for i in range(4):
            m.submodules[f"iddr_rxd{i}"] = Instance(
                "IDDR",
                p_DDR_CLK_EDGE="SAME_EDGE_PIPELINED",
                p_INIT_Q1=0, p_INIT_Q2=0, p_SRTYPE="SYNC",
                i_C=rxc_buf, i_CE=Const(1, 1),
                i_D=self.rgmii_rxd[i],
                i_R=Const(0, 1), i_S=Const(0, 1),
                o_Q1=rxd_d1[i], o_Q2=rxd_d2[i],
            )
        m.submodules.iddr_rxctl = Instance(
            "IDDR",
            p_DDR_CLK_EDGE="SAME_EDGE_PIPELINED",
            p_INIT_Q1=0, p_INIT_Q2=0, p_SRTYPE="SYNC",
            i_C=rxc_buf, i_CE=Const(1, 1),
            i_D=self.rgmii_rxctl,
            i_R=Const(0, 1), i_S=Const(0, 1),
            o_Q1=rxctl_d1, o_Q2=rxctl_d2,
        )

        # ── 2-FF synchronizers: rxc_buf → sync (eth after DomainRenamer) ────────
        # IDDR outputs (rxctl_d1, rxd_d1) are registered by rxc_buf — the PHY's
        # recovered 25 MHz clock.  The RX FSM runs in 'sync' (MMCM-derived
        # 25 MHz), which is asynchronous to rxc_buf.  A 2-stage register chain
        # resolves metastability before the FSM sees either signal.
        # At 100BASE-T the preamble is 8 bytes (16 nibble clocks = 640 ns), so
        # the 2-cycle / 80 ns synchronizer latency is absorbed by the preamble
        # stripper with ample margin.
        rxctl_sync1 = Signal()
        rxctl_sync2 = Signal()   # RXDV, metastability-resolved — safe for FSM
        rxd_sync1   = Signal(4)
        rxd_sync2   = Signal(4)  # RXD nibble, resolved — safe for FSM

        m.d.sync += [
            rxctl_sync1.eq(rxctl_d1),     # first stage: sample across boundary
            rxctl_sync2.eq(rxctl_sync1),  # second stage: resolved
            rxd_sync1.eq(rxd_d1),
            rxd_sync2.eq(rxd_sync1),
        ]

        # ── RX byte assembler (streaming — no internal buffer) ────────────────
        # At 100BASE-T: one nibble (4 bits) per 25 MHz clock cycle.
        # Two nibbles (lo first per MII convention) assemble one byte.
        # rx_valid pulses high for one cycle when rx_data holds a valid byte.
        # rx_done  pulses high for one cycle when RXDV de-asserts (frame end).
        rx_lo_nib    = Signal(4)
        rx_nib_phase = Signal()   # 0 = awaiting lo nibble, 1 = awaiting hi nibble
        rx_len_ctr   = Signal(11) # byte counter for current frame

        # Combinational defaults (overridden inside FSM states via Amaranth priority)
        m.d.comb += [
            self.rx_valid.eq(0),
            self.rx_done.eq(0),
            self.rx_data.eq(0),
        ]

        # ── RX FSM ─────────────────────────────────────────────────────────────
        # Uses rxctl_sync2 / rxd_sync2 (2-FF synchronized from rxc_buf domain).
        with m.FSM(name="rgmii_rx"):

            with m.State("RX_IDLE"):
                m.d.sync += [rx_len_ctr.eq(0), rx_nib_phase.eq(0)]
                with m.If(rxctl_sync2):
                    m.next = "RX_PREAMBLE"

            with m.State("RX_PREAMBLE"):
                # Strip 8-byte preamble + SFD (0x55…55_D5).
                # SFD = 0xD5: lo nibble = 0x5, hi nibble = 0xD.
                # Transition to RX_DATA on the hi nibble of the SFD byte.
                with m.If(~rxctl_sync2):
                    m.next = "RX_IDLE"
                with m.Elif(rx_nib_phase == 0):
                    m.d.sync += [rx_lo_nib.eq(rxd_sync2), rx_nib_phase.eq(1)]
                with m.Else():
                    m.d.sync += rx_nib_phase.eq(0)
                    with m.If((rx_lo_nib == 0x5) & (rxd_sync2 == 0xD)):
                        m.d.sync += rx_len_ctr.eq(0)
                        m.next = "RX_DATA"

            with m.State("RX_DATA"):
                with m.If(~rxctl_sync2):
                    # RXDV de-asserted: frame is complete.
                    m.d.comb += self.rx_done.eq(1)
                    m.d.sync += self.rx_len.eq(rx_len_ctr)
                    m.next = "RX_IDLE"
                with m.Elif(rx_nib_phase == 0):
                    m.d.sync += [rx_lo_nib.eq(rxd_sync2), rx_nib_phase.eq(1)]
                with m.Else():
                    # Hi nibble: combinatorially drive rx_data and rx_valid.
                    # MII convention: lo nibble transmitted first.
                    m.d.comb += [
                        self.rx_data.eq(Cat(rx_lo_nib, rxd_sync2)),
                        self.rx_valid.eq(1),
                    ]
                    m.d.sync += [
                        rx_nib_phase.eq(0),
                        rx_len_ctr.eq(rx_len_ctr + 1),
                    ]

        return m
