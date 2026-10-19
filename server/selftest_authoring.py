"""Explicit new-revision source for the historical raw SelfTest body."""
import re
from pathlib import Path


def declared_source():
    # Keep raw assembler/hardware fixtures and all historical artifacts intact.
    # The programmer must review, compile and approve this new callable source.
    path = Path(__file__).resolve().parents[1] / "simulator/examples/post_flash_selftest.cloomc"
    source = path.read_text()
    block = re.search(r"(?ms)^\s*capabilities\s*\{(.*?)^\s*\}", source)
    if block is None or re.sub(r";[^\n]*|\s", "", block.group(1)) != "SELFE":
        raise ValueError("Canonical SelfTest capabilities changed; review its source manually.")
    return ("; Language: assembly\n"
            "; New callable revision of the canonical SelfTest. Historical LUMPs remain unchanged.\n"
            "abstraction ide.SelfTest {\n" + source[:block.start()] +
            "capabilities { SELF E }\nmethod Run {\n" + source[block.end():] + "\n}\n}\n")
