using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Web.Script.Serialization;
using System.Windows;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Windows.Threading;

namespace DeskAntsNativePreview
{
    internal sealed class AntState
    {
        public int Id;
        public double X, Y, Angle, ActionProgress, EntryProgress, DepartureProgress;
        public int Mode, Action, Carrying, Payload;
    }

    internal sealed class FoodState
    {
        public double X, Y, Total, Picked, Delivered;
    }

    internal sealed class TraceState
    {
        public double X, Y, Strength;
    }

    internal sealed class WorldState
    {
        public AntState[] Ants = new AntState[0];
        public FoodState[] Foods = new FoodState[0];
        public TraceState[] Explore = new TraceState[0];
        public TraceState[] FoodTrail = new TraceState[0];
        public int Discoveries, Trips;
        public double Elapsed;
    }

    internal sealed class VisualHost : FrameworkElement
    {
        private readonly DrawingVisual visual = new DrawingVisual();
        public Action<DrawingContext> Paint;

        public VisualHost()
        {
            AddVisualChild(visual);
            IsHitTestVisible = false;
        }

        protected override int VisualChildrenCount { get { return 1; } }
        protected override Visual GetVisualChild(int index)
        {
            if (index != 0) throw new ArgumentOutOfRangeException("index");
            return visual;
        }

        public void Redraw()
        {
            using (DrawingContext context = visual.RenderOpen())
            {
                if (Paint != null) Paint(context);
            }
        }
    }

    internal sealed class PreviewWindow : Window
    {
        private const int WsExTransparent = 0x20;
        private const int WsExToolWindow = 0x80;
        private const int WsExNoActivate = 0x08000000;
        private const int WmHotkey = 0x0312;
        private const uint ModControl = 0x0002;
        private const uint ModShift = 0x0004;
        private const int VkF10 = 0x79;
        private const int VkF11 = 0x7A;
        private const int VkF12 = 0x7B;

        [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")]
        private static extern IntPtr GetWindowLongPtr(IntPtr hwnd, int index);
        [DllImport("user32.dll", EntryPoint = "SetWindowLongPtrW")]
        private static extern IntPtr SetWindowLongPtr(IntPtr hwnd, int index, IntPtr value);
        [DllImport("user32.dll", SetLastError = true)]
        private static extern bool RegisterHotKey(IntPtr hwnd, int id, uint modifiers, int key);
        [DllImport("user32.dll")]
        private static extern bool UnregisterHotKey(IntPtr hwnd, int id);

        private readonly VisualHost host = new VisualHost();
        private readonly DispatcherTimer timer = new DispatcherTimer(DispatcherPriority.Render);
        private readonly JavaScriptSerializer serializer = new JavaScriptSerializer { MaxJsonLength = 4 * 1024 * 1024 };
        private readonly object stateLock = new object();
        private readonly Dictionary<int, Point> antPositions = new Dictionary<int, Point>();
        private readonly Dictionary<int, double> antAngles = new Dictionary<int, double>();
        private readonly List<double> cpuSamples = new List<double>();
        private readonly List<double> memorySamples = new List<double>();
        private readonly Stopwatch clock = Stopwatch.StartNew();
        private readonly double originX = SystemParameters.VirtualScreenLeft;
        private readonly double originY = SystemParameters.VirtualScreenTop;
        private readonly double screenWidth = SystemParameters.VirtualScreenWidth;
        private readonly double screenHeight = SystemParameters.VirtualScreenHeight;
        private readonly BitmapSource[,] antAtlas = new BitmapSource[9, 8];
        private readonly BitmapSource[] portalAtlas = new BitmapSource[12];
        private readonly BitmapSource[] foodAtlas = new BitmapSource[8];
        private readonly Brush[] exploreBrushes = new Brush[64];
        private readonly Brush[] foodBrushes = new Brush[64];
        private readonly Pen[] explorePens = new Pen[64];
        private readonly Pen[] foodPens = new Pen[64];
        private readonly Brush panelBrush;
        private readonly Brush panelBorder;
        private readonly Brush textBrush;
        private readonly Brush subTextBrush;
        private readonly Brush panelChip;
        private readonly Brush softShadow;
        private Process simulation;
        private Process self;
        private WorldState state = new WorldState();
        private WorldState pendingState;
        private double lastTickSeconds;
        private double lastCpuSeconds;
        private double lastSampleSeconds;
        private double cpuPercent;
        private double privateMiB;
        private int renderedFrames;
        private bool paused;
        private bool showPheromones = true;
        private bool registeredF10, registeredF11, registeredF12;
        private HwndSource hwndSource;
        private string rootPath;
        private string assetsPath;
        private Point portalCenter;

        public PreviewWindow()
        {
            rootPath = FindProjectRoot(AppDomain.CurrentDomain.BaseDirectory);
            assetsPath = Path.Combine(rootPath, "prototypes", "native-renderer", "assets");
            portalCenter = new Point(screenWidth - 92, screenHeight - 112);
            Width = screenWidth;
            Height = screenHeight;
            Left = originX;
            Top = originY;
            WindowStyle = WindowStyle.None;
            ResizeMode = ResizeMode.NoResize;
            AllowsTransparency = true;
            Background = Brushes.Transparent;
            ShowInTaskbar = false;
            Topmost = true;
            Focusable = false;
            Content = host;
            panelBrush = Frozen(new SolidColorBrush(Color.FromArgb(228, 240, 248, 238)));
            panelBorder = Frozen(new SolidColorBrush(Color.FromArgb(225, 85, 120, 91)));
            textBrush = Frozen(new SolidColorBrush(Color.FromRgb(31, 48, 36)));
            subTextBrush = Frozen(new SolidColorBrush(Color.FromRgb(67, 88, 71)));
            panelChip = Frozen(new SolidColorBrush(Color.FromArgb(195, 255, 255, 255)));
            softShadow = Frozen(new SolidColorBrush(Color.FromArgb(56, 0, 0, 0)));
            BuildBrushCaches();
            LoadAtlases();
            host.Paint = DrawFrame;
            timer.Interval = TimeSpan.FromMilliseconds(16);
            timer.Tick += OnFrame;
            SourceInitialized += OnSourceInitialized;
            Loaded += OnLoaded;
            Closed += OnClosed;
        }

        private static Brush Frozen(Brush brush)
        {
            brush.Freeze();
            return brush;
        }

        private static string FindProjectRoot(string start)
        {
            DirectoryInfo current = new DirectoryInfo(start);
            while (current != null)
            {
                if (File.Exists(Path.Combine(current.FullName, "renderer", "colony.js"))) return current.FullName;
                current = current.Parent;
            }
            throw new DirectoryNotFoundException("Could not locate renderer/colony.js above the preview executable.");
        }

        private void BuildBrushCaches()
        {
            for (int i = 0; i < 64; i++)
            {
                byte level = (byte)Math.Max(4, Math.Min(112, 16 + i * 1.5));
                exploreBrushes[i] = Frozen(new SolidColorBrush(Color.FromArgb(level, 0, 255, 246)));
                foodBrushes[i] = Frozen(new SolidColorBrush(Color.FromArgb((byte)Math.Min(150, level + 18), 255, 190, 53)));
                Pen ep = new Pen(exploreBrushes[i], 0.8 + i / 64.0);
                Pen fp = new Pen(foodBrushes[i], 0.8 + i / 64.0);
                ep.Freeze(); fp.Freeze(); explorePens[i] = ep; foodPens[i] = fp;
            }
        }

        private void LoadAtlases()
        {
            BitmapSource ants = LoadBitmap("ants.png");
            for (int row = 0; row < 9; row++)
                for (int phase = 0; phase < 8; phase++)
                    antAtlas[row, phase] = Crop(ants, phase * 38, row * 38, 38, 38);
            BitmapSource portal = LoadBitmap("portal.png");
            for (int i = 0; i < 12; i++) portalAtlas[i] = Crop(portal, i * 64, 0, 64, 64);
            BitmapSource food = LoadBitmap("snack.png");
            for (int i = 0; i < 8; i++) foodAtlas[i] = Crop(food, i * 64, 0, 64, 64);
        }

        private BitmapSource LoadBitmap(string name)
        {
            BitmapImage image = new BitmapImage();
            image.BeginInit();
            image.CacheOption = BitmapCacheOption.OnLoad;
            image.UriSource = new Uri(Path.Combine(assetsPath, name), UriKind.Absolute);
            image.EndInit();
            image.Freeze();
            return image;
        }

        private static BitmapSource Crop(BitmapSource source, int x, int y, int width, int height)
        {
            CroppedBitmap crop = new CroppedBitmap(source, new Int32Rect(x, y, width, height));
            crop.Freeze();
            return crop;
        }

        private void OnSourceInitialized(object sender, EventArgs args)
        {
            hwndSource = (HwndSource)PresentationSource.FromVisual(this);
            IntPtr hwnd = hwndSource.Handle;
            long style = GetWindowLongPtr(hwnd, -20).ToInt64();
            style |= WsExTransparent | WsExToolWindow | WsExNoActivate;
            SetWindowLongPtr(hwnd, -20, new IntPtr(style));
            hwndSource.AddHook(WindowHook);
            registeredF10 = RegisterHotKey(hwnd, 10, ModControl | ModShift, VkF10);
            registeredF11 = RegisterHotKey(hwnd, 11, ModControl | ModShift, VkF11);
            registeredF12 = RegisterHotKey(hwnd, 12, ModControl | ModShift, VkF12);
        }

        private IntPtr WindowHook(IntPtr hwnd, int message, IntPtr wParam, IntPtr lParam, ref bool handled)
        {
            if (message != WmHotkey) return IntPtr.Zero;
            int id = wParam.ToInt32();
            if (id == 10) paused = !paused;
            else if (id == 11) showPheromones = !showPheromones;
            else if (id == 12) Close();
            handled = true;
            return IntPtr.Zero;
        }

        private void OnLoaded(object sender, RoutedEventArgs args)
        {
            StartSimulation();
            self = Process.GetCurrentProcess();
            lastCpuSeconds = self.TotalProcessorTime.TotalSeconds;
            lastSampleSeconds = clock.Elapsed.TotalSeconds;
            lastTickSeconds = lastSampleSeconds;
            timer.Start();
        }

        private void StartSimulation()
        {
            string script = Path.Combine(rootPath, "prototypes", "native-renderer", "simulation.js");
            ProcessStartInfo info = new ProcessStartInfo();
            info.FileName = "node.exe";
            info.Arguments = Quote(script) + " " + Math.Max(640, (int)screenWidth).ToString(CultureInfo.InvariantCulture) +
                " " + Math.Max(480, (int)screenHeight).ToString(CultureInfo.InvariantCulture);
            info.WorkingDirectory = rootPath;
            info.UseShellExecute = false;
            info.CreateNoWindow = true;
            info.RedirectStandardOutput = true;
            info.RedirectStandardError = true;
            simulation = new Process { StartInfo = info, EnableRaisingEvents = true };
            simulation.OutputDataReceived += OnSimulationLine;
            simulation.ErrorDataReceived += delegate(object s, DataReceivedEventArgs e) { if (!String.IsNullOrEmpty(e.Data)) Debug.WriteLine(e.Data); };
            simulation.Start();
            simulation.BeginOutputReadLine();
            simulation.BeginErrorReadLine();
        }

        private static string Quote(string value) { return "\"" + value.Replace("\"", "\\\"") + "\""; }

        private void OnSimulationLine(object sender, DataReceivedEventArgs args)
        {
            if (String.IsNullOrEmpty(args.Data)) return;
            try
            {
                Dictionary<string, object> data = serializer.DeserializeObject(args.Data) as Dictionary<string, object>;
                if (data == null) return;
                WorldState next = new WorldState();
                next.Ants = ParseAnts(data["a"] as object[]);
                next.Foods = ParseFoods(data["f"] as object[]);
                next.Discoveries = Number(data, "d");
                next.Trips = Number(data, "t");
                next.Elapsed = NumberDouble(data, "e");
                if (data.ContainsKey("x")) next.Explore = ParseTraces(data["x"] as object[]);
                if (data.ContainsKey("p")) next.FoodTrail = ParseTraces(data["p"] as object[]);
                lock (stateLock) pendingState = next;
            }
            catch (Exception ex) { Debug.WriteLine("Native preview snapshot: " + ex.Message); }
        }

        private static int Number(Dictionary<string, object> data, string key)
        {
            return data.ContainsKey(key) ? (int)Convert.ToDouble(data[key], CultureInfo.InvariantCulture) : 0;
        }

        private static double NumberDouble(Dictionary<string, object> data, string key)
        {
            return data.ContainsKey(key) ? Convert.ToDouble(data[key], CultureInfo.InvariantCulture) : 0;
        }

        private static double Value(object[] row, int index)
        {
            return row != null && row.Length > index ? Convert.ToDouble(row[index], CultureInfo.InvariantCulture) : 0;
        }

        private static AntState[] ParseAnts(object[] rows)
        {
            if (rows == null) return new AntState[0];
            AntState[] result = new AntState[rows.Length];
            for (int i = 0; i < rows.Length; i++)
            {
                object[] row = rows[i] as object[];
                if (row == null || row.Length < 11) continue;
                result[i] = new AntState { Id = (int)Value(row, 0), X = Value(row, 1), Y = Value(row, 2),
                    Angle = Value(row, 3), Mode = (int)Value(row, 4), Action = (int)Value(row, 5),
                    ActionProgress = Value(row, 6), Carrying = (int)Value(row, 7), Payload = (int)Value(row, 8),
                    EntryProgress = Value(row, 9), DepartureProgress = Value(row, 10) };
            }
            return result;
        }

        private static FoodState[] ParseFoods(object[] rows)
        {
            if (rows == null) return new FoodState[0];
            FoodState[] result = new FoodState[rows.Length];
            for (int i = 0; i < rows.Length; i++)
            {
                object[] row = rows[i] as object[];
                result[i] = new FoodState { X = Value(row, 0), Y = Value(row, 1), Total = Value(row, 2),
                    Picked = Value(row, 3), Delivered = Value(row, 4) };
            }
            return result;
        }

        private static TraceState[] ParseTraces(object[] rows)
        {
            if (rows == null) return new TraceState[0];
            TraceState[] result = new TraceState[rows.Length];
            for (int i = 0; i < rows.Length; i++)
            {
                object[] row = rows[i] as object[];
                result[i] = new TraceState { X = Value(row, 0), Y = Value(row, 1), Strength = Value(row, 2) };
            }
            return result;
        }

        private void OnFrame(object sender, EventArgs args)
        {
            double now = clock.Elapsed.TotalSeconds;
            double dt = Math.Max(0.001, Math.Min(0.06, now - lastTickSeconds));
            lastTickSeconds = now;
            lock (stateLock)
            {
                if (pendingState != null)
                {
                    if (pendingState.Explore.Length == 0 && state.Explore.Length > 0) pendingState.Explore = state.Explore;
                    if (pendingState.FoodTrail.Length == 0 && state.FoodTrail.Length > 0) pendingState.FoodTrail = state.FoodTrail;
                    state = pendingState;
                    pendingState = null;
                }
            }
            SampleResources(now);
            if (!paused) renderedFrames++;
            host.Redraw();
        }

        private void SampleResources(double now)
        {
            if (now - lastSampleSeconds < 1) return;
            try
            {
                self.Refresh();
                double cpu = self.TotalProcessorTime.TotalSeconds;
                long memory = self.PrivateMemorySize64;
                if (simulation != null && !simulation.HasExited)
                {
                    simulation.Refresh();
                    cpu += simulation.TotalProcessorTime.TotalSeconds;
                    memory += simulation.PrivateMemorySize64;
                }
                double elapsed = now - lastSampleSeconds;
                cpuPercent = Math.Max(0, (cpu - lastCpuSeconds) / elapsed * 100.0);
                privateMiB = memory / 1048576.0;
                cpuSamples.Add(cpuPercent);
                memorySamples.Add(privateMiB);
                lastCpuSeconds = cpu;
                lastSampleSeconds = now;
            }
            catch { }
        }

        private void DrawFrame(DrawingContext dc)
        {
            double now = clock.Elapsed.TotalSeconds;
            if (showPheromones) DrawTraces(dc, state.Explore, exploreBrushes, explorePens, 0);
            if (showPheromones) DrawTraces(dc, state.FoodTrail, foodBrushes, foodPens, 1);
            DrawFood(dc, now);
            DrawPortal(dc, now);
            DrawAnts(dc, now);
            DrawPanel(dc);
        }

        private static void DrawTraces(DrawingContext dc, TraceState[] traces, Brush[] brushes, Pen[] pens, int kind)
        {
            if (traces == null) return;
            for (int i = 0; i < traces.Length; i++)
            {
                TraceState trace = traces[i];
                if (trace == null || trace.Strength <= 0.03) continue;
                int level = Math.Max(0, Math.Min(63, (int)(trace.Strength * 63)));
                double radius = (kind == 0 ? 2.3 : 2.7) + trace.Strength * 1.8;
                dc.DrawEllipse(brushes[level], pens[level], new Point(trace.X, trace.Y), radius, radius);
            }
        }

        private void DrawFood(DrawingContext dc, double now)
        {
            for (int i = 0; i < state.Foods.Length; i++)
            {
                FoodState food = state.Foods[i];
                double left = food.X - 27, top = food.Y - 27;
                int frame = ((int)(now * 5 + i * 2)) % foodAtlas.Length;
                dc.DrawImage(foodAtlas[frame], new Rect(left, top, 54, 54));
                double remaining = food.Total > 0 ? Math.Max(0.25, 1 - food.Picked / food.Total) : 1;
                if (remaining < 0.99)
                {
                    double arc = 2 * Math.PI * remaining;
                    Pen ring = new Pen(new SolidColorBrush(Color.FromArgb(205, 255, 222, 107)), 1.5);
                    ring.Freeze();
                    dc.DrawEllipse(null, ring, new Point(food.X, food.Y), 31, 31);
                }
            }
        }

        private void DrawPortal(DrawingContext dc, double now)
        {
            int frame = ((int)(now * 10)) % portalAtlas.Length;
            dc.DrawImage(portalAtlas[frame], new Rect(portalCenter.X - 42, portalCenter.Y - 42, 84, 84));
        }

        private void DrawAnts(DrawingContext dc, double now)
        {
            for (int i = 0; i < state.Ants.Length; i++)
            {
                AntState ant = state.Ants[i];
                if (ant == null) continue;
                Point current;
                if (!antPositions.TryGetValue(ant.Id, out current)) current = new Point(ant.X, ant.Y);
                double blend = 1 - Math.Exp(-Math.Max(0.001, 1.0 / 60.0) * 24);
                current.X += (ant.X - current.X) * blend;
                current.Y += (ant.Y - current.Y) * blend;
                antPositions[ant.Id] = current;
                double angle;
                if (!antAngles.TryGetValue(ant.Id, out angle)) angle = ant.Angle;
                double delta = Math.Atan2(Math.Sin(ant.Angle - angle), Math.Cos(ant.Angle - angle));
                angle += Math.Max(-0.24, Math.Min(0.24, delta));
                antAngles[ant.Id] = angle;

                Point drawAt = current;
                double scale = 1, alpha = 1;
                if (ant.Mode == 3)
                {
                    double eased = Smooth(ant.EntryProgress);
                    drawAt = new Point(current.X + (portalCenter.X - current.X) * eased,
                        current.Y + (portalCenter.Y - current.Y) * eased);
                    scale = 1 - eased * 0.78;
                    alpha = 1 - Math.Pow(ant.EntryProgress, 1.6);
                }
                else if (ant.DepartureProgress < 0.999)
                {
                    double eased = Smooth(ant.DepartureProgress);
                    double amount = 1 - eased;
                    drawAt = new Point(current.X + (portalCenter.X - current.X) * amount,
                        current.Y + (portalCenter.Y - current.Y) * amount);
                    scale = 1 - amount * 0.78;
                    alpha = Math.Sin(ant.DepartureProgress * Math.PI / 2);
                }
                int phase = ((int)(now * 9 + ant.Id * 2.1)) & 7;
                int row = ant.Action >= 0 ? ant.Action : ant.Mode == 3 ? 8 :
                    ant.Carrying != 0 ? (ant.Payload == 2 ? 2 : 1) : ant.Mode == 0 ? 0 : 6;
                dc.PushOpacity(Math.Max(0, Math.Min(1, alpha)));
                dc.PushTransform(new TranslateTransform(drawAt.X, drawAt.Y));
                dc.PushTransform(new RotateTransform(angle * 180 / Math.PI));
                dc.DrawImage(antAtlas[row, phase], new Rect(-19 * scale, -19 * scale, 38 * scale, 38 * scale));
                dc.Pop(); dc.Pop(); dc.Pop();
            }
        }

        private static double Smooth(double value)
        {
            value = Math.Max(0, Math.Min(1, value));
            return value * value * (3 - 2 * value);
        }

        private void DrawPanel(DrawingContext dc)
        {
            Rect rect = new Rect(22, 22, 294, 176);
            dc.DrawRoundedRectangle(softShadow, null, new Rect(rect.X + 2, rect.Y + 4, rect.Width, rect.Height), 12, 12);
            dc.DrawRoundedRectangle(panelBrush, new Pen(panelBorder, 1), rect, 12, 12);
            dc.DrawRoundedRectangle(new SolidColorBrush(Color.FromArgb(73, 177, 233, 105)), null,
                new Rect(rect.X + 1, rect.Y + 1, rect.Width - 2, 42), 11, 11);
            DrawText(dc, "蚁群", 38, 31, 20, textBrush, true);
            DrawText(dc, "原生绘制预览  ·  真实算法", 99, 38, 10, subTextBrush, false);
            DrawText(dc, "36 只蚂蚁    2 份模拟文件食物", 38, 78, 12, textBrush, true);
            DrawText(dc, "发现 " + state.Discoveries + "    送达 " + state.Trips + " 次", 38, 102, 11, subTextBrush, false);
            DrawLegendDot(dc, 39, 127, Color.FromRgb(80, 255, 250));
            DrawText(dc, "探索信息素", 49, 121, 10, subTextBrush, false);
            DrawLegendDot(dc, 131, 127, Color.FromRgb(255, 218, 74));
            DrawText(dc, "食物信息素", 141, 121, 10, subTextBrush, false);
            DrawText(dc, (paused ? "已暂停" : "运行中") + "    " + privateMiB.ToString("F0", CultureInfo.InvariantCulture) +
                " MiB    " + cpuPercent.ToString("F1", CultureInfo.InvariantCulture) + "% CPU", 38, 146, 10, textBrush, true);
            DrawText(dc, "Ctrl+Shift+F10 暂停    F11 信息素    F12 退出", 38, 173, 9, subTextBrush, false);
            DrawText(dc, "模拟数据，不读取或删除真实文件", 38, 188, 9, subTextBrush, false);
        }

        private void DrawLegendDot(DrawingContext dc, double x, double y, Color color)
        {
            Brush brush = Frozen(new SolidColorBrush(color));
            dc.DrawEllipse(brush, null, new Point(x, y), 3.3, 3.3);
        }

        private static void DrawText(DrawingContext dc, string value, double x, double y, double size, Brush brush, bool bold)
        {
            FormattedText text = new FormattedText(value, CultureInfo.GetCultureInfo("zh-CN"), FlowDirection.LeftToRight,
                new Typeface(new FontFamily("Microsoft YaHei UI"), FontStyles.Normal,
                    bold ? FontWeights.SemiBold : FontWeights.Normal, FontStretches.Normal), size, brush,
                VisualTreeHelper.GetDpi(Application.Current.MainWindow).PixelsPerDip);
            dc.DrawText(text, new Point(x, y));
        }

        private void OnClosed(object sender, EventArgs args)
        {
            timer.Stop();
            if (hwndSource != null)
            {
                if (registeredF10) UnregisterHotKey(hwndSource.Handle, 10);
                if (registeredF11) UnregisterHotKey(hwndSource.Handle, 11);
                if (registeredF12) UnregisterHotKey(hwndSource.Handle, 12);
            }
            if (simulation != null)
            {
                try { simulation.Kill(); simulation.WaitForExit(1000); } catch { }
                simulation.Dispose();
            }
            WriteReport();
        }

        private void WriteReport()
        {
            try
            {
                string diagnostics = Path.Combine(rootPath, "diagnostics");
                Directory.CreateDirectory(diagnostics);
                Dictionary<string, object> report = new Dictionary<string, object>();
                report["durationSeconds"] = clock.Elapsed.TotalSeconds;
                report["renderedFrames"] = renderedFrames;
                report["privateMiBSamples"] = memorySamples.ToArray();
                report["cpuPercentSamples"] = cpuSamples.ToArray();
                report["privateMiBMean"] = Mean(memorySamples);
                report["privateMiBPeak"] = memorySamples.Count == 0 ? 0 : Max(memorySamples);
                report["cpuPercentMean"] = Mean(cpuSamples);
                report["measurement"] = "WPF transparent layered preview + Node colony.js process; synthetic obstacles and fake files; no real file I/O. Not a Direct2D/DirectComposition result.";
                File.WriteAllText(Path.Combine(diagnostics, "native-preview-session.json"),
                    serializer.Serialize(report), Encoding.UTF8);
            }
            catch (Exception ex) { Debug.WriteLine("Could not write native preview metrics: " + ex.Message); }
        }

        private static double Mean(List<double> values)
        {
            if (values.Count == 0) return 0;
            double total = 0;
            for (int i = 0; i < values.Count; i++) total += values[i];
            return total / values.Count;
        }

        private static double Max(List<double> values)
        {
            double result = 0;
            for (int i = 0; i < values.Count; i++) result = Math.Max(result, values[i]);
            return result;
        }
    }

    internal static class Program
    {
        [STAThread]
        private static void Main()
        {
            Application application = new Application { ShutdownMode = ShutdownMode.OnMainWindowClose };
            PreviewWindow window = new PreviewWindow();
            application.MainWindow = window;
            window.Show();
            application.Run();
        }
    }
}
