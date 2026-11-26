import { describe, expect, it } from 'vitest'
import {
  changedTagRanges,
  markedSegments,
  removedTags,
  tagPieces
} from '../src/renderer/src/lib/custom-prompt-diff'

// [custom] 미생성 씬에서 마지막으로 뽑은 뒤 바뀐 태그 찾기

const marked = (current: string, base: string): string[] =>
  changedTagRanges(current, base).map((r) => current.slice(r.start, r.end))

describe('custom: changed tags', () => {
  it('splits on commas and line breaks, ignoring surrounding spaces', () => {
    expect(tagPieces(' girl,  smile ,\nblue  eyes,, ').map((p) => p.text)).toEqual([
      'girl',
      'smile',
      'blue  eyes'
    ])
  })

  it('marks only tags that were not there before', () => {
    expect(marked('girl, grin, blush, outdoors', 'girl, smile, outdoors')).toEqual([
      'grin',
      'blush'
    ])
    expect(marked('girl, smile', 'girl, smile')).toEqual([])
    expect(marked('girl,smile', 'girl ,  smile')).toEqual([]) // 공백만 다르면 같다
    expect(marked('blue  eyes', 'blue eyes')).toEqual([])
  })

  it('treats weight and bracket changes as changes', () => {
    expect(marked('1.3::smile, happy::, {blush}', '1.2::smile, happy::, blush')).toEqual([
      '1.3::smile',
      '{blush}'
    ])
  })

  it('counts repeated tags', () => {
    expect(marked('smile, smile', 'smile')).toEqual(['smile'])
    expect(removedTags('smile', 'smile, smile')).toEqual(['smile'])
  })

  it('lists removed tags in their old spelling', () => {
    expect(removedTags('girl, grin', 'girl, smile, 1.2::blush::')).toEqual([
      'smile',
      '1.2::blush::'
    ])
  })

  it('cuts the text into marked and plain segments that cover it all', () => {
    const text = 'girl, grin, outdoors'
    const segments = markedSegments(text, changedTagRanges(text, 'girl, outdoors'))
    expect(segments.map((s) => [text.slice(s.start, s.end), s.marked])).toEqual([
      ['girl, ', false],
      ['grin', true],
      [', outdoors', false]
    ])
    expect(segments.map((s) => text.slice(s.start, s.end)).join('')).toBe(text)
  })
})
