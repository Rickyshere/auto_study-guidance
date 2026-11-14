using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace AutoStudyGuidanceDesktop
{
    internal static class Program
    {
        [STAThread]
        private static void Main()
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new MainWindow());
        }
    }

    internal sealed class MainWindow : Form
    {
        private const string ServerUrl = "http://127.0.0.1:8000";
        private const string ReadyTitle = "Auto Study Guidance v1.0.0 · 智能导学与题库工作台";

        private readonly WebView2 _webView;
        private readonly Panel _loadingPanel;
        private readonly Label _loadingLabel;

        private string _projectRoot;
        private Process _ownedBackendProc;
        private bool _closing;

        public MainWindow()
        {
            _projectRoot = ResolveProjectRoot();

            Text = ReadyTitle;
            Width = 1440;
            Height = 900;
            MinimumSize = new Size(1060, 700);
            StartPosition = FormStartPosition.CenterScreen;
            BackColor = Color.FromArgb(242, 242, 247);
            KeyPreview = true;

            try
            {
                Icon exeIcon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
                if (exeIcon != null)
                {
                    Icon = exeIcon;
                }
            }
            catch
            {
                // fallback to default form icon
            }

            _webView = new WebView2();
            _webView.Dock = DockStyle.Fill;

            _loadingPanel = new Panel();
            _loadingPanel.Dock = DockStyle.Fill;
            _loadingPanel.BackColor = Color.FromArgb(248, 250, 252);

            _loadingLabel = new Label();
            _loadingLabel.Text = "正在静默初始化 Auto Study Guidance 引擎并加载工作台，请稍候...";
            _loadingLabel.Font = new Font("Microsoft YaHei UI", 11f, FontStyle.Regular);
            _loadingLabel.ForeColor = Color.FromArgb(30, 41, 59);
            _loadingLabel.TextAlign = ContentAlignment.MiddleCenter;
            _loadingLabel.Dock = DockStyle.Fill;
            _loadingPanel.Controls.Add(_loadingLabel);

            Controls.Add(_webView);
            Controls.Add(_loadingPanel);
            _loadingPanel.BringToFront();

            Load += new EventHandler(OnFormLoad);
            KeyDown += new KeyEventHandler(OnWindowKeyDown);
            FormClosing += new FormClosingEventHandler(OnWindowClosing);
        }

        private static string ResolveProjectRoot()
        {
            string cur = AppDomain.CurrentDomain.BaseDirectory;
            for (int i = 0; i < 4; i++)
            {
                if (File.Exists(Path.Combine(cur, "backend", "app", "main.py")))
                {
                    return cur;
                }
                DirectoryInfo parent = Directory.GetParent(cur.TrimEnd(Path.DirectorySeparatorChar));
                if (parent == null) break;
                cur = parent.FullName;
            }
            string fallback = @"D:\auto_study_guidance";
            return Directory.Exists(fallback) ? fallback : AppDomain.CurrentDomain.BaseDirectory;
        }

        private void OnFormLoad(object sender, EventArgs e)
        {
            var worker = new Thread(new ThreadStart(BootstrapAndLaunch));
            worker.IsBackground = true;
            worker.Start();
        }

        private void BootstrapAndLaunch()
        {
            try
            {
                if (!CheckBackendAlive())
                {
                    SetStatusSafe("正在后台静默启动本地服务...");
                    StartBackendSilent();

                    bool ready = false;
                    for (int i = 0; i < 45 && !_closing; i++)
                    {
                        if (CheckBackendAlive())
                        {
                            ready = true;
                            break;
                        }
                        Thread.Sleep(500);
                    }
                    if (!ready)
                    {
                        SetLoadingTextSafe("后端服务启动超时，请确认 D:\\auto_study_guidance\\backend\\.venv 存在，或检查端口 8000 是否被占用。");
                        SetStatusSafe("后端启动失败");
                        return;
                    }
                }

                SetStatusSafe("正在加载工作台...");
                BeginInvoke(new MethodInvoker(InitializeWebViewUi));
            }
            catch (Exception ex)
            {
                SetLoadingTextSafe("桌面端启动失败：" + ex.Message);
                SetStatusSafe("启动异常");
            }
        }

        private bool CheckBackendAlive()
        {
            try
            {
                var req = (HttpWebRequest)WebRequest.Create(ServerUrl + "/api/health");
                req.Method = "GET";
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

        private void StartBackendSilent()
        {
            string backendDir = Path.Combine(_projectRoot, "backend");
            string pyExe = Path.Combine(backendDir, ".venv", "Scripts", "python.exe");
            if (!File.Exists(pyExe))
            {
                pyExe = "python";
            }

            var psi = new ProcessStartInfo();
            psi.FileName = pyExe;
            psi.Arguments = "-m uvicorn app.main:app --host 127.0.0.1 --port 8000";
            psi.WorkingDirectory = backendDir;
            psi.UseShellExecute = false;
            psi.CreateNoWindow = true;
            psi.WindowStyle = ProcessWindowStyle.Hidden;

            _ownedBackendProc = Process.Start(psi);
        }

        private async void InitializeWebViewUi()
        {
            try
            {
                string userData = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "AutoStudyGuidance",
                    "WebView2Data"
                );
                Directory.CreateDirectory(userData);
                var env = await CoreWebView2Environment.CreateAsync(null, userData);
                await _webView.EnsureCoreWebView2Async(env);

                _webView.CoreWebView2.Settings.IsStatusBarEnabled = false;
                _webView.CoreWebView2.Settings.AreDefaultContextMenusEnabled = true;
                _webView.CoreWebView2.Settings.IsZoomControlEnabled = true;

                _webView.CoreWebView2.NewWindowRequested += new EventHandler<CoreWebView2NewWindowRequestedEventArgs>(OnNewWindowRequested);
                _webView.CoreWebView2.DownloadStarting += new EventHandler<CoreWebView2DownloadStartingEventArgs>(OnDownloadStarting);
                _webView.CoreWebView2.NavigationCompleted += new EventHandler<CoreWebView2NavigationCompletedEventArgs>(OnNavigationCompleted);

                _webView.CoreWebView2.Navigate(ServerUrl);
            }
            catch (Exception ex)
            {
                _loadingLabel.Text = "WebView2 初始化失败：" + ex.Message + "\n请确认系统已安装 Microsoft Edge WebView2 Runtime。";
                SetStatusSafe("WebView2 初始化失败");
            }
        }

        private void OnNavigationCompleted(object sender, CoreWebView2NavigationCompletedEventArgs e)
        {
            _loadingPanel.Visible = false;
            _webView.BringToFront();
            SetTitleSafe(e.IsSuccess ? ReadyTitle : (ReadyTitle + " (页面加载提示)"));
        }

        private void OnNewWindowRequested(object sender, CoreWebView2NewWindowRequestedEventArgs e)
        {
            e.Handled = true;
            if (!string.IsNullOrEmpty(e.Uri))
            {
                _webView.CoreWebView2.Navigate(e.Uri);
            }
        }

        private void OnDownloadStarting(object sender, CoreWebView2DownloadStartingEventArgs e)
        {
            try
            {
                string suggested = Path.GetFileName(e.ResultFilePath);
                string downloads = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
                    "Downloads"
                );
                Directory.CreateDirectory(downloads);
                string target = Path.Combine(downloads, suggested);
                int n = 1;
                string stem = Path.GetFileNameWithoutExtension(suggested);
                string ext = Path.GetExtension(suggested);
                while (File.Exists(target))
                {
                    target = Path.Combine(downloads, string.Format("{0} ({1}){2}", stem, n, ext));
                    n++;
                }
                e.ResultFilePath = target;
                e.Handled = false;
            }
            catch
            {
                // fallback to default WebView2 download behavior
            }
        }

        private void OnWindowKeyDown(object sender, KeyEventArgs e)
        {
            if (_webView.CoreWebView2 == null) return;

            if (e.KeyCode == Keys.F5)
            {
                e.Handled = true;
                _webView.CoreWebView2.Reload();
            }
            else if (e.Control && e.KeyCode == Keys.P)
            {
                e.Handled = true;
                _webView.CoreWebView2.ExecuteScriptAsync("window.print();");
            }
        }

        private void OnWindowClosing(object sender, FormClosingEventArgs e)
        {
            _closing = true;
            if (_ownedBackendProc != null)
            {
                try
                {
                    if (!_ownedBackendProc.HasExited)
                    {
                        _ownedBackendProc.Kill();
                    }
                }
                catch
                {
                    // ignore cleanup failure
                }
            }
        }

        private void SetStatusSafe(string text)
        {
            SetTitleSafe("Auto Study Guidance — " + text);
        }

        private void SetTitleSafe(string titleText)
        {
            if (_closing || IsDisposed) return;
            try
            {
                if (InvokeRequired)
                {
                    BeginInvoke(new Action<string>(SetTitleSafe), titleText);
                }
                else
                {
                    Text = titleText;
                }
            }
            catch
            {
                // ignore when closing
            }
        }

        private void SetLoadingTextSafe(string text)
        {
            if (_closing || IsDisposed) return;
            try
            {
                if (InvokeRequired)
                {
                    BeginInvoke(new Action<string>(SetLoadingTextSafe), text);
                }
                else
                {
                    _loadingLabel.Text = text;
                }
            }
            catch
            {
                // ignore when closing
            }
        }
    }
}
