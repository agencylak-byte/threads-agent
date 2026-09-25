import { proposed } from '../store';
import { ActionCard } from './ActionCard';

// Очередь одобрения: предложенные черновики → approve / edit / skip / regenerate.

export function Queue() {
  const items = proposed.value;
  const waiting = items.filter((a) => a.status === 'proposed');
  const inFlight = items.filter((a) => a.status !== 'proposed');
  if (!items.length) {
    return (
      <div class="muted">
        Очередь пуста. Соберите посты во вкладке «Сбор», задайте ключ OpenRouter — движок классифицирует авторов и предложит комментарии.
      </div>
    );
  }
  return (
    <div>
      {waiting.map((a) => <ActionCard key={a.id} action={a} />)}
      {inFlight.length > 0 && (
        <details>
          <summary class="small muted">Одобрено и ждёт отправки: {inFlight.length}</summary>
          {inFlight.map((a) => <ActionCard key={a.id} action={a} compact />)}
        </details>
      )}
    </div>
  );
}
