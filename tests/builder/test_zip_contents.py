"""
tests/builder/test_zip_contents.py

Assert that _make_fpga_zip() for the Wukong XC7A100T includes
exactly the expected set of filenames.  Uses minimal stub artifact files — no
real Amaranth or Yosys toolchain required.

The Wukong zip is built from:
  - build/church_wukong_xc7a100t.v         → church_wukong_xc7a100t.v
  - build/church_wukong_xc7a100t.il        → church_wukong_xc7a100t.il  (optional)
  - hardware/wukong_xc7a100t.xdc           → wukong_xc7a100t.xdc
  - hardware/wukong_xc7a100t.tcl           → wukong_xc7a100t.tcl
  - hardware/wukong_bridge.py              → wukong_bridge.py
  - server/local_bridge.py                 → local_bridge.py
  - BUILD.md string (always present)
"""

import os
import sys
import zipfile

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'server'))
from app import _make_fpga_zip, BUILD_MD_WUKONG


def _write_stub(path, content=b'stub'):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'wb') as f:
        f.write(content)


def _zip_namelist(buf):
    buf.seek(0)
    with zipfile.ZipFile(buf) as zf:
        return set(zf.namelist())


class TestWukongZipContents:
    """Wukong XC7A100T ZIP — Vivado flow, no soc_combined directory."""

    def _setup_stubs(self, tmp_path):
        build_dir = tmp_path / 'build'
        hw_dir = tmp_path / 'hardware'
        server_dir = tmp_path / 'server'

        _write_stub(str(build_dir / 'church_wukong_xc7a100t.v'))
        _write_stub(str(build_dir / 'church_wukong_xc7a100t.il'))
        _write_stub(str(hw_dir / 'wukong_xc7a100t.xdc'))
        _write_stub(str(hw_dir / 'wukong_xc7a100t.tcl'))
        _write_stub(str(hw_dir / 'wukong_bridge.py'))
        _write_stub(str(server_dir / 'local_bridge.py'))

        return {
            'verilog': str(build_dir / 'church_wukong_xc7a100t.v'),
            'rtlil':   str(build_dir / 'church_wukong_xc7a100t.il'),
            'xdc':     str(hw_dir / 'wukong_xc7a100t.xdc'),
            'tcl':     str(hw_dir / 'wukong_xc7a100t.tcl'),
            'wukong_bridge': str(hw_dir / 'wukong_bridge.py'),
        }

    def test_required_files_present(self, tmp_path):
        """Verilog, XDC, both bridge helpers, and BUILD.md are always in the ZIP."""
        import unittest.mock as mock
        paths = self._setup_stubs(tmp_path)
        with mock.patch('app.BASE_DIR', str(tmp_path)):
            buf, zip_name, warnings = _make_fpga_zip(
                board='wukong-xc7a100t',
                paths=paths,
                zip_name='church-wukong-package.zip',
                build_md=BUILD_MD_WUKONG,
            )
        names = _zip_namelist(buf)
        assert 'church_wukong_xc7a100t.v' in names
        assert 'wukong_xc7a100t.xdc' in names
        assert 'wukong_xc7a100t.tcl' in names
        assert 'wukong_bridge.py' in names
        assert 'local_bridge.py' in names
        assert 'BUILD.md' in names
        assert zip_name == 'church-wukong-package.zip'

    def test_rtlil_included_when_present(self, tmp_path):
        """RTLIL file is included in the ZIP when it exists on disk."""
        import unittest.mock as mock
        paths = self._setup_stubs(tmp_path)
        with mock.patch('app.BASE_DIR', str(tmp_path)):
            buf, _, _ = _make_fpga_zip(
                board='wukong-xc7a100t',
                paths=paths,
                zip_name='church-wukong-package.zip',
                build_md=BUILD_MD_WUKONG,
            )
        names = _zip_namelist(buf)
        assert 'church_wukong_xc7a100t.il' in names

    def test_missing_verilog_produces_warning(self, tmp_path):
        """Missing Verilog file emits a warning but still produces a ZIP."""
        import unittest.mock as mock
        hw_dir = tmp_path / 'hardware'
        server_dir = tmp_path / 'server'
        _write_stub(str(hw_dir / 'wukong_xc7a100t.xdc'))
        _write_stub(str(hw_dir / 'wukong_xc7a100t.tcl'))
        _write_stub(str(hw_dir / 'wukong_bridge.py'))
        _write_stub(str(server_dir / 'local_bridge.py'))
        paths = {
            'verilog': str(tmp_path / 'build' / 'church_wukong_xc7a100t.v'),
            'rtlil':   str(tmp_path / 'build' / 'church_wukong_xc7a100t.il'),
            'xdc':     str(hw_dir / 'wukong_xc7a100t.xdc'),
            'tcl':     str(hw_dir / 'wukong_xc7a100t.tcl'),
            'wukong_bridge': str(hw_dir / 'wukong_bridge.py'),
        }
        with mock.patch('app.BASE_DIR', str(tmp_path)):
            buf, _, warnings = _make_fpga_zip(
                board='wukong-xc7a100t',
                paths=paths,
                zip_name='church-wukong-package.zip',
                build_md=BUILD_MD_WUKONG,
            )
        assert any('church_wukong_xc7a100t.v' in w for w in warnings)
        names = _zip_namelist(buf)
        assert 'BUILD.md' in names

    def test_exact_filename_set_no_extras(self, tmp_path):
        """ZIP contains exactly the expected files — no extra artifacts."""
        import unittest.mock as mock
        paths = self._setup_stubs(tmp_path)
        with mock.patch('app.BASE_DIR', str(tmp_path)):
            buf, _, _ = _make_fpga_zip(
                board='wukong-xc7a100t',
                paths=paths,
                zip_name='church-wukong-package.zip',
                build_md=BUILD_MD_WUKONG,
            )
        names = _zip_namelist(buf)
        expected = {
            'church_wukong_xc7a100t.v',
            'church_wukong_xc7a100t.il',
            'wukong_xc7a100t.xdc',
            'wukong_xc7a100t.tcl',
            'wukong_bridge.py',
            'local_bridge.py',
            'BUILD.md',
        }
        assert names == expected
