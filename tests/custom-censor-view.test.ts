import { describe, expect, it } from 'vitest'
import {
  BRUSH_MAX,
  BRUSH_MIN,
  fitView,
  stepBrush,
  toImage,
  toolFor,
  zoomAt
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
})
