"""Exercise browser API retention against real compiler/save-plan attestation."""
import json
import subprocess

import pytest
from test_idx1_save_endpoint import client, isolated_lumps


@pytest.mark.parametrize("profile", ["api", "compact", "full"])
@pytest.mark.parametrize("tamper", [False, True])
def test_server_compiled_run_api_reaches_save_plan(client, isolated_lumps, profile, tamper):
    source = "abstraction test.ApiRunFixture {\nmethod Run() {\nreturn(1);\n}\n}\n"
    response = client.post("/api/compile", json={
        "source": source, "language": "javascript", "tier": 2,
    })
    compiled = response.get_json()
    assert response.status_code == 200 and compiled["ok"], compiled
    script = r"""
const fs = require('fs'), vm = require('vm');
const Frame = require('./simulator/lump-content-frame');
const Builder = require('./simulator/lump_builder');
const input = JSON.parse(fs.readFileSync(0,'utf8'));
(async () => {
    const inspected = await Frame.lumpInspectContentFrame(input.compiled.words);
    if (!inspected.contentFrameValid) throw Error(inspected.error);
    const text = fs.readFileSync('./simulator/app-lumps.js','utf8');
    const context = vm.createContext({bootEntrySlot:6,
        _lumpManifests:{6:{_methods:[{name:'WrongBootMethod'}]}}});
    vm.runInContext(text.slice(text.indexOf('function _formatLumpApiDefinition('),
        text.indexOf('// Format the C-list from the immutable embedded API')), context);
    const api = context._formatLumpApiDefinition('test.ApiRunFixture',
        inspected.apiDefinition.capabilities, {apiDefinition:inspected.canonicalApiDefinition});
    if (JSON.stringify(api.methods) !== JSON.stringify(inspected.canonicalApiDefinition.methods))
        throw Error('Browser changed the canonical compiler interface');
    if (!api.methods.Run) throw Error('Run is missing');
    if (input.tamper) api.methods.Run.selector = 1;
    const words = Builder.embedSelfDefinition(input.compiled.words, api, input.source,
        {api:0,compact:1,full:2}[input.profile], input.compiled.language);
    const sourceFrame = await Frame.lumpInspectContentFrameSource(words);
    console.log(JSON.stringify({words, submitted_source:sourceFrame.source}));
})().catch(error => {console.error(error);process.exit(1)});
"""
    built = subprocess.run(
        ["node", "-e", script], input=json.dumps({
            "compiled": compiled, "source": source, "profile": profile, "tamper": tamper,
        }), text=True, capture_output=True, check=True)
    candidate = json.loads(built.stdout)
    result = client.post("/api/lumps/save-plan", json={
        "binary": candidate["words"],
        "metadata": {
            "abstraction": "test.ApiRunFixture", "language": compiled["language"],
            "content_type": "code", "artifact_only": True,
            "capabilities": compiled["capabilities"],
            "original_source": source,
            "submitted_source": candidate["submitted_source"],
        },
    })
    body = result.get_json()
    if tamper:
        assert result.status_code >= 400, body
        assert "Canonical API differs" in str(body), body
    else:
        assert result.status_code == 201 and body.get("compiler_record"), body
        # Exercise actual approval/publication and all exact-revision companions,
        # not merely a successful plan. The fixture uses a private LUMP directory.
        from tests.server.test_idx1_save_endpoint import save
        from server.lump_variants import read_variant
        from server import app as app_module
        import struct
        saved, _ = save(client, {
            "binary": candidate["words"],
            "metadata": {
                "abstraction": "test.ApiRunFixture", "language": compiled["language"],
                "content_type": "code", "artifact_only": True,
                "save_variants": True, "source_required": True,
                "capabilities": compiled["capabilities"],
                "original_source": source,
                "submitted_source": candidate["submitted_source"],
            },
        })
        manifest = json.loads((isolated_lumps / "manifest.json").read_text())
        entry = next(row for row in manifest if row["filename"] == saved["filename"] and not row.get("archived"))
        definitions = []
        for form in ("api", "compact", "full"):
            raw, _ = read_variant(isolated_lumps, entry["variant_bundle_id"], form)
            words = list(struct.unpack(f">{len(raw)//4}I", raw))
            frame = app_module._parse_intrinsic_lump_content(words)
            definitions.append(frame["canonical_api"])
            assert words[-1] in (0, 0xFEED5E1F), "SELF must remain unresolved, not a destination GT"
            if form == "full":
                assert frame["source"] == source
            if form == "api":
                assert frame["source"] is None
        assert definitions[0] == definitions[1] == definitions[2]
