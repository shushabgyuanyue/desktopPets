# Pointer-bearing ListView messages use memory in Explorer. All returned bounds
# are relative to the primary display in Electron DIP, rather than physical px.
param([switch]$Watch, [int]$ProcessId = 0)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$utf8 = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = $utf8
$OutputEncoding = $utf8

if ([Environment]::Is64BitOperatingSystem -and -not [Environment]::Is64BitProcess) {
    $nativePowerShell = Join-Path $env:WINDIR 'Sysnative\WindowsPowerShell\v1.0\powershell.exe'
    if ($Watch) {
        & $nativePowerShell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $PSCommandPath -Watch -ProcessId $ProcessId
    } else {
        & $nativePowerShell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $PSCommandPath
    }
    exit $LASTEXITCODE
}

$source = @'
using System;
using System.IO;
using System.Text;
using System.Collections.Generic;
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

public static class DesktopIconProbe {
    const uint LVM_GETITEMCOUNT = 0x1004, LVM_GETITEMRECT = 0x100E, LVM_GETITEMTEXTW = 0x1073;
    const uint PROCESS_VM_OPERATION = 0x0008, PROCESS_VM_READ = 0x0010;
    const uint PROCESS_VM_WRITE = 0x0020, PROCESS_QUERY_INFORMATION = 0x0400;
    const uint MEM_COMMIT = 0x1000, MEM_RESERVE = 0x2000, MEM_RELEASE = 0x8000, PAGE_READWRITE = 0x04;
    const uint SMTO_FLAGS = 0x0001 | 0x0002 | 0x0020;
    const int TEXT_CAPACITY = 1024;
    static Dictionary<string, FileSystemInfo> cachedFileNames;
    static DateTime cachedNamesAt;
    static IntPtr cachedList;
    static int cachedCount = -1;

    [StructLayout(LayoutKind.Sequential)] struct Point { public int X, Y; }
    [StructLayout(LayoutKind.Sequential)] struct Rect { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] struct MonitorInfo {
        public int Size; public Rect Monitor, Work; public uint Flags;
    }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] struct ShellFileInfo {
        public IntPtr Icon; public int IconIndex; public uint Attributes;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string DisplayName;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 80)] public string TypeName;
    }
    public sealed class Bounds { public double x, y, w, h; }
    public sealed class Icon {
        public string id, name, path;
        public bool isFolder, isRecycleBin;
        public double x, y, w, h, dpiScale;
        public int physicalX, physicalY, physicalW, physicalH;
        public Bounds imageRect, labelRect;
        public string coordinateSpace = "primary-display-dip";
    }

    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr FindWindow(string cls, string title);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr FindWindowEx(IntPtr parent, IntPtr after, string cls, string title);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out int pid);
    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern IntPtr SendMessageTimeout(IntPtr hwnd, uint message, IntPtr wParam, IntPtr lParam, uint flags, uint timeout, out UIntPtr result);
    [DllImport("user32.dll")] static extern bool ClientToScreen(IntPtr hwnd, ref Point point);
    [DllImport("user32.dll")] static extern IntPtr MonitorFromPoint(Point point, uint flags);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern bool GetMonitorInfo(IntPtr monitor, ref MonitorInfo info);
    [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr context);
    [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
    [DllImport("user32.dll")] static extern uint GetDpiForWindow(IntPtr window);
    [DllImport("shcore.dll")] static extern int SetProcessDpiAwareness(int awareness);
    [DllImport("shcore.dll")] static extern int GetDpiForMonitor(IntPtr monitor, int type, out uint dpiX, out uint dpiY);
    [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll")] static extern bool IsWow64Process(IntPtr process, out bool wow64);
    [DllImport("kernel32.dll")] static extern IntPtr VirtualAllocEx(IntPtr process, IntPtr address, UIntPtr size, uint type, uint protect);
    [DllImport("kernel32.dll")] static extern bool VirtualFreeEx(IntPtr process, IntPtr address, UIntPtr size, uint type);
    [DllImport("kernel32.dll")] static extern bool ReadProcessMemory(IntPtr process, IntPtr address, byte[] buffer, UIntPtr size, out UIntPtr read);
    [DllImport("kernel32.dll")] static extern bool WriteProcessMemory(IntPtr process, IntPtr address, byte[] buffer, UIntPtr size, out UIntPtr written);
    [DllImport("shell32.dll", CharSet = CharSet.Unicode)] static extern IntPtr SHGetFileInfo(string path, uint attributes, ref ShellFileInfo info, uint size, uint flags);

    static IntPtr FindDesktopList() {
        // Explorer moves the view between Progman and WorkerW during its lifetime.
        IntPtr host = FindWindow("Progman", null);
        if (host != IntPtr.Zero) {
            IntPtr list = ListBelow(host);
            if (list != IntPtr.Zero) return list;
        }
        host = IntPtr.Zero;
        while ((host = FindWindowEx(IntPtr.Zero, host, "WorkerW", null)) != IntPtr.Zero) {
            IntPtr list = ListBelow(host);
            if (list != IntPtr.Zero) return list;
        }
        return IntPtr.Zero;
    }

    static IntPtr ListBelow(IntPtr host) {
        IntPtr view = FindWindowEx(host, IntPtr.Zero, "SHELLDLL_DefView", null);
        return view == IntPtr.Zero ? IntPtr.Zero : FindWindowEx(view, IntPtr.Zero, "SysListView32", null);
    }

    static bool Message(IntPtr list, uint message, int index, IntPtr data, out UIntPtr result) {
        return SendMessageTimeout(list, message, new IntPtr(index), data, SMTO_FLAGS, 200, out result) != IntPtr.Zero;
    }

    static bool Write(IntPtr process, IntPtr address, byte[] bytes) {
        UIntPtr written;
        return WriteProcessMemory(process, address, bytes, new UIntPtr((uint)bytes.Length), out written)
            && written.ToUInt64() == (ulong)bytes.Length;
    }

    static bool Read(IntPtr process, IntPtr address, byte[] bytes) {
        UIntPtr read;
        return ReadProcessMemory(process, address, bytes, new UIntPtr((uint)bytes.Length), out read)
            && read.ToUInt64() == (ulong)bytes.Length;
    }

    static string ReadText(IntPtr list, IntPtr process, IntPtr itemMemory, IntPtr textMemory, bool target64, int index) {
        // LVITEM uses the target process layout, independent of the host layout.
        byte[] item = new byte[target64 ? 88 : 60];
        Buffer.BlockCopy(BitConverter.GetBytes(1u), 0, item, 0, 4);
        Buffer.BlockCopy(BitConverter.GetBytes(index), 0, item, 4, 4);
        byte[] pointer = target64 ? BitConverter.GetBytes(textMemory.ToInt64()) : BitConverter.GetBytes(unchecked((uint)textMemory.ToInt64()));
        Buffer.BlockCopy(pointer, 0, item, target64 ? 24 : 20, pointer.Length);
        Buffer.BlockCopy(BitConverter.GetBytes(TEXT_CAPACITY), 0, item, target64 ? 32 : 24, 4);
        byte[] text = new byte[TEXT_CAPACITY * 2];
        if (!Write(process, itemMemory, item) || !Write(process, textMemory, text)) return "";
        UIntPtr result;
        if (!Message(list, LVM_GETITEMTEXTW, index, itemMemory, out result) || !Read(process, textMemory, text)) return "";
        int length = (int)Math.Min(result.ToUInt64(), (ulong)(TEXT_CAPACITY - 1));
        return Encoding.Unicode.GetString(text, 0, length * 2).TrimEnd('\0');
    }

    static List<FileSystemInfo> DesktopFiles() {
        var files = new List<FileSystemInfo>();
        var roots = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        roots.Add(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory));
        roots.Add(Environment.GetFolderPath(Environment.SpecialFolder.CommonDesktopDirectory));
        foreach (string root in roots) {
            try {
                if (!Directory.Exists(root)) continue;
                foreach (FileSystemInfo file in new DirectoryInfo(root).GetFileSystemInfos()) {
                    // Matching the ListView decides visibility. Include hidden files
                    // too, in case Explorer is configured to show them.
                    files.Add(file);
                }
            } catch (IOException) { } catch (UnauthorizedAccessException) { }
        }
        return files;
    }

    static Dictionary<string, FileSystemInfo> FileNames(List<FileSystemInfo> files) {
        var names = new Dictionary<string, FileSystemInfo>(StringComparer.OrdinalIgnoreCase);
        foreach (FileSystemInfo file in files) {
            AddName(names, file.Name, file);
            var info = new ShellFileInfo();
            if (SHGetFileInfo(file.FullName, 0, ref info, (uint)Marshal.SizeOf(typeof(ShellFileInfo)), 0x200) != IntPtr.Zero)
                AddName(names, info.DisplayName, file);
        }
        return names;
    }

    static Dictionary<string, FileSystemInfo> DesktopFileNames(IntPtr list, int count) {
        if (cachedFileNames == null || list != cachedList || count != cachedCount ||
            (DateTime.UtcNow - cachedNamesAt).TotalSeconds >= 5) {
            cachedFileNames = FileNames(DesktopFiles());
            cachedNamesAt = DateTime.UtcNow;
            cachedList = list;
            cachedCount = count;
        }
        return cachedFileNames;
    }

    static void AddName(Dictionary<string, FileSystemInfo> names, string name, FileSystemInfo file) {
        if (String.IsNullOrEmpty(name)) return;
        FileSystemInfo existing;
        if (!names.TryGetValue(name, out existing)) names[name] = file;
        else if (existing != null && !String.Equals(existing.FullName, file.FullName, StringComparison.OrdinalIgnoreCase)) names[name] = null;
    }

    static IntPtr EnablePhysicalCoordinates() {
        try { SetProcessDpiAwarenessContext(new IntPtr(-4)); }
        catch (EntryPointNotFoundException) { try { SetProcessDpiAwareness(2); } catch (DllNotFoundException) { } }
        try { return SetThreadDpiAwarenessContext(new IntPtr(-4)); }
        catch (EntryPointNotFoundException) { return IntPtr.Zero; }
    }

    public static Icon[] Read(string recycleBinName) {
        var icons = new List<Icon>();
        IntPtr previousDpi = EnablePhysicalCoordinates();
        IntPtr process = IntPtr.Zero, memory = IntPtr.Zero;
        try {
            IntPtr list = FindDesktopList();
            if (list == IntPtr.Zero) return icons.ToArray();
            IntPtr primary = MonitorFromPoint(new Point(), 1);
            var monitor = new MonitorInfo { Size = Marshal.SizeOf(typeof(MonitorInfo)) };
            if (!GetMonitorInfo(primary, ref monitor)) return icons.ToArray();
            uint dpiX = 96, dpiY = 96;
            try {
                if (GetDpiForMonitor(primary, 0, out dpiX, out dpiY) != 0) dpiX = dpiY = 96;
            } catch (DllNotFoundException) { try { dpiX = dpiY = GetDpiForWindow(list); } catch (EntryPointNotFoundException) { } }
            catch (EntryPointNotFoundException) { try { dpiX = dpiY = GetDpiForWindow(list); } catch (EntryPointNotFoundException) { } }
            double scaleX = Math.Max(96u, dpiX) / 96.0, scaleY = Math.Max(96u, dpiY) / 96.0;
            int pid;
            GetWindowThreadProcessId(list, out pid);
            process = OpenProcess(PROCESS_VM_OPERATION | PROCESS_VM_READ | PROCESS_VM_WRITE | PROCESS_QUERY_INFORMATION, false, pid);
            if (process == IntPtr.Zero) return icons.ToArray();
            bool wow64;
            if (!IsWow64Process(process, out wow64)) return icons.ToArray();
            bool target64 = Environment.Is64BitOperatingSystem && !wow64;
            memory = VirtualAllocEx(process, IntPtr.Zero, new UIntPtr(8192u), MEM_COMMIT | MEM_RESERVE, PAGE_READWRITE);
            if (memory == IntPtr.Zero) return icons.ToArray();
            IntPtr itemMemory = IntPtr.Add(memory, 64), textMemory = IntPtr.Add(memory, 256);
            UIntPtr result;
            if (!Message(list, LVM_GETITEMCOUNT, 0, IntPtr.Zero, out result)) return icons.ToArray();
            int count = (int)Math.Min(result.ToUInt64(), 4096ul);
            var names = DesktopFileNames(list, count);
            for (int index = 0; index < count; index++) {
                // RECT.left = LVIR_ICON. Block the icon image only; including
                // the label/selection cell can close otherwise passable gaps.
                byte[] rect = new byte[16];
                Buffer.BlockCopy(BitConverter.GetBytes(1), 0, rect, 0, 4);
                if (!Write(process, memory, rect) || !Message(list, LVM_GETITEMRECT, index, memory, out result)
                    || result == UIntPtr.Zero || !Read(process, memory, rect)) continue;
                var start = new Point { X = BitConverter.ToInt32(rect, 0), Y = BitConverter.ToInt32(rect, 4) };
                var end = new Point { X = BitConverter.ToInt32(rect, 8), Y = BitConverter.ToInt32(rect, 12) };
                // Explorer's large-icon view keeps horizontal cell padding even
                // in LVIR_ICON. Its image is square and horizontally centered;
                // the icon rectangle's height gives the actual image size.
                int iconSide = Math.Min(end.X - start.X, end.Y - start.Y);
                if (iconSide <= 0) continue;
                start.X += ((end.X - start.X) - iconSide) / 2;
                end.X = start.X + iconSide;
                if (!ClientToScreen(list, ref start) || !ClientToScreen(list, ref end)) continue;
                int left = Math.Max(start.X, monitor.Monitor.Left), top = Math.Max(start.Y, monitor.Monitor.Top);
                int right = Math.Min(end.X, monitor.Monitor.Right), bottom = Math.Min(end.Y, monitor.Monitor.Bottom);
                if (right <= left || bottom <= top) continue;
                string name = ReadText(list, process, itemMemory, textMemory, target64, index);
                Bounds labelBounds = null;
                byte[] labelRect = new byte[16];
                Buffer.BlockCopy(BitConverter.GetBytes(2), 0, labelRect, 0, 4);
                if (Write(process, memory, labelRect) && Message(list, LVM_GETITEMRECT, index, memory, out result)
                    && result != UIntPtr.Zero && Read(process, memory, labelRect)) {
                    var labelStart = new Point { X = BitConverter.ToInt32(labelRect, 0), Y = BitConverter.ToInt32(labelRect, 4) };
                    var labelEnd = new Point { X = BitConverter.ToInt32(labelRect, 8), Y = BitConverter.ToInt32(labelRect, 12) };
                    if (labelEnd.X > labelStart.X && labelEnd.Y > labelStart.Y &&
                        ClientToScreen(list, ref labelStart) && ClientToScreen(list, ref labelEnd)) {
                        int labelLeft = Math.Max(labelStart.X, monitor.Monitor.Left);
                        int labelTop = Math.Max(labelStart.Y, monitor.Monitor.Top);
                        int labelRight = Math.Min(labelEnd.X, monitor.Monitor.Right);
                        int labelBottom = Math.Min(labelEnd.Y, monitor.Monitor.Bottom);
                        if (labelRight > labelLeft && labelBottom > labelTop) labelBounds = new Bounds {
                            x = (labelLeft - monitor.Monitor.Left) / scaleX,
                            y = (labelTop - monitor.Monitor.Top) / scaleY,
                            w = (labelRight - labelLeft) / scaleX,
                            h = (labelBottom - labelTop) / scaleY
                        };
                    }
                }
                FileSystemInfo match;
                names.TryGetValue(name, out match);
                icons.Add(new Icon {
                    id = "desktop-icon-" + index, name = String.IsNullOrWhiteSpace(name) ? "Desktop icon " + (index + 1) : name,
                    path = match == null ? "" : match.FullName, isFolder = match is DirectoryInfo,
                    isRecycleBin = match == null && (String.Equals(name, recycleBinName, StringComparison.OrdinalIgnoreCase) ||
                        String.Equals(name, "\u56DE\u6536\u7AD9", StringComparison.OrdinalIgnoreCase) ||
                        String.Equals(name, "Recycle Bin", StringComparison.OrdinalIgnoreCase)),
                    x = (left - monitor.Monitor.Left) / scaleX, y = (top - monitor.Monitor.Top) / scaleY,
                    w = (right - left) / scaleX, h = (bottom - top) / scaleY, dpiScale = scaleX,
                    physicalX = left, physicalY = top, physicalW = right - left, physicalH = bottom - top,
                    imageRect = new Bounds { x = (left - monitor.Monitor.Left) / scaleX,
                        y = (top - monitor.Monitor.Top) / scaleY, w = (right - left) / scaleX,
                        h = (bottom - top) / scaleY },
                    labelRect = labelBounds
                });
            }
            return icons.ToArray();
        } finally {
            if (memory != IntPtr.Zero) VirtualFreeEx(process, memory, UIntPtr.Zero, MEM_RELEASE);
            if (process != IntPtr.Zero) CloseHandle(process);
            if (previousDpi != IntPtr.Zero) SetThreadDpiAwarenessContext(previousDpi);
        }
    }
}
'@

try {
    Add-Type -TypeDefinition $source -ErrorAction Stop | Out-Null
    $recycleBinName = ''
    try { $recycleBinName = (New-Object -ComObject Shell.Application).Namespace(10).Self.Name }
    catch { }
    if ($Watch) {
        while ($null -ne ($command = [Console]::ReadLine())) {
            if ($command -eq 'focus') {
                $focusState = if ([DesktopFocusProbe]::IsDesktop($ProcessId)) { 'desktop' } else { 'other' }
                # A heartbeat also repairs windows hidden/minimized by Show Desktop.
                [Console]::Out.WriteLine('focus:' + $focusState)
                [Console]::Out.Flush()
                continue
            }
            if ($command -ne 'icons') { continue }
            try {
                $icons = [DesktopIconProbe]::Read($recycleBinName)
                [Console]::Out.WriteLine((ConvertTo-Json -InputObject @($icons) -Compress -Depth 4))
            } catch {
                [Console]::Out.WriteLine('{"error":"desktop icon probe failed"}')
            }
            [Console]::Out.Flush()
        }
    } else {
        $icons = [DesktopIconProbe]::Read($recycleBinName)
        # InputObject preserves the array shape for zero and one icon as well.
        ConvertTo-Json -InputObject @($icons) -Compress -Depth 4
    }
} catch {
    # Keep diagnostics out of the stdout protocol consumed by Electron.
    if ($Watch) { [Console]::Error.WriteLine($_.Exception.Message) }
    else { '[]' }
}
