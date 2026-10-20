"""Builds Chordino (the NNLS Chroma Vamp plugin), and on Windows the `vamp` Python host (SP4 bake-off).

Windows/MSVC: neither ships a usable build: nnls-chroma needs Boost and the plugin pack is a GUI installer; the
`vamp` sdist uses POSIX `ssize_t`. This script downloads the sources into %LOCALAPPDATA%\\MusicQueery\\dl, patches
them, and writes
  %LOCALAPPDATA%\\MusicQueery\\vamp\\nnls-chroma.dll    (point VAMP_PATH here; mqc does it automatically)
  companion\\.wheels\\vamp-1.1.0-cp312-cp312-win_amd64.whl

Linux (gcc/g++): the same Boost-free patch, built into ~/.local/share/MusicQueery/vamp/nnls-chroma.so. The `vamp`
host comes from the PyPI sdist through `uv sync` (pyproject.toml), so no wheel is built here.

Usage (from the repo root): python companion/scripts/build_chordino.py   (Linux: uv run --no-project python ...)
"""

from __future__ import annotations

import io
import os
import re
import shutil
import subprocess
import sys
import tarfile
import urllib.request
import zipfile
from pathlib import Path

COMPANION = Path(__file__).resolve().parents[1]
WINDOWS = sys.platform == "win32"
if WINDOWS:
    LOCAL = Path(os.environ["LOCALAPPDATA"]) / "MusicQueery"
else:  # same place as mqc.config.LOCAL
    LOCAL = Path(os.environ.get("XDG_DATA_HOME") or Path.home() / ".local" / "share") / "MusicQueery"
DL = LOCAL / "dl" / "chordino-build"
OUT_DLL = LOCAL / "vamp" / "nnls-chroma.dll"
OUT_SO = LOCAL / "vamp" / "nnls-chroma.so"
NNLS_SOURCES = ["chromamethods.cpp", "NNLSBase.cpp", "NNLSChroma.cpp", "Chordino.cpp", "Tuning.cpp", "plugins.cpp"]
NNLS_SOURCES += ["nnls.c", "viterbi.cpp"]
SDK_SOURCES = ["PluginAdapter.cpp", "RealTime.cpp", "FFT.cpp"]
WHEELS = COMPANION / ".wheels"

NNLS = "https://github.com/c4dm/nnls-chroma/archive/refs/heads/master.zip"
SDK = "https://github.com/vamp-plugins/vamp-plugin-sdk/archive/refs/heads/master.zip"
VAMP_SDIST = "https://files.pythonhosted.org/packages/source/v/vamp/vamp-1.1.0.tar.gz"


def fetch_zip(url: str, dest: Path) -> Path:
    data = urllib.request.urlopen(url).read()
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        root = z.namelist()[0].split("/")[0]
        z.extractall(dest)
    return dest / root


def vcvars_env() -> dict[str, str]:
    vswhere = Path(os.environ["ProgramFiles(x86)"]) / "Microsoft Visual Studio" / "Installer" / "vswhere.exe"
    vs = subprocess.check_output(
        [
            str(vswhere),
            "-latest",
            "-products",
            "*",
            "-requires",
            "Microsoft.VisualStudio.Component.VC.Tools.x86.x64",
            "-property",
            "installationPath",
        ],
        text=True,
    ).strip()
    bat = Path(vs) / "VC" / "Auxiliary" / "Build" / "vcvars64.bat"
    out = subprocess.check_output(f'"{bat}" >nul && set', shell=True, text=True)
    return dict(line.split("=", 1) for line in out.splitlines() if "=" in line)


TOKENIZER = """
#include <fstream>
// Boost-free stand-ins (MusicQueery build): split on ",; " and keep "=" as its own token.
static std::vector<std::string> mqTokens(const std::string& line) {
    std::vector<std::string> out; std::string cur;
    for (char c : line) {
        if (c == ',' || c == ';' || c == ' ' || c == '=' || c == '\\t' || c == '\\r') {
            if (!cur.empty()) { out.push_back(cur); cur.clear(); }
            if (c == '=') out.push_back("=");
        } else cur += c;
    }
    if (!cur.empty()) out.push_back(cur);
    return out;
}
"""


def patch_nnls(src: Path) -> None:
    p = src / "chromamethods.cpp"
    s = p.read_text(encoding="latin-1")
    s = re.sub(r"#include <boost/[^>]+>\n", "", s)
    s = s.replace("using namespace boost;", TOKENIZER)
    s = s.replace("    typedef tokenizer<char_separator<char> > Tok;\n", "")
    s = s.replace('    char_separator<char> sep(",; ","=");\n', "")
    s = s.replace(
        "iostreams::stream<iostreams::file_source> chordDictFile(chordDictFilename);",
        "std::ifstream chordDictFile(chordDictFilename);",
    )
    old_loop = s[
        s.index("                Tok tok(line, sep);") : s.index("                tempChordNames.push_back(chordType);")
    ]
    new_loop = """                std::vector<std::string> toks = mqTokens(line);
                for (size_t ti = 0; ti < toks.size(); ++ti) {
                    if (ti == 0) {
                        if (toks[0] == "=") chordType = "";
                        else { chordType = toks[0]; ti++; }
                    } else {
                        tempChordDict.push_back(std::stof(toks[ti]));
                    }
                }
"""
    s = s.replace(old_loop, new_loop)
    assert "boost" not in s.replace("boostN", ""), "boost still referenced"
    p.write_text(s, encoding="latin-1")


def build_dll(nnls: Path, sdk: Path, env: dict[str, str]) -> None:
    obj = DL / "obj"
    obj.mkdir(exist_ok=True)
    srcs = [nnls / f for f in NNLS_SOURCES] + [sdk / "src" / "vamp-sdk" / f for f in SDK_SOURCES]
    (DL / "nnls.def").write_text("EXPORTS\n  vampGetPluginDescriptor\n")
    OUT_DLL.parent.mkdir(parents=True, exist_ok=True)
    cl = shutil.which("cl", path=env.get("Path") or env.get("PATH"))
    cmd = [
        cl,
        "/nologo",
        "/O2",
        "/EHsc",
        "/MT",
        "/LD",
        "/D_USE_MATH_DEFINES",
        "/DNOMINMAX",
        "/utf-8",
        "/w",
        f"/I{sdk}",
        f"/I{nnls}",
        f"/Fo{obj}\\",
        *map(str, srcs),
        f"/Fe{OUT_DLL}",
        "/link",
        f"/DEF:{DL / 'nnls.def'}",
    ]
    subprocess.run(cmd, env=env, check=True, cwd=DL)
    # Ship the chord dictionaries next to the DLL so Chordino's external-dictionary path can be used later.
    print(f"built {OUT_DLL}")


def build_vamp_wheel(env: dict[str, str]) -> None:
    data = urllib.request.urlopen(VAMP_SDIST).read()
    with tarfile.open(fileobj=io.BytesIO(data)) as t:
        t.extractall(DL, filter="data")
    src = DL / "vamp-1.1.0"
    for p in (src / "native").glob("*.cpp"):
        s = p.read_text(encoding="latin-1")
        if "ssize_t" in s and "MQ_SSIZE_T" not in s:
            s = "#ifdef _WIN32\n#include <BaseTsd.h>\ntypedef SSIZE_T ssize_t; // MQ_SSIZE_T\n#endif\n" + s
            p.write_text(s, encoding="latin-1")
    # The sdist imports numpy in setup.py without declaring it.
    (src / "pyproject.toml").write_text(
        '[build-system]\nrequires = ["setuptools", "numpy"]\nbuild-backend = "setuptools.build_meta"\n'
    )
    WHEELS.mkdir(exist_ok=True)
    uv = [sys.executable, "-m", "uv"]
    subprocess.run(
        [*uv, "build", "--wheel", "--python", "3.12", "--out-dir", str(WHEELS), str(src)],
        env={**os.environ, **env},
        check=True,
    )


def build_so(nnls: Path, sdk: Path) -> None:
    """Linux: compile with gcc (nnls.c) and g++ (the rest), export only the Vamp entry point."""
    obj = DL / "obj"
    obj.mkdir(exist_ok=True)
    flags = ["-O2", "-fPIC", "-w", "-D_USE_MATH_DEFINES", f"-I{sdk}", f"-I{nnls}"]
    objs = []
    for src in [nnls / f for f in NNLS_SOURCES] + [sdk / "src" / "vamp-sdk" / f for f in SDK_SOURCES]:
        o = obj / (src.stem + ".o")
        cc = "gcc" if src.suffix == ".c" else "g++"
        subprocess.run([cc, *flags, "-c", str(src), "-o", str(o)], check=True)
        objs.append(str(o))
    OUT_SO.parent.mkdir(parents=True, exist_ok=True)
    link = ["g++", "-shared", "-o", str(OUT_SO), *objs, f"-Wl,--version-script={nnls / 'vamp-plugin.map'}"]
    subprocess.run(link, check=True)
    print(f"built {OUT_SO}")


def main() -> None:
    if DL.exists():
        shutil.rmtree(DL)
    DL.mkdir(parents=True)
    nnls = fetch_zip(NNLS, DL)
    sdk = fetch_zip(SDK, DL)
    patch_nnls(nnls)
    if not WINDOWS:
        build_so(nnls, sdk)
        return
    env = vcvars_env()
    build_dll(nnls, sdk, env)
    build_vamp_wheel(env)


if __name__ == "__main__":
    main()
