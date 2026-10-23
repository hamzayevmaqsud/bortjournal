/**
 * Поле пароля с «глазом»: показать или скрыть, что набрано.
 * Нажатие на глаз не забирает фокус у поля — на телефоне клавиатура не прячется и экран не прыгает,
 * поэтому глаз срабатывает с первого касания; курсор остаётся в конце.
 */
import type { InputHTMLAttributes, Ref } from 'react';
import { Icon } from './Icon';

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & { show: boolean; onToggle: () => void; ref?: Ref<HTMLInputElement> };

export function PasswordInput({ show, onToggle, ref, ...input }: Props) {
  return <div className="pw-field">
    <input ref={ref} {...input} type={show ? 'text' : 'password'} />
    <button type="button" className="pw-eye"
      onPointerDown={e => e.preventDefault()} onMouseDown={e => e.preventDefault()}
      onClick={e => { onToggle(); const el = (e.currentTarget.previousElementSibling as HTMLInputElement | null); if (el && document.activeElement === el) requestAnimationFrame(() => { const n = el.value.length; el.setSelectionRange(n, n); }); }}
      aria-label={show ? 'Скрыть пароль' : 'Показать пароль'} aria-pressed={show}><Icon name={show ? 'eyeOff' : 'eye'} /></button>
  </div>;
}
