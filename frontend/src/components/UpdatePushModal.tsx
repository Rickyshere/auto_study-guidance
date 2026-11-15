import React, { useState } from 'react';
import {
  CheckCircle2,
  DownloadCloud,
  GitBranch,
  RefreshCw,
  Terminal,
  X,
} from 'lucide-react';
import { api } from '../api';
import { UpdateStatusResponse } from '../types';
import { SpringButton, SpringToggleSwitch } from '../utils/springPhysics';

interface Props {
  open: boolean;
  onClose: () => void;
  updateStatus: UpdateStatusResponse | null;
  autoCheckEnabled: boolean;
  onToggleAutoCheck: (enabled: boolean) => void;
  onRefreshStatus: (fetchRemote: boolean) => Promise<void>;
  checking: boolean;
}

export const UpdatePushModal: React.FC<Props> = ({
  open,
  onClose,
  updateStatus,
  autoCheckEnabled,
  onToggleAutoCheck,
  onRefreshStatus,
  checking,
}) => {
  const [pulling, setPulling] = useState(false);
  const [rebuildFrontend, setRebuildFrontend] = useState(true);
  const [installDeps, setInstallDeps] = useState(true);
  const [rebuildDesktop, setRebuildDesktop] = useState(true);
  const [progress, setProgress] = useState<{
    percent: number;
    stage: string;
    message: string;
  } | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [resultMsg, setResultMsg] = useState<{
    ok: boolean;
    text: string;
    updated?: boolean;
    steps?: { name: string; ok: boolean; detail: string }[];
    needsRestart?: boolean;
  } | null>(null);

  if (!open) return null;

  const hotUpdateDisabled = updateStatus?.can_hot_update === false;

  const handlePullNow = async () => {
    setPulling(true);
    setResultMsg(null);
    setLogs([]);
    setProgress({ percent: 5, stage: '准备连接远端', message: '正在检查并接收最新 Push...' });
    try {
      const res = await api.pullUpdateStream(
        rebuildFrontend,
        (evt) => {
          setProgress({
            percent: evt.percent ?? 50,
            stage: evt.stage || '执行中',
            message: evt.message || '正在拉取新版本...',
          });
          if (evt.log_line) {
            setLogs((prev) => [...prev, evt.log_line!]);
          }
        },
        { installDeps, rebuildDesktop }
      );
      setResultMsg({
        ok: Boolean(res.ok),
        text: res.message,
        updated: res.updated,
        steps: res.steps,
        needsRestart: res.needs_restart,
      });
      await onRefreshStatus(false);
    } catch (e: any) {
      setResultMsg({ ok: false, text: e?.message || '接收 Push 失败' });
    } finally {
      setPulling(false);
    }
  };

  return (
    <div
      className="no-print"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 75,
        backgroundColor: 'rgba(15, 23, 42, 0.5)',
        backdropFilter: 'blur(8px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '18px',
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: 'min(700px, 95vw)',
          maxHeight: '88vh',
          borderRadius: '20px',
          backgroundColor: '#FFFFFF',
          border: '1px solid rgba(60, 60, 67, 0.14)',
          boxShadow: '0 30px 70px -15px rgba(0, 0, 0, 0.34)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            padding: '15px 20px',
            borderBottom: '1px solid rgba(60, 60, 67, 0.1)',
            backgroundColor: '#F8FAFC',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <GitBranch className="w-5 h-5 text-[#007AFF]" />
            <div>
              <div style={{ fontSize: '14.5px', fontWeight: 800, color: '#0F172A' }}>
                新版本 Push 实时接收与热更新中心
              </div>
              <div style={{ fontSize: '11.5px', color: '#64748B' }}>
                自动检测或随时手动拉取 Git 远端新推送（Push），自动重建前端产物
              </div>
            </div>
          </div>

          <button
            onClick={onClose}
            style={{
              borderRadius: '999px',
              border: '1px solid rgba(60, 60, 67, 0.14)',
              backgroundColor: '#FFFFFF',
              padding: '6px',
              cursor: 'pointer',
              display: 'inline-flex',
            }}
            title="关闭"
          >
            <X className="w-4 h-4 text-[#636366]" />
          </button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {/* Offline copy warning: no git repo -> hot update impossible, say it out loud */}
          {hotUpdateDisabled && (
            <div
              style={{
                borderRadius: '12px',
                border: '1.5px solid #FCA5A5',
                backgroundColor: '#FEF2F2',
                padding: '12px 14px',
                fontSize: '12px',
                color: '#B91C1C',
                lineHeight: 1.65,
              }}
            >
              <strong>当前安装无法热更新</strong>
              <div style={{ marginTop: '4px' }}>
                {updateStatus?.offline_reason || '该目录不是 Git 仓库，无法从远端拉取更新。'}
              </div>
              <div style={{ marginTop: '4px', color: '#7F1D1D' }}>
                请重新下载最新安装包覆盖安装，或改用 <code>git clone</code> 得到的目录再启动。
              </div>
            </div>
          )}

          {/* Current vs Remote Status Card */}
          <div
            style={{
              borderRadius: '14px',
              border: updateStatus?.has_update
                ? '1.5px solid rgba(52, 199, 89, 0.45)'
                : '1px solid rgba(60, 60, 67, 0.12)',
              backgroundColor: updateStatus?.has_update ? '#F0FDF4' : '#F8FAFC',
              padding: '14px',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
              <span
                style={{
                  fontSize: '12px',
                  fontWeight: 800,
                  color: updateStatus?.has_update ? '#15803D' : '#0F172A',
                }}
              >
                {updateStatus?.can_hot_update === false
                  ? '⚠ 离线副本：无法从远端同步'
                  : updateStatus?.has_update
                  ? `✨ 发现 ${updateStatus.behind_count} 条远端新 Push 提交可立即接收`
                  : updateStatus?.artifacts_stale
                  ? '✓ 代码已是最新，但构建产物需要补齐'
                  : '✓ 当前本地已与远端最新提交同步'}
              </span>
              <SpringButton
                springLabel="检查远端Push"
                disabled={checking || pulling}
                onClick={() => onRefreshStatus(true)}
                maxShift={4}
                style={{
                  borderRadius: '999px',
                  border: '1px solid rgba(60, 60, 67, 0.16)',
                  backgroundColor: '#FFFFFF',
                  color: '#1C1C1E',
                  padding: '5px 11px',
                  fontSize: '11.5px',
                  fontWeight: 600,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '5px',
                  cursor: checking ? 'wait' : 'pointer',
                }}
              >
                <RefreshCw className={`w-3.5 h-3.5 ${checking ? 'animate-spin' : ''}`} />
                <span>{checking ? '检查中...' : '立即检查远端 Push'}</span>
              </SpringButton>
            </div>

            <div style={{ fontSize: '12px', color: '#334155', lineHeight: 1.6 }}>
              <div>
                <strong>分支与仓库：</strong> {updateStatus?.branch || 'main'} ·{' '}
                <span style={{ color: '#64748B' }}>{updateStatus?.remote_url || 'origin'}</span>
              </div>
              <div>
                <strong>当前本地版本：</strong>{' '}
                <code>{updateStatus?.local_commit || '-'}</code> — {updateStatus?.local_message || '-'}
              </div>
              <div>
                <strong>远端最新版本：</strong>{' '}
                <code>{updateStatus?.remote_commit || '-'}</code> — {updateStatus?.remote_message || '-'}
              </div>
              {updateStatus?.fetch_error && (
                <div style={{ color: '#DC2626', marginTop: '4px' }}>
                  探测提示：{updateStatus.fetch_error}
                </div>
              )}
            </div>
          </div>

          {/* Incoming Commits Preview */}
          {updateStatus && updateStatus.incoming_commits.length > 0 && (
            <div
              style={{
                borderRadius: '12px',
                border: '1px solid rgba(60, 60, 67, 0.12)',
                backgroundColor: '#FFFFFF',
                padding: '12px 14px',
              }}
            >
              <div style={{ fontSize: '12px', fontWeight: 700, color: '#0F172A', marginBottom: '8px' }}>
                待接收的远端 Push 提交列表：
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {updateStatus.incoming_commits.map((c) => (
                  <div
                    key={c.hash}
                    style={{
                      fontSize: '11.5px',
                      color: '#334155',
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: '8px',
                      borderBottom: '1px dashed #E2E8F0',
                      paddingBottom: '4px',
                    }}
                  >
                    <span>
                      <code style={{ color: '#007AFF', fontWeight: 700 }}>{c.hash}</code> {c.message}
                    </span>
                    <span style={{ color: '#94A3B8', flexShrink: 0 }}>{c.author}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Options */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
              borderRadius: '12px',
              border: '1px solid rgba(60, 60, 67, 0.1)',
              padding: '12px 14px',
              backgroundColor: '#FAFAFC',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontSize: '12.5px', fontWeight: 700, color: '#1E293B' }}>
                  后台定时自动检测新版本 Push
                </div>
                <div style={{ fontSize: '11px', color: '#64748B' }}>
                  每 60 秒静默探测一次远端新 Push 并在顶栏弹出更新红点；同时支持 POST /api/system/webhook/push 即时触发
                </div>
              </div>
              <SpringToggleSwitch
                checked={autoCheckEnabled}
                onChange={onToggleAutoCheck}
                springLabel="自动检测Push"
              />
            </div>

            <label
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                fontSize: '12px',
                color: '#334155',
                cursor: 'pointer',
              }}
            >
              <input
                type="checkbox"
                checked={rebuildFrontend}
                onChange={(e) => setRebuildFrontend(e.target.checked)}
              />
              <span>拉取新 Push 后自动编译前端 bundle（使桌面端 / 8000 端口立即生效）</span>
            </label>
            <label
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                fontSize: '12px',
                color: '#334155',
                cursor: 'pointer',
              }}
            >
              <input
                type="checkbox"
                checked={installDeps}
                onChange={(e) => setInstallDeps(e.target.checked)}
              />
              <span>依赖清单有变化时自动安装（pip / npm），否则新代码可能缺模块</span>
            </label>
            <label
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                fontSize: '12px',
                color: '#334155',
                cursor: 'pointer',
              }}
            >
              <input
                type="checkbox"
                checked={rebuildDesktop}
                onChange={(e) => setRebuildDesktop(e.target.checked)}
              />
              <span>重建桌面外壳 exe（正在运行时会在关闭窗口后自动完成，新版本号需要它）</span>
            </label>
          </div>

          {/* SSE Progress & Logs */}
          {progress && (
            <div
              style={{
                borderRadius: '12px',
                border: '1px solid rgba(0, 122, 255, 0.2)',
                backgroundColor: '#F0F7FF',
                padding: '12px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', fontWeight: 700, color: '#007AFF', marginBottom: '6px' }}>
                <span>
                  {progress.stage} · {progress.message}
                </span>
                <span>{progress.percent}%</span>
              </div>
              <div style={{ height: '6px', borderRadius: '999px', backgroundColor: 'rgba(0, 122, 255, 0.15)', overflow: 'hidden' }}>
                <div style={{ width: `${progress.percent}%`, height: '100%', backgroundColor: '#007AFF' }} />
              </div>
              {logs.length > 0 && (
                <div
                  style={{
                    marginTop: '8px',
                    backgroundColor: '#0F172A',
                    color: '#E2E8F0',
                    borderRadius: '8px',
                    padding: '8px 10px',
                    fontFamily: 'monospace',
                    fontSize: '11px',
                    maxHeight: '110px',
                    overflowY: 'auto',
                  }}
                >
                  <Terminal className="w-3 h-3 inline mr-1.5 text-sky-400" />
                  {logs.map((line, i) => (
                    <div key={i}>{line}</div>
                  ))}
                </div>
              )}
            </div>
          )}

          {resultMsg && (
            <div
              style={{
                borderRadius: '11px',
                padding: '10px 12px',
                fontSize: '12px',
                fontWeight: 700,
                backgroundColor: resultMsg.ok ? '#ECFDF5' : '#FEF2F2',
                color: resultMsg.ok ? '#047857' : '#B91C1C',
                border: resultMsg.ok ? '1px solid #A7F3D0' : '1px solid #FECACA',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '8px',
              }}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                <CheckCircle2 className="w-4 h-4" />
                {resultMsg.text}
              </span>
              {resultMsg.ok && resultMsg.updated && (
                <SpringButton
                  springLabel="刷新界面"
                  onClick={() => window.location.reload()}
                  maxShift={4}
                  style={{
                    borderRadius: '999px',
                    border: 'none',
                    backgroundColor: '#059669',
                    color: '#FFFFFF',
                    padding: '5px 12px',
                    fontSize: '11.5px',
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  立即刷新界面加载新版本
                </SpringButton>
              )}
            </div>
          )}
          {resultMsg?.steps && resultMsg.steps.length > 0 && (
            <div
              style={{
                borderRadius: '12px',
                border: '1px solid rgba(60, 60, 67, 0.12)',
                backgroundColor: '#FFFFFF',
                padding: '10px 12px',
                display: 'flex',
                flexDirection: 'column',
                gap: '5px',
              }}
            >
              <div style={{ fontSize: '11.5px', fontWeight: 700, color: '#0F172A' }}>更新步骤明细</div>
              {resultMsg.steps.map((s, i) => (
                <div
                  key={`${s.name}-${i}`}
                  style={{
                    fontSize: '11.5px',
                    display: 'flex',
                    gap: '6px',
                    alignItems: 'flex-start',
                    color: s.ok ? '#047857' : '#B45309',
                  }}
                >
                  <span style={{ flexShrink: 0 }}>{s.ok ? '✓' : '⚠'}</span>
                  <span style={{ fontWeight: 600, flexShrink: 0 }}>{s.name}</span>
                  <span style={{ color: '#475569' }}>{s.detail}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div
          style={{
            padding: '13px 20px',
            borderTop: '1px solid rgba(60, 60, 67, 0.1)',
            backgroundColor: '#F8FAFC',
            display: 'flex',
            justifyContent: 'flex-end',
            gap: '8px',
          }}
        >
          <SpringButton
            springLabel="一键接收新Push"
            disabled={pulling || hotUpdateDisabled}
            onClick={handlePullNow}
            maxShift={5}
            style={{
              borderRadius: '999px',
              border: 'none',
              backgroundColor: hotUpdateDisabled ? '#94A3B8' : updateStatus?.has_update ? '#16A34A' : '#007AFF',
              color: '#FFFFFF',
              padding: '8px 18px',
              fontSize: '12.5px',
              fontWeight: 700,
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              cursor: pulling ? 'wait' : hotUpdateDisabled ? 'not-allowed' : 'pointer',
            }}
          >
            <DownloadCloud className="w-4 h-4" />
            <span>
              {pulling
                ? '正在拉取并应用更新...'
                : hotUpdateDisabled
                ? '离线副本不支持热更新'
                : '一键接收最新 Push 并完整热更新'}
            </span>
          </SpringButton>
        </div>
      </div>
    </div>
  );
};
