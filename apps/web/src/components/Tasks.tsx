/**
 * Задачи дня: галочка рисуется, текст зачёркивается на месте, а через мгновение
 * сделанная задача плавно переезжает вниз (FLIP с пружиной). Порядок держит сам компонент.
 * Подзадачи (parentId) — деревом под своей задачей: «2/4», раскрыть-свернуть, «+» — добавить подзадачу (onAddSub).
 */
import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import type { Task } from '../lib/api';
import { buzz, spring } from '../lib/motion';
import { celebrate } from '../lib/look';
import { Icon } from './Icon';

const sorted = (ts: Task[]) => [...ts].sort((a, b) => Number(a.done) - Number(b.done) || (a.time ?? '99').localeCompare(b.time ?? '99'));

/** draggable — задачу можно перетащить мышью на другой день (в «Планах»): id уходит в dataTransfer как text/x-task */
export function Tasks({ tasks: all, onToggle, onOpen, onAddSub, draggable, empty = 'Задач на этот день нет. Поставить можно в «Планах».' }: { tasks: Task[]; onToggle: (id: string) => void; onOpen?: (id: string) => void; onAddSub?: (parentId: string, title: string) => Promise<void> | void; draggable?: boolean; empty?: string }) {
  const box = useRef<HTMLDivElement>(null), prev = useRef(new Map<string, number>());
  // верхний уровень — задачи без родителя в этом списке; подзадачи — по родителю
  const ids = new Set(all.map(t => t.id)), tasks = all.filter(t => !t.parentId || !ids.has(t.parentId));
  const kids = new Map<string, Task[]>(); for (const t of all) if (t.parentId && ids.has(t.parentId)) kids.set(t.parentId, [...(kids.get(t.parentId) ?? []), t]);
  const [open, setOpen] = useState<Set<string>>(() => new Set()), [adding, setAdding] = useState<string | null>(null), [subTitle, setSubTitle] = useState('');
  const [order, setOrder] = useState(() => sorted(tasks).map(t => t.id));
  const byId = new Map(tasks.map(t => [t.id, t]));
  const toggleOpen = (id: string) => setOpen(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const addSub = async (e: FormEvent, parent: string) => { e.preventDefault(); const t = subTitle.trim(); if (!t || !onAddSub) return; await onAddSub(parent, t); setSubTitle(''); setOpen(s => new Set(s).add(parent)); };

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
  const row = (t: Task, depth: number) => {
    const ch = sorted(kids.get(t.id) ?? []), sub = ch.length ? { n: ch.length, done: ch.filter(c => c.done).length } : t.sub, isOpen = open.has(t.id) || adding === t.id;
    return <div key={t.id} data-id={depth ? undefined : t.id} className="task-wrap">
      <div className={`task ${t.done ? 'done' : ''} ${depth ? 'sub' : ''}`} style={depth ? { ['--d' as string]: depth } : undefined} draggable={draggable && !depth}
        onDragStart={draggable && !depth ? e => { e.dataTransfer.setData('text/x-task', t.id); e.dataTransfer.effectAllowed = 'move'; e.currentTarget.classList.add('dragging'); } : undefined} onDragEnd={draggable && !depth ? e => e.currentTarget.classList.remove('dragging') : undefined}>
        <button className="cbx" aria-label={`${t.done ? 'Вернуть' : 'Сделано'}: ${t.title}`} aria-pressed={t.done} onClick={e => { buzz(t.done ? 8 : [10, 30, 10]); if (!t.done) celebrate(e.currentTarget); onToggle(t.id); }}><Icon name="check" className="" /></button>
        <span className="tt" onClick={() => onOpen?.(t.id)} style={onOpen ? { cursor: 'pointer' } : undefined}
          role={onOpen ? 'button' : undefined} tabIndex={onOpen ? 0 : undefined} onKeyDown={onOpen ? e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(t.id); } } : undefined}>{t.prio && <b className="prio">!</b>}{t.title}{t.repeat && <Icon name="repeat" className="ic rep" />}</span>
        {sub && sub.n > 0 && (ch.length
          ? <button type="button" className={`sub-n ${sub.done === sub.n ? 'all' : ''}`} onClick={() => toggleOpen(t.id)} aria-expanded={isOpen} aria-label={`Подзадачи: ${sub.done} из ${sub.n}`}>{sub.done}/{sub.n}<Icon name="chev" className={`ic ${isOpen ? 'up' : ''}`} /></button>
          : <span className={`sub-n ${sub.done === sub.n ? 'all' : ''}`} title="Подзадачи — в «Планах»">{sub.done}/{sub.n}</span>)}
        {t.time && <span className="meta">{t.time}</span>}
        {onAddSub && depth < 4 && !t.done && <button type="button" className="sub-add" onClick={() => { setAdding(adding === t.id ? null : t.id); setSubTitle(''); }} aria-label={`Подзадача к «${t.title}»`} title="Добавить подзадачу"><Icon name="plus" /></button>}
      </div>
      {isOpen && <div className="subs">
        {ch.map(c => row(c, depth + 1))}
        {adding === t.id && <form className="sub-form" style={{ ['--d' as string]: depth + 1 }} onSubmit={e => addSub(e, t.id)}>
          <input className="in" autoFocus value={subTitle} onChange={e => setSubTitle(e.target.value)} placeholder="Подзадача…" aria-label={`Новая подзадача к «${t.title}»`} onKeyDown={e => { if (e.key === 'Escape') setAdding(null); }} />
          <button className="primary" disabled={!subTitle.trim()} aria-label="Добавить подзадачу"><Icon name="plus" /></button>
        </form>}
      </div>}
    </div>;
  };
  return <div className="tasks" ref={box}>
    {order.map(id => byId.get(id)).filter((t): t is Task => !!t).map(t => row(t, 0))}
  </div>;
}
