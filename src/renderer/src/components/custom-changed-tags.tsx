import { useMemo } from 'react'
import { CHANGED_TAG_STYLE, changedTagRanges, removedTags } from '../lib/custom-prompt-diff'
import { useT } from '../lib/i18n'

/**
 * [custom] 미생성 씬의 프롬프트 아래 한 줄 — 노란색이 무엇인지와, 마지막으로 뽑은 뒤 빠진 태그.
 * 바뀐 것이 없으면 그리지 않는다.
 */
export function ChangedTagsNote({
  current,
  base
}: {
  current: string
  base: string
}): React.JSX.Element | null {
  const t = useT()
  const changed = useMemo(() => changedTagRanges(current, base).length, [current, base])
  const removed = useMemo(() => removedTags(current, base), [current, base])
  if (changed === 0 && removed.length === 0) return null
  return (
    <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11.5px] leading-snug text-muted">
      {changed > 0 && (
        <span>
          <span className="px-0.5 text-ink" style={CHANGED_TAG_STYLE}>
            {t('ui.customChangedTagsYellow')}
          </span>{' '}
          {t('ui.customChangedTagsLegend')}
        </span>
      )}
      {removed.length > 0 && (
        <>
          <span className={changed > 0 ? 'ml-1' : undefined}>{t('ui.customRemovedTags')}</span>
          {removed.map((tag, i) => (
            <s key={i} className="rounded bg-surface-2 px-1 font-mono text-[11px] text-faint">
              {tag}
            </s>
          ))}
        </>
      )}
    </p>
  )
}
