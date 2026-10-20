/** «Еда»: большое кольцо дня, белки/жиры/углеводы против нормы, приёмы по времени суток */
import type { Drink, FoodDay, Meal, Subscription } from '../lib/api';
import { fmt, fmt1 } from '../lib/format';
import { useNextFrame } from '../lib/motion';
import { BigRing } from '../components/Ring';
import { Icon } from '../components/Icon';

const SLOTS: Array<[string, string]> = [['breakfast', 'Завтрак'], ['lunch', 'Обед'], ['dinner', 'Ужин'], ['snack', 'Перекусы']];
// завтрак 5–11, обед 11–16, ужин 18–22, остальное — перекус (как в старом журнале)
const slotOf = (m: { slot: string | null; time: string | null }) => {
  if (m.slot && SLOTS.some(s => s[0] === m.slot)) return m.slot;
  const h = m.time ? +m.time.slice(0, 2) : 12;
  return h >= 5 && h < 11 ? 'breakfast' : h >= 11 && h < 16 ? 'lunch' : h >= 18 && h < 22 ? 'dinner' : 'snack';
};

function Macro({ name, color, v, norm }: { name: string; color: string; v: number; norm: number }) {
  const w = useNextFrame(Math.min(100, norm ? v / norm * 100 : 0), 0);
  return <div className="macro" style={{ ['--c' as string]: color }}><span>{name}</span><span className="bar"><i style={{ width: `${w}%` }} /></span><span><b>{fmt(v)}</b> / {fmt(norm)} г</span></div>;
}

export function Food({ data, norm, sub, onAddMeal, onMeal, onDrink, onPro }: {
  data: FoodDay | null; norm: { kcal: number; protein: number; fat: number; carbs: number }; sub: Subscription;
  onAddMeal: () => void; onMeal: (m: Meal) => void; onDrink: (d: Drink) => void; onPro: (what: string) => void;
}) {
  if (!data) return <div className="day"><div className="skel" style={{ height: 380 }} /><div className="skel" style={{ height: 160 }} /></div>;
  const t = data.totals, k = norm.kcal, p = norm.protein || Math.round(k * 0.25 / 4);
  const f = norm.fat || Math.round(k * 0.28 / 9), c = norm.carbs || Math.max(0, Math.round((k - p * 4 - f * 9) / 4));
  const left = k - t.kcal, groups = SLOTS.map(([s, n]) => [n, data.meals.filter(m => slotOf(m) === s)] as const).filter(([, ms]) => ms.length);
  return <div className="day food-page">
    <header className="dayhead"><div className="daytitle"><span>сегодня · еда</span><b>{fmt(t.kcal)} из {fmt(k)} ккал</b></div></header>
    <section className="panel hero-food">
      <BigRing value={t.kcal} max={k} color="var(--food)" />
      <p className="left">{left >= 0 ? <>осталось <b>{fmt(left)} ккал</b>{p - t.protein > 0 ? <> и <b>{fmt(p - t.protein)} г белка</b></> : null}</> : <>сверх нормы <b>{fmt(-left)} ккал</b></>}</p>
      <div className="macros">
        <Macro name="Белки" color="var(--water)" v={t.protein} norm={p} />
        <Macro name="Жиры" color="var(--quiz)" v={t.fat} norm={f} />
        <Macro name="Углеводы" color="var(--gym)" v={t.carbs} norm={c} />
      </div>
    </section>
    <section className="panel">
      {groups.length ? groups.map(([name, ms]) => <div className="slot" key={name}>
        <h3>{name} <small>{fmt(ms.reduce((a, m) => a + m.kcal, 0))} ккал</small></h3>
        {ms.map(m => <button className="meal" key={m.id} onClick={() => onMeal(m)}><span className="chip-ic" style={{ ['--c' as string]: 'var(--food)' }}><Icon name="food" /></span>
          <span className="mid"><b>{m.name}</b><small>{m.time ? `${m.time} · ` : ''}Б {fmt(m.protein)} · Ж {fmt(m.fat)} · У {fmt(m.carbs)}</small></span><span className="v">{fmt(m.kcal)}</span></button>)}
      </div>) : <p className="hint" style={{ textAlign: 'left' }}>Сегодня еды ещё нет.</p>}
      <button className="add-row" onClick={onAddMeal}><Icon name="plus" />Приём пищи</button>
      {data.drinks.length > 0 && <div className="slot"><h3>Напитки <small>{fmt1(t.waterMl / 1000)} л воды</small></h3>
        {data.drinks.map(d => <button className="meal" key={d.id} onClick={() => onDrink(d)}><span className="chip-ic" style={{ ['--c' as string]: 'var(--water)' }}><Icon name="drop" /></span>
          <span className="mid"><b>{d.title}</b><small>{d.time ?? ''}</small></span><span className="v">{fmt(d.ml)} мл</span></button>)}</div>}
    </section>
    <div className="rows">
      {([['Фото и описание еды', 'camera', 'сфотографируй тарелку — калории посчитает ИИ'], ['Описание еды', 'edit', 'напиши словами: «гречка 200 г, котлета»'], ['Поиск по базе продуктов', 'search', 'справочник с КБЖУ и твои блюда']] as const).map(([n, ic, h]) => <button key={n} className="row" onClick={() => onPro(n)}>
        <span className="chip-ic" style={{ ['--c' as string]: 'var(--food)' }}><Icon name={ic} /></span><span className="mid"><b>{n}</b><small>{h}</small></span>{!sub.pro ? <span className="lock">PRO</span> : <Icon name="chev" className="ic chev" />}</button>)}
    </div>
  </div>;
}
