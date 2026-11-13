import { describe, expect, it } from 'vitest'
import { WATCH_AUTOGEN_LIMIT, canAutoGenerate } from '../src/shared/custom-watch'

// [custom] 감시 폴더 자동 생성 한도
describe('custom: canAutoGenerate', () => {
  it('allows up to the limit, counting what is already pending', () => {
    expect(WATCH_AUTOGEN_LIMIT).toBe(30)
    expect(canAutoGenerate(1, 0)).toBe(true)
    expect(canAutoGenerate(30, 0)).toBe(true)
    expect(canAutoGenerate(10, 20)).toBe(true)
  })
  it('refuses the whole batch once it would exceed the limit', () => {
    expect(canAutoGenerate(31, 0)).toBe(false)
    expect(canAutoGenerate(10, 21)).toBe(false)
    expect(canAutoGenerate(175, 0)).toBe(false)
  })
  it('does nothing when no scene changed', () => {
    expect(canAutoGenerate(0, 0)).toBe(false)
  })
})
