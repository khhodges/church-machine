// =============================================================================
// device_abstractions.js — Church Machine Device / MMIO Abstractions
// =============================================================================
//
// Implements DeviceAbstractions: the class that simulates the memory-mapped
// I/O devices present on the QMTECH Wukong Artix-7 FPGA board.  Device registers
// live in the I/O segment (0xFE00–0xFEFF) of the word-addressed memory space.
//
// PRIMARY CLASS
//   DeviceAbstractions
//     Instantiated in simulator.js, bound to `sim.deviceAbstractions`.
//     The simulator calls deviceAbstractions.read(addr) and .write(addr, val)
//     for any memory access that falls in the I/O segment.
//
// I/O SEGMENT MAP  (word addresses, each word = 32 bits)
//   0xFE00   UART_STATUS    — bit[0] TX ready, bit[1] RX data available
//   0xFE01   UART_DATA      — write: transmit byte; read: receive byte
//   0xFE02   UART_BAUD      — baud rate divisor (default 115200)
//   0xFE04   LED_STATE      — bit[5:0] control 6 on-board LEDs
//   0xFE05   LED_COUNT      — number of addressable LEDs (read-only = 6)
//   0xFE08   BUTTON_STATE   — bit[0] pushbutton pressed
//   0xFE09   BUTTON_EVENT   — read clears pending button-press event
//   0xFE0C   TIMER_CTRL     — bit[0] start/stop; bit[1] alarm enable
//   0xFE0D   TIMER_COUNT    — current timer count (32-bit, read/write)
//   0xFE0E   TIMER_ALARM    — alarm threshold; fires IRQ when count reaches it
//   0xFE10   DISPLAY_CTRL   — bit[0] enable; bit[1] cursor visible
//   0xFE11   DISPLAY_CHAR   — write: emit character at cursor; advances cursor
//   0xFE12   DISPLAY_X      — cursor column (0-based)
//   0xFE13   DISPLAY_Y      — cursor row (0-based)
//   0xFE14   DISPLAY_WIDTH  — display width in columns (read-only = 80)
//   0xFE15   DISPLAY_HEIGHT — display height in rows (read-only = 25)
//
// DEVICE STATE  (_deviceState)
//   uart     { txBuffer[], rxBuffer[], baud }
//   led      { state, count }
//   button   { pressed, eventQueue[] }
//   timer    { running, count, alarm, startTime }
//   display  { buffer[], width, height, cursorX, cursorY }
//
// HARDWARE CROSS-REFERENCE
//   hardware/boot_rom.py  _MMIO_ENTRIES — defines same registers in Amaranth HDL
//   The address assignments here MUST match _MMIO_ENTRIES exactly.
//   simulator/simulator.js reads/writes through this class for 0xFE00+ accesses.
//   simulator/simulator.js SLOT_SIZE comment references boot_rom.py line 339.
//
// USED BY
//   DREAD  CR, addr   — calls deviceAbstractions.read(addr)
//   DWRITE addr, CR   — calls deviceAbstractions.write(addr, value)
//   app.js LED strip  — reads led.state after each DWRITE to update the LED UI
//
// KEY METHODS
//   read(wordAddr)         — returns the 32-bit register value at wordAddr
//   write(wordAddr, val)   — updates the register and fires any side-effects
//   _uartTx(byte)          — push to txBuffer; notifies app.js console
//   _timerTick()           — called on each sim step if timer is running
//   reset()                — clears all device state to power-on defaults
//
// =============================================================================

class DeviceAbstractions {
    constructor(registry) {
        this.registry = registry;
        this.IO_SEGMENT = 0xFE00;
        // Namespace owns one capability for one 32-bit M-bit I/O object.
        // Bits 0..15 map directly to CR0.M..CR15.M.
        this._mBitNamespaceOwner = null;
        this._mBitCapabilities = null;
        this._deviceState = {
            uart: { txBuffer: [], rxBuffer: [], baud: 115200 },
            led: { state: 0x00, count: 6 },
            button: { pressed: false, eventQueue: [] },
            timer: { running: false, count: 0, alarm: 0, startTime: 0 },
            display: { buffer: [], width: 80, height: 25, cursorX: 0, cursorY: 0 },
            ethernet: { linkUp: true, txBuffer: [], rxBuffer: [], endpoint: null }
        };
        this._bindAll();
    }

    issueNamespaceMBitCapability(namespaceOwner) {
        const canonicalOwner = this.registry && this.registry.abstractions
            ? this.registry.abstractions[5] : null;
        if (!canonicalOwner || canonicalOwner.name !== 'Navana' ||
                namespaceOwner !== canonicalOwner || this._mBitCapabilities) {
            return null;
        }
        const capability = Object.freeze({
            device: 'M_BIT',
            nsSlot: 11,
            port: 0xFFFFFF1C,
            words: 1,
            rights: 'RW'
        });
        this._mBitNamespaceOwner = namespaceOwner;
        this._mBitCapabilities = new Set([capability]);
        return capability;
    }

    writeMBitWord(sim, capability, value, namespaceOwner) {
        if (!this._mBitCapabilities || !this._mBitCapabilities.has(capability) ||
                namespaceOwner !== this._mBitNamespaceOwner) {
            return { ok: false, fault: 'PERM_M', message: 'M-bit device capability is absent or not owned by Namespace' };
        }
        if (capability.device !== 'M_BIT' || capability.nsSlot !== 11 ||
                capability.words !== 1 || (capability.port >>> 0) !== 0xFFFFFF1C) {
            return { ok: false, fault: 'PERM_M', message: 'M-bit device capability identity mismatch' };
        }
        if (capability.rights !== 'RW') {
            return { ok: false, fault: 'PERM_W', message: 'M-bit I/O object requires its exact RW capability' };
        }
        if (!Number.isInteger(value) || value < 0 || value > 0xFFFFFFFF) {
            return { ok: false, fault: 'ARGS', message: 'M-bit device requires one 32-bit word' };
        }
        if (!sim || !sim.cr || sim.cr.length < 16) {
            return { ok: false, fault: 'BOUNDS', message: 'M-bit device requires CR0–CR15' };
        }
        for (let cr = 0; cr < 16; cr++) sim.cr[cr].m = (value >>> cr) & 1;
        return { ok: true, value: value >>> 0 };
    }

    _bindAll() {
        this._bindUART();
        this._bindLED();
        this._bindButton();
        this._bindTimer();
        this._bindDisplay();
        this._bindEthernet();
    }

    _validateDeviceAccess(sim, deviceAddr, perm) {
        const segment = (deviceAddr >>> 8) & 0xFF;
        if (segment !== 0xFE) {
            return { ok: false, fault: 'SEGMENT', message: `Device access requires 0xFE segment, got 0x${segment.toString(16)}` };
        }
        return { ok: true };
    }

    _bindUART() {
        const dev = this._deviceState.uart;
        const self = this;

        this.registry.bindMethod(11, 'Send', function(sim, args) {
            const check = self._validateDeviceAccess(sim, self.IO_SEGMENT | 0x00, 'S');
            if (!check.ok) return check;

            const data = args.data;
            if (data === undefined || data === null) {
                return { ok: false, fault: 'ARGS', message: 'UART.Send: data required' };
            }

            if (typeof data === 'string') {
                for (let i = 0; i < data.length; i++) {
                    dev.txBuffer.push(data.charCodeAt(i) & 0xFF);
                }
            } else {
                dev.txBuffer.push(data & 0xFF);
            }

            return {
                ok: true,
                result: { bytesSent: typeof data === 'string' ? data.length : 1 },
                message: `UART.Send: ${typeof data === 'string' ? data.length + ' bytes' : '1 byte'} queued at ${dev.baud} baud`
            };
        });

        this.registry.bindMethod(11, 'Receive', function(sim, args) {
            const check = self._validateDeviceAccess(sim, self.IO_SEGMENT | 0x00, 'L');
            if (!check.ok) return check;

            if (dev.rxBuffer.length === 0) {
                return { ok: true, result: { data: -1, available: 0 }, message: 'UART.Receive: no data available' };
            }

            const byte = dev.rxBuffer.shift();
            return {
                ok: true,
                result: { data: byte, available: dev.rxBuffer.length },
                message: `UART.Receive: byte 0x${byte.toString(16).padStart(2, '0')}, ${dev.rxBuffer.length} remaining`
            };
        });

        this.registry.bindMethod(11, 'SetBaud', function(sim, args) {
            const baud = args.baud || 115200;
            const validRates = [9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600];
            if (!validRates.includes(baud)) {
                return { ok: false, fault: 'ARGS', message: `UART.SetBaud: invalid rate ${baud}` };
            }
            dev.baud = baud;
            return { ok: true, result: { baud: baud }, message: `UART.SetBaud: ${baud} baud` };
        });
    }

    _bindLED() {
        const dev = this._deviceState.led;
        const self = this;

        this.registry.bindMethod(12, 'Set', function(sim, args) {
            const check = self._validateDeviceAccess(sim, self.IO_SEGMENT | 0x10, 'S');
            if (!check.ok) return check;

            const ledIdx = args.ledIndex !== undefined ? args.ledIndex : 0;
            if (ledIdx < 0 || ledIdx >= dev.count) {
                return { ok: true, preserveDR1: true, result: -1, message: `LED.Set: invalid capability offset ${ledIdx} (valid: 0\u2013${dev.count - 1})` };
            }
            dev.state |= (1 << ledIdx);
            return {
                ok: true,
                preserveDR1: true,
                result: 1,
                message: `LED.Set: offset ${ledIdx} ON (state=0b${dev.state.toString(2).padStart(dev.count, '0')})`
            };
        });

        this.registry.bindMethod(12, 'Clear', function(sim, args) {
            const check = self._validateDeviceAccess(sim, self.IO_SEGMENT | 0x10, 'S');
            if (!check.ok) return check;

            const ledIdx = args.ledIndex !== undefined ? args.ledIndex : 0;
            if (ledIdx < 0 || ledIdx >= dev.count) {
                return { ok: true, preserveDR1: true, result: -1, message: `LED.Clear: invalid capability offset ${ledIdx} (valid: 0\u2013${dev.count - 1})` };
            }
            dev.state &= ~(1 << ledIdx);
            return {
                ok: true,
                preserveDR1: true,
                result: 1,
                message: `LED.Clear: offset ${ledIdx} OFF (state=0b${dev.state.toString(2).padStart(dev.count, '0')})`
            };
        });

        this.registry.bindMethod(12, 'Toggle', function(sim, args) {
            const check = self._validateDeviceAccess(sim, self.IO_SEGMENT | 0x10, 'S');
            if (!check.ok) return check;

            const ledIdx = args.ledIndex !== undefined ? args.ledIndex : 0;
            if (ledIdx < 0 || ledIdx >= dev.count) {
                return { ok: true, preserveDR1: true, result: -1, message: `LED.Toggle: invalid capability offset ${ledIdx} (valid: 0\u2013${dev.count - 1})` };
            }
            dev.state ^= (1 << ledIdx);
            const isOn = (dev.state >> ledIdx) & 1;
            return {
                ok: true,
                preserveDR1: true,
                result: 1,
                message: `LED.Toggle: offset ${ledIdx} \u2192 ${isOn ? 'ON' : 'OFF'} (state=0b${dev.state.toString(2).padStart(dev.count, '0')})`
            };
        });

        this.registry.bindMethod(12, 'State', function(sim, args) {
            const check = self._validateDeviceAccess(sim, self.IO_SEGMENT | 0x10, 'L');
            if (!check.ok) return check;

            const ledIdx = args.ledIndex !== undefined ? args.ledIndex : 0;
            if (ledIdx < 0 || ledIdx >= dev.count) {
                return { ok: true, preserveDR1: true, result: -1, message: `LED.State: invalid capability offset ${ledIdx} (valid: 0\u2013${dev.count - 1})` };
            }
            const isOn = (dev.state >> ledIdx) & 1;
            return {
                ok: true,
                preserveDR1: true,
                result: isOn,
                message: `LED.State: offset ${ledIdx} is ${isOn ? 'ON' : 'OFF'} (1=on, 0=off, <0=fault)`
            };
        });
    }

    _bindButton() {
        const dev = this._deviceState.button;
        const self = this;

        this.registry.bindMethod(13, 'Read', function(sim, args) {
            const check = self._validateDeviceAccess(sim, self.IO_SEGMENT | 0x20, 'L');
            if (!check.ok) return check;

            return {
                ok: true,
                result: { pressed: dev.pressed },
                message: `Button.Read: ${dev.pressed ? 'PRESSED' : 'RELEASED'}`
            };
        });

        this.registry.bindMethod(13, 'WaitPress', function(sim, args) {
            const check = self._validateDeviceAccess(sim, self.IO_SEGMENT | 0x20, 'L');
            if (!check.ok) return check;

            return {
                ok: true,
                result: { pressed: dev.pressed, waiting: !dev.pressed },
                message: dev.pressed ? 'Button.WaitPress: button is pressed' : 'Button.WaitPress: waiting for press'
            };
        });

        this.registry.bindMethod(13, 'OnEvent', function(sim, args) {
            const check = self._validateDeviceAccess(sim, self.IO_SEGMENT | 0x20, 'L');
            if (!check.ok) return check;

            if (dev.eventQueue.length === 0) {
                return { ok: true, result: { event: null }, message: 'Button.OnEvent: no events pending' };
            }

            const event = dev.eventQueue.shift();
            return {
                ok: true,
                result: { event: event },
                message: `Button.OnEvent: ${event.type} at t=${event.time}`
            };
        });
    }

    _bindTimer() {
        const dev = this._deviceState.timer;
        const self = this;

        this.registry.bindMethod(14, 'Start', function(sim, args) {
            const check = self._validateDeviceAccess(sim, self.IO_SEGMENT | 0x30, 'S');
            if (!check.ok) return check;

            dev.running = true;
            dev.startTime = Date.now();
            dev.count = 0;

            return { ok: true, result: { running: true }, message: 'Timer.Start: timer started' };
        });

        this.registry.bindMethod(14, 'Stop', function(sim, args) {
            const check = self._validateDeviceAccess(sim, self.IO_SEGMENT | 0x30, 'S');
            if (!check.ok) return check;

            dev.running = false;
            if (dev.startTime) {
                dev.count = Date.now() - dev.startTime;
            }

            return {
                ok: true,
                result: { running: false, elapsed: dev.count },
                message: `Timer.Stop: stopped at ${dev.count}ms`
            };
        });

        this.registry.bindMethod(14, 'Read', function(sim, args) {
            const check = self._validateDeviceAccess(sim, self.IO_SEGMENT | 0x30, 'L');
            if (!check.ok) return check;

            let elapsed = dev.count;
            if (dev.running && dev.startTime) {
                elapsed = Date.now() - dev.startTime;
            }

            return {
                ok: true,
                result: { elapsed: elapsed, running: dev.running },
                message: `Timer.Read: ${elapsed}ms${dev.running ? ' (running)' : ' (stopped)'}`
            };
        });

        this.registry.bindMethod(14, 'SetAlarm', function(sim, args) {
            const check = self._validateDeviceAccess(sim, self.IO_SEGMENT | 0x30, 'S');
            if (!check.ok) return check;

            const ms = args.ms || 1000;
            dev.alarm = ms;

            return { ok: true, result: { alarm: ms }, message: `Timer.SetAlarm: alarm set for ${ms}ms` };
        });
    }

    _bindDisplay() {
        const dev = this._deviceState.display;
        const self = this;

        this.registry.bindMethod(15, 'Write', function(sim, args) {
            const check = self._validateDeviceAccess(sim, self.IO_SEGMENT | 0x40, 'S');
            if (!check.ok) return check;

            const text = args.text || '';
            for (let i = 0; i < text.length; i++) {
                const ch = text[i];
                if (ch === '\n') {
                    dev.cursorX = 0;
                    dev.cursorY++;
                    if (dev.cursorY >= dev.height) {
                        dev.buffer.shift();
                        dev.cursorY = dev.height - 1;
                    }
                } else {
                    if (!dev.buffer[dev.cursorY]) dev.buffer[dev.cursorY] = [];
                    dev.buffer[dev.cursorY][dev.cursorX] = ch;
                    dev.cursorX++;
                    if (dev.cursorX >= dev.width) {
                        dev.cursorX = 0;
                        dev.cursorY++;
                        if (dev.cursorY >= dev.height) {
                            dev.buffer.shift();
                            dev.cursorY = dev.height - 1;
                        }
                    }
                }
            }

            return {
                ok: true,
                result: { x: dev.cursorX, y: dev.cursorY },
                message: `Display.Write: "${text}" at (${dev.cursorX}, ${dev.cursorY})`
            };
        });

        this.registry.bindMethod(15, 'Clear', function(sim, args) {
            const check = self._validateDeviceAccess(sim, self.IO_SEGMENT | 0x40, 'S');
            if (!check.ok) return check;

            dev.buffer = [];
            dev.cursorX = 0;
            dev.cursorY = 0;

            return { ok: true, result: {}, message: 'Display.Clear: screen cleared' };
        });

        this.registry.bindMethod(15, 'Scroll', function(sim, args) {
            const check = self._validateDeviceAccess(sim, self.IO_SEGMENT | 0x40, 'S');
            if (!check.ok) return check;

            const lines = args.lines || 1;
            for (let i = 0; i < lines; i++) {
                dev.buffer.shift();
            }

            return {
                ok: true,
                result: { lines: lines, bufferHeight: dev.buffer.length },
                message: `Display.Scroll: scrolled ${lines} line(s)`
            };
        });
    }

    _bindEthernet() {
        const dev = this._deviceState.ethernet;

        this.registry.bindMethod(51, 'Send', function(sim, args) {
            const dataGT  = (args && args.dr1 !== undefined) ? (args.dr1 >>> 0) : 0;
            const byteLen = (args && args.dr2 !== undefined) ? (args.dr2 >>> 0) : 0;
            if (byteLen === 0 || byteLen > 1518) {
                return { ok: false, fault: 'ARGS', message: `Ethernet.Send: invalid frame length ${byteLen} (valid: 1\u20131518; dataGT=0x${dataGT.toString(16)})` };
            }
            dev.txBuffer.push({ len: byteLen, dataGT, time: Date.now() });
            return {
                ok: true,
                result: byteLen,
                message: `Ethernet.Send: ${byteLen} bytes transmitted (link ${dev.linkUp ? 'UP' : 'DOWN'}, dataGT=0x${dataGT.toString(16)})`
            };
        });

        this.registry.bindMethod(51, 'Receive', function(sim, args) {
            if (dev.rxBuffer.length === 0) {
                return {
                    ok: true,
                    result: 0,
                    message: 'Ethernet.Receive: no frame waiting (DR1=0)'
                };
            }
            const frame = dev.rxBuffer.shift();
            return {
                ok: true,
                result: frame.len,
                message: `Ethernet.Receive: DR1=${frame.len} bytes ready — drain via ETH_RX_DATA reads (${dev.rxBuffer.length} remaining)`
            };
        });

        this.registry.bindMethod(51, 'Connect', function(sim, args) {
            const ipv4 = (args && args.dr1 !== undefined) ? (args.dr1 >>> 0) : 0;
            const port = (args && args.dr2 !== undefined) ? (args.dr2 >>> 0) : 0;
            if (!ipv4 || port < 1 || port > 65535) {
                return { ok: false, fault: 'ARGS', result: -1, message: `Ethernet.Connect: invalid endpoint (ip=0x${(ipv4 >>> 0).toString(16).padStart(8, '0')}, port=${port})` };
            }
            const a = (ipv4 >>> 24) & 0xFF;
            const b = (ipv4 >>> 16) & 0xFF;
            const c = (ipv4 >>>  8) & 0xFF;
            const d =  ipv4        & 0xFF;
            dev.endpoint = { ip: `${a}.${b}.${c}.${d}`, port };
            return {
                ok: true,
                result: 0,
                message: `Ethernet.Connect: endpoint set to ${dev.endpoint.ip}:${port}`
            };
        });

        this.registry.bindMethod(51, 'Status', function(sim, args) {
            const state = dev.linkUp ? 1 : 0;
            return {
                ok: true,
                result: state,
                message: `Ethernet.Status: link ${dev.linkUp ? 'UP (1)' : 'DOWN (0)'}`
            };
        });
    }

    simulateEthernetReceive(frameBytes) {
        const len = Array.isArray(frameBytes) ? frameBytes.length : frameBytes;
        this._deviceState.ethernet.rxBuffer.push({ len, dataGT: 0, time: Date.now() });
    }

    simulateButtonPress() {
        this._deviceState.button.pressed = true;
        this._deviceState.button.eventQueue.push({ type: 'press', time: Date.now() });
    }

    simulateButtonRelease() {
        this._deviceState.button.pressed = false;
        this._deviceState.button.eventQueue.push({ type: 'release', time: Date.now() });
    }

    simulateUARTReceive(data) {
        if (typeof data === 'string') {
            for (let i = 0; i < data.length; i++) {
                this._deviceState.uart.rxBuffer.push(data.charCodeAt(i) & 0xFF);
            }
        } else if (Array.isArray(data)) {
            for (const b of data) {
                this._deviceState.uart.rxBuffer.push(b & 0xFF);
            }
        } else {
            this._deviceState.uart.rxBuffer.push(data & 0xFF);
        }
    }

    getDeviceState() {
        return JSON.parse(JSON.stringify(this._deviceState));
    }

    getLEDState() {
        return this._deviceState.led.state;
    }

    getDisplayText() {
        const lines = [];
        for (let y = 0; y < this._deviceState.display.buffer.length; y++) {
            const row = this._deviceState.display.buffer[y] || [];
            lines.push(row.join(''));
        }
        return lines.join('\n');
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = DeviceAbstractions;
}
