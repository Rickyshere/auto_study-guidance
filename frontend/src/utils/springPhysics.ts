import React, { createContext, useCallback, useContext, useEffect, useRef } from 'react';

/**
 * UIScrollView logarithmic rubberband resistance curve.
 */
export function rubberband(offset: number, dim: number, coeff = 0.55): number {
  const abs = Math.abs(offset);
  if (dim <= 0) return 0;
  const res = (dim * abs * coeff) / (dim + abs * coeff);
  return offset < 0 ? -res : res;
}

/**
 * Natural deceleration endpoint projection from pointer release velocity (px/s).
 */
export function project(velocityPxPerSec: number, decel = 0.994): number {
  return ((velocityPxPerSec / 1000) * decel) / (1 - decel);
}

/**
 * 1D Interruptible Critically Damped Harmonic Oscillator (ζ = 1.0).
 * Driven purely by requestAnimationFrame; supports mid-flight target/velocity interruption,
 * pointer release velocity inheritance (v0), and elastic wall boundary rebound.
 */
export class Spring1D {
  value: number;
  target: number;
  velocity = 0;
  response: number;
  dampingRatio = 1.0; // ζ = 1.0 critically damped
  bounds: [number, number] | null = null;
  bounceFactor = 0.55;
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
    this.bounceFactor = opts.bounceFactor ?? 0.55;
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
    const reduced =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
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

export interface SpringTelemetry {
  vx: number;
  vy: number;
  note: string;
}

type TelemetryReporter = (vx: number, vy: number, msg: string) => void;

const SpringTelemetryContext = createContext<TelemetryReporter>(() => {});

export const SpringTelemetryProvider: React.FC<{
  onReport: TelemetryReporter;
  children: React.ReactNode;
}> = ({ onReport, children }) =>
  React.createElement(SpringTelemetryContext.Provider, { value: onReport }, children);

export function useSpringTelemetry(): TelemetryReporter {
  return useContext(SpringTelemetryContext);
}

export interface SpringButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  pressScale?: number;
  maxShift?: number;
  response?: number;
  springLabel?: string;
}

/**
 * Button driven by a 3-DOF (scale, tx, ty) ζ=1.0 critically-damped spring:
 * - No CSS ease-out / cubic-bezier
 * - Mid-flight interruptible on rapid re-press
 * - Inherits pointer release velocity v0 and rebounds off ±maxShift bounds
 */
export const SpringButton = React.forwardRef<HTMLButtonElement, SpringButtonProps>(
  (
    {
      pressScale = 0.96,
      maxShift = 10,
      response = 0.22,
      springLabel,
      disabled,
      style,
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel,
      onPointerEnter,
      onPointerLeave,
      children,
      ...rest
    },
    forwardedRef
  ) => {
    const innerRef = useRef<HTMLButtonElement | null>(null);
    const reportTelemetry = useSpringTelemetry();

    const springsRef = useRef<{
      s: Spring1D;
      tx: Spring1D;
      ty: Spring1D;
    } | null>(null);

    const dragRef = useRef({
      active: false,
      sx: 0,
      sy: 0,
      lx: 0,
      ly: 0,
      lt: 0,
      vx: 0,
      vy: 0,
    });

    const assignRef = useCallback(
      (node: HTMLButtonElement | null) => {
        innerRef.current = node;
        if (typeof forwardedRef === 'function') {
          forwardedRef(node);
        } else if (forwardedRef) {
          forwardedRef.current = node;
        }
      },
      [forwardedRef]
    );

    useEffect(() => {
      const applyTransform = () => {
        const el = innerRef.current;
        const sp = springsRef.current;
        if (!el || !sp) return;
        el.style.transform = `translate3d(${sp.tx.value.toFixed(2)}px, ${sp.ty.value.toFixed(2)}px, 0) scale(${sp.s.value.toFixed(4)})`;
      };

      const s = new Spring1D({
        value: 1,
        response,
        onUpdate: applyTransform,
      });
      const tx = new Spring1D({
        value: 0,
        response,
        bounds: [-maxShift, maxShift],
        bounceFactor: 0.56,
        onUpdate: applyTransform,
        onRebound: (v) => reportTelemetry(v, 0, `${springLabel || '按钮'}撞击边界回弹`),
      });
      const ty = new Spring1D({
        value: 0,
        response,
        bounds: [-maxShift, maxShift],
        bounceFactor: 0.56,
        onUpdate: applyTransform,
        onRebound: (v) => reportTelemetry(0, v, `${springLabel || '按钮'}撞击边界回弹`),
      });
      springsRef.current = { s, tx, ty };

      return () => {
        s.stop();
        tx.stop();
        ty.stop();
      };
    }, [maxShift, response, reportTelemetry, springLabel]);

    const handlePointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
      onPointerDown?.(e);
      if (disabled) return;
      const sp = springsRef.current;
      if (!sp) return;
      const now = performance.now();
      dragRef.current = {
        active: true,
        sx: e.clientX,
        sy: e.clientY,
        lx: e.clientX,
        ly: e.clientY,
        lt: now,
        vx: 0,
        vy: 0,
      };
      sp.s.setTarget(pressScale);
      sp.tx.dragging = true;
      sp.ty.dragging = true;
    };

    const handlePointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
      onPointerMove?.(e);
      const d = dragRef.current;
      const sp = springsRef.current;
      if (!d.active || !sp || disabled) return;
      const now = performance.now();
      const dt = Math.max(1, now - d.lt) / 1000;
      d.vx = (e.clientX - d.lx) / dt;
      d.vy = (e.clientY - d.ly) / dt;
      d.lx = e.clientX;
      d.ly = e.clientY;
      d.lt = now;
      sp.tx.setImmediate(rubberband(e.clientX - d.sx, maxShift, 0.55), d.vx);
      sp.ty.setImmediate(rubberband(e.clientY - d.sy, maxShift, 0.55), d.vy);
    };

    const finishPointer = (e: React.PointerEvent<HTMLButtonElement>, isUp: boolean) => {
      const d = dragRef.current;
      const sp = springsRef.current;
      if (!d.active || !sp) return;
      d.active = false;
      sp.tx.dragging = false;
      sp.ty.dragging = false;
      sp.s.setTarget(isUp && !disabled ? 1.012 : 1.0);
      sp.tx.setTarget(0, d.vx * 0.28);
      sp.ty.setTarget(0, d.vy * 0.28);
      if (isUp && !disabled && (Math.abs(d.vx) > 25 || Math.abs(d.vy) > 25)) {
        reportTelemetry(
          d.vx,
          d.vy,
          Math.hypot(d.vx, d.vy) > 520
            ? `${springLabel || '按钮'}高初速松手触发边界回弹`
            : `${springLabel || '按钮'} ζ=1.0 带松手速度回弹`
        );
      }
      if (!isUp) {
        onPointerCancel?.(e);
      }
    };

    return React.createElement(
      'button',
      {
        ...rest,
        ref: assignRef,
        disabled,
        onPointerDown: handlePointerDown,
        onPointerMove: handlePointerMove,
        onPointerUp: (e: React.PointerEvent<HTMLButtonElement>) => {
          finishPointer(e, true);
          onPointerUp?.(e);
        },
        onPointerCancel: (e: React.PointerEvent<HTMLButtonElement>) => finishPointer(e, false),
        onPointerEnter: (e: React.PointerEvent<HTMLButtonElement>) => {
          if (!disabled && !dragRef.current.active) {
            springsRef.current?.s.setTarget(1.012);
          }
          onPointerEnter?.(e);
        },
        onPointerLeave: (e: React.PointerEvent<HTMLButtonElement>) => {
          if (dragRef.current.active) {
            finishPointer(e, false);
          } else {
            springsRef.current?.s.setTarget(1.0);
          }
          onPointerLeave?.(e);
        },
        style: {
          willChange: 'transform',
          touchAction: 'manipulation',
          ...style,
        },
      },
      children
    );
  }
);

SpringButton.displayName = 'SpringButton';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  disabled?: boolean;
  title?: string;
}

export interface SpringSegmentedControlProps<T extends string> {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  springLabel?: string;
  compact?: boolean;
  wrap?: boolean;
  thumbTint?: string;
  style?: React.CSSProperties;
}

/**
 * Reusable Segmented Control (1D pill rail or 2D wrapped switch matrix) driven by ζ=1.0 Spring1D:
 * - Supports click interruption mid-flight
 * - Supports pointer dragging 1:1 with rubberband & release velocity v0 + boundary rebound
 */
export function SpringSegmentedControl<T extends string>({
  options,
  value,
  onChange,
  springLabel = '切换滑块',
  compact = false,
  wrap = false,
  thumbTint = '#FFFFFF',
  style,
}: SpringSegmentedControlProps<T>) {
  const reportTelemetry = useSpringTelemetry();
  const trackRef = useRef<HTMLDivElement | null>(null);
  const thumbRef = useRef<HTMLDivElement | null>(null);
  const btnRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const xRef = useRef<Spring1D | null>(null);
  const yRef = useRef<Spring1D | null>(null);
  const wRef = useRef<Spring1D | null>(null);
  const hRef = useRef<Spring1D | null>(null);

  const dragRef = useRef({
    active: false,
    sx: 0,
    sy: 0,
    bx: 0,
    by: 0,
    cx: 0,
    cy: 0,
    lx: 0,
    ly: 0,
    lt: 0,
    vx: 0,
    vy: 0,
  });

  const syncTo = useCallback(
    (targetVal: T, instant: boolean, boostVx: number | null = null, boostVy: number | null = null) => {
      const btn = btnRefs.current[targetVal];
      const track = trackRef.current;
      if (!btn) {
        if (thumbRef.current) thumbRef.current.style.opacity = '0';
        return;
      }
      if (thumbRef.current) thumbRef.current.style.opacity = '1';
      if (!track || !xRef.current || !yRef.current || !wRef.current || !hRef.current) return;
      xRef.current.bounds = [3, Math.max(3, track.clientWidth - btn.offsetWidth - 3)];
      yRef.current.bounds = [3, Math.max(3, track.clientHeight - btn.offsetHeight - 3)];
      if (instant) {
        xRef.current.setImmediate(btn.offsetLeft);
        yRef.current.setImmediate(btn.offsetTop);
        wRef.current.setImmediate(btn.offsetWidth);
        hRef.current.setImmediate(btn.offsetHeight);
      } else {
        xRef.current.setTarget(btn.offsetLeft, boostVx);
        yRef.current.setTarget(btn.offsetTop, boostVy);
        wRef.current.setTarget(btn.offsetWidth);
        hRef.current.setTarget(btn.offsetHeight);
      }
    },
    []
  );

  useEffect(() => {
    const applyDom = () => {
      if (
        !thumbRef.current ||
        !xRef.current ||
        !yRef.current ||
        !wRef.current ||
        !hRef.current
      ) {
        return;
      }
      thumbRef.current.style.transform = `translate3d(${xRef.current.value.toFixed(2)}px, ${yRef.current.value.toFixed(2)}px, 0)`;
      thumbRef.current.style.width = `${wRef.current.value.toFixed(2)}px`;
      thumbRef.current.style.height = `${hRef.current.value.toFixed(2)}px`;
    };

    xRef.current = new Spring1D({
      value: 3,
      response: 0.24,
      bounceFactor: 0.6,
      onUpdate: applyDom,
      onRebound: (v, side) => reportTelemetry(v, 0, `${springLabel}${side}`),
    });
    yRef.current = new Spring1D({
      value: 3,
      response: 0.24,
      bounceFactor: 0.6,
      onUpdate: applyDom,
      onRebound: (v, side) => reportTelemetry(0, v, `${springLabel}${side}`),
    });
    wRef.current = new Spring1D({ value: 64, response: 0.24, onUpdate: applyDom });
    hRef.current = new Spring1D({ value: 26, response: 0.24, onUpdate: applyDom });

    const rafId = requestAnimationFrame(() => syncTo(value, true));
    const onResize = () => syncTo(value, true);
    window.addEventListener('resize', onResize);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', onResize);
      xRef.current?.stop();
      yRef.current?.stop();
      wRef.current?.stop();
      hRef.current?.stop();
    };
  }, [reportTelemetry, springLabel, syncTo, options.length]);

  useEffect(() => {
    syncTo(value, false);
  }, [value, syncTo, options]);

  const onThumbDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    xRef.current?.stop();
    yRef.current?.stop();
    wRef.current?.stop();
    hRef.current?.stop();
    if (xRef.current) xRef.current.dragging = true;
    if (yRef.current) yRef.current.dragging = true;
    const cx = xRef.current?.value ?? 3;
    const cy = yRef.current?.value ?? 3;
    dragRef.current = {
      active: true,
      sx: e.clientX,
      sy: e.clientY,
      bx: cx,
      by: cy,
      cx,
      cy,
      lx: e.clientX,
      ly: e.clientY,
      lt: performance.now(),
      vx: 0,
      vy: 0,
    };
  };

  const onThumbMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    const track = trackRef.current;
    const thumb = thumbRef.current;
    if (!d.active || !track || !thumb || !xRef.current || !yRef.current) return;
    const now = performance.now();
    const dt = Math.max(1, now - d.lt) / 1000;
    d.vx = (e.clientX - d.lx) / dt;
    d.vy = (e.clientY - d.ly) / dt;
    d.lx = e.clientX;
    d.ly = e.clientY;
    d.lt = now;

    const minX = 3;
    const maxX = Math.max(3, track.clientWidth - thumb.offsetWidth - 3);
    const rawX = d.bx + (e.clientX - d.sx);
    const clampedX =
      rawX < minX
        ? minX - rubberband(minX - rawX, 80, 0.55)
        : rawX > maxX
        ? maxX + rubberband(rawX - maxX, 80, 0.55)
        : rawX;

    const minY = 3;
    const maxY = Math.max(3, track.clientHeight - thumb.offsetHeight - 3);
    const rawY = d.by + (e.clientY - d.sy);
    const clampedY =
      rawY < minY
        ? minY - rubberband(minY - rawY, 60, 0.55)
        : rawY > maxY
        ? maxY + rubberband(rawY - maxY, 60, 0.55)
        : rawY;

    d.cx = clampedX;
    d.cy = clampedY;
    xRef.current.setImmediate(clampedX, d.vx);
    yRef.current.setImmediate(clampedY, d.vy);
  };

  const onThumbUp = () => {
    const d = dragRef.current;
    if (!d.active || !xRef.current || !yRef.current || !thumbRef.current) return;
    d.active = false;
    xRef.current.dragging = false;
    yRef.current.dragging = false;

    const projX = d.cx + thumbRef.current.offsetWidth / 2 + project(d.vx, 0.994);
    const projY = d.cy + thumbRef.current.offsetHeight / 2 + (wrap ? project(d.vy, 0.994) : 0);

    let bestOpt: SegmentedOption<T> | null = null;
    let bestDist = Infinity;
    options.forEach((opt) => {
      if (opt.disabled) return;
      const b = btnRefs.current[opt.value];
      if (!b) return;
      const cx = b.offsetLeft + b.offsetWidth / 2;
      const cy = b.offsetTop + b.offsetHeight / 2;
      const dist = Math.hypot(cx - projX, cy - projY);
      if (dist < bestDist) {
        bestDist = dist;
        bestOpt = opt;
      }
    });

    if (bestOpt) {
      const nextVal = (bestOpt as SegmentedOption<T>).value;
      reportTelemetry(
        d.vx,
        d.vy,
        Math.hypot(d.vx, d.vy) > 580 ? `${springLabel}高速松手边界回弹!` : `${springLabel} ζ=1.0 落位`
      );
      syncTo(nextVal, false, d.vx * 0.8, d.vy * 0.8);
      if (nextVal !== value) {
        onChange(nextVal);
      }
    } else {
      syncTo(value, false);
    }
  };

  return React.createElement(
    'div',
    {
      ref: trackRef,
      style: {
        position: 'relative',
        isolation: 'isolate',
        display: wrap ? 'flex' : 'inline-flex',
        flexWrap: wrap ? 'wrap' : 'nowrap',
        alignItems: 'center',
        backgroundColor: 'rgba(118, 118, 128, 0.13)',
        borderRadius: wrap ? '11px' : '999px',
        padding: '3px',
        gap: '2px',
        maxWidth: '100%',
        touchAction: 'none',
        userSelect: 'none',
        ...style,
      },
    },
    React.createElement('div', {
      ref: thumbRef,
      onPointerDown: onThumbDown,
      onPointerMove: onThumbMove,
      onPointerUp: onThumbUp,
      onPointerCancel: onThumbUp,
      style: {
        position: 'absolute',
        top: 0,
        left: 0,
        backgroundColor: thumbTint,
        borderRadius: wrap ? '8px' : '999px',
        boxShadow: '0 2px 8px rgba(0, 0, 0, 0.12)',
        willChange: 'transform, width, height',
        cursor: 'grab',
        zIndex: 1,
      },
    }),
    ...options.map((opt) => {
      const isSelected = opt.value === value;
      return React.createElement(
        'button',
        {
          key: opt.value,
          type: 'button',
          title: opt.title,
          disabled: opt.disabled,
          ref: (el: HTMLButtonElement | null) => {
            btnRefs.current[opt.value] = el;
          },
          onClick: () => {
            if (opt.disabled) return;
            reportTelemetry(180, 0, `${springLabel} ζ=1.0 切换`);
            syncTo(opt.value, false);
            if (opt.value !== value) {
              onChange(opt.value);
            }
          },
          style: {
            position: 'relative',
            zIndex: 2,
            border: 'none',
            backgroundColor: 'transparent',
            padding: compact ? '4px 9px' : '6px 12px',
            fontSize: compact ? '11px' : '12px',
            fontWeight: isSelected ? 700 : 500,
            color: opt.disabled ? '#AEAEB2' : isSelected ? '#007AFF' : '#636366',
            borderRadius: wrap ? '8px' : '999px',
            cursor: opt.disabled ? 'not-allowed' : 'pointer',
            whiteSpace: 'nowrap',
          },
        },
        opt.label
      );
    })
  );
}

/**
 * Physical ζ=1.0 Spring Toggle Switch replacing native HTML checkboxes for switching options.
 */
export const SpringToggleSwitch: React.FC<{
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  springLabel?: string;
  disabled?: boolean;
}> = ({ checked, onChange, label, springLabel = '物理开关', disabled = false }) => {
  const reportTelemetry = useSpringTelemetry();
  const knobRef = useRef<HTMLSpanElement | null>(null);
  const trackRef = useRef<HTMLSpanElement | null>(null);
  const xSpringRef = useRef<Spring1D | null>(null);
  const dragRef = useRef({ active: false, sx: 0, bx: 0, cx: 0, lx: 0, lt: 0, vx: 0, moved: false });

  useEffect(() => {
    xSpringRef.current = new Spring1D({
      value: checked ? 18 : 0,
      response: 0.2,
      bounds: [0, 18],
      bounceFactor: 0.58,
      onUpdate: (x) => {
        if (knobRef.current) {
          knobRef.current.style.transform = `translate3d(${x.toFixed(2)}px, 0, 0)`;
        }
      },
      onRebound: (v, side) => reportTelemetry(v, 0, `${springLabel}${side}`),
    });
    return () => xSpringRef.current?.stop();
  }, [reportTelemetry, springLabel]);

  useEffect(() => {
    xSpringRef.current?.setTarget(checked ? 18 : 0);
  }, [checked]);

  const handleToggle = (boostVx: number | null = null) => {
    if (disabled) return;
    const next = !checked;
    xSpringRef.current?.setTarget(next ? 18 : 0, boostVx);
    reportTelemetry(boostVx ?? (next ? 240 : -240), 0, `${springLabel} ζ=1.0 切换`);
    onChange(next);
  };

  return React.createElement(
    'button',
    {
      type: 'button',
      role: 'switch',
      'aria-checked': checked,
      disabled,
      onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => {
        if (disabled) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        xSpringRef.current?.stop();
        if (xSpringRef.current) xSpringRef.current.dragging = true;
        const cur = xSpringRef.current?.value ?? (checked ? 18 : 0);
        dragRef.current = {
          active: true,
          sx: e.clientX,
          bx: cur,
          cx: cur,
          lx: e.clientX,
          lt: performance.now(),
          vx: 0,
          moved: false,
        };
      },
      onPointerMove: (e: React.PointerEvent<HTMLButtonElement>) => {
        const d = dragRef.current;
        if (!d.active || !xSpringRef.current) return;
        if (Math.abs(e.clientX - d.sx) > 3) d.moved = true;
        const now = performance.now();
        const dt = Math.max(1, now - d.lt) / 1000;
        d.vx = (e.clientX - d.lx) / dt;
        d.lx = e.clientX;
        d.lt = now;
        const raw = d.bx + (e.clientX - d.sx);
        const val =
          raw < 0 ? -rubberband(-raw, 10, 0.5) : raw > 18 ? 18 + rubberband(raw - 18, 10, 0.5) : raw;
        d.cx = val;
        xSpringRef.current.setImmediate(val, d.vx);
      },
      onPointerUp: () => {
        const d = dragRef.current;
        if (!d.active || !xSpringRef.current) return;
        d.active = false;
        xSpringRef.current.dragging = false;
        if (!d.moved) {
          handleToggle(d.vx);
          return;
        }
        const projected = d.cx + project(d.vx, 0.992) * 0.12;
        const next = projected >= 9;
        xSpringRef.current.setTarget(next ? 18 : 0, d.vx * 0.7);
        reportTelemetry(d.vx, 0, `${springLabel}拖动松手回弹`);
        if (next !== checked) {
          onChange(next);
        }
      },
      onPointerCancel: () => {
        if (xSpringRef.current) {
          xSpringRef.current.dragging = false;
          xSpringRef.current.setTarget(checked ? 18 : 0);
        }
        dragRef.current.active = false;
      },
      style: {
        border: 'none',
        background: 'transparent',
        padding: '2px 0',
        display: 'inline-flex',
        alignItems: 'center',
        gap: '7px',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        touchAction: 'none',
        userSelect: 'none',
      },
    },
    React.createElement(
      'span',
      {
        ref: trackRef,
        style: {
          position: 'relative',
          width: '40px',
          height: '22px',
          borderRadius: '999px',
          backgroundColor: checked ? '#34C759' : 'rgba(120, 120, 128, 0.28)',
          padding: '2px',
          display: 'inline-flex',
          alignItems: 'center',
          flexShrink: 0,
        },
      },
      React.createElement('span', {
        ref: knobRef,
        style: {
          width: '18px',
          height: '18px',
          borderRadius: '999px',
          backgroundColor: '#FFFFFF',
          boxShadow: '0 2px 5px rgba(0, 0, 0, 0.22)',
          willChange: 'transform',
        },
      })
    ),
    label
      ? React.createElement(
          'span',
          { style: { fontSize: '12px', fontWeight: 500, color: '#1C1C1E' } },
          label
        )
      : null
  );
};
