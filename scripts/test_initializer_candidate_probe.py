"""Test the comparison oracle, not the initializer's hardware implementation."""
import subprocess
import pytest

from scripts.prepare_initializer_candidate_probe import bench


@pytest.mark.parametrize("baseline", [False, True])
@pytest.mark.parametrize("first_word_lost", [False, True])
def test_oracle_requires_the_right_first_word(tmp_path, baseline, first_word_lost):
    first = 0 if first_word_lost else 0xF8810100
    (tmp_path / "pairs.hex").write_text("0000f8810100\n000200000011\n")
    (tmp_path / "tb.v").write_text(bench(2, baseline))
    (tmp_path / "stub.v").write_text(f"""
module initializer(input clk,enable, output done,write_en,
 output [13:0] write_addr, output [31:0] write_data);
 reg [1:0] n=0;
 assign done=n==2;
 assign write_en=enable && !done;
 assign write_addr=n==0 ? 0 : 2;
 assign write_data=n==0 ? 32'h{first:08x} : 32'h11;
 always @(posedge clk) if(write_en) n<=n+1;
endmodule
""")
    subprocess.run(["iverilog", "-g2012", "-s", "tb", "-o", "probe.sim", "stub.v", "tb.v"],
                   cwd=tmp_path, check=True, capture_output=True, timeout=10)
    result = subprocess.run(["vvp", "probe.sim"], cwd=tmp_path,
                            capture_output=True, text=True, timeout=10)
    assert (result.returncode == 0) == (baseline == first_word_lost), result.stdout
    if result.returncode:
        assert "WRITE_MISMATCH index=0" in result.stdout
