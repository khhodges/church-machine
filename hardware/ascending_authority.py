"""Explicit stored-descriptor → internal-cache boundary; never reseals bytes."""
from amaranth import Cat, Const


def cached_authority(raw):
    """Stored limit17/version9/reserved4/G/F → cache limit21/version9/G/F."""
    return Cat(raw[:17], Const(0, 4), raw[17:26], raw[30:32])
