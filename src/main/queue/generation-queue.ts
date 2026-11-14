import { EventEmitter } from 'events'
import { randomUUID } from 'crypto'
import {
  normalizeDelayMs,
  normalizeDelayRandomization,
  randomizedGenerationDelayMs
} from '../../shared/generation-delay'
import { FinishedQueueLog, queueItemSnapshot } from '../../shared/queue-status'
import { applyRandomCharacterPrompt } from '../../shared/random-character'
import type {
  CharacterPromptInput,
  GenerationDelayRandomization,
  GenerationRequest,
  LanePauseReason,
  QueueItem,
  QueueStatus,
  SceneReservation
} from '../../shared/types'

/**
 * 생성 큐. 메인 프로세스 상주 — 렌더러가 리로드/크래시해도 큐는 살아있다.
 *
 * NAIS2에서 고치는 버그들의 구조적 해결 지점:
 * - 예약 취소 후 재예약 시 UI와 실제 큐 상태 불일치 → 큐가 단일 진실 공급원, UI는 'changed' 구독만
 * - 씬 모드에서 생성 지연시간 미적용 → 지연은 큐 루프 한 곳에서만 적용
 */
/** 재시도 대상 HTTP 상태 — 전이성(rate-limit/서버 일시 오류)만. 4xx 클라이언트 오류는 제외 */
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504])
/** 전이성 오류 최대 재시도 횟수 (초기 시도 제외) */
const MAX_RETRIES = 3
/** 백오프 기준·상한 (ms) — 실제 대기는 지수 백오프 + 지터, Retry-After가 더 크면 그걸 따름 */
const RETRY_BASE_MS = 2000
const RETRY_MAX_MS = 20000
/** [custom] 쉬는 계정이 다시 확인하기 전까지 대기를 끊어 보는 간격 (설정이 바뀌면 빨리 반응) */
const LANE_POLL_MS = 5000

/**
 * [custom] 동시 생성에서 계정 하나가 지금 뽑으면 안 될 때 생성 함수가 던진다
 * (게이지 소진·Opus 아님·조회 실패). 큐는 그 계정을 retryAfterMs 동안 쉬게 하고 항목을 대기로 돌린다.
 */
export class LanePauseError extends Error {
  constructor(
    readonly reason: LanePauseReason,
    readonly retryAfterMs: number
  ) {
    super(`lane paused: ${reason}`)
    this.name = 'LanePauseError'
  }
}

export class GenerationQueue extends EventEmitter {
  private items = new Map<string, QueueItem>()
  private controllers = new Map<string, AbortController>()
  private finished = new FinishedQueueLog()
  private running = false
  private delayMs = 600
  private delayRandomization: GenerationDelayRandomization = {
    enabled: false,
    minusMs: 0,
    plusMs: 0
  }
  // [custom] 동시 생성 — 계정(레인)마다 한 장씩. 꺼져 있으면 아래 run()의 한 장씩 루프 그대로
  private lanesProvider: (() => string[] | null) | null = null
  private targetProvider: (() => string | null) | null = null
  private laneRunning = new Set<string>()
  private laneGenerating = new Map<string, string>()
  private lanePause = new Map<string, { until: number; reason: LanePauseReason }>()
  private laneDone = new Map<string, number>()

  constructor(
    private readonly generate: (
      request: GenerationRequest,
      id: string,
      signal: AbortSignal,
      /** [custom] 동시 생성이면 이 항목을 뽑을 계정 */
      laneAccountId?: string
    ) => Promise<string>,
    private readonly random: () => number = Math.random
  ) {
    super()
  }

  enqueue(
    request: GenerationRequest,
    count: number,
    randomCharacterPrompts: readonly CharacterPromptInput[] = []
  ): string[] {
    const ids: string[] = []
    const target = this.currentTarget()
    for (let i = 0; i < count; i++) {
      const id = randomUUID()
      // 배치는 장마다 시드+i — 같은 시드 N장(동일 그림 N장) 방지, 시드 고정 시에도 각 장 재현 가능
      const seededRequest =
        i === 0 ? request : { ...request, seed: (request.seed + i) % 4294967296 }
      const req = applyRandomCharacterPrompt(seededRequest, randomCharacterPrompts)
      this.items.set(id, { id, state: 'pending', request: req, ...target })
      ids.push(id)
    }
    this.emitChanged()
    void this.run()
    return ids
  }

  /** Publish a batch only after its synchronous reservation commit succeeds. */
  enqueueRequests(
    requests: GenerationRequest[],
    commit: () => void,
    reservations?: SceneReservation[]
  ): string[] {
    if (reservations && reservations.length !== requests.length) {
      throw new Error('Reservation count must match request count')
    }
    const target = this.currentTarget()
    const entries = requests.map((request, index): QueueItem => ({
      id: randomUUID(),
      state: 'pending',
      request,
      ...(reservations ? { reservation: reservations[index] } : {}),
      ...target
    }))
    try {
      for (const item of entries) this.items.set(item.id, item)
      commit()
    } catch (error) {
      for (const item of entries) this.items.delete(item.id)
      throw error
    }
    if (entries.length > 0) {
      this.emitChanged()
      void this.run()
    }
    return entries.map((item) => item.id)
  }

  cancel(ids: string[]): void {
    const cancelled: QueueItem[] = []
    for (const id of ids) {
      const item = this.items.get(id)
      if (item && item.state === 'pending') {
        item.state = 'cancelled'
        this.markFinished(item)
        cancelled.push(item)
      } else if (item && item.state === 'generating') {
        this.controllers.get(id)?.abort()
      }
    }
    if (cancelled.length > 0) this.emit('cancelled', cancelled)
    this.emitChanged()
  }

  /** Deleted scenes may have their numeric IDs reused by SQLite. */
  forgetSceneReservations(sceneIds: number[]): void {
    const deleted = new Set(sceneIds)
    for (const item of this.items.values()) {
      if (item.reservation && deleted.has(item.reservation.sceneId)) delete item.reservation
    }
  }

  setDelayMs(ms: number, randomization?: GenerationDelayRandomization): void {
    this.delayMs = normalizeDelayMs(ms)
    if (randomization) this.delayRandomization = normalizeDelayRandomization(randomization)
  }

  status(): QueueStatus {
    const lanes = this.activeLanes()
    const now = Date.now()
    return {
      items: [...this.items.values()].map(queueItemSnapshot),
      running: this.running || this.laneRunning.size > 0,
      delayMs: this.delayMs,
      ...(lanes
        ? {
            lanes: lanes.map((accountId) => {
              const pause = this.lanePause.get(accountId)
              const paused = pause && pause.until > now ? pause : null
              return {
                accountId,
                generatingId: this.laneGenerating.get(accountId) ?? null,
                pausedUntil: paused?.until ?? null,
                pauseReason: paused?.reason ?? null,
                done: this.laneDone.get(accountId) ?? 0
              }
            })
          }
        : {})
    }
  }

  /**
   * [custom] 동시 생성 설정. lanes: 동시에 뽑을 계정 id 목록 (2개 미만·null이면 원래대로 한 장씩),
   * target: 새로 넣는 항목을 보낼 계정 (null = 비어 있는 계정 아무나)
   */
  setParallel(lanes: () => string[] | null, target: () => string | null): void {
    this.lanesProvider = lanes
    this.targetProvider = target
  }

  /** [custom] 동시 생성 설정·계정이 바뀌었을 때 — 상태를 다시 알리고 남은 항목을 다시 돌린다 */
  kick(): void {
    this.emitChanged()
    void this.run()
  }

  private activeLanes(): string[] | null {
    const lanes = this.lanesProvider?.() ?? null
    return lanes && lanes.length >= 2 ? lanes : null
  }

  /** 새 항목에 붙일 보낼 곳 — 동시 생성 중이고 그 계정이 있을 때만 */
  private currentTarget(): { accountId: string } | Record<string, never> {
    const lanes = this.activeLanes()
    const target = lanes ? (this.targetProvider?.() ?? null) : null
    return target && lanes?.includes(target) ? { accountId: target } : {}
  }

  private async run(): Promise<void> {
    // [custom] 동시 생성이면 계정마다 루프를 띄운다. 한 장씩 루프가 아직 도는 중이면 그 루프가 끝날 때 넘겨준다
    const lanes = this.activeLanes()
    if (lanes) {
      if (this.running) return
      for (const lane of lanes) if (!this.laneRunning.has(lane)) void this.runLane(lane)
      return
    }
    if (this.running || this.laneRunning.size > 0) return
    this.running = true
    try {
      let next: QueueItem | undefined
      while (!this.activeLanes() && (next = this.nextPending())) {
        next.state = 'generating'
        const controller = new AbortController()
        this.controllers.set(next.id, controller)
        this.emitChanged()
        try {
          next.filePath = await this.generateWithRetry(next, controller)
          next.state = 'done'
        } catch (e) {
          if (controller.signal.aborted || isAbortError(e)) {
            next.state = 'cancelled'
            // A late successful response is still done; only a confirmed abort restores it.
            this.emit('cancelled', [next])
          } else {
            next.state = 'failed'
            next.error = e instanceof Error ? e.message : String(e)
          }
        } finally {
          this.controllers.delete(next.id)
          next.retrying = false
          this.markFinished(next)
        }
        this.emitChanged()
        if (this.nextPending()) {
          await sleep(this.nextDelayMs())
        }
      }
    } finally {
      this.running = false
      this.emitChanged()
      // [custom] 도는 사이에 동시 생성이 켜졌으면 남은 항목을 계정별 루프로 넘긴다
      if (this.activeLanes() && this.nextPending()) void this.run()
    }
  }

  /**
   * [custom] 계정 하나의 루프 — 그 계정 앞으로 온 항목이나 보낼 곳이 없는 항목을 한 장씩 뽑는다.
   * 생성 함수가 LanePauseError를 던지면 항목을 대기로 돌리고(다른 계정이 가져가게) 이 계정은 쉰다.
   */
  private async runLane(lane: string): Promise<void> {
    this.laneRunning.add(lane)
    this.emitChanged()
    try {
      for (;;) {
        const lanes = this.activeLanes()
        if (!lanes || !lanes.includes(lane)) break // 동시 생성이 꺼졌거나 계정이 빠짐
        const pause = this.lanePause.get(lane)
        if (pause) {
          const wait = pause.until - Date.now()
          if (wait > 0) {
            // 맡을 항목이 없으면 기다리지 않고 끝낸다 (다음에 항목이 들어오면 다시 깨어난다)
            if (!this.nextPendingFor(lane, lanes)) break
            await sleep(Math.min(wait, LANE_POLL_MS))
            continue
          }
          this.lanePause.delete(lane)
          this.emitChanged()
        }
        const next = this.nextPendingFor(lane, lanes)
        if (!next) break
        next.state = 'generating'
        next.laneAccountId = lane
        const controller = new AbortController()
        this.controllers.set(next.id, controller)
        this.laneGenerating.set(lane, next.id)
        this.emitChanged()
        let paused: LanePauseError | null = null
        try {
          next.filePath = await this.generateWithRetry(next, controller, lane)
          next.state = 'done'
          this.laneDone.set(lane, (this.laneDone.get(lane) ?? 0) + 1)
        } catch (e) {
          if (e instanceof LanePauseError && !controller.signal.aborted) {
            paused = e
            next.state = 'pending'
            delete next.laneAccountId
            this.lanePause.set(lane, { until: Date.now() + e.retryAfterMs, reason: e.reason })
          } else if (controller.signal.aborted || isAbortError(e)) {
            next.state = 'cancelled'
            this.emit('cancelled', [next])
          } else {
            next.state = 'failed'
            next.error = e instanceof Error ? e.message : String(e)
          }
        } finally {
          this.controllers.delete(next.id)
          this.laneGenerating.delete(lane)
          next.retrying = false
          if (!paused) this.markFinished(next)
        }
        this.emitChanged()
        if (paused) {
          void this.run() // 쉬지 않는 다른 계정이 돌려받은 항목을 바로 가져가게
          continue
        }
        if (this.nextPendingFor(lane, this.activeLanes() ?? [])) await sleep(this.nextDelayMs())
      }
    } finally {
      this.laneRunning.delete(lane)
      this.emitChanged()
      // 동시 생성이 꺼졌으면 남은 항목은 한 장씩 루프가 이어받는다
      if (!this.activeLanes() && this.laneRunning.size === 0 && this.nextPending()) void this.run()
    }
  }

  /**
   * 전이성 오류(429/5xx)면 백오프 후 재시도. 취소는 즉시 중단하고,
   * 재시도 대기 중엔 retrying 플래그로 UI에 알린다 (state는 'generating' 유지).
   * 같은 controller를 재시도 내내 공유하므로 대기 중 취소도 정상 반영된다.
   */
  private async generateWithRetry(
    item: QueueItem,
    controller: AbortController,
    lane?: string
  ): Promise<string> {
    const { signal } = controller
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.generate(item.request, item.id, signal, lane)
      } catch (e) {
        if (signal.aborted || isAbortError(e)) throw e
        if (attempt >= MAX_RETRIES || !isRetryableError(e)) throw e
        item.retrying = true
        this.emitChanged()
        await abortableSleep(retryDelayMs(e, attempt), signal)
        item.retrying = false
        if (signal.aborted) throw abortError()
        this.emitChanged()
      }
    }
  }

  /** Records a finished item and drops old finished items past the limit (no unbounded growth per session) */
  private markFinished(item: QueueItem): void {
    for (const id of this.finished.record(item.id)) this.items.delete(id)
  }

  private nextPending(): QueueItem | undefined {
    for (const item of this.items.values()) {
      if (item.state === 'pending') return item
    }
    return undefined
  }

  /** [custom] 이 계정이 맡을 다음 항목 — 이 계정 앞으로 온 것이나 보낼 곳이 없는(없어진) 것, 들어온 순서대로 */
  private nextPendingFor(lane: string, lanes: string[]): QueueItem | undefined {
    for (const item of this.items.values()) {
      if (item.state !== 'pending') continue
      const target = item.accountId && lanes.includes(item.accountId) ? item.accountId : null
      if (target === null || target === lane) return item
    }
    return undefined
  }

  private nextDelayMs(): number {
    return randomizedGenerationDelayMs(this.delayMs, this.delayRandomization, this.random)
  }

  private emitChanged(): void {
    this.emit('changed', this.status())
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** 취소 시 즉시 깨어나는 sleep — 백오프 대기 중 사용자가 취소하면 곧바로 반환 */
function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve()
    const t = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = (): void => {
      clearTimeout(t)
      resolve()
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

function abortError(): Error {
  const e = new Error('Aborted')
  e.name = 'AbortError'
  return e
}

function isAbortError(e: unknown): boolean {
  return (
    e instanceof Error && (e.name === 'AbortError' || e.message.toLowerCase().includes('abort'))
  )
}

/** 전이성(재시도 가능) 오류인지 — NaiHttpError.status가 429/5xx 계열일 때만 */
function isRetryableError(e: unknown): boolean {
  const status = (e as { status?: number })?.status
  return typeof status === 'number' && RETRYABLE_STATUS.has(status)
}

/** 재시도 대기 시간 — 지수 백오프 + 지터, 서버가 준 Retry-After가 더 크면 그걸 존중 */
function retryDelayMs(e: unknown, attempt: number): number {
  const backoff = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** attempt)
  const jittered = backoff + backoff * 0.25 * Math.random()
  const retryAfter = (e as { retryAfterMs?: number })?.retryAfterMs ?? 0
  return Math.max(jittered, retryAfter)
}
