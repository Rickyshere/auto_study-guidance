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
        private readonly WebView2 _webView;
        private readonly Panel _topBar;
        private readonly Label _statusLabel;
        private readonly Panel _loadingPanel;
        private readonly Label _loadingLabel;
        private readonly Button _refreshBtn;
        private readonly Button _dataDirBtn;
        private readonly Button _printBtn;

        private string _projectRoot;
        private Process _ownedBackendProc;
        private bool _closing;

        public MainWindow()
        {
            _projectRoot = ResolveProjectRoot();

            Text = "Auto Study Guidance - 桌面独立版";
            Width = 1440;
            Height = 900;
            MinimumSize = new Size(1060, 700);
            StartPosition = FormStartPosition.CenterScreen;
            BackColor = Color.FromArgb(242, 242, 247);

            _topBar = new Panel();
            _topBar.Dock = DockStyle.Top;
            _topBar.Height = 36;
            _topBar.BackColor = Color.FromArgb(248, 250, 252);
            _topBar.Padding = new Padding(10, 4, 10, 4);

            var titleLbl = new Label();
            titleLbl.Text = "Auto Study Guidance 独立桌面端";
            titleLbl.Font = new Font("Microsoft YaHei UI", 9.5f, FontStyle.Bold);
            titleLbl.ForeColor = Color.FromArgb(28, 28, 30);
            titleLbl.AutoSize = true;
            titleLbl.Location = new Point(12, 8);

            _statusLabel = new Label();
            _statusLabel.Text = "正在检测本地服务...";
            _statusLabel.Font = new Font("Microsoft YaHei UI", 8.5f, FontStyle.Regular);
            _statusLabel.ForeColor = Color.FromArgb(99, 99, 102);
            _statusLabel.AutoSize = true;
            _statusLabel.Location = new Point(240, 10);

            _printBtn = CreateToolButton("打印当前页", new Point(0, 5));
            _printBtn.Anchor = AnchorStyles.Top | AnchorStyles.Right;
            _printBtn.Location = new Point(ClientSize.Width - 310, 5);
            _printBtn.Click += new EventHandler(OnPrintClicked);

            _dataDirBtn = CreateToolButton("项目与导出目录", new Point(0, 5));
            _dataDirBtn.Anchor = AnchorStyles.Top | AnchorStyles.Right;
            _dataDirBtn.Location = new Point(ClientSize.Width - 205, 5);
            _dataDirBtn.Click += new EventHandler(OnOpenDataDirClicked);

            _refreshBtn = CreateToolButton("刷新", new Point(0, 5));
            _refreshBtn.Anchor = AnchorStyles.Top | AnchorStyles.Right;
            _refreshBtn.Width = 72;
            _refreshBtn.Location = new Point(ClientSize.Width - 84, 5);
            _refreshBtn.Click += new EventHandler(OnRefreshClicked);

            _topBar.Controls.Add(titleLbl);
            _topBar.Controls.Add(_statusLabel);
            _topBar.Controls.Add(_printBtn);
            _topBar.Controls.Add(_dataDirBtn);
            _topBar.Controls.Add(_refreshBtn);

            _webView = new WebView2();
            _webView.Dock = DockStyle.Fill;

            _loadingPanel = new Panel();
            _loadingPanel.Dock = DockStyle.Fill;
            _loadingPanel.BackColor = Color.White;

            _loadingLabel = new Label();
            _loadingLabel.Text = "正在静默初始化 Auto Study Guidance 引擎并加载桌面工作台，请稍候...";
            _loadingLabel.Font = new Font("Microsoft YaHei UI", 11f, FontStyle.Regular);
            _loadingLabel.ForeColor = Color.FromArgb(51, 65, 85);
            _loadingLabel.TextAlign = ContentAlignment.MiddleCenter;
            _loadingLabel.Dock = DockStyle.Fill;
            _loadingPanel.Controls.Add(_loadingLabel);

            Controls.Add(_loadingPanel);
            Controls.Add(_webView);
            Controls.Add(_topBar);

            Load += new EventHandler(OnFormLoad);
            FormClosing += new FormClosingEventHandler(OnWindowClosing);
        }

        private static Button CreateToolButton(string text, Point loc)
        {
            var btn = new Button();
            btn.Text = text;
            btn.Font = new Font("Microsoft YaHei UI", 8.5f, FontStyle.Regular);
            btn.Height = 25;
            btn.Width = 100;
            btn.Location = loc;
            btn.FlatStyle = FlatStyle.Flat;
            btn.FlatAppearance.BorderColor = Color.FromArgb(210, 214, 220);
            btn.BackColor = Color.White;
            btn.ForeColor = Color.FromArgb(28, 28, 30);
            btn.Cursor = Cursors.Hand;
            return btn;
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
                    SetStatusSafe("正在后台静默启动 FastAPI 服务...");
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

                SetStatusSafe("服务已就绪 · http://127.0.0.1:8000");
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
            }
        }

        private void OnNavigationCompleted(object sender, CoreWebView2NavigationCompletedEventArgs e)
        {
            _loadingPanel.Visible = false;
            _webView.BringToFront();
            _topBar.BringToFront();
            SetStatusSafe(e.IsSuccess ? "独立桌面模式运行中 · 非浏览器内核承载" : "页面加载完成（存在网络提示）");
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
                SetStatusSafe("正在导出保存：" + Path.GetFileName(target));
            }
            catch
            {
                // fallback to default WebView2 download behavior
            }
        }

        private void OnRefreshClicked(object sender, EventArgs e)
        {
            if (_webView.CoreWebView2 != null)
            {
                _webView.CoreWebView2.Reload();
            }
        }

        private void OnOpenDataDirClicked(object sender, EventArgs e)
        {
            string downloads = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
                "Downloads"
            );
            if (Directory.Exists(downloads))
            {
                Process.Start("explorer.exe", downloads);
            }
        }

        private void OnPrintClicked(object sender, EventArgs e)
        {
            if (_webView.CoreWebView2 != null)
            {
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
            if (_closing || IsDisposed) return;
            try
            {
                if (InvokeRequired)
                {
                    BeginInvoke(new Action<string>(SetStatusSafe), text);
                }
                else
                {
                    _statusLabel.Text = text;
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
