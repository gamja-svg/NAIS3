import { describe, expect, it } from 'vitest'
import {
  fragmentRef,
  pairedNegatives,
  withPairedNegatives
} from '../src/shared/custom-fragment-negatives'

// [custom] 조각의 네거 짝: 프롬프트에 조각이 있으면 짝인 네거 조각이 네거티브에 붙는다
const folders = [{ id: 1, name: '윤초아' }]
const fragments = [
  { id: 1, name: '초아', content: 'blue eyes, long hair', folderId: 1 },
  { id: 2, name: '초아 네거', content: 'short hair', folderId: 1 },
  { id: 3, name: '세트', content: '<초아>, serafuku', folderId: null },
  { id: 4, name: '배경', content: 'room', folderId: null },
  { id: 5, name: '배경 네거', content: 'outdoors', folderId: null }
]
const pairs = { 1: 2, 4: 5 }
const names = (prompts: string[], negative = ''): string[] =>
  pairedNegatives(prompts, negative, fragments, folders, pairs).map((f) => f.name)

describe('custom: fragment negative pairs', () => {
  it('finds the pair of every fragment used in the prompts', () => {
    expect(names(['1girl, <초아>, smile'])).toEqual(['초아 네거'])
    expect(names(['<배경>', '<윤초아 / 초아>'])).toEqual(['배경 네거', '초아 네거'])
    expect(names(['<*초아>, <초아>'])).toEqual(['초아 네거']) // 순차 표기, 겹치면 한 번
    expect(names(['1girl, smile'])).toEqual([])
    expect(names(['<없는 조각>, <a|b>'])).toEqual([])
  })

  it('follows fragments used inside other fragments', () => {
    expect(names(['<세트>'])).toEqual(['초아 네거'])
  })

  it('ignores comment lines and pairs already written in the negative', () => {
    expect(names(['#<초아>\n1girl'])).toEqual([])
    expect(names(['<초아>, <배경>'], 'lowres, <초아 네거>')).toEqual(['배경 네거'])
    expect(names(['<초아>'], '#<초아 네거>')).toEqual(['초아 네거'])
  })

  it('does nothing without pairs', () => {
    expect(pairedNegatives(['<초아>'], '', fragments, folders, {})).toEqual([])
  })

  it('appends the references after the negative', () => {
    const paired = pairedNegatives(['<초아>, <배경>'], '', fragments, folders, pairs)
    expect(withPairedNegatives('', paired, fragments, folders)).toBe('<초아 네거>, <배경 네거>')
    expect(withPairedNegatives('lowres, ', paired, fragments, folders)).toBe(
      'lowres, <초아 네거>, <배경 네거>'
    )
    expect(withPairedNegatives('lowres', [], fragments, folders)).toBe('lowres')
  })

  it('writes the folder when two fragments share a name', () => {
    const twins = [...fragments, { id: 6, name: '초아 네거', content: 'x', folderId: null }]
    expect(fragmentRef(twins[1], twins, folders)).toBe('<윤초아/초아 네거>')
    expect(fragmentRef(fragments[1], fragments, folders)).toBe('<초아 네거>')
  })
})
