using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Web.Script.Serialization;
using Microsoft.Win32;

public static class WallpaperPatchProgram {
    [StructLayout(LayoutKind.Sequential)] struct Point { public int X, Y; }
    [StructLayout(LayoutKind.Sequential)] struct Rect { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] struct MonitorInfo {
        public int Size; public Rect Monitor, Work; public uint Flags;
    }

    public sealed class PatchRequest {
        public string id { get; set; }
        public int x { get; set; }
        public int y { get; set; }
        public int w { get; set; }
        public int h { get; set; }
    }
    public sealed class PatchResult {
        public string id { get; set; }
        public string dataUrl { get; set; }
    }

    [DllImport("user32.dll")] static extern IntPtr MonitorFromPoint(Point point, uint flags);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern bool GetMonitorInfo(IntPtr monitor, ref MonitorInfo info);
    [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
    [DllImport("user32.dll")] static extern int GetSystemMetrics(int index);

    static string RegistryText(string key, string fallback) {
        using (RegistryKey desktop = Registry.CurrentUser.OpenSubKey("Control Panel\\Desktop")) {
            return desktop == null ? fallback : Convert.ToString(desktop.GetValue(key, fallback));
        }
    }

    static Color BackgroundColor() {
        using (RegistryKey colors = Registry.CurrentUser.OpenSubKey("Control Panel\\Colors")) {
            string value = colors == null ? "0 0 0" : Convert.ToString(colors.GetValue("Background", "0 0 0"));
            string[] channels = value.Split(new[] { ' ' }, StringSplitOptions.RemoveEmptyEntries);
            int red, green, blue;
            if (channels.Length == 3 && int.TryParse(channels[0], out red) &&
                int.TryParse(channels[1], out green) && int.TryParse(channels[2], out blue)) {
                return Color.FromArgb(Math.Max(0, Math.Min(255, red)),
                    Math.Max(0, Math.Min(255, green)), Math.Max(0, Math.Min(255, blue)));
            }
            return Color.Black;
        }
    }

    static string WallpaperPath() {
        string configured = RegistryText("WallPaper", "");
        if (String.IsNullOrWhiteSpace(configured)) return null;
        string themes = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
            "Microsoft", "Windows", "Themes", "TranscodedWallpaper");
        if (File.Exists(themes)) return themes;
        return File.Exists(configured) ? configured : null;
    }

    static Rect PrimaryMonitor() {
        IntPtr monitor = MonitorFromPoint(new Point { X = 0, Y = 0 }, 1);
        var info = new MonitorInfo { Size = Marshal.SizeOf(typeof(MonitorInfo)) };
        if (!GetMonitorInfo(monitor, ref info)) throw new InvalidOperationException("Primary display unavailable");
        return info.Monitor;
    }

    static Rect VirtualScreen() {
        int left = GetSystemMetrics(76), top = GetSystemMetrics(77);
        return new Rect { Left = left, Top = top,
            Right = left + GetSystemMetrics(78), Bottom = top + GetSystemMetrics(79) };
    }

    static void DrawWallpaper(Graphics graphics, Image wallpaper, PatchRequest patch,
        Rect monitor, int style, bool tile) {
        if (wallpaper == null) return;
        if (tile) {
            using (var brush = new TextureBrush(wallpaper, WrapMode.Tile)) {
                brush.TranslateTransform(-patch.x, -patch.y);
                graphics.FillRectangle(brush, 0, 0, patch.w, patch.h);
            }
            return;
        }
        Rect area = style == 22 ? VirtualScreen() : monitor;
        double width = area.Right - area.Left, height = area.Bottom - area.Top;
        double drawWidth = wallpaper.Width, drawHeight = wallpaper.Height;
        if (style == 2) {
            drawWidth = width;
            drawHeight = height;
        } else if (style == 6 || style == 10 || style == 22) {
            double xScale = width / wallpaper.Width, yScale = height / wallpaper.Height;
            double scale = style == 6 ? Math.Min(xScale, yScale) : Math.Max(xScale, yScale);
            drawWidth *= scale;
            drawHeight *= scale;
        }
        float left = (float)(area.Left + (width - drawWidth) / 2 - patch.x);
        float top = (float)(area.Top + (height - drawHeight) / 2 - patch.y);
        graphics.DrawImage(wallpaper, new RectangleF(left, top, (float)drawWidth, (float)drawHeight));
    }

    public static int Main(string[] args) {
        try {
            try { SetThreadDpiAwarenessContext(new IntPtr(-4)); }
            catch (EntryPointNotFoundException) { }
            if (args.Length != 1) throw new ArgumentException("Expected a JSON patch request");
            var serializer = new JavaScriptSerializer { MaxJsonLength = 8 * 1024 * 1024 };
            PatchRequest[] patches = serializer.Deserialize<PatchRequest[]>(args[0]);
            if (patches == null || patches.Length > 24) throw new ArgumentException("Too many patches");
            Rect monitor = PrimaryMonitor();
            string wallpaperPath = WallpaperPath();
            int style;
            if (!int.TryParse(RegistryText("WallpaperStyle", "10"), out style)) style = 10;
            bool tile = RegistryText("TileWallpaper", "0") == "1";
            Color background = BackgroundColor();
            Image wallpaper = null;
            try {
                if (wallpaperPath != null && new FileInfo(wallpaperPath).Length <= 100 * 1024 * 1024) {
                    wallpaper = Image.FromFile(wallpaperPath);
                }
                var results = new PatchResult[patches.Length];
                for (int i = 0; i < patches.Length; i++) {
                    PatchRequest patch = patches[i];
                    if (String.IsNullOrEmpty(patch.id) || patch.id.Length > 80 ||
                        patch.w < 1 || patch.h < 1 || patch.w > 512 || patch.h > 512 ||
                        patch.x < monitor.Left || patch.y < monitor.Top ||
                        (long)patch.x + patch.w > monitor.Right ||
                        (long)patch.y + patch.h > monitor.Bottom) {
                        throw new ArgumentException("Patch outside primary display");
                    }
                    using (var bitmap = new Bitmap(patch.w, patch.h, PixelFormat.Format24bppRgb))
                    using (var graphics = Graphics.FromImage(bitmap))
                    using (var stream = new MemoryStream()) {
                        graphics.Clear(background);
                        graphics.InterpolationMode = InterpolationMode.HighQualityBicubic;
                        graphics.PixelOffsetMode = PixelOffsetMode.HighQuality;
                        DrawWallpaper(graphics, wallpaper, patch, monitor, style, tile);
                        bitmap.Save(stream, ImageFormat.Png);
                        results[i] = new PatchResult { id = patch.id,
                            dataUrl = "data:image/png;base64," + Convert.ToBase64String(stream.ToArray()) };
                    }
                }
                Console.WriteLine(serializer.Serialize(results));
            } finally {
                if (wallpaper != null) wallpaper.Dispose();
            }
            return 0;
        } catch (Exception error) {
            Console.Error.WriteLine(error.Message);
            return 1;
        }
    }
}
