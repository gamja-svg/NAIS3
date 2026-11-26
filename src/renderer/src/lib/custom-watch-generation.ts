import type {
  GenerationRequest,
  QueueItem,
  WatchGenerationReport,
  WatchGenerationScene
} from '@shared/types'

/**
 * [custom] 감시 폴더 자동 생성 — 바뀐 씬을 한 장씩 예약하고, 끝날 때까지 지켜보며 씬마다의 결과를
 * 결과 파일에 남긴다. 실패한 씬은 다시 예약한다 (가드에 막히거나 취소된 씬은 다시 하지 않는다).
 */
export interface WatchJob {
  scene: string
  request: GenerationRequest
}

export interface WatchGenerationDeps {
  enqueue: (request: GenerationRequest) => Promise<{ ids: string[]; blocked?: string }>
  status: () => Promise<{ items: QueueItem[] }>
  report: (report: WatchGenerationReport) => Promise<void>
  sleep: (ms: number) => Promise<void>
  /** 큐가 멈춘 마지막 이유 (Anlas 가드) — 취소된 씬의 이유로 적는다 */
  haltReason: () => string | null
}

/** 실패한 씬을 다시 뽑는 횟수 (처음 한 번 + 이만큼) */
export const WATCH_RETRIES = 2
const POLL_MS = 2000
/** 이만큼 지나도 안 끝난 씬은 확인 못 함으로 적고 지켜보기를 끝낸다 */
const GIVE_UP_MS = 2 * 60 * 60_000

interface Tracked extends WatchGenerationScene {
  id: string | null
  request: GenerationRequest
}

function summary(tracked: Tracked[], done: boolean): WatchGenerationReport {
  return {
    done,
    generated: tracked.filter((s) => s.state === 'generated').length,
    failed: tracked.filter(
      (s) => s.state !== 'generated' && s.state !== 'queued' && s.state !== 'generating'
    ).length,
    scenes: tracked.map(({ scene, state, reason, tries, image }) => ({
      scene,
      state,
      tries,
      ...(reason ? { reason } : {}),
      ...(image ? { image } : {})
    }))
  }
}

const baseName = (path: string): string => path.split(/[\\/]/).pop() ?? path

export async function runWatchGeneration(
  jobs: WatchJob[],
  deps: WatchGenerationDeps,
  now: () => number = Date.now
): Promise<WatchGenerationReport> {
  const tracked: Tracked[] = jobs.map((job) => ({
    scene: job.scene,
    request: job.request,
    id: null,
    state: 'queued',
    tries: 0
  }))
  const book = async (scene: Tracked): Promise<void> => {
    scene.tries++
    try {
      const result = await deps.enqueue(scene.request)
      if (result.ids.length > 0) {
        scene.id = result.ids[0]
        scene.state = 'queued'
        delete scene.reason
      } else {
        scene.id = null
        scene.state = 'blocked'
        scene.reason = result.blocked ?? ''
      }
    } catch (error) {
      scene.id = null
      scene.state = 'failed'
      scene.reason = error instanceof Error ? error.message : String(error)
    }
  }
  for (const scene of tracked) await book(scene)
  await deps.report(summary(tracked, false))

  const started = now()
  let written = JSON.stringify(summary(tracked, false))
  for (;;) {
    const open = tracked.filter(
      (s) => s.id !== null && (s.state === 'queued' || s.state === 'generating')
    )
    if (open.length === 0) break
    if (now() - started > GIVE_UP_MS) {
      for (const scene of open) {
        scene.state = 'unknown'
        scene.reason = 'timeout'
      }
      break
    }
    await deps.sleep(POLL_MS)
    const items = new Map((await deps.status()).items.map((item) => [item.id, item]))
    for (const scene of open) {
      const item = items.get(scene.id as string)
      if (!item) {
        // 끝난 기록에서도 밀려난 항목 — 결과를 알 수 없다
        scene.state = 'unknown'
        scene.reason = 'lost'
      } else if (item.state === 'pending') scene.state = 'queued'
      else if (item.state === 'generating') scene.state = 'generating'
      else if (item.state === 'done') {
        scene.state = 'generated'
        if (item.filePath) scene.image = baseName(item.filePath)
      } else if (item.state === 'cancelled') {
        scene.state = 'cancelled'
        scene.reason = item.error ?? deps.haltReason() ?? ''
      } else {
        // 실패 — 몇 번은 다시 예약한다
        scene.reason = item.error ?? ''
        if (scene.tries <= WATCH_RETRIES) await book(scene)
        else scene.state = 'failed'
      }
    }
    const next = JSON.stringify(summary(tracked, false))
    if (next !== written) {
      written = next
      await deps.report(summary(tracked, false))
    }
  }
  const final = summary(tracked, true)
  await deps.report(final)
  return final
}
