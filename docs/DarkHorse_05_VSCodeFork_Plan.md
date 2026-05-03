# DarkHorse — VS Code Fork Plan
## Full Rebrand: DarkHorse.exe
> To be built AFTER CPI-4 is stable | Confidential — Deloitte Internal

---

## What the Fork Delivers

| Feature | Description |
|---------|-------------|
| DarkHorse.exe | Standalone Windows installer — no VS Code required |
| Full rebrand | DarkHorse name, icon, splash screen, title bar — zero VS Code references |
| Curated extensions | Marketplace replaced with DarkHorse Extension Hub |
| Approved addons | Claude, OpenAI, Gemini, Git, GitHub Copilot — allow-listed |
| All MVP features built-in | All 7 MVP extensions pre-installed |
| CPI-4 pipeline built-in | BR → FDS → TDS → Code available out of the box |
| Enterprise ready | Code-signed .exe, IT deployment compatible |

---

## Why We Fork AFTER CPI-4

- CPI-4 works inside existing VS Code today — no fork needed
- Fork is packaging/distribution, not new capability
- Fork takes 5–7 weeks — CPI-4 takes 3–4 weeks
- Do valuable work first, then package it properly

---

## Fork Architecture

```
microsoft/vscode (source)
        ↓ fork
vegudipati/DarkHorse (GitHub)
        ↓ rebrand
DarkHorse IDE
├── Core shell (rebranded Electron)
├── Extension Host (allow-listed only)
├── DarkHorse Extension Hub (replaces marketplace)
│   ├── darkhorse-core (MVP-1)
│   ├── darkhorse-sap (MVP-2 + MVP-4)
│   ├── darkhorse-abap (MVP-3)
│   ├── darkhorse-ai (MVP-5)
│   ├── darkhorse-git (MVP-6)
│   ├── darkhorse-agents (MVP-7)
│   └── darkhorse-pipeline (CPI-4)
└── Approved 3rd party extensions
    ├── GitHub Copilot
    ├── GitLens
    └── Thunder Client (REST testing)
```

---

## Build Phases

### Phase F1: Fork Setup & Build Pipeline
**Est: 3–4 sessions**

Steps:
1. Fork `microsoft/vscode` on GitHub (do NOT clone — fork on GitHub first)
2. Clone your fork locally to `C:\99-AI Projects\vscode-fork`
3. Install VS Code build prerequisites
4. Run first build — confirm it produces an Electron app
5. Set up build script that produces DarkHorse.exe

Prerequisites your machine needs:
```
- Git (already have)
- Node.js 18.x (NOTE: VS Code build requires Node 18, not 24)
  Install via nvm-windows to manage multiple Node versions
- Python 3.x (already have)
- Visual Studio Build Tools 2022 (C++ workload)
- yarn (VS Code uses yarn not npm)
```

**Important:** You will need TWO Node.js versions:
- Node 18.x for building VS Code source
- Node 24.x for running DarkHorse extensions
Use `nvm-windows` to switch between them.

First build command sequence:
```powershell
git clone https://github.com/vegudipati/DarkHorse.git vscode-fork
cd vscode-fork
yarn install              # installs all dependencies (~5-10 mins)
yarn compile              # compiles TypeScript (~10-15 mins)  
yarn electron             # launches dev build to verify it works
```

---

### Phase F2: Rebrand
**Est: 2–3 sessions**

Files to change for full rebrand:

| File | Change |
|------|--------|
| `product.json` | applicationName, win32MutexName, dataFolderName, URLs |
| `package.json` | name, version, description |
| `src/vs/workbench/browser/parts/titlebar/` | Title bar text |
| `resources/win32/` | .ico files for Windows |
| `resources/linux/` | .png files |
| `build/gulpfile.vscode.js` | Build output name |
| `src/vs/platform/product/common/product.ts` | Product constants |
| `src/vs/workbench/browser/parts/splash/` | Splash screen |

Key `product.json` changes:
```json
{
  "nameShort": "DarkHorse",
  "nameLong": "DarkHorse",
  "applicationName": "darkhorse",
  "dataFolderName": ".darkhorse",
  "win32MutexName": "darkhorse",
  "licenseName": "Deloitte Internal",
  "extensionAllowedProposedApi": [],
  "extensionsGallery": {
    "serviceUrl": "https://darkhorse.deloitte.internal/extensions",
    "itemUrl": "https://darkhorse.deloitte.internal/extensions"
  },
  "telemetryReportingUrl": "",
  "enableTelemetry": false
}
```

---

### Phase F3: Extension Host Lockdown
**Est: 2 sessions**

Goals:
- Replace VS Code marketplace with DarkHorse Extension Hub
- Allow-list approved 3rd party extensions
- Block all non-approved extensions from installing

Key files:
- `src/vs/workbench/services/extensionManagement/` — extension install logic
- `src/vs/platform/extensionManagement/common/extensionGalleryService.ts` — gallery URL

Allow-listed extensions (hardcoded in build):
```typescript
const DARKHORSE_ALLOWED_EXTENSIONS = [
  // DarkHorse core extensions
  'deloitte-darkhorse.darkhorse-core',
  'deloitte-darkhorse.darkhorse-sap',
  'deloitte-darkhorse.darkhorse-abap',
  'deloitte-darkhorse.darkhorse-ai',
  'deloitte-darkhorse.darkhorse-git',
  'deloitte-darkhorse.darkhorse-agents',
  'deloitte-darkhorse.darkhorse-pipeline',
  // Approved 3rd party
  'github.copilot',
  'eamodio.gitlens',
  'rangav.vscode-thunder-client',
  // AI providers
  'anthropics.claude-vscode',
  'openai.chatgpt',
  'google.gemini-vscode'
];
```

---

### Phase F4: Migrate MVP Extensions Into Fork
**Est: 3–4 sessions**

The 7 MVP extensions and CPI-4 extension get bundled into the fork.

Two approaches:
- **(A) Pre-installed:** Extensions bundled inside the installer, active on first launch
- **(B) Sideloaded:** Extensions installed from DarkHorse Extension Hub on first launch

**Recommendation: Option A (Pre-installed)** for MVP extensions.
DarkHorse without its SAP features is useless — pre-install them.

Steps:
1. Copy all extension folders into `extensions/` in the VS Code fork
2. Add them to `product.json` `builtInExtensions` array
3. Rebuild and verify they activate correctly

---

### Phase F5: Windows Installer
**Est: 2 sessions**

Uses Electron Builder (same as what we configured in MVP-1 for the .vsix).

Build config `build/darkhorse-build.js`:
```javascript
module.exports = {
  appId: 'com.deloitte.darkhorse',
  productName: 'DarkHorse',
  win: {
    target: 'nsis',           // Windows installer
    icon: 'resources/win32/darkhorse.ico',
    publisherName: 'Deloitte'
  },
  nsis: {
    installerIcon: 'resources/win32/darkhorse.ico',
    installerHeaderIcon: 'resources/win32/darkhorse.ico',
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: 'DarkHorse'
  },
  directories: {
    output: 'dist'
  }
};
```

Output: `dist/DarkHorse-Setup-0.1.0.exe`

Code signing (production):
- Purchase DigiCert EV Code Signing certificate
- Add to Electron Builder config
- Required for enterprise deployment without security warnings

---

### Phase F6: Testing & Stabilization
**Est: 2–3 sessions**

Test checklist:
- [ ] DarkHorse.exe installs on clean Windows 10 machine
- [ ] Launches with DarkHorse branding — zero VS Code references visible
- [ ] All 7 MVP extensions active on first launch
- [ ] CPI-4 pipeline works end-to-end
- [ ] Cannot install non-approved extensions
- [ ] SAP connection works (when DEV system available)
- [ ] LLM proxy starts and stops with DarkHorse
- [ ] Audit logs written correctly
- [ ] Uninstall removes all DarkHorse files cleanly

---

## Timeline Summary

| Phase | Description | Est. Sessions | Est. Weeks |
|-------|-------------|--------------|------------|
| F1 | Fork setup & first build | 3–4 | 1–2 |
| F2 | Rebrand | 2–3 | 1 |
| F3 | Extension host lockdown | 2 | 1 |
| F4 | Migrate MVP extensions | 3–4 | 1–2 |
| F5 | Windows installer | 2 | 1 |
| F6 | Testing & stabilization | 2–3 | 1 |
| **Total** | | **14–18** | **6–8** |

---

## Node Version Strategy

VS Code source requires Node 18. Your extensions run on Node 24.
Use nvm-windows to manage both:

```powershell
# Install nvm-windows from: https://github.com/coreybutler/nvm-windows
nvm install 18.20.4
nvm install 24.15.0
nvm use 18.20.4    # when building VS Code source
nvm use 24.15.0    # when building DarkHorse extensions
```

---

## Session Start Prompt (Fork — use after CPI-4 is complete)

```
DarkHorse — SAP ABAP IDE. MVP-1 through MVP-7 and CPI-4 complete.
GitHub: https://github.com/vegudipati/DarkHorse.git
Now starting VS Code Fork: Full rebrand to DarkHorse.exe.

Machine specs: Windows 11, 32GB RAM, 350GB free disk, Intel Ultra 7
Node versions managed via nvm-windows:
- Node 18.x for VS Code source build
- Node 24.x for DarkHorse extensions

Starting with Phase F1: Fork setup and first build.
Step 1: Fork microsoft/vscode on GitHub and clone locally.

Refer to DarkHorse_05_VSCodeFork_Plan.md for full spec.
Start with the fork setup commands.
```

---

## Important Notes

1. **Never commit node_modules** — .gitignore already handles this
2. **First build will take 30–60 minutes** — this is normal
3. **Rebuild after any core file change takes 10–20 minutes** — plan accordingly
4. **With Claude Code** — the fork build becomes much easier, 
   Claude Code can run build commands directly and fix errors in real time
5. **nvm-windows** — install this before starting the fork
   Download from: https://github.com/coreybutler/nvm-windows/releases
