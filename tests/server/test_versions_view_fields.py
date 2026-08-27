"""
tests/server/test_versions_view_fields.py

Guards the fields the Builder ▸ Versions tab relies on:

  - GET /hardware/wukong/status exposes ide_version, expected_build_version,
    and min_tu_version so the client can compare the sentinel-reported
    build/TU versions against the repo's expectations.
  - _wukong_build_version() / _wukong_min_tu_version() actually parse the
    constants out of hardware/wukong_top.py.
"""

import os
import re
import sys

ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), '..', '..'))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

import server.app as _app_module
from server.app import app


def _read_const(pattern):
    top = os.path.join(ROOT, 'hardware', 'wukong_top.py')
    with open(top) as f:
        for line in f:
            m = re.match(pattern, line)
            if m:
                return int(m.group(1), 0)
    return None


def test_helpers_parse_wukong_top():
    expected_bv = _read_const(r"\s*WUKONG_BUILD_VERSION\s*=\s*(\d+)")
    expected_tu = _read_const(r"\s*_TU_VERSION_CALL_3PKT\s*=\s*(0[xX][0-9a-fA-F]+|\d+)")
    assert expected_bv is not None, "WUKONG_BUILD_VERSION missing from wukong_top.py"
    assert expected_tu is not None, "_TU_VERSION_CALL_3PKT missing from wukong_top.py"
    assert _app_module._wukong_build_version() == expected_bv
    assert _app_module._wukong_min_tu_version() == expected_tu


def test_status_exposes_version_fields():
    client = app.test_client()
    resp = client.get('/hardware/wukong/status')
    assert resp.status_code == 200
    data = resp.get_json()
    assert 'ide_version' in data and data['ide_version']
    assert data['ide_version_kind'] in {'git', 'deployment', 'runtime', 'unknown'}
    assert 'expected_build_version' in data
    assert 'min_tu_version' in data
    assert data['expected_build_version'] == _app_module._wukong_build_version()
    assert data['min_tu_version'] == _app_module._wukong_min_tu_version()
    # Both should be ints when the source file is present (it is, in-repo).
    assert isinstance(data['expected_build_version'], int)
    assert isinstance(data['min_tu_version'], int)


def test_status_remains_readonly_with_new_fields():
    """Adding the new fields must not have made the endpoint stateful."""
    client = app.test_client()
    d1 = client.get('/hardware/wukong/status').get_json()
    d2 = client.get('/hardware/wukong/status').get_json()
    assert d1['expected_build_version'] == d2['expected_build_version']
    assert d1['min_tu_version'] == d2['min_tu_version']


def test_boot_id_identifies_which_version_namespace_it_uses():
    data = app.test_client().get('/api/boot-id').get_json()
    assert data['version']
    assert data['version_kind'] in {'git', 'deployment', 'runtime', 'unknown'}


def test_production_deployment_id_is_not_compared_to_a_local_git_commit(monkeypatch):
    class ProductionReply:
        status_code = 200

        @staticmethod
        def json():
            return {
                'bootId': 'published-boot',
                'version': 'published-build',
                'version_kind': 'deployment',
            }

    monkeypatch.setattr(_app_module, 'BUILD_VERSION', 'local-git-commit')
    monkeypatch.setattr(_app_module, 'BUILD_VERSION_KIND', 'git')
    monkeypatch.setattr(
        _app_module.http_requests, 'get',
        lambda *args, **kwargs: ProductionReply(),
    )
    monkeypatch.setattr(
        _app_module, '_versions_prod_cache', {'ts': 0.0, 'payload': None},
    )
    data = app.test_client().get('/api/versions/production').get_json()
    assert data['version_kind'] == 'deployment'
    assert data['local_version_kind'] == 'git'
    assert data['in_sync'] is None
    assert data['comparison'] == 'not_comparable'


def test_standalone_bridge_version_matches_wukong_build():
    bridge_path = os.path.join(ROOT, 'hardware', 'wukong_bridge.py')
    with open(bridge_path, encoding='utf-8') as handle:
        bridge = handle.read()
    match = re.search(r"^\s*BRIDGE_VERSION\s*=\s*(\d+)", bridge, re.MULTILINE)
    assert match, "BRIDGE_VERSION missing from hardware/wukong_bridge.py"
    assert int(match.group(1)) == _app_module._wukong_build_version(), (
        "The standalone Windows bridge must advertise the same version as "
        "hardware/wukong_top.py"
    )


def test_bridge_version_is_exposed_in_versions_view():
    index_path = os.path.join(ROOT, 'simulator', 'index.html')
    with open(index_path, encoding='utf-8') as handle:
        index = handle.read()
    run_path = os.path.join(ROOT, 'simulator', 'app-run.js')
    with open(run_path, encoding='utf-8') as handle:
        app_run = handle.read()
    assert 'id="versionsCardBridge"' in index
    assert 'id="versionsBridgeBody"' in index
    assert '_renderBridge(status)' in app_run
    assert 'bridge.bridge_version' in app_run
    assert 'Matches build v' in app_run
    assert 'Not directly comparable' in app_run


def test_connect_view_clarifies_jtag_and_usb_uart_connections():
    index_path = os.path.join(ROOT, 'simulator', 'index.html')
    with open(index_path, encoding='utf-8') as handle:
        index = handle.read()
    assert 'id="ti60ConnectionMapTitle"' in index
    assert 'JTAG — programming' in index
    assert 'USB-UART — trace &amp; commands' in index
    assert 'often <code>COM3</code>' in index
    assert 'choose the <strong>3rd entry</strong>' in index
    assert 'class="ti60-active-port-label">Trace port' in index
    assert 'Testing uses <code>.bit</code>; release uses <code>.mcs</code>' in index
    assert 'free AMD Vivado Hardware Manager' in index


def test_connect_view_has_configuration_tab_and_reference_images():
    index_path = os.path.join(ROOT, 'simulator', 'index.html')
    with open(index_path, encoding='utf-8') as handle:
        index = handle.read()
    assert 'id="ti60ConnectTab-configuration"' in index
    assert 'id="ti60ConfigurationView"' in index
    assert 'Attached reference images' in index
    assert 'image_1787412016939.png' in index
    assert 'image_1787397327180.png' in index


def test_connect_view_has_unit_under_test_tab_and_board_photo():
    index_path = os.path.join(ROOT, 'simulator', 'index.html')
    with open(index_path, encoding='utf-8') as handle:
        index = handle.read()
    assert 'id="ti60ConnectTab-unit-under-test"' in index
    assert 'id="ti60UnitUnderTestView"' in index
    assert 'ARTIX-7 FPGA UNIT UNDER TEST' in index
    assert 'image_1787415762377.png' in index


def test_connect_view_explains_bit_testing_and_mcs_release_paths():
    index_path = os.path.join(ROOT, 'simulator', 'index.html')
    with open(index_path, encoding='utf-8') as handle:
        index = handle.read()
    assert 'Download <code>.bit</code> and load it over JTAG for temporary testing' in index
    assert 'Download <code>.mcs</code> and program SPI flash for a reset-resident release image' in index
    assert 'AMD Vivado ML Standard Edition includes Vivado Hardware Manager' in index


def test_attached_asset_route_serves_reference_images_only():
    client = app.test_client()
    response = client.get('/attached_assets/image_1787412016939.png')
    assert response.status_code == 200
    assert response.mimetype == 'image/png'
    board = client.get('/attached_assets/image_1787415762377.png')
    assert board.status_code == 200
    assert board.mimetype == 'image/png'
    assert client.get('/attached_assets/image_1787412016939.txt').status_code == 404
