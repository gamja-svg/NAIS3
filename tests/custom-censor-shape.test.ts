import { describe, expect, it } from 'vitest'
import {
  chooseCandidates,
  fillHoles,
  largestBlob,
  maskArea,
  maskBox,
  pickWindow,
  solidity,
  tidy,
  touchesBorder,
  type Candidate,
  type Mask
} from '../src/main/custom/censor-shape'

// [custom] 콕 찍기: 모양 후보 다듬기·고르기
function mask(rows: string[]): Mask {
  const width = rows[0].length
  const data = new Uint8Array(width * rows.length)
  rows.forEach((row, y) => [...row].forEach((ch, x) => (data[y * width + x] = ch === '#' ? 1 : 0)))
  return { width, height: rows.length, data }
}
const text = (m: Mask): string[] =>
  Array.from({ length: m.height }, (_, y) =>
    Array.from({ length: m.width }, (_, x) => (m.data[y * m.width + x] ? '#' : '.')).join('')
  )
function disc(size: number, cx: number, cy: number, r: number): Mask {
  const data = new Uint8Array(size * size)
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) data[y * size + x] = Math.hypot(x - cx, y - cy) <= r ? 1 : 0
  return { width: size, height: size, data }
}
const cand = (m: Mask, score: number): Candidate => ({
  mask: m,
  score,
  solidity: solidity(m),
  area: maskArea(m)
})

describe('custom: censor shape', () => {
  it('keeps the largest blob and fills its holes', () => {
    const m = mask(['#....###', '.....#.#', '.....###', '........'])
    expect(text(largestBlob(m))).toEqual(['.....###', '.....#.#', '.....###', '........'])
    expect(text(tidy(m))).toEqual(['.....###', '.....###', '.....###', '........'])
    // 가장자리와 이어진 빈 곳은 구멍이 아니다
    expect(text(fillHoles(mask(['###', '#..', '###'])))).toEqual(['###', '#..', '###'])
    expect(maskArea(largestBlob(mask(['...', '...'])))).toBe(0)
  })

  it('scores a solid blob near 1 and a ring or line far lower', () => {
    const full = disc(64, 32, 32, 20)
    expect(solidity(full)).toBeGreaterThan(0.9)
    const ring = disc(64, 32, 32, 20)
    const hole = disc(64, 32, 32, 17)
    for (let i = 0; i < ring.data.length; i++) ring.data[i] &= hole.data[i] ^ 1
    expect(solidity(ring)).toBeLessThan(0.4)
    expect(solidity(mask(['#..', '...']))).toBe(0) // 너무 작으면 0
  })

  it('lists candidates small to large without near-duplicates and picks the best solid one', () => {
    const small = cand(disc(64, 32, 32, 6), 0.8)
    const same = cand(disc(64, 32, 32, 6), 0.7)
    const big = cand(disc(64, 32, 32, 20), 0.95)
    const huge = cand(disc(64, 32, 32, 31), 0.99)
    const { list, pick } = chooseCandidates([big, same, huge, small], 0.5 * 64 * 64)
    expect(list.map((c) => c.area)).toEqual([small.area, big.area]) // 절반 넘는 것은 배경
    expect(list[pick]).toBe(big)
    expect(chooseCandidates([], 100)).toEqual({ list: [], pick: 0 })
  })

  it('crops a window around the point, clamped to the picture', () => {
    expect(pickWindow(832, 1216, 400, 600, 384)).toEqual([208, 408, 592, 792])
    expect(pickWindow(832, 1216, 10, 1210, 384)).toEqual([0, 832, 384, 1216])
    expect(pickWindow(400, 300, 100, 100, 384)).toEqual([0, 0, 400, 300]) // 창이 그림만 하면 통째로
  })

  it('finds the box of a mask and whether it touches the border', () => {
    const m = mask(['....', '.##.', '.#..', '....'])
    expect(maskBox(m)).toEqual([1, 1, 3, 3])
    expect(touchesBorder(m)).toBe(false)
    expect(touchesBorder(mask(['....', '...#']))).toBe(true)
    expect(maskBox(mask(['..']))).toBeNull()
  })
})
