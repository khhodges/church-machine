"""
tests/builder/test_zip_contents.py

Assert that _make_fpga_zip() for each board includes exactly the expected
set of filenames.  Uses minimal stub artifact files — no real Amaranth or
Yosys toolchain required.
"""

import os
import sys
import zipfile
import textwrap

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'server'))
from app import _make_fpga_zip, BUILD_MD_TI60, BUILD_MD_WUKONG, BUILD_MD_TANG


def _write_stub(path, content=b'stub'):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'wb') as f:
        f.write(content)


def _zip_namelist(buf):
    buf.seek(0)
    with zipfile.ZipFile(buf) as zf:
        return set(zf.namelist())


class TestTi60ZipContents:
    def test_exact_file_set(self, tmp_path):
        build_dir = tmp_path / 'build'
        hw_dir = tmp_path / 'hardware'
        build_dir.mkdir()
        hw_dir.mkdir()

        verilog = str(build_dir / 'church_ti60_f225.v')
        isf     = str(hw_dir   / 'ti60_f225.isf')
        project = str(hw_dir   / 'ti60_f225_project.xml')
        peri    = str(hw_dir   / 'ti60_f225.peri.xml')
        sdc     = str(hw_dir   / 'ti60_f225.sdc')
        setup   = str(hw_dir   / 'setup_ti60_peri.py')

        minimal_xml = textwrap.dedent("""\
            <?xml version="1.0" encoding="UTF-8"?>
            <efx:project xmlns:efx="http://www.efinixinc.com/enums-dtd">
              <efx:inter_file name=""/>
            </efx:project>
        """)
        for path in (verilog, isf, peri, sdc, setup):
            _write_stub(path)
        with open(project, 'w') as f:
            f.write(minimal_xml)

        # SoC+CM combined source stubs
        soc_combined = str(hw_dir / 'soc_combined')
        for fn in ('church_soc_cm.xml', 'build_soc_cm.sh', 'run_efx_map.sh',
                   'run_efx_pnr.sh', 'BUILD_SOC_CM.md'):
            _write_stub(os.path.join(soc_combined, fn))

        # Bitstream + bridge + patch script stubs
        bitstreams = str(tmp_path / 'bitstreams')
        server_dir = str(tmp_path / 'server')
        scripts_dir = str(tmp_path / 'scripts')
        for fn in ('church_ti60_f225.hex', 'church_ti60_f225.bit'):
            _write_stub(os.path.join(bitstreams, fn))
        _write_stub(os.path.join(server_dir, 'local_bridge.py'))
        _write_stub(os.path.join(scripts_dir, 'patch_sapphire_init.py'))

        paths = {
            'rtlil':   str(build_dir / 'church_ti60_f225.il'),
            'verilog': verilog,
            'isf':     isf,
            'project': project,
            'peri':    peri,
            'sdc':     sdc,
            'setup':   setup,
        }

        buf, zip_name, warnings = _make_fpga_zip(
            board='ti60-f225',
            is_ti60=True,
            paths=paths,
            zip_name='church-ti60-package.zip',
            build_md=BUILD_MD_TI60,
        )

        expected = {
            'church_ti60_f225.xml',
            'church_ti60_f225.v',
            'church_ti60_f225.sdc',
            'church_ti60_f225.peri.xml',
            'setup_ti60_peri.py',
            'Makefile',
            'BUILD.md',
            # SoC+CM combined rebuild files (must match server/app.py)
            'SoC/church_soc_cm.xml',
            'SoC/build_soc_cm.sh',
            'SoC/run_efx_map.sh',
            'SoC/run_efx_pnr.sh',
            'SoC/BUILD_SOC_CM.md',
            # Quick-flash bitstream + bridge + patch script
            'outflow/church_ti60_f225.hex',
            'outflow/church_ti60_f225.bit',
            'local_bridge.py',
            'scripts/patch_sapphire_init.py',
        }
        names = _zip_namelist(buf)
        assert expected <= names
        assert zip_name == 'church-ti60-package.zip'
        assert warnings == []


class TestWukongZipContents:
    def test_exact_file_set_with_all_artifacts(self, tmp_path):
        build_dir = tmp_path / 'build'
        hw_dir    = tmp_path / 'hardware'
        server_dir = tmp_path / 'server'
        build_dir.mkdir()
        hw_dir.mkdir()
        server_dir.mkdir()

        rtlil   = str(build_dir / 'church_wukong_xc7a100t.il')
        verilog = str(build_dir / 'church_wukong_xc7a100t.v')
        xdc     = str(hw_dir   / 'wukong_xc7a100t.xdc')
        tcl     = str(hw_dir   / 'wukong_xc7a100t.tcl')
        bridge  = str(server_dir / 'local_bridge.py')

        for path in (rtlil, verilog, xdc, tcl, bridge):
            _write_stub(path)

        paths = {
            'rtlil':   rtlil,
            'verilog': verilog,
            'xdc':     xdc,
            'tcl':     tcl,
        }

        import unittest.mock as mock
        with mock.patch('app.BASE_DIR', str(tmp_path)):
            buf, zip_name, warnings = _make_fpga_zip(
                board='wukong-xc7a100t',
                is_ti60=False,
                paths=paths,
                zip_name='church-wukong-package.zip',
                build_md=BUILD_MD_WUKONG,
            )

        expected = {
            'church_wukong_xc7a100t.il',
            'church_wukong_xc7a100t.v',
            'wukong_xc7a100t.xdc',
            'wukong_xc7a100t.tcl',
            'local_bridge.py',
            'BUILD.md',
        }
        assert _zip_namelist(buf) == expected
        assert zip_name == 'church-wukong-package.zip'
        assert warnings == []

    def test_file_set_without_optional_rtlil_and_verilog(self, tmp_path):
        build_dir = tmp_path / 'build'
        hw_dir    = tmp_path / 'hardware'
        server_dir = tmp_path / 'server'
        build_dir.mkdir()
        hw_dir.mkdir()
        server_dir.mkdir()

        xdc = str(hw_dir / 'wukong_xc7a100t.xdc')
        tcl = str(hw_dir / 'wukong_xc7a100t.tcl')
        bridge = str(server_dir / 'local_bridge.py')
        for path in (xdc, tcl, bridge):
            _write_stub(path)

        paths = {
            'rtlil':   str(build_dir / 'church_wukong_xc7a100t.il'),
            'verilog': str(build_dir / 'church_wukong_xc7a100t.v'),
            'xdc':     xdc,
            'tcl':     tcl,
        }

        import unittest.mock as mock
        with mock.patch('app.BASE_DIR', str(tmp_path)):
            buf, _, _ = _make_fpga_zip(
                board='wukong-xc7a100t',
                is_ti60=False,
                paths=paths,
                zip_name='church-wukong-package.zip',
                build_md=BUILD_MD_WUKONG,
            )

        names = _zip_namelist(buf)
        assert 'wukong_xc7a100t.xdc' in names
        assert 'wukong_xc7a100t.tcl' in names
        assert 'local_bridge.py' in names
        assert 'BUILD.md' in names
        assert 'church_wukong_xc7a100t.il' not in names
        assert 'church_wukong_xc7a100t.v' not in names


class TestTangNanoZipContents:
    def _make_paths(self, build_dir, hw_dir):
        return {
            'rtlil':    str(build_dir / 'church_tang_nano_20k.il'),
            'verilog':  str(build_dir / 'church_tang_nano_20k.v'),
            'json':     str(build_dir / 'church_tang_nano_20k.json'),
            'cst':      str(hw_dir   / 'tang_nano_20k.cst'),
            'makefile': str(hw_dir   / 'Makefile'),
        }

    def test_exact_file_set_all_artifacts(self, tmp_path):
        build_dir  = tmp_path / 'build'
        hw_dir     = tmp_path / 'hardware'
        server_dir = tmp_path / 'server'
        build_dir.mkdir(); hw_dir.mkdir(); server_dir.mkdir()

        paths = self._make_paths(build_dir, hw_dir)
        for path in paths.values():
            _write_stub(path, b'{}' if path.endswith('.json') else b'stub')
        _write_stub(str(server_dir / 'local_bridge.py'))

        import unittest.mock as mock
        with mock.patch('app.BASE_DIR', str(tmp_path)):
            buf, zip_name, _ = _make_fpga_zip(
                board='tang-nano-20k',
                is_ti60=False,
                paths=paths,
                zip_name='church-nano-package.zip',
                build_md=BUILD_MD_TANG,
            )

        expected = {
            'church_tang_nano_20k.il',
            'church_tang_nano_20k.v',
            'church_tang_nano_20k.json',
            'tang_nano_20k.cst',
            'Makefile',
            'flash.sh',
            'bridge.sh',
            'local_bridge.py',
            'BUILD.md',
        }
        assert _zip_namelist(buf) == expected
        assert zip_name == 'church-nano-package.zip'

    def test_file_set_rtlil_only(self, tmp_path):
        """When Yosys synthesis timed out — only RTLIL present, no .v or .json."""
        build_dir  = tmp_path / 'build'
        hw_dir     = tmp_path / 'hardware'
        server_dir = tmp_path / 'server'
        build_dir.mkdir(); hw_dir.mkdir(); server_dir.mkdir()

        paths = self._make_paths(build_dir, hw_dir)
        _write_stub(paths['rtlil'])
        _write_stub(paths['cst'])
        _write_stub(paths['makefile'])
        _write_stub(str(server_dir / 'local_bridge.py'))

        import unittest.mock as mock
        with mock.patch('app.BASE_DIR', str(tmp_path)):
            buf, _, _ = _make_fpga_zip(
                board='tang-nano-20k',
                is_ti60=False,
                paths=paths,
                zip_name='church-nano-package.zip',
                build_md=BUILD_MD_TANG,
            )

        names = _zip_namelist(buf)
        assert 'church_tang_nano_20k.il' in names
        assert 'tang_nano_20k.cst' in names
        assert 'Makefile' in names
        assert 'flash.sh' in names
        assert 'bridge.sh' in names
        assert 'local_bridge.py' in names
        assert 'BUILD.md' in names
        assert 'church_tang_nano_20k.v' not in names
        assert 'church_tang_nano_20k.json' not in names
