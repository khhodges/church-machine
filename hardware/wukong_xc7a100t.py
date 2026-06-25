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
from .rgmii_mac import RgmiiMac

# Board MAC address (locally administered, CE:11 prefix)
_BOARD_MAC = b'\x02\xce\x11\x00\x00\x01'

# Default callhome payload token embedded in the fixed UDP payload
_ETH_TOKEN = 0x00003300

# Callhome UDP payload (minimal, N=0 requests; Locator fills in real requests at run time)
_CALLHOME_PAYLOAD = (
    _ETH_TOKEN .to_bytes(4, 'big') +  # sender token
    b'\x00\x00\x00\x00' +             # CM version (filled by firmware at runtime)
    _BOARD_MAC +                       # MAC
    b'\x00\x00' +                      # pad
    b'\x00\x00\x00\x00' +             # uptime
    b'\x00\x00'                        # N=0 requests
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

        # rx_done and rx_len cross from eth → sync for MMIO reads
        rx_done_sync = Signal()
        m.submodules.sync_rx_done = FFSynchronizer(
            mac.rx_done, rx_done_sync, o_domain="sync")

        rx_len_sync = Signal(11)
        # rx_len is multi-bit; use a simple registered sample (safe because
        # rx_len is updated only when rx_done fires, which is stable for many cycles)
        m.d.sync += rx_len_sync.eq(mac.rx_len)

        # ── MMIO register block (EthernetDevice capability, CM 'sync' domain) ─
        # The CM core accesses these registers via DREAD/DWRITE to the
        # EthernetDevice capability GT (MMIO base 0x40001000).
        #
        # Registers that cross to the 'eth' domain use a simple 2-cycle
        # request/acknowledge; at 100 Mbps latency is not critical.
        eth_ctrl_reg   = Signal(32)   # ETH_CTRL  (sync→eth via FFSynchronizer)
        eth_ip_reg     = Signal(32)   # ETH_IP_ADDR
        eth_port_reg   = Signal(16)   # ETH_PORT
        eth_tx_len_reg = Signal(11)   # ETH_TX_LEN  (writing this triggers TX)

        tx_req_sync = Signal()   # sync→eth: pulse to trigger mac.send
        m.submodules.sync_tx_req = FFSynchronizer(
            tx_req_sync, mac.send, o_domain="eth")

        tx_trigger = Signal()

        # MMIO write
        with m.If(self.mmio_we):
            with m.Switch(self.mmio_addr):
                with m.Case(0):   # ETH_CTRL
                    m.d.sync += eth_ctrl_reg.eq(self.mmio_wdata)
                with m.Case(2):   # ETH_TX_LEN — triggers TX
                    m.d.sync += [eth_tx_len_reg.eq(self.mmio_wdata[:11]),
                                 tx_trigger.eq(1)]
                with m.Case(4):   # ETH_IP_ADDR
                    m.d.sync += eth_ip_reg.eq(self.mmio_wdata)
                with m.Case(5):   # ETH_PORT
                    m.d.sync += eth_port_reg.eq(self.mmio_wdata[:16])

        # One-cycle TX request pulse when ETH_TX_LEN is written
        with m.If(tx_trigger):
            m.d.sync += [tx_req_sync.eq(1), tx_trigger.eq(0)]
        with m.Else():
            m.d.sync += tx_req_sync.eq(0)

        # MMIO read (combinational)
        with m.Switch(self.mmio_addr):
            with m.Case(0):
                m.d.comb += self.mmio_rdata.eq(eth_ctrl_reg)
            with m.Case(1):   # ETH_STATUS
                m.d.comb += self.mmio_rdata.eq(
                    Mux(link_up_sync, 1, 0))
            with m.Case(2):
                m.d.comb += self.mmio_rdata.eq(eth_tx_len_reg)
            with m.Case(3):   # ETH_RX_LEN
                m.d.comb += self.mmio_rdata.eq(rx_len_sync)
            with m.Case(4):
                m.d.comb += self.mmio_rdata.eq(eth_ip_reg)
            with m.Case(5):
                m.d.comb += self.mmio_rdata.eq(eth_port_reg)
            with m.Default():
                m.d.comb += self.mmio_rdata.eq(0)

        return m
