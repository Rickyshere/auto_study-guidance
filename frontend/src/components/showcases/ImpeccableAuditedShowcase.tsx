import React, { useEffect, useRef, useState } from 'react';

type PresetKey = 'in_class' | 'sync_practice' | 'self_test' | 'self_study' | 'cram_pack' | 'custom';
type RouterTier = 'harness' | 'cloud' | 'local';
type StageState = 'negotiate' | 'approved';
type CanvasTab = 'sheet' | 'blueprint_matrix' | 'source_compare';

interface PresetSpec {
  id: PresetKey;
  code: string;
  label: string;
  timing: string;
  summary: string;
  ratio: [number, number, number];
  items: {
    no: string;
    tag: string;
    score: string;
    cognitive: string;
    pageRef: string;
    stem: string;
    scaffold: string;
    answerKey: string;
    marginNote: string;
  }[];
}

const PRESETS: PresetSpec[] = [
  {
    id: 'in_class',
    code: '01 · 随堂',
    label: '随堂练习',
    timing: '12 分钟 · 当堂闭环',
    summary: '紧扣单一课时核心概念，3 道递进小题完成当堂精准诊断。',
    ratio: [30, 50, 20],
    items: [
      {
        no: '01',
        tag: '概念辨析',
        score: '4 分',
        cognitive: '理解',
        pageRef: '教材 P66 · 图 4-6',
        stem: '结合教材第 3.2 节图谱，区分「主动转运」与「协助扩散」在能量消耗与载体饱和动力学上的根本差异，并举出教材中的一个典型生理实例。',
        scaffold: '提示维度：ATP 水解酶偶联、逆浓度梯度做功、载体构象可逆翻转。',
        answerKey: '主动转运消耗 ATP 并可逆浓度梯度进行（如小肠上皮细胞吸收氨基酸 / Na⁺-K⁺ 泵）；协助扩散顺浓度梯度且不耗能（如哺乳动物红细胞吸收葡萄糖）。',
        marginNote: '教材原文锚点：P66 第 2 段明确指出载体蛋白转运速率受膜上载体数量限制而出现饱和现象。',
      },
      {
        no: '02',
        tag: '坐标曲线',
        score: '6 分',
        cognitive: '理解',
        pageRef: '教材 P67 · 思考与讨论',
        stem: '在氧分压为 0 时，培养液中植物根细胞对 K⁺ 的吸收速率为何仍维持在一个较低的非零平台？若此时加入呼吸抑制剂，曲线拐点将如何迁移？',
        scaffold: '注意联系无氧呼吸少量供能与载体蛋白总数上限两个限制因子。',
        answerKey: '低氧平台期由无氧呼吸产生少量 ATP 维持；加入呼吸抑制剂后 ATP 供应彻底中断，主动吸收降至近零，仅剩微弱被动扩散分量。',
        marginNote: '易错诊断：学生常误以为“氧分压 = 0 则吸收速率 = 0”，忽略无氧呼吸 ATP 贡献。',
      },
      {
        no: '03',
        tag: '微实验迁移',
        score: '8 分',
        cognitive: '迁移',
        pageRef: '教材 P69 · 探究拓展',
        stem: '设计一个 3 分钟对照实验方案：验证低温（4 °C）对植物根毛细胞吸收 NO₃⁻ 速率的抑制效应究竟主要作用于膜磷脂流动性，还是呼吸酶催化活性。',
        scaffold: '对照变量：等渗培养液、25 °C / 4 °C × 充氧组 / N₂ 呼吸抑制组。',
        answerKey: '分别测定 25 °C 与 4 °C 下充氧组与呼吸抑制组的吸收速率差值（剥离被动扩散），再对比有氧呼吸抑制前后差值衰减幅度。',
        marginNote: '评分要点：写出“双因素交叉对照（温度 × 呼吸抑制）”得 4 分，逻辑推理得 4 分。',
      },
    ],
  },
  {
    id: 'sync_practice',
    code: '02 · 同步',
    label: '同步练习',
    timing: '30 分钟 · 课后巩固',
    summary: '对应完整章节双节知识点，配置基础过关 + 变式迁移双栏梯次。',
    ratio: [25, 45, 30],
    items: [
      {
        no: '01',
        tag: '基础梳理',
        score: '6 分',
        cognitive: '记忆',
        pageRef: '教材 P63–67 综述',
        stem: '构建物质跨膜运输三种主要方式的对比矩阵，标注各方式对「浓度梯度」「转运蛋白类型」「ATP 消耗」三项核心要素的依赖关系。',
        scaffold: '建议用四列三行表格作答，注明通道蛋白与载体蛋白的结合差异。',
        answerKey: '自由扩散（顺/无/否）；协助扩散（顺/通道或载体/否）；主动运输（可逆/载体/是）。',
        marginNote: '康奈尔检索栏：通道蛋白不与溶质结合，载体蛋白发生特异性构象改变。',
      },
      {
        no: '02',
        tag: '质壁分离变式',
        score: '8 分',
        cognitive: '迁移',
        pageRef: '教材 P64 · 探究实验',
        stem: '已知某突变体细胞膜水通道蛋白（AQP1）表达量下降 70%，将其置于低渗溶液中，质壁分离复原的初始速率与最终渗透平衡体积分别如何变化？',
        scaffold: '严格区分「动力学跨膜速率」与「热力学渗透平衡终点」。',
        answerKey: '初始吸水复原速率显著减慢；但只要半透膜保持选择透过性，最终渗透压平衡态的液泡体积不变。',
        marginNote: '对应考点：水分子既有自由扩散也有水通道协助扩散（后者占主导速率）。',
      },
    ],
  },
  {
    id: 'self_test',
    code: '03 · 自测',
    label: '自测卷',
    timing: '45 分钟 · 闭卷评分',
    summary: '严格按命题双向细目表配比题型与分值，附采分细则与错因诊断。',
    ratio: [20, 40, 40],
    items: [
      {
        no: '01',
        tag: '单选 · 采分校验',
        score: '6 分',
        cognitive: '记忆',
        pageRef: '教材 P68 · 流动镶嵌模型',
        stem: '下列关于生物膜流动镶嵌模型与物质跨膜运输的叙述，哪一项与教材「人鼠细胞融合荧光标记」实验证据直接相悖？',
        scaffold: '核查：磷脂双分子层疏水端朝内排布、膜蛋白在脂双层两侧呈高度不对称嵌合。',
        answerKey: '错项常将“膜蛋白对称均匀分布于内外两侧”误作正确结论（实际糖蛋白仅分布于膜外侧）。',
        marginNote: '命题细目：考查对膜结构不对称性及蛋白质侧向运动实验证据的准确识记。',
      },
      {
        no: '02',
        tag: '实验论述',
        score: '14 分',
        cognitive: '迁移',
        pageRef: '教材 P68–70',
        stem: '结合 P68 人鼠细胞融合与 P70 变形虫胞吞实例，论证细胞膜的结构流动性如何作为功能基础支撑跨膜运输与大分子膜泡转运。',
        scaffold: '采分锚点：① 37 °C 荧光均一化证明侧向扩散（4 分）；② 载体蛋白构象翻转（5 分）；③ 胞吞囊泡融合（5 分）。',
        answerKey: '结构决定功能：磷脂流动与膜蛋白侧向运动使得载体蛋白可交替朝向膜两侧暴露结合位点，并允许膜泡出芽与融合。',
        marginNote: '阅卷标准：未提及“载体构象翻转”或“胞吞囊泡膜融合”各扣 4 分。',
      },
    ],
  },
  {
    id: 'self_study',
    code: '04 · 学案',
    label: '自学案',
    timing: '40 分钟 · 课前导学',
    summary: '以“核心问题链 + 教材页码锚定 + 康奈尔笔记栏”引导独立预习与概念建构。',
    ratio: [30, 50, 20],
    items: [
      {
        no: '导学 1',
        tag: '问题探讨',
        score: '预习锚点',
        cognitive: '理解',
        pageRef: '教材 P64 问题探讨',
        stem: '通读 P64 人工无蛋白脂双层透过性实验：为何甘油与 CO₂ 能自由穿过而葡萄糖与 K⁺ 完全受阻？这一反差迫使科学家提出什么核心假设？',
        scaffold: '请在右栏批注区用一句话写下你的推理结论，再对照教材小字核对。',
        answerKey: '脂溶性小分子可溶于磷脂内部自由扩散；亲水溶质需要膜上存在专一的转运蛋白通道。',
        marginNote: '预习检查点：对照“相似相溶原理”理解脂双层疏水内部构成的屏障。',
      },
      {
        no: '导学 2',
        tag: '概念决策树',
        score: '建构任务',
        cognitive: '迁移',
        pageRef: '教材 P71 本节小结',
        stem: '以「溶质分子尺度」「浓度方向」「是否消耗 ATP」三个判定节点，独立绘制物质进出细胞的完整分类决策树。',
        scaffold: '自检清单：是否将胞吞/胞吐纳入“耗能、依赖膜流动性、不穿膜”独立分支？',
        answerKey: '大分子走胞吞/胞吐；小分子按顺/逆浓度及蛋白需求分入自由扩散、协助扩散与主动运输。',
        marginNote: '思维陷阱提示：胞吞胞吐穿过的生物膜层数为 0 层。',
      },
    ],
  },
  {
    id: 'cram_pack',
    code: '05 · 速记',
    label: '考前速记包',
    timing: '10 分钟 · 高频易错',
    summary: '提炼高频考点反例与 5 个考场踩坑表述，供考前快速检索。',
    ratio: [45, 35, 20],
    items: [
      {
        no: '反例 A',
        tag: '高频陷阱',
        score: '必看',
        cognitive: '记忆',
        pageRef: '拓展延伸 · 协同转运',
        stem: '绝对化表述排雷：「凡是逆浓度梯度的主动运输，必然直接伴随 ATP 水解。」请用教材拓展实例推翻这一表述。',
        scaffold: '关键词：小肠上皮细胞 SGLT1、Na⁺ 电化学势能梯度、继发性主动运输。',
        answerKey: '错误。继发性主动运输直接利用 Na⁺ 顺浓度电化学梯度势能驱动葡萄糖逆浓度吸收，ATP 仅用于维持膜外高 Na⁺ 浓度（Na⁺-K⁺ 泵）。',
        marginNote: '考场高频词：“间接耗能”依然属于主动运输范畴。',
      },
    ],
  },
  {
    id: 'custom',
    code: '06 · 定制',
    label: '自由定制',
    timing: '按教师方案实时编排',
    summary: '根据教师自然语言批注与三维认知滑块比例，动态生成专项教研资料。',
    ratio: [20, 40, 40],
    items: [
      {
        no: '定制 1',
        tag: '专项变式',
        score: '10 分',
        cognitive: '迁移',
        pageRef: '教师定制 · 第 3.2 节',
        stem: '结合教师指令中要求的“呼吸抑制剂综合变式”，分析密闭容器中离体心肌细胞在加入氰化物后，跨膜 Na⁺ 泵与 Ca²⁺ 排出速率的先后跌落顺序。',
        scaffold: '提示：心肌细胞胞内存在少量磷酸肌酸缓冲库，且静息电位变化影响电化学驱动力。',
        answerKey: '氰化物抑制有氧呼吸使 ATP 耗竭，依赖 ATP 的 Na⁺-K⁺ 泵率先停止；随后细胞内 Na⁺ 积累破坏 Na⁺-Ca²⁺ 交换体驱动势，导致 Ca²⁺ 排出受阻。',
        marginNote: '自定义约束命中：严格融合教师批注中“呼吸抑制剂 + 实验探究梯度”。',
      },
    ],
  },
];

const AUDIT_ITEMS = [
  {
    source: 'PC 桌面向空间重构 + fwc-swiftui',
    before: '旧版偏窄或移动端折叠模拟器尺寸，桌面宽屏空间利用率不足',
    after: '100vw × 100vh 桌面三栏编辑室架构（左侧目录树 290px + 中栏 Stage 1 需求契约 390px + 右侧 Stage 2 清样主画布与右栏页边注记），同时保留侧栏折叠时的 100% 状态持久性',
    why: 'desktop-first & swiftui-iphone-duo: 桌面大屏最大化并行审校效率，布局收折绝不重置方案状态',
  },
  {
    source: 'fwc-swiftui · Liquid Glass',
    before: '滚动卡片与底部悬浮栏边界不够清晰',
    after: '三栏独立滚动区内 100% 纯实底档案纸 (#FDFBF7)；仅顶部浮动工具栏与弹出层使用轻透层级，按钮内边距 ~13px，标题遵守 .sharedBackgroundVisibility(.hidden) 无多余底框',
    why: 'swiftui-liquid-glass: Glass 仅用于浮动 Chrome，绝不侵入可滚动文档正文',
  },
  {
    source: 'fwc-swiftui · Adaptive Grid',
    before: '预设卡片固定列数，长题干换行过长',
    after: '预设网格采用 repeat(auto-fill, minmax(112px, 1fr))，清样主栏正文严格锁定 max-width: 65ch，右侧独立 250px 页边注记栏展示页码溯源',
    why: 'swiftui-iphone-duo & impeccable: 保障宽屏下学术文本始终处于最佳阅读宽度',
  },
  {
    source: 'emilkowalski · No transition: all',
    before: '切页或切预设缺少桥接节奏',
    after: '全代码零 transition: all；仅过渡 transform/opacity/filter，切预设或画布 Tab 触发 180ms blur(2px) 柔焦桥接 + 40ms 错峰落位（从 scale(0.96) 起步）',
    why: 'review-animations: 禁止 transition: all 与 scale(0)',
  },
  {
    source: 'emilkowalski · Asymmetric Hold',
    before: '确认操作缺少触觉按压与误触防护',
    after: '全站按钮 :active { transform: scale(0.97) }；Stage 1 主确认按钮具备 850ms 蓄力线性填充与 160ms --ease-out 快速弹回非对称时序',
    why: 'emil-design-eng: 0.97 按压回馈 + 慢蓄力快撤回防误触',
  },
  {
    source: 'emilkowalski · Origin & 0ms Keys',
    before: '弹出菜单无触发方向，键盘指令受动画拖累',
    after: '3-Tier Router 菜单自 transform-origin: top right 以 scale(0.95) 展开 (160ms)；⌘K 快速指令面板以 0ms 零延迟开关',
    why: 'review-animations: 弹窗必锚定触发原点；键盘动作零阻塞',
  },
  {
    source: 'emilkowalski · Hover & Reduced Motion',
    before: '未显式隔离指针悬停与系统无障碍降级',
    after: '全部 Hover 收口在 @media (hover: hover) and (pointer: fine)；全站内置 @media (prefers-reduced-motion: reduce)',
    why: 'STANDARDS.md: 保证不同输入设备下交互洁净与系统动态偏好兼容',
  },
];

export function ImpeccableAuditedShowcase() {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [canvasTab, setCanvasTab] = useState<CanvasTab>('sheet');
  const [presetId, setPresetId] = useState<PresetKey>('in_class');
  const [stage, setStage] = useState<StageState>('negotiate');
  const [routerTier, setRouterTier] = useState<RouterTier>('harness');
  const [routerMenuOpen, setRouterMenuOpen] = useState(false);
  const [selectedChapters, setSelectedChapters] = useState<string[]>(['3.1', '3.2']);
  const [customNote, setCustomNote] = useState(
    '保留教材 §3.2 载体构象原图对照，第 3 题强化「呼吸抑制剂 + 低温」双因素对照分析。'
  );
  const [bloomRatios, setBloomRatios] = useState<[number, number, number]>([30, 50, 20]);
  const [showAnswers, setShowAnswers] = useState(true);
  const [auditOpen, setAuditOpen] = useState(false);
  const [cmdOpen, setCmdOpen] = useState(false);
  const [transitionKey, setTransitionKey] = useState(0);

  // Asymmetric hold-to-approve state
  const [holdProgress, setHoldProgress] = useState(0);
  const [isHolding, setIsHolding] = useState(false);
  const holdRafRef = useRef<number | null>(null);
  const holdStartRef = useRef<number>(0);

  const activePreset = PRESETS.find((p) => p.id === presetId) ?? PRESETS[0];

  const routerMeta: Record<RouterTier, { title: string; sub: string; badge: string }> = {
    harness: { title: 'CLI Harness · claude / codex', sub: '多阶段本地编排 · 零 API 账单', badge: 'TIER 1 · HARNESS' },
    cloud: { title: 'Cloud API · DeepSeek-R1 / GPT-4o', sub: '高并发高速解析 · 长文本精排', badge: 'TIER 2 · CLOUD' },
    local: { title: 'Local · Ollama qwen2.5:14b', sub: '离线本地闭环 · 内网零外传', badge: 'TIER 3 · LOCAL' },
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCmdOpen((prev) => !prev);
      } else if (e.key === 'Escape') {
        setCmdOpen(false);
        setRouterMenuOpen(false);
        setAuditOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const switchPreset = (id: PresetKey) => {
    const target = PRESETS.find((p) => p.id === id) ?? PRESETS[0];
    setPresetId(id);
    setBloomRatios(target.ratio);
    setTransitionKey((k) => k + 1);
  };

  const toggleChapter = (id: string) => {
    setSelectedChapters((prev) =>
      prev.includes(id) ? (prev.length > 1 ? prev.filter((c) => c !== id) : prev) : [...prev, id]
    );
  };

  const startHold = () => {
    if (stage === 'approved') {
      setStage('negotiate');
      setHoldProgress(0);
      return;
    }
    setIsHolding(true);
    holdStartRef.current = performance.now();
    const tick = (now: number) => {
      const pct = Math.min(1, (now - holdStartRef.current) / 850);
      setHoldProgress(pct);
      if (pct >= 1) {
        setIsHolding(false);
        setStage('approved');
        setTransitionKey((k) => k + 1);
        holdRafRef.current = null;
      } else {
        holdRafRef.current = requestAnimationFrame(tick);
      }
    };
    holdRafRef.current = requestAnimationFrame(tick);
  };

  const endHold = (allowQuickClick: boolean) => {
    if (holdRafRef.current !== null) {
      cancelAnimationFrame(holdRafRef.current);
      holdRafRef.current = null;
    }
    if (isHolding) {
      const elapsed = performance.now() - holdStartRef.current;
      setIsHolding(false);
      if (allowQuickClick && elapsed < 220) {
        setHoldProgress(1);
        setStage('approved');
        setTransitionKey((k) => k + 1);
      } else {
        setHoldProgress(0);
      }
    }
  };

  return (
    <div className="imp-pc-root">
      <style>{`
        .imp-pc-root {
          --paper: #F6F3EC;
          --folio: #FDFBF7;
          --ink: #141413;
          --graphite: #57534E;
          --rule: #DDD6C8;
          --vermilion: #C83E1D;
          --forest: #1F4E3D;
          --ochre: #9A6B16;
          --ease-out: cubic-bezier(0.23, 1, 0.32, 1);
          --ease-drawer: cubic-bezier(0.32, 0.72, 0, 1);

          height: calc(100vh - 38px);
          min-height: 680px;
          display: flex;
          flex-direction: column;
          background-color: var(--paper);
          color: var(--ink);
          font-family: 'Inter', -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif;
          overflow: hidden;
        }

        .imp-pc-root ::selection {
          background-color: rgba(200, 62, 29, 0.16);
          color: #141413;
        }

        .imp-serif {
          font-family: 'Newsreader', 'Songti SC', 'Noto Serif SC', Georgia, serif;
        }

        .imp-tabular {
          font-variant-numeric: tabular-nums;
        }

        /* Explicit transitions ONLY (zero transition: all) */
        .imp-pc-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 7px;
          border-radius: 2px;
          font-size: 13px;
          font-weight: 500;
          cursor: pointer;
          border: 1px solid var(--rule);
          background-color: var(--folio);
          color: var(--ink);
          padding: 8px 13px;
          transition:
            transform 140ms var(--ease-out),
            background-color 150ms var(--ease-out),
            border-color 150ms var(--ease-out),
            color 150ms var(--ease-out);
          user-select: none;
        }

        .imp-pc-btn:active {
          transform: scale(0.97);
        }

        .imp-pc-btn-primary {
          background-color: var(--vermilion);
          border-color: var(--vermilion);
          color: #FDFBF7;
          font-weight: 600;
        }

        .imp-pc-btn-forest {
          background-color: var(--forest);
          border-color: var(--forest);
          color: #FDFBF7;
          font-weight: 600;
        }

        @media (hover: hover) and (pointer: fine) {
          .imp-pc-btn:hover {
            border-color: var(--ink);
            background-color: #EFEAE0;
          }
          .imp-pc-btn-primary:hover {
            background-color: #B33517;
            border-color: #B33517;
          }
          .imp-pc-btn-forest:hover {
            background-color: #183F31;
            border-color: #183F31;
          }
          .imp-pc-stamp:hover {
            border-color: var(--ink);
          }
          .imp-pc-tree-row:hover {
            background-color: #F2EDE2;
          }
        }

        /* Top PC Desktop Menubar */
        .imp-pc-topbar {
          height: 54px;
          flex-shrink: 0;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          padding: 0 20px;
          background-color: rgba(253, 251, 247, 0.9);
          backdrop-filter: blur(14px);
          border-bottom: 1px solid var(--rule);
          z-index: 25;
        }

        /* Full-width PC Three-Pane Split Architecture */
        .imp-pc-workspace {
          flex: 1;
          min-height: 0;
          display: grid;
          grid-template-columns: 290px 395px minmax(520px, 1fr);
          transition: grid-template-columns 240ms var(--ease-out);
        }

        .imp-pc-workspace[data-sidebar="collapsed"] {
          grid-template-columns: 0px 410px minmax(580px, 1fr);
        }

        .imp-pc-pane {
          height: 100%;
          overflow-y: auto;
          background-color: var(--folio); /* Solid paper inside scrollviews! */
          border-right: 1px solid var(--rule);
          min-width: 0;
        }

        .imp-pc-pane-sidebar {
          background-color: #F9F6EE;
          overflow-x: hidden;
        }

        .imp-pc-canvas-bg {
          background-color: var(--paper);
          padding: 24px 32px 48px;
          overflow-y: auto;
          min-width: 0;
        }

        /* Adaptive preset grid */
        .imp-pc-preset-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
          gap: 8px;
        }

        .imp-pc-stamp {
          text-align: left;
          padding: 9px 10px;
          border: 1px solid var(--rule);
          border-radius: 2px;
          background-color: #FAF7F0;
          cursor: pointer;
          transition:
            transform 140ms var(--ease-out),
            border-color 150ms var(--ease-out),
            background-color 150ms var(--ease-out);
        }

        .imp-pc-stamp:active {
          transform: scale(0.97);
        }

        .imp-pc-stamp[data-active="true"] {
          border-color: var(--vermilion);
          background-color: #FDF3EF;
        }

        .imp-pc-tree-row {
          display: flex;
          align-items: flex-start;
          gap: 9px;
          padding: 9px 12px;
          border-bottom: 1px solid #EDE7DA;
          cursor: pointer;
          transition: background-color 140ms var(--ease-out);
        }

        /* Widescreen Document Folio (Left 65ch stems + Right Margin Annotation Column) */
        .imp-pc-folio-sheet {
          max-width: 1120px;
          margin: 0 auto;
          background-color: var(--folio);
          border: 1px solid var(--rule);
          border-radius: 2px;
          box-shadow: 0 18px 42px -28px rgba(20, 20, 19, 0.25);
          padding: 30px 36px 40px;
        }

        .imp-pc-item-grid {
          display: grid;
          grid-template-columns: minmax(0, 65ch) 1px minmax(210px, 1fr);
          gap: 24px;
          padding-bottom: 22px;
          border-bottom: 1px solid #EDE7DA;
        }

        .imp-pc-popover {
          position: absolute;
          top: calc(100% + 8px);
          right: 0;
          width: 315px;
          background-color: var(--folio);
          border: 1px solid var(--ink);
          border-radius: 2px;
          box-shadow: 0 18px 36px -16px rgba(20, 20, 19, 0.28);
          padding: 8px;
          z-index: 45;
          transform-origin: top right;
          animation: impPcPopIn 160ms var(--ease-out) forwards;
        }

        @keyframes impPcPopIn {
          from { opacity: 0; transform: scale(0.95) translateY(-4px); }
          to { opacity: 1; transform: scale(1) translateY(0); }
        }

        @keyframes impPcBlurEnter {
          from { opacity: 0; filter: blur(2px); transform: scale(0.96) translateY(6px); }
          to { opacity: 1; filter: blur(0px); transform: scale(1) translateY(0); }
        }

        .imp-pc-morph {
          animation: impPcBlurEnter 210ms var(--ease-out) both;
        }

        .imp-pc-drawer-backdrop {
          position: fixed;
          inset: 0;
          background-color: rgba(20, 20, 19, 0.34);
          z-index: 50;
          display: flex;
          justify-content: flex-end;
        }

        .imp-pc-drawer-panel {
          width: min(720px, 100vw);
          height: 100%;
          background-color: var(--folio);
          border-left: 1px solid var(--ink);
          padding: 24px 28px;
          overflow-y: auto;
          animation: impPcDrawerIn 250ms var(--ease-drawer) forwards;
        }

        @keyframes impPcDrawerIn {
          from { transform: translateX(28px); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }

        .imp-pc-cmd-backdrop {
          position: fixed;
          inset: 0;
          background-color: rgba(20, 20, 19, 0.42);
          z-index: 60;
          display: flex;
          align-items: flex-start;
          justify-content: center;
          padding-top: 14vh;
        }

        .imp-pc-cmd-box {
          width: min(560px, calc(100vw - 32px));
          background-color: var(--folio);
          border: 1px solid var(--ink);
          border-radius: 2px;
          box-shadow: 0 24px 48px -18px rgba(20, 20, 19, 0.38);
          padding: 16px;
        }

        @media (prefers-reduced-motion: reduce) {
          .imp-pc-workspace,
          .imp-pc-btn,
          .imp-pc-stamp,
          .imp-pc-popover,
          .imp-pc-morph,
          .imp-pc-drawer-panel {
            transition-duration: 0.01ms !important;
            animation-duration: 0.01ms !important;
          }
        }
      `}</style>

      {/* PC Top Desktop Menubar */}
      <header className="imp-pc-topbar no-print">
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <button
            onClick={() => setSidebarOpen((o) => !o)}
            className="imp-pc-btn"
            style={{ padding: '6px 10px' }}
            title="折叠/展开左侧课本目录栏（保留当前方案状态）"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <path d="M9 3v18" />
            </svg>
            <span>{sidebarOpen ? '收起目录栏' : '展开目录栏'}</span>
          </button>

          {/* .sharedBackgroundVisibility(.hidden) plain title */}
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px' }}>
            <span className="imp-serif" style={{ fontSize: '18px', fontWeight: 700, letterSpacing: '-0.02em' }}>
              Auto Study Guidance · 桌面教研排印工作室
            </span>
            <span style={{ fontSize: '12px', color: 'var(--graphite)' }}>
              人教版《分子与细胞》第 3 章.pdf
            </span>
          </div>
        </div>

        {/* Center Widescreen Workspace View Switcher */}
        <div
          style={{
            display: 'inline-flex',
            border: '1px solid var(--rule)',
            borderRadius: '2px',
            backgroundColor: 'var(--paper)',
            padding: '2px',
            gap: '2px',
          }}
        >
          {(
            [
              { id: 'sheet', label: '清样排版画布' },
              { id: 'blueprint_matrix', label: '命题双向细目表' },
              { id: 'source_compare', label: '原书图表与批注对照' },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              onClick={() => {
                setCanvasTab(tab.id);
                setTransitionKey((k) => k + 1);
              }}
              className="imp-pc-btn"
              style={{
                border: 'none',
                padding: '5px 11px',
                fontSize: '12px',
                backgroundColor: canvasTab === tab.id ? 'var(--ink)' : 'transparent',
                color: canvasTab === tab.id ? '#FDFBF7' : 'var(--graphite)',
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Right Desktop Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', position: 'relative' }}>
          <button onClick={() => setCmdOpen(true)} className="imp-pc-btn imp-tabular" style={{ padding: '6px 10px' }}>
            <span>快捷指令</span>
            <kbd style={{ fontSize: '11px', padding: '1px 5px', border: '1px solid var(--rule)', backgroundColor: 'var(--paper)' }}>⌘K</kbd>
          </button>

          <div style={{ position: 'relative' }}>
            <button onClick={() => setRouterMenuOpen((o) => !o)} className="imp-pc-btn" style={{ padding: '6px 11px' }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M4 7h10M18 7h2M4 12h4M12 12h8M4 17h12" strokeLinecap="round" />
                <circle cx="16" cy="7" r="2" />
                <circle cx="10" cy="12" r="2" />
                <circle cx="18" cy="17" r="2" />
              </svg>
              <span>{routerMeta[routerTier].badge}</span>
            </button>

            {routerMenuOpen && (
              <div className="imp-pc-popover" role="menu">
                <div style={{ fontSize: '11px', color: 'var(--graphite)', padding: '4px 8px 6px', borderBottom: '1px solid #EDE7DA' }}>
                  3-Tier 混合推理路由（Origin Top-Right 160ms）
                </div>
                {(['harness', 'cloud', 'local'] as RouterTier[]).map((tier) => (
                  <button
                    key={tier}
                    onClick={() => {
                      setRouterTier(tier);
                      setRouterMenuOpen(false);
                    }}
                    style={{
                      width: '100%',
                      textAlign: 'left',
                      padding: '9px 8px',
                      marginTop: '4px',
                      border: '1px solid',
                      borderColor: routerTier === tier ? 'var(--vermilion)' : 'transparent',
                      backgroundColor: routerTier === tier ? '#FDF3EF' : 'transparent',
                      borderRadius: '2px',
                      cursor: 'pointer',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12.5px', fontWeight: 600 }}>
                      <span>{routerMeta[tier].title}</span>
                      <span style={{ color: 'var(--vermilion)', fontSize: '11px' }}>{tier.toUpperCase()}</span>
                    </div>
                    <div style={{ fontSize: '11.5px', color: 'var(--graphite)', marginTop: '2px' }}>
                      {routerMeta[tier].sub}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          <button onClick={() => setAuditOpen(true)} className="imp-pc-btn imp-pc-btn-primary" style={{ padding: '6px 12px' }}>
            <span>联合 UI 审计表 (7)</span>
          </button>

          <button onClick={() => window.print()} className="imp-pc-btn" style={{ padding: '6px 11px' }}>
            <span>打印 / 导出</span>
          </button>
        </div>
      </header>

      {/* Main PC 3-Column Split Workbench */}
      <div className="imp-pc-workspace" data-sidebar={sidebarOpen ? 'open' : 'collapsed'}>
        {/* PANE 1: Left Textbook & Chapter Tree Sidebar (290px, solid paper) */}
        <aside className="imp-pc-pane imp-pc-pane-sidebar" aria-label="教材导入与章节树">
          <div style={{ padding: '16px 16px 12px', borderBottom: '1px solid var(--rule)' }}>
            <div style={{ fontSize: '12.5px', fontWeight: 700, marginBottom: '8px' }}>课本 / PPTX 解析源</div>
            <div
              style={{
                border: '1px dashed var(--ink)',
                backgroundColor: 'var(--folio)',
                padding: '12px',
                borderRadius: '2px',
                fontSize: '12px',
                lineHeight: 1.5,
              }}
            >
              <div style={{ fontWeight: 600 }}>人教版《生物·必修一》.pdf</div>
              <div className="imp-tabular" style={{ color: 'var(--graphite)', marginTop: '3px' }}>
                142 页 · 18 张矢量图 · OCR 置信度 99.4%
              </div>
            </div>
          </div>

          <div style={{ padding: '12px 16px 6px', fontSize: '12px', fontWeight: 700, color: 'var(--graphite)' }}>
            勾选纳入生成的章节范围
          </div>
          <div>
            {[
              { id: '3.1', title: '3.1 水进出细胞的原理（渗透作用 · 质壁分离）', pages: 'P62–65', tokens: '4.2k' },
              { id: '3.2', title: '3.2 主动运输与胞吞、胞吐（载体 · ATP）', pages: 'P66–71', tokens: '5.8k' },
              { id: '3.3', title: '3.3 生物膜流动镶嵌模型与实验史', pages: 'P72–75', tokens: '3.1k' },
            ].map((ch) => {
              const checked = selectedChapters.includes(ch.id);
              return (
                <label key={ch.id} className="imp-pc-tree-row">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleChapter(ch.id)}
                    style={{ marginTop: '3px', accentColor: '#C83E1D' }}
                  />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '12.5px', fontWeight: checked ? 600 : 400, lineHeight: 1.45 }}>
                      {ch.title}
                    </div>
                    <div className="imp-tabular" style={{ fontSize: '11px', color: 'var(--graphite)', marginTop: '2px' }}>
                      {ch.pages} · {ch.tokens} tokens
                    </div>
                  </div>
                </label>
              );
            })}
          </div>

          <div style={{ padding: '16px', marginTop: '8px', borderTop: '1px solid var(--rule)' }}>
            <div style={{ fontSize: '12px', fontWeight: 700, marginBottom: '6px' }}>当前执行路由状态</div>
            <div style={{ fontSize: '12px', lineHeight: 1.55, color: 'var(--graphite)' }}>
              <div><strong style={{ color: 'var(--ink)' }}>{routerMeta[routerTier].title}</strong></div>
              <div>{routerMeta[routerTier].sub}</div>
            </div>
          </div>
        </aside>

        {/* PANE 2: Center Stage 1 Inspector (395px, AI Blueprint Contract & Presets) */}
        <section className="imp-pc-pane" style={{ padding: '20px 22px 28px', display: 'flex', flexDirection: 'column', gap: '18px' }} aria-label="阶段 1 需求解析方案确认">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', borderBottom: '1px solid var(--ink)', paddingBottom: '10px' }}>
            <h2 className="imp-serif" style={{ fontSize: '18px', fontWeight: 700, margin: 0 }}>
              阶段 1 · AI 需求解析与方案契约
            </h2>
            <span className="imp-tabular" style={{ fontSize: '11.5px', fontWeight: 600, color: stage === 'approved' ? 'var(--forest)' : 'var(--vermilion)' }}>
              {stage === 'approved' ? '已签发锁定' : '待确认方案'}
            </span>
          </div>

          {/* 6 Presets Adaptive Grid */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '8px' }}>
              <span style={{ fontWeight: 600 }}>教学资料预设模版</span>
              <span style={{ color: 'var(--graphite)' }}>{activePreset.timing}</span>
            </div>
            <div className="imp-pc-preset-grid">
              {PRESETS.map((p) => (
                <button
                  key={p.id}
                  onClick={() => switchPreset(p.id)}
                  className="imp-pc-stamp"
                  data-active={presetId === p.id}
                >
                  <div className="imp-tabular" style={{ fontSize: '10.5px', fontWeight: 600, color: presetId === p.id ? 'var(--vermilion)' : 'var(--graphite)' }}>
                    {p.code}
                  </div>
                  <div className="imp-serif" style={{ fontSize: '14.5px', fontWeight: 700, marginTop: '2px' }}>
                    {p.label}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Cognitive Axis Sliders */}
          <div style={{ borderTop: '1px solid var(--rule)', paddingTop: '14px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', fontWeight: 600, marginBottom: '10px' }}>
              <span>AI 解析三维认知配比（可手动校准）</span>
              <span className="imp-tabular" style={{ color: 'var(--forest)' }}>{bloomRatios.join('% / ')}%</span>
            </div>
            {(['概念记忆', '原理理解', '实验迁移'] as const).map((axis, idx) => (
              <div key={axis} style={{ marginBottom: '9px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11.5px', color: 'var(--graphite)' }}>
                  <span>{axis}</span>
                  <span className="imp-tabular" style={{ fontWeight: 600, color: 'var(--ink)' }}>{bloomRatios[idx]}%</span>
                </div>
                <input
                  type="range"
                  min={10}
                  max={70}
                  value={bloomRatios[idx]}
                  onChange={(e) => {
                    const next = [...bloomRatios] as [number, number, number];
                    next[idx] = Number(e.target.value);
                    setBloomRatios(next);
                  }}
                  style={{ width: '100%', accentColor: '#C83E1D' }}
                />
              </div>
            ))}
          </div>

          {/* Teacher Inline Revision Note */}
          <div style={{ borderTop: '1px solid var(--rule)', paddingTop: '14px' }}>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '6px' }}>
              教师修订反馈指令（实时同步至右侧清样）
            </label>
            <textarea
              value={customNote}
              onChange={(e) => setCustomNote(e.target.value)}
              rows={4}
              style={{
                width: '100%',
                border: '1px solid var(--rule)',
                borderRadius: '2px',
                backgroundColor: '#FAF7F0',
                padding: '9px 11px',
                fontSize: '12.5px',
                lineHeight: 1.6,
                color: 'var(--ink)',
                resize: 'vertical',
              }}
            />
          </div>

          {/* Asymmetric Hold-to-Approve Primary Desktop Bar */}
          <div style={{ marginTop: 'auto', borderTop: '1px solid var(--rule)', paddingTop: '14px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <button
              onPointerDown={startHold}
              onPointerUp={() => endHold(true)}
              onPointerLeave={() => endHold(false)}
              onPointerCancel={() => endHold(false)}
              className={`imp-pc-btn ${stage === 'approved' ? 'imp-pc-btn-forest' : 'imp-pc-btn-primary'}`}
              style={{ width: '100%', padding: '12px 16px', position: 'relative', overflow: 'hidden' }}
            >
              {stage !== 'approved' && (
                <span
                  aria-hidden="true"
                  style={{
                    position: 'absolute',
                    left: 0,
                    top: 0,
                    bottom: 0,
                    width: `${Math.round(holdProgress * 100)}%`,
                    backgroundColor: 'rgba(255, 255, 255, 0.25)',
                    transition: isHolding ? 'none' : 'width 160ms var(--ease-out)',
                  }}
                />
              )}
              <span style={{ position: 'relative' }}>
                {stage === 'approved'
                  ? 'Stage 2 已签发 · 点击退回修改方案'
                  : isHolding
                    ? `蓄力确认签发中 ${Math.round(holdProgress * 100)}%…`
                    : '确认需求方案并生成 Stage 2 资料（可长按蓄力）'}
              </span>
            </button>
            <button onClick={() => setTransitionKey((k) => k + 1)} className="imp-pc-btn" style={{ width: '100%' }}>
              仅刷新右侧清样预览 (blur(2px) + 40ms 错峰)
            </button>
          </div>
        </section>

        {/* PANE 3: Right Widescreen Stage 2 Document Studio */}
        <main className="imp-pc-canvas-bg" aria-label="阶段 2 桌面宽屏正式清样审阅画布">
          <div className="imp-pc-folio-sheet">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', borderBottom: '2px solid var(--ink)', paddingBottom: '12px', marginBottom: '18px', gap: '12px', flexWrap: 'wrap' }}>
              <div>
                <h1 className="imp-serif" style={{ fontSize: '24px', fontWeight: 700, margin: 0 }}>
                  {activePreset.label} ·《第 3 章 物质跨膜运输》
                </h1>
                <div className="imp-tabular" style={{ fontSize: '12px', color: 'var(--graphite)', marginTop: '4px' }}>
                  已选章节：{selectedChapters.join(', ')} · 认知比例 {bloomRatios.join('% / ')}% · 路由 {routerMeta[routerTier].badge}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span
                  className="imp-tabular"
                  style={{
                    fontSize: '12px',
                    fontWeight: 600,
                    padding: '3px 10px',
                    border: '1px solid',
                    borderColor: stage === 'approved' ? 'var(--forest)' : 'var(--ochre)',
                    color: stage === 'approved' ? 'var(--forest)' : 'var(--ochre)',
                  }}
                >
                  {stage === 'approved' ? 'STAGE 2 · 正式定稿清样' : 'STAGE 1 · 方案校对草样'}
                </span>
                <button onClick={() => setShowAnswers((s) => !s)} className="imp-pc-btn" style={{ padding: '5px 10px', fontSize: '12px' }}>
                  {showAnswers ? '隐藏参考答案' : '显示参考答案'}
                </button>
              </div>
            </div>

            {canvasTab === 'sheet' && (
              <div key={transitionKey} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                <div style={{ borderLeft: '3px solid var(--vermilion)', paddingLeft: '12px', maxWidth: '65ch' }}>
                  <div style={{ fontSize: '11.5px', fontWeight: 600, color: 'var(--vermilion)' }}>当前生效的教师修订批注</div>
                  <div style={{ fontSize: '13px', color: 'var(--graphite)', marginTop: '2px', lineHeight: 1.6 }}>“{customNote}”</div>
                </div>

                {activePreset.items.map((item, idx) => (
                  <article key={`${activePreset.id}-${item.no}`} className="imp-pc-item-grid imp-pc-morph" style={{ animationDelay: `${idx * 42}ms` }}>
                    {/* Left 65ch Main Reading Measure */}
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
                        <span className="imp-serif imp-tabular" style={{ fontSize: '17px', fontWeight: 700, color: 'var(--vermilion)' }}>
                          {item.no}
                        </span>
                        <span style={{ fontSize: '12.5px', fontWeight: 600 }}>{item.tag}</span>
                        <span className="imp-tabular" style={{ fontSize: '11.5px', color: 'var(--graphite)' }}>
                          {item.score} · {item.cognitive}
                        </span>
                      </div>
                      <p style={{ fontSize: '14.5px', lineHeight: 1.75, margin: '0 0 8px' }}>{item.stem}</p>
                      <div style={{ fontSize: '12.5px', color: 'var(--graphite)', lineHeight: 1.6 }}>{item.scaffold}</div>
                      {showAnswers && (
                        <div style={{ marginTop: '10px', paddingTop: '8px', borderTop: '1px dashed var(--rule)', fontSize: '12.5px', lineHeight: 1.65, color: 'var(--forest)' }}>
                          <strong>参考答案与采分点：</strong>{item.answerKey}
                        </div>
                      )}
                    </div>

                    <div style={{ backgroundColor: '#EDE7DA' }} />

                    {/* Right PC Margin Citation & Pedagogical Note */}
                    <aside style={{ fontSize: '12px', lineHeight: 1.6, color: 'var(--graphite)', paddingTop: '2px' }}>
                      <div style={{ fontWeight: 700, color: 'var(--ink)', marginBottom: '4px' }}>{item.pageRef}</div>
                      <div>{item.marginNote}</div>
                    </aside>
                  </article>
                ))}
              </div>
            )}

            {canvasTab === 'blueprint_matrix' && (
              <div key={transitionKey} className="imp-pc-morph">
                <h3 className="imp-serif" style={{ fontSize: '17px', margin: '0 0 12px' }}>命题双向细目表 (Table of Specifications)</h3>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', lineHeight: 1.6 }}>
                  <thead>
                    <tr style={{ borderBottom: '2px solid var(--ink)', textAlign: 'left' }}>
                      <th style={{ padding: '8px' }}>题号</th>
                      <th style={{ padding: '8px' }}>考查标签</th>
                      <th style={{ padding: '8px' }}>认知层级</th>
                      <th style={{ padding: '8px' }}>教材页码锚点</th>
                      <th style={{ padding: '8px' }}>分值 / 权重</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activePreset.items.map((item) => (
                      <tr key={item.no} style={{ borderBottom: '1px solid #EDE7DA' }}>
                        <td className="imp-tabular" style={{ padding: '10px 8px', fontWeight: 700, color: 'var(--vermilion)' }}>{item.no}</td>
                        <td style={{ padding: '10px 8px', fontWeight: 600 }}>{item.tag}</td>
                        <td style={{ padding: '10px 8px' }}>{item.cognitive}</td>
                        <td style={{ padding: '10px 8px', color: 'var(--graphite)' }}>{item.pageRef}</td>
                        <td className="imp-tabular" style={{ padding: '10px 8px', color: 'var(--forest)', fontWeight: 600 }}>{item.score}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {canvasTab === 'source_compare' && (
              <div key={transitionKey} className="imp-pc-morph" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
                <div style={{ border: '1px solid var(--rule)', padding: '16px', backgroundColor: '#FAF7F0' }}>
                  <div style={{ fontSize: '13px', fontWeight: 700, marginBottom: '8px' }}>教材原文锚定片段（§3.2 P66–68）</div>
                  <p style={{ fontSize: '13px', lineHeight: 1.7, color: 'var(--graphite)', margin: 0 }}>
                    “物质逆浓度梯度进行跨膜运输，需要载体蛋白的协助，同时还需要消耗细胞内化学反应所释放的能量，这种方式叫做主动运输。”——系统已自动将教材中的“Na⁺-K⁺ 泵”与“小肠上皮吸收氨基酸”图注映射至右侧第 1 题变式。
                  </p>
                </div>
                <div style={{ border: '1px solid var(--rule)', padding: '16px' }}>
                  <div style={{ fontSize: '13px', fontWeight: 700, marginBottom: '8px', color: 'var(--vermilion)' }}>教师校对批注落地映射</div>
                  <p style={{ fontSize: '13px', lineHeight: 1.7, margin: 0 }}>{customNote}</p>
                </div>
              </div>
            )}
          </div>
        </main>
      </div>

      {/* Audit Drawer */}
      {auditOpen && (
        <div className="imp-pc-drawer-backdrop" onClick={() => setAuditOpen(false)}>
          <aside className="imp-pc-drawer-panel" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--ink)', paddingBottom: '12px', marginBottom: '16px' }}>
              <h2 className="imp-serif" style={{ fontSize: '20px', fontWeight: 700, margin: 0 }}>
                Impeccable PC 桌面端 × (fwc-swiftui + Emil) 联合审计表
              </h2>
              <button onClick={() => setAuditOpen(false)} className="imp-pc-btn">关闭</button>
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12.5px', lineHeight: 1.55 }}>
              <thead>
                <tr style={{ borderBottom: '2px solid var(--ink)', textAlign: 'left' }}>
                  <th style={{ padding: '8px 6px', width: '24%' }}>Before</th>
                  <th style={{ padding: '8px 6px', width: '40%' }}>After</th>
                  <th style={{ padding: '8px 6px', width: '36%' }}>Why</th>
                </tr>
              </thead>
              <tbody>
                {AUDIT_ITEMS.map((row) => (
                  <tr key={row.source} style={{ borderBottom: '1px solid #EDE7DA', verticalAlign: 'top' }}>
                    <td style={{ padding: '10px 6px', color: 'var(--graphite)' }}>
                      <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--vermilion)' }}>{row.source}</div>
                      {row.before}
                    </td>
                    <td style={{ padding: '10px 6px' }}>{row.after}</td>
                    <td style={{ padding: '10px 6px', color: 'var(--forest)' }}>{row.why}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </aside>
        </div>
      )}

      {/* 0ms Keyboard Command Modal */}
      {cmdOpen && (
        <div className="imp-pc-cmd-backdrop" onClick={() => setCmdOpen(false)}>
          <div className="imp-pc-cmd-box" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: '8px', borderBottom: '1px solid var(--rule)' }}>
              <span style={{ fontSize: '12.5px', fontWeight: 600 }}>⌘K 桌面端快捷指令面板（0ms 零延迟响应）</span>
              <button onClick={() => setCmdOpen(false)} className="imp-pc-btn" style={{ padding: '3px 8px', fontSize: '11.5px' }}>ESC</button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', marginTop: '10px' }}>
              {PRESETS.map((p) => (
                <button
                  key={p.id}
                  onClick={() => {
                    switchPreset(p.id);
                    setCmdOpen(false);
                  }}
                  className="imp-pc-btn"
                  style={{ justifyContent: 'space-between', textAlign: 'left' }}
                >
                  <span>{p.label}</span>
                  <span style={{ fontSize: '11px', color: 'var(--graphite)' }}>{p.timing}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
