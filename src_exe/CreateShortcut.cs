using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;

namespace ShortcutCreator
{
    class Program
    {
        static void Main(string[] args)
        {
            try
            {
                string desktop = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
                string shortcutPath = Path.Combine(desktop, "نظام شركة رواسي عدن.lnk");
                
                string appDir = AppDomain.CurrentDomain.BaseDirectory;
                if (!File.Exists(Path.Combine(appDir, "server", "server.js")))
                {
                    string appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
                    string regFile = Path.Combine(appData, "RawasiAden", "app_dir.txt");
                    if (File.Exists(regFile))
                    {
                        string saved = File.ReadAllText(regFile).Trim();
                        if (Directory.Exists(saved)) appDir = saved;
                    }
                    if (!File.Exists(Path.Combine(appDir, "server", "server.js")))
                    {
                        appDir = @"C:\Users\a.ba3baid\رواسي عدن";
                    }
                }

                string targetExe = Path.Combine(appDir, "RawasiAden.exe");
                if (!File.Exists(targetExe))
                {
                    targetExe = Path.Combine(appDir, "تشغيل نظام رواسي عدن.exe");
                }
                string iconPath = Path.Combine(appDir, "images", "app.ico");

                IShellLink link = (IShellLink)new ShellLink();
                link.SetDescription("نظام شركة رواسي عدن للهندسة والمقاولات");
                link.SetPath(targetExe);
                link.SetWorkingDirectory(appDir);
                if (File.Exists(iconPath))
                {
                    link.SetIconLocation(iconPath, 0);
                }

                IPersistFile file = (IPersistFile)link;
                file.Save(shortcutPath, false);

                Console.WriteLine("SUCCESS: Shortcut created at " + shortcutPath);
            }
            catch (Exception ex)
            {
                Console.WriteLine("Error: " + ex.Message);
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
