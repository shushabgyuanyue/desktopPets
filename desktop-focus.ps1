param(
    [ValidateRange(0, 2147483647)]
    [int]$ProcessId = 0
)

# A single foreground probe process, terminated directly by Electron's kill().
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$utf8 = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = $utf8
$OutputEncoding = $utf8

$source = @'
using System;
using System.Text;
using System.Runtime.InteropServices;

public static class DesktopFocusProbe {
    const uint GA_PARENT = 1;
    const int VK_LBUTTON = 0x01;

    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    static extern int GetClassName(IntPtr window, StringBuilder className, int capacity);
    [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr window, uint flags);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
    [DllImport("user32.dll")] static extern short GetAsyncKeyState(int virtualKey);
    delegate bool EnumWindowCallback(IntPtr window, IntPtr data);
    [StructLayout(LayoutKind.Sequential)] struct Rect { public int Left, Top, Right, Bottom; }
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumWindowCallback callback, IntPtr data);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr window);
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr window, out Rect rect);
    [DllImport("user32.dll")] static extern int GetSystemMetrics(int index);
    [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr window, int index);
    [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr window, int attr, out int value, int size);

    static bool Cloaked(IntPtr window) {
        int value;
        return DwmGetWindowAttribute(window, 14, out value, 4) == 0 && value != 0;
    }

    static string WindowClass(IntPtr window) {
        var text = new StringBuilder(256); GetClassName(window, text, text.Capacity);
        return text.ToString();
    }

    static bool IsDesktopClass(string name) {
        return name == "Progman" || name == "WorkerW" || name == "SHELLDLL_DefView";
    }

    static bool IsTaskbar(string name) {
        return name == "Shell_TrayWnd" || name == "Shell_SecondaryTrayWnd";
    }

    // Clicking Show Desktop may leave the taskbar (or a minimized HWND) as
    // foreground until the next desktop click. Only accept that state when
    // no application is visible on the primary monitor; taskbar focus alone
    // must never put the ants over an open app.
    static bool DesktopExposed(int ownProcess) {
        bool exposed = true;
        int width = GetSystemMetrics(0), height = GetSystemMetrics(1);
        EnumWindows(delegate(IntPtr w, IntPtr data) {
            if (!IsWindowVisible(w) || IsIconic(w) || Cloaked(w)) return true;
            uint pid; GetWindowThreadProcessId(w, out pid);
            if (pid == ownProcess) return true;
            string name = WindowClass(w);
            if (IsDesktopClass(name) || IsTaskbar(name) || name == "#32769") return true;
            if ((GetWindowLong(w, -20) & 0x80) != 0) return true; // transient tool windows
            Rect rect;
            if (!GetWindowRect(w, out rect) || rect.Right <= 0 || rect.Bottom <= 0 ||
                rect.Left >= width || rect.Top >= height ||
                rect.Right - rect.Left < 8 || rect.Bottom - rect.Top < 8) return true;
            exposed = false; return false;
        }, IntPtr.Zero);
        return exposed;
    }

    static bool IsDesktopDragWindow(IntPtr window) {
        if ((GetAsyncKeyState(VK_LBUTTON) & 0x8000) == 0) return false;
        var className = new StringBuilder(256);
        if (GetClassName(window, className, className.Capacity) <= 0) return false;
        string value = className.ToString();
        // Explorer uses a temporary popup for the OLE drag image. It is not
        // parented below WorkerW, so ancestry-only desktop detection would
        // hide the ants while a desktop icon is being dragged.
        return value == "#32768" || value == "SysDragImage" || value == "DragImageWnd";
    }

    public static bool IsDesktop(int electronProcessId) {
        IntPtr window = GetForegroundWindow();
        if (window == IntPtr.Zero || IsIconic(window) || Cloaked(window)) return DesktopExposed(electronProcessId);

        uint foregroundProcessId;
        GetWindowThreadProcessId(window, out foregroundProcessId);
        if (electronProcessId > 0 && foregroundProcessId == (uint)electronProcessId) return true;
        if (IsDesktopDragWindow(window)) return true;
        if (IsTaskbar(WindowClass(window))) return DesktopExposed(electronProcessId);

        var className = new StringBuilder(256);
        for (int depth = 0; window != IntPtr.Zero && depth < 64; depth++) {
            className.Clear();
            if (GetClassName(window, className, className.Capacity) > 0) {
                string value = className.ToString();
                if (value == "Progman" || value == "WorkerW" || value == "SHELLDLL_DefView") return true;
            }
            IntPtr parent = GetAncestor(window, GA_PARENT);
            if (parent == window) break;
            window = parent;
        }
        return false;
    }
}

'@

try {
    Add-Type -TypeDefinition $source -ErrorAction Stop
    $lastState = $null
    while ($true) {
        $currentState = if ([DesktopFocusProbe]::IsDesktop($ProcessId)) { 'desktop' } else { 'other' }
        if ($currentState -ne $lastState) {
            [Console]::Out.WriteLine($currentState)
            [Console]::Out.Flush()
            $lastState = $currentState
        }
        [System.Threading.Thread]::Sleep(250)
    }
} catch {
    [Console]::Error.WriteLine('desktop-focus: ' + $_.Exception.Message)
    exit 1
}
