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
