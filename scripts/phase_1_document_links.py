"""Extract navigational links without treating code examples as dependencies."""
import re

LINK = re.compile(
    r'(?P<md>!?\[[^\]\n]*\]\()(?P<a><[^>]+>|[^\s)]+)'
    r'|(?P<ref>^[ \t]*\[[^\]\n]+\]:[ \t]*)(?P<b><[^>]+>|[^\s]+)'
    r'|(?P<html>\b(?:href|src)=["\'])(?P<c>[^"\']+)',
    re.MULTILINE | re.IGNORECASE,
)


def links(text):
    masked = re.sub(r"(?ms)^```.*?^```[^\n]*", lambda m: " " * len(m[0]), text)
    masked = re.sub(r"`[^`\n]*`", lambda m: " " * len(m[0]), masked)
    for match in LINK.finditer(masked):
        group = next(g for g in ("a", "b", "c") if match[g] is not None)
        yield match.span(group), match[group]
