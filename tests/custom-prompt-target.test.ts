import { describe, expect, it, vi } from 'vitest'
import {
  clearPromptTarget,
  insertAtCaret,
  insertIntoPrompt,
  setPromptTarget
} from '../src/renderer/src/lib/custom-prompt-target'

// [custom] 조각 창의 `커서 자리에 넣기`
describe('custom: insert a fragment at the cursor', () => {
  const at = (value: string, text = '<조각>'): string => {
    const caret = value.indexOf('|')
    const clean = value.replace('|', '')
    const done = insertAtCaret(clean, caret, caret, text)
    return done.next.slice(0, done.caret) + '|' + done.next.slice(done.caret)
  }

  it('adds commas only where they are needed', () => {
    expect(at('|')).toBe('<조각>, |')
    expect(at('1girl, |solo')).toBe('1girl, <조각>, |solo')
    expect(at('1girl,|solo')).toBe('1girl, <조각>, |solo')
    expect(at('1girl|')).toBe('1girl, <조각>, |')
    expect(at('1girl |, solo')).toBe('1girl, <조각>|, solo')
    expect(at('1girl,\n|solo')).toBe('1girl,\n<조각>, |solo')
    expect(at('#===의상===\n|')).toBe('#===의상===\n<조각>, |')
  })

  it('replaces the selected text', () => {
    const done = insertAtCaret('a, OLD, b', 3, 6, '<새>')
    expect(done.next).toBe('a, <새>, b')
    expect(done.caret).toBe('a, <새>'.length)
  })

  it('sends to the prompt box that was focused last, and to none after it is gone', () => {
    const first = { insert: vi.fn() }
    const second = { insert: vi.fn() }
    setPromptTarget(first)
    setPromptTarget(second)
    expect(insertIntoPrompt('<a>')).toBe(true)
    expect(second.insert).toHaveBeenCalledWith('<a>')
    expect(first.insert).not.toHaveBeenCalled()
    clearPromptTarget(first) // 다른 칸이 사라져도 그대로
    expect(insertIntoPrompt('<b>')).toBe(true)
    clearPromptTarget(second)
    expect(insertIntoPrompt('<c>')).toBe(false)
  })
})
