/** Иконка упражнения в цвете его группы мышц. Рисунки — свои, из старого журнала (не пользовательский ввод) */
import { GYM_GROUPS } from '@bortjournal/core';
import { GI } from './gym-icons';

export function GymIcon({ icon, group, size = '' }: { icon: string; group: string; size?: '' | 'sm' | 'xl' }) {
  return <span className={`gx-ic ${size}`} style={{ ['--gc' as string]: GYM_GROUPS[group]?.[1] ?? 'var(--gym)' }}>
    <svg className="gi" viewBox="0 0 48 48" aria-hidden="true" dangerouslySetInnerHTML={{ __html: GI[icon] ?? GI.dumbbell! }} />
  </span>;
}
