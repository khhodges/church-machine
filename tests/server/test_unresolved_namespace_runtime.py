"""Absent code is a runtime condition, not an image construction error."""
import copy
import json
import struct
import subprocess

import pytest

from server.design_simulation import stage, configuration
from server.namespace_design_v1 import phase1_seed
from server.namespace_ascending_image import generate_image, validate_image, FORMAT
from test_namespace_ascending_image import fixture, ROOT


def test_named_unfinished_phase1_builds_without_inventing_bodies(tmp_path):
    document = phase1_seed()
    mint = next(row for row in document["rows"] if row["name"] == "ide.Mint")
    # Ascending supports Lazy policy without rewriting the saved policy.
    from server.namespace_design_v1 import FORMAT as DESIGN_FORMAT
    document.update(format=DESIGN_FORMAT, slotCount=64)
    mint["policy"] = "Lazy"
    original = copy.deepcopy(document)
    image, prepared, bindings = stage(configuration(document), document, tmp_path, 10)
    assert len(image) == 16384 * 4 and bindings == []
    words = struct.unpack("<16384I", image)
    assert words[9 * 4:10 * 4] == (0, 0, 0, 0)
    assert next(row for row in prepared if row["slot"] == 9)["name"] == "ide.Mint"
    assert document == original
    assert validate_image(image, image_format=FORMAT)


@pytest.mark.parametrize("missing_entry", [False, True])
def test_build_and_runtime_missing_reference(tmp_path, missing_entry):
    state, config, artifacts = fixture()
    if missing_entry:
        state["abstractions"][2].update(unresolved=True)
    else:
        state["abstractions"].append(dict(slot=9, name="ide.Missing", seq=0,
                                         type="Inform", implementationMissing=True))
    image, report = generate_image(state, config, None, image_format=FORMAT, artifacts=artifacts)
    path = tmp_path / "image.bin"
    path.write_bytes(image)
    script = r"""
const fs=require('fs');
const ChurchSimulator=require('./simulator/simulator');
const image=fs.readFileSync(process.argv[1]);
const s=ChurchSimulator.fromAscendingNamespaceImage(image,
    {word0:0x02000001,word1:0,word2:255,word3:0,m:1});
if(s.halted) throw Error('Unresolved image blocked construction');
// The first attempted entry, not construction, uses the missing target.
const entered=s.startEntryThread();
console.log(JSON.stringify({constructed:true,failure:!entered && s.faultLog.length>0}));
"""
    if missing_entry:
        result = subprocess.run(["node", "-e", script, str(path)], cwd=ROOT,
                                capture_output=True, text=True)
        assert result.returncode == 0, result.stderr
        evidence = json.loads(result.stdout.strip().splitlines()[-1])
        assert evidence["constructed"]
        # Runtime entry uses the absent descriptor and must fault, not execute
        # fabricated code or silently restore another entry.
        assert evidence["failure"]
    assert report["unresolvedRows"][0]["name"] == ("EntryProgram" if missing_entry else "ide.Missing")
