"""Regression tests for the FPGA execution-workspace code map."""

import os
import sys

import pytest

ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), '..', '..'))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

import server.app as app_module
from server.app import app


@pytest.fixture()
def client():
    app.config['TESTING'] = True
    old_info = app_module._wukong_active_lump_info
    app_module._wukong_active_lump_info = {}
    with app.test_client() as c:
        yield c
    app_module._wukong_active_lump_info = old_info


def test_reference_listing_uses_hardware_nia_addresses(client):
    response = client.get('/hardware/wukong/code')

    assert response.status_code == 200
    data = response.get_json()
    assert data['ok'] is True
    assert data['source_map'] == 'reference-bitstream'
    assert [row['nia'] for row in data['rows'][:3]] == [0, 4, 8]
    assert data['rows'][0]['nia_label'] == 'Boot.0'
    assert data['rows'][0]['disasm']
    assert data['rows'][3]['nia'] == 0x600
    assert data['rows'][3]['nia_label'] == 'SelfTest.0'
    wch_header = next(row for row in data['rows']
                      if row['nia_label'] == 'WukongCallHome.0')
    assert wch_header['nia'] == 0x1200
    wch_first = next(row for row in data['rows']
                     if row['nia_label'] == 'WukongCallHome.1')
    assert wch_first['nia'] == 0x1204
    assert [row['disasm'] for row in data['rows'][:3]] == [
        'LOAD NAMESPACE CD15',
        'LOAD THREAD+HEAP CR12+, CR5',
        'CALL CR[0] SelfTest',
    ]
    assert all('<unknown>' not in row['disasm'] for row in data['rows']
               if row['nia_label'].startswith('WukongCallHome.'))


def test_known_pet_name_never_uses_unknown_decoder_placeholder(client, monkeypatch):
    """A known lump remains inspectable if the optional decoder is unavailable."""
    monkeypatch.setattr(app_module, '_wts_disasm', lambda _word: '<unknown>')

    data = client.get('/hardware/wukong/code').get_json()

    known_rows = [row for row in data['rows']
                  if row['nia_label'].startswith('WukongCallHome.')]
    assert known_rows
    assert all(row['disasm'] != '<unknown>' for row in known_rows)
    assert known_rows[1]['disasm'] == 'WORD 0x071B0005'


def test_uploaded_listing_uses_active_lump_map(client):
    app_module._wukong_active_lump_info = {
        'base_byte': 0x200,
        'name': 'Demo',
        'lump_words': {0: 0x12345678, 1: 0xB8007FFE},
    }

    data = client.get('/hardware/wukong/code').get_json()

    assert data['source_map'] == 'uploaded'
    rows = {row['nia']: row for row in data['rows']}
    assert rows[0x200]['nia_label'] == 'Demo.0'
    assert rows[0x200]['disasm'] == 'LUMP_HEADER'
    assert rows[0x204]['word'] == 0xB8007FFE
    assert rows[0x204]['nia_label'] == 'Demo.1'


def test_trace_wukongcallhome_wins_over_overlapping_uploaded_selftest(client):
    """A live WCH NIA must not be displayed as the cached SelfTest lump."""
    app_module._wukong_active_lump_info = {
        'base_byte': 0x600,
        'name': 'SelfTest',
        'lump_words': {0: 0x12345678, 1: 0xB8007FFE},
    }

    data = client.get('/hardware/wukong/code?trace_nia=0x1204').get_json()

    assert data['source_map'] == 'reference-bitstream'
    assert data['trace_authoritative'] is True
    assert data['trace_pet_name'] == 'WukongCallHome'
    rows = {row['nia']: row for row in data['rows']}
    assert rows[0x1204]['nia_label'] == 'WukongCallHome.1'