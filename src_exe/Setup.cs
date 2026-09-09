using System;
using System.IO;
using System.Drawing;
using System.Windows.Forms;
using System.Text;
using System.Diagnostics;
using System.Runtime.InteropServices;

namespace RawasiAdenSetup
{
    static class Program
    {
        [STAThread]
        static void Main()
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new SetupForm());
        }
    }

    public class SetupForm : Form
    {
        private TextBox txtAppDir;
        private TextBox txtDbPath;
        private CheckBox chkDesktopShortcut;
        private CheckBox chkStartNow;
        private Label lblDbStatus;
        private string appDir;

        public SetupForm()
        {
            this.appDir = AppDomain.CurrentDomain.BaseDirectory;
            InitializeComponent();
        }

        private void InitializeComponent()
        {
            this.Text = "تثبيت وتهيئة نظام شركة رواسي عدن للهندسة والمقاولات";
            this.Size = new Size(680, 560);
            this.StartPosition = FormStartPosition.CenterScreen;
            this.FormBorderStyle = FormBorderStyle.FixedDialog;
            this.MaximizeBox = false;
            this.MinimizeBox = false;
            this.RightToLeft = RightToLeft.Yes;
            this.RightToLeftLayout = true;
            this.BackColor = Color.FromArgb(246, 248, 252);
            this.Font = new Font("Segoe UI", 9.5F);

            string iconPath = Path.Combine(appDir, "images", "app.ico");
            if (File.Exists(iconPath))
            {
                try { this.Icon = new Icon(iconPath); } catch { }
            }

            // Top Header
            Panel header = new Panel();
            header.Dock = DockStyle.Top;
            header.Height = 100;
            header.BackColor = Color.FromArgb(18, 30, 49);

            Label lblTitle = new Label();
            lblTitle.Text = "🏢 معالج تثبيت وتهيئة نظام شركة رواسي عدن";
            lblTitle.ForeColor = Color.FromArgb(212, 175, 55);
            lblTitle.Font = new Font("Segoe UI", 14F, FontStyle.Bold);
            lblTitle.Location = new Point(25, 20);
            lblTitle.AutoSize = true;

            Label lblSub = new Label();
            lblSub.Text = "مرحباً بك! يتيح لك هذا المعالج ربط وتخصيص مسار قاعدة البيانات وتشغيل النظام بنقرة واحدة.";
            lblSub.ForeColor = Color.FromArgb(210, 220, 235);
            lblSub.Font = new Font("Segoe UI", 9.5F);
            lblSub.Location = new Point(25, 58);
            lblSub.AutoSize = true;

            header.Controls.Add(lblTitle);
            header.Controls.Add(lblSub);
            this.Controls.Add(header);

            int currentY = 115;

            // 1. App Directory Group
            GroupBox grpApp = new GroupBox();
            grpApp.Text = "1. مجلد تثبيت المشروع والملفات:";
            grpApp.Location = new Point(25, currentY);
            grpApp.Size = new Size(615, 75);

            txtAppDir = new TextBox();
            txtAppDir.Text = appDir;
            txtAppDir.Location = new Point(130, 30);
            txtAppDir.Size = new Size(465, 26);
            txtAppDir.ReadOnly = true;
            grpApp.Controls.Add(txtAppDir);

            Button btnBrowseApp = new Button();
            btnBrowseApp.Text = "📁 استعراض...";
            btnBrowseApp.Location = new Point(20, 28);
            btnBrowseApp.Size = new Size(100, 30);
            btnBrowseApp.Click += (s, e) =>
            {
                using (FolderBrowserDialog dlg = new FolderBrowserDialog())
                {
                    dlg.Description = "اختر مجلد مشروع رواسي عدن";
                    dlg.SelectedPath = txtAppDir.Text;
                    if (dlg.ShowDialog() == DialogResult.OK)
                    {
                        txtAppDir.Text = dlg.SelectedPath;
                        appDir = dlg.SelectedPath;
                    }
                }
            };
            grpApp.Controls.Add(btnBrowseApp);
            this.Controls.Add(grpApp);

            currentY += 90;

            // 2. Database Path Group
            GroupBox grpDb = new GroupBox();
            grpDb.Text = "2. اختيار وربط مسار قاعدة البيانات (SQLite Database):";
            grpDb.Location = new Point(25, currentY);
            grpDb.Size = new Size(615, 160);

            Label lblDbHint = new Label();
            lblDbHint.Text = "حدد مسار ملف قاعدة البيانات (.db) الذي ترغب في حفظ البيانات به أو الربط معه:";
            lblDbHint.Location = new Point(20, 25);
            lblDbHint.Size = new Size(575, 20);
            grpDb.Controls.Add(lblDbHint);

            txtDbPath = new TextBox();
            txtDbPath.Text = Path.Combine(appDir, "server", "database", "rawasi_aden.db");
            txtDbPath.Location = new Point(130, 52);
            txtDbPath.Size = new Size(465, 26);
            txtDbPath.TextChanged += (s, e) => CheckDbPath();
            grpDb.Controls.Add(txtDbPath);

            Button btnBrowseDb = new Button();
            btnBrowseDb.Text = "📁 استعراض...";
            btnBrowseDb.Location = new Point(20, 50);
            btnBrowseDb.Size = new Size(100, 30);
            btnBrowseDb.Click += (s, e) =>
            {
                using (SaveFileDialog dlg = new SaveFileDialog())
                {
                    dlg.Title = "اختر أو حدد مسار ملف قاعدة البيانات";
                    dlg.Filter = "ملفات قاعدة البيانات (*.db;*.sqlite)|*.db;*.sqlite|جميع الملفات (*.*)|*.*";
                    dlg.DefaultExt = "db";
                    dlg.FileName = "rawasi_aden.db";
                    if (dlg.ShowDialog() == DialogResult.OK)
                    {
                        txtDbPath.Text = dlg.FileName;
                    }
                }
            };
            grpDb.Controls.Add(btnBrowseDb);

            // Quick Preset Buttons
            Button btnDbDefault = new Button();
            btnDbDefault.Text = "📍 المسار الافتراضي";
            btnDbDefault.Location = new Point(365, 88);
            btnDbDefault.Size = new Size(140, 28);
            btnDbDefault.Click += (s, e) => txtDbPath.Text = Path.Combine(appDir, "server", "database", "rawasi_aden.db");
            grpDb.Controls.Add(btnDbDefault);

            Button btnDbDocs = new Button();
            btnDbDocs.Text = "📂 مجلد المستندات (My Documents)";
            btnDbDocs.Location = new Point(130, 88);
            btnDbDocs.Size = new Size(225, 28);
            btnDbDocs.Click += (s, e) =>
            {
                string docs = Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments);
                txtDbPath.Text = Path.Combine(docs, "RawasiAdenData", "rawasi_aden.db");
            };
            grpDb.Controls.Add(btnDbDocs);

            lblDbStatus = new Label();
            lblDbStatus.Location = new Point(20, 124);
            lblDbStatus.Size = new Size(575, 25);
            lblDbStatus.Font = new Font("Segoe UI", 9F, FontStyle.Bold);
            grpDb.Controls.Add(lblDbStatus);

            this.Controls.Add(grpDb);

            currentY += 175;

            // 3. Shortcuts & Options
            chkDesktopShortcut = new CheckBox();
            chkDesktopShortcut.Text = "إنشاء اختصار رسمي للنظام على سطح المكتب مع أيقونة الشركة";
            chkDesktopShortcut.Checked = true;
            chkDesktopShortcut.Location = new Point(35, currentY);
            chkDesktopShortcut.Size = new Size(500, 25);
            this.Controls.Add(chkDesktopShortcut);

            chkStartNow = new CheckBox();
            chkStartNow.Text = "تشغيل نظام شركة رواسي عدن مباشرة بعد إتمام التثبيت";
            chkStartNow.Checked = true;
            chkStartNow.Location = new Point(35, currentY + 30);
            chkStartNow.Size = new Size(500, 25);
            this.Controls.Add(chkStartNow);

            // Bottom Buttons
            Button btnInstall = new Button();
            btnInstall.Text = "🚀 إتمام التثبيت وربط قاعدة البيانات";
            btnInstall.Location = new Point(200, 455);
            btnInstall.Size = new Size(270, 46);
            btnInstall.BackColor = Color.FromArgb(18, 30, 49);
            btnInstall.ForeColor = Color.FromArgb(212, 175, 55);
            btnInstall.Font = new Font("Segoe UI", 11F, FontStyle.Bold);
            btnInstall.Cursor = Cursors.Hand;
            btnInstall.Click += (s, e) => ExecuteInstallation();
            this.Controls.Add(btnInstall);

            Button btnExit = new Button();
            btnExit.Text = "إلغاء";
            btnExit.Location = new Point(80, 455);
            btnExit.Size = new Size(100, 46);
            btnExit.BackColor = Color.FromArgb(225, 230, 235);
            btnExit.Cursor = Cursors.Hand;
            btnExit.Click += (s, e) => Application.Exit();
            this.Controls.Add(btnExit);

            CheckDbPath();
        }

        private void CheckDbPath()
        {
            string p = txtDbPath.Text.Trim();
            if (string.IsNullOrEmpty(p))
            {
                lblDbStatus.Text = "⚠️ يرجى تحديد مسار قاعدة البيانات";
                lblDbStatus.ForeColor = Color.DarkOrange;
                return;
            }

            if (File.Exists(p))
            {
                FileInfo fi = new FileInfo(p);
                lblDbStatus.Text = "✅ قاعدة بيانات موجودة سيتم ربطها فوراً دون فقدان أي بيانات (" + (fi.Length / 1024).ToString() + " KB)";
                lblDbStatus.ForeColor = Color.ForestGreen;
            }
            else
            {
                lblDbStatus.Text = "ℹ️ سيتم إنشاء وتجهيز قاعدة بيانات جديدة تلقائياً مع حسابات المدير والإعدادات.";
                lblDbStatus.ForeColor = Color.FromArgb(0, 102, 204);
            }
        }

        private void ExecuteInstallation()
        {
            string chosenDb = txtDbPath.Text.Trim();
            if (string.IsNullOrWhiteSpace(chosenDb))
            {
                MessageBox.Show("يرجى إدخال مسار صحيح لقاعدة البيانات.", "تنبيه", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }

            try
            {
                // 1. Ensure DB Directory exists
                string dbDir = Path.GetDirectoryName(chosenDb);
                if (!Directory.Exists(dbDir)) Directory.CreateDirectory(dbDir);

                // 2. Save config.json
                string configDir = Path.Combine(appDir, "server", "database");
                if (!Directory.Exists(configDir)) Directory.CreateDirectory(configDir);
                string configPath = Path.Combine(configDir, "config.json");

                string safePath = chosenDb.Replace("\\", "\\\\");
                string json = "{\n  \"dbPath\": \"" + safePath + "\",\n  \"port\": 5500,\n  \"systemName\": \"رواسي عدن للهندسة والمقاولات\"\n}\n";
                File.WriteAllText(configPath, json, new UTF8Encoding(false));

                // Save known AppDir to AppData
                try
                {
                    string appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
                    string regDir = Path.Combine(appData, "RawasiAden");
                    if (!Directory.Exists(regDir)) Directory.CreateDirectory(regDir);
                    File.WriteAllText(Path.Combine(regDir, "app_dir.txt"), appDir, new UTF8Encoding(false));
                }
                catch { }

                // 3. Create Desktop Shortcut if checked
                if (chkDesktopShortcut.Checked)
                {
                    CreateDesktopShortcut();
                }

                MessageBox.Show("✅ تم إعداد وتثبيت نظام شركة رواسي عدن بنجاح!\n\nتم ربط قاعدة البيانات بالمسار:\n" + chosenDb, "نجاح التثبيت", MessageBoxButtons.OK, MessageBoxIcon.Information);

                // 4. Launch if checked
                if (chkStartNow.Checked)
                {
                    string launcherExe = Path.Combine(appDir, "RawasiAden.exe");
                    if (File.Exists(launcherExe))
                    {
                        Process.Start(launcherExe);
                    }
                    else
                    {
                        string runBat = Path.Combine(appDir, "run.bat");
                        if (File.Exists(runBat))
                        {
                            Process.Start(runBat);
                        }
                    }
                }

                Application.Exit();
            }
            catch (Exception ex)
            {
                MessageBox.Show("حدث خطأ أثناء التثبيت:\n" + ex.Message, "خطأ", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }

        private void CreateDesktopShortcut()
        {
            try
            {
                string desktop = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
                string shortcutPath = Path.Combine(desktop, "نظام شركة رواسي عدن.lnk");
                string targetExe = Path.Combine(appDir, "RawasiAden.exe");
                string iconPath = Path.Combine(appDir, "images", "app.ico");

                IShellLink link = (IShellLink)new ShellLink();
                link.SetDescription("نظام شركة رواسي عدن للهندسة والمقاولات");
                link.SetPath(targetExe);
                link.SetWorkingDirectory(appDir);
                if (File.Exists(iconPath))
                {
                    link.SetIconLocation(iconPath, 0);
                }

                System.Runtime.InteropServices.ComTypes.IPersistFile file = (System.Runtime.InteropServices.ComTypes.IPersistFile)link;
                file.Save(shortcutPath, false);
            }
            catch (Exception ex)
            {
                Console.WriteLine("Shortcut creation note: " + ex.Message);
            }
        }
    }

    [ComImport]
    [Guid("00021401-0000-0000-C000-000000000046")]
    internal class ShellLink
    {
    }

    [ComImport]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    [Guid("000214F9-0000-0000-C000-000000000046")]
    internal interface IShellLink
    {
        void GetPath([Out, MarshalAs(UnmanagedType.LPWStr)] System.Text.StringBuilder pszFile, int cchMaxPath, out IntPtr pfd, int fFlags);
        void GetIDList(out IntPtr ppidl);
        void SetIDList(IntPtr pidl);
        void GetDescription([Out, MarshalAs(UnmanagedType.LPWStr)] System.Text.StringBuilder pszName, int cchMaxName);
        void SetDescription([MarshalAs(UnmanagedType.LPWStr)] string pszName);
        void GetWorkingDirectory([Out, MarshalAs(UnmanagedType.LPWStr)] System.Text.StringBuilder pszDir, int cchMaxPath);
        void SetWorkingDirectory([MarshalAs(UnmanagedType.LPWStr)] string pszDir);
        void GetArguments([Out, MarshalAs(UnmanagedType.LPWStr)] System.Text.StringBuilder pszArgs, int cchMaxPath);
        void SetArguments([MarshalAs(UnmanagedType.LPWStr)] string pszArgs);
        void GetHotkey(out short pwHotkey);
        void SetHotkey(short wHotkey);
        void GetShowCmd(out int piShowCmd);
        void SetShowCmd(int iShowCmd);
        void GetIconLocation([Out, MarshalAs(UnmanagedType.LPWStr)] System.Text.StringBuilder pszIconPath, int cchIconPath, out int piIcon);
        void SetIconLocation([MarshalAs(UnmanagedType.LPWStr)] string pszIconPath, int iIcon);
        void SetRelativePath([MarshalAs(UnmanagedType.LPWStr)] string pszPathRel, int dwReserved);
        void Resolve(IntPtr hwnd, int fFlags);
        void SetPath([MarshalAs(UnmanagedType.LPWStr)] string pszFile);
    }
}
