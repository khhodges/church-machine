"""Explicit frozen candidate inputs; importing this module never builds hardware."""
import hashlib
import json
from pathlib import Path
import struct

ROOT = Path(__file__).resolve().parents[1]
NAME = "new-layout-guarded-relative-nia-v1"
NAME_25 = "new-layout-guarded-relative-nia-25mhz-v1"
IMAGE_SHA256 = "2a16403e94639abac7716ea9cf56a35f5bbc6bf5e3a99e805457bcd1f563a451"


def validate_words(words, guard):
    words = tuple(words)
    if (type(guard) is not int or guard != 23971 or len(words) != 16384
            or any(type(w) is not int or not 0 <= w <= 0xffffffff for w in words)):
        raise ValueError("Production runtime image requires the exact frozen guard and uint32 image")
    if len(words) == 16384 and (
            (words[5] & 0x1fffff) != (((words[0] >> 10) & 8191) * 4 - 1)
            or (words[5] >> 21 & 511) != (guard >> 9 if type(guard) is int else -1)
            or (words[9] >> 21 & 511) != (guard & 511 if type(guard) is int else -1)):
        raise ValueError("Frozen candidate uses an incompatible Namespace authority layout; current RTL requires limit21/version9")
    if hashlib.sha256(struct.pack("<16384I", *words)).hexdigest() != IMAGE_SHA256:
        raise ValueError("Production runtime image differs from the approved candidate")
    return words


def build_inputs(profile=None):
    kwargs = dict(clk_freq=50_000_000, baud=57600, sim_mode=False)
    if profile is None:
        return kwargs, None
    if profile not in (NAME, NAME_25):
        raise ValueError("Unknown Wukong production profile")
    reduced = profile == NAME_25
    path = ROOT / ("hardware/profiles/new_layout_guarded_25mhz.json" if reduced
                   else "hardware/profiles/new_layout_guarded.json")
    config = json.loads(path.read_text())
    required = dict(profile=profile, part="xc7a100tfgg676-2",
                    top="church_wukong_xc7a100t", clockHz=25_000_000 if reduced else 50_000_000,
                    uartBaud=57600, expectedBootGuard=23971, imageSha256=IMAGE_SHA256,
                    imageBytes=65536, dmemWords=16384)
    if any(config.get(k) != v for k, v in required.items()):
        raise ValueError("Frozen production configuration changed")
    if reduced:
        if (config.get("inputClockHz") != 50_000_000 or
                config.get("clockMode") != "mmcm-25mhz" or config.get("clockPeriodNs") != 40):
            raise ValueError("Invalid reduced-clock configuration")
        kwargs.update(clk_freq=25_000_000, clock_mode="mmcm-25mhz")
    raw = (ROOT / config["image"]).read_bytes()
    if len(raw) != 65536 or hashlib.sha256(raw).hexdigest() != IMAGE_SHA256:
        raise ValueError("Frozen production image changed")
    kwargs.update(expected_boot_guard=23971,
                  runtime_image_words=validate_words(struct.unpack("<16384I", raw), 23971))
    return kwargs, dict(profile=profile, imageSha256=IMAGE_SHA256, imageBytes=len(raw),
                        configSha256=hashlib.sha256(path.read_bytes()).hexdigest(),
                        part=config["part"], top=config["top"],
                        clockHz=config["clockHz"], uartBaud=config["uartBaud"],
                        expectedBootGuard=23971)
