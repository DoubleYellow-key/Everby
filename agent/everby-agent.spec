from pathlib import Path
from PyInstaller.utils.hooks import collect_all

root = Path(SPECPATH)
datas = []
binaries = []
hiddenimports = []
for package in ("langchain", "langchain_core", "langchain_openai", "langgraph", "aiosqlite", "sqlite_vec", "tzdata"):
    package_datas, package_binaries, package_hidden = collect_all(package)
    datas += package_datas
    binaries += package_binaries
    hiddenimports += package_hidden

analysis = Analysis([str(root / "main.py")], pathex=[str(root)], binaries=binaries, datas=datas,
                    hiddenimports=hiddenimports, hookspath=[], runtime_hooks=[], excludes=[], noarchive=False)
pyz = PYZ(analysis.pure)
exe = EXE(pyz, analysis.scripts, analysis.binaries, analysis.datas, [], name="everby-agent",
          debug=False, bootloader_ignore_signals=False, strip=False, upx=True, console=True)
