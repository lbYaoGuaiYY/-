# -*- mode: python ; coding: utf-8 -*-

from pathlib import Path

from PyInstaller.utils.hooks import collect_data_files, copy_metadata

project_root = Path(SPECPATH).resolve().parents[1]

analysis = Analysis(
    [str(project_root / "tools" / "asset_admin" / "processing_agent_sidecar.py")],
    pathex=[str(project_root)],
    binaries=[],
    datas=collect_data_files("rembg") + copy_metadata("pymatting"),
    hiddenimports=["rembg", "rembg.sessions", "rembg.sessions.dis_general_use"],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=["pytest", "tkinter"],
    noarchive=False,
    optimize=1,
)
pyz = PYZ(analysis.pure)
executable = EXE(
    pyz,
    analysis.scripts,
    analysis.binaries,
    analysis.datas,
    [],
    name="qingshe-processing-agent",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,
)
