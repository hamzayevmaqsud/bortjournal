/**
 * Еда по фото или описанию — Google Gemini, те же правила и схема ответа, что в старом журнале.
 * Ключ и адрес читаются при каждом вызове (GEMINI_API_KEY, GEMINI_BASE_URL, GEMINI_MODEL) — тесты подставляют свой сервер.
 * Мягкий дневной лимит на человека, чтобы один не выел общую квоту.
 */
import { gemini } from '../../core/gemini.js';
export { aiEnabled } from '../../core/gemini.js';

const SCALES: Record<string, string> = {
  card: 'Рядом с едой лежит банковская или ID-карта: 85,6 × 54 мм. Используй её как эталон размера.',
  fork: 'Рядом с едой лежит обычная столовая вилка длиной около 19–20 см. Используй её как эталон размера.',
  spoon: 'Рядом с едой лежит столовая ложка длиной около 18–20 см. Используй её как эталон размера.',
  phone: 'Рядом с едой лежит смартфон около 15 × 7 см. Используй его как эталон размера.',
  hand: 'Рядом с едой ладонь взрослого человека: длина ладони без пальцев около 10 см. Используй её как эталон размера.'
};
const PROMPT = `Ты нутрициолог. По фото и/или текстовому описанию оцени, что съедено, и посчитай калории и БЖУ.
Правила:
- Разбей на отдельные позиции: каждый продукт, соус, масло, напиток — отдельной строкой. Названия по-русски, коротко.
- Для каждой позиции: вес порции в граммах и калории, белки, жиры, углеводы на ВСЮ порцию (не на 100 г). Округляй: граммы до 5, ккал до целых, БЖУ до 0,5.
- Также на всю порцию: fiber — пищевые волокна (клетчатка), г; sugar — сахара всего, г; salt — соль, г (натрий × 2,5). Округляй до 0,5.
- Если фото нет, считай только по описанию. Если вес не указан, бери типичную порцию для этого блюда и confidence = "medium".
- Размер порции оценивай по эталону, если он указан, иначе по тарелке (обычно 24–27 см), приборам и упаковке.
- Если пользователь в подписи указал вес или состав, это главнее твоей оценки: бери его цифры, source = "user".
- Если на фото видна этикетка с пищевой ценностью, считай по ней, source = "label". Иначе source = "estimate".
- Учитывай скрытые калории: масло при жарке, заправки, соусы. Если они вероятны, но не видны, добавь их отдельной позицией с confidence = "low".
- confidence: "high" — продукт и вес очевидны, "medium" — продукт ясен, вес примерный, "low" — догадка.
- questions: до 3 уточнений, только если ответ меняет итог больше чем на 15% (например, «на чём жарили?», «майонез обычный или лёгкий?»). У каждого 2–4 коротких варианта ответа. Если всё ясно — пустой массив.
- Если на фото нет еды, is_food = false и пустой items.
- comment: одно короткое предложение по-русски — что учтено или в чём главная неопределённость.`;
const SCHEMA = {
  type: 'OBJECT',
  properties: {
    is_food: { type: 'BOOLEAN' },
    items: { type: 'ARRAY', items: { type: 'OBJECT', properties: {
      name: { type: 'STRING' }, grams: { type: 'NUMBER' }, kcal: { type: 'NUMBER' },
      protein: { type: 'NUMBER' }, fat: { type: 'NUMBER' }, carbs: { type: 'NUMBER' },
      fiber: { type: 'NUMBER' }, sugar: { type: 'NUMBER' }, salt: { type: 'NUMBER' },
      confidence: { type: 'STRING', enum: ['high', 'medium', 'low'] },
      source: { type: 'STRING', enum: ['estimate', 'label', 'user'] }
    }, required: ['name', 'grams', 'kcal', 'protein', 'fat', 'carbs', 'fiber', 'sugar', 'salt', 'confidence', 'source'] } },
    questions: { type: 'ARRAY', items: { type: 'OBJECT', properties: { text: { type: 'STRING' }, options: { type: 'ARRAY', items: { type: 'STRING' } } }, required: ['text', 'options'] } },
    comment: { type: 'STRING' }
  },
  required: ['is_food', 'items', 'questions', 'comment']
};

export interface AiItem { name: string; grams: number; kcal: number; protein: number; fat: number; carbs: number; fiber: number; sugar: number; salt: number; confidence: 'high' | 'medium' | 'low'; source: 'estimate' | 'label' | 'user' }
export interface AiResult { isFood: boolean; items: AiItem[]; questions: Array<{ text: string; options: string[] }>; comment: string }
export interface AiInput { image: string | null; mime: string; note: string; scale: string; answers: string[] }

const clamp = (v: unknown, max: number) => Math.max(0, Math.min(max, Math.round((Number(v) || 0) * 2) / 2));

// счётчик на человека за сутки (в памяти процесса — для мягкого лимита этого достаточно)
const used = new Map<string, number>();
export function takeQuota(userId: string, day: string) {
  for (const k of used.keys()) if (!k.endsWith(day)) used.delete(k);
  const k = `${userId}:${day}`, n = (used.get(k) ?? 0) + 1; used.set(k, n);
  return n <= Number(process.env.PHOTO_DAILY_LIMIT ?? 60);
}

export async function recognizeFood({ image, mime, note, scale, answers }: AiInput): Promise<AiResult> {
  const text = [PROMPT, SCALES[scale] ?? 'Эталона размера в кадре нет.', image ? '' : 'Фото нет — только текстовое описание.',
    note ? `${image ? 'Подпись пользователя' : 'Описание еды от пользователя'}: ${note}` : '',
    answers.length ? `Ответы пользователя на уточнения:\n${answers.map(a => `- ${a}`).join('\n')}` : ''].filter(Boolean).join('\n\n');
  const out = await gemini(image ? [{ inline_data: { mime_type: mime, data: image } }, { text }] : [{ text }], SCHEMA);
  const items: AiItem[] = (Array.isArray(out?.items) ? out.items : []).slice(0, 20).map((it: any) => ({
    name: String(it.name || 'Без названия').slice(0, 80), grams: clamp(it.grams, 3000), kcal: Math.round(clamp(it.kcal, 6000)),
    protein: clamp(it.protein, 500), fat: clamp(it.fat, 500), carbs: clamp(it.carbs, 1000), fiber: clamp(it.fiber, 200), sugar: clamp(it.sugar, 500), salt: clamp(it.salt, 50),
    confidence: ['high', 'medium', 'low'].includes(it.confidence) ? it.confidence : 'medium', source: ['estimate', 'label', 'user'].includes(it.source) ? it.source : 'estimate'
  }));
  const questions = (Array.isArray(out?.questions) ? out.questions : []).slice(0, 3)
    .map((q: any) => ({ text: String(q.text || '').slice(0, 160), options: (Array.isArray(q.options) ? q.options : []).slice(0, 4).map((o: unknown) => String(o).slice(0, 60)) }))
    .filter((q: { text: string; options: string[] }) => q.text && q.options.length);
  return { isFood: out?.is_food !== false && items.length > 0, items, questions, comment: String(out?.comment || '').slice(0, 300) };
}
