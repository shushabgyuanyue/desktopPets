using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Web.Script.Serialization;
using SharpDX;
using SharpDX.Direct2D1;
using SharpDX.DirectComposition;
using SharpDX.DirectWrite;
using SharpDX.DXGI;
using SharpDX.Mathematics.Interop;
using SharpDX.Direct3D;
using SharpDX.Direct3D11;
using GdiBitmap = System.Drawing.Bitmap;
using GdiGraphics = System.Drawing.Graphics;
using GdiPixelFormat = System.Drawing.Imaging.PixelFormat;
using GdiImageLockMode = System.Drawing.Imaging.ImageLockMode;
using D3DDevice = SharpDX.Direct3D11.Device;

namespace DeskAntsDirect2DPreview
{
    internal sealed class AntState
    {
        public int Id, Mode, Action, Carrying, Payload;
        public double X, Y, Angle, EntryProgress, DepartureProgress;
    }

    internal sealed class FoodState
    {
        public double X, Y, Total, Picked, Delivered;
    }

    internal sealed class TraceState
    {
        public double X, Y, Strength;
    }

    internal struct Position
    {
        public double X, Y;
        public Position(double x, double y) { X = x; Y = y; }
    }

    internal sealed class WorldState
    {
        public AntState[] Ants = new AntState[0];
        public FoodState[] Foods = new FoodState[0];
        public TraceState[] Explore = new TraceState[0];
        public TraceState[] FoodTrail = new TraceState[0];
        public int Discoveries, Trips;
        public bool TrailsChanged;
    }

    internal sealed class Program
    {
        private const int WsExTopmost = 0x00000008;
        private const int WsExTransparent = 0x00000020;
        private const int WsExToolWindow = 0x00000080;
        private const int WsExLayered = 0x00080000;
        private const int WsExNoActivate = 0x08000000;
        private const int WsPopup = unchecked((int)0x80000000);
        private const int WmDestroy = 0x0002;
        private const int WmTimer = 0x0113;
        private const int WmHotkey = 0x0312;
        private const uint ModControl = 0x0002;
        private const uint ModShift = 0x0004;
        private const int VkF10 = 0x79;
        private const int VkF11 = 0x7A;
        private const int VkF12 = 0x7B;
        private const int SwShowNa = 8;
        private const uint SmCxVirtualScreen = 78;
        private const uint SmCyVirtualScreen = 79;
        private const uint SmXVirtualScreen = 76;
        private const uint SmYVirtualScreen = 77;
        private const uint SwpNoActivate = 0x0010;
        private const uint SwpShowWindow = 0x0040;
        private const uint TimerId = 1;

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        private struct WindowClass
        {
            public uint Size, Style;
            public WindowProcedure Procedure;
            public int ClassExtra, WindowExtra;
            public IntPtr Instance, Icon, Cursor, Background;
            public string MenuName, ClassName;
            public IntPtr SmallIcon;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct Message
        {
            public IntPtr Hwnd;
            public uint Id;
            public UIntPtr WParam;
            public IntPtr LParam;
            public uint Time;
            public int X, Y;
        }

        private delegate IntPtr WindowProcedure(IntPtr hwnd, uint message, UIntPtr wParam, IntPtr lParam);
        [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern ushort RegisterClassEx(ref WindowClass value);
        [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern IntPtr CreateWindowEx(int exStyle, string className, string title, int style,
            int x, int y, int width, int height, IntPtr parent, IntPtr menu, IntPtr instance, IntPtr parameter);
        [DllImport("user32.dll", SetLastError = true)] private static extern bool DestroyWindow(IntPtr hwnd);
        [DllImport("user32.dll", SetLastError = true)] private static extern bool ShowWindow(IntPtr hwnd, int command);
        [DllImport("user32.dll", SetLastError = true)] private static extern bool SetWindowPos(IntPtr hwnd, IntPtr insertAfter,
            int x, int y, int width, int height, uint flags);
        [DllImport("user32.dll", SetLastError = true)] private static extern bool RegisterHotKey(IntPtr hwnd, int id, uint modifiers, int key);
        [DllImport("user32.dll")] private static extern bool UnregisterHotKey(IntPtr hwnd, int id);
        [DllImport("user32.dll", SetLastError = true)] private static extern UIntPtr SetTimer(IntPtr hwnd, UIntPtr id, uint milliseconds, IntPtr callback);
        [DllImport("user32.dll")] private static extern bool KillTimer(IntPtr hwnd, UIntPtr id);
        [DllImport("user32.dll")] private static extern int GetMessage(out Message message, IntPtr hwnd, uint min, uint max);
        [DllImport("user32.dll")] private static extern bool TranslateMessage(ref Message message);
        [DllImport("user32.dll")] private static extern IntPtr DispatchMessage(ref Message message);
        [DllImport("user32.dll")] private static extern IntPtr DefWindowProc(IntPtr hwnd, uint message, UIntPtr wParam, IntPtr lParam);
        [DllImport("user32.dll")] private static extern void PostQuitMessage(int exitCode);
        [DllImport("user32.dll")] private static extern int GetSystemMetrics(uint index);
        [DllImport("user32.dll")] private static extern uint GetDpiForSystem();
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int MessageBox(IntPtr hwnd, string text, string caption, uint type);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] private static extern IntPtr GetModuleHandle(string name);

        private static Program current;
        private readonly object stateLock = new object();
        private readonly JavaScriptSerializer serializer = new JavaScriptSerializer { MaxJsonLength = 4 * 1024 * 1024 };
        private readonly Stopwatch clock = Stopwatch.StartNew();
        private readonly Dictionary<int, Position> antPositions = new Dictionary<int, Position>();
        private readonly Dictionary<int, double> antAngles = new Dictionary<int, double>();
        private readonly List<double> cpuSamples = new List<double>();
        private readonly List<double> memorySamples = new List<double>();
        private readonly List<Bitmap1> resources = new List<Bitmap1>();
        private readonly Brush[] exploration = new Brush[64];
        private readonly Brush[] foodTrail = new Brush[64];
        private readonly Brush[] textBrush = new Brush[2];
        private readonly Brush[] panelBrush = new Brush[4];
        private Brush panelStroke;
        private readonly TextFormat titleFormat;
        private readonly TextFormat normalFormat;
        private readonly TextFormat smallFormat;
        private readonly string rootPath;
        private readonly string assetsPath;
        private readonly double scale;
        private readonly double logicalWidth;
        private readonly double logicalHeight;
        private readonly double originX;
        private readonly double originY;
        private readonly int pixelWidth;
        private readonly int pixelHeight;
        private readonly Position portalCenter;
        private readonly Stopwatch renderClock = Stopwatch.StartNew();
        private D3DDevice d3dDevice;
        private SharpDX.DXGI.Device dxgiDevice;
        private SharpDX.DXGI.Factory2 dxgiFactory;
        private SharpDX.Direct2D1.Factory1 d2dFactory;
        private SharpDX.Direct2D1.Device d2dDevice;
        private SharpDX.Direct2D1.DeviceContext d2dContext;
        private SharpDX.DirectComposition.Device compositionDevice;
        private SharpDX.DirectComposition.Target compositionTarget;
        private SharpDX.DirectComposition.Visual compositionVisual;
        private SwapChain1 swapChain;
        private SharpDX.DXGI.Surface backBuffer;
        private Bitmap1 targetBitmap;
        private Bitmap1 trailBitmap;
        private Bitmap1 antImage, foodImage, portalImage;
        private SharpDX.DirectWrite.Factory writeFactory;
        private GdiBitmap antPixels, foodPixels, portalPixels;
        private Process simulation, self;
        private IntPtr hwnd;
        private WindowProcedure procedure;
        private WorldState state = new WorldState(), pendingState;
        private double lastCpuSeconds, lastSampleSeconds, cpuPercent, privateMiB;
        private int renderedFrames;
        private bool paused, showPheromones = true;

        private Program()
        {
            rootPath = FindProjectRoot(AppDomain.CurrentDomain.BaseDirectory);
            assetsPath = Path.Combine(rootPath, "prototypes", "native-renderer", "assets");
            int dpi = GetDpi();
            scale = dpi / 96.0;
            pixelWidth = Math.Max(640, GetSystemMetrics(SmCxVirtualScreen));
            pixelHeight = Math.Max(480, GetSystemMetrics(SmCyVirtualScreen));
            logicalWidth = pixelWidth / scale;
            logicalHeight = pixelHeight / scale;
            originX = GetSystemMetrics(SmXVirtualScreen);
            originY = GetSystemMetrics(SmYVirtualScreen);
            portalCenter = new Position(logicalWidth - 92, logicalHeight - 112);
            string fontName = "Microsoft YaHei UI";
            writeFactory = new SharpDX.DirectWrite.Factory();
            titleFormat = new TextFormat(writeFactory, fontName, FontWeight.SemiBold, FontStyle.Normal, 20);
            normalFormat = new TextFormat(writeFactory, fontName, FontWeight.Normal, FontStyle.Normal, 12);
            smallFormat = new TextFormat(writeFactory, fontName, FontWeight.Normal, FontStyle.Normal, 10);
            BuildResources();
        }

        [STAThread]
        private static void Main()
        {
            current = new Program();
            try { current.Run(); }
            catch (Exception ex)
            {
                current.WriteError(ex.ToString());
                MessageBox(IntPtr.Zero, "Direct2D 预览启动失败。诊断信息已写入本地临时目录。\n" + ex.Message,
                    "蚁群原生绘制预览", 0x10);
            }
            finally { if (current != null) current.Dispose(); }
        }

        private void Run()
        {
            CreateOverlayWindow();
            CreateGraphicsPipeline();
            StartSimulation();
            self = Process.GetCurrentProcess();
            lastCpuSeconds = self.TotalProcessorTime.TotalSeconds;
            lastSampleSeconds = clock.Elapsed.TotalSeconds;
            SetTimer(hwnd, new UIntPtr(TimerId), 1, IntPtr.Zero);
            ShowWindow(hwnd, SwShowNa);
            SetWindowPos(hwnd, new IntPtr(-1), (int)originX, (int)originY, pixelWidth, pixelHeight, SwpNoActivate | SwpShowWindow);
            Message message;
            while (GetMessage(out message, IntPtr.Zero, 0, 0) > 0)
            {
                TranslateMessage(ref message);
                DispatchMessage(ref message);
            }
        }

        private void CreateOverlayWindow()
        {
            string className = "DeskAntsDCompPreview" + Process.GetCurrentProcess().Id;
            procedure = WindowProc;
            WindowClass klass = new WindowClass();
            klass.Size = (uint)Marshal.SizeOf(typeof(WindowClass));
            klass.Procedure = procedure;
            klass.Instance = GetModuleHandle(null);
            klass.Cursor = LoadCursor(IntPtr.Zero, new IntPtr(32512));
            klass.ClassName = className;
            if (RegisterClassEx(ref klass) == 0) throw new InvalidOperationException("RegisterClassEx failed: " + Marshal.GetLastWin32Error());
            int exStyle = WsExTopmost | WsExTransparent | WsExToolWindow | WsExLayered | WsExNoActivate;
            hwnd = CreateWindowEx(exStyle, className, "Ants Native Preview", WsPopup,
                (int)originX, (int)originY, pixelWidth, pixelHeight, IntPtr.Zero, IntPtr.Zero, klass.Instance, IntPtr.Zero);
            if (hwnd == IntPtr.Zero) throw new InvalidOperationException("CreateWindowEx failed: " + Marshal.GetLastWin32Error());
            RegisterHotKey(hwnd, 10, ModControl | ModShift, VkF10);
            RegisterHotKey(hwnd, 11, ModControl | ModShift, VkF11);
            RegisterHotKey(hwnd, 12, ModControl | ModShift, VkF12);
        }

        [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern IntPtr LoadCursor(IntPtr instance, IntPtr cursorName);

        private IntPtr WindowProc(IntPtr window, uint message, UIntPtr wParam, IntPtr lParam)
        {
            if (message == WmTimer && wParam.ToUInt32() == TimerId)
            {
                try { RenderFrame(); }
                catch (Exception ex) { WriteError(ex.ToString()); PostQuitMessage(1); }
                return IntPtr.Zero;
            }
            if (message == WmHotkey)
            {
                int id = unchecked((int)wParam.ToUInt32());
                if (id == 10)
                {
                    paused = !paused;
                    try { simulation.StandardInput.WriteLine(paused ? "pause" : "resume"); } catch { }
                }
                else if (id == 11) showPheromones = !showPheromones;
                else if (id == 12) PostQuitMessage(0);
                return IntPtr.Zero;
            }
            if (message == WmDestroy) { PostQuitMessage(0); return IntPtr.Zero; }
            return DefWindowProc(window, message, wParam, lParam);
        }

        private void CreateGraphicsPipeline()
        {
            d3dDevice = new D3DDevice(DriverType.Hardware, DeviceCreationFlags.BgraSupport);
            dxgiDevice = d3dDevice.QueryInterface<SharpDX.DXGI.Device>();
            Adapter adapter = dxgiDevice.Adapter;
            dxgiFactory = adapter.GetParent<SharpDX.DXGI.Factory2>();
            d2dFactory = new SharpDX.Direct2D1.Factory1(SharpDX.Direct2D1.FactoryType.SingleThreaded, DebugLevel.None);
            d2dDevice = new SharpDX.Direct2D1.Device(d2dFactory, dxgiDevice);
            d2dContext = new SharpDX.Direct2D1.DeviceContext(d2dDevice, DeviceContextOptions.None);
            d2dContext.DotsPerInch = new Size2F((float)(96 * scale), (float)(96 * scale));
            d2dContext.AntialiasMode = AntialiasMode.PerPrimitive;

            compositionDevice = new SharpDX.DirectComposition.Device(dxgiDevice);
            MethodInfo createTarget = compositionDevice.GetType().GetMethod("CreateTargetForHwnd", BindingFlags.Instance | BindingFlags.NonPublic);
            object[] targetArguments = new object[] { hwnd, new RawBool(true), null };
            createTarget.Invoke(compositionDevice, targetArguments);
            compositionTarget = (SharpDX.DirectComposition.Target)targetArguments[2];
            compositionVisual = new SharpDX.DirectComposition.Visual(compositionDevice);

            SwapChainDescription1 description = new SwapChainDescription1();
            description.Width = pixelWidth;
            description.Height = pixelHeight;
            description.Format = Format.B8G8R8A8_UNorm;
            description.Stereo = false;
            description.SampleDescription = new SampleDescription(1, 0);
            description.Usage = Usage.RenderTargetOutput;
            description.BufferCount = 2;
            description.Scaling = Scaling.Stretch;
            description.SwapEffect = SwapEffect.FlipSequential;
            description.AlphaMode = SharpDX.DXGI.AlphaMode.Premultiplied;
            description.Flags = SwapChainFlags.None;
            swapChain = new SwapChain1(dxgiFactory, d3dDevice, ref description, null);

            compositionVisual.Content = swapChain;
            compositionTarget.Root = compositionVisual;
            compositionDevice.Commit();
            backBuffer = swapChain.GetBackBuffer<SharpDX.DXGI.Surface>(0);
            BitmapProperties1 targetProperties = new BitmapProperties1(
                new PixelFormat(Format.B8G8R8A8_UNorm, SharpDX.Direct2D1.AlphaMode.Premultiplied),
                (float)(96 * scale), (float)(96 * scale), BitmapOptions.Target | BitmapOptions.CannotDraw);
            targetBitmap = new Bitmap1(d2dContext, backBuffer, targetProperties);
            d2dContext.Target = targetBitmap;
            BitmapProperties1 trailProperties = new BitmapProperties1(
                new PixelFormat(Format.B8G8R8A8_UNorm, SharpDX.Direct2D1.AlphaMode.Premultiplied),
                (float)(96 * scale), (float)(96 * scale), BitmapOptions.Target);
            trailBitmap = new Bitmap1(d2dContext, new Size2(pixelWidth, pixelHeight), trailProperties);
            LoadImages();
            CreateBrushes();
        }

        private static object InvokeInternal(object instance, string method, object[] arguments)
        {
            MethodInfo info = instance.GetType().GetMethod(method, BindingFlags.Instance | BindingFlags.NonPublic);
            if (info == null) throw new MissingMethodException(instance.GetType().FullName, method);
            return info.Invoke(instance, arguments);
        }

        private void BuildResources()
        {
            // The screen-space brushes are reused for every frame; no full-screen CPU bitmap is allocated.
        }

        private void CreateBrushes()
        {
            for (int i = 0; i < 64; i++)
            {
                float strength = i / 63f;
                exploration[i] = new SolidColorBrush(d2dContext, new RawColor4(0.05f, 1f, 0.96f, 0.05f + strength * 0.34f));
                foodTrail[i] = new SolidColorBrush(d2dContext, new RawColor4(1f, 0.72f, 0.18f, 0.07f + strength * 0.45f));
            }
            textBrush[0] = new SolidColorBrush(d2dContext, new RawColor4(0.12f, 0.19f, 0.14f, 1f));
            textBrush[1] = new SolidColorBrush(d2dContext, new RawColor4(0.28f, 0.36f, 0.29f, 1f));
            panelBrush[0] = new SolidColorBrush(d2dContext, new RawColor4(0.91f, 0.96f, 0.92f, 0.91f));
            panelBrush[1] = new SolidColorBrush(d2dContext, new RawColor4(0.69f, 0.90f, 0.47f, 0.29f));
            panelBrush[2] = new SolidColorBrush(d2dContext, new RawColor4(1f, 1f, 1f, 0.72f));
            panelBrush[3] = new SolidColorBrush(d2dContext, new RawColor4(0, 0, 0, 0.18f));
            panelStroke = new SolidColorBrush(d2dContext, new RawColor4(0.33f, 0.47f, 0.36f, 0.88f));
        }

        private void LoadImages()
        {
            antPixels = new GdiBitmap(Path.Combine(assetsPath, "ants.png"));
            foodPixels = new GdiBitmap(Path.Combine(assetsPath, "snack.png"));
            portalPixels = new GdiBitmap(Path.Combine(assetsPath, "portal.png"));
            antImage = UploadBitmap(antPixels);
            foodImage = UploadBitmap(foodPixels);
            portalImage = UploadBitmap(portalPixels);
        }

        private Bitmap1 UploadBitmap(GdiBitmap source)
        {
            GdiBitmap converted = new GdiBitmap(source.Width, source.Height, GdiPixelFormat.Format32bppPArgb);
            using (GdiGraphics graphics = GdiGraphics.FromImage(converted)) graphics.DrawImageUnscaled(source, 0, 0);
            System.Drawing.Imaging.BitmapData data = converted.LockBits(
                new System.Drawing.Rectangle(0, 0, converted.Width, converted.Height), GdiImageLockMode.ReadOnly,
                GdiPixelFormat.Format32bppPArgb);
            try
            {
                int length = Math.Abs(data.Stride) * data.Height;
                byte[] pixels = new byte[length];
                Marshal.Copy(data.Scan0, pixels, 0, length);
                DataStream stream = new DataStream(length, true, true);
                stream.Write(pixels, 0, pixels.Length);
                stream.Position = 0;
                PixelFormat pixelFormat = new PixelFormat(Format.B8G8R8A8_UNorm, SharpDX.Direct2D1.AlphaMode.Premultiplied);
                BitmapProperties1 properties = new BitmapProperties1(pixelFormat, (float)(96 * scale), (float)(96 * scale));
                Bitmap1 bitmap = new Bitmap1(d2dContext, new Size2(converted.Width, converted.Height), stream, data.Stride, properties);
                stream.Dispose();
                resources.Add(bitmap);
                return bitmap;
            }
            finally { converted.UnlockBits(data); converted.Dispose(); }
        }

        private void StartSimulation()
        {
            string script = Path.Combine(rootPath, "prototypes", "native-renderer", "simulation.js");
            ProcessStartInfo info = new ProcessStartInfo();
            info.FileName = "node.exe";
            info.Arguments = Quote(script) + " " + logicalWidth.ToString(CultureInfo.InvariantCulture) +
                " " + logicalHeight.ToString(CultureInfo.InvariantCulture);
            info.WorkingDirectory = rootPath;
            info.UseShellExecute = false;
            info.CreateNoWindow = true;
            info.RedirectStandardOutput = true;
            info.RedirectStandardError = true;
            info.RedirectStandardInput = true;
            simulation = new Process { StartInfo = info, EnableRaisingEvents = true };
            simulation.OutputDataReceived += OnSimulationLine;
            simulation.ErrorDataReceived += delegate(object s, DataReceivedEventArgs e) { if (!String.IsNullOrEmpty(e.Data)) WriteError(e.Data); };
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
                if (data.ContainsKey("x")) { next.Explore = ParseTraces(data["x"] as object[]); next.TrailsChanged = true; }
                if (data.ContainsKey("p")) { next.FoodTrail = ParseTraces(data["p"] as object[]); next.TrailsChanged = true; }
                lock (stateLock) pendingState = next;
            }
            catch (Exception ex) { WriteError("Snapshot parse: " + ex); }
        }

        private static int Number(Dictionary<string, object> data, string key)
        {
            return data.ContainsKey(key) ? (int)Convert.ToDouble(data[key], CultureInfo.InvariantCulture) : 0;
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
                    Carrying = (int)Value(row, 7), Payload = (int)Value(row, 8),
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

        private void RenderFrame()
        {
            bool rebuildTrails = false;
            lock (stateLock)
            {
                if (pendingState != null)
                {
                    rebuildTrails = pendingState.TrailsChanged;
                    if (pendingState.Explore.Length == 0) pendingState.Explore = state.Explore;
                    if (pendingState.FoodTrail.Length == 0) pendingState.FoodTrail = state.FoodTrail;
                    state = pendingState;
                    pendingState = null;
                }
            }
            if (rebuildTrails) RebuildTrailTexture();
            SampleResources();
            d2dContext.BeginDraw();
            d2dContext.Clear(new RawColor4(0, 0, 0, 0));
            if (showPheromones) d2dContext.DrawBitmap(trailBitmap,
                new RawRectangleF(0, 0, (float)logicalWidth, (float)logicalHeight), 1f,
                SharpDX.Direct2D1.InterpolationMode.Linear,
                new RawRectangleF(0, 0, pixelWidth, pixelHeight), null);
            DrawFoods();
            DrawPortal();
            DrawAnts();
            DrawPanel();
            d2dContext.EndDraw();
            swapChain.Present(1, PresentFlags.None);
            renderedFrames++;
        }

        private void RebuildTrailTexture()
        {
            d2dContext.Target = trailBitmap;
            d2dContext.BeginDraw();
            d2dContext.Clear(new RawColor4(0, 0, 0, 0));
            DrawTraces(state.Explore, exploration, 0);
            DrawTraces(state.FoodTrail, foodTrail, 1);
            d2dContext.EndDraw();
            d2dContext.Target = targetBitmap;
        }

        private void DrawTraces(TraceState[] traces, Brush[] palette, int kind)
        {
            if (traces == null) return;
            for (int i = 0; i < traces.Length; i++)
            {
                TraceState trace = traces[i];
                if (trace == null || trace.Strength <= 0.03) continue;
                int level = Math.Max(0, Math.Min(63, (int)(trace.Strength * 63)));
                float radius = (kind == 0 ? 2.3f : 2.7f) + (float)trace.Strength * 1.8f;
                d2dContext.FillEllipse(new Ellipse(new RawVector2((float)trace.X, (float)trace.Y), radius, radius), palette[level]);
            }
        }

        private void DrawFoods()
        {
            double now = renderClock.Elapsed.TotalSeconds;
            for (int i = 0; i < state.Foods.Length; i++)
            {
                FoodState food = state.Foods[i];
                int phase = ((int)(now * 5 + i * 2)) % 8;
                RawRectangleF source = new RawRectangleF(phase * 64, 0, phase * 64 + 64, 64);
                RawRectangleF dest = new RawRectangleF((float)food.X - 27, (float)food.Y - 27,
                    (float)food.X + 27, (float)food.Y + 27);
                d2dContext.DrawBitmap(foodImage, dest, 1f, SharpDX.Direct2D1.InterpolationMode.Linear, source, null);
                double remaining = food.Total > 0 ? Math.Max(0.25, 1 - food.Picked / food.Total) : 1;
                if (remaining < 0.99)
                {
                    float alpha = (float)Math.Max(0.18, Math.Min(0.8, remaining));
                    d2dContext.DrawEllipse(new Ellipse(new RawVector2((float)food.X, (float)food.Y), 31, 31),
                        foodTrail[45], 1.4f);
                }
            }
        }

        private void DrawPortal()
        {
            double now = renderClock.Elapsed.TotalSeconds;
            int phase = ((int)(now * 10)) % 12;
            RawRectangleF source = new RawRectangleF(phase * 64, 0, phase * 64 + 64, 64);
            RawRectangleF dest = new RawRectangleF((float)portalCenter.X - 42, (float)portalCenter.Y - 42,
                (float)portalCenter.X + 42, (float)portalCenter.Y + 42);
            d2dContext.DrawBitmap(portalImage, dest, 1f, SharpDX.Direct2D1.InterpolationMode.Linear, source, null);
        }

        private void DrawAnts()
        {
            double now = renderClock.Elapsed.TotalSeconds;
            for (int i = 0; i < state.Ants.Length; i++)
            {
                AntState ant = state.Ants[i];
                if (ant == null) continue;
                Position current;
                if (!antPositions.TryGetValue(ant.Id, out current)) current = new Position(ant.X, ant.Y);
                double blend = 1 - Math.Exp(-1.0 / 60 * 24);
                current.X += (ant.X - current.X) * blend;
                current.Y += (ant.Y - current.Y) * blend;
                antPositions[ant.Id] = current;
                double angle;
                if (!antAngles.TryGetValue(ant.Id, out angle)) angle = ant.Angle;
                angle += Math.Max(-0.24, Math.Min(0.24, Math.Atan2(Math.Sin(ant.Angle - angle), Math.Cos(ant.Angle - angle))));
                antAngles[ant.Id] = angle;

                Position drawAt = current;
                double scale = 1, opacity = 1;
                if (ant.Mode == 3)
                {
                    double eased = Smooth(ant.EntryProgress);
                    drawAt = new Position(current.X + (portalCenter.X - current.X) * eased,
                        current.Y + (portalCenter.Y - current.Y) * eased);
                    scale = 1 - eased * 0.78;
                    opacity = 1 - Math.Pow(ant.EntryProgress, 1.6);
                }
                else if (ant.DepartureProgress < 0.999)
                {
                    double eased = Smooth(ant.DepartureProgress), amount = 1 - eased;
                    drawAt = new Position(current.X + (portalCenter.X - current.X) * amount,
                        current.Y + (portalCenter.Y - current.Y) * amount);
                    scale = 1 - amount * 0.78;
                    opacity = Math.Sin(ant.DepartureProgress * Math.PI / 2);
                }
                int frame = ((int)(now * 9 + ant.Id * 2.1)) & 7;
                int row = ant.Action >= 0 ? ant.Action : ant.Mode == 3 ? 8 : ant.Carrying != 0 ?
                    ant.Payload == 2 ? 2 : 1 : ant.Mode == 0 ? 0 : 6;
                float c = (float)Math.Cos(angle), s = (float)Math.Sin(angle);
                d2dContext.Transform = new RawMatrix3x2(c, s, -s, c, (float)drawAt.X, (float)drawAt.Y);
                RawRectangleF source = new RawRectangleF(frame * 38, row * 38, frame * 38 + 38, row * 38 + 38);
                float half = (float)(19 * scale);
                RawRectangleF dest = new RawRectangleF(-half, -half, half, half);
                d2dContext.DrawBitmap(antImage, dest, (float)Math.Max(0, Math.Min(1, opacity)),
                    SharpDX.Direct2D1.InterpolationMode.Linear, source, null);
                d2dContext.Transform = new RawMatrix3x2(1, 0, 0, 1, 0, 0);
            }
        }

        private void DrawPanel()
        {
            RoundedRectangle shadow = MakeRoundedRectangle(24, 26, 322, 208, 12, 12);
            d2dContext.FillRoundedRectangle(shadow, panelBrush[3]);
            RoundedRectangle outer = MakeRoundedRectangle(22, 22, 320, 204, 12, 12);
            d2dContext.FillRoundedRectangle(outer, panelBrush[0]);
            d2dContext.DrawRoundedRectangle(outer, panelStroke, 1);
            d2dContext.FillRoundedRectangle(MakeRoundedRectangle(23, 23, 319, 65, 11, 11), panelBrush[1]);
            DrawText("蚁群", 38, 29, 46, 61, titleFormat, textBrush[0]);
            DrawText("原生绘制预览 · 真实算法", 104, 39, 306, 58, smallFormat, textBrush[1]);
            DrawText("36 只蚂蚁    2 份模拟文件食物", 38, 77, 306, 98, normalFormat, textBrush[0]);
            DrawText("发现 " + state.Discoveries + "    送达 " + state.Trips + " 次", 38, 101, 306, 120, smallFormat, textBrush[1]);
            d2dContext.FillEllipse(new Ellipse(new RawVector2(40, 143), 3.2f, 3.2f), exploration[50]);
            DrawText("探索信息素", 49, 132, 121, 151, smallFormat, textBrush[1]);
            d2dContext.FillEllipse(new Ellipse(new RawVector2(147, 143), 3.2f, 3.2f), foodTrail[50]);
            DrawText("食物信息素", 156, 132, 230, 151, smallFormat, textBrush[1]);
            DrawText((paused ? "已暂停" : "运行中") + "    " + privateMiB.ToString("F0", CultureInfo.InvariantCulture) +
                " MiB    " + cpuPercent.ToString("F1", CultureInfo.InvariantCulture) + "% CPU", 38, 157, 306, 176, smallFormat, textBrush[0]);
            DrawText("Ctrl+Shift+F10 暂停   F11 信息素   F12 退出", 38, 179, 314, 195, smallFormat, textBrush[1]);
            DrawText("模拟数据，不读取或删除真实文件", 38, 198, 314, 215, smallFormat, textBrush[1]);
        }

        private void DrawText(string value, float left, float top, float right, float bottom, TextFormat format, Brush brush)
        {
            d2dContext.DrawText(value, format, new RawRectangleF(left, top, right, bottom), brush);
        }

        private static RoundedRectangle MakeRoundedRectangle(float left, float top, float right, float bottom, float radiusX, float radiusY)
        {
            RoundedRectangle value = new RoundedRectangle();
            value.Rect = new RawRectangleF(left, top, right, bottom);
            value.RadiusX = radiusX;
            value.RadiusY = radiusY;
            return value;
        }

        private static double Smooth(double value)
        {
            value = Math.Max(0, Math.Min(1, value));
            return value * value * (3 - 2 * value);
        }

        private void SampleResources()
        {
            double now = clock.Elapsed.TotalSeconds;
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
                cpuPercent = Math.Max(0, (cpu - lastCpuSeconds) / (now - lastSampleSeconds) * 100);
                privateMiB = memory / 1048576.0;
                cpuSamples.Add(cpuPercent);
                memorySamples.Add(privateMiB);
                lastCpuSeconds = cpu;
                lastSampleSeconds = now;
            }
            catch { }
        }

        private static int GetDpi()
        {
            try { return (int)GetDpiForSystem(); }
            catch { return 96; }
        }

        private static string FindProjectRoot(string start)
        {
            DirectoryInfo currentDirectory = new DirectoryInfo(start);
            while (currentDirectory != null)
            {
                if (File.Exists(Path.Combine(currentDirectory.FullName, "renderer", "colony.js"))) return currentDirectory.FullName;
                currentDirectory = currentDirectory.Parent;
            }
            throw new DirectoryNotFoundException("Could not locate renderer/colony.js above the preview executable.");
        }

        private void WriteError(string text)
        {
            try { File.AppendAllText(Path.Combine(Path.GetTempPath(), "deskants-direct2d-preview.log"), text + Environment.NewLine); }
            catch { }
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

        private void WriteReport()
        {
            try
            {
                Dictionary<string, object> report = new Dictionary<string, object>();
                report["durationSeconds"] = clock.Elapsed.TotalSeconds;
                report["renderedFrames"] = renderedFrames;
                report["privateMiBSamples"] = memorySamples.ToArray();
                report["cpuPercentSamples"] = cpuSamples.ToArray();
                report["privateMiBMean"] = Mean(memorySamples);
                report["privateMiBPeak"] = memorySamples.Count == 0 ? 0 : Max(memorySamples);
                report["cpuPercentMean"] = Mean(cpuSamples);
                report["renderer"] = "SharpDX Direct2D + DirectComposition composition swap chain + Node colony.js";
                report["measurement"] = "Synthetic obstacles and fake files; no real file I/O. CPU is one-core percentage."
                    + " Startup sample is included; compare steady-state only against a same-duration Electron capture.";
                string directory = Path.Combine(rootPath, "diagnostics");
                Directory.CreateDirectory(directory);
                File.WriteAllText(Path.Combine(directory, "direct2d-preview-session.json"), serializer.Serialize(report), Encoding.UTF8);
            }
            catch (Exception ex) { WriteError("Metrics write failed: " + ex); }
        }

        private void Dispose()
        {
            if (hwnd != IntPtr.Zero)
            {
                KillTimer(hwnd, new UIntPtr(TimerId));
                UnregisterHotKey(hwnd, 10); UnregisterHotKey(hwnd, 11); UnregisterHotKey(hwnd, 12);
                DestroyWindow(hwnd);
            }
            if (simulation != null)
            {
                try { simulation.Kill(); simulation.WaitForExit(1000); } catch { }
                simulation.Dispose();
            }
            WriteReport();
            for (int i = 0; i < exploration.Length; i++)
            {
                if (exploration[i] != null) exploration[i].Dispose();
                if (foodTrail[i] != null) foodTrail[i].Dispose();
            }
            for (int i = 0; i < textBrush.Length; i++) if (textBrush[i] != null) textBrush[i].Dispose();
            for (int i = 0; i < panelBrush.Length; i++) if (panelBrush[i] != null) panelBrush[i].Dispose();
            if (panelStroke != null) panelStroke.Dispose();
            for (int i = resources.Count - 1; i >= 0; i--) resources[i].Dispose();
            if (antPixels != null) antPixels.Dispose();
            if (foodPixels != null) foodPixels.Dispose();
            if (portalPixels != null) portalPixels.Dispose();
            if (targetBitmap != null) targetBitmap.Dispose();
            if (trailBitmap != null) trailBitmap.Dispose();
            if (backBuffer != null) backBuffer.Dispose();
            if (swapChain != null) swapChain.Dispose();
            if (compositionVisual != null) compositionVisual.Dispose();
            if (compositionTarget != null) compositionTarget.Dispose();
            if (compositionDevice != null) compositionDevice.Dispose();
            if (d2dContext != null) d2dContext.Dispose();
            if (d2dDevice != null) d2dDevice.Dispose();
            if (d2dFactory != null) d2dFactory.Dispose();
            if (dxgiFactory != null) dxgiFactory.Dispose();
            if (dxgiDevice != null) dxgiDevice.Dispose();
            if (d3dDevice != null) d3dDevice.Dispose();
            if (writeFactory != null) writeFactory.Dispose();
            if (titleFormat != null) titleFormat.Dispose();
            if (normalFormat != null) normalFormat.Dispose();
            if (smallFormat != null) smallFormat.Dispose();
        }

    }
}
