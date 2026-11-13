import React, { useCallback, useEffect, useRef, useState } from 'react';

type PresetId = 'in_class' | 'sync_practice' | 'self_test' | 'self_study' | 'cram_pack' | 'custom';
type RouterTier = 'harness' | 'cloud' | 'local';
type WorkflowStage = 'negotiate' | 'approved';
type DesktopTab = 'canvas' | 'matrix' | 'citations';

interface PresetData {
  id: PresetId;
  label: string;
  duration: string;
  goal: string;
  ratio: [number, number, number];
  questions: {
    no: string;
    type: string;
    score: string;
    pageRef: string;
    stem: string;
    hint: string;
    key: string;
    citationNote: string;
  }[];
}

const PRESETS: PresetData[] = [
  {
    id: 'in_class',
    label: '随堂练习',
    duration: '12 分钟',
    goal: '单课时当堂概念辨析 + 坐标曲线解读 + 3 分钟微实验设计。',
    ratio: [30, 50, 20],
    questions: [
      {
        no: 'Q1',
        type: '概念辨析',
        score: '4 分',
        pageRef: '教材 P66 · 图 4-6',
        stem: '结合教材 §3.2 模型图，对比「主动转运」与「协助扩散」在能量消耗与载体构象翻转动力学上的核心区别。',
        hint: '提示：从 ATP 水解偶联、逆浓度梯度做功与载体饱和上限三个角度切入。',
        key: '主动转运耗能且可逆浓度梯度进行（如 Na⁺-K⁺ 泵）；协助扩散顺浓度不耗能（如红细胞摄取葡萄糖）。',
        citationNote: '对应 P66 原文第 2 段关于载体蛋白饱和现象的经典论述。',
      },
      {
        no: 'Q2',
        type: '坐标曲线',
        score: '6 分',
        pageRef: '教材 P67 · 思考讨论',
        stem: '在氧分压为 0 时，细胞对 K⁺ 的吸收速率为何保持非零平台？加入呼吸抑制剂后拐点将怎样移动？',
        hint: '提示：区分无氧呼吸少量 ATP 供能与载体蛋白数量极限。',
        key: '低氧平台依赖无氧呼吸供能；加入抑制剂后 ATP 中断，主动吸收归零，仅保留微弱被动渗透分量。',
        citationNote: '高频诊断点：警惕“无氧即速率归零”的错误直觉。',
      },
      {
        no: 'Q3',
        type: '迁移探究',
        score: '8 分',
        pageRef: '教材 P69 · 实验拓展',
        stem: '设计双因素对照实验验证低温 (4 °C) 降低根毛吸收 NO₃⁻ 的主导因素是膜流动性还是呼吸酶活性。',
        hint: '提示：设置 25 °C / 4 °C × 通氧 / N₂ 呼吸抑制四组交叉对照。',
        key: '分别测通氧组与抑制组的净差值（剥离物理扩散），再对比温度对差值衰减的影响幅度。',
        citationNote: '采分锚点：控制变量设计 4 分 + 逻辑推理 4 分。',
      },
    ],
  },
  {
    id: 'sync_practice',
    label: '同步练习',
    duration: '30 分钟',
    goal: '覆盖整章双节知识树，夯实基础并衔接质壁分离自动复原变式。',
    ratio: [25, 45, 30],
    questions: [
      {
        no: 'Q1',
        type: '基础梳理',
        score: '6 分',
        pageRef: '教材 P63–67',
        stem: '补全自由扩散、协助扩散与主动运输在「浓度方向」「转运蛋白」「能量代谢」三列中的对比矩阵。',
        hint: '注意通道蛋白与载体蛋白在溶质特异性结合上的差异。',
        key: '自由扩散（顺/无/否）；协助扩散（顺/有/否）；主动运输（可逆/有/是）。',
        citationNote: '同步梳理 P65 通道蛋白不需要与溶质分子结合的机制细节。',
      },
      {
        no: 'Q2',
        type: '变式推演',
        score: '8 分',
        pageRef: '教材 P64 · 实验',
        stem: '若细胞膜水通道蛋白 (AQP1) 表达下调 70%，低渗溶液中质壁分离复原的初始速率与最终平衡体积怎么变？',
        hint: '严格区分动力学速率常数与热力学渗透平衡终点。',
        key: '复原初始速率明显放缓，但最终渗透压平衡态液泡体积不变。',
        citationNote: '对接教材关于水分子两种跨膜方式占比的科学史料。',
      },
    ],
  },
  {
    id: 'self_test',
    label: '自测卷',
    duration: '45 分钟',
    goal: '严格对标阶段测评双向细目表，附采分细则与错因诊断标签。',
    ratio: [20, 40, 40],
    questions: [
      {
        no: 'T1',
        type: '单选',
        score: '6 分',
        pageRef: '教材 P68 · 膜模型',
        stem: '关于流动镶嵌模型与物质跨膜运输，下列哪项叙述与教材「人鼠细胞融合」经典实验证据直接矛盾？',
        hint: '聚焦磷脂双分子层侧向扩散与膜蛋白不对称嵌合特征。',
        key: '错项常误称“膜蛋白内外两侧完全对称分布”。',
        citationNote: '糖被与糖蛋白外侧不对称分布为历年高频考查点。',
      },
      {
        no: 'T2',
        type: '实验论述',
        score: '14 分',
        pageRef: '教材 P68–70',
        stem: '结合 P68 人鼠融合荧光标记与 P70 变形虫胞吞现象，论证膜流动性如何支撑载体翻转与大分子囊泡运输。',
        hint: '采分锚点：37 °C 荧光均一化 (4分) + 膜蛋白可移动 (5分) + 囊泡膜融合 (5分)。',
        key: '需紧扣“结构流动性决定膜泡融合与载体构象翻转功能”。',
        citationNote: '结构与功能观大题标准评分细则。',
      },
    ],
  },
  {
    id: 'self_study',
    label: '自学案',
    duration: '40 分钟',
    goal: '康奈尔导学问题链 + 教材页码精准锚定，适合课前零门槛独立预习。',
    ratio: [30, 50, 20],
    questions: [
      {
        no: '导学 1',
        type: 'P64 问题链',
        score: '预习锚点',
        pageRef: '教材 P64 问题探讨',
        stem: '阅读教材 P64 人工无蛋白脂双层实验：为何甘油自由穿过而葡萄糖受阻？由此推导出什么必然结论？',
        hint: '在右侧页边注记栏记录你对“亲水溶质通道/载体”的猜想。',
        key: '水溶性小分子需要跨膜转运蛋白介导方可高效穿膜。',
        citationNote: '人工脂双层通透性对比图对应 P64 左栏。',
      },
    ],
  },
  {
    id: 'cram_pack',
    label: '考前速记包',
    duration: '10 分钟',
    goal: '高频易错反例 + 核心口诀卡片，考前 10 分钟高密度检索。',
    ratio: [45, 35, 20],
    questions: [
      {
        no: '陷阱 1',
        type: '概念反例',
        score: '高频必看',
        pageRef: '拓展 · 协同转运',
        stem: '辨析：「逆浓度梯度运输必然直接消耗 ATP。」请举出继发性协同转运的教材反例。',
        hint: '关键词：小肠上皮细胞 SGLT1、Na⁺ 电化学势能。',
        key: '可间接利用离子梯度势能驱动溶质逆浓度转运，并非直接水解 ATP。',
        citationNote: '“间接耗能”依然判定为主动运输。',
      },
    ],
  },
  {
    id: 'custom',
    label: '自由定制',
    duration: '实时定制',
    goal: '按教师修订反馈与自定义三维认知比例实时动态生成专项学习资料。',
    ratio: [20, 40, 40],
    questions: [
      {
        no: '定制 1',
        type: '专项变式',
        score: '10 分',
        pageRef: '教师定制 · §3.2',
        stem: '结合教师指令要求，分析密闭容器中心肌细胞加入氰化物后，Na⁺-K⁺ 泵与 Ca²⁺ 排出速率的先后跌落时序。',
        hint: '注意 ATP 耗竭与 Na⁺ 电化学势能崩溃之间的因果滞后。',
        key: 'ATP 耗竭先使 Na⁺-K⁺ 泵停摆，随后破坏膜内外 Na⁺ 梯度使 Na⁺-Ca²⁺ 交换受阻。',
        citationNote: '严格命中教师批注中的“呼吸抑制剂综合变式”要求。',
      },
    ],
  },
];

const AUDIT_ROWS = [
  {
    source: 'apple-design · ζ=1.0 可中断阻尼弹簧',
    before: '按钮、Segmented Switcher 与边栏曾依赖 CSS ease-out / cubic-bezier',
    after: '全部按钮、Segmented 滑块、6 预设选框与侧栏折叠升级为 rAF 可中断临界阻尼弹簧 (ζ = 1.0)',
    why: '临界阻尼零振荡收尾，随时点击可打断并无缝继承瞬时位置与速度',
  },
  {
    source: 'apple-design · 松手速度与边界回弹',
    before: '缺乏松手惯性速度继承，拖拽/甩动至边缘时生硬截断',
    after: '实时计算 Pointer 速度 (vx, vy) 在松手时注入弹簧初速度 v₀，拉出边界触发 rubberband(0.55)，高速撞边触发弹性墙边界回弹',
    why: '物理手势投射 + 边界碰撞反馈，操作手感真实可信',
  },
  {
    source: 'fwc-swiftui · Liquid Glass & Duo',
    before: '旧版偏窄或滚动列表内混杂透明背景',
    after: 'macOS 三栏 NavigationSplitView；ScrollView 内容 100% 实底 #FFFFFF；仅顶栏/弹出层/HUD 使用 Glass 材质与 .sharedBackgroundVisibility(.hidden)',
    why: 'swiftui-liquid-glass: Glass 仅归属浮动导航与工具层',
  },
  {
    source: 'emilkowalski · Review & 0ms Keys',
    before: '离散切页缺乏桥接或快捷键动画偏慢',
    after: '零 transition: all、零 scale(0)；⌘K Spotlight 保持 0ms 瞬时响应',
    why: 'review-animations & STANDARDS: 键盘动作零阻塞',
  },
];

function rubberband(offset: number, dim: number, coeff = 0.55): number {
  const abs = Math.abs(offset);
  const res = (dim * abs * coeff) / (dim + abs * coeff);
  return offset < 0 ? -res : res;
}

function project(velocityPxPerSec: number, decel = 0.994): number {
  return ((velocityPxPerSec / 1000) * decel) / (1 - decel);
}

class Spring1D {
  value: number;
  target: number;
  velocity = 0;
  response: number;
  dampingRatio = 1.0; // ζ = 1.0 critically damped
  bounds: [number, number] | null = null;
  bounceFactor = 0.6;
  dragging = false;
  raf = 0;
  lastTime = 0;
  onUpdate: (v: number, vel: number) => void;
  onRebound?: (vel: number, side: string) => void;

  constructor(opts: {
    value: number;
    response?: number;
    bounds?: [number, number] | null;
    bounceFactor?: number;
    onUpdate: (v: number, vel: number) => void;
    onRebound?: (vel: number, side: string) => void;
  }) {
    this.value = opts.value;
    this.target = opts.value;
    this.response = opts.response ?? 0.24;
    this.bounds = opts.bounds ?? null;
    this.bounceFactor = opts.bounceFactor ?? 0.6;
    this.onUpdate = opts.onUpdate;
    this.onRebound = opts.onRebound;
  }

  setImmediate(val: number, vel = 0) {
    this.value = val;
    this.velocity = vel;
    this.onUpdate(this.value, this.velocity);
  }

  setTarget(nextTarget: number, boostVelocity: number | null = null) {
    this.target = nextTarget;
    if (boostVelocity !== null) this.velocity = boostVelocity;
    const reduced = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      this.value = nextTarget;
      this.velocity = 0;
      this.onUpdate(this.value, 0);
      return;
    }
    this.start();
  }

  stop() {
    if (this.raf) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    }
  }

  start() {
    if (this.raf || this.dragging) return;
    this.lastTime = performance.now();
    const step = (now: number) => {
      if (this.dragging) {
        this.raf = 0;
        return;
      }
      const dt = Math.min(0.032, Math.max(0.001, (now - this.lastTime) / 1000));
      this.lastTime = now;

      const omega = (2 * Math.PI) / this.response;
      const k = omega * omega;
      const c = 2 * this.dampingRatio * omega; // c = 2 * 1.0 * ω0

      const accel = -k * (this.value - this.target) - c * this.velocity;
      this.velocity += accel * dt;
      this.value += this.velocity * dt;

      if (this.bounds) {
        const [minB, maxB] = this.bounds;
        if (this.value < minB && this.velocity < -18) {
          this.value = minB - rubberband(minB - this.value, 60, 0.45);
          this.velocity = Math.abs(this.velocity) * this.bounceFactor + 120;
          this.onRebound?.(this.velocity, '左/上边界撞击回弹');
        } else if (this.value > maxB && this.velocity > 18) {
          this.value = maxB + rubberband(this.value - maxB, 60, 0.45);
          this.velocity = -Math.abs(this.velocity) * this.bounceFactor - 120;
          this.onRebound?.(this.velocity, '右/下边界撞击回弹');
        }
      }

      this.onUpdate(this.value, this.velocity);

      if (Math.abs(this.value - this.target) < 0.01 && Math.abs(this.velocity) < 0.35) {
        this.value = this.target;
        this.velocity = 0;
        this.onUpdate(this.value, 0);
        this.raf = 0;
        return;
      }
      this.raf = requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
  }
}

export function AppleDesignAuditedShowcase() {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [desktopTab, setDesktopTab] = useState<DesktopTab>('canvas');
  const [presetId, setPresetId] = useState<PresetId>('in_class');
  const [stage, setStage] = useState<WorkflowStage>('negotiate');
  const [routerTier, setRouterTier] = useState<RouterTier>('harness');
  const [routerOpen, setRouterOpen] = useState(false);
  const [selectedChapters, setSelectedChapters] = useState<string[]>(['3.1', '3.2']);
  const [ratios, setRatios] = useState<[number, number, number]>([30, 50, 20]);
  const [note, setNote] = useState('保留教材 §3.2 载体构象原图对照，第 3 题强化「呼吸抑制剂 + 低温」双因素对照分析。');
  const [showAnswers, setShowAnswers] = useState(true);
  const [auditOpen, setAuditOpen] = useState(false);
  const [spotlightOpen, setSpotlightOpen] = useState(false);
  const [hudVisible, setHudVisible] = useState(true);
  const [telemetry, setTelemetry] = useState<{ vx: number; vy: number; note: string }>({
    vx: 0,
    vy: 0,
    note: 'ζ = 1.00 临界阻尼就绪',
  });

  // Asymmetric hold-to-approve
  const [holdPct, setHoldPct] = useState(0);
  const [isHolding, setIsHolding] = useState(false);
  const holdRafRef = useRef<number | null>(null);
  const holdStartRef = useRef(0);

  // Refs for direct-DOM ζ=1.0 springs
  const splitRef = useRef<HTMLDivElement | null>(null);
  const segTrackRef = useRef<HTMLDivElement | null>(null);
  const segThumbRef = useRef<HTMLDivElement | null>(null);
  const tabBtnRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const presetStageRef = useRef<HTMLDivElement | null>(null);
  const presetThumbRef = useRef<HTMLDivElement | null>(null);
  const presetBtnRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const hudRef = useRef<HTMLDivElement | null>(null);

  const reportPhysics = useCallback((vx: number, vy: number, msg: string) => {
    setTelemetry({ vx: Math.round(vx), vy: Math.round(vy), note: msg });
  }, []);

  // Sidebar width ζ=1.0 spring
  const sidebarSpringRef = useRef<Spring1D | null>(null);
  useEffect(() => {
    sidebarSpringRef.current = new Spring1D({
      value: 285,
      response: 0.3,
      bounds: [0, 285],
      bounceFactor: 0.45,
      onUpdate: (w) => {
        if (splitRef.current) {
          splitRef.current.style.gridTemplateColumns = `${Math.max(0, w).toFixed(1)}px 395px minmax(520px, 1fr)`;
        }
      },
    });
    return () => sidebarSpringRef.current?.stop();
  }, []);

  const toggleSidebar = () => {
    const next = !sidebarOpen;
    setSidebarOpen(next);
    sidebarSpringRef.current?.setTarget(next ? 285 : 0);
  };

  // Segmented control ζ=1.0 springs
  const segXRef = useRef<Spring1D | null>(null);
  const segWRef = useRef<Spring1D | null>(null);
  const segDragRef = useRef({ active: false, startX: 0, baseLeft: 3, curLeft: 3, lastX: 0, lastT: 0, vx: 0 });

  useEffect(() => {
    segXRef.current = new Spring1D({
      value: 3,
      response: 0.25,
      bounceFactor: 0.62,
      onUpdate: (x) => {
        if (segThumbRef.current) segThumbRef.current.style.transform = `translate3d(${x.toFixed(2)}px, 0, 0)`;
      },
      onRebound: (v, side) => reportPhysics(v, 0, `分段滑块${side}`),
    });
    segWRef.current = new Spring1D({
      value: 100,
      response: 0.25,
      onUpdate: (w) => {
        if (segThumbRef.current) segThumbRef.current.style.width = `${w.toFixed(2)}px`;
      },
    });
    const syncSeg = (instant: boolean) => {
      const btn = tabBtnRefs.current[desktopTab];
      const track = segTrackRef.current;
      if (!btn || !track || !segXRef.current || !segWRef.current) return;
      segXRef.current.bounds = [3, Math.max(3, track.clientWidth - btn.offsetWidth - 3)];
      if (instant) {
        segXRef.current.setImmediate(btn.offsetLeft);
        segWRef.current.setImmediate(btn.offsetWidth);
      } else {
        segXRef.current.setTarget(btn.offsetLeft);
        segWRef.current.setTarget(btn.offsetWidth);
      }
    };
    requestAnimationFrame(() => syncSeg(true));
    const onResize = () => syncSeg(true);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      segXRef.current?.stop();
      segWRef.current?.stop();
    };
  }, [reportPhysics]);

  const selectTab = (tab: DesktopTab, boostVx: number | null = null) => {
    setDesktopTab(tab);
    const btn = tabBtnRefs.current[tab];
    const track = segTrackRef.current;
    if (btn && track && segXRef.current && segWRef.current) {
      segXRef.current.bounds = [3, Math.max(3, track.clientWidth - btn.offsetWidth - 3)];
      segXRef.current.setTarget(btn.offsetLeft, boostVx);
      segWRef.current.setTarget(btn.offsetWidth);
    }
  };

  // Preset 2D frame ζ=1.0 springs
  const pXRef = useRef<Spring1D | null>(null);
  const pYRef = useRef<Spring1D | null>(null);
  const pWRef = useRef<Spring1D | null>(null);
  const pHRef = useRef<Spring1D | null>(null);

  useEffect(() => {
    const syncDom = () => {
      if (!presetThumbRef.current || !pXRef.current || !pYRef.current || !pWRef.current || !pHRef.current) return;
      presetThumbRef.current.style.transform = `translate3d(${pXRef.current.value.toFixed(2)}px, ${pYRef.current.value.toFixed(2)}px, 0)`;
      presetThumbRef.current.style.width = `${pWRef.current.value.toFixed(2)}px`;
      presetThumbRef.current.style.height = `${pHRef.current.value.toFixed(2)}px`;
    };
    pXRef.current = new Spring1D({ value: 0, response: 0.25, bounceFactor: 0.6, onUpdate: syncDom, onRebound: (v) => reportPhysics(v, 0, '预设选框撞击边界回弹') });
    pYRef.current = new Spring1D({ value: 0, response: 0.25, bounceFactor: 0.6, onUpdate: syncDom, onRebound: (v) => reportPhysics(0, v, '预设选框撞击边界回弹') });
    pWRef.current = new Spring1D({ value: 110, response: 0.25, onUpdate: syncDom });
    pHRef.current = new Spring1D({ value: 58, response: 0.25, onUpdate: syncDom });

    const syncPreset = (instant: boolean) => {
      const chip = presetBtnRefs.current[presetId];
      const stageEl = presetStageRef.current;
      if (!chip || !stageEl || !pXRef.current || !pYRef.current || !pWRef.current || !pHRef.current) return;
      pXRef.current.bounds = [0, Math.max(0, stageEl.clientWidth - chip.offsetWidth)];
      pYRef.current.bounds = [0, Math.max(0, stageEl.clientHeight - chip.offsetHeight)];
      if (instant) {
        pXRef.current.setImmediate(chip.offsetLeft);
        pYRef.current.setImmediate(chip.offsetTop);
        pWRef.current.setImmediate(chip.offsetWidth);
        pHRef.current.setImmediate(chip.offsetHeight);
      }
    };
    requestAnimationFrame(() => syncPreset(true));
    const onResize = () => syncPreset(true);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      pXRef.current?.stop();
      pYRef.current?.stop();
      pWRef.current?.stop();
      pHRef.current?.stop();
    };
  }, [reportPhysics]);

  const switchPreset = (id: PresetId, boostVx: number | null = null, boostVy: number | null = null) => {
    const next = PRESETS.find((p) => p.id === id) ?? PRESETS[0];
    setPresetId(id);
    setRatios(next.ratio);
    const chip = presetBtnRefs.current[id];
    const stageEl = presetStageRef.current;
    if (chip && stageEl && pXRef.current && pYRef.current && pWRef.current && pHRef.current) {
      pXRef.current.bounds = [0, Math.max(0, stageEl.clientWidth - chip.offsetWidth)];
      pYRef.current.bounds = [0, Math.max(0, stageEl.clientHeight - chip.offsetHeight)];
      pXRef.current.setTarget(chip.offsetLeft, boostVx);
      pYRef.current.setTarget(chip.offsetTop, boostVy);
      pWRef.current.setTarget(chip.offsetWidth);
      pHRef.current.setTarget(chip.offsetHeight);
    }
  };

  // HUD 2D ζ=1.0 springs with release velocity & boundary rebound
  const hudXRef = useRef<Spring1D | null>(null);
  const hudYRef = useRef<Spring1D | null>(null);
  const hudDragRef = useRef({ active: false, sx: 0, sy: 0, bx: 0, by: 0, lx: 0, ly: 0, lt: 0, vx: 0, vy: 0 });

  useEffect(() => {
    const syncHud = () => {
      if (!hudRef.current || !hudXRef.current || !hudYRef.current) return;
      hudRef.current.style.transform = `translate3d(${hudXRef.current.value.toFixed(2)}px, ${hudYRef.current.value.toFixed(2)}px, 0)`;
    };
    hudXRef.current = new Spring1D({ value: 0, response: 0.3, bounds: [-520, 0], bounceFactor: 0.58, onUpdate: syncHud, onRebound: (v) => reportPhysics(v, 0, 'HUD 撞击边界回弹!') });
    hudYRef.current = new Spring1D({ value: 0, response: 0.3, bounds: [-420, 0], bounceFactor: 0.58, onUpdate: syncHud, onRebound: (v) => reportPhysics(0, v, 'HUD 撞击边界回弹!') });
    return () => {
      hudXRef.current?.stop();
      hudYRef.current?.stop();
    };
  }, [reportPhysics]);

  const activePreset = PRESETS.find((p) => p.id === presetId) ?? PRESETS[0];

  const routerMeta: Record<RouterTier, { title: string; detail: string; tint: string }> = {
    harness: { title: 'CLI Harness · claude / codex', detail: '智能分阶本地命令行编排', tint: '#34C759' },
    cloud: { title: 'Cloud API · DeepSeek / GPT-4o', detail: '高并发云端精排直连', tint: '#007AFF' },
    local: { title: 'Local · Ollama qwen2.5:14b', detail: '100% 离线私有推理', tint: '#5856D6' },
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSpotlightOpen((s) => !s);
      } else if (e.key === 'Escape') {
        setSpotlightOpen(false);
        setRouterOpen(false);
        setAuditOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const toggleChapter = (id: string) => {
    setSelectedChapters((prev) =>
      prev.includes(id) ? (prev.length > 1 ? prev.filter((x) => x !== id) : prev) : [...prev, id]
    );
  };

  const beginHold = () => {
    if (stage === 'approved') {
      setStage('negotiate');
      setHoldPct(0);
      return;
    }
    setIsHolding(true);
    holdStartRef.current = performance.now();
    const tick = (now: number) => {
      const pct = Math.min(1, (now - holdStartRef.current) / 850);
      setHoldPct(pct);
      if (pct >= 1) {
        setIsHolding(false);
        setStage('approved');
        holdRafRef.current = null;
      } else {
        holdRafRef.current = requestAnimationFrame(tick);
      }
    };
    holdRafRef.current = requestAnimationFrame(tick);
  };

  const finishHold = (allowQuickTap: boolean) => {
    if (holdRafRef.current !== null) {
      cancelAnimationFrame(holdRafRef.current);
      holdRafRef.current = null;
    }
    if (isHolding) {
      const elapsed = performance.now() - holdStartRef.current;
      setIsHolding(false);
      if (allowQuickTap && elapsed < 220) {
        setHoldPct(1);
        setStage('approved');
      } else {
        setHoldPct(0);
      }
    }
  };

  // Segmented Thumb Drag Handlers
  const onSegThumbDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    segXRef.current?.stop();
    segWRef.current?.stop();
    if (segXRef.current) segXRef.current.dragging = true;
    const cur = segXRef.current?.value ?? 3;
    segDragRef.current = { active: true, startX: e.clientX, baseLeft: cur, curLeft: cur, lastX: e.clientX, lastT: performance.now(), vx: 0 };
  };

  const onSegThumbMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const sd = segDragRef.current;
    const track = segTrackRef.current;
    const thumb = segThumbRef.current;
    if (!sd.active || !track || !thumb || !segXRef.current) return;
    const now = performance.now();
    const dt = Math.max(1, now - sd.lastT) / 1000;
    sd.vx = (e.clientX - sd.lastX) / dt;
    sd.lastX = e.clientX;
    sd.lastT = now;

    const minX = 3;
    const maxX = Math.max(3, track.clientWidth - thumb.offsetWidth - 3);
    const raw = sd.baseLeft + (e.clientX - sd.startX);
    const clamped = raw < minX ? minX - rubberband(minX - raw, 110, 0.55) : raw > maxX ? maxX + rubberband(raw - maxX, 110, 0.55) : raw;
    sd.curLeft = clamped;
    segXRef.current.setImmediate(clamped, sd.vx);
  };

  const onSegThumbUp = () => {
    const sd = segDragRef.current;
    if (!sd.active || !segXRef.current || !segThumbRef.current) return;
    sd.active = false;
    segXRef.current.dragging = false;

    const projCenter = sd.curLeft + segThumbRef.current.offsetWidth / 2 + project(sd.vx, 0.994);
    let best: DesktopTab = 'canvas';
    let bestDist = Infinity;
    (['canvas', 'matrix', 'citations'] as DesktopTab[]).forEach((t) => {
      const b = tabBtnRefs.current[t];
      if (!b) return;
      const c = b.offsetLeft + b.offsetWidth / 2;
      if (Math.abs(c - projCenter) < bestDist) {
        bestDist = Math.abs(c - projCenter);
        best = t;
      }
    });
    reportPhysics(sd.vx, 0, Math.abs(sd.vx) > 650 ? '分段滑块高速松手边界回弹!' : 'ζ = 1.0 速度接管落位');
    selectTab(best, sd.vx * 0.85);
  };

  return (
    <div className="mac-sp-root">
      <style>{`
        .mac-sp-root {
          --bg-grouped: #F2F2F7;
          --label-primary: #1C1C1E;
          --label-secondary: #636366;
          --separator: rgba(60, 60, 67, 0.14);

          height: calc(100vh - 38px);
          min-height: 680px;
          display: flex;
          flex-direction: column;
          background-color: var(--bg-grouped);
          color: var(--label-primary);
          font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'PingFang SC', sans-serif;
          overflow: hidden;
          position: relative;
        }
        .mac-sp-display {
          font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'PingFang SC', sans-serif;
          letter-spacing: -0.022em;
        }
        .mac-sp-tabular { font-variant-numeric: tabular-nums; }
        .mac-sp-glass {
          background-color: rgba(255, 255, 255, 0.76);
          backdrop-filter: blur(22px) saturate(180%);
          -webkit-backdrop-filter: blur(22px) saturate(180%);
          border: 1px solid rgba(255, 255, 255, 0.82);
          box-shadow: 0 12px 30px -12px rgba(0, 0, 0, 0.14), inset 0 1px 0 rgba(255, 255, 255, 0.85);
        }
        .mac-sp-topbar {
          height: 54px;
          flex-shrink: 0;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 14px;
          padding: 0 18px;
          border-bottom: 1px solid var(--separator);
          z-index: 25;
        }
        .mac-sp-split {
          flex: 1;
          min-height: 0;
          display: grid;
          grid-template-columns: 285px 395px minmax(520px, 1fr);
        }
        .mac-sp-col {
          height: 100%;
          overflow-y: auto;
          padding: 14px;
          border-right: 1px solid var(--separator);
          background-color: var(--bg-grouped);
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .mac-sp-card {
          background-color: #FFFFFF;
          border-radius: 14px;
          border: 1px solid rgba(60, 60, 67, 0.08);
          box-shadow: 0 2px 8px -4px rgba(0, 0, 0, 0.04);
          overflow: hidden;
        }
        .mac-sp-row {
          display: flex;
          align-items: flex-start;
          gap: 10px;
          padding: 10px 13px;
          border-bottom: 1px solid var(--separator);
          background-color: #FFFFFF;
        }
        .mac-sp-row:last-child { border-bottom: none; }
        .mac-sp-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          padding: 10px 14px;
          border-radius: 999px;
          border: 1px solid rgba(60, 60, 67, 0.12);
          background-color: rgba(255, 255, 255, 0.88);
          color: var(--label-primary);
          font-size: 12.5px;
          font-weight: 500;
          cursor: pointer;
          user-select: none;
        }
        .mac-sp-seg-track {
          position: relative;
          display: inline-flex;
          align-items: center;
          background: rgba(118, 118, 128, 0.14);
          border-radius: 999px;
          padding: 3px;
          gap: 2px;
          touch-action: none;
          user-select: none;
        }
        .mac-sp-seg-thumb {
          position: absolute;
          top: 3px;
          left: 0;
          height: calc(100% - 6px);
          background: #FFFFFF;
          border-radius: 999px;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12);
          will-change: transform, width;
          cursor: grab;
          z-index: 1;
        }
        .mac-sp-tab {
          position: relative;
          z-index: 2;
          border: none;
          background: transparent;
          padding: 6px 14px;
          font-size: 12px;
          font-weight: 600;
          border-radius: 999px;
          cursor: pointer;
          user-select: none;
        }
        .mac-sp-preset-stage { position: relative; }
        .mac-sp-preset-grid {
          position: relative;
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(108px, 1fr));
          gap: 8px;
          z-index: 2;
        }
        .mac-sp-preset-thumb {
          position: absolute;
          top: 0;
          left: 0;
          border-radius: 10px;
          background: rgba(0, 122, 255, 0.12);
          border: 1.5px solid #007AFF;
          pointer-events: none;
          will-change: transform, width, height;
          z-index: 1;
        }
        .mac-sp-preset-chip {
          position: relative;
          z-index: 2;
          text-align: left;
          padding: 10px 11px;
          border-radius: 10px;
          border: 1px solid rgba(60, 60, 67, 0.1);
          background-color: rgba(249, 249, 251, 0.72);
          cursor: pointer;
        }
        .mac-sp-preset-chip[data-selected="true"] {
          background-color: transparent;
          border-color: transparent;
        }
        .mac-sp-doc-item {
          display: grid;
          grid-template-columns: minmax(0, 65ch) 1px minmax(190px, 1fr);
          gap: 20px;
          padding: 16px 20px;
          border-bottom: 1px solid var(--separator);
          background-color: #FFFFFF;
        }
        .mac-sp-hud {
          position: fixed;
          right: 24px;
          bottom: 24px;
          width: 348px;
          border-radius: 18px;
          padding: 12px 15px 14px;
          z-index: 38;
          touch-action: none;
          will-change: transform;
          cursor: grab;
        }
      `}</style>

      {/* Top Toolbar */}
      <header className="mac-sp-glass mac-sp-topbar no-print">
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ display: 'flex', gap: '7px', paddingRight: '4px' }} aria-hidden="true">
            <span style={{ width: '11px', height: '11px', borderRadius: '50%', backgroundColor: '#FF5F57' }} />
            <span style={{ width: '11px', height: '11px', borderRadius: '50%', backgroundColor: '#FEBC2E' }} />
            <span style={{ width: '11px', height: '11px', borderRadius: '50%', backgroundColor: '#28C840' }} />
          </div>
          <button onClick={toggleSidebar} className="mac-sp-btn" style={{ padding: '6px 11px' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
              <rect x="3" y="3" width="18" height="18" rx="3" />
              <path d="M9 3v18" />
            </svg>
            <span>{sidebarOpen ? '隐藏边栏' : '显示边栏'}</span>
          </button>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
            <span className="mac-sp-display" style={{ fontSize: '16.5px', fontWeight: 700 }}>Auto Study Guidance</span>
            <span style={{ fontSize: '12px', color: 'var(--label-secondary)' }}>生物必修一《第 3 章 物质跨膜运输》.pdf</span>
          </div>
        </div>

        {/* Physical Draggable & Interruptible Segmented Switcher (ζ = 1.0) */}
        <div ref={segTrackRef} className="mac-sp-seg-track">
          <div
            ref={segThumbRef}
            className="mac-sp-seg-thumb"
            onPointerDown={onSegThumbDown}
            onPointerMove={onSegThumbMove}
            onPointerUp={onSegThumbUp}
            onPointerCancel={onSegThumbUp}
          />
          {(
            [
              { id: 'canvas', label: '清样预览画布' },
              { id: 'matrix', label: '双向细目矩阵' },
              { id: 'citations', label: '课本原文溯源' },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              ref={(el) => {
                tabBtnRefs.current[t.id] = el;
              }}
              onClick={() => selectTab(t.id)}
              className="mac-sp-tab"
              style={{ color: desktopTab === t.id ? 'var(--label-primary)' : 'var(--label-secondary)' }}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', position: 'relative' }}>
          <button onClick={() => setSpotlightOpen(true)} className="mac-sp-btn mac-sp-tabular" style={{ padding: '6px 11px' }}>
            Spotlight ⌘K
          </button>
          <button onClick={() => setHudVisible((v) => !v)} className="mac-sp-btn" style={{ padding: '6px 11px' }}>
            {hudVisible ? '隐藏物理 HUD' : '呼出物理 HUD'}
          </button>
          <div style={{ position: 'relative' }}>
            <button onClick={() => setRouterOpen((o) => !o)} className="mac-sp-btn" style={{ padding: '6px 12px' }}>
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: routerMeta[routerTier].tint }} />
              <span>{routerMeta[routerTier].title.split('·')[0]}</span>
            </button>
            {routerOpen && (
              <div className="mac-sp-glass" style={{ position: 'absolute', top: 'calc(100% + 8px)', right: 0, width: '300px', borderRadius: '16px', padding: '8px', zIndex: 45 }}>
                {(['harness', 'cloud', 'local'] as RouterTier[]).map((t) => (
                  <button
                    key={t}
                    onClick={() => {
                      setRouterTier(t);
                      setRouterOpen(false);
                    }}
                    className="mac-sp-btn"
                    style={{ width: '100%', justifyContent: 'space-between', border: 'none', borderRadius: '10px', padding: '9px 10px', backgroundColor: routerTier === t ? 'rgba(0,122,255,0.12)' : 'transparent' }}
                  >
                    <span>{routerMeta[t].title}</span>
                    {routerTier === t && <span style={{ color: '#007AFF' }}>✓</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button onClick={() => setAuditOpen(true)} className="mac-sp-btn" style={{ border: 'none', backgroundColor: '#007AFF', color: '#FFFFFF', fontWeight: 600, padding: '7px 14px' }}>
            联合审计 (4)
          </button>
        </div>
      </header>

      {/* Main SplitView */}
      <div ref={splitRef} className="mac-sp-split">
        {/* Left Sidebar */}
        <aside className="mac-sp-col" style={{ backgroundColor: '#ECECF1', overflowX: 'hidden' }}>
          <div className="mac-sp-card" style={{ padding: '12px 13px' }}>
            <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--label-secondary)', marginBottom: '6px' }}>已导入教材源</div>
            <div style={{ fontSize: '13.5px', fontWeight: 700 }}>人教版《分子与细胞》.pdf</div>
            <div className="mac-sp-tabular" style={{ fontSize: '11.5px', color: 'var(--label-secondary)', marginTop: '3px' }}>142 页 · 18 张矢量图 · OCR 99.4%</div>
          </div>
          <div className="mac-sp-card">
            <div style={{ padding: '10px 13px', fontSize: '12px', fontWeight: 700, color: 'var(--label-secondary)', borderBottom: '1px solid var(--separator)' }}>章节筛选树</div>
            {[
              { id: '3.1', name: '3.1 水进出细胞的原理', pg: 'P62–65' },
              { id: '3.2', name: '3.2 主动运输与胞吞胞吐', pg: 'P66–71' },
              { id: '3.3', name: '3.3 流动镶嵌模型探索史', pg: 'P72–75' },
            ].map((ch) => (
              <label key={ch.id} className="mac-sp-row" style={{ cursor: 'pointer' }}>
                <input type="checkbox" checked={selectedChapters.includes(ch.id)} onChange={() => toggleChapter(ch.id)} style={{ marginTop: '3px', accentColor: '#007AFF' }} />
                <div>
                  <div style={{ fontSize: '13px', fontWeight: 600 }}>{ch.name}</div>
                  <div className="mac-sp-tabular" style={{ fontSize: '11px', color: 'var(--label-secondary)' }}>{ch.pg}</div>
                </div>
              </label>
            ))}
          </div>
        </aside>

        {/* Center Inspector */}
        <section className="mac-sp-col">
          <div className="mac-sp-card" style={{ padding: '14px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
              <span style={{ fontSize: '13.5px', fontWeight: 700 }}>6 大学习资料预设（ζ=1.0 可打断弹簧）</span>
              <span className="mac-sp-tabular" style={{ fontSize: '12px', color: '#007AFF', fontWeight: 600 }}>{activePreset.duration}</span>
            </div>
            <div ref={presetStageRef} className="mac-sp-preset-stage">
              <div ref={presetThumbRef} className="mac-sp-preset-thumb" />
              <div className="mac-sp-preset-grid">
                {PRESETS.map((p) => (
                  <button
                    key={p.id}
                    ref={(el) => {
                      presetBtnRefs.current[p.id] = el;
                    }}
                    onClick={() => switchPreset(p.id)}
                    className="mac-sp-preset-chip"
                    data-selected={presetId === p.id}
                  >
                    <div style={{ fontSize: '13.5px', fontWeight: 700, color: presetId === p.id ? '#007AFF' : 'var(--label-primary)' }}>{p.label}</div>
                    <div className="mac-sp-tabular" style={{ fontSize: '11px', color: 'var(--label-secondary)', marginTop: '2px' }}>{p.duration}</div>
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="mac-sp-card" style={{ padding: '14px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
              <span style={{ fontSize: '13px', fontWeight: 700 }}>Bloom 认知配比校准</span>
              <span className="mac-sp-tabular" style={{ fontSize: '12px', color: '#34C759', fontWeight: 600 }}>{ratios.join('% / ')}%</span>
            </div>
            {(['概念记忆', '原理理解', '实验迁移'] as const).map((axis, idx) => (
              <div key={axis} style={{ marginBottom: '8px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11.5px', color: 'var(--label-secondary)' }}>
                  <span>{axis}</span>
                  <span className="mac-sp-tabular" style={{ fontWeight: 600, color: 'var(--label-primary)' }}>{ratios[idx]}%</span>
                </div>
                <input
                  type="range"
                  min={10}
                  max={70}
                  value={ratios[idx]}
                  onChange={(e) => {
                    const next = [...ratios] as [number, number, number];
                    next[idx] = Number(e.target.value);
                    setRatios(next);
                  }}
                  style={{ width: '100%', accentColor: '#007AFF' }}
                />
              </div>
            ))}
          </div>

          <div className="mac-sp-card" style={{ padding: '14px' }}>
            <div style={{ fontSize: '13px', fontWeight: 700, marginBottom: '6px' }}>Stage 1 · 教师批注修订（同步右栏）</div>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} style={{ width: '100%', borderRadius: '10px', border: '1px solid var(--separator)', backgroundColor: '#F9F9FB', padding: '9px 11px', fontSize: '12.5px', lineHeight: 1.55 }} />
          </div>

          <div style={{ marginTop: 'auto' }}>
            <button
              onPointerDown={beginHold}
              onPointerUp={() => finishHold(true)}
              onPointerLeave={() => finishHold(false)}
              onPointerCancel={() => finishHold(false)}
              className="mac-sp-btn"
              style={{
                width: '100%',
                position: 'relative',
                overflow: 'hidden',
                border: 'none',
                padding: '13px 16px',
                backgroundColor: stage === 'approved' ? '#34C759' : '#007AFF',
                color: '#FFFFFF',
                fontWeight: 600,
              }}
            >
              {stage !== 'approved' && (
                <span aria-hidden="true" style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${Math.round(holdPct * 100)}%`, backgroundColor: 'rgba(255,255,255,0.28)' }} />
              )}
              <span style={{ position: 'relative' }}>
                {stage === 'approved' ? 'Stage 2 已签发 · 点击返回修改方案' : isHolding ? `长按蓄力签发中 ${Math.round(holdPct * 100)}%` : '确认需求方案并生成 Stage 2（可长按蓄力）'}
              </span>
            </button>
          </div>
        </section>

        {/* Right Widescreen Canvas */}
        <main className="mac-sp-col" style={{ padding: '20px 26px', borderRight: 'none' }}>
          <div className="mac-sp-card" style={{ maxWidth: '1080px', width: '100%', margin: '0 auto' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--separator)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
              <div>
                <h1 className="mac-sp-display" style={{ fontSize: '21px', fontWeight: 700, margin: 0 }}>{activePreset.label} ·《第 3 章 物质跨膜运输》</h1>
                <div className="mac-sp-tabular" style={{ fontSize: '12px', color: 'var(--label-secondary)', marginTop: '3px' }}>
                  已选章节 {selectedChapters.join(', ')} · 认知比例 {ratios.join('% / ')}% · {routerMeta[routerTier].title}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '12px', fontWeight: 600, padding: '4px 11px', borderRadius: '999px', backgroundColor: stage === 'approved' ? 'rgba(52,199,89,0.14)' : 'rgba(255,149,0,0.14)', color: stage === 'approved' ? '#248A3D' : '#B25000' }}>
                  {stage === 'approved' ? 'Stage 2 · 已确认定稿' : 'Stage 1 · 方案预览'}
                </span>
                <button onClick={() => setShowAnswers((a) => !a)} className="mac-sp-btn" style={{ padding: '6px 12px' }}>
                  {showAnswers ? '隐藏参考答案' : '展开参考答案'}
                </button>
              </div>
            </div>

            <div style={{ padding: '11px 20px', backgroundColor: '#F9F9FC', borderBottom: '1px solid var(--separator)', fontSize: '12.5px', color: 'var(--label-secondary)' }}>
              <strong style={{ color: '#007AFF' }}>已注入教师修订：</strong>{note}
            </div>

            {desktopTab === 'canvas' && activePreset.questions.map((q) => (
              <div key={`${activePreset.id}-${q.no}`} className="mac-sp-doc-item">
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                    <span className="mac-sp-tabular" style={{ fontSize: '13.5px', fontWeight: 700, color: '#007AFF' }}>{q.no}</span>
                    <span style={{ fontSize: '11.5px', fontWeight: 600, padding: '2px 8px', borderRadius: '6px', backgroundColor: 'rgba(118,118,128,0.1)', color: 'var(--label-secondary)' }}>{q.type}</span>
                    <span className="mac-sp-tabular" style={{ fontSize: '11.5px', color: 'var(--label-secondary)' }}>{q.score}</span>
                  </div>
                  <p style={{ margin: '0 0 6px', fontSize: '14.5px', lineHeight: 1.68 }}>{q.stem}</p>
                  {showAnswers && (
                    <div style={{ marginTop: '8px', padding: '8px 12px', borderRadius: '10px', backgroundColor: 'rgba(52,199,89,0.08)', fontSize: '12.5px', color: '#1E6B34' }}>
                      <strong>参考答案：</strong>{q.key}
                    </div>
                  )}
                </div>
                <div style={{ backgroundColor: 'var(--separator)' }} />
                <aside style={{ fontSize: '12px', lineHeight: 1.55, color: 'var(--label-secondary)' }}>
                  <div style={{ fontWeight: 700, color: 'var(--label-primary)', marginBottom: '4px' }}>{q.pageRef}</div>
                  <div>{q.citationNote}</div>
                </aside>
              </div>
            ))}

            {desktopTab === 'matrix' && (
              <div style={{ padding: '18px 20px' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                  <thead><tr style={{ backgroundColor: '#F2F2F7', borderBottom: '1px solid var(--separator)', textAlign: 'left' }}><th style={{ padding: '10px' }}>题号</th><th style={{ padding: '10px' }}>题型标签</th><th style={{ padding: '10px' }}>教材页码锚点</th><th style={{ padding: '10px' }}>分值</th></tr></thead>
                  <tbody>
                    {activePreset.questions.map((q) => (
                      <tr key={q.no} style={{ borderBottom: '1px solid var(--separator)' }}>
                        <td className="mac-sp-tabular" style={{ padding: '10px', fontWeight: 700, color: '#007AFF' }}>{q.no}</td>
                        <td style={{ padding: '10px', fontWeight: 600 }}>{q.type}</td>
                        <td style={{ padding: '10px', color: 'var(--label-secondary)' }}>{q.pageRef}</td>
                        <td className="mac-sp-tabular" style={{ padding: '10px', color: '#248A3D', fontWeight: 600 }}>{q.score}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {desktopTab === 'citations' && (
              <div style={{ padding: '20px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                <div style={{ padding: '14px', borderRadius: '12px', backgroundColor: '#F9F9FB', border: '1px solid var(--separator)' }}>
                  <div style={{ fontSize: '13px', fontWeight: 700, marginBottom: '6px' }}>教材原文切片 · §3.2 P66</div>
                  <p style={{ fontSize: '13px', lineHeight: 1.65, color: 'var(--label-secondary)', margin: 0 }}>“主动运输普遍存在于动植物和微生物细胞中，通过主动运输来选择吸收所需要的物质……” </p>
                </div>
                <div style={{ padding: '14px', borderRadius: '12px', backgroundColor: '#F9F9FB', border: '1px solid var(--separator)' }}>
                  <div style={{ fontSize: '13px', fontWeight: 700, color: '#007AFF', marginBottom: '6px' }}>已注入教师修订要求</div>
                  <p style={{ fontSize: '13px', lineHeight: 1.65, margin: 0 }}>{note}</p>
                </div>
              </div>
            )}
          </div>
        </main>
      </div>

      {/* 2D Direct-DOM HUD with ζ=1.0 Release Velocity & Boundary Rebound */}
      {hudVisible && (
        <div
          ref={hudRef}
          className="mac-sp-glass mac-sp-hud no-print"
          style={{ transform: 'translate3d(0px, 0px, 0px)' }}
          onPointerDown={(e) => {
            hudXRef.current?.stop();
            hudYRef.current?.stop();
            if (hudXRef.current) hudXRef.current.dragging = true;
            if (hudYRef.current) hudYRef.current.dragging = true;
            e.currentTarget.setPointerCapture(e.pointerId);
            hudDragRef.current = {
              active: true,
              sx: e.clientX,
              sy: e.clientY,
              bx: hudXRef.current?.value ?? 0,
              by: hudYRef.current?.value ?? 0,
              lx: e.clientX,
              ly: e.clientY,
              lt: performance.now(),
              vx: 0,
              vy: 0,
            };
          }}
          onPointerMove={(e) => {
            const hd = hudDragRef.current;
            if (!hd.active || !hudXRef.current || !hudYRef.current) return;
            const now = performance.now();
            const dt = Math.max(1, now - hd.lt) / 1000;
            hd.vx = (e.clientX - hd.lx) / dt;
            hd.vy = (e.clientY - hd.ly) / dt;
            hd.lx = e.clientX;
            hd.ly = e.clientY;
            hd.lt = now;
            const rx = hd.bx + (e.clientX - hd.sx);
            const ry = hd.by + (e.clientY - hd.sy);
            const cx = rx < -520 ? -520 - rubberband(-520 - rx, 180) : rx > 0 ? rubberband(rx, 180) : rx;
            const cy = ry < -420 ? -420 - rubberband(-420 - ry, 180) : ry > 0 ? rubberband(ry, 180) : ry;
            hudXRef.current.setImmediate(cx, hd.vx);
            hudYRef.current.setImmediate(cy, hd.vy);
          }}
          onPointerUp={() => {
            const hd = hudDragRef.current;
            if (!hd.active || !hudXRef.current || !hudYRef.current) return;
            hd.active = false;
            hudXRef.current.dragging = false;
            hudYRef.current.dragging = false;
            const px = hudXRef.current.value + project(hd.vx, 0.994);
            const py = hudYRef.current.value + project(hd.vy, 0.994);
            const tx = Math.max(-520, Math.min(0, px));
            const ty = Math.max(-420, Math.min(0, py));
            reportPhysics(hd.vx, hd.vy, px < -520 || px > 0 || py < -420 || py > 0 ? 'HUD 撞击边界回弹!' : 'ζ = 1.0 速度接管');
            hudXRef.current.setTarget(tx, Math.max(-2200, Math.min(2200, hd.vx * 0.75)));
            hudYRef.current.setTarget(ty, Math.max(-2200, Math.min(2200, hd.vy * 0.75)));
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
            <span style={{ fontSize: '12.5px', fontWeight: 700 }}>实时阻尼弹簧引擎 · HUD</span>
            <span className="mac-sp-tabular" style={{ fontSize: '11px', fontWeight: 700, color: '#007AFF' }}>ζ = 1.00</span>
          </div>
          <div className="mac-sp-tabular" style={{ fontSize: '11px', color: 'var(--label-secondary)', backgroundColor: 'rgba(118,118,128,0.08)', borderRadius: '8px', padding: '6px 9px', marginBottom: '9px' }}>
            松手速度 v₀: ({telemetry.vx}, {telemetry.vy}) px/s · <strong style={{ color: '#248A3D' }}>{telemetry.note}</strong>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px', textAlign: 'center' }}>
            {[
              { label: '概念记忆', val: `${ratios[0]}%`, color: '#007AFF' },
              { label: '原理理解', val: `${ratios[1]}%`, color: '#5856D6' },
              { label: '实验迁移', val: `${ratios[2]}%`, color: '#34C759' },
            ].map((s) => (
              <div key={s.label} style={{ backgroundColor: '#FFFFFF', borderRadius: '10px', padding: '9px 6px', border: '1px solid rgba(60,60,67,0.08)' }}>
                <div className="mac-sp-tabular" style={{ fontSize: '16px', fontWeight: 700, color: s.color }}>{s.val}</div>
                <div style={{ fontSize: '11px', color: 'var(--label-secondary)', marginTop: '2px' }}>{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Audit Drawer */}
      {auditOpen && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.28)', zIndex: 55, display: 'flex', justifyContent: 'flex-end' }} onClick={() => setAuditOpen(false)}>
          <aside className="mac-sp-glass" onClick={(e) => e.stopPropagation()} style={{ width: 'min(700px, 100vw)', height: '100%', backgroundColor: 'rgba(249,249,251,0.96)', padding: '22px 26px', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h2 className="mac-sp-display" style={{ fontSize: '20px', fontWeight: 700, margin: 0 }}>Apple Design 物理弹簧版 (ζ=1.0) × 审计表</h2>
              <button onClick={() => setAuditOpen(false)} className="mac-sp-btn">完成</button>
            </div>
            <div className="mac-sp-card">
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12.5px', lineHeight: 1.55 }}>
                <thead><tr style={{ backgroundColor: '#F2F2F7', textAlign: 'left', borderBottom: '1px solid var(--separator)' }}><th style={{ padding: '10px 12px' }}>Before</th><th style={{ padding: '10px 12px' }}>After</th><th style={{ padding: '10px 12px' }}>Why</th></tr></thead>
                <tbody>
                  {AUDIT_ROWS.map((row) => (
                    <tr key={row.source} style={{ borderBottom: '1px solid var(--separator)', verticalAlign: 'top' }}>
                      <td style={{ padding: '10px 12px', color: 'var(--label-secondary)' }}><div style={{ fontSize: '11px', fontWeight: 700, color: '#007AFF' }}>{row.source}</div>{row.before}</td>
                      <td style={{ padding: '10px 12px' }}>{row.after}</td>
                      <td style={{ padding: '10px 12px', color: '#248A3D' }}>{row.why}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </aside>
        </div>
      )}

      {/* 0ms Instant Spotlight Modal */}
      {spotlightOpen && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.34)', zIndex: 60, display: 'flex', justifyContent: 'center', alignItems: 'flex-start', paddingTop: '14vh' }} onClick={() => setSpotlightOpen(false)}>
          <div className="mac-sp-glass" onClick={(e) => e.stopPropagation()} style={{ width: 'min(520px, calc(100vw - 32px))', borderRadius: '18px', padding: '14px', backgroundColor: 'rgba(255,255,255,0.95)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
              <span style={{ fontSize: '13px', fontWeight: 700 }}>Spotlight 桌面指令面板 (0ms 零延迟)</span>
              <button onClick={() => setSpotlightOpen(false)} style={{ border: 'none', background: 'transparent', color: '#007AFF', cursor: 'pointer' }}>ESC</button>
            </div>
            <div className="mac-sp-card">
              {PRESETS.map((p) => (
                <button
                  key={p.id}
                  onClick={() => {
                    switchPreset(p.id);
                    setSpotlightOpen(false);
                  }}
                  className="mac-sp-row"
                  style={{ width: '100%', border: 'none', borderBottom: '1px solid var(--separator)', justifyContent: 'space-between', cursor: 'pointer' }}
                >
                  <span style={{ fontSize: '13.5px', fontWeight: 600 }}>切换预设：{p.label}</span>
                  <span style={{ fontSize: '12px', color: 'var(--label-secondary)' }}>{p.duration}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
