/**
 * Задачи дня: галочка рисуется, текст зачёркивается на месте, а через мгновение
 * сделанная задача плавно переезжает вниз (FLIP с пружиной). Порядок держит сам компонент.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Task } from '../lib/api';
import { buzz, spring } from '../lib/motion';
import { Icon } from './Icon';

const sorted = (ts: Task[]) => [...ts].sort((a, b) => Number(a.done) - Number(b.done) || (a.time ?? '99').localeCompare(b.time ?? '99'));

export function Tasks({ tasks, onToggle, onOpen, empty = 'Задач на этот день нет. Поставить можно в «Планах».' }: { tasks: Task[]; onToggle: (id: string) => void; onOpen?: (id: string) => void; empty?: string }) {
  const box = useRef<HTMLDivElement>(null), prev = useRef(new Map<string, number>());
  const [order, setOrder] = useState(() => sorted(tasks).map(t => t.id));
  const byId = new Map(tasks.map(t => [t.id, t]));

  // новые или удалённые задачи — порядок сразу; смена «сделано» — с паузой, чтобы галочка успела нарисоваться
  useEffect(() => {
    const want = sorted(tasks).map(t => t.id);
    const sameSet = want.length === order.length && want.every(id => order.includes(id));
    if (!sameSet) { setOrder(want); return; }
    if (want.join() === order.join()) return;
    const id = setTimeout(() => {
      const m = new Map<string, number>();
      for (const n of Array.from(box.current?.children ?? []) as HTMLElement[]) m.set(n.dataset.id!, n.getBoundingClientRect().top);
      prev.current = m; setOrder(want);
    }, 420);
    return () => clearTimeout(id);
  }, [tasks]); // eslint-disable-line react-hooks/exhaustive-deps

  useLayoutEffect(() => {
    const el = box.current; if (!el || !prev.current.size) return;
    for (const n of Array.from(el.children) as HTMLElement[]) {
      const was = prev.current.get(n.dataset.id!), top = n.getBoundingClientRect().top;
      if (was !== undefined && Math.abs(was - top) > 1) spring(was - top, 0, y => { n.style.transform = `translateY(${y}px)`; }, { stiffness: 320, damping: 28 });
    }
    prev.current = new Map();
  }, [order]);

  if (!tasks.length) return <p className="hint" style={{ textAlign: 'left', margin: 2 }}>{empty}</p>;
  return <div className="tasks" ref={box}>
    {order.map(id => byId.get(id)).filter((t): t is Task => !!t).map(t => <div key={t.id} data-id={t.id} className={`task ${t.done ? 'done' : ''}`}>
      <button className="cbx" aria-label={t.done ? 'Вернуть' : 'Сделано'} aria-pressed={t.done} onClick={() => { buzz(t.done ? 8 : [10, 30, 10]); onToggle(t.id); }}><Icon name="check" className="" /></button>
      <span className="tt" onClick={() => onOpen?.(t.id)} style={onOpen ? { cursor: 'pointer' } : undefined}>{t.prio && <b className="prio">!</b>}{t.title}{t.repeat && <Icon name="repeat" className="ic rep" />}</span>
      {t.time && <span className="meta">{t.time}</span>}
    </div>)}
  </div>;
}
