import { describe, expect, it } from 'vitest'
import {
  compareSceneKeys,
  placeScenesByNumber,
  sceneNumberKey,
  sortScenesByNumber
} from '../src/shared/custom-scene-order'

// [custom] 씬 번호 순서: 새 씬은 번호 자리에 끼우고, 섞인 프리셋은 번호순으로 정렬한다
const list = (...names: string[]): { id: number; name: string }[] =>
  names.map((name, i) => ({ id: i + 1, name }))
const namesOf = (scenes: { id: number; name: string }[], ids: number[]): string[] =>
  ids.map((id) => scenes.find((s) => s.id === id)?.name ?? '?')

describe('custom: scene number order', () => {
  it('reads the number at the start of a name', () => {
    expect(sceneNumberKey('25')).toEqual([25])
    expect(sceneNumberKey(' 25 뒤돌아보기')).toEqual([25])
    expect(sceneNumberKey('54_3')).toEqual([54, 3])
    expect(sceneNumberKey('N5-12 교복')).toBeNull()
    expect(sceneNumberKey('뒤돌아보기 25')).toBeNull()
    expect(compareSceneKeys([54], [54, 3])).toBeLessThan(0)
    expect(compareSceneKeys([54, 3], [55])).toBeLessThan(0)
    expect(compareSceneKeys([9], [10])).toBeLessThan(0) // 글자순이 아니라 수로
  })

  it('puts new scenes at their number, leaving existing scenes where they are', () => {
    const scenes = list('1', '2', '4', '10', '메모용', '3', '11', '0', '2_1', '새 씬')
    // 앞의 다섯은 있던 씬, 뒤의 다섯은 새로 들어온 씬
    const order = placeScenesByNumber(scenes, [6, 7, 8, 9, 10])
    expect(namesOf(scenes, order)).toEqual([
      '0',
      '1',
      '2',
      '2_1',
      '3',
      '4',
      '10',
      '11',
      '메모용',
      '새 씬'
    ])
  })

  it('does not reorder a list the user arranged by hand', () => {
    const scenes = list('10', '2', '끝', '5')
    // 있던 순서(10, 2, 끝)는 그대로 — 5는 자기 이하인 마지막 씬(2) 뒤에
    expect(namesOf(scenes, placeScenesByNumber(scenes, [4]))).toEqual(['10', '2', '5', '끝'])
    const plain = list('가', '나', '7')
    expect(namesOf(plain, placeScenesByNumber(plain, [3]))).toEqual(['가', '나', '7'])
    expect(placeScenesByNumber(scenes, [])).toEqual([1, 2, 3, 4])
  })

  it('sorts a mixed preset by number, unnumbered scenes last', () => {
    const scenes = list('10', '메모용', '2', '54_3', '54', '2', '끝')
    const order = sortScenesByNumber(scenes)
    expect(namesOf(scenes, order)).toEqual(['2', '2', '10', '54', '54_3', '메모용', '끝'])
    expect(order.slice(0, 2)).toEqual([3, 6]) // 같은 번호는 원래 순서
  })
})
