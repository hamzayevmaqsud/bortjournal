/**
 * Зал: встроенный каталог упражнений (перенесён из старого журнала), виды записи и расчёты.
 * kind: w — вес × повторы, bw — свой вес (повторы, можно с отягощением), t — на время (секунды), c — кардио (минуты, км).
 * Каталог живёт в коде; в базе — только свои упражнения человека.
 */
export type GymKind = 'w' | 'bw' | 't' | 'c';
export const GYM_GROUPS: Record<string, [name: string, color: string]> = {"chest":["Грудь","#D9622B"],"back":["Спина","#2F3B4F"],"legs":["Ноги","#3C5B38"],"shoulders":["Плечи","#B5891E"],"arms":["Руки","#8E2F22"],"abs":["Пресс","#4D7B78"],"cardio":["Кардио","#2A7FB8"],"full":["Всё тело","#7A4B2A"]};
export type GymGroup = keyof typeof GYM_GROUPS;
export const EQUIP: Record<string, string> = {"bar":"Штанга","db":"Гантели","mach":"Тренажёр","cable":"Блок","bw":"Свой вес","kb":"Гиря","cardio":"Кардио"};
export const KIND_NAMES: Record<GymKind, string> = { w: 'Вес и повторы', bw: 'Свой вес', t: 'На время', c: 'Кардио: минуты и км' };
export interface Exercise { id: string; name: string; group: string; kind: GymKind; icon: string; equip: string }
export const EXERCISES: Exercise[] = [
  {"id":"bench","name":"Жим штанги лёжа","group":"chest","kind":"w","icon":"bench","equip":"bar"},
  {"id":"incline","name":"Жим штанги на наклонной","group":"chest","kind":"w","icon":"incline","equip":"bar"},
  {"id":"dbpress","name":"Жим гантелей лёжа","group":"chest","kind":"w","icon":"dbpress","equip":"db"},
  {"id":"dbincline","name":"Жим гантелей на наклонной","group":"chest","kind":"w","icon":"incline","equip":"db"},
  {"id":"dbfly","name":"Разводка гантелей","group":"chest","kind":"w","icon":"dbfly","equip":"db"},
  {"id":"pecdeck","name":"Бабочка (пек-дек)","group":"chest","kind":"w","icon":"pecdeck","equip":"mach"},
  {"id":"chestpress","name":"Жим в тренажёре","group":"chest","kind":"w","icon":"chestpress","equip":"mach"},
  {"id":"crossover","name":"Сведение в кроссовере","group":"chest","kind":"w","icon":"crossover","equip":"cable"},
  {"id":"pushup","name":"Отжимания","group":"chest","kind":"bw","icon":"pushup","equip":"bw"},
  {"id":"dip","name":"Отжимания на брусьях","group":"chest","kind":"bw","icon":"dip","equip":"bw"},
  {"id":"deadlift","name":"Становая тяга","group":"back","kind":"w","icon":"deadlift","equip":"bar"},
  {"id":"pullup","name":"Подтягивания","group":"back","kind":"bw","icon":"pullup","equip":"bw"},
  {"id":"latpull","name":"Тяга верхнего блока","group":"back","kind":"w","icon":"latpull","equip":"cable"},
  {"id":"row","name":"Тяга штанги в наклоне","group":"back","kind":"w","icon":"row","equip":"bar"},
  {"id":"dbrow","name":"Тяга гантели одной рукой","group":"back","kind":"w","icon":"dbrow","equip":"db"},
  {"id":"cablerow","name":"Тяга нижнего блока","group":"back","kind":"w","icon":"cablerow","equip":"cable"},
  {"id":"hyper","name":"Гиперэкстензия","group":"back","kind":"bw","icon":"hyper","equip":"mach"},
  {"id":"shrug","name":"Шраги","group":"back","kind":"w","icon":"shrug","equip":"db"},
  {"id":"squat","name":"Приседания со штангой","group":"legs","kind":"w","icon":"squat","equip":"bar"},
  {"id":"legpress","name":"Жим ногами","group":"legs","kind":"w","icon":"legpress","equip":"mach"},
  {"id":"rdl","name":"Румынская тяга","group":"legs","kind":"w","icon":"rdl","equip":"bar"},
  {"id":"lunge","name":"Выпады","group":"legs","kind":"w","icon":"lunge","equip":"db"},
  {"id":"bulgarian","name":"Болгарские сплит-приседания","group":"legs","kind":"w","icon":"bulgarian","equip":"db"},
  {"id":"legext","name":"Разгибание ног","group":"legs","kind":"w","icon":"legext","equip":"mach"},
  {"id":"legcurl","name":"Сгибание ног","group":"legs","kind":"w","icon":"legcurl","equip":"mach"},
  {"id":"calf","name":"Подъём на носки","group":"legs","kind":"w","icon":"calf","equip":"mach"},
  {"id":"hipthrust","name":"Ягодичный мост","group":"legs","kind":"w","icon":"hipthrust","equip":"bar"},
  {"id":"goblet","name":"Гоблет-присед","group":"legs","kind":"w","icon":"goblet","equip":"kb"},
  {"id":"ohp","name":"Жим штанги стоя","group":"shoulders","kind":"w","icon":"ohp","equip":"bar"},
  {"id":"dbohp","name":"Жим гантелей сидя","group":"shoulders","kind":"w","icon":"dbohp","equip":"db"},
  {"id":"lateral","name":"Махи в стороны","group":"shoulders","kind":"w","icon":"lateral","equip":"db"},
  {"id":"frontraise","name":"Махи перед собой","group":"shoulders","kind":"w","icon":"frontraise","equip":"db"},
  {"id":"reardelt","name":"Разводка в наклоне","group":"shoulders","kind":"w","icon":"reardelt","equip":"db"},
  {"id":"facepull","name":"Тяга к лицу","group":"shoulders","kind":"w","icon":"facepull","equip":"cable"},
  {"id":"bbcurl","name":"Подъём штанги на бицепс","group":"arms","kind":"w","icon":"bbcurl","equip":"bar"},
  {"id":"curl","name":"Сгибания с гантелями","group":"arms","kind":"w","icon":"curl","equip":"db"},
  {"id":"hammer","name":"Молотки","group":"arms","kind":"w","icon":"curl","equip":"db"},
  {"id":"pushdown","name":"Разгибание на блоке","group":"arms","kind":"w","icon":"pushdown","equip":"cable"},
  {"id":"skull","name":"Французский жим","group":"arms","kind":"w","icon":"skull","equip":"bar"},
  {"id":"ohext","name":"Разгибание из-за головы","group":"arms","kind":"w","icon":"ohext","equip":"db"},
  {"id":"plank","name":"Планка","group":"abs","kind":"t","icon":"plank","equip":"bw"},
  {"id":"crunch","name":"Скручивания","group":"abs","kind":"bw","icon":"crunch","equip":"bw"},
  {"id":"legraise","name":"Подъём ног в висе","group":"abs","kind":"bw","icon":"legraise","equip":"bw"},
  {"id":"abwheel","name":"Ролик для пресса","group":"abs","kind":"bw","icon":"abwheel","equip":"bw"},
  {"id":"treadmill","name":"Беговая дорожка","group":"cardio","kind":"c","icon":"treadmill","equip":"cardio"},
  {"id":"bike","name":"Велотренажёр","group":"cardio","kind":"c","icon":"bike","equip":"cardio"},
  {"id":"rower","name":"Гребной тренажёр","group":"cardio","kind":"c","icon":"rower","equip":"cardio"},
  {"id":"elliptical","name":"Эллипс","group":"cardio","kind":"c","icon":"elliptical","equip":"cardio"},
  {"id":"stairs","name":"Степпер / лестница","group":"cardio","kind":"c","icon":"stairs","equip":"cardio"},
  {"id":"rope","name":"Скакалка","group":"cardio","kind":"c","icon":"rope","equip":"cardio"},
  {"id":"swim","name":"Плавание","group":"cardio","kind":"c","icon":"swim","equip":"cardio"},
  {"id":"walk","name":"Ходьба","group":"cardio","kind":"c","icon":"walk","equip":"cardio"},
  {"id":"boxing","name":"Бокс / груша","group":"cardio","kind":"c","icon":"boxing","equip":"cardio"},
  {"id":"run","name":"Бег","group":"cardio","kind":"c","icon":"treadmill","equip":"cardio"},
  {"id":"kbswing","name":"Махи гирей","group":"full","kind":"w","icon":"kbswing","equip":"kb"},
  {"id":"burpee","name":"Бёрпи","group":"full","kind":"bw","icon":"burpee","equip":"bw"},
  {"id":"farmer","name":"Прогулка фермера","group":"full","kind":"w","icon":"farmer","equip":"db"},
  {"id":"stretch","name":"Растяжка","group":"full","kind":"t","icon":"stretch","equip":"bw"}
];
/** как ещё называют упражнения — чтобы старые записи и свои названия узнавались */
export const EX_AKA: Record<string, string[]> = {"bench":["жим лёжа","жим лежа","жим штанги","жим на горизонтальной"],"incline":["жим на наклонной","наклонный жим"],"dbpress":["жим гантелей"],"dbfly":["разводка","разводки"],"pecdeck":["бабочка","пек дек","пек-дек"],"crossover":["кроссовер"],"pushup":["отжимания от пола"],"dip":["брусья"],"deadlift":["становая","становая тяга"],"pullup":["подтягивание","подтягивания"],"latpull":["тяга верхнего","верхний блок","тяга блока"],"row":["тяга в наклоне","тяга штанги"],"dbrow":["тяга гантели"],"cablerow":["нижний блок","горизонтальная тяга"],"hyper":["гиперэкстензия"],"squat":["присед","приседания","приседания со штангой"],"legpress":["жим ногами","платформа"],"rdl":["румынская","мертвая тяга","мёртвая тяга"],"lunge":["выпады"],"legext":["разгибания ног"],"legcurl":["сгибания ног"],"calf":["икры","подъём на носки","подъем на носки"],"hipthrust":["ягодичный мост","хип траст"],"ohp":["армейский жим","жим стоя","жим над головой"],"dbohp":["жим гантелей сидя","жим гантелей над головой"],"lateral":["махи","махи гантелями","разведения в стороны"],"bbcurl":["бицепс","подъём на бицепс","подъем на бицепс"],"curl":["сгибания на бицепс"],"pushdown":["трицепс на блоке","разгибания на блоке"],"skull":["французский"],"plank":["планка"],"crunch":["скручивания","пресс"],"run":["бег","пробежка"],"treadmill":["дорожка"],"bike":["велик","велосипед"],"rower":["гребля"],"rope":["скакалка"],"swim":["плавание","бассейн"],"walk":["ходьба","прогулка"],"boxing":["бокс"],"stretch":["растяжка","стретчинг"]};

const norm = (t: string) => t.trim().toLowerCase().replace(/ё/g, 'е');
export const exById = (id: string | null | undefined, extra: Exercise[] = []) => id ? EXERCISES.find(x => x.id === id) ?? extra.find(x => x.id === id) : undefined;
/** упражнение по названию: точное название или известное другое название */
export function exByName(name: string, extra: Exercise[] = []) {
  const k = norm(name), all = [...EXERCISES, ...extra];
  return all.find(x => norm(x.name) === k) ?? exById(Object.keys(EX_AKA).find(id => EX_AKA[id]!.some(a => norm(a) === k)));
}
export interface GymSet { kg?: number | null; reps?: number | null; seconds?: number | null; minutes?: number | null; km?: number | null }
/** расчётный максимум на один раз (Эпли), подходы до 12 повторов */
export const e1rm = (s: GymSet) => s.kg && s.reps ? s.kg * (1 + Math.min(s.reps, 12) / 30) : 0;
const f1 = (n: number) => (Math.round(n * 10) / 10).toLocaleString('ru-RU');
export function setText(s: GymSet, kind: GymKind) {
  if (kind === 'c') return [s.minutes && `${Math.round(s.minutes)} мин`, s.km && `${f1(s.km)} км`].filter(Boolean).join(' · ') || '—';
  if (kind === 't') return s.seconds ? (s.seconds >= 60 ? `${Math.floor(s.seconds / 60)}:${String(Math.round(s.seconds % 60)).padStart(2, '0')}` : `${s.seconds} с`) : '—';
  if (kind === 'bw') return `${s.reps ?? 0}${s.kg ? ` +${f1(s.kg)}` : ''}`;
  return `${f1(s.kg ?? 0)}×${s.reps ?? 0}`;
}
/** название тренировки по двум главным группам мышц: «Грудь + Руки» */
export function workoutTitle(groups: Array<{ group: string; sets: number }>) {
  const cnt: Record<string, number> = {};
  for (const g of groups) cnt[g.group] = (cnt[g.group] ?? 0) + Math.max(1, g.sets);
  const top = Object.entries(cnt).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([g]) => GYM_GROUPS[g]?.[0]).filter(Boolean);
  return top.length ? top.join(' + ') : 'Тренировка';
}
