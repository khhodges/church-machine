"""End-to-end integration test for the Hello-Mum flow on a real boot image.

Also covers the automatic Hello-Mum trigger that fires when a new board
registers via /api/device/register (test_auto_hello_mum_on_board_register).

Verifies the full causal chain that the unit tests cannot cover in isolation:

    Board boot image
        → ChurchSimulator (real AbstractionRegistry + SystemAbstractions)
        → boot state machine (_bootStep loop)
        → Navana.Init (NS[5].Init)
        → Keystone.Init wires Tunnel E-GT into c-list slot 0
        → Keystone.Connect(identity_word) issues MumGT into c-list slot 1
        → Keystone.Hello() dispatches through Tunnel.Call
        → Tunnel.Call POSTs to the live Flask bridge at /mum/hello   ← bridge call
        → bridge returns { ok, result: 0x48454C4C, tunnel: 'online' }
        → GREET_RESPONSE 0x48454C4C ('HELL') propagated back to Keystone.Hello()

The harness (sim_hello_mum_flow.js) rebinds Tunnel.Call at runtime to make a
real HTTP POST to the bridge server started here in the test process, rather
than using the in-process constant from system_abstractions.js.  This makes the
integration observable:

  - bridgeHit == True  → the HTTP call actually happened
  - bridgeStatus == 200 → the server accepted the request
  - bridgeResult == GREET_RESPONSE → the correct value came back through the wire
  - greetResult == GREET_RESPONSE  → Keystone.Hello() returned that value

Failure here catches wiring problems that pass the isolated unit tests but break
when all layers are combined on a real boot image with a live server in the loop.

Relevant files:
  - tests/boot/sim_hello_mum_flow.js  (JS harness / bridge integration)
  - simulator/system_abstractions.js  (_initKeystone, ~line 2665)
  - server/app.py                     (/mum/hello endpoint, ~line 4375)
"""
import base64
import json
import os
import socket
import subprocess
import sys
import threading
import urllib.request

import pytest

ROOT      = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
LUMPS_DIR = os.path.join(ROOT, "server", "lumps")
sys.path.insert(0, ROOT)

from server.boot_image import generate_boot_image  # noqa: E402

_HARNESS = os.path.join(os.path.dirname(__file__), "sim_hello_mum_flow.js")

GREET_RESPONSE = 0x48454C4C  # 'HELL' in big-endian ASCII

_BOOT_CFG = {
    "step1": {
        "totalNamespaceWords": 16384,
        "namespaceLumpWords":     64,
        "threadLumpWords":       256,
    },
}

# Protocol-tag-1 identity word that Keystone.Connect will accept.
# Mirrors the default used inside the harness so the two are always in sync.
_VALID_IDENTITY = (0x1 << 28) | 0x0CEEFFE


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _free_port():
    """Return an unused TCP port on localhost."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(('127.0.0.1', 0))
        return s.getsockname()[1]


def _start_flask_thread(port):
    """Start the Flask app in a background thread on *port*.

    Uses ThreadedWSGIServer so the server can handle concurrent connections.
    This is required because the auto Hello-Mum trigger spawns a Node.js
    harness (sim_hello_mum_flow.js) that makes a real curl POST to
    /mum/hello on this same server while device_register is still executing.
    A single-threaded server would deadlock on that loopback request.

    Returns the thread (already started).  The server is ready once it begins
    accepting connections, which the caller is expected to verify with a brief
    retry loop before running the harness.
    """
    from server.app import app  # noqa: E402 — deferred to avoid side-effects

    from werkzeug.serving import ThreadedWSGIServer

    srv = ThreadedWSGIServer('127.0.0.1', port, app)

    t = threading.Thread(target=srv.serve_forever, daemon=True)
    t.start()
    return t, srv


def _wait_for_port(port, timeout=5.0):
    """Block until localhost:port accepts a TCP connection or timeout expires."""
    import time
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            with socket.create_connection(('127.0.0.1', port), timeout=0.1):
                return True
        except OSError:
            time.sleep(0.05)
    return False


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(scope="module")
def boot_image_b64():
    """Generate a canonical boot image and return its base64 encoding."""
    img_bytes = generate_boot_image(_BOOT_CFG, LUMPS_DIR)
    return base64.b64encode(img_bytes).decode("ascii")


@pytest.fixture(scope="module")
def bridge_server():
    """Start the Flask server on a random port and yield the bridge URL.

    Sets app.config['SELF_BASE_URL'] to the test server's origin before
    starting so that _run_hello_mum_flow() sends its Tunnel.Call loopback
    to this ephemeral port (not the default 5000).

    The server thread is daemonised so it is cleaned up automatically when the
    test process exits.  We call srv.shutdown() explicitly in the finaliser so
    that the port is released before the next test module starts.
    """
    from server.app import app as _flask_app
    port = _free_port()
    _flask_app.config['SELF_BASE_URL'] = f"http://127.0.0.1:{port}"
    _t, srv = _start_flask_thread(port)
    ready = _wait_for_port(port)
    assert ready, f"Flask bridge server did not start on port {port} within 5 s"
    url = f"http://127.0.0.1:{port}"
    yield url
    srv.shutdown()


@pytest.fixture(scope="module")
def harness_result(boot_image_b64, bridge_server):
    """Run sim_hello_mum_flow.js with a real boot image and a live bridge URL.

    This is the primary integration fixture: the JS harness boots the simulator,
    runs the full Init→Connect→Hello chain, and makes a real HTTP POST to the
    Flask bridge server for Tunnel.Call.

    Returns the parsed JSON dict from the harness stdout.  The fixture fails
    immediately if the harness crashes or produces unparseable output.
    """
    envelope = json.dumps({
        "imageBase64":  boot_image_b64,
        "config":       _BOOT_CFG,
        "identityWord": _VALID_IDENTITY,
        "bridgeUrl":    bridge_server,
    }).encode("utf-8")

    proc = subprocess.run(
        ["node", _HARNESS],
        input=envelope,
        capture_output=True,
        timeout=30,
        cwd=ROOT,
    )
    stdout = proc.stdout.decode("utf-8", errors="replace").strip()
    stderr = proc.stderr.decode("utf-8", errors="replace").strip()

    assert proc.returncode == 0, (
        f"sim_hello_mum_flow.js exited {proc.returncode}.\n"
        f"stdout: {stdout}\nstderr: {stderr}"
    )

    try:
        return json.loads(stdout)
    except json.JSONDecodeError as exc:
        pytest.fail(
            f"sim_hello_mum_flow.js produced non-JSON output: {exc}\n"
            f"stdout: {stdout}"
        )


# ---------------------------------------------------------------------------
# Boot-side assertions (simulator)
# ---------------------------------------------------------------------------

def test_harness_boot_image_loaded(harness_result):
    """Boot image must load successfully into the live simulator."""
    assert harness_result.get("loaded") is True, (
        "loadBootImage() returned False — boot image was not accepted by the simulator.\n"
        f"faultCount={harness_result.get('faultCount')}"
    )


def test_harness_boot_completes(harness_result):
    """Boot state machine must run to completion before Hello-Mum can proceed."""
    assert harness_result.get("bootComplete") is True, (
        "Boot state machine did not complete.\n"
        f"faultCount={harness_result.get('faultCount')}, "
        f"message={harness_result.get('message')!r}"
    )


def test_harness_navana_init_succeeds(harness_result):
    """Navana.Init (NS[5].Init) must succeed, triggering Keystone.Init."""
    assert harness_result.get("navanaOk") is True, (
        "Navana.Init dispatch failed — Keystone cannot have been wired.\n"
        f"message={harness_result.get('message')!r}"
    )


def test_harness_keystone_connect_succeeds(harness_result):
    """Keystone.Connect(identity_word) must accept the identity and issue a MumGT."""
    assert harness_result.get("connectOk") is True, (
        "Keystone.Connect() did not return ok=1 — MumGT was not placed in c-list slot 1.\n"
        f"connectResult={harness_result.get('connectResult')!r}, "
        f"message={harness_result.get('message')!r}"
    )


def test_harness_tunnel_slot0_is_wired(harness_result):
    """After Navana.Init, Keystone c-list slot 0 must hold the Tunnel E-GT (NS[31])."""
    slot0    = harness_result.get("slot0", 0)
    tunnelNS = harness_result.get("tunnelNS", -1)
    eBitSet  = harness_result.get("eBitSet", False)

    assert slot0 != 0, (
        "Keystone c-list slot 0 is NULL GT after Navana.Init — Tunnel not wired."
    )
    assert tunnelNS == 31, (
        f"c-list slot 0 NS index = {tunnelNS}, expected 31 (Tunnel).\n"
        f"slot0=0x{slot0:08X}"
    )
    assert eBitSet is True, (
        f"Tunnel GT in c-list slot 0 has E-bit clear: 0x{slot0:08X}"
    )


# ---------------------------------------------------------------------------
# Bridge-side assertions (HTTP integration)
# ---------------------------------------------------------------------------

def test_bridge_was_called(harness_result):
    """Tunnel.Call must have made a real HTTP POST to /mum/hello.

    This is the key causal-integration assertion: it fails if Tunnel.Call
    returns the response constant directly without going through the bridge,
    which would mean wiring breakage between the simulator and the IDE server
    remains invisible to the test suite.
    """
    assert harness_result.get("bridgeHit") is True, (
        "bridgeHit is False — Tunnel.Call did not POST to /mum/hello.\n"
        "Either the bridge URL was not wired up or Tunnel.Call short-circuited.\n"
        f"message={harness_result.get('message')!r}"
    )


def test_bridge_returned_http_200(harness_result):
    """The /mum/hello bridge endpoint must have responded with HTTP 200."""
    status = harness_result.get("bridgeStatus")
    assert status == 200, (
        f"/mum/hello returned HTTP {status}, expected 200.\n"
        f"message={harness_result.get('message')!r}"
    )


def test_bridge_returned_greet_response(harness_result):
    """The /mum/hello response body must carry result=0x48454C4C ('HELL')."""
    br = harness_result.get("bridgeResult")
    assert br == GREET_RESPONSE, (
        f"/mum/hello bridgeResult=0x{(br or 0):08X}, "
        f"expected 0x{GREET_RESPONSE:08X} ('HELL').\n"
        f"message={harness_result.get('message')!r}"
    )


# ---------------------------------------------------------------------------
# Primary end-to-end assertion
# ---------------------------------------------------------------------------

def test_hello_mum_greet_response_propagated_through_bridge(harness_result):
    """Keystone.Hello() must return the GREET_RESPONSE received from the bridge.

    This is the primary end-to-end assertion for the Hello-Mum flow.  It
    confirms that:
      1. The simulator's Hello() call triggered a real HTTP POST to /mum/hello.
      2. The response value from the server (0x48454C4C) was propagated back
         through Tunnel.Call into Keystone.Hello(), which returned it as its
         own result.

    A failure here catches any wiring regression between the JS abstraction
    layer and the Flask IDE bridge that the isolated unit tests cannot see.
    """
    assert harness_result.get("bridgeHit") is True, (
        "Bridge was not hit — causal chain is broken before the assertion."
    )
    greet  = harness_result.get("greetResult", 0)
    bridge = harness_result.get("bridgeResult", -1)
    assert greet == GREET_RESPONSE, (
        f"Keystone.Hello() returned 0x{greet:08X}, "
        f"expected 0x{GREET_RESPONSE:08X} ('HELL').\n"
        f"bridgeResult=0x{(bridge or 0):08X}, "
        f"message={harness_result.get('message')!r}"
    )
    assert greet == bridge, (
        f"Keystone.Hello() result 0x{greet:08X} != bridge response 0x{(bridge or 0):08X} — "
        "the value was not propagated correctly from /mum/hello back through Tunnel.Call."
    )


# ---------------------------------------------------------------------------
# Automatic Hello-Mum trigger on board registration
# ---------------------------------------------------------------------------

def _http_post_json(url, payload):
    """POST *payload* (dict) as JSON to *url*; return parsed response dict."""
    body = json.dumps(payload).encode("utf-8")
    req  = urllib.request.Request(
        url, data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _http_get_json(url):
    """GET *url* and return parsed JSON dict."""
    with urllib.request.urlopen(url, timeout=10) as resp:
        return json.loads(resp.read().decode("utf-8"))


@pytest.fixture(scope="module")
def registered_device(bridge_server):
    """Register a synthetic board and return the /api/device/register response.

    Uses a unique UID so it does not collide with any persistent device rows
    from earlier test runs.
    """
    payload = {
        "device_uid":  "TESTBOOT0000CAFE",
        "board_type":  0x03,
        "fw_major":    1,
        "fw_minor":    0,
        "build_sig":   "AABBCCDD",
        "profile":     "Full",
        "boot_reason": 0,
        "last_fault":  0,
        "fault_nia":   0,
        "bridge_host": "127.0.0.1",
        "bridge_port": 9999,
        "bridge_scheme": "http",
    }
    return _http_post_json(f"{bridge_server}/api/device/register", payload)


def test_auto_hello_mum_register_response_ok(registered_device):
    """The /api/device/register response must report ok=True."""
    assert registered_device.get("ok") is True, (
        f"Device registration failed: {registered_device}"
    )


def test_auto_hello_mum_trigger_fires_on_register(registered_device):
    """After a board registers, the Hello-Mum flow must run automatically.

    Confirms the automatic Navana.Init → Keystone.Connect → Keystone.Hello
    sequence fires during registration: the response must include
    tunnel_status='online', proving the GREET_RESPONSE was received.
    """
    ts = registered_device.get("tunnel_status")
    assert ts == "online", (
        f"tunnel_status={ts!r} after /api/device/register — "
        "expected 'online', meaning the auto Hello-Mum flow did not fire or "
        "the Mum identity key was not initialised correctly.\n"
        f"full response: {registered_device}"
    )


def test_auto_hello_mum_offline_when_handshake_fails(bridge_server):
    """When the Mum.Greet() handshake fails, tunnel_status must be 'offline'.

    Patches server.app._mum_do_greet to return an error response, simulating
    a broken identity key or unreachable tunnel.  Confirms the device registers
    successfully (ok=True) but with tunnel_status='offline' — not 'online'.

    This is the negative-path regression that prevents false positives from
    a shortcut implementation that always sets tunnel_status='online'.
    """
    from unittest.mock import patch
    import server.app as _app_mod

    payload = {
        "device_uid":  "TESTBOOT0000DEAD",
        "board_type":  0x03,
        "fw_major":    1,
        "fw_minor":    0,
        "build_sig":   "DEADBEEF",
        "profile":     "Full",
        "boot_reason": 0,
        "last_fault":  0,
        "fault_nia":   0,
        "bridge_host": "127.0.0.1",
        "bridge_port": 9998,
        "bridge_scheme": "http",
    }
    broken_response = {
        "ok": False, "result": 0, "result_hex": "0x00000000",
        "message": "simulated key failure", "tunnel": "offline",
    }
    with patch.object(_app_mod, '_mum_do_greet', return_value=broken_response):
        resp = _http_post_json(f"{bridge_server}/api/device/register", payload)

    assert resp.get("ok") is True, (
        f"Device registration itself should succeed even when handshake fails: {resp}"
    )
    ts = resp.get("tunnel_status")
    assert ts == "offline", (
        f"tunnel_status={ts!r} — expected 'offline' when handshake returns ok=False.\n"
        "A shortcut that always sets tunnel_status='online' would fail this check."
    )


def test_auto_hello_mum_visible_in_device_list(bridge_server, registered_device):
    """The device list must expose tunnel_status='online' for the registered board.

    This verifies the badge data is available to the Devices view frontend.
    """
    data = _http_get_json(f"{bridge_server}/api/device/list")
    assert data.get("ok") is True, f"/api/device/list returned ok=False: {data}"

    uid = "TESTBOOT0000CAFE"
    matching = [d for d in data.get("devices", []) if d.get("device_uid") == uid]
    assert matching, (
        f"Registered device UID={uid!r} not found in /api/device/list.\n"
        f"devices: {[d.get('device_uid') for d in data.get('devices', [])]}"
    )
    ts = matching[0].get("tunnel_status")
    assert ts == "online", (
        f"device_uid={uid!r}: tunnel_status={ts!r} in /api/device/list — "
        "expected 'online'.  The Devices view would not show the Tunnel online badge."
    )


# ---------------------------------------------------------------------------
# Reconnect: Hello-Mum re-verification on offline → online transition
# ---------------------------------------------------------------------------

_RECONNECT_UID = "TESTBOOT0000RECO"


def _force_device_offline(uid):
    """Mark a device as offline in the DB directly via an app context.

    Sets status='offline' and last_seen=0 so the heartbeat handler treats the
    next heartbeat as an offline → online transition.
    """
    from server.app import app as _flask_app, db as _db, Device as _Device

    with _flask_app.app_context():
        dev = _Device.query.filter_by(device_uid=uid).first()
        if dev:
            dev.status = "offline"
            dev.last_seen = 0
            _db.session.commit()


def test_heartbeat_reruns_hello_mum_on_reconnect(bridge_server):
    """A heartbeat from a previously offline board must re-run the Hello-Mum flow.

    Simulates the offline → online reconnect scenario:
      1. Register a board so it has a known tunnel_status from the initial flow.
      2. Force the device to 'offline' in the DB to simulate it going dark.
      3. Send /api/device/heartbeat.
      4. Confirm the response includes tunnel_status (re-verified, not stale).
      5. Confirm /api/device/list reflects the refreshed tunnel_status.

    This is the regression guard for the re-verify-on-reconnect feature: without
    it, the badge would stay stale at whatever tunnel_status was set at
    registration, even if the tunnel had broken during the offline period.
    """
    uid = _RECONNECT_UID

    register_payload = {
        "device_uid":  uid,
        "board_type":  0x03,
        "fw_major":    1,
        "fw_minor":    0,
        "build_sig":   "CCDDEEFF",
        "profile":     "Full",
        "boot_reason": 0,
        "last_fault":  0,
        "fault_nia":   0,
        "bridge_host": "127.0.0.1",
        "bridge_port": 9997,
        "bridge_scheme": "http",
    }
    reg = _http_post_json(f"{bridge_server}/api/device/register", register_payload)
    assert reg.get("ok") is True, f"Initial registration failed: {reg}"
    initial_ts = reg.get("tunnel_status")
    assert initial_ts in ("online", "offline"), (
        f"Unexpected initial tunnel_status={initial_ts!r} after registration."
    )

    _force_device_offline(uid)

    hb = _http_post_json(
        f"{bridge_server}/api/device/heartbeat",
        {"device_uid": uid},
    )
    assert hb.get("ok") is True, f"/api/device/heartbeat returned ok=False: {hb}"
    hb_ts = hb.get("tunnel_status")
    assert hb_ts is not None, (
        "Heartbeat response missing 'tunnel_status' field — re-verification did not run "
        "or the endpoint does not return tunnel_status after a reconnect."
    )
    assert hb_ts in ("online", "offline"), (
        f"tunnel_status={hb_ts!r} from heartbeat is not a valid value."
    )

    list_data = _http_get_json(f"{bridge_server}/api/device/list")
    assert list_data.get("ok") is True, f"/api/device/list returned ok=False: {list_data}"
    matching = [d for d in list_data.get("devices", []) if d.get("device_uid") == uid]
    assert matching, (
        f"Reconnected device UID={uid!r} not found in /api/device/list.\n"
        f"devices: {[d.get('device_uid') for d in list_data.get('devices', [])]}"
    )
    list_ts = matching[0].get("tunnel_status")
    assert list_ts == hb_ts, (
        f"device_uid={uid!r}: tunnel_status in /api/device/list ({list_ts!r}) does not "
        f"match the heartbeat response ({hb_ts!r}) — DB was not updated on reconnect."
    )


def test_heartbeat_does_not_rerun_hello_mum_when_already_online(bridge_server):
    """A heartbeat from an already-online board must NOT re-run Hello-Mum.

    Confirms the reconnect guard only fires on offline → online transitions.
    A board that is already online should have its heartbeat processed cheaply,
    without incurring the cost of another Hello-Mum round-trip.

    We verify this indirectly: the heartbeat response must still include
    tunnel_status (so the client can read it), but the value must remain
    whatever was set during the earlier reconnect test (not reset by a new run).
    """
    uid = _RECONNECT_UID

    hb1 = _http_post_json(
        f"{bridge_server}/api/device/heartbeat",
        {"device_uid": uid},
    )
    assert hb1.get("ok") is True, f"First heartbeat failed: {hb1}"
    ts1 = hb1.get("tunnel_status")
    assert ts1 is not None, "Heartbeat response missing 'tunnel_status'."

    hb2 = _http_post_json(
        f"{bridge_server}/api/device/heartbeat",
        {"device_uid": uid},
    )
    assert hb2.get("ok") is True, f"Second heartbeat failed: {hb2}"
    ts2 = hb2.get("tunnel_status")
    assert ts2 == ts1, (
        f"tunnel_status changed between consecutive heartbeats ({ts1!r} → {ts2!r}) "
        "even though the device was already online — Hello-Mum ran unnecessarily."
    )
