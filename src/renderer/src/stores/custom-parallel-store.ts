import { create } from 'zustand'
import type { OpusUsageStatus, ParallelConfig, QueueLane, QueueStatus } from '@shared/types'
import { useGenerationStore } from './generation-store'

/**
 * [custom] 여러 계정으로 동시 생성 — 화면 쪽 상태.
 * 설정(켜짐·보낼 곳)은 메인에 저장하고, 여기는 계정 이름·계정별 게이지·항목별 진행 미리보기만 든다.
 * 동시 생성이 아닐 때(lanes 없음)는 아무것도 바꾸지 않는다 — 원래 전역 미리보기 그대로.
 */

export interface LaneAccount {
  id: string
  label: string
}

export interface LaneBalance {
  anlas: number | null
  tier: string | null
  usage?: OpusUsageStatus
}

export interface LiveFrame {
  png: string | null
  stepIx: number
  totalSteps: number
}

interface ParallelState {
  config: ParallelConfig
  accounts: LaneAccount[]
  balances: Record<string, LaneBalance>
  /** 생성 중인 항목별 진행 (동시 생성일 때만 채운다) */
  live: Record<string, LiveFrame>
  /** 생성 중인 항목별 시작 시각 — 남은 시간 표시용 */
  starts: Record<string, number>
  /** 미리보기 탭에서 보고 있는 계정 */
  viewLane: string | null
  load: () => Promise<void>
  loadAccounts: () => Promise<void>
  setEnabled: (enabled: boolean) => Promise<void>
  setTarget: (target: string | null) => Promise<void>
  setViewLane: (accountId: string) => void
}

const canUse = (): boolean => window.nais.runtime !== 'browser'

export const useParallelStore = create<ParallelState>((set, get) => ({
  config: { enabled: false, target: null },
  accounts: [],
  balances: {},
  live: {},
  starts: {},
  viewLane: null,

  load: async () => {
    if (!canUse()) return
    const config = await window.nais.invoke('custom:parallelGet', undefined)
    set({ config })
    if (config.enabled) await get().loadAccounts()
  },

  loadAccounts: async () => {
    if (!canUse()) return
    const { accounts } = await window.nais.invoke('nai:listAccounts', undefined)
    const prev = get().balances
    const balances: Record<string, LaneBalance> = {}
    for (const a of accounts) {
      // 조회가 실패한 계정(tier 없음)은 직전에 받은 값을 유지
      balances[a.id] =
        a.tier == null && prev[a.id]
          ? prev[a.id]
          : { anlas: a.anlas, tier: a.tier, ...(a.usage ? { usage: a.usage } : {}) }
    }
    set({ accounts: accounts.map((a) => ({ id: a.id, label: a.label })), balances })
  },

  setEnabled: async (enabled) => {
    const config = await window.nais.invoke('custom:parallelSet', { enabled })
    set({ config })
    if (enabled) await get().loadAccounts()
  },

  setTarget: async (target) => {
    const config = await window.nais.invoke('custom:parallelSet', { target })
    set({ config })
  },

  setViewLane: (viewLane) => set({ viewLane })
}))

/** 동시 생성 중이면 계정 목록, 아니면 null */
export function useQueueLanes(): QueueLane[] | null {
  return useGenerationStore((s) => s.queue?.lanes ?? null)
}

/** 탭에서 보고 있는 계정의 상태 (고른 계정이 없어졌으면 첫 계정) */
export function useViewedLane(): QueueLane | null {
  const lanes = useQueueLanes()
  const viewLane = useParallelStore((s) => s.viewLane)
  if (!lanes || lanes.length === 0) return null
  return lanes.find((l) => l.accountId === viewLane) ?? lanes[0]
}

export interface PreviewFeed {
  previewPng: string | null
  progress: { stepIx: number; totalSteps: number } | null
  generating: boolean
  genStartAt: number | null
}

/**
 * 가운데 미리보기가 보여 줄 진행. 동시 생성이면 보고 있는 계정 탭의 항목 것,
 * 아니면 원래 전역 값 (그때는 원본 코드와 같은 값을 그대로 돌려준다).
 */
export function usePreviewFeed(): PreviewFeed {
  const parallel = useGenerationStore((s) => s.queue?.lanes != null)
  // 동시 생성 중엔 전역 프레임이 두 계정 것으로 번갈아 바뀌므로 구독 자체를 끊는다 (null 고정)
  const globalPng = useGenerationStore((s) => (s.queue?.lanes ? null : s.previewPng))
  const globalProgress = useGenerationStore((s) => (s.queue?.lanes ? null : s.progress))
  const globalStart = useGenerationStore((s) => (s.queue?.lanes ? null : s.genStartAt))
  const anyGenerating = useGenerationStore(
    (s) => s.queue?.items.some((i) => i.state === 'generating') ?? false
  )
  const lane = useViewedLane()
  const itemId = lane?.generatingId ?? null
  const frame = useParallelStore((s) => (itemId ? (s.live[itemId] ?? null) : null))
  const start = useParallelStore((s) => (itemId ? (s.starts[itemId] ?? null) : null))
  if (!parallel || !lane) {
    return {
      previewPng: globalPng,
      progress: globalProgress,
      generating: anyGenerating,
      genStartAt: globalStart
    }
  }
  return {
    previewPng: frame?.png ?? null,
    progress:
      frame && frame.totalSteps > 0 ? { stepIx: frame.stepIx, totalSteps: frame.totalSteps } : null,
    generating: itemId != null,
    genStartAt: start
  }
}

/** 이 씬을 지금 뽑고 있는 항목 (동시 생성이면 여럿 중 처음 것) */
function generatingItemFor(queue: QueueStatus | null, sceneId: number): string | null {
  return (
    queue?.items.find((i) => i.state === 'generating' && i.request.sceneId === sceneId)?.id ?? null
  )
}

/** 씬 카드·씬 상세의 생성 중 표시 — 지금 뽑고 있는 씬 id들 (동시 생성이면 여러 개) */
export function useGeneratingSceneKey(): string {
  return useGenerationStore(
    (s) =>
      s.queue?.items
        .filter((i) => i.state === 'generating' && i.request.sceneId != null)
        .map((i) => i.request.sceneId)
        .join(',') ?? ''
  )
}

export function sceneIdsFromKey(key: string): Set<number> {
  return new Set(key ? key.split(',').map(Number) : [])
}

/**
 * 이 씬의 진행 중 미리보기 프레임. 동시 생성이면 그 씬을 뽑는 항목 것,
 * 아니면 원래처럼 전역 프레임 (generating이 false면 null).
 */
export function useSceneFrame(sceneId: number, generating: boolean): string | null {
  const parallel = useGenerationStore((s) => s.queue?.lanes != null)
  const globalPng = useGenerationStore((s) => (generating && !s.queue?.lanes ? s.previewPng : null))
  const itemId = useGenerationStore((s) =>
    generating && s.queue?.lanes ? generatingItemFor(s.queue, sceneId) : null
  )
  const framePng = useParallelStore((s) => (itemId ? (s.live[itemId]?.png ?? null) : null))
  return parallel ? framePng : globalPng
}

/** 이 씬을 지금 뽑고 있는지 (동시 생성이면 여러 씬이 함께 뽑힐 수 있다) */
export function useSceneGenerating(sceneId: number): boolean {
  return useGenerationStore(
    (s) =>
      s.queue?.items.some((i) => i.state === 'generating' && i.request.sceneId === sceneId) ?? false
  )
}

/** 프레임이 있는지만 — 단계마다 부모(이미지 그리드)를 다시 그리지 않게 boolean으로 */
export function useSceneHasFrame(sceneId: number, generating: boolean): boolean {
  const parallel = useGenerationStore((s) => s.queue?.lanes != null)
  const globalHas = useGenerationStore((s) => (s.queue?.lanes ? false : s.previewPng != null))
  const itemId = useGenerationStore((s) =>
    generating && s.queue?.lanes ? generatingItemFor(s.queue, sceneId) : null
  )
  const frameHas = useParallelStore((s) => (itemId ? s.live[itemId]?.png != null : false))
  return parallel ? frameHas : globalHas
}

function sameKeys(a: Record<string, unknown>, keep: Set<string>): boolean {
  const keys = Object.keys(a)
  return keys.length === keep.size && keys.every((k) => keep.has(k))
}

function pick<T>(a: Record<string, T>, keep: Set<string>): Record<string, T> {
  const out: Record<string, T> = {}
  for (const k of keep) if (a[k] !== undefined) out[k] = a[k]
  return out
}

export function bindParallelEvents(): () => void {
  const offQueue = window.nais.on('queue:changed', (queue) => {
    const st = useParallelStore.getState()
    const generating = new Set(queue.items.filter((i) => i.state === 'generating').map((i) => i.id))
    const patch: Partial<ParallelState> = {}
    // 끝난 항목의 진행·시작 시각은 버린다
    if (!sameKeys(st.live, generating)) patch.live = pick(st.live, generating)
    const startsKept = pick(st.starts, generating)
    let startsChanged = !sameKeys(st.starts, generating)
    if (queue.lanes) {
      for (const id of generating) {
        if (startsKept[id] == null) {
          startsKept[id] = Date.now()
          startsChanged = true
        }
      }
    }
    if (startsChanged) patch.starts = startsKept
    // 보고 있던 계정이 빠졌으면 뽑는 중인 계정(없으면 첫 계정)으로
    const lanes = queue.lanes
    if (lanes && lanes.length > 0 && !lanes.some((l) => l.accountId === st.viewLane)) {
      patch.viewLane = (lanes.find((l) => l.generatingId) ?? lanes[0]).accountId
    }
    if (Object.keys(patch).length > 0) useParallelStore.setState(patch)
  })

  const offProgress = window.nais.on('generation:progress', (e) => {
    if (!useGenerationStore.getState().queue?.lanes) return
    useParallelStore.setState((s) => ({
      live: {
        ...s.live,
        [e.id]: {
          png: e.previewPng ?? s.live[e.id]?.png ?? null,
          stepIx: e.stepIx,
          totalSteps: e.totalSteps
        }
      }
    }))
  })

  const offBalance = window.nais.on('custom:laneBalance', ({ accountId, anlas, tier, usage }) => {
    useParallelStore.setState((s) => ({
      balances: { ...s.balances, [accountId]: { anlas, tier, ...(usage ? { usage } : {}) } }
    }))
  })

  const offAccount = window.nais.on('nai:accountChanged', ({ reason }) => {
    if (!useParallelStore.getState().config.enabled) return
    if (reason === 'added' || reason === 'deleted') void useParallelStore.getState().loadAccounts()
  })

  // 쉬는 계정의 게이지도 다시 차오르므로 가끔 새로 받는다 (원본의 활성 계정 갱신 주기와 같게)
  const timer = setInterval(
    () => {
      if (useParallelStore.getState().config.enabled) {
        void useParallelStore
          .getState()
          .loadAccounts()
          .catch(() => undefined)
      }
    },
    5 * 60 * 1000
  )

  return () => {
    offQueue()
    offProgress()
    offBalance()
    offAccount()
    clearInterval(timer)
  }
}
