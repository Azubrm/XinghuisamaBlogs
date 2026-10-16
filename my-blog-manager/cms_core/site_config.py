"""Parse static TypeScript config without evaluating code; retain value offsets."""

import json
import math
import os
import re
import stat
import tempfile


class ConfigSyntaxError(ValueError):
    pass


_IDENTIFIER = re.compile(r"(?:[^\W\d]|[$_])[\w$]*", re.UNICODE)
_NUMBER = re.compile(r"[+-]?(?:0[xX][\da-fA-F]+|0[bB][01]+|0[oO][0-7]+|(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)")


class _Reader:
    def __init__(self, source):
        self.source = source
        self.pos = 0

    def error(self, message):
        line = self.source.count("\n", 0, self.pos) + 1
        raise ConfigSyntaxError(f"{message} (line {line})")

    def skip(self):
        while self.pos < len(self.source):
            if self.source[self.pos].isspace() or self.source[self.pos] == "\ufeff":
                self.pos += 1
            elif self.source.startswith("//", self.pos):
                end = self.source.find("\n", self.pos + 2)
                self.pos = len(self.source) if end < 0 else end + 1
            elif self.source.startswith("/*", self.pos):
                end = self.source.find("*/", self.pos + 2)
                if end < 0:
                    self.error("Unterminated comment")
                self.pos = end + 2
            else:
                return

    def take(self, char):
        self.skip()
        if self.pos >= len(self.source) or self.source[self.pos] != char:
            self.error(f"Expected {char!r}")
        self.pos += 1

    def identifier(self):
        self.skip()
        match = _IDENTIFIER.match(self.source, self.pos)
        if not match:
            self.error("Expected a property name")
        self.pos = match.end()
        return match.group()

    def string(self):
        quote = self.source[self.pos]
        self.pos += 1
        result = []
        escapes = {"b": "\b", "f": "\f", "n": "\n", "r": "\r", "t": "\t", "v": "\v", "0": "\0"}
        while self.pos < len(self.source):
            char = self.source[self.pos]
            self.pos += 1
            if char == quote:
                return "".join(result).encode("utf-16-le", "surrogatepass").decode("utf-16-le", "surrogatepass")
            if quote == "`" and char == "$" and self.source.startswith("{", self.pos):
                self.error("Template interpolation is not a static configuration value")
            if char in "\r\n" and quote != "`":
                self.error("Unescaped newline in string")
            if char == "\r":
                if self.source.startswith("\n", self.pos):
                    self.pos += 1
                result.append("\n")
                continue
            if char != "\\":
                result.append(char)
                continue
            if self.pos >= len(self.source):
                self.error("Unterminated string escape")
            escaped = self.source[self.pos]
            self.pos += 1
            if escaped in "\r\n":
                if escaped == "\r" and self.source.startswith("\n", self.pos):
                    self.pos += 1
            elif escaped in "xu":
                if escaped == "u" and self.source.startswith("{", self.pos):
                    end = self.source.find("}", self.pos + 1)
                    digits = self.source[self.pos + 1:end] if end >= 0 else ""
                    if not re.fullmatch(r"[\da-fA-F]{1,6}", digits) or int(digits, 16) > 0x10FFFF:
                        self.error("Invalid Unicode escape")
                    self.pos = end + 1
                else:
                    length = 2 if escaped == "x" else 4
                    digits = self.source[self.pos:self.pos + length]
                    if len(digits) != length or not re.fullmatch(r"[\da-fA-F]+", digits):
                        self.error("Invalid character escape")
                    self.pos += length
                result.append(chr(int(digits, 16)))
            elif escaped.isdigit() and (escaped != "0" or self.source[self.pos:self.pos + 1].isdigit()):
                self.error("Legacy octal escapes are not supported")
            else:
                result.append(escapes.get(escaped, escaped))
        self.error("Unterminated string")

    def value(self):
        self.skip()
        if self.pos >= len(self.source):
            self.error("Expected a static value")
        char = self.source[self.pos]
        if char in "\"'`":
            return self.string()
        if char == "{":
            return self.object()[0]
        if char == "[":
            self.pos += 1
            values = []
            self.skip()
            while not self.source.startswith("]", self.pos):
                values.append(self.value())
                self.skip()
                if not self.source.startswith(",", self.pos):
                    break
                self.pos += 1
                self.skip()
            self.take("]")
            return values
        number = _NUMBER.match(self.source, self.pos)
        if number:
            self.pos = number.end()
            raw = number.group()
            unsigned = raw.lstrip("+-")
            if unsigned.lower().startswith(("0x", "0b", "0o")):
                return (-1 if raw.startswith("-") else 1) * int(unsigned, 0)
            value = float(raw) if any(c in raw for c in ".eE") else int(raw, 10)
            if isinstance(value, float) and not math.isfinite(value):
                self.error("Non-finite numbers are not supported")
            return value
        name = self.identifier()
        if name in ("true", "false", "null"):
            return {"true": True, "false": False, "null": None}[name]
        self.error("Only static strings, numbers, booleans, null, arrays and objects are supported")

    def object(self):
        self.take("{")
        values, spans = {}, {}
        self.skip()
        while not self.source.startswith("}", self.pos):
            if self.pos >= len(self.source):
                self.error("Unterminated object")
            key = self.string() if self.source[self.pos] in "\"'" else self.identifier()
            if key in values:
                self.error("Duplicate configuration property")
            self.take(":")
            self.skip()
            start = self.pos
            values[key] = self.value()
            spans[key] = (start, self.pos)
            self.skip()
            if not self.source.startswith(",", self.pos):
                break
            self.pos += 1
            self.skip()
        self.take("}")
        return values, spans


def parse_site_config(source):
    """Return root values and value spans, skipping strings/comments in the file."""
    reader = _Reader(source)
    depth = 0
    while reader.pos < len(source):
        reader.skip()
        if reader.pos >= len(source):
            break
        char = source[reader.pos]
        if char in "\"'`":
            reader.string()
        elif char in "{[()]}":
            depth += 1 if char in "{[(" else -1
            reader.pos += 1
        elif _IDENTIFIER.match(source, reader.pos):
            word = reader.identifier()
            if depth == 0 and word in ("const", "let", "var"):
                name = reader.identifier()
                if name == "siteConfig":
                    reader.take("=")
                    result = reader.object()
                    reader.skip()
                    assertion = re.match(r"as\s+const\b", source[reader.pos:])
                    if assertion:
                        reader.pos += assertion.end()
                        reader.skip()
                    if reader.pos < len(source) and source[reader.pos] != ";":
                        reader.error("siteConfig must be a static object literal")
                    return result
        else:
            reader.pos += 1
    raise ConfigSyntaxError("Could not find a static siteConfig declaration")


def replace_config_fields(source, updates, allowed_keys):
    """Change only existing allowed root properties; preserve all other source."""
    current, spans = parse_site_config(source)
    replacements = []
    for key, value in updates.items():
        if key not in allowed_keys or key not in spans:
            continue
        encoded = json.dumps(value, ensure_ascii=False, allow_nan=False, indent=2)
        # Keep unchanged nested objects and their inline comments.
        if json.dumps(current[key], sort_keys=True, ensure_ascii=False) == json.dumps(value, sort_keys=True, ensure_ascii=False):
            continue
        start, end = spans[key]
        line = source[source.rfind("\n", 0, start) + 1:start]
        indent = re.match(r"[ \t]*", line).group()
        replacements.append((start, end, encoded.replace("\n", "\n" + indent)))
    for start, end, replacement in sorted(replacements, reverse=True):
        source = source[:start] + replacement + source[end:]
    parse_site_config(source)
    return source


def atomic_write_config(path, source):
    """Replace a validated config only after its complete UTF-8 write succeeds."""
    parse_site_config(source)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", newline="", dir=os.path.dirname(os.path.abspath(path)), prefix=".siteConfig-", suffix=".tmp", delete=False) as output:
            temporary = output.name
            output.write(source)
            output.flush()
            os.fsync(output.fileno())
        os.chmod(temporary, stat.S_IMODE(os.stat(path).st_mode))
        os.replace(temporary, path)
        temporary = None
    finally:
        if temporary and os.path.exists(temporary):
            os.unlink(temporary)
