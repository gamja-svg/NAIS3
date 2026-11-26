import { describe, expect, it } from 'vitest'
import {
  BRUSH_MAX,
  BRUSH_MIN,
  fitView,
  sampleColor,
  smartDab,
  stepBrush,
  stepTolerance,
  toImage,
  toolFor,
  zoomAt,
  type Pixels
} from '../src/renderer/src/lib/custom-censor'
import { withCensorRev } from '../src/renderer/src/stores/custom-censor-store'

// [custom] 검열 화면 계산: 맞춤·확대·붓 크기·누른 도구
describe('custom: censor view', () => {
  it('fits the picture inside the box, centered', () => {
    expect(fitView(1000, 500, 500, 500)).toEqual({ scale: 1, x: 250, y: 0 })
    expect(fitView(400, 400, 800, 1600)).toEqual({ scale: 0.25, x: 100, y: 0 })
    expect(fitView(0, 0, 800, 1600)).toEqual({ scale: 1, x: 0, y: 0 })
  })

  it('zooms around the pointer and stays within the limits', () => {
    const fit = fitView(1000, 500, 500, 500)
    const zoomed = zoomAt(fit, 2, 500, 250, fit.scale)
    expect(zoomed.scale).toBe(2)
    // 커서 아래의 그림 자리는 그대로다
    expect(toImage(zoomed, 500, 250)).toEqual(toImage(fit, 500, 250))
    expect(zoomAt(fit, 0.01, 0, 0, fit.scale).scale).toBe(0.5) // 맞춤의 절반까지만
    expect(zoomAt(fit, 1000, 0, 0, fit.scale).scale).toBe(16)
  })

  it('steps the brush by about 12%, at least one pixel, within its range', () => {
    expect(stepBrush(28, true)).toBe(31)
    expect(stepBrush(31, false)).toBe(28)
    expect(stepBrush(3, true)).toBe(4)
    expect(stepBrush(BRUSH_MIN, false)).toBe(BRUSH_MIN)
    expect(stepBrush(BRUSH_MAX, true)).toBe(BRUSH_MAX)
  })

  it('lets keys override the selected tool: Space/middle = move, Alt = tap shape, Shift = erase', () => {
    const none = { alt: false, shift: false, space: false, button: 0 }
    expect(toolFor('paint', none)).toBe('paint')
    expect(toolFor('erase', none)).toBe('erase')
    expect(toolFor('paint', { ...none, shift: true })).toBe('erase')
    expect(toolFor('paint', { ...none, alt: true })).toBe('pick')
    expect(toolFor('paint', { ...none, alt: true, shift: true })).toBe('pick')
    expect(toolFor('pick', { ...none, space: true })).toBe('pan')
    expect(toolFor('paint', { ...none, button: 1 })).toBe('pan')
  })

  it('adds a version to a repainted image address only after a save', () => {
    expect(withCensorRev('nais-image://local/?path=a', undefined)).toBe(
      'nais-image://local/?path=a'
    )
    expect(withCensorRev('nais-image://local/?path=a', 2)).toBe('nais-image://local/?path=a&v=2')
  })

  it('paints only pixels close in color to the reference inside the brush circle', () => {
    // 왼쪽 절반은 살색, 오른쪽 절반은 어두운 선
    const base: Pixels = { width: 8, height: 4, data: new Uint8ClampedArray(8 * 4 * 4) }
    for (let p = 0; p < 32; p++)
      base.data.set(p % 8 < 4 ? [240, 200, 180, 255] : [40, 20, 20, 255], p * 4)
    const ref = sampleColor(base, 1, 1)
    expect(ref).toEqual([240, 200, 180])
    // 레이어는 그림의 (1, 0)에서 시작하는 6x4 조각
    const layer: Pixels = { width: 6, height: 4, data: new Uint8ClampedArray(6 * 4 * 4) }
    smartDab(layer, 1, 0, base, 4, 2, 2.5, ref, 40, false)
    const alpha = (x: number, y: number): number => layer.data[(y * 6 + (x - 1)) * 4 + 3]
    expect(alpha(3, 2)).toBe(255) // 살색 — 칠함
    expect(alpha(2, 1)).toBe(255)
    expect(alpha(4, 2)).toBe(0) // 선 — 붓이 지나가도 남는다
    expect(alpha(5, 1)).toBe(0)
    expect(alpha(1, 0)).toBe(0) // 붓 원 밖
    // 지우기도 같은 색만
    layer.data.fill(255)
    smartDab(layer, 1, 0, base, 4, 2, 2.5, ref, 40, true)
    expect(alpha(3, 2)).toBe(0)
    expect(alpha(4, 2)).toBe(255)
    // 범위를 넓히면 선까지 칠한다
    layer.data.fill(0)
    smartDab(layer, 1, 0, base, 4, 2, 2.5, ref, 400, false)
    expect(alpha(4, 2)).toBe(255)
    expect(stepTolerance(40, true)).toBe(45)
    expect(stepTolerance(5, false)).toBe(5)
    expect(stepTolerance(150, true)).toBe(150)
  })
})
