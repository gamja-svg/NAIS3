/**
 * [custom] 검수 모드의 검열(흰칠) — 화면 계산 (확대·붓 크기·누른 도구).
 * 그림 좌표 = 원본 픽셀. 화면 좌표 = 작업 칸의 왼쪽 위에서 잰 CSS 픽셀.
 */

export type CensorTool = 'paint' | 'erase' | 'pick' | 'pan'

export interface CensorView {
  /** 그림 1픽셀이 화면에서 차지하는 크기 */
  scale: number
  /** 그림 왼쪽 위가 놓이는 화면 자리 */
  x: number
  y: number
}

export const BRUSH_MIN = 2
export const BRUSH_MAX = 400
export const BRUSH_DEFAULT = 28
const ZOOM_MAX = 16

/** 칸 안에 그림 전체가 들어가게 (가운데) */
export function fitView(boxW: number, boxH: number, imgW: number, imgH: number): CensorView {
  if (!boxW || !boxH || !imgW || !imgH) return { scale: 1, x: 0, y: 0 }
  const scale = Math.min(boxW / imgW, boxH / imgH)
  return { scale, x: (boxW - imgW * scale) / 2, y: (boxH - imgH * scale) / 2 }
}

/**
 * (px, py) 화면 자리를 붙잡은 채 factor배로 확대·축소한다 (휠은 커서 자리, 버튼은 가운데).
 * 맞춤 크기의 절반보다 작게, 16배보다 크게는 가지 않는다.
 */
export function zoomAt(
  view: CensorView,
  factor: number,
  px: number,
  py: number,
  fitScale: number
): CensorView {
  const scale = Math.min(ZOOM_MAX, Math.max(fitScale * 0.5, view.scale * factor))
  const k = scale / view.scale
  return { scale, x: px - (px - view.x) * k, y: py - (py - view.y) * k }
}

/** 화면 자리 → 그림 좌표 */
export function toImage(view: CensorView, px: number, py: number): { x: number; y: number } {
  return { x: (px - view.x) / view.scale, y: (py - view.y) / view.scale }
}

/** 휠 한 칸에 붓 크기를 12%씩 — 작을 때도 1픽셀은 바뀌게 */
export function stepBrush(brush: number, up: boolean): number {
  const next = up ? Math.max(brush + 1, brush * 1.12) : Math.min(brush - 1, brush / 1.12)
  return Math.round(Math.min(BRUSH_MAX, Math.max(BRUSH_MIN, next)))
}

export const TOLERANCE_MIN = 5
export const TOLERANCE_MAX = 150
export const TOLERANCE_DEFAULT = 40

/** 허용 범위를 5씩 */
export function stepTolerance(tolerance: number, up: boolean): number {
  return Math.min(TOLERANCE_MAX, Math.max(TOLERANCE_MIN, tolerance + (up ? 5 : -5)))
}

export interface Pixels {
  width: number
  height: number
  /** RGBA */
  data: Uint8ClampedArray
}

/** (x, y) 둘레 3x3의 평균 색 — 색 맞춤 붓의 기준 색 (한 픽셀의 잡티에 흔들리지 않게) */
export function sampleColor(base: Pixels, x: number, y: number): [number, number, number] {
  const cx = Math.min(base.width - 1, Math.max(0, Math.round(x)))
  const cy = Math.min(base.height - 1, Math.max(0, Math.round(y)))
  let r = 0
  let g = 0
  let b = 0
  let n = 0
  for (let py = Math.max(0, cy - 1); py <= Math.min(base.height - 1, cy + 1); py++)
    for (let px = Math.max(0, cx - 1); px <= Math.min(base.width - 1, cx + 1); px++) {
      const i = (py * base.width + px) * 4
      r += base.data[i]
      g += base.data[i + 1]
      b += base.data[i + 2]
      n++
    }
  return [r / n, g / n, b / n]
}

/**
 * 색 맞춤 붓 한 번 찍기 — 붓 원 안에서 원본 색이 기준 색과 비슷한(RGB 거리 ≤ tolerance) 픽셀만 칠하거나 지운다.
 * layer = 칠 레이어의 일부 (그림의 (ox, oy)에서 시작하는 네모), base = 원본 그림 전체.
 */
export function smartDab(
  layer: Pixels,
  ox: number,
  oy: number,
  base: Pixels,
  cx: number,
  cy: number,
  radius: number,
  ref: [number, number, number],
  tolerance: number,
  erase: boolean
): void {
  const limit = tolerance * tolerance
  const r2 = radius * radius
  const x0 = Math.max(0, ox, Math.floor(cx - radius))
  const y0 = Math.max(0, oy, Math.floor(cy - radius))
  const x1 = Math.min(base.width, ox + layer.width, Math.ceil(cx + radius) + 1)
  const y1 = Math.min(base.height, oy + layer.height, Math.ceil(cy + radius) + 1)
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      const dx = x + 0.5 - cx
      const dy = y + 0.5 - cy
      if (dx * dx + dy * dy > r2) continue
      const b = (y * base.width + x) * 4
      const dr = base.data[b] - ref[0]
      const dg = base.data[b + 1] - ref[1]
      const db = base.data[b + 2] - ref[2]
      if (dr * dr + dg * dg + db * db > limit) continue
      const l = ((y - oy) * layer.width + (x - ox)) * 4
      if (erase) layer.data[l + 3] = 0
      else {
        layer.data[l] = layer.data[l + 1] = layer.data[l + 2] = 255
        layer.data[l + 3] = 255
      }
    }
}

/**
 * 누르는 순간 쓸 도구 — 키가 고른 도구보다 먼저다:
 * Space·가운데 버튼 = 이동, Alt = 콕 찍기, Shift = 지우기, 아무 키도 없으면 고른 도구(기본 칠하기).
 */
export function toolFor(
  selected: CensorTool,
  keys: { alt: boolean; shift: boolean; space: boolean; button: number }
): CensorTool {
  if (keys.button === 1 || keys.space) return 'pan'
  if (keys.alt) return 'pick'
  if (keys.shift) return 'erase'
  return selected
}
