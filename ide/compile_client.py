"""Compile client — the boundary between the existing compiler and the store.

`POST /api/compile` already works and returns a word array. What it does not do
is give the result an identity. This module closes that gap: compile, then hash,
then seal, then (optionally) bind.

The compiler is treated as a black box behind an HTTP call. Nothing here knows
how CLOOMC++ parses or how a Lump is packed — only what comes back and what to
do with it. That keeps the new IDE independent of the old server's internals,
so either can be replaced without the other noticing.

Copyright (c) 2024-2026 CLOOMC Technologies LLC. GPL-3.0.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from dataclasses import dataclass, field

from store import Identity, LumpStore, LumpError, pack_source, parse_header

LANGUAGES = ("assembly", "english", "javascript", "haskell", "symbolic", "lambda")

DEFAULT_ENDPOINT = "https://lab.cloomc.org/api/compile"


@dataclass
class CompileResult:
    """What came back, and what became of it.

    `ok` is the compiler's verdict on the source. `hash` is present only if the
    Lump also passed header validation and entered the store — a compile can
    succeed while producing a Lump the store refuses, and that distinction
    should stay visible rather than collapse into one boolean.

    `pending` lists c-list slots holding a null GT: capabilities the source
    declared but which are not yet bound. The compiler does not report these
    and is right not to — a declared capability with a null GT is a valid,
    deployable state, and binding it is load-time work. They are computed
    from the binary instead.
    """
    ok: bool
    language: str = ""
    error: str = ""
    warnings: list[str] = field(default_factory=list)
    words: list[int] = field(default_factory=list)
    hash: str | None = None
    header: dict | None = None
    rejected: str = ""          # store refused an otherwise-valid compile
    pending: list[int] = field(default_factory=list)  # null c-list slots
    source_note: str = ""       # whether the source was embedded, and why not

    @property
    def stored(self) -> bool:
        return self.hash is not None

    def summary(self) -> str:
        if not self.ok:
            return f"compile failed: {self.error}"
        if self.rejected:
            return f"compiled, but rejected: {self.rejected}"
        p = f", {len(self.pending)} capability slot(s) unbound" if self.pending else ""
        return f"{self.header['typ_name']} lump, {len(self.words)}w{p}"


class CompileError(RuntimeError):
    """The request could not be made or the response was unusable.

    Distinct from a failed compile — that is a normal outcome carried in
    CompileResult, not an exception.
    """


class CompileClient:
    def __init__(self, endpoint: str = DEFAULT_ENDPOINT,
                 token: str | None = None, timeout: int = 35):
        self.endpoint = endpoint
        self.token = token
        self.timeout = timeout          # server's own limit is 30s

    def compile(self, source: str, language: str | None = None,
                abstraction_name: str | None = None,
                namespace_hint: dict | None = None) -> dict:
        """Raw call. Returns the server's JSON body unchanged."""
        if not source.strip():
            raise CompileError("source is empty")
        if language and language not in LANGUAGES:
            raise CompileError(
                f"unknown language '{language}' — expected one of "
                + ", ".join(LANGUAGES)
            )

        payload: dict = {"source": source}
        if language:
            payload["language"] = language
        if abstraction_name:
            payload["abstraction_name"] = abstraction_name
        if namespace_hint:
            payload["namespace_hint"] = namespace_hint

        req = urllib.request.Request(
            self.endpoint,
            data=json.dumps(payload).encode(),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        if self.token:
            req.add_header("Authorization", f"Bearer {self.token}")

        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as r:
                return json.loads(r.read())
        except urllib.error.HTTPError as e:
            # 400 and 401 are documented and carry a readable reason.
            body = e.read().decode(errors="replace")[:400]
            if e.code == 401:
                raise CompileError("401 — compile API requires a token") from e
            if e.code == 400:
                raise CompileError(f"400 — bad request: {body}") from e
            raise CompileError(f"HTTP {e.code}: {body}") from e
        except urllib.error.URLError as e:
            raise CompileError(f"cannot reach {self.endpoint}: {e.reason}") from e
        except json.JSONDecodeError as e:
            raise CompileError("compile API returned malformed JSON") from e

    def compile_and_store(self, source: str, store: LumpStore,
                          identity: Identity, language: str | None = None,
                          abstraction_name: str | None = None,
                          namespace_hint: dict | None = None,
                          embed_source: bool = True) -> CompileResult:
        """compile → hash → seal. The Lump acquires an identity here or not
        at all.

        A compile that succeeds but produces a malformed header is *not*
        stored. That is deliberate: the store is the last gate before a Lump
        can be named, and a name must never point at something the hardware
        would reject.
        """
        body = self.compile(source, language, abstraction_name, namespace_hint)

        if not body.get("ok"):
            return CompileResult(
                ok=False,
                language=body.get("language", ""),
                error=body.get("error", "compile failed with no reason given"),
            )

        words = body.get("words") or []
        if not words:
            return CompileResult(ok=False, language=body.get("language", ""),
                                 error="compiler returned no words")

        result = CompileResult(
            ok=True,
            language=body.get("language", ""),
            warnings=list(body.get("warnings") or []),
            words=words,
        )

        # Embed the source in the Lump's freespace before hashing, so source
        # and binary are the same bytes under the same hash and the same seal.
        # They cannot drift, and a Lump fetched by hash from a far node
        # arrives readable as well as runnable.
        if embed_source:
            try:
                words, result.source_note = pack_source(words, source)
                result.words = words
            except LumpError as e:
                result.source_note = f"source not embedded: {e}"

        try:
            h, header = store.put(words, identity)
            result.hash, result.header = h, header
            result.pending = store.pending(h)
        except LumpError as e:
            # The compiler was happy; the header is not valid. Worth surfacing
            # loudly — it means an encoder wrote a field wrongly.
            result.rejected = str(e)

        return result

    def compile_bind(self, source: str, name: str, store: LumpStore,
                     identity: Identity, note: str = "",
                     **kw) -> CompileResult:
        """compile → hash → seal → bind, in one step.

        Binding happens only on a stored Lump, so a name can never come to
        mean something that failed validation.
        """
        r = self.compile_and_store(source, store, identity, **kw)
        if r.stored:
            store.bind(name, r.hash, identity, note=note)
        return r


def decode(words: list[int]) -> dict:
    """Decode a header without storing. For inspecting a compile result
    before deciding whether to keep it."""
    return parse_header(words)
