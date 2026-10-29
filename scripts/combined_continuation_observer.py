"""Strict read-only mapped observer; missing preserved signals are a failure."""
import hashlib
import json
from pathlib import Path
import re
import sys
try:
    from boot_observer import render
except ImportError:
    from scripts.prepare_initializer_full_boot_observer import render


def net(text, names, width):
    for name in names:
        spelling = "\\" + name if "." in name else name
        vector = rf"\[\s*{width-1}\s*:\s*0\s*\]\s*" if width > 1 else ""
        if re.search(r"\bwire\s+" + vector + re.escape(spelling) + r"\s*;", text):
            return "dut." + spelling + " "
    raise ValueError(f"Missing preserved {width}-bit observation: {names}")


def observer(text, count):
    enable = net(text, ["initializer.write_en", "hw_init_wr_en"], 1)
    address = net(text, ["initializer.write_addr", "hw_init_wr_addr"], 14)
    data = net(text, ["initializer.write_data", "hw_init_wr_data"], 32)
    done = net(text, ["initializer.done", "hw_init_done"], 1)
    # Exact frozen image: root entry GT names NS21, whose method-1 dispatch
    # word is 4 at base word 0x1180. This is startup, not the recovery PC.
    tb = render(text).replace("32'h3504", "32'h4610")
    tb = tb.replace("FULL_SYNTH_BOOT_PASS: entry=00003504", "COMBINED_VENDOR_BOOT_PASS: entry=00004610")
    tb = tb.replace('$display("COMBINED_VENDOR_BOOT_PASS:',
                    f'if(write_count!={count} || {done} !== 1) $fatal(1,"Incomplete initialization");\n'
                    '$display("COMBINED_VENDOR_BOOT_PASS:')
    addition = f"""
reg [45:0] expected [0:{count-1}];
integer write_count=0;
initial $readmemh("pairs.hex", expected);
always @(posedge dut.\\boot_rom.clk ) begin
 if($realtime>0) begin
  if({enable} !== 0 && {enable} !== 1) $fatal(1,"Unknown write enable");
  if({enable} === 1) begin
   if(write_count>={count}) $fatal(1,"Extra initializer write");
   if({{{address},{data}}} !== expected[write_count])
    $fatal(1,"Initializer mismatch index=%0d actual=%h expected=%h",
     write_count,{{{address},{data}}},expected[write_count]);
   if(write_count==0 || write_count=={count-1})
    $display("INITIALIZER_WRITE index=%0d addr=%h data=%h",write_count,{address},{data});
   write_count=write_count+1;
  end
 end
end
"""
    return tb.replace("endmodule", addition + "\nendmodule")


if __name__ == "__main__":
    raw = Path(sys.argv[1]).read_bytes()
    count = len(Path("pairs.hex").read_text().splitlines())
    result = observer(raw.decode(), count)
    Path(sys.argv[2]).write_text(result)
    Path(sys.argv[2] + ".json").write_text(json.dumps({
        "netlistSha256": hashlib.sha256(raw).hexdigest(),
        "observerSha256": hashlib.sha256(result.encode()).hexdigest(),
        "expectedWrites": count, "entry": "0x4610",
        "scope": "Vendor initialization and boot only; continuation checked separately in model",
    }, indent=2))
