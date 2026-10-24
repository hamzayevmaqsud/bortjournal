/**
 * Данные демо: три месяца (90 дней по сегодня) жизни человека, который ведёт Lumi.
 * Чистая функция: тот же seed и тот же «сейчас» — те же записи (генератор mulberry32 от хэша seed).
 * Ритм будней и выходных, ~10% пропущенных дней, несколько идеальных, рост к концу: вода и белок лучше,
 * вес 81 → 77,3 кг, серия последних 7 дней. Сегодня — только то, что уже «случилось» к текущему времени.
 * Записи без id и без владельца: их назначает вставка (demo.ts).
 */
import { addDays, EXERCISES, GYM_GROUPS, periodKey, weekday, workoutTitle, type GymSet } from '@bortjournal/core';
import { CATALOG } from '../modules/food/catalog-data.js';

export const DEMO_DAYS = 90;

/* ---------- случайность ---------- */
function rng(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
  let a = h >>> 0;
  const r = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const ri = (lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
  return {
    r, ri, chance: (p: number) => r() < p,
    /** примерно нормальное: среднее 0, σ ≈ 1 */
    gauss: () => (r() + r() + r() + r() - 2) * 1.7,
    pick: <T>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)]!,
    wpick: <T>(xs: readonly T[], w: (x: T) => number) => { const ws = xs.map(w), s = ws.reduce((a, b) => a + b, 0); let x = r() * s; for (let i = 0; i < xs.length; i++) if ((x -= ws[i]!) < 0) return xs[i]!; return xs.at(-1)!; },
    /** минуты от полуночи, кратно 5 */
    at: (lo: number, hi: number) => Math.round((lo + r() * (hi - lo)) / 5) * 5
  };
}
const hm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const H = (h: number, m = 0) => h * 60 + m;
const r1 = (v: number) => Math.round(v * 10) / 10;
const r2 = (v: number) => Math.round(v * 100) / 100;

/* ---------- еда: блюда из справочника, порции в граммах ---------- */
const FOOD = new Map(CATALOG.map(c => [c[0], c]));
type Slot = 'breakfast' | 'lunch' | 'snack' | 'dinner';
/** fav — как часто ест; pro — белковое (чаще к концу), cheat — «вольность» (реже к концу, чаще в выходные) */
interface Dish { slot: Slot; name: string; parts: Array<[string, number]>; fav: number; pro?: boolean; cheat?: boolean }
const DISHES: Dish[] = [
  { slot: 'breakfast', name: 'Овсянка с бананом и орехами', parts: [['Овсянка на молоке', 250], ['Банан', 100], ['Грецкие орехи', 15]], fav: 5 },
  { slot: 'breakfast', name: 'Омлет с цельнозерновым тостом', parts: [['Омлет', 180], ['Хлеб цельнозерновой', 30], ['Помидор', 100]], fav: 4, pro: true },
  { slot: 'breakfast', name: 'Сырники со сметаной', parts: [['Сырники', 150], ['Сметана 15%', 30]], fav: 2, pro: true },
  { slot: 'breakfast', name: 'Творог с клубникой и мёдом', parts: [['Творог 5%', 200], ['Клубника', 100], ['Мёд', 10]], fav: 3, pro: true },
  { slot: 'breakfast', name: 'Яичница с помидорами и ржаным хлебом', parts: [['Яичница', 110], ['Помидор', 120], ['Хлеб ржаной', 30]], fav: 3, pro: true },
  { slot: 'breakfast', name: 'Греческий йогурт с хлопьями и бананом', parts: [['Йогурт греческий 2%', 180], ['Овсяные хлопья сухие', 30], ['Банан', 60]], fav: 2, pro: true },
  { slot: 'breakfast', name: 'Круассан и сыр', parts: [['Круассан', 60], ['Сыр твёрдый', 30]], fav: 1.5, cheat: true },
  { slot: 'breakfast', name: 'Блины со сметаной', parts: [['Блины', 150], ['Сметана 20%', 30]], fav: 1, cheat: true },
  { slot: 'lunch', name: 'Курица с рисом и салатом', parts: [['Куриная грудка на гриле', 150], ['Рис белый варёный', 150], ['Салат из овощей с маслом', 150]], fav: 5, pro: true },
  { slot: 'lunch', name: 'Борщ со сметаной и хлебом', parts: [['Борщ', 350], ['Сметана 15%', 20], ['Хлеб ржаной', 40]], fav: 3 },
  { slot: 'lunch', name: 'Чечевичный суп с лавашем', parts: [['Чечевичный суп', 350], ['Лаваш', 50]], fav: 2.5 },
  { slot: 'lunch', name: 'Плов с курицей и салатом', parts: [['Плов с курицей', 300], ['Огурец', 100], ['Помидор', 100]], fav: 2.5 },
  { slot: 'lunch', name: 'Гречка с говядиной', parts: [['Гречка с мясом', 330]], fav: 3, pro: true },
  { slot: 'lunch', name: 'Куриные котлеты с пюре', parts: [['Котлета куриная', 200], ['Картофельное пюре', 180]], fav: 2.5, pro: true },
  { slot: 'lunch', name: 'Цезарь с курицей', parts: [['Цезарь с курицей', 280]], fav: 2, pro: true },
  { slot: 'lunch', name: 'Долма с мацони', parts: [['Долма', 220], ['Мацони', 80]], fav: 1.5 },
  { slot: 'lunch', name: 'Лагман', parts: [['Лагман', 400]], fav: 1.5 },
  { slot: 'lunch', name: 'Суп с лапшой и хлебом', parts: [['Суп куриный с лапшой', 350], ['Хлеб белый', 30]], fav: 1.5 },
  { slot: 'lunch', name: 'Шаурма с курицей', parts: [['Шаурма с курицей', 300]], fav: 1.5, cheat: true },
  { slot: 'lunch', name: 'Кутабы с зеленью и айран', parts: [['Кутабы с зеленью', 180], ['Айран', 250]], fav: 1.5, cheat: true },
  { slot: 'snack', name: 'Греческий йогурт с ягодами', parts: [['Йогурт греческий 2%', 150], ['Клубника', 80]], fav: 4, pro: true },
  { slot: 'snack', name: 'Яблоко и миндаль', parts: [['Яблоко', 180], ['Миндаль', 20]], fav: 3 },
  { slot: 'snack', name: 'Творог с мёдом', parts: [['Творог 5%', 180], ['Мёд', 10]], fav: 3, pro: true },
  { slot: 'snack', name: 'Кефир и банан', parts: [['Кефир 1%', 250], ['Банан', 120]], fav: 2.5, pro: true },
  { slot: 'snack', name: 'Хумус с морковью и огурцом', parts: [['Хумус', 60], ['Морковь', 80], ['Огурец', 100]], fav: 1.5 },
  { slot: 'snack', name: 'Горький шоколад и мандарины', parts: [['Шоколад горький 70%', 25], ['Мандарин', 160]], fav: 1.5, cheat: true },
  { slot: 'snack', name: 'Овсяное печенье', parts: [['Печенье овсяное', 45]], fav: 1, cheat: true },
  { slot: 'dinner', name: 'Лосось с брокколи', parts: [['Лосось запечённый', 160], ['Брокколи', 150]], fav: 3, pro: true },
  { slot: 'dinner', name: 'Индейка с булгуром и огурцом', parts: [['Индейка, грудка', 170], ['Булгур варёный', 150], ['Огурец', 100]], fav: 3.5, pro: true },
  { slot: 'dinner', name: 'Треска с отварным картофелем', parts: [['Треска запечённая', 180], ['Картофель варёный', 180]], fav: 2, pro: true },
  { slot: 'dinner', name: 'Шашлык из курицы с печёными баклажанами', parts: [['Шашлык из курицы', 220], ['Баклажан запечённый', 150], ['Лаваш', 30]], fav: 2, pro: true },
  { slot: 'dinner', name: 'Паста болоньезе', parts: [['Паста болоньезе', 300]], fav: 2 },
  { slot: 'dinner', name: 'Голубцы со сметаной', parts: [['Голубцы', 300], ['Сметана 15%', 30]], fav: 2 },
  { slot: 'dinner', name: 'Гречка с говяжьей котлетой', parts: [['Гречка варёная', 180], ['Котлета говяжья', 100]], fav: 2.5, pro: true },
  { slot: 'dinner', name: 'Креветки с греческим салатом', parts: [['Креветки варёные', 150], ['Греческий салат', 200]], fav: 1.5, pro: true },
  { slot: 'dinner', name: 'Пельмени со сметаной', parts: [['Пельмени', 220], ['Сметана 20%', 30]], fav: 1.5, cheat: true },
  { slot: 'dinner', name: 'Пицца пепперони', parts: [['Пицца пепперони', 240]], fav: 1, cheat: true },
  { slot: 'dinner', name: 'Хинкали', parts: [['Хинкали', 250]], fav: 1, cheat: true }
];
for (const d of DISHES) for (const [n] of d.parts) if (!FOOD.has(n)) throw new Error(`демо: нет «${n}» в справочнике`);
function cook(d: Dish, k: number) {
  const t = { kcal: 0, protein: 0, fat: 0, carbs: 0 };
  for (const [n, g] of d.parts) { const c = FOOD.get(n)!, w = Math.round(g * k / 5) * 5 / 100; t.kcal += c[1] * w; t.protein += c[2] * w; t.fat += c[3] * w; t.carbs += c[4] * w; }
  return { kcal: Math.round(t.kcal), protein: r1(t.protein), fat: r1(t.fat), carbs: r1(t.carbs) };
}
const dishKcal = (d: Dish) => cook(d, 1).kcal;

/* ---------- учёба ---------- */
const TOPICS: Record<string, Array<[string, string, string]>> = {
  'Программирование': [
    ['SQL: SELECT и фильтрация', 'WHERE фильтрует строки до группировки', 'ORDER BY выполняется последним, после SELECT'],
    ['SQL: JOIN', 'INNER JOIN оставляет только совпавшие строки', 'LEFT JOIN сохраняет все строки левой таблицы'],
    ['SQL: GROUP BY и HAVING', 'HAVING фильтрует уже готовые группы', 'в SELECT — только поля группировки и агрегаты'],
    ['SQL: подзапросы', 'EXISTS останавливается на первом совпадении', 'коррелированный подзапрос выполняется для каждой строки'],
    ['SQL: оконные функции', 'ROW_NUMBER нумерует строки внутри окна', 'PARTITION BY делит строки на группы, не схлопывая их'],
    ['SQL: индексы', 'B-tree подходит для равенства и диапазонов', 'индекс ускоряет чтение, но замедляет запись'],
    ['SQL: транзакции', 'ACID — атомарность, согласованность, изоляция, долговечность', 'READ COMMITTED видит только зафиксированные данные'],
    ['SQL: CTE', 'WITH делает запрос читаемым по шагам', 'рекурсивный CTE обходит деревья и графы'],
    ['SQL: EXPLAIN', 'Seq Scan читает всю таблицу', 'EXPLAIN ANALYZE выполняет запрос и показывает реальное время'],
    ['SQL: нормализация', '3НФ — нет транзитивных зависимостей', 'денормализация ускоряет чтение ценой дублей']
  ],
  'Языки': [
    ['Английский: Present Perfect', 'Present Perfect — результат к настоящему моменту', 'since — с какого момента, for — сколько времени'],
    ['Английский: фразовые глаголы', 'give up — бросить, сдаться', 'look after — присматривать за кем-то'],
    ['Английский: условные предложения', 'second conditional — нереальное настоящее: If I were…', 'third conditional — сожаление о прошлом'],
    ['Английский: артикли', 'a/an — впервые упомянутый предмет', 'the — уже известный или единственный'],
    ['Английский: Past Simple и Past Continuous', 'Continuous — фон, Simple — короткое действие на его фоне', 'while обычно с Continuous'],
    ['Английский: модальные глаголы', 'must — внутренняя необходимость, have to — внешняя', "mustn't — запрет, don't have to — необязательно"],
    ['Английский: пассивный залог', 'be + третья форма глагола', 'by указывает, кто сделал'],
    ['Английский: косвенная речь', 'время сдвигается на шаг в прошлое', 'say something, tell someone something'],
    ['Английский: слова для работы', 'deadline — крайний срок', 'follow up — вернуться к вопросу, напомнить'],
    ['Английский: герундий и инфинитив', 'enjoy, avoid, finish — с -ing', 'want, decide, plan — с to']
  ],
  'Финансы': [
    ['Финансы: подушка безопасности', 'подушка — 3–6 месячных расходов', 'держать её отдельно от повседневного счёта'],
    ['Финансы: сложный процент', 'доход начисляется и на прошлый доход', 'правило 72: 72 / ставка ≈ годы до удвоения'],
    ['Финансы: облигации', 'цена облигации падает, когда ставки растут', 'купон — регулярная выплата по облигации'],
    ['Финансы: индексные фонды', 'индексный фонд повторяет рынок с низкой комиссией', 'диверсификация снижает риск одной компании'],
    ['Финансы: бюджет 50/30/20', '50% — нужды, 30% — желания, 20% — сбережения', 'сначала откладывай, потом трать']
  ]
};
/** вопросы с вариантами по конспекту SQL — без ИИ: правильный вариант — correct */
const QUESTIONS: Array<[q: string, options: [string, string, string, string], correct: number, explain: string]> = [
  ['Чем WHERE отличается от HAVING?', ['WHERE фильтрует строки, HAVING — группы', 'HAVING работает только с JOIN', 'WHERE выполняется после GROUP BY', 'Ничем, это синонимы'], 0, 'HAVING применяется к результатам GROUP BY.'],
  ['Какие строки вернёт LEFT JOIN?', ['Только совпавшие', 'Все строки левой таблицы и совпавшие справа', 'Все строки правой таблицы', 'Декартово произведение'], 1, 'Несовпавшие строки слева получают NULL справа.'],
  ['Что делает PARTITION BY в оконной функции?', ['Удаляет дубли', 'Сортирует результат', 'Делит строки на группы, не схлопывая их', 'Создаёт индекс'], 2, 'Окно считается внутри каждой группы, строки остаются.'],
  ['Когда B-tree индекс не поможет?', ['Поиск по равенству', 'Поиск по диапазону', 'Сортировка по полю индекса', 'Поиск по LIKE с % в начале'], 3, 'Шаблон с % в начале не использует порядок индекса.'],
  ['Что означает буква A в ACID?', ['Атомарность', 'Асинхронность', 'Агрегация', 'Авторизация'], 0, 'Транзакция выполняется целиком или не выполняется вовсе.'],
  ['Чем полезен CTE (WITH)?', ['Ускоряет любую выборку в разы', 'Разбивает запрос на понятные шаги', 'Заменяет индексы', 'Блокирует таблицу'], 1, 'CTE — именованный промежуточный результат.'],
  ['Что показывает Seq Scan в EXPLAIN?', ['Чтение по индексу', 'Сортировку в памяти', 'Последовательное чтение всей таблицы', 'Соединение хэшем'], 2, 'Seq Scan — полный проход по таблице.'],
  ['Что верно про EXISTS?', ['Возвращает число строк', 'Всегда медленнее IN', 'Работает только с NULL', 'Останавливается на первом найденном совпадении'], 3, 'Для EXISTS важно лишь наличие строки.'],
  ['Что нельзя писать в SELECT при GROUP BY?', ['Поля, не входящие в группировку и не в агрегате', 'COUNT(*)', 'Поля группировки', 'SUM по любому полю'], 0, 'Иначе непонятно, какое значение группы взять.'],
  ['Что делает ROW_NUMBER()?', ['Считает строки таблицы', 'Нумерует строки по порядку внутри окна', 'Возвращает id строки', 'Удаляет повторы'], 1, 'Номера идут подряд по ORDER BY окна.'],
  ['Чем опасен лишний индекс?', ['Таблица становится только для чтения', 'Запросы перестают сортироваться', 'Замедляет вставку и обновление', 'Удаляет старые данные'], 2, 'Каждый индекс обновляется при записи.'],
  ['Что такое 3НФ?', ['Три таблицы в запросе', 'Три индекса на таблицу', 'Три уровня изоляции', 'Нет транзитивных зависимостей от ключа'], 3, 'Неключевые поля зависят только от ключа.'],
  ['Какой уровень изоляции в PostgreSQL по умолчанию?', ['READ COMMITTED', 'READ UNCOMMITTED', 'SERIALIZABLE', 'REPEATABLE READ'], 0, 'Каждый запрос видит данные, зафиксированные до его начала.'],
  ['Чем INNER JOIN отличается от CROSS JOIN?', ['Ничем', 'INNER JOIN соединяет по условию, CROSS — каждую с каждой', 'CROSS JOIN быстрее всегда', 'INNER JOIN возвращает NULL'], 1, 'CROSS JOIN — декартово произведение.'],
  ['Что делает EXPLAIN ANALYZE?', ['Только показывает план', 'Создаёт индексы', 'Выполняет запрос и показывает реальное время', 'Проверяет синтаксис'], 2, 'План с фактическими цифрами выполнения.'],
  ['Для чего денормализация?', ['Чтобы убрать дубли', 'Чтобы ускорить запись', 'Чтобы соблюсти 3НФ', 'Чтобы ускорить чтение ценой дублей'], 3, 'Меньше JOIN при чтении, но данные повторяются.']
];

/* ---------- зал: программа «верх / низ», веса растут ---------- */
type Lift = [key: string, sets: number, reps: number, from: number, to: number];
const UPPER: Lift[] = [['bench', 4, 8, 50, 62.5], ['row', 3, 10, 45, 57.5], ['ohp', 3, 8, 30, 37.5], ['latpull', 3, 10, 45, 57.5], ['pushdown', 3, 12, 20, 27.5]];
const LOWER: Lift[] = [['squat', 4, 8, 60, 82.5], ['rdl', 3, 10, 55, 72.5], ['legpress', 3, 12, 100, 140], ['calf', 3, 15, 40, 60], ['plank', 3, 0, 45, 90]];
const ex = (key: string) => EXERCISES.find(e => e.id === key)!;

/* ---------- задачи ---------- */
const TODOS = ['Оплатить коммуналку', 'Купить продукты', 'Записаться к стоматологу', 'Отправить отчёт', 'Ответить на письма клиентов', 'Забрать посылку',
  'Погладить рубашки на неделю', 'Подготовить слайды к созвону', 'Созвон с командой', 'Купить подарок Тимуру', 'Поменять масло в машине', 'Продлить страховку',
  'Разобрать шкаф', 'Встреча с Ильёй', 'Починить кран на кухне', 'Заказать фильтры для воды', 'Записаться на стрижку', 'Код-ревью задач команды',
  'Обновить резюме', 'Оплатить интернет', 'Купить корм коту', 'Вынести старую мебель', 'Сверить расходы за месяц', 'Позвонить бабушке', 'Сходить в банк',
  'Отнести вещи в химчистку', 'Пропылесосить машину', 'Забронировать столик на субботу', 'Купить лампочки', 'Распечатать документы'];
const WEEKDAY_SERIES = { title: 'Разобрать почту', time: '09:30', rule: { kind: 'weekdays' as const }, done: 0.8 };
const SUNDAY_SERIES = { title: 'Спланировать неделю', time: '20:00', rule: { kind: 'days' as const, days: [0] }, done: 0.85 };
const PLANTS_SERIES = { title: 'Полить цветы', time: null, rule: { kind: 'days' as const, days: [3, 6] }, done: 0.75 };

/* ---------- бюджет ---------- */
const SHOP = ['Футболка', 'Наушники', 'Книга в подарок', 'Кроссовки', 'Сковорода', 'Зарядка для телефона'];
const FUN = ['Кино', 'Боулинг с друзьями', 'Ужин в ресторане', 'Концерт', 'Квиз в баре', 'Прогулка на катере'];
const MARKET = ['Продукты', 'Продукты на неделю', 'Рынок: овощи и фрукты', 'Продукты и бытовая химия'];

export interface DemoMeal { day: string; time: string; slot: Slot; name: string; kcal: number; protein: number; fat: number; carbs: number }
export interface DemoDrink { day: string; time: string; type: string; ml: number }
export interface DemoTask { title: string; day: string | null; time: string | null; done: boolean; prio: boolean; series?: number; goal?: number; createdOn: string }
export interface DemoGoal { period: 'week' | 'month' | 'quarter'; periodKey: string; title: string; done: boolean; parent?: number; createdOn: string }
export interface DemoWorkout { day: string; time: string; title: string; minutes: number; planIdx: number | null; exercises: Array<{ key: string; name: string; sets: GymSet[] }> }
export interface DemoMoney { day: string; time: string; kind: 'in' | 'out'; category: string; amount: number; note: string | null }

/** всё демо за 90 дней: today — местный день, nowHm — местное время «ЧЧ:ММ» */
export function demoData(seed: string, today: string, nowHm: string) {
  const R = rng(seed), first = addDays(today, -(DEMO_DAYS - 1));
  const nowMin = +nowHm.slice(0, 2) * 60 + +nowHm.slice(3, 5);
  const days = Array.from({ length: DEMO_DAYS }, (_, k) => addDays(first, k));

  // пропуски: 8–11 дней, чаще в начале; день −7 пропущен — так серия последних 7 дней честная
  const missed = new Set<string>([addDays(today, -7)]);
  const want = R.ri(8, 11);
  while (missed.size < want) { const k = R.wpick(Array.from({ length: DEMO_DAYS - 9 }, (_, i) => i + 1), i => 1.7 - i / DEMO_DAYS); missed.add(days[k]!); }
  // идеальные дни: всё в норме — чаще к концу
  const great = new Set(days.filter((d, k) => !missed.has(d) && k < DEMO_DAYS - 1 && R.chance(0.02 + 0.08 * k / DEMO_DAYS)));

  const meals: DemoMeal[] = [], drinks: DemoDrink[] = [], body: Array<{ day: string; steps: number | null; weightKg: number | null }> = [];
  const tasks: DemoTask[] = [], sessions: Array<{ day: string; time: string; topic: string; category: string; minutes: number; theses: string[] }> = [];
  const workouts: DemoWorkout[] = [], money: DemoMoney[] = [], checks: Array<{ habit: number; day: string }> = [];
  const reading: Array<{ book: number; day: string; pages: number }> = [], answers: Array<{ q: number; day: string; correct: boolean }> = [];
  const used = new Map<string, number>();
  const topicAt: Record<string, number> = { 'Программирование': 2, 'Языки': 0, 'Финансы': 0 };
  let liftN = 0;
  const book = { idx: 0, page: 0 }, BOOK_PAGES = [480, 656];
  const bookDates: Array<{ startedOn: string; finishedOn: string | null }> = [{ startedOn: first, finishedOn: null }, { startedOn: '', finishedOn: null }];
  let pause = 0;
  const srs = new Map<number, { interval: number; ease: number; reps: number; due: string; last: string }>();
  const quizFrom = addDays(today, -40);

  for (const [k, day] of days.entries()) {
    const p = k / (DEMO_DAYS - 1), wd = weekday(day), weekend = wd === 0 || wd === 6, isToday = day === today, g = great.has(day);
    const past = (m: number) => !isToday || m <= nowMin;

    // повторы задач идут и в пропущенные дни — просто остаются несделанными
    for (const [si, s] of [WEEKDAY_SERIES, SUNDAY_SERIES, PLANTS_SERIES].entries()) {
      const hit = s.rule.kind === 'weekdays' ? wd >= 1 && wd <= 5 : s.rule.days!.includes(wd);
      if (!hit) continue;
      const t = s.time ? +s.time.slice(0, 2) * 60 + +s.time.slice(3) : H(18);
      tasks.push({ title: s.title, day, time: s.time, done: !missed.has(day) && past(t) && (g || R.chance(s.done)), prio: false, series: si, createdOn: day });
    }
    if (missed.has(day)) { if (R.chance(0.5)) tasks.push({ title: R.pick(TODOS), day, time: null, done: false, prio: false, createdOn: addDays(day, -R.ri(1, 4)) }); continue; }

    /* еда */
    const wake = weekend ? H(9, 30) : H(7, 30);
    const plan: Array<[Slot, number]> = [];
    // вчера и сегодня — полноценные дни: завтрак, обед и ужин на месте
    const full = g || k >= DEMO_DAYS - 2;
    if (full || R.chance(0.92)) plan.push(['breakfast', weekend ? R.at(H(9, 40), H(10, 50)) : R.at(H(7, 45), H(8, 50))]);
    if (full || R.chance(0.97)) plan.push(['lunch', R.at(H(12, 40), H(14, 10))]);
    if (g || R.chance(0.42 + 0.3 * p)) plan.push(['snack', R.at(H(16), H(17, 30))]);
    if (full || R.chance(0.97)) plan.push(['dinner', R.at(H(19), H(20, 50))]);
    const proW = 0.1 + 1.1 * p, cheatW = (weekend ? 2.2 : 0.6) * (1.25 - p);
    const chosen = plan.map(([slot, t]) => ({ t, d: R.wpick(DISHES.filter(d => d.slot === slot && (!g || d.pro)), d => d.fav * (d.pro ? proW : 1) * (d.cheat ? cheatW : 1) * (1 + (used.get(d.name) ?? 0) / 25)) }));
    // калории дня: в начале чаще перебор, к концу ровнее; порции масштабируются под цель дня
    const target = 2100 * (g ? 0.99 + R.gauss() * 0.02 : 1 + R.gauss() * 0.1 + 0.08 * (1 - p) - 0.03 + (weekend ? (R.chance(0.35 - 0.15 * p) ? 0.22 : 0.05) : 0)) - 120;
    const base = chosen.reduce((a, c) => a + dishKcal(c.d), 0), kf = base ? Math.min(1.3, Math.max(0.8, target / base)) : 1;
    for (const c of chosen) if (past(c.t)) {
      used.set(c.d.name, (used.get(c.d.name) ?? 0) + 1);
      meals.push({ day, time: hm(c.t), slot: c.d.slot, name: c.d.name, ...cook(c.d, kf) });
    }

    /* напитки: кофе утром, чай днём, вода — к цели дня, которая растёт к концу */
    const bt = plan.find(x => x[0] === 'breakfast')?.[1] ?? wake + 30;
    const dl: DemoDrink[] = [];
    if (R.chance(0.9)) dl.push({ day, time: hm(bt + 10), type: R.chance(0.65) ? 'latte' : 'coffee', ml: R.chance(0.65) ? 250 : 200 });
    if (!weekend && R.chance(0.35)) dl.push({ day, time: hm(R.at(H(11), H(12))), type: 'coffee', ml: 150 });
    if (R.chance(0.5)) dl.push({ day, time: hm(R.at(H(16, 15), H(17, 30))), type: 'tea', ml: 250 });
    if (weekend && R.chance(0.35 * (1 - p))) dl.push({ day, time: hm(R.at(H(13), H(15))), type: 'cola', ml: 330 });
    const waterGoal = g ? 2500 + R.ri(0, 400) : 1250 + 1150 * p + R.gauss() * 280;
    let have = dl.reduce((a, d) => a + (d.type === 'cola' ? 330 : d.ml), 0);
    for (let t = wake + R.ri(0, 30); have < waterGoal && t < H(22); t += R.at(55, 110)) {
      const ml = R.pick([250, 300, 330, 500, 500]); dl.push({ day, time: hm(Math.round(t / 5) * 5), type: R.chance(0.12) ? 'soda' : 'water', ml }); have += ml;
    }
    drinks.push(...dl.filter(d => past(+d.time.slice(0, 2) * 60 + +d.time.slice(3))));

    /* шаги и вес */
    let steps = weekend ? (R.chance(0.3) ? R.ri(10500, 13500) : R.ri(4200, 8200)) : 7300 + 2300 * p + R.gauss() * 1700;
    if (g) steps = Math.max(steps, R.ri(9500, 12500));
    steps = Math.round(Math.min(14500, Math.max(3800, steps)));
    if (isToday) steps = Math.round(Math.min(1, Math.max(0, (nowMin - H(7)) / H(14))) * steps);
    let weightKg: number | null = null;
    if (k === 0) weightKg = 81;
    else if (k === DEMO_DAYS - 2) weightKg = 77.3;
    else if (!isToday && R.chance(wd === 1 ? 0.8 : 0.45)) weightKg = r1(81 - 3.7 * Math.pow(p, 0.9) + R.gauss() * 0.22 + (wd === 1 ? 0.2 : 0));
    if (steps > 0 || weightKg) body.push({ day, steps: steps || null, weightKg });

    /* задачи на день */
    // сегодня — понятный план дня: дела утром, звонок вечером, чтение перед сном
    if (isToday) for (const [title, t, prio] of [['Оплатить интернет', H(10), false], ['Купить продукты на неделю', null, true], ['Позвонить маме', H(18), false], ['Прочитать 20 страниц', H(21, 30), false]] as const)
      tasks.push({ title, day, time: t === null ? null : hm(t), done: t !== null && past(t) && title !== 'Прочитать 20 страниц', prio, createdOn: addDays(day, -1) });
    const n = isToday ? 0 : weekend ? R.ri(0, 2) : R.ri(1, 3);
    for (let i = 0; i < n; i++) {
      const t = R.chance(0.5) ? R.at(H(9), H(21)) : null;
      tasks.push({ title: R.pick(TODOS), day, time: t === null ? null : hm(t), done: (t === null ? !isToday || nowMin >= H(12) : past(t)) && (g || R.chance(0.65 + 0.15 * p)), prio: R.chance(0.15), createdOn: addDays(day, -R.ri(0, 3)) });
    }

    /* учёба */
    if (g || R.chance(weekend ? 0.3 : 0.42 + 0.25 * p)) {
      const t = !weekend && R.chance(0.2) ? R.at(H(7), H(7, 30)) : weekend ? R.at(H(11), H(16)) : R.at(H(20), H(21, 30));
      if (past(t)) {
        const category = R.wpick(Object.keys(TOPICS), c => c === 'Программирование' ? 0.45 : c === 'Языки' ? 0.4 : 0.15);
        const list = TOPICS[category]!, [topic, a, b] = list[topicAt[category]! % list.length]!;
        const again = topicAt[category]! >= list.length;
        topicAt[category]! += 1;
        sessions.push({ day, time: hm(t), topic: again ? `${topic} — повторение` : topic, category, minutes: g ? R.ri(9, 14) * 5 : R.ri(4, 14) * 5, theses: [a, b] });
      }
    }
    // вопросы по конспекту SQL: последние ~6 недель, сегодня — ещё не отвечены
    if (!isToday && day >= quizFrom && (g || R.chance(0.6))) {
      const due = [...srs.entries()].filter(([, s]) => s.due <= day).map(([q]) => q);
      const fresh = QUESTIONS.map((_, i) => i).filter(i => !srs.has(i)).slice(0, R.ri(2, 4));
      for (const q of [...due, ...fresh]) {
        const correct = R.chance(0.68 + 0.25 * p), s = srs.get(q) ?? { interval: 0, ease: 2.5, reps: 0, due: day, last: day };
        if (!correct) Object.assign(s, { interval: 1, ease: Math.max(1.3, r2(s.ease - 0.2)), reps: 0 });
        else Object.assign(s, { interval: s.reps === 0 ? 2 : s.reps === 1 ? 5 : Math.round(s.interval * s.ease), ease: Math.min(3, r2(s.ease + 0.05)), reps: s.reps + 1 });
        s.due = addDays(day, s.interval); s.last = day; srs.set(q, s);
        answers.push({ q, day, correct });
      }
    }

    /* зал: пн и ср — верх и низ по очереди, пт — снова, иногда суббота — кардио */
    const gymDay = (wd === 1 || wd === 3 || wd === 5) && k >= 2 && (R.chance(0.58 + 0.25 * p) || (g && wd !== 3));
    const t = R.at(H(18, 45), H(19, 30));
    if (gymDay && past(t + 60)) {
      const prog = Math.min(1, liftN / 30), lifts = liftN % 2 === 0 ? UPPER : LOWER;
      liftN++;
      const exs = lifts.map(([key, sets, reps, from, to]) => {
        const e = ex(key);
        if (e.kind === 't') return { key, name: e.name, sets: Array.from({ length: sets }, () => ({ seconds: Math.round((from + (to - from) * prog) / 5) * 5 })) };
        const kg = Math.max(from, Math.round((from + (to - from) * prog - (R.chance(0.12) ? 2.5 : 0)) / 2.5) * 2.5);
        return { key, name: e.name, sets: Array.from({ length: sets }, (_, i) => ({ kg: i === 0 && sets > 3 ? kg - 10 : kg, reps: i === sets - 1 ? Math.max(5, reps - R.ri(0, 2)) : reps })) };
      });
      workouts.push({ day, time: hm(t), title: workoutTitle(exs.map(e => ({ group: ex(e.key).group, sets: e.sets.length }))), minutes: R.ri(10, 15) * 5, planIdx: lifts === UPPER ? 0 : 1, exercises: exs });
    } else if (wd === 6 && R.chance(0.2) && !isToday) {
      const minutes = R.ri(5, 7) * 5;
      workouts.push({ day, time: hm(R.at(H(10, 30), H(11, 30))), title: GYM_GROUPS.cardio![0], minutes: minutes + 5, planIdx: null, exercises: [{ key: 'treadmill', name: ex('treadmill').name, sets: [{ minutes, km: r1(minutes / 7 + R.r() * 0.4) }] }] });
    }

    /* бюджет */
    const out = (t: number, category: string, amount: number, note: string | null) => { if (past(t)) money.push({ day, time: hm(t), kind: 'out', category, amount: r2(amount), note }); };
    const dom = +day.slice(8);
    if (!weekend && R.chance(0.75)) out(R.at(H(8, 10), H(8, 50)), 'transport', 1, 'Метро');
    if (R.chance(0.18)) out(R.at(H(18), H(22)), 'transport', R.ri(4, 9), 'Такси');
    if (!weekend && R.chance(0.4)) out(R.at(H(12, 40), H(14)), 'cafe', R.ri(8, 16), 'Обед в кафе');
    if (R.chance(0.28)) out(R.at(H(9), H(17)), 'cafe', R.ri(3, 5) + 0.5, 'Кофе с собой');
    if (R.chance(weekend ? 0.75 : 0.35)) out(R.at(H(17, 30), H(20, 30)), 'food', R.ri(18, 65) + R.ri(0, 9) / 10, R.pick(MARKET));
    if (R.chance(0.08)) out(R.at(H(12), H(20)), 'shop', R.ri(20, 120), R.pick(SHOP));
    if (R.chance(0.04)) out(R.at(H(10), H(19)), 'health', R.ri(8, 35), 'Аптека');
    if (weekend && R.chance(0.55)) out(R.at(H(17), H(21)), 'fun', R.ri(20, 70), R.pick(FUN));
    if (dom === 5) { out(H(10), 'home', R.ri(65, 90), 'Коммуналка'); out(H(10, 5), 'home', 30, 'Интернет'); }
    if (dom === 10) out(H(12), 'home', 15, 'Мобильная связь');
    if (dom === 2) out(H(19), 'health', 60, 'Абонемент в зал');
    if (dom === 15 && past(H(11))) money.push({ day, time: '11:00', kind: 'in', category: 'side', amount: R.ri(20, 30) * 10, note: 'Фриланс: лендинг' });

    /* книги: дочитать «Мастера и Маргариту», пару дней перерыв, потом Канеман */
    if (pause > 0) pause--;
    else if ((g || R.chance(0.55 + 0.15 * p)) && (!isToday || nowMin >= H(22)) && book.idx < 2) {
      const left = BOOK_PAGES[book.idx]! - book.page, pages = Math.min(left, book.idx === 0 ? R.ri(14, 36) : R.ri(8, 22));
      if (book.idx === 1 && left < 60) { /* растягиваем: Канеман ещё читается */ }
      else {
        if (book.idx === 1 && !bookDates[1]!.startedOn) bookDates[1]!.startedOn = day;
        reading.push({ book: book.idx, day, pages }); book.page += pages;
        if (book.idx === 0 && book.page >= BOOK_PAGES[0]!) { bookDates[0]!.finishedOn = day; book.idx = 1; book.page = 0; pause = 2; }
      }
    }

    /* привычки: к концу ровнее; последние дни подряд — живые серии */
    const H4: Array<[number, number, number]> = [[0.76, 0.2, 7], [0.86, 0.1, 8], [0.62, 0.25, 4], [0.68, 0.2, 5]];
    for (const [h, [base, grow, tail]] of H4.entries()) {
      const tailOn = k >= DEMO_DAYS - 1 - tail;
      if (isToday ? (h === 1 || (h === 0 && nowMin >= H(7, 30))) : tailOn || R.chance(base + grow * p)) checks.push({ habit: h, day });
    }
  }

  /* задачи: на будущее и без даты, цели */
  for (const [n, title, time] of [[1, 'Отправить отчёт по проекту', '11:00'], [2, 'Забрать анализы', null], [3, 'День рождения Лейлы — купить цветы', '18:30'], [5, 'Техосмотр машины', '10:00'], [8, 'Оплатить страховку', null]] as const)
    tasks.push({ title, day: addDays(today, n), time, done: false, prio: n === 1, createdOn: addDays(today, -R.ri(0, 5)) });
  for (const title of ['Разобрать фото с отпуска', 'Выбрать курс по Python', 'Сделать бэкап телефона', 'Список подарков на Новый год'])
    tasks.push({ title, day: null, time: null, done: false, prio: false, createdOn: addDays(today, -R.ri(5, 40)) });
  const prevMonth = addDays(`${today.slice(0, 7)}-01`, -1);
  const goals: DemoGoal[] = [
    { period: 'quarter', periodKey: periodKey('quarter', today), title: 'Дойти до 76 кг', done: false, createdOn: addDays(today, -R.ri(20, 25)) },
    { period: 'quarter', periodKey: periodKey('quarter', today), title: 'Пройти курс по SQL', done: false, createdOn: addDays(today, -R.ri(20, 25)) },
    { period: 'month', periodKey: periodKey('month', today), title: 'Тренироваться 10 раз за месяц', done: false, parent: 0, createdOn: `${today.slice(0, 7)}-01` },
    { period: 'week', periodKey: periodKey('week', today), title: 'Закрыть отчёт по проекту', done: false, createdOn: periodKey('week', today) },
    { period: 'month', periodKey: periodKey('month', prevMonth), title: 'Сдать анализы', done: true, createdOn: `${prevMonth.slice(0, 7)}-01` },
    { period: 'month', periodKey: periodKey('month', prevMonth), title: 'Дочитать «Мастера и Маргариту»', done: true, createdOn: `${prevMonth.slice(0, 7)}-01` }
  ];
  // задачи к целям: прошлые почти все сделаны, одна-две отстают, будущие — ещё впереди (прогресс целей — между 0 и 100%)
  const goalTasks: Array<[goal: number, n: number, title: string, done: boolean]> = [
    [1, -24, 'SQL: модуль 3 — подзапросы', true], [1, -17, 'SQL: модуль 4 — оконные функции', true], [1, -10, 'SQL: модуль 5 — индексы', true], [1, -3, 'SQL: модуль 6 — транзакции', false], [1, 4, 'SQL: итоговый проект', false],
    [2, -20, 'Тренировка: верх', true], [2, -13, 'Тренировка: низ', true], [2, -6, 'Тренировка: верх', false], [2, 2, 'Тренировка: низ', false],
    [3, -2, 'Собрать цифры для отчёта', true], [3, -1, 'Сделать графики к отчёту', false], [3, 1, 'Отправить отчёт руководителю', false],
    [0, -12, 'Взвеситься и замерить талию', true], [0, 6, 'Записаться к диетологу', false]
  ];
  for (const [gi, n, title, done] of goalTasks) {
    const day = addDays(today, n);
    tasks.push({ title, day, time: null, done: done && !missed.has(day), prio: false, goal: gi, createdOn: addDays(day, -3) });
  }

  // книги
  const kahn = bookDates[1]!.startedOn ? reading.filter(x => x.book === 1).reduce((a, x) => a + x.pages, 0) : 0;
  const books = [
    { title: 'Мастер и Маргарита', author: 'Михаил Булгаков', pages: 480, currentPage: 480, status: 'done', rating: 5, genre: 'Классика', owned: true, addedOn: addDays(first, -6), startedOn: first, finishedOn: bookDates[0]!.finishedOn ?? addDays(first, 40) },
    { title: 'Думай медленно… решай быстро', author: 'Даниэль Канеман', pages: 656, currentPage: kahn, status: kahn ? 'reading' : 'want', rating: null, genre: 'Психология', owned: true, addedOn: addDays(first, 10), startedOn: bookDates[1]!.startedOn || null, finishedOn: null },
    { title: 'Атомные привычки', author: 'Джеймс Клир', pages: 320, currentPage: 0, status: 'want', rating: null, genre: 'Саморазвитие', owned: false, addedOn: addDays(today, -R.ri(4, 9)), startedOn: null, finishedOn: null }
  ];
  const quotes = [
    { book: 0, text: 'Никогда и ничего не просите! Никогда и ничего, и в особенности у тех, кто сильнее вас.', page: '271' },
    { book: 0, text: 'Рукописи не горят.', page: '287' },
    { book: 0, text: 'Правду говорить легко и приятно.', page: '29' },
    { book: 1, text: 'Ничто в жизни не важно настолько, насколько вам кажется, когда вы об этом думаете.', page: '402' }
  ].filter(q => q.book === 0 || kahn >= 410);

  const habits = [
    { title: 'Медитация 10 минут', icon: '🧘', color: 'orange' },
    { title: 'Витамины', icon: '💊', color: 'steps' },
    { title: 'Без сладкого', icon: '🍫', color: 'books' },
    { title: 'Лечь до 23:30', icon: '🌙', color: 'water' }
  ];
  const gymPlans = [
    { name: 'Верх', weekdays: [1, 5], time: '19:00', exercises: UPPER.map(([key, sets]) => ({ exerciseKey: key, name: ex(key).name, sets })) },
    { name: 'Низ', weekdays: [3], time: '19:00', exercises: LOWER.map(([key, sets]) => ({ exerciseKey: key, name: ex(key).name, sets })) }
  ];
  const series = [WEEKDAY_SERIES, SUNDAY_SERIES, PLANTS_SERIES].map(s => ({ title: s.title, time: s.time, rule: s.rule, startOn: first }));
  const material = {
    title: 'SQL: конспект курса', text: Object.values(TOPICS['Программирование']!).map(([t, a, b]) => `## ${t.replace('SQL: ', '')}\n\n- ${a}\n- ${b}`).join('\n\n'),
    questions: QUESTIONS.map(([q, options, correct, explain]) => ({ q, options: [...options], correct, explain })),
    srs: [...srs.entries()].map(([q, s]) => ({ q, ...s }))
  };

  return { first, missed: [...missed].sort(), great: [...great].sort(), meals, drinks, body, tasks, series, goals, sessions, material, answers, workouts, gymPlans, money, books, reading, quotes, habits, checks };
}
export type DemoData = ReturnType<typeof demoData>;
