"""Import local relative modules without replacing or importing the live server."""
import importlib
import sys
import types
from pathlib import Path

NAME = "_isolated_candidate_stage"
if NAME not in sys.modules:
    package = types.ModuleType(NAME)
    package.__path__ = [str(Path(__file__).parent)]
    sys.modules[NAME] = package


def module(name):
    return importlib.import_module(f"{NAME}.{name}")
