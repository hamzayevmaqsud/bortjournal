/**
 * Анкета первого запуска: зачем человек пришёл (settings.goals) → какие разделы включить, какие привычки предложить
 * и о чём напоминать. Общее для API и фронта: анкета показывает то же, что сервер сохранит без подсказок клиента.
 */

/** цели анкеты; иконка — имя из набора Icon во фронте */
export const AIMS = {
  weight: { name: 'Похудеть или держать вес', hint: 'калории, белок, вес', icon: 'scale' },
  muscle: { name: 'Набрать форму и мышцы', hint: 'зал и белок', icon: 'gym' },
  water: { name: 'Пить больше воды', hint: 'норма и стаканы', icon: 'drop' },
  move: { name: 'Больше двигаться', hint: 'шаги каждый день', icon: 'steps' },
  routine: { name: 'Режим и привычки', hint: 'сон, утро, ритм', icon: 'repeat' },
  study: { name: 'Учёба', hint: 'занятия и повторение', icon: 'study' },
  plans: { name: 'Дела и цели', hint: 'задачи на день и неделю', icon: 'plans' },
  money: { name: 'Деньги под контролем', hint: 'бюджет и траты', icon: 'money' },
  books: { name: 'Читать больше', hint: 'книги и страницы', icon: 'books' }
} as const;
export type Aim = keyof typeof AIMS;
export const AIM_KEYS = Object.keys(AIMS) as Aim[];
export const aimsOf = (v: unknown): Aim[] => Array.isArray(v) ? AIM_KEYS.filter(k => v.includes(k)) : [];

/** разделы под каждую цель (ключи — как settings.sections); вес и тело ведутся в «Еде» */
export const AIM_SECTIONS: Record<Aim, readonly string[]> = {
  weight: ['food', 'water', 'steps'], muscle: ['food', 'gym'], water: ['water'], move: ['steps'],
  routine: ['tasks'], study: ['study'], plans: ['tasks'], money: ['budget'], books: ['books']
};
const SECTION_ORDER = ['food', 'water', 'steps', 'tasks', 'gym', 'study', 'budget', 'books'];
/** разделы по целям; без целей — базовый набор */
export const sectionsFor = (aims: readonly Aim[]) => {
  const on = new Set(aims.flatMap(a => AIM_SECTIONS[a]));
  return on.size ? SECTION_ORDER.filter(s => on.has(s)) : ['food', 'water', 'steps', 'tasks'];
};
/** анкета тела нужна, когда ведётся еда: от неё — калории и белок */
export const needsBody = (sections: readonly string[]) => sections.includes('food');
/** цель плана по умолчанию: только мышцы — набор, вес — похудеть, иначе — держать */
export const planGoalFor = (aims: readonly Aim[]): 'lose' | 'maintain' | 'gain' => aims.includes('muscle') && !aims.includes('weight') ? 'gain' : aims.includes('weight') ? 'lose' : 'maintain';

export interface HabitIdea { title: string; icon: string; color: string }
/** привычки-подсказки под цели (цвета — ключи палитры привычек) */
export const AIM_HABITS: Record<Aim, readonly HabitIdea[]> = {
  weight: [{ title: 'Овощи к обеду и ужину', icon: '🥗', color: 'steps' }, { title: 'Взвеситься утром', icon: '⚖️', color: 'orange' }],
  muscle: [{ title: 'Белок в каждый приём пищи', icon: '🍗', color: 'orange' }, { title: 'Растяжка 10 минут', icon: '🤸', color: 'gym' }],
  water: [{ title: 'Стакан воды после пробуждения', icon: '💧', color: 'water' }],
  move: [{ title: 'Прогулка 30 минут', icon: '🚶', color: 'steps' }, { title: 'Зарядка утром', icon: '🌅', color: 'gym' }],
  routine: [{ title: 'Медитация 5 минут', icon: '🧘', color: 'quiz' }, { title: 'Лечь до 23:00', icon: '🌙', color: 'study' }, { title: 'Час без телефона перед сном', icon: '📵', color: 'books' }],
  study: [{ title: 'Учёба 25 минут', icon: '📚', color: 'study' }],
  plans: [{ title: 'План на завтра с вечера', icon: '📝', color: 'quiz' }],
  money: [{ title: 'Записать траты за день', icon: '💰', color: 'money' }],
  books: [{ title: '10 страниц перед сном', icon: '📖', color: 'books' }]
};
/** до 6 подсказок: по очереди из каждой цели, чтобы первые три были про разное; без целей — про режим и воду */
export function habitsFor(aims: readonly Aim[], max = 6): HabitIdea[] {
  const lists = (aims.length ? aims : ['water', 'routine'] as Aim[]).map(a => [...AIM_HABITS[a]]), out: HabitIdea[] = [];
  for (let i = 0; out.length < max && lists.some(l => l.length > i); i++) for (const l of lists) if (l[i] && out.length < max && !out.some(h => h.title === l[i]!.title)) out.push(l[i]!);
  return out;
}
/** сколько подсказок отмечено сразу */
export const HABITS_PRESELECT = 3;

/** напоминания анкеты: вид (как в settings.remind), когда приходит и к какому разделу относится (null — ко всем) */
export const REMIND_PLAN = [
  { kind: 'quiz', when: 'morning', section: 'study', name: 'Вопросы дня', time: '10:00' },
  { kind: 'water', when: 'day', section: 'water', name: 'Вода', time: 'если отстаёшь, с 10 до 21' },
  { kind: 'food', when: 'day', section: 'food', name: 'Еда', time: '13:30, если пусто' },
  { kind: 'tasks', when: 'day', section: 'tasks', name: 'Задачи', time: 'за 15 минут до времени' },
  { kind: 'gym', when: 'day', section: 'gym', name: 'Тренировка', time: 'по плану тренировок' },
  { kind: 'tip', when: 'evening', section: null, name: 'Совет на вечер', time: '20:40' },
  { kind: 'streak', when: 'evening', section: null, name: 'Серия', time: '21:00, если день пуст' },
  { kind: 'review', when: 'evening', section: null, name: 'Итог недели', time: 'воскресенье, 19:00' }
] as const;
export type RemindWhen = (typeof REMIND_PLAN)[number]['when'];
export const REMIND_WHEN: Record<RemindWhen, string> = { morning: 'Утром', day: 'Днём', evening: 'Вечером' };
/** напоминания, которые имеют смысл при этих разделах */
export const remindFor = (sections: readonly string[]) => REMIND_PLAN.filter(r => r.section === null || sections.includes(r.section));
/** вид напоминания → вкл/выкл: только подходящие разделам и выбранному времени суток */
export function remindKinds(sections: readonly string[], when: readonly RemindWhen[]) {
  const ok = new Set(remindFor(sections).filter(r => when.includes(r.when)).map(r => r.kind as string));
  return Object.fromEntries(REMIND_PLAN.map(r => [r.kind, ok.has(r.kind)])) as Record<(typeof REMIND_PLAN)[number]['kind'], boolean>;
}
