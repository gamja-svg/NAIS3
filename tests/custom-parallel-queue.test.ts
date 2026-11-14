import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GenerationRequest, QueueStatus } from '../src/shared/types'
import { GenerationQueue, LanePauseError } from '../src/main/queue/generation-queue'

// [custom] 동시 생성: 계정마다 한 장씩, 보낼 곳, 쉬는 계정, 끄면 원래대로 한 장씩

const REQ = { seed: 1, prompt: '' } as GenerationRequest

type Call = {
  id: string
  lane?: string
  finish: (path?: string) => void
  fail: (e: unknown) => void
}

/** 생성 호출을 붙잡아 두고 테스트가 끝내 주는 가짜 생성기 */
function controlledGenerator(): {
  generate: (r: GenerationRequest, id: string, s: AbortSignal, lane?: string) => Promise<string>
  calls: Call[]
} {
  const calls: Call[] = []
  const generate = (
    _r: GenerationRequest,
    id: string,
    signal: AbortSignal,
    lane?: string
  ): Promise<string> =>
    new Promise<string>((resolve, reject) => {
      signal.addEventListener('abort', () => {
        const e = new Error('Aborted')
        e.name = 'AbortError'
        reject(e)
      })
      calls.push({ id, lane, finish: (path) => resolve(path ?? `/${id}.png`), fail: reject })
    })
  return { generate, calls }
}

const states = (s: QueueStatus): string => s.items.map((i) => i.state).join(',')

describe('custom: parallel generation queue', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('runs one item per account at the same time', async () => {
    const { generate, calls } = controlledGenerator()
    const q = new GenerationQueue(generate)
    q.setParallel(
      () => ['a', 'b'],
      () => null
    )
    q.setDelayMs(0)
    q.enqueue(REQ, 3)
    await vi.advanceTimersByTimeAsync(0)
    expect(calls.map((c) => c.lane)).toEqual(['a', 'b'])
    expect(states(q.status())).toBe('generating,generating,pending')
    expect(q.status().lanes?.map((l) => l.generatingId)).toEqual([calls[0].id, calls[1].id])

    calls[1].finish()
    await vi.advanceTimersByTimeAsync(0)
    // b가 끝나자마자 남은 한 장을 b가 가져간다 (a는 아직 뽑는 중)
    expect(calls.map((c) => c.lane)).toEqual(['a', 'b', 'b'])
    calls[0].finish()
    calls[2].finish()
    await vi.advanceTimersByTimeAsync(0)
    const status = q.status()
    expect(states(status)).toBe('done,done,done')
    expect(status.lanes?.map((l) => [l.accountId, l.done])).toEqual([
      ['a', 1],
      ['b', 2]
    ])
    expect(status.items.map((i) => i.laneAccountId)).toEqual(['a', 'b', 'b'])
  })

  it('sends new items to the chosen account only, others to any free account', async () => {
    const { generate, calls } = controlledGenerator()
    let target: string | null = 'b'
    const q = new GenerationQueue(generate)
    q.setParallel(
      () => ['a', 'b'],
      () => target
    )
    q.setDelayMs(0)
    q.enqueue(REQ, 2) // b 앞으로 2장
    target = null
    q.enqueue(REQ, 1) // 자동 1장
    await vi.advanceTimersByTimeAsync(0)
    const indexOf = (id: string): number => q.status().items.findIndex((i) => i.id === id)
    const byLane = (lane: string): Call[] => calls.filter((c) => c.lane === lane)
    // a는 b 앞으로 온 항목을 건너뛰고 자동 항목을 가져간다
    expect(byLane('a').map((c) => indexOf(c.id))).toEqual([2])
    expect(byLane('b').map((c) => indexOf(c.id))).toEqual([0])
    expect(q.status().items.map((i) => i.accountId ?? null)).toEqual(['b', 'b', null])
    byLane('a')[0].finish()
    await vi.advanceTimersByTimeAsync(0)
    expect(calls).toHaveLength(2) // a는 b 몫을 가져가지 않는다
    byLane('b')[0].finish()
    await vi.advanceTimersByTimeAsync(0)
    expect(byLane('b').map((c) => indexOf(c.id))).toEqual([0, 1])
    byLane('b')[1].finish()
    await vi.advanceTimersByTimeAsync(0)
    expect(states(q.status())).toBe('done,done,done')
  })

  it('treats a target that is no longer an account as any free account', async () => {
    const { generate, calls } = controlledGenerator()
    let lanes = ['a', 'b', 'c']
    const q = new GenerationQueue(generate)
    q.setParallel(
      () => lanes,
      () => 'c'
    )
    q.setDelayMs(0)
    lanes = ['a', 'b'] // c 계정이 지워짐 → 보낼 곳이 없어진 것과 같다
    q.enqueue(REQ, 1)
    await vi.advanceTimersByTimeAsync(0)
    expect(q.status().items[0].accountId).toBeUndefined()
    expect(calls.map((c) => c.lane)).toEqual(['a'])
  })

  it('pauses an account that must not generate and hands its item to the other account', async () => {
    const { generate, calls } = controlledGenerator()
    const q = new GenerationQueue(generate)
    q.setParallel(
      () => ['a', 'b'],
      () => null
    )
    q.setDelayMs(0)
    q.enqueue(REQ, 1)
    await vi.advanceTimersByTimeAsync(0)
    expect(calls.map((c) => c.lane)).toEqual(['a'])
    calls[0].fail(new LanePauseError('exhausted', 60_000))
    await vi.advanceTimersByTimeAsync(0)
    // 같은 항목을 b가 이어받는다 — 실패·완료로 세지 않는다
    expect(calls.map((c) => [c.lane, c.id])).toEqual([
      ['a', calls[0].id],
      ['b', calls[0].id]
    ])
    const lane = q.status().lanes?.find((l) => l.accountId === 'a')
    expect(lane?.pauseReason).toBe('exhausted')
    expect(lane?.pausedUntil).toBeGreaterThan(Date.now())
    calls[1].finish()
    await vi.advanceTimersByTimeAsync(0)
    expect(states(q.status())).toBe('done')
    expect(q.status().items[0].laneAccountId).toBe('b')
  })

  it('keeps an item sent to a paused account waiting until that account is back', async () => {
    const { generate, calls } = controlledGenerator()
    const q = new GenerationQueue(generate)
    q.setParallel(
      () => ['a', 'b'],
      () => 'a'
    )
    q.setDelayMs(0)
    q.enqueue(REQ, 1)
    await vi.advanceTimersByTimeAsync(0)
    calls[0].fail(new LanePauseError('exhausted', 60_000))
    await vi.advanceTimersByTimeAsync(30_000)
    expect(calls).toHaveLength(1) // b는 a 앞으로 온 항목을 가져가지 않는다
    expect(states(q.status())).toBe('pending')
    await vi.advanceTimersByTimeAsync(35_000)
    expect(calls.map((c) => c.lane)).toEqual(['a', 'a'])
    expect(q.status().lanes?.find((l) => l.accountId === 'a')?.pauseReason).toBeNull()
    calls[1].finish()
    await vi.advanceTimersByTimeAsync(0)
    expect(states(q.status())).toBe('done')
  })

  it('cancels an item one account is generating without touching the other', async () => {
    const { generate, calls } = controlledGenerator()
    const q = new GenerationQueue(generate)
    q.setParallel(
      () => ['a', 'b'],
      () => null
    )
    q.setDelayMs(0)
    const ids = q.enqueue(REQ, 2)
    await vi.advanceTimersByTimeAsync(0)
    q.cancel([ids[0]])
    await vi.advanceTimersByTimeAsync(0)
    calls[1].finish()
    await vi.advanceTimersByTimeAsync(0)
    expect(states(q.status())).toBe('cancelled,done')
  })

  it('works one at a time without account ids when parallel is off or there is one account', async () => {
    for (const lanes of [null, ['a']]) {
      const { generate, calls } = controlledGenerator()
      const q = new GenerationQueue(generate)
      q.setParallel(
        () => lanes,
        () => 'a'
      )
      q.setDelayMs(0)
      q.enqueue(REQ, 2)
      await vi.advanceTimersByTimeAsync(0)
      expect(calls.map((c) => c.lane)).toEqual([undefined])
      expect(q.status().lanes).toBeUndefined()
      expect(q.status().items.every((i) => i.accountId === undefined)).toBe(true)
      calls[0].finish()
      await vi.advanceTimersByTimeAsync(0)
      expect(calls.map((c) => c.lane)).toEqual([undefined, undefined])
      calls[1].finish()
      await vi.advanceTimersByTimeAsync(0)
      expect(states(q.status())).toBe('done,done')
    }
  })

  it('switches between one-at-a-time and parallel without running both at once', async () => {
    const { generate, calls } = controlledGenerator()
    let on = false
    const q = new GenerationQueue(generate)
    q.setParallel(
      () => (on ? ['a', 'b'] : null),
      () => null
    )
    q.setDelayMs(0)
    q.enqueue(REQ, 4)
    await vi.advanceTimersByTimeAsync(0)
    expect(calls.map((c) => c.lane)).toEqual([undefined])
    on = true
    q.kick() // 한 장씩 도는 중에는 겹쳐 돌지 않는다
    await vi.advanceTimersByTimeAsync(0)
    expect(calls).toHaveLength(1)
    calls[0].finish()
    await vi.advanceTimersByTimeAsync(0)
    expect(calls.map((c) => c.lane)).toEqual([undefined, 'a', 'b'])
    on = false
    q.kick()
    calls[1].finish()
    await vi.advanceTimersByTimeAsync(0)
    expect(calls).toHaveLength(3) // b가 아직 뽑는 중이라 한 장씩 루프는 기다린다
    calls[2].finish()
    await vi.advanceTimersByTimeAsync(0)
    expect(calls.map((c) => c.lane)).toEqual([undefined, 'a', 'b', undefined])
    calls[3].finish()
    await vi.advanceTimersByTimeAsync(0)
    expect(states(q.status())).toBe('done,done,done,done')
  })
})
