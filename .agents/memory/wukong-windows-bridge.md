---
name: Wukong bridge Windows support
description: The UART bridge runs natively on Windows 11 and must use pyserial port enumeration
---

The Wukong bridge is cross-platform Python: Linux exposes the board as `/dev/ttyUSB*`, while Windows 11 exposes it as `COM` ports such as `COM3`. Port discovery must use pyserial's portable `serial.tools.list_ports` API rather than POSIX filesystem globbing.

**Why:** Windows users can run the same trace/control bridge without WSL, but Linux-only auto-detection silently replaces a valid Windows COM port with a nonexistent `/dev/ttyUSB0`.

**How to apply:** Keep explicit `--port=COMx` support, retain `--port=auto` through pyserial enumeration, and document Python plus `pyserial`/`requests` installation and Device Manager troubleshooting.