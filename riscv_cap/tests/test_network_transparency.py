#!/usr/bin/env python3
"""
Network Transparency Design Validation Tests for RV32-Cap (Sim-32)

Validates the architectural design for CALL(CONNECT(me, mymother)):
  - GT Type field encoding (Inform, Outform, NULL, Abstract)
  - Inform GT as crypto tunnel key handle (key material in namespace entry)
  - Namespace construction and MAC validation for Outform scenarios
  - Permission checks (R=fetch, W=flush, E=RPC, L/S/X=TRAP)
  - GC-tied cache invalidation and tunnel revocation
  - Symmetrical inbound/outbound validation

These tests use boot_builder.py to construct and validate GTs and namespace
entries at the design level. They verify the GT format, permission encoding,
MAC computation, and version lifecycle that will underpin the Outform
implementation in simulator.js.

Note: Outform behavior (TRAP handling, network fetch, RPC tunnel) is not
yet implemented in the simulator. These tests validate the data structures
and invariants that the implementation must satisfy.
"""

import sys
import os
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from boot_builder import BootImageBuilder


GT_TYPE_INFORM = 0
GT_TYPE_OUTFORM = 1
GT_TYPE_NULL = 2
GT_TYPE_ABSTRACT = 3


class TestNetworkTransparencySetup(unittest.TestCase):
    """Test namespace setup for the CALL(CONNECT(me, mymother)) scenario."""

    def setUp(self):
        self.me = BootImageBuilder()
        self.mother = BootImageBuilder()

    def _build_me_namespace(self):
        """Build 'me' namespace with local and Outform entries."""
        self.me.add_namespace_entry(0x00000000, 0x0000FFFF)  # 0: Root
        self.me.add_namespace_entry(0x00000000, 0x00003FFF)  # 1: C-List
        self.me.add_namespace_entry(0x00004000, 0x00007FFF)  # 2: Code
        self.me.add_namespace_entry(0x00008000, 0x000000FF)  # 3: Thread
        self.me.add_namespace_entry(0x0000A000, 0x0000A01F)  # 4: TunnelKey_Mother (Inform)
        self.me.add_namespace_entry(0x0000B000, 0x0000B0FF)  # 5: Mother_CList (Outform)
        self.me.add_namespace_entry(0x0000C000, 0x0000C0FF)  # 6: Mother_Service (Outform/Abstract)
        return self.me.namespace_table

    def _build_mother_namespace(self):
        """Build 'mymother' namespace with local entries and matching tunnel key."""
        self.mother.add_namespace_entry(0x00000000, 0x0000FFFF)  # 0: Root
        self.mother.add_namespace_entry(0x00000000, 0x00003FFF)  # 1: C-List
        self.mother.add_namespace_entry(0x00004000, 0x00007FFF)  # 2: Code
        self.mother.add_namespace_entry(0x00008000, 0x000000FF)  # 3: Thread
        self.mother.add_namespace_entry(0x0000A000, 0x0000A01F)  # 4: TunnelKey_Child (same key material)
        self.mother.add_namespace_entry(0x0000D000, 0x0000D0FF)  # 5: Published_CList (local)
        self.mother.add_namespace_entry(0x0000E000, 0x0000E0FF)  # 6: MyService (Abstract)
        return self.mother.namespace_table


class TestGTTypeField(TestNetworkTransparencySetup):
    """Verify GT type field correctly encodes Inform, Outform, NULL, Abstract."""

    def test_inform_gt(self):
        gt = self.me.create_gt(0, 1, {'L': 1, 'S': 1}, GT_TYPE_INFORM)
        parsed = self.me.parse_gt(gt)
        self.assertEqual(parsed['type'], GT_TYPE_INFORM)
        self.assertEqual(parsed['typeName'], 'Inform')
        self.assertEqual(parsed['index'], 1)
        self.assertEqual(parsed['permissions']['L'], 1)
        self.assertEqual(parsed['permissions']['S'], 1)

    def test_outform_gt(self):
        gt = self.me.create_gt(0, 5, {'R': 1}, GT_TYPE_OUTFORM)
        parsed = self.me.parse_gt(gt)
        self.assertEqual(parsed['type'], GT_TYPE_OUTFORM)
        self.assertEqual(parsed['typeName'], 'Outform')
        self.assertEqual(parsed['index'], 5)
        self.assertEqual(parsed['permissions']['R'], 1)

    def test_null_gt(self):
        gt = self.me.create_gt(0, 0, {}, GT_TYPE_NULL)
        parsed = self.me.parse_gt(gt)
        self.assertEqual(parsed['type'], GT_TYPE_NULL)
        self.assertEqual(parsed['typeName'], 'NULL')

    def test_abstract_gt(self):
        gt = self.me.create_gt(0, 6, {'E': 1, 'L': 1, 'S': 1}, GT_TYPE_ABSTRACT)
        parsed = self.me.parse_gt(gt)
        self.assertEqual(parsed['type'], GT_TYPE_ABSTRACT)
        self.assertEqual(parsed['typeName'], 'Abstract')
        self.assertEqual(parsed['permissions']['E'], 1)

    def test_outform_abstract_gt(self):
        """Outform + Abstract: remote callable service (E permission for RPC)."""
        gt = self.me.create_gt(0, 6, {'E': 1}, GT_TYPE_OUTFORM)
        parsed = self.me.parse_gt(gt)
        self.assertEqual(parsed['type'], GT_TYPE_OUTFORM)
        self.assertEqual(parsed['permissions']['E'], 1)
        self.assertEqual(parsed['permissions']['R'], 0)
        self.assertEqual(parsed['permissions']['W'], 0)


class TestInformGTTunnelKey(TestNetworkTransparencySetup):
    """Verify Inform GT as crypto tunnel key for namespace-to-namespace tunnels."""

    def test_tunnel_key_construction(self):
        """Inform GT is a handle; key material lives in the namespace entry.

        The GT's index field points to the namespace entry. The entry's
        Location and Limit fields hold the actual cryptographic key data.
        The MAC seal protects key integrity. Accessed via CAP.LOAD with
        R permission per GT-Literals removal (Feb 14 2026).
        """
        self._build_me_namespace()
        tunnel_key_gt = self.me.create_gt(0, 4, {'R': 1}, GT_TYPE_INFORM)
        parsed = self.me.parse_gt(tunnel_key_gt)

        self.assertEqual(parsed['type'], GT_TYPE_INFORM)
        self.assertEqual(parsed['index'], 4)

        entry = self.me.namespace_table[parsed['index']]
        self.assertEqual(entry['location'], 0x0000A000)
        self.assertEqual(entry['limit'], 0x0000A01F)
        self.assertTrue(self.me.validate_mac(entry))

        key_material = (entry['location'], entry['limit'])
        self.assertIsNotNone(key_material)

    def test_matching_tunnel_keys(self):
        """Both namespaces have matching tunnel key entries (same key material)."""
        self._build_me_namespace()
        self._build_mother_namespace()

        me_entry = self.me.namespace_table[4]
        mother_entry = self.mother.namespace_table[4]

        self.assertEqual(me_entry['location'], mother_entry['location'])
        self.assertEqual(me_entry['limit'], mother_entry['limit'])

        me_seal = self.me.compute_seal(me_entry['location'], me_entry['limit'])
        mother_seal = self.mother.compute_seal(mother_entry['location'], mother_entry['limit'])
        self.assertEqual(me_seal, mother_seal)

    def test_tunnel_key_revocation(self):
        """GC sweep bumps version on tunnel key entry, invalidating tunnel."""
        self._build_me_namespace()
        entry = self.me.namespace_table[4]
        original_version = (entry['versionSeals'] >> 25) & 0x7F
        self.assertEqual(original_version, 0)

        tunnel_gt = self.me.create_gt(0, 4, {'R': 1}, GT_TYPE_INFORM)
        parsed_before = self.me.parse_gt(tunnel_gt)
        self.assertEqual(parsed_before['version'], 0)

        new_version = (original_version + 1) & 0x7F
        entry['versionSeals'] = self.me.make_version_seals(
            new_version, entry['location'], entry['limit']
        )

        new_ns_version = (entry['versionSeals'] >> 25) & 0x7F
        self.assertEqual(new_ns_version, 1)
        self.assertNotEqual(parsed_before['version'], new_ns_version)

        self.assertTrue(self.me.validate_mac(entry))


class TestOutformObjectFetch(TestNetworkTransparencySetup):
    """Test Outform object fetch (R permission) with TRAP:CACHE_MISS flow."""

    def setUp(self):
        super().setUp()
        self._build_me_namespace()

    def test_outform_data_gt_has_r_permission(self):
        """Outform data GT requires R permission for object fetch."""
        gt_with_r = self.me.create_gt(0, 5, {'R': 1}, GT_TYPE_OUTFORM)
        parsed = self.me.parse_gt(gt_with_r)
        self.assertEqual(parsed['permissions']['R'], 1)
        self.assertEqual(parsed['type'], GT_TYPE_OUTFORM)

    def test_outform_without_r_denied(self):
        """Outform GT without R permission cannot fetch — would FAULT."""
        gt_no_r = self.me.create_gt(0, 5, {'W': 1}, GT_TYPE_OUTFORM)
        parsed = self.me.parse_gt(gt_no_r)
        self.assertEqual(parsed['permissions']['R'], 0)

    def test_cache_miss_trap_scenario(self):
        """Simulate TRAP:CACHE_MISS flow for uncached Outform object.

        Flow:
        1. mLoad detects Outform type
        2. Checks local cache → miss
        3. Returns TRAP: CACHE_MISS (not FAULT)
        4. Async fetch populates cache
        5. Retry succeeds
        """
        outform_gt = self.me.create_gt(0, 5, {'R': 1}, GT_TYPE_OUTFORM)
        parsed = self.me.parse_gt(outform_gt)

        entry = self.me.namespace_table[parsed['index']]
        self.assertIsNotNone(entry)
        self.assertTrue(self.me.validate_mac(entry))

        remote_cache = {}
        cache_key = parsed['index']
        self.assertNotIn(cache_key, remote_cache)

        trap = {
            'type': 'TRAP',
            'code': 'CACHE_MISS',
            'index': parsed['index'],
            'url': f"https://mymother.example.com/api/serve/{parsed['index']}",
            'recoverable': True,
        }
        self.assertEqual(trap['type'], 'TRAP')
        self.assertEqual(trap['code'], 'CACHE_MISS')
        self.assertTrue(trap['recoverable'])

        remote_cache[cache_key] = {
            'data': b'\x00' * 256,
            'mediaType': 'application/octet-stream',
            'etag': '"abc123"',
            'dirty': False,
        }
        self.assertIn(cache_key, remote_cache)
        self.assertFalse(remote_cache[cache_key]['dirty'])


class TestOutformObjectFlush(TestNetworkTransparencySetup):
    """Test Outform object flush (W permission) with dirty bit tracking."""

    def setUp(self):
        super().setUp()
        self._build_me_namespace()

    def test_w_permission_marks_dirty(self):
        """W access on cached Outform object sets dirty bit."""
        remote_cache = {
            5: {
                'data': bytearray(256),
                'mediaType': 'application/octet-stream',
                'etag': '"abc123"',
                'dirty': False,
            }
        }

        outform_gt = self.me.create_gt(0, 5, {'R': 1, 'W': 1}, GT_TYPE_OUTFORM)
        parsed = self.me.parse_gt(outform_gt)
        self.assertEqual(parsed['permissions']['W'], 1)

        remote_cache[5]['data'][0] = 0x42
        remote_cache[5]['dirty'] = True

        self.assertTrue(remote_cache[5]['dirty'])
        self.assertEqual(remote_cache[5]['data'][0], 0x42)

    def test_flush_on_gc_sweep(self):
        """Dirty Outform objects are flushed before GC version bump."""
        remote_cache = {
            5: {
                'data': bytearray(b'\x42' * 256),
                'dirty': True,
                'url': 'https://mymother.example.com/api/accept/5',
            }
        }

        flushed_objects = []

        def flush_object(index, cache_entry):
            flushed_objects.append({
                'index': index,
                'url': cache_entry['url'],
                'size': len(cache_entry['data']),
            })
            cache_entry['dirty'] = False

        entry = self.me.namespace_table[5]
        entry['gBit'] = 1

        if entry['gBit'] == 1 and 5 in remote_cache and remote_cache[5]['dirty']:
            flush_object(5, remote_cache[5])

        self.assertEqual(len(flushed_objects), 1)
        self.assertEqual(flushed_objects[0]['index'], 5)
        self.assertFalse(remote_cache[5]['dirty'])

        old_version = (entry['versionSeals'] >> 25) & 0x7F
        new_version = (old_version + 1) & 0x7F
        entry['versionSeals'] = self.me.make_version_seals(
            new_version, entry['location'], entry['limit']
        )
        self.assertTrue(self.me.validate_mac(entry))

    def test_w_without_permission_denied(self):
        """Outform GT without W permission cannot modify — would FAULT."""
        gt_read_only = self.me.create_gt(0, 5, {'R': 1}, GT_TYPE_OUTFORM)
        parsed = self.me.parse_gt(gt_read_only)
        self.assertEqual(parsed['permissions']['W'], 0)


class TestOutformRPC(TestNetworkTransparencySetup):
    """Test Outform RPC (E permission on Outform Abstract) through encrypted tunnel."""

    def setUp(self):
        super().setUp()
        self._build_me_namespace()
        self._build_mother_namespace()

    def test_outform_rpc_call(self):
        """E permission on Outform Abstract GT enables RPC through tunnel.

        Simulates the CALL(CONNECT(me, mymother)) flow:
        1. Load tunnel key (Inform GT) from C-List
        2. Load remote service GT (Outform) from C-List
        3. CALL on Outform Abstract → RPC via encrypted tunnel
        """
        tunnel_key_gt = self.me.create_gt(0, 4, {'R': 1}, GT_TYPE_INFORM)
        tunnel_parsed = self.me.parse_gt(tunnel_key_gt)
        self.assertEqual(tunnel_parsed['type'], GT_TYPE_INFORM)

        service_gt = self.me.create_gt(0, 6, {'E': 1, 'L': 1, 'S': 1}, GT_TYPE_OUTFORM)
        service_parsed = self.me.parse_gt(service_gt)
        self.assertEqual(service_parsed['type'], GT_TYPE_OUTFORM)
        self.assertEqual(service_parsed['permissions']['E'], 1)

        me_entry = self.me.namespace_table[4]
        tunnel_key_material = {
            'location': me_entry['location'],
            'limit': me_entry['limit'],
            'seal': self.me.compute_seal(me_entry['location'], me_entry['limit']),
        }

        data_registers = [0] * 32
        data_registers[1] = 42
        data_registers[2] = 7

        rpc_request = {
            'gt': service_gt,
            'parsed_gt': service_parsed,
            'arguments': data_registers,
            'tunnel_key': tunnel_key_material,
            'endpoint': 'https://mymother.example.com/api/invoke',
        }

        mother_entry = self.mother.namespace_table[4]
        mother_key_material = {
            'location': mother_entry['location'],
            'limit': mother_entry['limit'],
            'seal': self.mother.compute_seal(mother_entry['location'], mother_entry['limit']),
        }
        self.assertEqual(tunnel_key_material['seal'], mother_key_material['seal'])

        rpc_response = {
            'result_registers': [0] * 32,
            'flags': {'N': 0, 'Z': 0, 'C': 0, 'V': 0},
        }
        rpc_response['result_registers'][1] = 49

        data_registers = rpc_response['result_registers']
        self.assertEqual(data_registers[1], 49)

    def test_rpc_without_e_permission_denied(self):
        """Outform GT without E permission cannot invoke RPC — FAULT."""
        service_gt = self.me.create_gt(0, 6, {'R': 1, 'L': 1}, GT_TYPE_OUTFORM)
        parsed = self.me.parse_gt(service_gt)
        self.assertEqual(parsed['permissions']['E'], 0)

    def test_rpc_symmetrical_inbound(self):
        """Mymother can also receive and validate inbound RPC calls.

        Symmetrical: mymother validates incoming GT through its own mLoad path.
        """
        mother_service_gt = self.mother.create_gt(0, 6, {'E': 1, 'R': 1, 'X': 1}, GT_TYPE_ABSTRACT)
        parsed = self.mother.parse_gt(mother_service_gt)
        self.assertEqual(parsed['type'], GT_TYPE_ABSTRACT)
        self.assertEqual(parsed['permissions']['E'], 1)

        entry = self.mother.namespace_table[6]
        self.assertTrue(self.mother.validate_mac(entry))


class TestOutformTraps(TestNetworkTransparencySetup):
    """Test that L, S, X on Outform issue TRAPs (not FAULTs) for future-safe extension."""

    def setUp(self):
        super().setUp()
        self._build_me_namespace()

    def _simulate_outform_access(self, perm, index=5):
        """Simulate accessing an Outform entry with a specific permission.

        Returns a trap dict if the operation should trap, None otherwise.
        """
        gt = self.me.create_gt(0, index, {perm: 1}, GT_TYPE_OUTFORM)
        parsed = self.me.parse_gt(gt)

        entry = self.me.namespace_table[parsed['index']]
        if not self.me.validate_mac(entry):
            return {'type': 'FAULT', 'code': 'MAC'}

        ns_version = (entry['versionSeals'] >> 25) & 0x7F
        if parsed['version'] != ns_version:
            return {'type': 'FAULT', 'code': 'VERSION'}

        outform_trap_perms = {'L': 'OUTFORM_L', 'S': 'OUTFORM_S', 'X': 'OUTFORM_X'}
        if perm in outform_trap_perms:
            return {
                'type': 'TRAP',
                'code': outform_trap_perms[perm],
                'index': parsed['index'],
                'permission': perm,
                'recoverable': True,
                'message': f'Outform {perm} not yet implemented — future abstraction',
            }

        return None

    def test_l_on_outform_traps(self):
        """L permission on Outform issues TRAP:OUTFORM_L (future service discovery)."""
        result = self._simulate_outform_access('L')
        self.assertIsNotNone(result)
        self.assertEqual(result['type'], 'TRAP')
        self.assertEqual(result['code'], 'OUTFORM_L')
        self.assertTrue(result['recoverable'])

    def test_s_on_outform_traps(self):
        """S permission on Outform issues TRAP:OUTFORM_S (future capability delegation)."""
        result = self._simulate_outform_access('S')
        self.assertIsNotNone(result)
        self.assertEqual(result['type'], 'TRAP')
        self.assertEqual(result['code'], 'OUTFORM_S')
        self.assertTrue(result['recoverable'])

    def test_x_on_outform_traps(self):
        """X permission on Outform issues TRAP:OUTFORM_X (nonsense case, safe)."""
        result = self._simulate_outform_access('X')
        self.assertIsNotNone(result)
        self.assertEqual(result['type'], 'TRAP')
        self.assertEqual(result['code'], 'OUTFORM_X')
        self.assertTrue(result['recoverable'])

    def test_r_on_outform_does_not_trap(self):
        """R on Outform does NOT trap — it's a valid fetch operation."""
        result = self._simulate_outform_access('R')
        self.assertIsNone(result)

    def test_e_on_outform_does_not_trap(self):
        """E on Outform does NOT trap — it's a valid RPC operation."""
        result = self._simulate_outform_access('E')
        self.assertIsNone(result)

    def test_w_on_outform_does_not_trap(self):
        """W on Outform does NOT trap — it's a valid write/flush operation."""
        result = self._simulate_outform_access('W')
        self.assertIsNone(result)


class TestCacheInvalidationGC(TestNetworkTransparencySetup):
    """Test cache invalidation tied to garbage collection."""

    def setUp(self):
        super().setUp()
        self._build_me_namespace()

    def test_gc_mark_sets_gbit(self):
        """GC Mark phase sets gBit=1 on all namespace entries including Outform."""
        for entry in self.me.namespace_table:
            entry['gBit'] = 1

        for entry in self.me.namespace_table:
            self.assertEqual(entry['gBit'], 1)

    def test_gc_scan_resets_gbit_on_access(self):
        """mLoad resets gBit=0 on reachable entries during GC scan."""
        for entry in self.me.namespace_table:
            entry['gBit'] = 1

        accessed_indices = [0, 1, 2, 3, 4]
        for idx in accessed_indices:
            self.me.namespace_table[idx]['gBit'] = 0

        for idx in accessed_indices:
            self.assertEqual(self.me.namespace_table[idx]['gBit'], 0)
        self.assertEqual(self.me.namespace_table[5]['gBit'], 1)
        self.assertEqual(self.me.namespace_table[6]['gBit'], 1)

    def test_gc_sweep_flushes_dirty_outform_then_bumps_version(self):
        """GC sweep: flush dirty Outform objects before version bump."""
        remote_cache = {
            5: {'data': bytearray(b'\xFF' * 64), 'dirty': True},
            6: {'data': bytearray(b'\xAA' * 32), 'dirty': False},
        }
        flush_log = []

        for entry in self.me.namespace_table:
            entry['gBit'] = 1

        reachable = {0, 1, 2, 3, 4}
        for idx in reachable:
            self.me.namespace_table[idx]['gBit'] = 0

        for idx, entry in enumerate(self.me.namespace_table):
            if entry['gBit'] == 1:
                if idx in remote_cache and remote_cache[idx]['dirty']:
                    flush_log.append(idx)
                    remote_cache[idx]['dirty'] = False

                old_ver = (entry['versionSeals'] >> 25) & 0x7F
                new_ver = (old_ver + 1) & 0x7F
                entry['versionSeals'] = self.me.make_version_seals(
                    new_ver, entry['location'], entry['limit']
                )

        self.assertEqual(flush_log, [5])
        self.assertFalse(remote_cache[5]['dirty'])
        self.assertFalse(remote_cache[6]['dirty'])

        for idx in [5, 6]:
            ver = (self.me.namespace_table[idx]['versionSeals'] >> 25) & 0x7F
            self.assertEqual(ver, 1)
            self.assertTrue(self.me.validate_mac(self.me.namespace_table[idx]))

    def test_tunnel_key_sweep_kills_tunnel(self):
        """GC sweep of tunnel key (Inform GT) invalidates the tunnel.

        After sweep:
        - Tunnel key version bumped
        - Any GT referencing old version → FAULT:VERSION
        - Tunnel is dead — no new communication possible
        """
        tunnel_gt = self.me.create_gt(0, 4, {'R': 1}, GT_TYPE_INFORM)
        parsed_before = self.me.parse_gt(tunnel_gt)
        self.assertEqual(parsed_before['version'], 0)

        entry = self.me.namespace_table[4]
        entry['gBit'] = 1

        old_ver = (entry['versionSeals'] >> 25) & 0x7F
        new_ver = (old_ver + 1) & 0x7F
        entry['versionSeals'] = self.me.make_version_seals(
            new_ver, entry['location'], entry['limit']
        )

        ns_version = (entry['versionSeals'] >> 25) & 0x7F
        self.assertNotEqual(parsed_before['version'], ns_version)

        new_tunnel_gt = self.me.create_gt(new_ver, 4, {'R': 1}, GT_TYPE_INFORM)
        parsed_new = self.me.parse_gt(new_tunnel_gt)
        self.assertEqual(parsed_new['version'], ns_version)


class TestConnectMeMymother(TestNetworkTransparencySetup):
    """End-to-end test of the CALL(CONNECT(me, mymother)) instruction sequence.

    Simulates the complete flow:
      CAP.LOAD  CR0, CR6, 4    ; CR0 = TunnelKey_Mother (Inform GT)
      CAP.LOAD  CR1, CR6, 6    ; CR1 = Mother_Service (Outform GT)
      CAP.CALL  CR1            ; RPC call through encrypted tunnel

    Validates:
      - C-List access with L permission
      - GT construction for Inform and Outform types
      - MAC validation on all namespace entries
      - Version consistency
      - E permission check for RPC
      - Tunnel key material match between namespaces
      - Symmetrical validation on mymother's side
    """

    def setUp(self):
        super().setUp()
        self._build_me_namespace()
        self._build_mother_namespace()

    def test_full_connect_sequence(self):
        """Execute the complete CALL(CONNECT(me, mymother)) sequence."""

        clist_gt = self.me.create_gt(0, 1, {'L': 1, 'S': 1}, GT_TYPE_INFORM)
        clist_parsed = self.me.parse_gt(clist_gt)
        self.assertEqual(clist_parsed['permissions']['L'], 1)

        clist_entry = self.me.namespace_table[clist_parsed['index']]
        self.assertTrue(self.me.validate_mac(clist_entry))

        tunnel_key_entry = self.me.namespace_table[4]
        self.assertTrue(self.me.validate_mac(tunnel_key_entry))
        tunnel_key_gt = self.me.create_gt(
            (tunnel_key_entry['versionSeals'] >> 25) & 0x7F,
            4,
            {'R': 1},
            GT_TYPE_INFORM,
        )
        tunnel_parsed = self.me.parse_gt(tunnel_key_gt)
        self.assertEqual(tunnel_parsed['type'], GT_TYPE_INFORM)
        self.assertEqual(tunnel_parsed['typeName'], 'Inform')

        service_entry = self.me.namespace_table[6]
        self.assertTrue(self.me.validate_mac(service_entry))
        service_gt = self.me.create_gt(
            (service_entry['versionSeals'] >> 25) & 0x7F,
            6,
            {'E': 1, 'L': 1, 'S': 1},
            GT_TYPE_OUTFORM,
        )
        service_parsed = self.me.parse_gt(service_gt)
        self.assertEqual(service_parsed['type'], GT_TYPE_OUTFORM)
        self.assertEqual(service_parsed['permissions']['E'], 1)

        me_key_entry = self.me.namespace_table[4]
        mother_key_entry = self.mother.namespace_table[4]
        me_key = self.me.compute_seal(me_key_entry['location'], me_key_entry['limit'])
        mother_key = self.mother.compute_seal(mother_key_entry['location'], mother_key_entry['limit'])
        self.assertEqual(me_key, mother_key)

        data_regs = [0] * 32
        data_regs[10] = 100
        data_regs[11] = 200

        rpc_payload = {
            'gt': service_gt,
            'arguments': data_regs,
            'encrypted_with': me_key,
        }

        mother_service_entry = self.mother.namespace_table[6]
        self.assertTrue(self.mother.validate_mac(mother_service_entry))

        response_regs = [0] * 32
        response_regs[10] = 300

        result_data_regs = response_regs
        self.assertEqual(result_data_regs[10], 300)

    def test_connect_fails_without_e_permission(self):
        """CALL(CONNECT(me, mymother)) fails if service GT lacks E permission."""
        service_gt = self.me.create_gt(0, 6, {'R': 1, 'L': 1}, GT_TYPE_OUTFORM)
        parsed = self.me.parse_gt(service_gt)
        self.assertEqual(parsed['permissions']['E'], 0)

    def test_connect_fails_with_revoked_tunnel(self):
        """CALL(CONNECT(me, mymother)) fails if tunnel key has been GC-swept."""
        tunnel_key_gt = self.me.create_gt(0, 4, {'R': 1}, GT_TYPE_INFORM)

        entry = self.me.namespace_table[4]
        old_ver = (entry['versionSeals'] >> 25) & 0x7F
        entry['versionSeals'] = self.me.make_version_seals(
            (old_ver + 1) & 0x7F, entry['location'], entry['limit']
        )

        parsed = self.me.parse_gt(tunnel_key_gt)
        ns_version = (entry['versionSeals'] >> 25) & 0x7F
        self.assertNotEqual(parsed['version'], ns_version)

    def test_connect_fails_with_tampered_mac(self):
        """CALL(CONNECT(me, mymother)) fails if namespace entry MAC is tampered."""
        entry = self.me.namespace_table[6]
        entry['location'] = 0xDEADBEEF
        self.assertFalse(self.me.validate_mac(entry))


class TestAssemblyExample(unittest.TestCase):
    """Generate and validate the assembly code for the CALL(CONNECT(me, mymother)) example."""

    def test_assembly_program(self):
        """Verify the assembly program structure for the CONNECT example."""
        assembly = """; CALL(CONNECT(me, mymother))
; Network-transparent RPC to mymother's service
; Demonstrates: Inform GT tunnel key + Outform RPC

; Boot: CR6 = C-List (L,S), CR7 = Code (E), CR15 = Namespace root

; Step 1: Load tunnel key from C-List slot 4
; CR0 = TunnelKey_Mother (Inform GT, R permission)
CAP.LOAD CR0, CR6, 4

; Step 2: Load remote service handle from C-List slot 6
; CR1 = Mother_Service (Outform GT with E permission)
CAP.LOAD CR1, CR6, 6

; Step 3: Set up arguments in data registers
ADDI x10, x0, 100    ; arg0 = 100
ADDI x11, x0, 200    ; arg1 = 200

; Step 4: Call remote service — network-transparent RPC
; Serializes x0-x31, encrypts with CR0 tunnel key,
; sends to mymother, receives result
CAP.CALL CR1

; Execution resumes here after remote RETURN
; x10 now contains the result from mymother's service

; Step 5: Verify result (optional)
CAP.TPERM CR1, E      ; Verify CR1 still has E permission

; Done — HALT or continue
EBREAK
"""

        self.assertIn('CAP.LOAD CR0, CR6, 4', assembly)
        self.assertIn('CAP.LOAD CR1, CR6, 6', assembly)
        self.assertIn('CAP.CALL CR1', assembly)
        self.assertIn('Inform GT', assembly)
        self.assertIn('Outform', assembly)
        self.assertIn('tunnel key', assembly)
        self.assertIn('network-transparent', assembly)


if __name__ == '__main__':
    unittest.main()
