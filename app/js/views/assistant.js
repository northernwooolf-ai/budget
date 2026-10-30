// Помощник: вопросы о бюджете обычными словами. Отвечает GigaChat по сводке данных,
// которую приложение собирает здесь же: остатки, кэшбэки, итоги по категориям за 13 месяцев
// и операции последних двух месяцев. Готовые итоги считаем сами — модели плохо даётся сложение.
import { ref, reactive, nextTick, onBeforeUnmount } from 'vue';
import { api } from '../api.js?v=2610301506';
import { state } from '../store.js?v=2610301506';
import { isoDate, addMonths, monthStart, today, bySort } from '../utils.js?v=2610301506';
import { ACCOUNT_TYPES, typeOf, creditState } from '../account-types.js?v=2610301506';
import { Icon, Modal } from '../components.js?v=2610301506';
import { speechSupported, listen } from '../speech.js?v=2610301506';

const HISTORY_MONTHS = 13;  // текущий месяц и 12 предыдущих — хватит на «за год» в любом смысле
const RECENT_DAYS = 60;     // операции целиком — только за последние дни
const RECENT_LIMIT = 250;

const KINDS = { expense: 'расход', income: 'доход', transfer: 'перевод' };
const n = (v) => Math.round(Number(v) || 0);

async function buildContext() {
  const start = addMonths(monthStart(new Date()), -(HISTORY_MONTHS - 1));
  const rows = await api.listTransactions(isoDate(start), isoDate(addMonths(monthStart(new Date()), 1)));
  const year = String(new Date().getFullYear());
  const months = Array.from({ length: HISTORY_MONTHS }, (_, i) => isoDate(addMonths(start, i)).slice(0, 7));
  const accounts = state.accounts.filter((a) => !a.archived);
  const accName = Object.fromEntries(state.accounts.map((a) => [a.id, a.name]));
  const catById = Object.fromEntries(state.categories.map((c) => [c.id, c]));
  const groupName = Object.fromEntries(state.categoryGroups.map((g) => [g.id, g.name]));
  const who = Object.fromEntries(state.members.map((m) => [m.user_id, m.display_name]));
  const catTitle = (c) => (c ? (groupName[c.group_id] ? `${groupName[c.group_id]} / ${c.name}` : c.name) : 'Без категории');
  const lines = [];

  lines.push(`Спрашивает: ${state.me.display_name}. Участники бюджета: ${state.members.map((m) => m.display_name).join(', ')}.`);

  lines.push('', 'СЧЕТА, остаток сейчас:');
  let available = 0;
  for (const t of ACCOUNT_TYPES) {
    for (const a of accounts.filter((x) => typeOf(x).id === t.id).sort(bySort)) {
      const b = state.balances[a.id] ?? Number(a.initial_balance);
      if (t.id === 'cash' || t.id === 'debit') available += b;
      if (a.type === 'credit' && Number(a.credit_limit)) {
        const c = creditState(a, b);
        lines.push(`- ${a.name} (${t.label}): долг ${n(c.debt)} ₽, можно снять ещё ${n(c.available)} ₽, кредитный лимит ${n(c.limit)} ₽`);
        continue;
      }
      lines.push(`- ${a.name} (${t.label}${a.liquid ? ', ликвидный: можно снять в любой день' : ''}): ${n(b)} ₽`);
    }
  }
  lines.push(`Доступные деньги (наличные + дебетовые карты): ${n(available)} ₽`);

  lines.push('', 'КЭШБЭКИ в этом месяце (карта: категория банка — процент; в скобках — категории приложения):');
  const active = new Set(accounts.map((a) => a.id));
  const cashbacks = state.cashbacks.filter((c) => active.has(c.account_id));
  if (!cashbacks.length) lines.push('- не указаны');
  for (const c of cashbacks) {
    const cats = (c.category_ids ?? []).map((id) => catById[id]?.name).filter(Boolean);
    lines.push(`- ${accName[c.account_id]}: ${c.label} — ${Number(c.percent)}%${cats.length ? ` (${cats.join(', ')})` : ''}`);
  }

  // Итоги: по категориям, по разделам, по месяцам и по людям.
  const sums = { category: new Map(), group: new Map(), month: new Map(), person: new Map() };
  const add = (map, key, month, value) => {
    if (!map.has(key)) map.set(key, {});
    const row = map.get(key);
    row[month] = (row[month] ?? 0) + value;
  };
  for (const t of rows) {
    if (t.kind === 'transfer') continue;
    const m = t.date.slice(0, 7), v = Number(t.amount), c = catById[t.category_id];
    add(sums.category, `${t.kind}|${catTitle(c)}`, m, v);
    if (c && groupName[c.group_id]) add(sums.group, `${t.kind}|${groupName[c.group_id]}`, m, v);
    add(sums.month, t.kind, m, v);
    if (t.kind === 'expense') add(sums.person, who[t.spent_by ?? t.created_by] ?? '?', m, v);
  }
  const series = (row) => {
    const parts = months.filter((m) => row[m]).map((m) => `${m}: ${n(row[m])}`);
    const total = months.reduce((s, m) => s + (row[m] ?? 0), 0);
    const ytd = months.filter((m) => m.startsWith(year)).reduce((s, m) => s + (row[m] ?? 0), 0);
    return `${parts.join('; ')} | итого за ${HISTORY_MONTHS} мес.: ${n(total)}; с начала ${year} года: ${n(ytd)}`;
  };
  const block = (title, map, kind) => {
    const keys = [...map.keys()].filter((k) => k.startsWith(kind + '|')).sort();
    if (!keys.length) return;
    lines.push('', title);
    for (const k of keys) lines.push(`- ${k.slice(kind.length + 1)}: ${series(map.get(k))}`);
  };

  lines.push('', `Периоды: месяцы с ${months[0]} по ${months.at(-1)} (текущий месяц ещё не закончился). Суммы в рублях.`);
  lines.push('', 'ВСЕГО ПО МЕСЯЦАМ:');
  lines.push(`- Расходы: ${series(sums.month.get('expense') ?? {})}`);
  lines.push(`- Доходы: ${series(sums.month.get('income') ?? {})}`);
  block('РАСХОДЫ ПО РАЗДЕЛАМ:', sums.group, 'expense');
  block('РАСХОДЫ ПО КАТЕГОРИЯМ (раздел / категория):', sums.category, 'expense');
  block('ДОХОДЫ ПО КАТЕГОРИЯМ:', sums.category, 'income');
  if (sums.person.size) {
    lines.push('', 'РАСХОДЫ ПО ЛЮДЯМ (кто потратил):');
    for (const [name, row] of sums.person) lines.push(`- ${name}: ${series(row)}`);
  }

  const since = new Date(); since.setDate(since.getDate() - RECENT_DAYS);
  const recent = rows.filter((t) => t.date >= isoDate(since))
    .sort((a, b) => b.date.localeCompare(a.date)).slice(0, RECENT_LIMIT);
  lines.push('', `ОПЕРАЦИИ за последние ${RECENT_DAYS} дней (дата | вид | сумма | категория | счёт | кто | комментарий):`);
  for (const t of recent) {
    const acc = t.kind === 'transfer' ? `${accName[t.account_id]} → ${accName[t.to_account_id]}` : accName[t.account_id];
    lines.push([t.date, KINDS[t.kind], n(t.amount), t.kind === 'transfer' ? '' : catTitle(catById[t.category_id]),
      acc, who[t.spent_by ?? t.created_by] ?? '', t.note ?? ''].join(' | '));
  }
  return lines.join('\n');
}

// Переписка живёт, пока приложение открыто: можно закрыть окно и вернуться к разговору.
const messages = reactive([]);
let context = null; // { version, text } — сводка пересобирается, когда данные изменились

const SUGGESTIONS = [
  'Хочу купить цветы — какой картой выгоднее?',
  'Сколько мы потратили на еду за год?',
  'На что ушло больше всего денег в этом месяце?',
  'Сколько денег сейчас доступно?',
];

export const AssistantChat = {
  components: { Icon, Modal },
  emits: ['close'],
  setup() {
    const draft = ref('');
    const busy = ref(false);
    const error = ref('');
    const end = ref(null);
    const scrollDown = () => nextTick(() => end.value?.scrollIntoView({ block: 'end', behavior: 'smooth' }));

    async function send(text = draft.value) {
      const q = text.trim();
      if (!q || busy.value) return;
      draft.value = '';
      error.value = '';
      messages.push({ role: 'user', content: q });
      busy.value = true;
      scrollDown();
      try {
        if (context?.version !== state.dataVersion) context = { version: state.dataVersion, text: await buildContext() };
        const { answer } = await api.ask({ chat: messages.slice(-12), context: context.text, today: today() });
        messages.push({ role: 'assistant', content: answer || 'GigaChat ничего не ответил, попробуйте спросить иначе' });
      } catch (e) {
        messages.pop();
        draft.value = q;
        error.value = e.message;
      } finally {
        busy.value = false;
        scrollDown();
      }
    }

    // Вопрос голосом: сказали — сразу отправили.
    const listening = ref(false);
    let stop = null;
    function toggleMic() {
      if (listening.value) return stop?.();
      error.value = '';
      listening.value = true;
      stop = listen({
        onText: (text) => { draft.value = text; },
        onEnd: (err) => {
          listening.value = false;
          stop = null;
          if (err) error.value = err;
          else send();
        },
      });
    }
    onBeforeUnmount(() => stop?.());

    const clear = () => { messages.splice(0); error.value = ''; };
    scrollDown();

    return { messages, draft, busy, error, end, send, clear, listening, toggleMic, speechSupported, SUGGESTIONS };
  },
  template: `
    <modal title="Помощник" class="chat-modal" @close="$emit('close')">
      <div class="chat" aria-live="polite">
        <div v-if="!messages.length" class="stack">
          <p class="hint">Спросите что угодно о вашем бюджете: остатки, траты по категориям за год, какой картой платить.
            Отвечает GigaChat по сводке ваших данных.</p>
          <div class="chat-suggest">
            <button v-for="q in SUGGESTIONS" :key="q" type="button" class="chip" @click="send(q)">{{ q }}</button>
          </div>
        </div>
        <div v-for="(m, i) in messages" :key="i" :class="['bubble', m.role]">{{ m.content }}</div>
        <div v-if="busy" class="bubble assistant typing"><span class="spinner" aria-hidden="true"></span> Думаю…</div>
        <p v-if="error" class="form-error" role="alert">{{ error }}</p>
        <button v-if="messages.length && !busy" type="button" class="btn ghost small chat-clear" @click="clear">Новый разговор</button>
        <div ref="end"></div>
      </div>
      <template #footer>
        <form class="chat-form" @submit.prevent="send()">
          <button v-if="speechSupported" type="button" :class="['icon-btn', 'mic-btn', { listening }]"
            :aria-label="listening ? 'Остановить запись' : 'Спросить голосом'" @click="toggleMic">{{ listening ? '🔴' : '🎙️' }}</button>
          <input v-model="draft" maxlength="500" placeholder="Ваш вопрос" aria-label="Вопрос" :readonly="listening">
          <button class="btn primary" :disabled="busy || !draft.trim()" aria-label="Отправить"><icon name="arrow"/></button>
        </form>
      </template>
    </modal>`,
};
