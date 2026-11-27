"""Check the actual Intel slice of every Mach-O in the extracted test app."""
import plistlib
import re
import subprocess
import sys
from pathlib import Path

APP = Path(sys.argv[1])
VERSION = sys.argv[2]
# Thin and fat Mach-O, including 64-bit fat headers and both byte orders.
MAGIC = {bytes.fromhex(h) for h in (
    "feedface", "feedfacf", "cafebabe", "cafebabf",
    "cefaedfe", "cffaedfe", "bebafeca", "bfbafeca",
)}


def run(*args):
    return subprocess.check_output(args, text=True).strip()


def require(condition, message):
    if not condition:
        raise SystemExit(message)


def compatible(value):
    numbers = tuple(int(part) for part in value.split("."))
    return (*numbers, 0, 0)[:3] <= (12, 7, 6)


def check_binary(file):
    arches = run("/usr/bin/lipo", "-archs", file).split()
    require("x86_64" in arches, f"{file}: missing Intel slice ({arches})")
    loads = run("/usr/bin/xcrun", "vtool", "-arch", "x86_64", "-show-build", file)
    minima = []
    for cmd in loads.split("Load command "):
        if re.search(r"^\s*cmd LC_BUILD_VERSION$", cmd, re.M):
            require(re.search(r"^\s*platform (?:MACOS|macos|1)$", cmd, re.M), f"{file}: expected macOS")
            minima.extend(re.findall(r"^\s*minos ([\d.]+)$", cmd, re.M))
        elif re.search(r"^\s*cmd LC_VERSION_MIN_MACOSX$", cmd, re.M):
            minima.extend(re.findall(r"^\s*version ([\d.]+)$", cmd, re.M))
    require(len(minima) == 1 and compatible(minima[0]), f"{file}: invalid Intel minimum {minima}")
    run("/usr/bin/codesign", "--verify", "--strict", file)
    print(f"x86_64  macOS {minima[0]:<7} {file.relative_to(APP)}")


info = plistlib.loads((APP / "Contents/Info.plist").read_bytes())
require(info.get("CFBundleShortVersionString") == VERSION and
        info.get("CFBundleExecutable") == "Naruto OS" and
        info.get("CFBundleIdentifier") == "cn.youye.naruto-os" and
        info.get("LSMinimumSystemVersion") == "12.0" and
        info.get("NarutoOSIntelTest") is True, "Wrong Intel test app metadata")
run("/usr/bin/codesign", "--verify", "--deep", "--strict", APP)
binaries = set()
for file in sorted(APP.rglob("*")):
    if file.is_symlink() or not file.is_file():
        continue
    if file.name == "Info.plist":
        plist = plistlib.loads(file.read_bytes())
        minimum = plist.get("LSMinimumSystemVersionByArchitecture", {}).get("x86_64", plist.get("LSMinimumSystemVersion"))
        require(minimum is None or compatible(minimum), f"{file}: Intel requires {minimum}")
    with file.open("rb") as stream:
        if stream.read(4) not in MAGIC:
            continue
    check_binary(file)
    binaries.add(file.relative_to(APP).as_posix())

resources = "Contents/Resources/app/"
required = {"Contents/MacOS/Naruto OS", "Contents/Helpers/Naruto OS 游戏.app/Contents/MacOS/Naruto OS 游戏"}
required.update(resources + f for f in (
    "dist/prototype/native/core", "dist/prototype/native/updater", "dist/native/keychain",
    "dist/native/embedded-login.node", "dist/native/traffic-lights.node", "dist/native/libnaruto-login.dylib",
    "assets/game-speed/libgame-speed.dylib",
))
for flash in ("31", "34"):
    plugin = f"{resources}runtime/flash-{flash}/PepperFlashPlayer.plugin"
    required.add(plugin + "/Contents/MacOS/PepperFlashPlayer")
    run("/usr/bin/codesign", "--verify", "--strict", APP / plugin)
require(required <= binaries, f"Missing binaries: {sorted(required - binaries)}")
print(f"Verified app signature, bundle metadata and {len(binaries)} Intel Mach-O files.")
