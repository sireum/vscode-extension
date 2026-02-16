# Sireum VSCode Extension

## Project Structure
- Sireum core (kekinian): `../` (parent directory)
- Init.scala (extension setup/patching): `../runtime/library/jvm/src/main/scala/org/sireum/Init.scala`
- CodeIVE app (OS/arch-specific):
  - macOS: `../bin/mac/vscodium/CodeIVE.app/Contents/Resources/app/bin/codium`
  - Linux x64: `../bin/linux/vscodium/bin/codium`
  - Linux arm64: `../bin/linux/arm/vscodium/bin/codium`
  - Windows: `../bin/win/vscodium/CodeIVE.exe`
- Extensions dir: `../bin/<platform/arch>/vscodium/codium-portable-data/extensions/`

## Build & Test Workflow
- Build Sireum: `cd .. && bin/build.cmd`
- Build extension only: `bin/build.cmd package` (produces `.vsix` in project root)
- Setup VSCode (install official release + patch extensions): `sireum setup vscode --extensions ""`
- NOT `sireum vscode setup` (wrong order)

## Deploying Locally Built Extension to CodeIVE
`sireum setup vscode` installs the **official release**, not the local build. To test local changes:
1. Build: `bin/build.cmd package` → produces `sireum-vscode-extension.vsix` in project root
2. Extract into extensions dir:
   ```
   TARGET=<extensions-dir>/sireum.vscode-extension-<version>
   rm -rf "$TARGET" && mkdir -p "$TARGET" && cd "$TARGET"
   unzip -q <path-to>.vsix "extension/*" && mv extension/* . && rm -rf extension
   ```
3. Update `extensions.json` in the extensions dir: change the sireum entry's `version`, `fsPath`, `path`, `external`, and `relativeLocation` to match the new version directory name
- Extensions dir: `../bin/<platform>/vscodium/codium-portable-data/extensions/`
- The version string is in the build output (e.g., `4.20260211.159363601`)

## Sensmetry Extension Versioning
- Version 0.9.1 → installs `Sensmetry.sysml-2ls` → dispatches to `patchSysIde()`
- Other versions → installs `sensmetry.syside-editor` → dispatches to `patchSysIdeEditor()`
- Both need identical package.json patching (sysml language/grammar removal, semantic highlighting disable)
- Shared functions (`removeJsonArrayElement`, `patchPackageJson`) must be at sibling scope, not nested in one path

## Slang Coding Notes
- See `../CLAUDE.md` for Slang conventions
- Use `conversions.String.toCis` for character-level scanning
- Use `ops.StringOps.stringIndexOfFrom` for string search in CIS
- Variable shadowing: inner `var content` conflicts with outer `var content` — rename to avoid
- `replaceAllLiterally` is NOT idempotent if replacement contains the search string — add explicit guard
- Scanning approach (tracking brace depth) preferred over string matching for JSON manipulation

## SysML Syntax Highlighting
- Grammar: `syntaxes/sysml.tmLanguage.json` (scopeName: `source.sysml`)
- Block comment pattern uses `(?!\{)` negative lookahead to exclude GUMBO `/*{ }*/` blocks
- Language config: `language-configuration-sysml.json`
- Theme entries added to both `themes/sireum-dark.json` and `themes/sireum-light.json`
