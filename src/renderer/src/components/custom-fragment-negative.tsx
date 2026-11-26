import { Check, CircleMinus, Link2Off, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { Fragment, Scene } from '@shared/types'
import { fragmentRef, pairedNegatives } from '@shared/custom-fragment-negatives'
import { useT } from '../lib/i18n'
import { cn } from '../lib/utils'
import { useFragmentNegativeStore } from '../stores/custom-fragment-negative-store'
import { useFragmentsStore } from '../stores/fragments-store'
import { Input } from './ui/input'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'

/**
 * [custom] 조각 줄의 `네거 짝` — 짝이 있으면 이름표로 보이고, 누르면 짝을 고르거나 없앤다.
 * 짝을 지어 두면 프롬프트에 이 조각이 있는 그림은 뽑을 때 네거 짝이 네거티브에 자동으로 붙는다.
 */
export function FragmentNegativePicker({ fragment }: { fragment: Fragment }): React.JSX.Element {
  const t = useT()
  const items = useFragmentsStore((s) => s.items)
  const pairId = useFragmentNegativeStore((s) => s.pairs[fragment.id])
  const setPair = useFragmentNegativeStore((s) => s.setPair)
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const pair = items.find((f) => f.id === pairId)
  const q = search.trim().toLowerCase()
  const choices = items.filter((f) => f.id !== fragment.id && f.name.toLowerCase().includes(q))
  const item =
    'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-surface-2'
  const choose = (id: number | null): void => {
    setOpen(false)
    void setPair(fragment.id, id)
  }
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) setSearch('')
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'flex h-7 shrink-0 items-center gap-1 rounded-md px-1.5 text-[11.5px]',
            pair
              ? 'max-w-[45%] bg-danger/10 text-danger-ink hover:bg-danger/20'
              : 'text-faint hover:text-ink'
          )}
          title={
            pair
              ? t('ui.customFragmentNegativeHintValue', pair.name)
              : t('ui.customFragmentNegativeSet')
          }
          aria-label={t('ui.customFragmentNegativeSet')}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <CircleMinus size={13} className="shrink-0" />
          {pair && <span className="truncate">{pair.name}</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-64 max-w-[80vw] p-1.5"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <p className="px-1 pb-1.5 text-[11.5px] leading-snug text-muted">
          {t('ui.customFragmentNegativeAbout')}
        </p>
        <div className="relative mb-1">
          <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-faint" />
          <Input
            className="pl-7"
            value={search}
            placeholder={t('ui.search')}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="max-h-56 overflow-y-auto">
          {choices.map((f) => (
            <button key={f.id} type="button" className={item} onClick={() => choose(f.id)}>
              <span className="min-w-0 flex-1 truncate" title={f.name}>
                {f.name}
              </span>
              {f.id === pairId && <Check size={13} className="shrink-0 text-accent-ink" />}
            </button>
          ))}
          {choices.length === 0 && (
            <p className="px-2 py-3 text-center text-[12px] text-faint">
              {t('ui.noSearchResults')}
            </p>
          )}
        </div>
        {pair && (
          <>
            <div className="my-1 h-px bg-line" />
            <button type="button" className={cn(item, 'text-muted')} onClick={() => choose(null)}>
              <Link2Off size={13} /> {t('ui.customFragmentNegativeClear')}
            </button>
          </>
        )}
      </PopoverContent>
    </Popover>
  )
}

/**
 * [custom] 씬 편집의 네거티브 칸 아래 — 이 씬을 뽑을 때 자동으로 붙을 네거 짝과 `안 넣기` 버튼.
 * 붙을 짝도 없고 꺼 둔 것도 아니면 아무것도 그리지 않는다.
 */
export function SceneNegativePairs({
  scene,
  prompts,
  negative
}: {
  scene: Scene
  /** 이 씬을 뽑을 때 쓰이는 프롬프트들 (기본 + 씬 + 캐릭터) */
  prompts: string[]
  /** 기본 + 씬 네거티브 */
  negative: string
}): React.JSX.Element | null {
  const t = useT()
  const items = useFragmentsStore((s) => s.items)
  const folders = useFragmentsStore((s) => s.folders)
  const pairs = useFragmentNegativeStore((s) => s.pairs)
  const off = useFragmentNegativeStore((s) => s.offScenes.includes(scene.id))
  const setSceneOff = useFragmentNegativeStore((s) => s.setSceneOff)
  const paired = useMemo(
    () => pairedNegatives(prompts, negative, items, folders, pairs),
    [prompts, negative, items, folders, pairs]
  )
  if (paired.length === 0 && !off) return null
  return (
    <div className="flex items-center gap-2 rounded-md border border-danger/20 bg-danger/5 px-2 py-1.5 text-[12px]">
      <CircleMinus size={13} className="shrink-0 text-danger-ink" />
      <span className={cn('min-w-0 flex-1 leading-snug', off ? 'text-faint' : 'text-muted')}>
        {off ? (
          t('ui.customSceneNegativeOffNote')
        ) : (
          <>
            {t('ui.customSceneNegativeAuto')}{' '}
            <span className="font-mono text-danger-ink">
              {paired.map((f) => fragmentRef(f, items, folders)).join(', ')}
            </span>
          </>
        )}
        {off && paired.length > 0 && (
          <span className="ml-1 font-mono line-through">
            {paired.map((f) => fragmentRef(f, items, folders)).join(', ')}
          </span>
        )}
      </span>
      <button
        type="button"
        className={cn(
          'shrink-0 rounded-md px-2 py-1 text-[12px] font-medium',
          off
            ? 'bg-accent text-on-accent hover:opacity-90'
            : 'border border-line bg-surface-2 text-ink hover:border-muted'
        )}
        title={t('ui.customSceneNegativeOffHint')}
        aria-pressed={off}
        onClick={() => void setSceneOff(scene.id, !off)}
      >
        {t(off ? 'ui.customSceneNegativeOn' : 'ui.customSceneNegativeOff')}
      </button>
    </div>
  )
}
