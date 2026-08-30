"""Loader for the canonical per-target Church Machine contracts.

The JSON file is the authority.  Python consumers import this module instead
of copying layout, boot-slot, memory-profile, permission, or trace constants.
"""

from __future__ import annotations

import json
from pathlib import Path

_PATH = Path(__file__).with_name("architecture_contracts.json")
with _PATH.open("r", encoding="utf-8") as _fh:
    CONTRACTS = json.load(_fh)

ISA = CONTRACTS["isa"]
GT_WORD0 = ISA["gtWord0"]
ABSTRACT_GT_WORD0 = ISA["abstractGtWord0"]
NS_ENTRY = ISA["nsEntry"]
PERMISSIONS = ISA["permissions"]
BOOT = CONTRACTS["boot"]
PROFILES = CONTRACTS["profiles"]
TRACE_UNITS = CONTRACTS["traceUnits"]


def field_width(field: list[int]) -> int:
    return field[1] - field[0] + 1


def field_lsb(field: list[int]) -> int:
    return field[0]


def ns_word1_field_mask(name: str) -> int:
    field = NS_ENTRY["word1"]["fields"][name]
    return ((1 << field_width(field)) - 1) << field_lsb(field)


def ns_integrity_word1_mask() -> int:
    excluded = NS_ENTRY["integrity"]["excludedWord1Fields"]
    excluded_mask = sum(ns_word1_field_mask(name) for name in excluded)
    return ((1 << 32) - 1) & ~excluded_mask


def profile(name: str) -> dict:
    try:
        return PROFILES[name]
    except KeyError as exc:
        raise ValueError(f"unknown architecture profile: {name}") from exc


def logical_permission_mask(names: list[str]) -> int:
    order = PERMISSIONS["logicalOrder"]
    return sum(1 << order.index(name) for name in names)