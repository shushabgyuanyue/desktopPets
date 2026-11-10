# Native Renderer Preview

This is an isolated Windows desktop overlay for evaluating a native rendering path. It keeps the production `renderer/colony.js` simulation and feeds compact snapshots to a C# Direct2D renderer hosted by DirectComposition.

Run `run.ps1` in PowerShell. The first run downloads the SharpDX 4.2.0 runtime packages into `%LOCALAPPDATA%\deskants-native-preview-packages`, compiles the preview with the installed .NET Framework C# compiler, and launches it. The preview process writes its final sample to `diagnostics/direct2d-preview-session.json` when closed.

`Ctrl+Shift+F10` pauses or resumes the simulated colony, `Ctrl+Shift+F11` toggles pheromones, and `Ctrl+Shift+F12` closes the preview. The window passes mouse input through to the desktop.

The workload has 36 ants, synthetic desktop-like obstacles, two fake file foods, and the production ant, food, and portal atlases. It does not enumerate the desktop, open paths, or perform file operations. Production desktop detection, Explorer icon replacement, panel input, and safe recycling are outside this prototype.
