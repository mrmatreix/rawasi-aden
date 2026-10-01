using System;
using System.IO;
using System.Diagnostics;
using System.Drawing;
using System.Windows.Forms;
using System.Net;
using System.Threading;
using System.Text;
using System.Runtime.InteropServices;

namespace RawasiAdenApp
{
    static class Program
    {
        public static string AppDir = AppDomain.CurrentDomain.BaseDirectory;
        public static string ConfigPath = Path.Combine(AppDir, "server", "database", "config.json");
        public static string DefaultDbPath = Path.Combine(AppDir, "server", "database", "rawasi_aden.db");
        public static Process ServerProcess = null;
        public static NotifyIcon TrayIcon = null;

        [STAThread]
        static void Main(string[] args)
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            // Resolve actual project directory dynamically
            if (!ResolveAppDirectory())
            {
                return;
            }

            bool forceConfig = false;
            foreach (var arg in args)
            {
                if (arg.Equals("/config", StringComparison.OrdinalIgnoreCase) ||
                    arg.Equals("-config", StringComparison.OrdinalIgnoreCase) ||
                    arg.Equals("--config", StringComparison.OrdinalIgnoreCase) ||
                    arg.Equals("/setup", StringComparison.OrdinalIgnoreCase))
                {
                    forceConfig = true;
                }
            }

            if ((Control.ModifierKeys & Keys.Shift) == Keys.Shift || (Control.ModifierKeys & Keys.Control) == Keys.Control)
            {
                forceConfig = true;
            }

            // Read or initialize config
            string currentDbPath = GetConfiguredDbPath();

            if (forceConfig || string.IsNullOrEmpty(currentDbPath) || (!File.Exists(currentDbPath) && !File.Exists(DefaultDbPath)))
            {
                using (var dlg = new DbConfigForm(currentDbPath))
                {
                    if (dlg.ShowDialog() != DialogResult.OK)
                    {
                        return; // User cancelled
                    }
                    currentDbPath = dlg.SelectedDbPath;
                }
            }

            // Ensure DB config is saved
            SaveConfig(currentDbPath);

            // Start Server & Launch Application
            StartServerAndOpenApp();
        }

        public static bool ResolveAppDirectory()
        {
            // 1. If current directory has server.js, we are inside project
            if (IsValidProjectDir(AppDir))
            {
                SaveKnownAppDir(AppDir);
                UpdatePaths();
                return true;
            }

            // 2. Check saved directory from AppData
            string saved = LoadKnownAppDir();
            if (!string.IsNullOrEmpty(saved) && IsValidProjectDir(saved))
            {
                AppDir = saved;
                UpdatePaths();
                return true;
            }

            // 3. Search common locations
            string userProfile = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
            string[] searchPaths = new string[]
            {
                Path.Combine(userProfile, "رواسي عدن"),
                @"C:\Users\a.ba3baid\رواسي عدن",
                @"C:\رواسي عدن",
                @"D:\رواسي عدن",
                @"E:\رواسي عدن",
                Path.GetFullPath(Path.Combine(AppDir, "..")),
                Path.GetFullPath(Path.Combine(AppDir, "..", ".."))
            };

            foreach (var candidate in searchPaths)
            {
                if (IsValidProjectDir(candidate))
                {
                    AppDir = candidate;
                    SaveKnownAppDir(AppDir);
                    UpdatePaths();
                    return true;
                }
            }

            // 4. Prompt user to select project folder if not found
            var res = MessageBox.Show(
                "لم يتم العثور على مجلد مشروع 'رواسي عدن' تلقائياً.\n\n" +
                "المسار الحالي: " + AppDir + "\n\n" +
                "هل ترغب في تحديد مجلد المشروع يدوياً؟",
                "تحديد مسار المشروع - رواسي عدن",
                MessageBoxButtons.YesNo,
                MessageBoxIcon.Question);

            if (res == DialogResult.Yes)
            {
                using (FolderBrowserDialog fbd = new FolderBrowserDialog())
                {
                    fbd.Description = "اختر مجلد مشروع رواسي عدن (المجلد الذي يحتوي على server و index.html)";
                    fbd.SelectedPath = userProfile;
                    if (fbd.ShowDialog() == DialogResult.OK)
                    {
                        if (IsValidProjectDir(fbd.SelectedPath))
                        {
                            AppDir = fbd.SelectedPath;
                            SaveKnownAppDir(AppDir);
                            UpdatePaths();
                            return true;
                        }
                        else
                        {
                            MessageBox.Show(
                                "المجلد المختار لا يحتوي على ملفات المشروع المطلوبة (server/server.js).\nيرجى التأكد من اختيار مجلد المشروع الصحيح.",
                                "خطأ في المجلد",
                                MessageBoxButtons.OK,
                                MessageBoxIcon.Error);
                            return false;
                        }
                    }
                }
            }

            return false;
        }

        private static bool IsValidProjectDir(string dir)
        {
            if (string.IsNullOrEmpty(dir) || !Directory.Exists(dir)) return false;
            string serverJs = Path.Combine(dir, "server", "server.js");
            return File.Exists(serverJs);
        }

        private static void UpdatePaths()
        {
            ConfigPath = Path.Combine(AppDir, "server", "database", "config.json");
            DefaultDbPath = Path.Combine(AppDir, "server", "database", "rawasi_aden.db");
        }

        private static string GetAppDataSettingsFile()
        {
            string appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
            string dir = Path.Combine(appData, "RawasiAden");
            if (!Directory.Exists(dir)) Directory.CreateDirectory(dir);
            return Path.Combine(dir, "app_dir.txt");
        }

        private static void SaveKnownAppDir(string path)
        {
            try
            {
                File.WriteAllText(GetAppDataSettingsFile(), path, Encoding.UTF8);
            }
            catch { }
        }

        private static string LoadKnownAppDir()
        {
            try
            {
                string f = GetAppDataSettingsFile();
                if (File.Exists(f))
                {
                    string p = File.ReadAllText(f, Encoding.UTF8).Trim();
                    if (!string.IsNullOrEmpty(p) && Directory.Exists(p)) return p;
                }
            }
            catch { }
            return null;
        }

        public static string GetConfiguredDbPath()
        {
            try
            {
                if (File.Exists(ConfigPath))
                {
                    string json = File.ReadAllText(ConfigPath, Encoding.UTF8);
                    int idx = json.IndexOf("\"dbPath\":");
                    if (idx != -1)
                    {
                        int startQuote = json.IndexOf('"', idx + 9);
                        if (startQuote != -1)
                        {
                            int endQuote = json.IndexOf('"', startQuote + 1);
                            if (endQuote != -1)
                            {
                                string val = json.Substring(startQuote + 1, endQuote - startQuote - 1).Replace("\\\\", "\\");
                                if (Path.IsPathRooted(val)) return val;
                                return Path.GetFullPath(Path.Combine(AppDir, val));
                            }
                        }
                    }
                }
            }
            catch { }

            return DefaultDbPath;
        }

        public static void SaveConfig(string dbPath)
        {
            try
            {
                string dir = Path.GetDirectoryName(ConfigPath);
                if (!Directory.Exists(dir)) Directory.CreateDirectory(dir);

                string safePath = dbPath.Replace("\\", "\\\\");
                string json = "{\n  \"dbPath\": \"" + safePath + "\",\n  \"port\": 5500,\n  \"systemName\": \"رواسي عدن للهندسة والمقاولات\"\n}\n";
                File.WriteAllText(ConfigPath, json, new UTF8Encoding(false));
            }
            catch (Exception ex)
            {
                MessageBox.Show("خطأ في حفظ ملف الإعدادات: " + ex.Message, "رواسي عدن", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            }
        }

        public static void StartServerAndOpenApp()
        {
            // Check if server is already running
            if (IsServerAlive())
            {
                OpenBrowser("http://localhost:5500");
                SetupTray();
                Application.Run();
                return;
            }

            // Find Node.js
            string nodePath = FindNodeJs();
            if (string.IsNullOrEmpty(nodePath))
            {
                MessageBox.Show("لم يتم العثور على محرك Node.js على جهازك.\nيرجى التأكد من تثبيت Node.js لتشغيل النظام.", "خطأ في التشغيل", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return;
            }

            string serverScript = Path.Combine(AppDir, "server", "server.js");
            if (!File.Exists(serverScript))
            {
                MessageBox.Show("لم يتم العثور على ملف السيرفر: " + serverScript, "خطأ في الملفات", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return;
            }

            try
            {
                ProcessStartInfo psi = new ProcessStartInfo();
                psi.FileName = nodePath;
                psi.Arguments = "\"" + serverScript + "\"";
                psi.WorkingDirectory = AppDir;
                psi.WindowStyle = ProcessWindowStyle.Hidden;
                psi.CreateNoWindow = true;
                psi.UseShellExecute = false;

                ServerProcess = Process.Start(psi);
                if (ServerProcess != null)
                {
                    ServerProcess.EnableRaisingEvents = true;
                    ServerProcess.Exited += (s, e) =>
                    {
                        try
                        {
                            if (TrayIcon != null) TrayIcon.Visible = false;
                            Application.Exit();
                        }
                        catch { }
                    };
                }

                // Wait for server to become ready (max 10 seconds)
                for (int i = 0; i < 20; i++)
                {
                    Thread.Sleep(400);
                    if (IsServerAlive())
                    {
                        break;
                    }
                }

                OpenBrowser("http://localhost:5500");
                SetupTray();
                Application.Run();
            }
            catch (Exception ex)
            {
                MessageBox.Show("حدث خطأ أثناء تشغيل النظام:\n" + ex.Message, "رواسي عدن", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }

        private static bool IsServerAlive()
        {
            try
            {
                var req = (HttpWebRequest)WebRequest.Create("http://localhost:5500/api/health");
                req.Timeout = 1200;
                using (var resp = (HttpWebResponse)req.GetResponse())
                {
                    return resp.StatusCode == HttpStatusCode.OK;
                }
            }
            catch
            {
                return false;
            }
        }

        private static void OpenBrowser(string url)
        {
            try
            {
                string edgePath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "Microsoft", "Edge", "Application", "msedge.exe");
                if (!File.Exists(edgePath))
                {
                    edgePath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Microsoft", "Edge", "Application", "msedge.exe");
                }

                string chromePath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Google", "Chrome", "Application", "chrome.exe");
                if (!File.Exists(chromePath))
                {
                    chromePath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "Google", "Chrome", "Application", "chrome.exe");
                }

                if (File.Exists(edgePath))
                {
                    Process.Start(edgePath, "--app=\"" + url + "\" --no-first-run --no-default-browser-check");
                }
                else if (File.Exists(chromePath))
                {
                    Process.Start(chromePath, "--app=\"" + url + "\" --no-first-run");
                }
                else
                {
                    Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
                }

                // Background thread to find the browser window and disable/remove ONLY the 'X' (Close) button
                Thread disableCloseWatcher = new Thread(() =>
                {
                    for (int i = 0; i < 60; i++)
                    {
                        Thread.Sleep(300);
                        EnumWindows((hWnd, lParam) =>
                        {
                            StringBuilder sb = new StringBuilder(512);
                            GetWindowText(hWnd, sb, 512);
                            string title = sb.ToString();
                            if (!string.IsNullOrEmpty(title) && (title.Contains("رواسي عدن") || title.Contains("localhost:5500") || title.Contains("Rawasi")))
                            {
                                IntPtr hMenu = GetSystemMenu(hWnd, false);
                                if (hMenu != IntPtr.Zero)
                                {
                                    EnableMenuItem(hMenu, SC_CLOSE, MF_BYCOMMAND | MF_DISABLED | MF_GRAYED);
                                    DeleteMenu(hMenu, SC_CLOSE, MF_BYCOMMAND);
                                    DrawMenuBar(hWnd);
                                }
                            }
                            return true;
                        }, IntPtr.Zero);
                    }
                });
                disableCloseWatcher.IsBackground = true;
                disableCloseWatcher.Start();
            }
            catch
            {
                try
                {
                    Process.Start(url);
                }
                catch { }
            }
        }

        private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

        [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
        private static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

        [DllImport("user32.dll")]
        private static extern IntPtr GetSystemMenu(IntPtr hWnd, bool bRevert);

        [DllImport("user32.dll")]
        private static extern bool DeleteMenu(IntPtr hMenu, uint uPosition, uint uFlags);

        [DllImport("user32.dll")]
        private static extern bool EnableMenuItem(IntPtr hMenu, uint uIDEnableItem, uint uEnable);

        [DllImport("user32.dll")]
        private static extern bool DrawMenuBar(IntPtr hWnd);

        private const uint SC_CLOSE = 0xF060;
        private const uint MF_BYCOMMAND = 0x00000000;
        private const uint MF_GRAYED = 0x00000001;
        private const uint MF_DISABLED = 0x00000002;

        private static string FindNodeJs()
        {
            string[] paths = new string[]
            {
                Path.Combine(AppDir, "node.exe"),
                Path.Combine(AppDir, "bin", "node.exe"),
                @"C:\Program Files\nodejs\node.exe",
                @"C:\Program Files (x86)\nodejs\node.exe",
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "node", "node.exe")
            };

            foreach (var p in paths)
            {
                if (File.Exists(p)) return p;
            }

            // Check PATH environment variable
            try
            {
                string pathEnv = Environment.GetEnvironmentVariable("PATH");
                if (pathEnv != null)
                {
                    foreach (var dir in pathEnv.Split(';'))
                    {
                        string candidate = Path.Combine(dir.Trim(), "node.exe");
                        if (File.Exists(candidate)) return candidate;
                    }
                }
            }
            catch { }

            return "node.exe";
        }

        private static void SetupTray()
        {
            try
            {
                TrayIcon = new NotifyIcon();
                string iconPath = Path.Combine(AppDir, "images", "app.ico");
                if (File.Exists(iconPath))
                {
                    TrayIcon.Icon = new Icon(iconPath);
                }
                else
                {
                    TrayIcon.Icon = SystemIcons.Application;
                }

                TrayIcon.Text = "شركة رواسي عدن للهندسة والمقاولات (يعمل بنجاح)";
                TrayIcon.Visible = true;

                ContextMenuStrip menu = new ContextMenuStrip();
                menu.RightToLeft = RightToLeft.Yes;

                ToolStripMenuItem titleItem = new ToolStripMenuItem("🏢 شركة رواسي عدن - قيد التشغيل");
                titleItem.Enabled = false;
                titleItem.Font = new Font("Segoe UI", 9F, FontStyle.Bold);

                ToolStripMenuItem openItem = new ToolStripMenuItem("🌐 فتح نافذة النظام", null, (s, e) => OpenBrowser("http://localhost:5500"));
                ToolStripMenuItem configItem = new ToolStripMenuItem("⚙️ إعدادات مسار قاعدة البيانات...", null, (s, e) =>
                {
                    string currentDb = GetConfiguredDbPath();
                    using (var dlg = new DbConfigForm(currentDb))
                    {
                        if (dlg.ShowDialog() == DialogResult.OK)
                        {
                            SaveConfig(dlg.SelectedDbPath);
                            MessageBox.Show("تم حفظ مسار قاعدة البيانات الجديد.\nيرجى إعادة تشغيل النظام لتطبيق التغيير.", "تم الحفظ", MessageBoxButtons.OK, MessageBoxIcon.Information);
                        }
                    }
                });

                ToolStripMenuItem exitItem = new ToolStripMenuItem("❌ إيقاف الخادم والخروج", null, (s, e) =>
                {
                    DialogResult res = MessageBox.Show(
                        "هل أنت متأكد من رغبتك في إغلاق نظام شركة رواسي عدن وإيقاف الخادم؟\n\n⚡ سيتم حفظ كافة التعديلات وأخذ نسخة احتياطية آمنة وتلقائية من قاعدة البيانات قبل الإغلاق.",
                        "تأكيد إغلاق النظام - رواسي عدن",
                        MessageBoxButtons.YesNo,
                        MessageBoxIcon.Question,
                        MessageBoxDefaultButton.Button2);

                    if (res == DialogResult.Yes)
                    {
                        PerformAutoBackupOnExit();

                        if (TrayIcon != null) TrayIcon.Visible = false;
                        try
                        {
                            if (ServerProcess != null && !ServerProcess.HasExited)
                            {
                                ServerProcess.Kill();
                            }
                        }
                        catch { }
                        Application.Exit();
                    }
                });

                menu.Items.Add(titleItem);
                menu.Items.Add(new ToolStripSeparator());
                menu.Items.Add(openItem);
                menu.Items.Add(configItem);
                menu.Items.Add(new ToolStripSeparator());
                menu.Items.Add(exitItem);

                TrayIcon.ContextMenuStrip = menu;
                TrayIcon.DoubleClick += (s, e) => OpenBrowser("http://localhost:5500");

                TrayIcon.ShowBalloonTip(3000, "شركة رواسي عدن", "النظام يعمل الآن على http://localhost:5500", ToolTipIcon.Info);
            }
            catch { }
        }

        private static void PerformAutoBackupOnExit()
        {
            try
            {
                // First try sending request to node server for formal manifest recording
                try
                {
                    var req = (HttpWebRequest)WebRequest.Create("http://localhost:5500/api/settings/shutdown-app");
                    req.Method = "POST";
                    req.ContentType = "application/json; charset=utf-8";
                    req.Timeout = 1500;
                    string body = "{\"username\":\"admin\",\"mode\":\"offline\",\"notes\":\"نسخة احتياطية تلقائية عند إغلاق مشغل النظام (Launcher Exit)\"}";
                    byte[] bytes = Encoding.UTF8.GetBytes(body);
                    req.ContentLength = bytes.Length;
                    using (Stream os = req.GetRequestStream())
                    {
                        os.Write(bytes, 0, bytes.Length);
                    }
                    using (var resp = (HttpWebResponse)req.GetResponse())
                    {
                        if (resp.StatusCode == HttpStatusCode.OK) return;
                    }
                }
                catch { }

                // Fallback direct file copy if server is unreachable
                string currentDb = GetConfiguredDbPath();
                if (File.Exists(currentDb))
                {
                    string backupsDir = Path.Combine(AppDir, "server", "database", "backups");
                    if (!Directory.Exists(backupsDir)) Directory.CreateDirectory(backupsDir);

                    string timeStamp = DateTime.Now.ToString("yyyy-MM-dd_HH-mm-ss");
                    string backupName = "backup_logout_system_" + timeStamp + ".db";
                    string destFile = Path.Combine(backupsDir, backupName);

                    File.Copy(currentDb, destFile, true);
                }
            }
            catch { }
        }
    }

    public class DbConfigForm : Form
    {
        public string SelectedDbPath { get; private set; }
        private TextBox txtDbPath;
        private Label lblStatus;

        public DbConfigForm(string initialPath)
        {
            this.SelectedDbPath = initialPath;
            InitializeComponent();
        }

        private void InitializeComponent()
        {
            this.Text = "نظام شركة رواسي عدن - تحديد وربط مسار قاعدة البيانات";
            this.Size = new Size(620, 420);
            this.StartPosition = FormStartPosition.CenterScreen;
            this.FormBorderStyle = FormBorderStyle.FixedDialog;
            this.MaximizeBox = false;
            this.MinimizeBox = false;
            this.RightToLeft = RightToLeft.Yes;
            this.RightToLeftLayout = true;
            this.BackColor = Color.FromArgb(244, 246, 249);
            this.Font = new Font("Segoe UI", 9.5F);

            string iconPath = Path.Combine(Program.AppDir, "images", "app.ico");
            if (File.Exists(iconPath))
            {
                try { this.Icon = new Icon(iconPath); } catch { }
            }

            // Header Panel
            Panel header = new Panel();
            header.Dock = DockStyle.Top;
            header.Height = 85;
            header.BackColor = Color.FromArgb(18, 30, 49);

            Label lblTitle = new Label();
            lblTitle.Text = "🏢 شركة رواسي عدن للهندسة والمقاولات";
            lblTitle.ForeColor = Color.FromArgb(212, 175, 55);
            lblTitle.Font = new Font("Segoe UI", 13F, FontStyle.Bold);
            lblTitle.Location = new Point(20, 15);
            lblTitle.AutoSize = true;

            Label lblSub = new Label();
            lblSub.Text = "إعداد وربط ملف قاعدة البيانات (SQLite Database Configuration)";
            lblSub.ForeColor = Color.FromArgb(200, 210, 225);
            lblSub.Font = new Font("Segoe UI", 9.5F);
            lblSub.Location = new Point(20, 48);
            lblSub.AutoSize = true;

            header.Controls.Add(lblTitle);
            header.Controls.Add(lblSub);
            this.Controls.Add(header);

            // Instructions Label
            Label lblDesc = new Label();
            lblDesc.Text = "يرجى تحديد مسار ملف قاعدة البيانات (.db) الذي ترغب في ربط المشروع به.\nيمكنك اختيار قاعدة بيانات موجودة مسبقاً أو تحديد مسار لإنشاء قاعدة جديدة:";
            lblDesc.Location = new Point(25, 105);
            lblDesc.Size = new Size(550, 40);
            this.Controls.Add(lblDesc);

            // Database Path TextBox
            txtDbPath = new TextBox();
            txtDbPath.Text = string.IsNullOrEmpty(SelectedDbPath) ? Program.DefaultDbPath : SelectedDbPath;
            txtDbPath.Location = new Point(135, 155);
            txtDbPath.Size = new Size(440, 26);
            txtDbPath.Font = new Font("Segoe UI", 9.5F);
            txtDbPath.TextChanged += (s, e) => CheckPathStatus();
            this.Controls.Add(txtDbPath);

            // Browse Button
            Button btnBrowse = new Button();
            btnBrowse.Text = "📁 استعراض...";
            btnBrowse.Location = new Point(25, 153);
            btnBrowse.Size = new Size(100, 30);
            btnBrowse.BackColor = Color.FromArgb(230, 235, 245);
            btnBrowse.Cursor = Cursors.Hand;
            btnBrowse.Click += (s, e) => BrowseDbFile();
            this.Controls.Add(btnBrowse);

            // Quick Options Panel
            GroupBox grpQuick = new GroupBox();
            grpQuick.Text = "خيارات سريعة للمسار:";
            grpQuick.Location = new Point(25, 195);
            grpQuick.Size = new Size(550, 75);

            Button btnDefault = new Button();
            btnDefault.Text = "📍 المسار الافتراضي للمشروع";
            btnDefault.Location = new Point(340, 28);
            btnDefault.Size = new Size(190, 32);
            btnDefault.Click += (s, e) => txtDbPath.Text = Program.DefaultDbPath;

            Button btnDocs = new Button();
            btnDocs.Text = "📂 مجلد المستندات الشخصية";
            btnDocs.Location = new Point(140, 28);
            btnDocs.Size = new Size(190, 32);
            btnDocs.Click += (s, e) =>
            {
                string docs = Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments);
                string folder = Path.Combine(docs, "RawasiAdenData");
                txtDbPath.Text = Path.Combine(folder, "rawasi_aden.db");
            };

            grpQuick.Controls.Add(btnDefault);
            grpQuick.Controls.Add(btnDocs);
            this.Controls.Add(grpQuick);

            // Status Label
            lblStatus = new Label();
            lblStatus.Location = new Point(25, 280);
            lblStatus.Size = new Size(550, 30);
            lblStatus.Font = new Font("Segoe UI", 9F, FontStyle.Bold);
            this.Controls.Add(lblStatus);

            // Bottom Action Buttons
            Button btnSave = new Button();
            btnSave.Text = "🚀 حفظ وتشغيل النظام الآن";
            btnSave.Location = new Point(160, 325);
            btnSave.Size = new Size(210, 42);
            btnSave.BackColor = Color.FromArgb(18, 30, 49);
            btnSave.ForeColor = Color.FromArgb(212, 175, 55);
            btnSave.Font = new Font("Segoe UI", 10.5F, FontStyle.Bold);
            btnSave.Cursor = Cursors.Hand;
            btnSave.Click += (s, e) =>
            {
                if (string.IsNullOrWhiteSpace(txtDbPath.Text))
                {
                    MessageBox.Show("يرجى إدخال مسار صالح لقاعدة البيانات.", "تنبيه", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                    return;
                }
                this.SelectedDbPath = txtDbPath.Text.Trim();
                this.DialogResult = DialogResult.OK;
                this.Close();
            };
            this.Controls.Add(btnSave);

            Button btnCancel = new Button();
            btnCancel.Text = "إلغاء";
            btnCancel.Location = new Point(45, 325);
            btnCancel.Size = new Size(100, 42);
            btnCancel.BackColor = Color.FromArgb(220, 225, 230);
            btnCancel.Cursor = Cursors.Hand;
            btnCancel.Click += (s, e) =>
            {
                this.DialogResult = DialogResult.Cancel;
                this.Close();
            };
            this.Controls.Add(btnCancel);

            CheckPathStatus();
        }

        private void BrowseDbFile()
        {
            using (SaveFileDialog dlg = new SaveFileDialog())
            {
                dlg.Title = "اختر أو حدد ملف قاعدة بيانات SQLite لنظام رواسي عدن";
                dlg.Filter = "ملفات قاعدة البيانات (*.db;*.sqlite)|*.db;*.sqlite|جميع الملفات (*.*)|*.*";
                dlg.DefaultExt = "db";
                dlg.FileName = "rawasi_aden.db";
                if (!string.IsNullOrEmpty(txtDbPath.Text))
                {
                    try
                    {
                        string dir = Path.GetDirectoryName(txtDbPath.Text);
                        if (Directory.Exists(dir)) dlg.InitialDirectory = dir;
                    }
                    catch { }
                }

                if (dlg.ShowDialog() == DialogResult.OK)
                {
                    txtDbPath.Text = dlg.FileName;
                }
            }
        }

        private void CheckPathStatus()
        {
            string p = txtDbPath.Text.Trim();
            if (string.IsNullOrEmpty(p))
            {
                lblStatus.Text = "⚠️ يرجى تحديد مسار قاعدة البيانات";
                lblStatus.ForeColor = Color.DarkOrange;
                return;
            }

            if (File.Exists(p))
            {
                FileInfo fi = new FileInfo(p);
                lblStatus.Text = "✅ قاعدة بيانات موجودة وجاهزة للربط فوراً (" + (fi.Length / 1024).ToString() + " KB)";
                lblStatus.ForeColor = Color.ForestGreen;
            }
            else
            {
                lblStatus.Text = "ℹ️ مسار جديد: سيتم إنشاء وتهيئة قاعدة بيانات جديدة تلقائياً مع حساب المدير الافتراضي.";
                lblStatus.ForeColor = Color.FromArgb(0, 102, 204);
            }
        }
    }
}
