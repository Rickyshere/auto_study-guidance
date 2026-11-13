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
