/** Разбор «когда» из текста задачи: день, время и чистое название */
import { describe, expect, it } from 'vitest';
import { parseWhen } from '@bortjournal/core';

const T = '2026-10-26'; // понедельник
describe('parseWhen', () => {
  it('завтра в 19:00', () => expect(parseWhen('Позвонить маме завтра в 19:00', T)).toEqual({ title: 'Позвонить маме', day: '2026-10-27', time: '19:00' }));
  it('в 7 вечера и 9 утра', () => {
    expect(parseWhen('Зал в 7 вечера', T)).toEqual({ title: 'Зал', day: null, time: '19:00' });
    expect(parseWhen('послезавтра в 9 утра врач', T)).toEqual({ title: 'врач', day: '2026-10-28', time: '09:00' });
  });
  it('дни недели и «через»', () => {
    expect(parseWhen('Сдать отчёт в пятницу', T)).toMatchObject({ title: 'Сдать отчёт', day: '2026-10-30' });
    expect(parseWhen('Купить хлеб в понедельник', T).day).toBe('2026-10-26');
    expect(parseWhen('Позвонить во вторник в 10', T)).toEqual({ title: 'Позвонить', day: '2026-10-27', time: '10:00' });
    expect(parseWhen('Отпуск через неделю', T)).toMatchObject({ title: 'Отпуск', day: '2026-11-02' });
    expect(parseWhen('Оплатить через 3 дня', T).day).toBe('2026-10-29');
  });
  it('даты', () => {
    expect(parseWhen('День рождения Али 5 ноября', T)).toMatchObject({ title: 'День рождения Али', day: '2026-11-05' });
    expect(parseWhen('Экзамен 10.01 в 9:30', T)).toEqual({ title: 'Экзамен', day: '2027-01-10', time: '09:30' });
    expect(parseWhen('31 февраля что-то', T)).toEqual({ title: '31 февраля что-то', day: null, time: null });
  });
  it('без когда — текст как есть; слова не режутся', () => {
    expect(parseWhen('Прочитать главу 3', T)).toEqual({ title: 'Прочитать главу 3', day: null, time: null });
    expect(parseWhen('Купить продукты в среднем магазине', T)).toEqual({ title: 'Купить продукты в среднем магазине', day: null, time: null });
    expect(parseWhen('Помыть пол', T)).toEqual({ title: 'Помыть пол', day: null, time: null });
    expect(parseWhen('Встреча 25:99', T)).toEqual({ title: 'Встреча 25:99', day: null, time: null });
  });
});

describe('parseWhen: повтор', () => {
  it('каждый день, по будням, по выходным, каждую неделю и месяц', () => {
    expect(parseWhen('Зарядка каждый день в 7 утра', T)).toEqual({ title: 'Зарядка', day: null, time: '07:00', repeat: { kind: 'daily' } });
    expect(parseWhen('Планёрка по будням в 10:00', T)).toMatchObject({ title: 'Планёрка', time: '10:00', repeat: { kind: 'weekdays' } });
    expect(parseWhen('Уборка по выходным', T).repeat).toEqual({ kind: 'days', days: [6, 0] });
    expect(parseWhen('Оплатить интернет каждый месяц', T)).toMatchObject({ title: 'Оплатить интернет', repeat: { kind: 'monthly' } });
    expect(parseWhen('Созвон еженедельно', T).repeat).toEqual({ kind: 'weekly' });
  });
  it('дни недели: каждую пятницу, по понедельникам и средам', () => {
    expect(parseWhen('Бассейн каждую пятницу в 19', T)).toEqual({ title: 'Бассейн', day: null, time: '19:00', repeat: { kind: 'days', days: [5] } });
    expect(parseWhen('Английский по понедельникам и средам', T)).toMatchObject({ title: 'Английский', repeat: { kind: 'days', days: [1, 3] } });
    expect(parseWhen('Зал по вторникам, четвергам и субботам в 18:30', T)).toEqual({ title: 'Зал', day: null, time: '18:30', repeat: { kind: 'days', days: [2, 4, 6] } });
  });
  it('без повтора слова не трогает', () => {
    expect(parseWhen('Купить подарок каждому', T)).toEqual({ title: 'Купить подарок каждому', day: null, time: null });
  });
});
