/**
 * Если экран упал с ошибкой — падает только он: вместо белого экрана сообщение и «Написать разработчику».
 * Ошибка уходит отзывом сама (с названием экрана), чтобы её можно было найти в админке.
 */
import { Component, type ReactNode } from 'react';
import { api } from '../lib/api';
import { VERSION } from './Feedback';

export class Boundary extends Component<{ name: string; children: ReactNode; onFeedback?: () => void }, { err: Error | null }> {
  state = { err: null as Error | null };
  static getDerivedStateFromError(err: Error) { return { err }; }
  componentDidCatch(err: Error) {
    void api('/api/feedback', { method: 'POST', body: { text: `Автоотчёт: экран «${this.props.name}» упал.\n${String(err?.message ?? err).slice(0, 500)}\n${String(err?.stack ?? '').split('\n').slice(0, 4).join('\n')}`, screen: this.props.name, version: VERSION } }).catch(() => {});
  }
  render() {
    if (!this.state.err) return this.props.children;
    return <div className="crash"><h2>Этот экран сломался</h2><p>Мы уже получили отчёт об ошибке. Остальной журнал работает — открой другой раздел.</p>
      <div className="row-flex"><button className="btn-accent" onClick={() => this.setState({ err: null })}>Попробовать ещё раз</button>{this.props.onFeedback && <button className="btn-accent" onClick={this.props.onFeedback}>Написать разработчику</button>}</div></div>;
  }
}
