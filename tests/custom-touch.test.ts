import { describe, expect, it } from 'vitest'
import {
  TOUCH_MOVE_TOLERANCE_PX,
  TOUCH_REORDER_HOLD_MS,
  dragIntent
} from '../src/shared/custom-touch'

// [custom] 터치·원격 모드: 그냥 끌면 스크롤, 3초 누른 뒤 끌면 자리 이동
describe('custom: dragIntent', () => {
  it('waits while the pointer has barely moved', () => {
    expect(dragIntent(0, 0)).toBe('wait')
    expect(dragIntent(5000, TOUCH_MOVE_TOLERANCE_PX)).toBe('wait')
  })
  it('scrolls when the pointer moves before the hold time', () => {
    expect(dragIntent(50, 20)).toBe('scroll')
    expect(dragIntent(TOUCH_REORDER_HOLD_MS - 1, 9)).toBe('scroll')
  })
  it('leaves the drag to reordering after a 3 second hold', () => {
    expect(TOUCH_REORDER_HOLD_MS).toBe(3000)
    expect(dragIntent(TOUCH_REORDER_HOLD_MS, 9)).toBe('reorder')
    expect(dragIntent(10_000, 200)).toBe('reorder')
  })
})
