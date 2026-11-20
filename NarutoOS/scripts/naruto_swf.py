"""Decode the game's lightweight ZWS wrapper before passing assets to FFDec."""
from pathlib import Path


def decode_game_swf(data: bytes) -> bytes:
    if len(data) <= 8 or data[:3] != b'ZWS' or data[3] != 0 or data[4:8] != b'\xff' * 4:
        return data

    header = data[8:19]
    packed = header[::2]
    restored = bytes(
        (packed[index] & 0x0f) | ((packed[index + 1] & 0x0f) << 4)
        for index in range(0, len(packed), 2)
    ) + header[1::2]
    body = bytearray(data[19:])
    for index in range(min(128, len(body))):
        if index & 1:
            body[index] ^= 0xff

    decoded = restored + bytes(body)
    if decoded[:3] != b'ZWS' or decoded[3] == 0:
        raise ValueError('Game SWF wrapper did not decode to a ZWS file')
    return decoded


def decode_file(source: Path, destination: Path) -> bytes:
    original = source.read_bytes()
    decoded = decode_game_swf(original)
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(decoded)
    return original
