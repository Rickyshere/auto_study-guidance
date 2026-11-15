/**
 * 页边批注卡防重叠排布（照 spec 的 resolveMarginCardsCollision）。
 *
 * 每张卡有一个"理想位置"（正文锚点的垂直位置），按理想位置排序后，
 * 依次把后一张推到前一张下方 minGap 处，保证任意两张卡片永不重叠。
 */

export interface MarginCardLayout {
  id: string;
  idealTop: number;
  actualTop: number;
  height: number;
}

export function resolveMarginCardsCollision(
  cards: MarginCardLayout[],
  minGap: number = 12
): MarginCardLayout[] {
  const sorted = [...cards].sort((a, b) => a.idealTop - b.idealTop);
  for (let i = 0; i < sorted.length; i++) {
    if (i === 0) {
      sorted[i].actualTop = Math.max(0, sorted[i].idealTop);
    } else {
      const prev = sorted[i - 1];
      const minAllowedTop = prev.actualTop + prev.height + minGap;
      sorted[i].actualTop = Math.max(sorted[i].idealTop, minAllowedTop);
    }
  }
  return sorted;
}

/** 四档弹簧参数（RK4 阻尼谐振子），全局禁止 linear / ease-out。 */
export const SPRING_TIERS = {
  pill: { stiffness: 520, damping: 32, mass: 0.8 },
  drawer: { stiffness: 340, damping: 28, mass: 1.0 },
  flip: { stiffness: 280, damping: 26, mass: 1.0 },
  settle: { stiffness: 220, damping: 24, mass: 1.0 },
} as const;

export type SpringTierName = keyof typeof SPRING_TIERS;