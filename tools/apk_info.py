"""Report what an APK actually declares and who signed it.

Run in CI on every build, and useful locally when a phone refuses an install:

    python tools/apk_info.py path/to/app-debug.apk

Two things it answers, both of which have already bitten this project:

  * **Which key signed it.** Android refuses to update an installed app when
    the signing certificate changes ("App not installed"). Printing the
    certificate fingerprint every build makes a key change obvious in the log
    instead of on the phone.
  * **Which permissions it asks for.** Trailbound must never ship a location
    permission; this reads the real merged manifest out of the built APK
    rather than trusting the source.

Pure standard library: no JDK, no apksigner, no aapt.
"""

from __future__ import annotations

import hashlib
import struct
import sys
import zipfile

APK_SIG_BLOCK_MAGIC = b"APK Sig Block 42"
SCHEME_V2_ID = 0x7109871A
SCHEME_V3_ID = 0xF05368C0


# --------------------------------------------------------------------------
# Signing certificate
# --------------------------------------------------------------------------

def _eocd_offset(data: bytes) -> int:
    """Offset of the end-of-central-directory record."""
    for i in range(len(data) - 22, max(0, len(data) - 70_000), -1):
        if data[i : i + 4] == b"PK\x05\x06":
            return i
    raise ValueError("not a zip: no end-of-central-directory record")


def _signing_block_pairs(data: bytes) -> dict[int, bytes]:
    """The APK Signing Block's id-value pairs, keyed by scheme id."""
    eocd = _eocd_offset(data)
    central_dir = struct.unpack_from("<I", data, eocd + 16)[0]

    if data[central_dir - 16 : central_dir] != APK_SIG_BLOCK_MAGIC:
        return {}

    size_at_end = struct.unpack_from("<Q", data, central_dir - 24)[0]
    start = central_dir - size_at_end - 8
    body = data[start + 8 : central_dir - 24]

    pairs: dict[int, bytes] = {}
    pos = 0
    while pos + 12 <= len(body):
        length = struct.unpack_from("<Q", body, pos)[0]
        pair_id = struct.unpack_from("<I", body, pos + 8)[0]
        pairs[pair_id] = body[pos + 12 : pos + 8 + length]
        pos += 8 + length
    return pairs


def _length_prefixed(buf: bytes, pos: int) -> tuple[bytes, int]:
    size = struct.unpack_from("<I", buf, pos)[0]
    return buf[pos + 4 : pos + 4 + size], pos + 4 + size


def _certificates(block: bytes):
    """DER certificates from a v2/v3 signing block value."""
    signers, _ = _length_prefixed(block, 0)
    pos = 0
    while pos < len(signers):
        signer, pos = _length_prefixed(signers, pos)
        signed_data, _ = _length_prefixed(signer, 0)
        _digests, after = _length_prefixed(signed_data, 0)
        certs, _ = _length_prefixed(signed_data, after)
        inner = 0
        while inner < len(certs):
            cert, inner = _length_prefixed(certs, inner)
            yield cert


def signing_fingerprints(path: str) -> dict[str, list[str]]:
    data = open(path, "rb").read()
    pairs = _signing_block_pairs(data)

    found: dict[str, list[str]] = {}
    for label, scheme in (("v2", SCHEME_V2_ID), ("v3", SCHEME_V3_ID)):
        if scheme not in pairs:
            continue
        found[label] = [
            hashlib.sha256(cert).hexdigest() for cert in _certificates(pairs[scheme])
        ]
    return found


# --------------------------------------------------------------------------
# Manifest permissions
# --------------------------------------------------------------------------

def manifest_strings(path: str) -> list[str]:
    """Every string in the binary manifest's string pool."""
    with zipfile.ZipFile(path) as zf:
        manifest = zf.read("AndroidManifest.xml")

    if struct.unpack_from("<H", manifest, 0)[0] != 0x0003:
        raise ValueError("AndroidManifest.xml is not binary AXML")

    pool = 8
    if struct.unpack_from("<H", manifest, pool)[0] != 0x0001:
        raise ValueError("expected a string pool chunk")

    count, _styles, flags, strings_start, _ = struct.unpack_from("<IIIII", manifest, pool + 8)
    utf8 = bool(flags & (1 << 8))
    offsets = struct.unpack_from(f"<{count}I", manifest, pool + 28)
    base = pool + strings_start

    out: list[str] = []
    for off in offsets:
        pos = base + off
        if utf8:
            def read_len(at: int) -> tuple[int, int]:
                value = manifest[at]
                if value & 0x80:
                    return ((value & 0x7F) << 8) | manifest[at + 1], at + 2
                return value, at + 1

            _chars, pos = read_len(pos)
            nbytes, pos = read_len(pos)
            out.append(manifest[pos : pos + nbytes].decode("utf-8", "replace"))
        else:
            nchars = struct.unpack_from("<H", manifest, pos)[0]
            if nchars & 0x8000:
                nchars = ((nchars & 0x7FFF) << 16) | struct.unpack_from("<H", manifest, pos + 2)[0]
                pos += 2
            pos += 2
            out.append(manifest[pos : pos + nchars * 2].decode("utf-16-le", "replace"))
    return out


def main() -> int:
    if len(sys.argv) != 2:
        print(__doc__)
        return 2

    path = sys.argv[1]
    print(f"APK: {path}")

    fingerprints = signing_fingerprints(path)
    if not fingerprints:
        print("  signing: NONE FOUND (unsigned, or v1-only)")
    for scheme, prints in fingerprints.items():
        for fp in prints:
            print(f"  signing {scheme}: SHA-256 {fp}")
    print("  (a change here means Android will refuse to update an installed app)")

    perms = sorted({s for s in manifest_strings(path) if s.startswith("android.permission")})
    print("  permissions:")
    for perm in perms:
        print(f"    - {perm}")

    location = [p for p in perms if "LOCATION" in p.upper()]
    if location:
        print(f"::error::location permission present: {location}")
        return 1
    print("  no location permission: OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
