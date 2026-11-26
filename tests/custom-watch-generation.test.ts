import { describe, expect, it } from 'vitest'
import type { GenerationRequest, QueueItem, WatchGenerationReport } from '../src/shared/types'
import { runWatchGeneration, WATCH_RETRIES } from '../src/renderer/src/lib/custom-watch-generation'

// [custom] 감시 폴더 자동 생성: 씬마다 예약하고, 실패는 다시 뽑고, 결과를 씬마다 남긴다

const REQ = { seed: 1, prompt: '' } as GenerationRequest
const jobs = (...names: string[]): { scene: string; request: GenerationRequest }[] =>
  names.map((scene) => ({ scene, request: REQ }))

/** 예약마다 미리 정한 결과로 끝나는 가짜 큐 */
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
function fakeQueue(outcomes: (QueueItem['state'] | 'blocked')[], halt: string | null = null) {
  const items: QueueItem[] = []
  const reports: WatchGenerationReport[] = []
  let n = 0
  return {
    reports,
    deps: {
      enqueue: async () => {
        const outcome = outcomes[n++] ?? 'done'
        if (outcome === 'blocked') return { ids: [], blocked: '무료 범위 밖' }
        const id = `q${n}`
        items.push({
          id,
          state: outcome,
          ...(outcome === 'done' ? { filePath: `C:\\out\\${id}.png` } : {}),
          ...(outcome === 'failed' ? { error: '500' } : {})
        } as QueueItem)
        return { ids: [id] }
      },
      status: async () => ({ items }),
      report: async (r: WatchGenerationReport) => void reports.push(r),
      sleep: async () => {},
      haltReason: () => halt
    }
  }
}

describe('custom: watch-folder auto generation tracking', () => {
  it('reports every scene as generated with its picture name', async () => {
    const q = fakeQueue(['done', 'done', 'done'])
    const result = await runWatchGeneration(jobs('1', '2', '3'), q.deps)
    expect(result).toMatchObject({ done: true, generated: 3, failed: 0 })
    expect(result.scenes.map((s) => [s.scene, s.state, s.tries, s.image])).toEqual([
      ['1', 'generated', 1, 'q1.png'],
      ['2', 'generated', 1, 'q2.png'],
      ['3', 'generated', 1, 'q3.png']
    ])
    expect(q.reports[0].done).toBe(false)
    expect(q.reports.at(-1)?.done).toBe(true)
  })

  it('books a failed scene again', async () => {
    const q = fakeQueue(['failed', 'done', 'done'])
    const result = await runWatchGeneration(jobs('1', '2'), q.deps)
    expect(result.scenes).toMatchObject([
      { scene: '1', state: 'generated', tries: 2 },
      { scene: '2', state: 'generated', tries: 1 }
    ])
  })

  it('gives up after the retries and keeps the reason', async () => {
    const q = fakeQueue(['failed', 'failed', 'failed', 'failed'])
    const result = await runWatchGeneration(jobs('1'), q.deps)
    expect(result).toMatchObject({ generated: 0, failed: 1 })
    expect(result.scenes[0]).toMatchObject({
      state: 'failed',
      reason: '500',
      tries: WATCH_RETRIES + 1
    })
  })

  it('records a scene the guard refused, and one the queue cancelled, without retrying', async () => {
    const q = fakeQueue(['blocked', 'cancelled', 'done'], 'Anlas 가드')
    const result = await runWatchGeneration(jobs('1', '2', '3'), q.deps)
    expect(result.scenes).toMatchObject([
      { scene: '1', state: 'blocked', reason: '무료 범위 밖', tries: 1 },
      { scene: '2', state: 'cancelled', reason: 'Anlas 가드', tries: 1 },
      { scene: '3', state: 'generated' }
    ])
    expect(result).toMatchObject({ generated: 1, failed: 2 })
  })

  it('stops watching after the time limit', async () => {
    const q = fakeQueue(['pending'])
    let clock = 0
    const result = await runWatchGeneration(jobs('1'), q.deps, () => (clock += 60 * 60_000))
    expect(result.scenes[0]).toMatchObject({ state: 'unknown', reason: 'timeout' })
  })
})
