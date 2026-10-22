import { useEffect, useRef } from 'react';

/**
 * Быстрое действие раздела по плитке из листа «Записать»: quick — отметка времени нажатия.
 * Действие выполняется один раз на каждое нажатие и только когда раздел загрузил данные (ready).
 */
export function useQuick(quick: number | undefined, ready: boolean, run: () => void) {
  const done = useRef(0);
  useEffect(() => {
    if (!quick || !ready || done.current === quick) return;
    done.current = quick;
    // кадр на отрисовку: поле, которое надо сфокусировать, должно уже быть в DOM
    requestAnimationFrame(() => requestAnimationFrame(run));
  }, [quick, ready]); // eslint-disable-line react-hooks/exhaustive-deps
}
