using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace AutoStudyGuidanceDesktop
{
    internal static class Program
    {
        internal static bool ForceEnvDialog = false;

        [STAThread]
        private static void Main(string[] args)
        {
            try
            {
                ServicePointManager.SecurityProtocol = (SecurityProtocolType)(3072 | 768);
            }
            catch
            {
                // ignore on legacy runtimes
            }

            if (args != null)
            {
                for (int i = 0; i < args.Length; i++)
                {
                    if (string.Equals(args[i], "--check-env-json", StringComparison.OrdinalIgnoreCase))
                    {
                        string root = MainWindow.ResolveProjectRoot();
                        EnvironmentCheckResult check = EnvironmentInspector.Check(root);
                        Console.WriteLine(check.ToJson());
                        Environment.ExitCode = 0;
                        return;
                    }
                    if (string.Equals(args[i], "--force-env-dialog", StringComparison.OrdinalIgnoreCase))
                    {
                        ForceEnvDialog = true;
                    }
                }
            }

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new MainWindow());
        }
    }

    internal sealed class EnvironmentCheckResult
    {
        public string ProjectRoot = "";
        public bool BackendFound = false;
        public bool PythonReady = false;
        public string PythonVersion = "";
        public string PythonExe = "";
        public bool VenvReady = false;
        public string VenvPythonExe = "";
        public bool DepsReady = false;
        public List<string> MissingPackages = new List<string>();
        public bool WebView2Ready = false;
        public string WebView2Version = "";
        public bool AllReady = false;

        public string ToJson()
        {
            var sb = new StringBuilder();
            sb.Append("{");
            sb.AppendFormat("\"project_root\":\"{0}\",", JsonEscape(ProjectRoot));
            sb.AppendFormat("\"backend_found\":{0},", BackendFound ? "true" : "false");
            sb.AppendFormat("\"all_ready\":{0},", AllReady ? "true" : "false");
            sb.AppendFormat("\"python_ready\":{0},", PythonReady ? "true" : "false");
            sb.AppendFormat("\"python_version\":\"{0}\",", JsonEscape(PythonVersion));
            sb.AppendFormat("\"python_exe\":\"{0}\",", JsonEscape(PythonExe));
            sb.AppendFormat("\"venv_ready\":{0},", VenvReady ? "true" : "false");
            sb.AppendFormat("\"venv_python_exe\":\"{0}\",", JsonEscape(VenvPythonExe));
            sb.AppendFormat("\"deps_ready\":{0},", DepsReady ? "true" : "false");
            sb.Append("\"missing_packages\":[");
            for (int i = 0; i < MissingPackages.Count; i++)
            {
                if (i > 0) sb.Append(",");
                sb.AppendFormat("\"{0}\"", JsonEscape(MissingPackages[i]));
            }
            sb.Append("],");
            sb.AppendFormat("\"webview2_ready\":{0},", WebView2Ready ? "true" : "false");
            sb.AppendFormat("\"webview2_version\":\"{0}\"", JsonEscape(WebView2Version));
            sb.Append("}");
            return sb.ToString();
        }

        private static string JsonEscape(string s)
        {
            if (string.IsNullOrEmpty(s)) return "";
            return s.Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\r", "").Replace("\n", "\\n");
        }
    }

    internal static class EnvironmentInspector
    {
        internal static readonly string[] CorePackagesFallback = new string[]
        {
            "fastapi>=0.115.0",
            "uvicorn[standard]>=0.32.0",
            "python-multipart>=0.0.12",
            "sse-starlette>=2.1.0",
            "pydantic>=2.9.0",
            "pymupdf>=1.24.10",
            "python-pptx>=1.0.2",
            "python-docx>=1.1.2",
            "ebooklib>=0.18",
            "beautifulsoup4>=4.12.3",
            "pillow>=10.4.0",
            "httpx>=0.27.2",
            "openai>=1.52.0"
        };

        private static readonly string[] RequiredModulePairs = new string[]
        {
            "fastapi:fastapi",
            "uvicorn:uvicorn",
            "python-multipart:multipart",
            "sse-starlette:sse_starlette",
            "pydantic:pydantic",
            "pymupdf:fitz",
            "python-pptx:pptx",
            "python-docx:docx",
            "ebooklib:ebooklib",
            "beautifulsoup4:bs4",
            "pillow:PIL",
            "httpx:httpx",
            "openai:openai"
        };

        internal static EnvironmentCheckResult Check(string projectRoot)
        {
            var res = new EnvironmentCheckResult();
            res.ProjectRoot = projectRoot ?? "";

            string backendDir = Path.Combine(res.ProjectRoot, "backend");
            string mainPy = Path.Combine(backendDir, "app", "main.py");
            res.BackendFound = File.Exists(mainPy);

            // 1. Check WebView2 Runtime
            try
            {
                string wvVer = CoreWebView2Environment.GetAvailableBrowserVersionString();
                if (!string.IsNullOrEmpty(wvVer))
                {
                    res.WebView2Ready = true;
                    res.WebView2Version = wvVer.Trim();
                }
            }
            catch
            {
                res.WebView2Ready = false;
            }

            // 2. Check Venv & System Python
            string venvPy = Path.Combine(backendDir, ".venv", "Scripts", "python.exe");
            res.VenvPythonExe = venvPy;
            res.VenvReady = File.Exists(venvPy);

            string sysPy;
            string sysVer;
            if (FindValidPython(venvPy, out sysPy, out sysVer))
            {
                res.PythonReady = true;
                res.PythonExe = sysPy;
                res.PythonVersion = sysVer;
            }

            // 3. Check Python packages inside backend/.venv (or detected python if venv missing)
            if (res.VenvReady)
            {
                List<string> missing;
                res.DepsReady = CheckPythonPackages(venvPy, out missing);
                res.MissingPackages = missing;
            }
            else
            {
                res.DepsReady = false;
                for (int i = 0; i < RequiredModulePairs.Length; i++)
                {
                    res.MissingPackages.Add(RequiredModulePairs[i].Split(':')[0]);
                }
            }

            res.AllReady = res.BackendFound && res.PythonReady && res.VenvReady && res.DepsReady && res.WebView2Ready;
            return res;
        }

        internal static string ResolveBestPython(string projectRoot)
        {
            string venvPy = Path.Combine(projectRoot ?? "", "backend", ".venv", "Scripts", "python.exe");
            if (File.Exists(venvPy)) return venvPy;

            string pyExe;
            string pyVer;
            if (FindValidPython(null, out pyExe, out pyVer))
            {
                return pyExe;
            }
            return "python";
        }

        internal static bool FindValidPython(string preferredPyExe, out string exePath, out string versionStr)
        {
            var candidates = new List<string>();
            if (!string.IsNullOrEmpty(preferredPyExe))
            {
                candidates.Add(preferredPyExe);
            }

            string localPyDir = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "Programs",
                "Python"
            );
            AddPythonCandidatesFromDir(localPyDir, candidates);

            string progPyDir = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),
                "Python"
            );
            AddPythonCandidatesFromDir(progPyDir, candidates);

            try
            {
                string pf = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
                if (Directory.Exists(pf))
                {
                    string[] dirs = Directory.GetDirectories(pf, "Python3*");
                    for (int i = 0; i < dirs.Length; i++)
                    {
                        candidates.Add(Path.Combine(dirs[i], "python.exe"));
                    }
                }
            }
            catch
            {
                // ignore
            }

            candidates.Add("python");
            candidates.Add("python3");

            var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            for (int i = 0; i < candidates.Count; i++)
            {
                string c = candidates[i];
                if (string.IsNullOrEmpty(c) || seen.Contains(c)) continue;
                seen.Add(c);

                bool isBareCommand = !c.Contains("\\") && !c.Contains("/");
                if (!isBareCommand && !File.Exists(c)) continue;

                string verOut;
                if (TryGetPythonVersion(c, out verOut))
                {
                    exePath = ResolveExecutableFullPath(c);
                    versionStr = verOut;
                    return true;
                }
            }

            exePath = "";
            versionStr = "";
            return false;
        }

        private static void AddPythonCandidatesFromDir(string baseDir, List<string> target)
        {
            try
            {
                if (!Directory.Exists(baseDir)) return;
                string[] dirs = Directory.GetDirectories(baseDir, "Python3*");
                Array.Sort(dirs);
                Array.Reverse(dirs);
                for (int i = 0; i < dirs.Length; i++)
                {
                    target.Add(Path.Combine(dirs[i], "python.exe"));
                }
            }
            catch
            {
                // ignore
            }
        }

        private static string ResolveExecutableFullPath(string cmd)
        {
            if (cmd.Contains("\\") || cmd.Contains("/")) return cmd;
            try
            {
                string output;
                int code = RunProcessCapture(cmd, "-c \"import sys; print(sys.executable)\"", null, 5000, out output);
                if (code == 0 && !string.IsNullOrEmpty(output))
                {
                    string line = output.Trim().Split(new char[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries)[0].Trim();
                    if (File.Exists(line)) return line;
                }
            }
            catch
            {
                // fallback
            }
            return cmd;
        }

        private static bool TryGetPythonVersion(string pyExe, out string versionStr)
        {
            versionStr = "";
            string outText;
            int exitCode = RunProcessCapture(pyExe, "--version", null, 5000, out outText);
            if (exitCode != 0 || string.IsNullOrEmpty(outText)) return false;

            Match m = Regex.Match(outText, @"Python\s+(\d+)\.(\d+)(?:\.(\d+))?");
            if (!m.Success) return false;

            int major = 0;
            int minor = 0;
            int.TryParse(m.Groups[1].Value, out major);
            int.TryParse(m.Groups[2].Value, out minor);
            if (major < 3 || (major == 3 && minor < 9)) return false;

            versionStr = m.Value.Trim();
            return true;
        }

        private static bool CheckPythonPackages(string pyExe, out List<string> missingPackages)
        {
            missingPackages = new List<string>();
            if (!File.Exists(pyExe))
            {
                for (int i = 0; i < RequiredModulePairs.Length; i++)
                {
                    missingPackages.Add(RequiredModulePairs[i].Split(':')[0]);
                }
                return false;
            }

            string pyCode =
                "import importlib\n" +
                "pairs = [('fastapi','fastapi'),('uvicorn','uvicorn'),('python-multipart','multipart'),('sse-starlette','sse_starlette'),('pydantic','pydantic'),('pymupdf','fitz'),('python-pptx','pptx'),('python-docx','docx'),('ebooklib','ebooklib'),('beautifulsoup4','bs4'),('pillow','PIL'),('httpx','httpx'),('openai','openai')]\n" +
                "missing = []\n" +
                "for pkg, mod in pairs:\n" +
                "    ok = False\n" +
                "    try:\n" +
                "        importlib.import_module(mod)\n" +
                "        ok = True\n" +
                "    except Exception:\n" +
                "        if pkg == 'python-multipart':\n" +
                "            try:\n" +
                "                importlib.import_module('python_multipart')\n" +
                "                ok = True\n" +
                "            except Exception:\n" +
                "                ok = False\n" +
                "    if not ok:\n" +
                "        missing.append(pkg)\n" +
                "print('ASG_MISSING:' + ','.join(missing))\n";

            string encodedScript = Convert.ToBase64String(Encoding.UTF8.GetBytes(pyCode));
            string cmdArgs = string.Format("-c \"import base64; exec(base64.b64decode('{0}').decode('utf-8'))\"", encodedScript);

            string output;
            int code = RunProcessCapture(pyExe, cmdArgs, Path.GetDirectoryName(Path.GetDirectoryName(Path.GetDirectoryName(pyExe))), 15000, out output);
            if (code != 0 || string.IsNullOrEmpty(output))
            {
                for (int i = 0; i < RequiredModulePairs.Length; i++)
                {
                    missingPackages.Add(RequiredModulePairs[i].Split(':')[0]);
                }
                return false;
            }

            Match m = Regex.Match(output, @"ASG_MISSING:(.*)");
            if (!m.Success)
            {
                for (int i = 0; i < RequiredModulePairs.Length; i++)
                {
                    missingPackages.Add(RequiredModulePairs[i].Split(':')[0]);
                }
                return false;
            }

            string raw = m.Groups[1].Value.Trim();
            if (string.IsNullOrEmpty(raw))
            {
                return true;
            }

            string[] parts = raw.Split(new char[] { ',' }, StringSplitOptions.RemoveEmptyEntries);
            for (int i = 0; i < parts.Length; i++)
            {
                missingPackages.Add(parts[i].Trim());
            }
            return missingPackages.Count == 0;
        }

        internal static int RunProcessCapture(string fileName, string arguments, string workingDir, int timeoutMs, out string combinedOutput)
        {
            combinedOutput = "";
            try
            {
                var psi = new ProcessStartInfo();
                psi.FileName = fileName;
                psi.Arguments = arguments ?? "";
                if (!string.IsNullOrEmpty(workingDir) && Directory.Exists(workingDir))
                {
                    psi.WorkingDirectory = workingDir;
                }
                psi.UseShellExecute = false;
                psi.CreateNoWindow = true;
                psi.RedirectStandardOutput = true;
                psi.RedirectStandardError = true;
                psi.StandardOutputEncoding = Encoding.UTF8;
                psi.StandardErrorEncoding = Encoding.UTF8;

                using (var proc = Process.Start(psi))
                {
                    if (proc == null) return -1;
                    string stdout = proc.StandardOutput.ReadToEnd();
                    string stderr = proc.StandardError.ReadToEnd();
                    if (!proc.WaitForExit(timeoutMs))
                    {
                        try { proc.Kill(); } catch { }
                        combinedOutput = stdout + "\n" + stderr;
                        return -2;
                    }
                    combinedOutput = (stdout + "\n" + stderr).Trim();
                    return proc.ExitCode;
                }
            }
            catch (Exception ex)
            {
                combinedOutput = ex.Message;
                return -1;
            }
        }
    }

    internal sealed class EnvironmentSetupDialog : Form
    {
        private readonly string _projectRoot;
        private EnvironmentCheckResult _checkResult;

        private readonly Label _headerTitle;
        private readonly Label _headerSub;
        private readonly Label _pythonRow;
        private readonly Label _venvRow;
        private readonly Label _depsRow;
        private readonly Label _webViewRow;
        private readonly CheckBox _useMirrorCheck;
        private readonly ProgressBar _progressBar;
        private readonly Label _statusLabel;
        private readonly TextBox _logBox;
        private readonly Button _installBtn;
        private readonly Button _recheckBtn;
        private readonly Button _skipBtn;
        private readonly Button _cancelBtn;

        private volatile bool _installing = false;
        private volatile bool _abortRequested = false;

        internal EnvironmentCheckResult LatestResult
        {
            get { return _checkResult; }
        }

        internal EnvironmentSetupDialog(string projectRoot, EnvironmentCheckResult initialResult)
        {
            _projectRoot = projectRoot ?? "";
            _checkResult = initialResult ?? new EnvironmentCheckResult();

            Text = "Auto Study Guidance v1.1.0 · 环境与依赖自检";
            Width = 700;
            Height = 590;
            MinimumSize = new Size(640, 520);
            StartPosition = FormStartPosition.CenterParent;
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            MinimizeBox = false;
            BackColor = Color.FromArgb(248, 250, 252);
            Font = new Font("Microsoft YaHei UI", 9.5f, FontStyle.Regular);

            _headerTitle = new Label();
            _headerTitle.Location = new Point(22, 16);
            _headerTitle.Size = new Size(640, 26);
            _headerTitle.Font = new Font("Microsoft YaHei UI", 12f, FontStyle.Bold);
            _headerTitle.ForeColor = Color.FromArgb(15, 23, 42);

            _headerSub = new Label();
            _headerSub.Location = new Point(22, 46);
            _headerSub.Size = new Size(640, 36);
            _headerSub.Font = new Font("Microsoft YaHei UI", 9f, FontStyle.Regular);
            _headerSub.ForeColor = Color.FromArgb(71, 85, 105);

            var statusPanel = new Panel();
            statusPanel.Location = new Point(22, 90);
            statusPanel.Size = new Size(640, 128);
            statusPanel.BackColor = Color.White;
            statusPanel.BorderStyle = BorderStyle.FixedSingle;

            _pythonRow = CreateStatusRow(statusPanel, 10);
            _venvRow = CreateStatusRow(statusPanel, 38);
            _depsRow = CreateStatusRow(statusPanel, 66);
            _webViewRow = CreateStatusRow(statusPanel, 94);

            _useMirrorCheck = new CheckBox();
            _useMirrorCheck.Location = new Point(22, 228);
            _useMirrorCheck.Size = new Size(640, 24);
            _useMirrorCheck.Checked = true;
            _useMirrorCheck.Text = "优先使用国内高速镜像下载（清华 Tuna PyPI / 国内 Python 镜像，推荐）";
            _useMirrorCheck.ForeColor = Color.FromArgb(30, 41, 59);

            _statusLabel = new Label();
            _statusLabel.Location = new Point(22, 258);
            _statusLabel.Size = new Size(640, 20);
            _statusLabel.Font = new Font("Microsoft YaHei UI", 9f, FontStyle.Bold);
            _statusLabel.ForeColor = Color.FromArgb(59, 91, 219);
            _statusLabel.Text = "等待操作...";

            _progressBar = new ProgressBar();
            _progressBar.Location = new Point(22, 282);
            _progressBar.Size = new Size(640, 16);
            _progressBar.Minimum = 0;
            _progressBar.Maximum = 100;
            _progressBar.Value = 0;

            _logBox = new TextBox();
            _logBox.Location = new Point(22, 308);
            _logBox.Size = new Size(640, 178);
            _logBox.Multiline = true;
            _logBox.ReadOnly = true;
            _logBox.ScrollBars = ScrollBars.Vertical;
            _logBox.BackColor = Color.FromArgb(15, 23, 42);
            _logBox.ForeColor = Color.FromArgb(226, 232, 240);
            _logBox.Font = new Font("Consolas", 9f, FontStyle.Regular);

            _recheckBtn = new Button();
            _recheckBtn.Location = new Point(22, 502);
            _recheckBtn.Size = new Size(105, 34);
            _recheckBtn.Text = "重新检测";
            _recheckBtn.FlatStyle = FlatStyle.System;
            _recheckBtn.Click += new EventHandler(OnRecheckClicked);

            _skipBtn = new Button();
            _skipBtn.Location = new Point(136, 502);
            _skipBtn.Size = new Size(128, 34);
            _skipBtn.Text = "跳过并尝试启动";
            _skipBtn.FlatStyle = FlatStyle.System;
            _skipBtn.Click += new EventHandler(OnSkipClicked);

            _cancelBtn = new Button();
            _cancelBtn.Location = new Point(352, 502);
            _cancelBtn.Size = new Size(92, 34);
            _cancelBtn.Text = "退出程序";
            _cancelBtn.FlatStyle = FlatStyle.System;
            _cancelBtn.Click += new EventHandler(OnCancelClicked);

            _installBtn = new Button();
            _installBtn.Location = new Point(454, 500);
            _installBtn.Size = new Size(208, 38);
            _installBtn.BackColor = Color.FromArgb(59, 91, 219);
            _installBtn.ForeColor = Color.White;
            _installBtn.FlatStyle = FlatStyle.Flat;
            _installBtn.FlatAppearance.BorderSize = 0;
            _installBtn.Font = new Font("Microsoft YaHei UI", 9.5f, FontStyle.Bold);
            _installBtn.Click += new EventHandler(OnPrimaryActionClicked);

            Controls.Add(_headerTitle);
            Controls.Add(_headerSub);
            Controls.Add(statusPanel);
            Controls.Add(_useMirrorCheck);
            Controls.Add(_statusLabel);
            Controls.Add(_progressBar);
            Controls.Add(_logBox);
            Controls.Add(_recheckBtn);
            Controls.Add(_skipBtn);
            Controls.Add(_cancelBtn);
            Controls.Add(_installBtn);

            FormClosing += new FormClosingEventHandler(OnDialogClosing);

            ApplyCheckResult(_checkResult);
            AppendLog("工作区根目录：" + (_projectRoot.Length > 0 ? _projectRoot : "(未定位)"));
        }

        private static Label CreateStatusRow(Panel parent, int top)
        {
            var lbl = new Label();
            lbl.Location = new Point(14, top);
            lbl.Size = new Size(612, 22);
            lbl.Font = new Font("Microsoft YaHei UI", 9f, FontStyle.Regular);
            parent.Controls.Add(lbl);
            return lbl;
        }

        private void ApplyCheckResult(EnvironmentCheckResult r)
        {
            _checkResult = r;

            if (r.AllReady)
            {
                _headerTitle.Text = "本地运行环境与依赖均已就绪";
                _headerSub.Text = "Python 运行时、独立虚拟环境 (.venv)、后端依赖包与 WebView2 组件均检查通过。";
                _installBtn.Text = "立即启动工作台";
                _installBtn.BackColor = Color.FromArgb(43, 138, 62);
                _statusLabel.Text = "所有必要环境和依赖均已就绪。";
                _statusLabel.ForeColor = Color.FromArgb(43, 138, 62);
                _progressBar.Value = 100;
            }
            else
            {
                _headerTitle.Text = "检测到本地缺少运行环境或依赖组件";
                _headerSub.Text = "首次启动或环境迁移时需补全 Python 环境与后端依赖包。您可点击下方按钮一键自动下载并安装：";
                _installBtn.Text = "一键下载并安装环境与依赖";
                _installBtn.BackColor = Color.FromArgb(59, 91, 219);
                _statusLabel.Text = "存在缺失项，请点击右侧「一键下载并安装环境与依赖」。";
                _statusLabel.ForeColor = Color.FromArgb(201, 42, 42);
            }

            SetRowText(
                _pythonRow,
                r.PythonReady,
                "1. Python 3 运行时 (>= 3.9)",
                r.PythonReady ? (r.PythonVersion + " · " + r.PythonExe) : "未检测到可用的 Python 3.9+（将自动下载 Python 3.11.9 安装）"
            );

            SetRowText(
                _venvRow,
                r.VenvReady,
                "2. 后端独立虚拟环境 (backend\\.venv)",
                r.VenvReady ? "已就绪" : "未创建（将自动使用 python -m venv 创建）"
            );

            string missingSummary = r.MissingPackages.Count > 0 ? string.Join(", ", r.MissingPackages.ToArray()) : "requirements.txt";
            SetRowText(
                _depsRow,
                r.DepsReady,
                "3. 后端 Python 依赖库 (requirements.txt)",
                r.DepsReady ? "全部核心依赖包均已安装" : ("缺失依赖：" + missingSummary)
            );

            SetRowText(
                _webViewRow,
                r.WebView2Ready,
                "4. Microsoft Edge WebView2 运行时",
                r.WebView2Ready ? ("已安装 · v" + r.WebView2Version) : "未检测到（将自动下载微软官方引导安装）"
            );

            if (!r.BackendFound)
            {
                AppendLog("[警告] 未在工作目录检测到 backend\\app\\main.py：" + _projectRoot);
            }
        }

        private static void SetRowText(Label lbl, bool ok, string title, string detail)
        {
            lbl.Text = string.Format("{0}  {1}：{2}", ok ? "[√ 已就绪]" : "[× 缺失]", title, detail);
            lbl.ForeColor = ok ? Color.FromArgb(43, 138, 62) : Color.FromArgb(201, 42, 42);
        }

        private void AppendLog(string line)
        {
            if (IsDisposed) return;
            if (InvokeRequired)
            {
                BeginInvoke(new Action<string>(AppendLog), line);
                return;
            }
            if (_logBox.TextLength > 0)
            {
                _logBox.AppendText(Environment.NewLine);
            }
            _logBox.AppendText(string.Format("[{0}] {1}", DateTime.Now.ToString("HH:mm:ss"), line));
            _logBox.SelectionStart = _logBox.TextLength;
            _logBox.ScrollToCaret();
        }

        private void SetProgressSafe(int pct, string status)
        {
            if (IsDisposed) return;
            if (InvokeRequired)
            {
                BeginInvoke(new Action<int, string>(SetProgressSafe), pct, status);
                return;
            }
            int clamped = Math.Max(0, Math.Min(100, pct));
            _progressBar.Value = clamped;
            _statusLabel.Text = status;
            _statusLabel.ForeColor = Color.FromArgb(59, 91, 219);
        }

        private void SetUiBusySafe(bool busy)
        {
            if (IsDisposed) return;
            if (InvokeRequired)
            {
                BeginInvoke(new Action<bool>(SetUiBusySafe), busy);
                return;
            }
            _installing = busy;
            _installBtn.Enabled = !busy;
            _recheckBtn.Enabled = !busy;
            _useMirrorCheck.Enabled = !busy;
            _skipBtn.Enabled = !busy;
        }

        private void OnRecheckClicked(object sender, EventArgs e)
        {
            if (_installing) return;
            AppendLog("正在重新检测本地环境与依赖...");
            EnvironmentCheckResult fresh = EnvironmentInspector.Check(_projectRoot);
            ApplyCheckResult(fresh);
            AppendLog(fresh.AllReady ? "检测完成：全部就绪。" : "检测完成：仍有缺失项。");
        }

        private void OnSkipClicked(object sender, EventArgs e)
        {
            if (_installing) return;
            DialogResult = DialogResult.Ignore;
            Close();
        }

        private void OnCancelClicked(object sender, EventArgs e)
        {
            if (_installing)
            {
                _abortRequested = true;
                AppendLog("正在尝试取消当前安装任务...");
                return;
            }
            DialogResult = DialogResult.Cancel;
            Close();
        }

        private void OnDialogClosing(object sender, FormClosingEventArgs e)
        {
            if (_installing)
            {
                _abortRequested = true;
                MessageBox.Show(this, "正在下载/安装运行环境，请等待当前步骤结束或稍后再关闭。", "正在安装", MessageBoxButtons.OK, MessageBoxIcon.Information);
                e.Cancel = true;
            }
        }

        private void OnPrimaryActionClicked(object sender, EventArgs e)
        {
            if (_installing) return;
            if (_checkResult.AllReady)
            {
                DialogResult = DialogResult.OK;
                Close();
                return;
            }

            bool useMirror = _useMirrorCheck.Checked;
            SetUiBusySafe(true);
            _abortRequested = false;

            var worker = new Thread(new ThreadStart(delegate
            {
                RunOneClickInstaller(useMirror);
            }));
            worker.IsBackground = true;
            worker.Start();
        }

        private void RunOneClickInstaller(bool useMirror)
        {
            try
            {
                string backendDir = Path.Combine(_projectRoot, "backend");
                if (!Directory.Exists(backendDir))
                {
                    throw new InvalidOperationException("未找到 backend 目录：" + backendDir + "。请将 AutoStudyGuidance.exe 放在项目目录中运行。");
                }

                // Step 1: WebView2 Runtime if missing
                if (!_checkResult.WebView2Ready && !_abortRequested)
                {
                    SetProgressSafe(8, "步骤 1/4：正在下载 Microsoft Edge WebView2 运行时...");
                    AppendLog("未检测到 WebView2，开始下载微软官方 Evergreen Bootstrapper...");
                    string wvInstaller = Path.Combine(Path.GetTempPath(), "MicrosoftEdgeWebview2Setup.exe");
                    DownloadFileWithProgress("https://go.microsoft.com/fwlink/p/?LinkId=2124703", wvInstaller, "WebView2 安装包");
                    SetProgressSafe(20, "步骤 1/4：正在静默安装 Microsoft Edge WebView2 运行时...");
                    AppendLog("执行静默安装：MicrosoftEdgeWebview2Setup.exe /silent /install");
                    int code = RunProcessStreaming(wvInstaller, "/silent /install", Path.GetTempPath());
                    AppendLog("WebView2 安装程序退出码：" + code);
                }

                // Step 2: Python 3.11.9 if missing
                if (!_checkResult.PythonReady && !_abortRequested)
                {
                    SetProgressSafe(26, "步骤 2/4：正在下载 Python 3.11.9 安装包...");
                    string pyInstaller = Path.Combine(Path.GetTempPath(), "python-3.11.9-amd64.exe");
                    string[] urls = useMirror
                        ? new string[]
                        {
                            "https://registry.npmmirror.com/-/binary/python/3.11.9/python-3.11.9-amd64.exe",
                            "https://www.python.org/ftp/python/3.11.9/python-3.11.9-amd64.exe"
                        }
                        : new string[]
                        {
                            "https://www.python.org/ftp/python/3.11.9/python-3.11.9-amd64.exe",
                            "https://registry.npmmirror.com/-/binary/python/3.11.9/python-3.11.9-amd64.exe"
                        };

                    DownloadFromMirrorUrls(urls, pyInstaller, "Python 3.11.9 (64位)");
                    SetProgressSafe(42, "步骤 2/4：正在静默安装 Python 3.11.9（写入当前用户环境）...");
                    AppendLog("开始静默安装 Python 3.11.9...");
                    int pyCode = RunProcessStreaming(
                        pyInstaller,
                        "/quiet InstallAllUsers=0 PrependPath=1 Include_test=0 Include_doc=0 Include_launcher=1",
                        Path.GetTempPath()
                    );
                    AppendLog("Python 安装程序退出码：" + pyCode);
                    if (pyCode != 0)
                    {
                        throw new InvalidOperationException("Python 3.11.9 静默安装失败（退出码 " + pyCode + "）。");
                    }
                }

                // Step 3: Create backend/.venv if missing
                string venvDir = Path.Combine(backendDir, ".venv");
                string venvPy = Path.Combine(venvDir, "Scripts", "python.exe");
                if (!File.Exists(venvPy) && !_abortRequested)
                {
                    SetProgressSafe(52, "步骤 3/4：正在创建独立虚拟环境 backend\\.venv...");
                    string sysPy;
                    string sysVer;
                    if (!EnvironmentInspector.FindValidPython(null, out sysPy, out sysVer))
                    {
                        throw new InvalidOperationException("安装后仍未能定位可用的 Python 3.9+ 可执行文件，请重新检测。");
                    }
                    AppendLog("使用 " + sysPy + " (" + sysVer + ") 创建虚拟环境：" + venvDir);
                    int venvCode = RunProcessStreaming(sysPy, string.Format("-m venv \"{0}\"", venvDir), backendDir);
                    if (venvCode != 0 || !File.Exists(venvPy))
                    {
                        throw new InvalidOperationException("创建 backend\\.venv 虚拟环境失败（退出码 " + venvCode + "）。");
                    }
                }

                // Step 4: Install Python dependencies via pip
                if (!_abortRequested)
                {
                    SetProgressSafe(64, "步骤 4/4：正在准备 pip 并安装后端 Python 依赖库...");
                    AppendLog("升级 pip 并检查安装命令...");
                    string mirrorFlags = useMirror
                        ? "-i https://pypi.tuna.tsinghua.edu.cn/simple --trusted-host pypi.tuna.tsinghua.edu.cn"
                        : "";

                    RunProcessStreaming(
                        venvPy,
                        string.Format("-m pip install --upgrade pip --disable-pip-version-check {0}", mirrorFlags).Trim(),
                        backendDir
                    );

                    string reqFile = Path.Combine(backendDir, "requirements.txt");
                    string installTarget = File.Exists(reqFile)
                        ? string.Format("-r \"{0}\"", reqFile)
                        : string.Join(" ", EnvironmentInspector.CorePackagesFallback);

                    SetProgressSafe(72, "步骤 4/4：正在下载并安装后端依赖包（首次约需 1～2 分钟）...");
                    string pipCmd = string.Format(
                        "-m pip install {0} --disable-pip-version-check --no-input {1}",
                        installTarget,
                        mirrorFlags
                    ).Trim();
                    int pipCode = RunProcessStreaming(venvPy, pipCmd, backendDir);

                    if (pipCode != 0 && useMirror && !_abortRequested)
                    {
                        AppendLog("镜像源安装返回非零状态，正在自动回退至 PyPI 官方源重试...");
                        string fallbackCmd = string.Format("-m pip install {0} --disable-pip-version-check --no-input", installTarget);
                        pipCode = RunProcessStreaming(venvPy, fallbackCmd, backendDir);
                    }

                    if (pipCode != 0)
                    {
                        throw new InvalidOperationException("pip 安装依赖失败（退出码 " + pipCode + "），请查看上方日志详情。");
                    }
                }

                SetProgressSafe(96, "正在复核所有本地环境与依赖状态...");
                EnvironmentCheckResult finalCheck = EnvironmentInspector.Check(_projectRoot);
                BeginInvoke(new MethodInvoker(delegate
                {
                    ApplyCheckResult(finalCheck);
                }));

                if (finalCheck.AllReady)
                {
                    SetProgressSafe(100, "环境与依赖一键安装全部完成，即将自动进入工作台...");
                    AppendLog("[完成] 所有本地环境与后端依赖均已就绪！");
                    Thread.Sleep(900);
                    BeginInvoke(new MethodInvoker(delegate
                    {
                        SetUiBusySafe(false);
                        DialogResult = DialogResult.OK;
                        Close();
                    }));
                    return;
                }
                else
                {
                    AppendLog("[提示] 部分检测项仍未就绪，请核对上方列表并重试。");
                }
            }
            catch (Exception ex)
            {
                AppendLog("[错误] " + ex.Message);
                BeginInvoke(new MethodInvoker(delegate
                {
                    _statusLabel.Text = "安装未完成：" + ex.Message;
                    _statusLabel.ForeColor = Color.FromArgb(201, 42, 42);
                }));
            }
            finally
            {
                SetUiBusySafe(false);
            }
        }

        private void DownloadFromMirrorUrls(string[] urls, string targetFile, string label)
        {
            Exception lastErr = null;
            for (int i = 0; i < urls.Length; i++)
            {
                if (_abortRequested) throw new OperationCanceledException("已取消下载");
                try
                {
                    AppendLog(string.Format("尝试下载 {0} ({1}/{2}): {3}", label, i + 1, urls.Length, urls[i]));
                    DownloadFileWithProgress(urls[i], targetFile, label);
                    return;
                }
                catch (Exception ex)
                {
                    lastErr = ex;
                    AppendLog("下载源异常：" + ex.Message);
                }
            }
            throw new InvalidOperationException("下载 " + label + " 失败：" + (lastErr != null ? lastErr.Message : "网络异常"));
        }

        private void DownloadFileWithProgress(string url, string destinationPath, string label)
        {
            if (File.Exists(destinationPath))
            {
                try { File.Delete(destinationPath); } catch { }
            }

            var req = (HttpWebRequest)WebRequest.Create(url);
            req.Method = "GET";
            req.AllowAutoRedirect = true;
            req.Timeout = 30000;
            req.ReadWriteTimeout = 30000;
            req.UserAgent = "AutoStudyGuidance-Installer/1.1.0";

            using (var resp = (HttpWebResponse)req.GetResponse())
            using (var netStream = resp.GetResponseStream())
            using (var fileStream = new FileStream(destinationPath, FileMode.Create, FileAccess.Write, FileShare.None))
            {
                long totalBytes = resp.ContentLength;
                byte[] buf = new byte[65536];
                long readTotal = 0;
                int lastReportedMb = -1;
                int n;
                while ((n = netStream.Read(buf, 0, buf.Length)) > 0)
                {
                    if (_abortRequested) throw new OperationCanceledException("已取消下载");
                    fileStream.Write(buf, 0, n);
                    readTotal += n;
                    int mb = (int)(readTotal / (1024 * 1024));
                    if (mb != lastReportedMb || readTotal == totalBytes)
                    {
                        lastReportedMb = mb;
                        if (totalBytes > 0)
                        {
                            double pct = (readTotal * 100.0) / totalBytes;
                            AppendLog(string.Format("正在下载 {0}：{1:F1} MB / {2:F1} MB ({3:F0}%)", label, readTotal / 1048576.0, totalBytes / 1048576.0, pct));
                        }
                        else
                        {
                            AppendLog(string.Format("正在下载 {0}：已接收 {1:F1} MB...", label, readTotal / 1048576.0));
                        }
                    }
                }
            }
        }

        private int RunProcessStreaming(string fileName, string arguments, string workingDir)
        {
            AppendLog("> " + Path.GetFileName(fileName) + " " + arguments);
            var psi = new ProcessStartInfo();
            psi.FileName = fileName;
            psi.Arguments = arguments ?? "";
            if (!string.IsNullOrEmpty(workingDir) && Directory.Exists(workingDir))
            {
                psi.WorkingDirectory = workingDir;
            }
            psi.UseShellExecute = false;
            psi.CreateNoWindow = true;
            psi.RedirectStandardOutput = true;
            psi.RedirectStandardError = true;
            psi.StandardOutputEncoding = Encoding.UTF8;
            psi.StandardErrorEncoding = Encoding.UTF8;

            using (var proc = new Process())
            {
                proc.StartInfo = psi;
                proc.OutputDataReceived += new DataReceivedEventHandler(delegate(object s, DataReceivedEventArgs ev)
                {
                    if (!string.IsNullOrEmpty(ev.Data))
                    {
                        AppendLog(ev.Data);
                    }
                });
                proc.ErrorDataReceived += new DataReceivedEventHandler(delegate(object s, DataReceivedEventArgs ev)
                {
                    if (!string.IsNullOrEmpty(ev.Data))
                    {
                        AppendLog(ev.Data);
                    }
                });
                proc.Start();
                proc.BeginOutputReadLine();
                proc.BeginErrorReadLine();
                while (!proc.WaitForExit(250))
                {
                    if (_abortRequested)
                    {
                        try { proc.Kill(); } catch { }
                        break;
                    }
                }
                proc.WaitForExit();
                return proc.ExitCode;
            }
        }
    }

    internal sealed class MainWindow : Form
    {
        private const string ServerUrl = "http://127.0.0.1:8000";
        private const string ReadyTitle = "Auto Study Guidance v1.1.0 · 智能导学与题库工作台";

        private readonly WebView2 _webView;
        private readonly Panel _loadingPanel;
        private readonly Label _loadingLabel;
        private readonly Button _envRepairButton;

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
            _loadingLabel.Text = "正在检查本地环境与依赖，并初始化 Auto Study Guidance v1.1.0 引擎，请稍候...";
            _loadingLabel.Font = new Font("Microsoft YaHei UI", 11f, FontStyle.Regular);
            _loadingLabel.ForeColor = Color.FromArgb(30, 41, 59);
            _loadingLabel.TextAlign = ContentAlignment.MiddleCenter;
            _loadingLabel.Padding = new Padding(48, 0, 48, 72);
            _loadingLabel.Dock = DockStyle.Fill;

            _envRepairButton = new Button();
            _envRepairButton.Text = "检测并一键下载环境与依赖";
            _envRepairButton.Font = new Font("Microsoft YaHei UI", 9.5f, FontStyle.Bold);
            _envRepairButton.Size = new Size(230, 38);
            _envRepairButton.BackColor = Color.FromArgb(59, 91, 219);
            _envRepairButton.ForeColor = Color.White;
            _envRepairButton.FlatStyle = FlatStyle.Flat;
            _envRepairButton.FlatAppearance.BorderSize = 0;
            _envRepairButton.Visible = false;
            _envRepairButton.Anchor = AnchorStyles.None;
            _envRepairButton.Click += new EventHandler(OnOpenEnvRepairDialog);

            _loadingPanel.Controls.Add(_envRepairButton);
            _loadingPanel.Controls.Add(_loadingLabel);
            _loadingPanel.Resize += new EventHandler(delegate
            {
                _envRepairButton.Location = new Point(
                    Math.Max(20, (_loadingPanel.Width - _envRepairButton.Width) / 2),
                    Math.Max(20, (_loadingPanel.Height / 2) + 46)
                );
                _envRepairButton.BringToFront();
            });

            Controls.Add(_webView);
            Controls.Add(_loadingPanel);
            _loadingPanel.BringToFront();

            Load += new EventHandler(OnFormLoad);
            KeyDown += new KeyEventHandler(OnWindowKeyDown);
            FormClosing += new FormClosingEventHandler(OnWindowClosing);
        }

        internal static string ResolveProjectRoot()
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
            StartBootstrapThread();
        }

        private void StartBootstrapThread()
        {
            var worker = new Thread(new ThreadStart(BootstrapAndLaunch));
            worker.IsBackground = true;
            worker.Start();
        }

        private void OnOpenEnvRepairDialog(object sender, EventArgs e)
        {
            EnvironmentCheckResult check = EnvironmentInspector.Check(_projectRoot);
            using (var dlg = new EnvironmentSetupDialog(_projectRoot, check))
            {
                DialogResult res = dlg.ShowDialog(this);
                if (res == DialogResult.Cancel)
                {
                    return;
                }
                _envRepairButton.Visible = false;
                _loadingLabel.Text = "正在重新启动 Auto Study Guidance 服务...";
                StartBootstrapThread();
            }
        }

        private void BootstrapAndLaunch()
        {
            try
            {
                SetStatusSafe("正在检测本地运行环境与依赖...");
                SetLoadingTextSafe("正在自动检测本地 Python 环境与核心依赖，请稍候...");

                EnvironmentCheckResult envCheck = EnvironmentInspector.Check(_projectRoot);
                if (!envCheck.AllReady || Program.ForceEnvDialog)
                {
                    Program.ForceEnvDialog = false;
                    SetStatusSafe("检测到环境或依赖需要配置");
                    DialogResult dlgResult = DialogResult.Cancel;
                    Invoke(new MethodInvoker(delegate
                    {
                        using (var dlg = new EnvironmentSetupDialog(_projectRoot, envCheck))
                        {
                            dlgResult = dlg.ShowDialog(this);
                        }
                    }));

                    if (dlgResult == DialogResult.Cancel)
                    {
                        BeginInvoke(new MethodInvoker(Close));
                        return;
                    }
                }

                if (!CheckBackendAlive())
                {
                    SetStatusSafe("正在后台静默启动本地服务...");
                    SetLoadingTextSafe("环境就绪，正在静默启动 Auto Study Guidance 服务并加载工作台...");
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
                        SetLoadingTextSafe("后端服务启动超时，请点击下方按钮重新检测/修复环境与依赖，或检查端口 8000 是否被占用。");
                        SetRepairButtonVisibleSafe(true);
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
                SetRepairButtonVisibleSafe(true);
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
            string pyExe = EnvironmentInspector.ResolveBestPython(_projectRoot);

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
                _loadingLabel.Text = "WebView2 初始化失败：" + ex.Message + "\n请点击下方按钮一键安装 Microsoft Edge WebView2 运行时。";
                _envRepairButton.Visible = true;
                _envRepairButton.BringToFront();
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
            SetTitleSafe("Auto Study Guidance v1.1.0 — " + text);
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

        private void SetRepairButtonVisibleSafe(bool visible)
        {
            if (_closing || IsDisposed) return;
            try
            {
                if (InvokeRequired)
                {
                    BeginInvoke(new Action<bool>(SetRepairButtonVisibleSafe), visible);
                }
                else
                {
                    _envRepairButton.Location = new Point(
                        Math.Max(20, (_loadingPanel.Width - _envRepairButton.Width) / 2),
                        Math.Max(20, (_loadingPanel.Height / 2) + 46)
                    );
                    _envRepairButton.Visible = visible;
                    if (visible) _envRepairButton.BringToFront();
                }
            }
            catch
            {
                // ignore when closing
            }
        }
    }
}
