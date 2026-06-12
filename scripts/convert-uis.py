#!/usr/bin/env python3
"""
One-shot conversion of the copied legacy UIs into pnpm workspace packages:
 - unique names, workspace-friendly scripts (dev/build/typecheck)
 - merge react-libs dependencies into each UI (the lib is consumed as source
   via the committed src/react-libs symlink, matching the legacy setup)
 - drop the legacy preinstall symlink hack + env-cmd variants
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LIB_PKG = json.loads(
    (ROOT / "provena/utilities/packages/typescript/react-libs/package.json").read_text()
)

UI_PORTS = {
    "landing-portal-ui": 8001,
    "registry-ui": 8002,
    "data-store-ui": 8003,
    "prov-ui": 8004,
}

for ui, port in UI_PORTS.items():
    pkg_path = ROOT / "apps" / ui / "package.json"
    pkg = json.loads(pkg_path.read_text())

    pkg["name"] = f"@provena/{ui}"
    pkg["version"] = "2.0.0"
    pkg["private"] = True

    deps = pkg.get("dependencies", {})
    # Merge lib deps which the UI does not already declare
    for name, version in LIB_PKG.get("dependencies", {}).items():
        deps.setdefault(name, version)
    pkg["dependencies"] = dict(sorted(deps.items()))

    dev = pkg.get("devDependencies", {})
    for name, version in LIB_PKG.get("devDependencies", {}).items():
        dev.setdefault(name, version)
    dev.pop("knip", None)
    dev.pop("env-cmd", None)
    pkg["devDependencies"] = dict(sorted(dev.items()))

    pkg["scripts"] = {
        "dev": f"vite --port {port}",
        "build": "tsc && vite build",
        "typecheck": "tsc --noEmit",
        "preview": f"vite preview --port {port}",
    }
    pkg_path.write_text(json.dumps(pkg, indent=4) + "\n")
    print(f"updated {pkg_path}")
print("done")
