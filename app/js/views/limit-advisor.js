// Рекомендованные лимиты: траты за последние 90 дней уходят в GigaChat, предложенные лимиты можно
// поправить или снять галочку, и только потом они применяются к категориям.
// Предложение хранится на устройстве, пока его явно не применят или не отменят.
import { ref, reactive, computed, watch, onMounted, onBeforeUnmount } from 'vue';
import { api } from '../api.js?v=2610311858';
import { state, saveCategoryLimits, ADVICE_KEY, toast } from '../store.js?v=2610311858';
import { isoDate, parseIso, today, rub, money, parseAmount, amountToInput, bySort } from '../utils.js?v=2610311858';
import { categoryTree, categoryLabel } from '../categories.js?v=2610311858';

const DAYS = 90;
const WINDOW_DAYS = 30; // для расчёта период делится на три отрезка: так виден разовый всплеск

const shiftDays = (iso, n) => { const d = parseIso(iso); d.setDate(d.getDate() + n); return isoDate(d); };
const shortDate = (iso) => parseIso(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }).replace('.', '');

function readAdvice() {
  try {
    const saved = JSON.parse(localStorage.getItem(ADVICE_KEY));
    return saved?.userId === state.me?.user_id ? saved : null;
  } catch { return null; }
}
function writeAdvice(advice) {
  try { localStorage.setItem(ADVICE_KEY, JSON.stringify(advice)); } catch { /* места нет — предложение останется до закрытия окна */ }
}
function clearAdvice() {
  try { localStorage.removeItem(ADVICE_KEY); } catch { /* хранилище недоступно */ }
}

// Запрос живёт отдельно от экрана: если во время расчёта перейти на другую вкладку, ответ не потеряется.
let inFlight = null;
export const hasAdvice = () => !!inFlight || !!readAdvice();

// Траты по категориям и средний доход. Отрезки совсем без расходов (учёт ещё не вели)
// в среднее не входят, иначе лимиты вышли бы заниженными.
async function collectStats() {
  const end = today(), from = shiftDays(end, -(DAYS - 1)), to = shiftDays(end, 1);
  const tx = await api.listTransactions(from, to);
  const windows = Array.from({ length: DAYS / WINDOW_DAYS }, (_, i) => {
    const start = shiftDays(from, i * WINDOW_DAYS);
    return { start, stop: shiftDays(start, WINDOW_DAYS) };
  });
  const windowOf = (date) => windows.findIndex((w) => date >= w.start && date < w.stop);
  const used = windows.map((w, i) => i).filter((i) => tx.some((t) => t.kind === 'expense' && windowOf(t.date) === i));
  const byCategory = new Map();
  let income = 0;
  for (const t of tx) {
    if (t.kind === 'income') income += Number(t.amount);
    if (t.kind !== 'expense' || !t.category_id) continue;
    if (!byCategory.has(t.category_id)) byCategory.set(t.category_id, {});
    const row = byCategory.get(t.category_id), i = windowOf(t.date);
    row[i] = (row[i] ?? 0) + Number(t.amount);
  }
  const tree = categoryTree('expense');
  const groupName = Object.fromEntries(state.categoryGroups.map((g) => [g.id, g.name]));
  const categories = [...tree.sections.flatMap((s) => s.items), ...tree.loose]
    .filter((c) => byCategory.has(c.id) || c.monthly_limit)
    .map((c) => {
      const row = byCategory.get(c.id) ?? {};
      const values = used.map((i) => Math.round(row[i] ?? 0));
      const average = used.length ? Math.round(values.reduce((a, b) => a + b, 0) / used.length) : 0;
      return { category: c, values, average, fullName: groupName[c.group_id] ? `${groupName[c.group_id]} / ${c.name}` : c.name };
    });
  return {
    from, to, categories,
    labels: used.map((i) => `${windows[i].start} — ${shiftDays(windows[i].stop, -1)}`),
    income: used.length ? Math.round(income / used.length) : 0,
  };
}

async function requestAdvice() {
  const stats = await collectStats();
  const spent = stats.categories.filter((c) => c.average > 0);
  if (!spent.length) throw new Error(`За последние ${DAYS} дней нет расходов, рассчитывать пока не из чего`);
  const { limits } = await api.adviseLimits({
    advise: spent.map((c) => ({ id: c.category.id, name: c.fullName, months: c.values, average: c.average })),
    income: stats.income, months: stats.labels, today: today(),
  });
  const advice = Object.fromEntries(limits.map((l) => [l.id, l]));
  const saved = {
    userId: state.me.user_id, from: stats.from, to: stats.to, income: stats.income,
    // Что GigaChat не предложил, остаётся с текущим лимитом и без галочки.
    rows: stats.categories.map((c) => {
      const a = advice[c.category.id];
      return { id: c.category.id, average: c.average, include: !!a, value: amountToInput(a?.limit ?? c.category.monthly_limit), reason: a?.reason ?? '' };
    }),
  };
  writeAdvice(saved);
  return saved;
}

function startRequest() {
  inFlight ??= requestAdvice().finally(() => { inFlight = null; });
  return inFlight;
}

export const LimitAdvisor = {
  emits: ['close'],
  setup(props, { emit }) {
    const busy = ref(true);
    const saving = ref(false);
    const error = ref('');
    const rows = ref([]);
    const advice = ref(null);
    let mounted = true;
    onBeforeUnmount(() => { mounted = false; });

    const tree = computed(() => categoryTree('expense'));
    const period = computed(() => (advice.value
      ? `${shortDate(advice.value.from)} — ${shortDate(shiftDays(advice.value.to, -1))}` : ''));

    // Категории берём живые: предложение могло полежать, и название или текущий лимит успели поменяться.
    function show(saved) {
      advice.value = saved;
      rows.value = saved.rows
        .map((r) => ({ ...r, category: state.categories.find((c) => c.id === r.id) }))
        .filter((r) => r.category && !r.category.archived)
        .sort((a, b) => bySort(a.category, b.category))
        .map((r) => reactive(r));
    }

    async function load() {
      busy.value = true;
      error.value = '';
      try {
        const saved = await startRequest();
        if (mounted) show(saved);
      } catch (e) {
        if (mounted) error.value = e.message;
        else toast(e.message, 'error');
      } finally {
        busy.value = false;
      }
    }

    onMounted(() => {
      const saved = !inFlight && readAdvice();
      if (saved) {
        show(saved);
        busy.value = false;
      } else load();
    });

    // Правки пользователя тоже сохраняются.
    watch(rows, (list) => {
      if (!advice.value) return;
      writeAdvice({ ...advice.value, rows: list.map(({ id, average, include, value, reason }) => ({ id, average, include, value, reason })) });
    }, { deep: true });

    const selected = computed(() => rows.value.filter((r) => r.include));
    const total = computed(() => selected.value.reduce((s, r) => s + (parseAmount(r.value) || 0), 0));
    const label = (c) => categoryLabel(tree.value, c);

    // Траты, на которых основано предложение: загружаются при первом раскрытии.
    const openId = ref(null);
    const spending = ref(null);
    const spendingError = ref('');
    async function toggle(id) {
      openId.value = openId.value === id ? null : id;
      if (!openId.value || spending.value) return;
      spendingError.value = '';
      try {
        spending.value = (await api.listTransactions(advice.value.from, advice.value.to)).filter((t) => t.kind === 'expense');
      } catch (e) {
        spendingError.value = state.offline ? 'Список трат появится, когда будет связь' : e.message;
      }
    }
    const spendingOf = (id) => (spending.value ?? []).filter((t) => t.category_id === id)
      .sort((a, b) => b.date.localeCompare(a.date) || Number(b.amount) - Number(a.amount));
    const sumOf = (list) => list.reduce((s, t) => s + Number(t.amount), 0);
    const accName = (id) => state.accounts.find((a) => a.id === id)?.name ?? '';

    function cancel() {
      clearAdvice();
      emit('close');
    }

    async function apply() {
      error.value = '';
      const changes = [];
      for (const r of selected.value) {
        const empty = String(r.value).trim() === '';
        const limit = empty ? null : parseAmount(r.value);
        if (!empty && !(limit > 0)) return (error.value = `«${r.category.name}»: лимит должен быть больше нуля или пустым`);
        if (limit !== (r.category.monthly_limit == null ? null : Number(r.category.monthly_limit))) {
          changes.push({ category: r.category, monthly_limit: limit });
        }
      }
      if (!changes.length) return cancel();
      saving.value = true;
      try {
        await saveCategoryLimits(changes);
        cancel();
      } catch { /* показано; предложение остаётся */ } finally { saving.value = false; }
    }

    return {
      state, busy, saving, error, rows, period, advice, selected, total, label, openId, spending, spendingError, toggle,
      spendingOf, sumOf, accName, shortDate, apply, cancel, load, rub, money,
    };
  },
  template: `
    <div class="advisor">
      <div v-if="busy" class="advisor-busy" role="status"><span class="spinner" aria-hidden="true"></span> GigaChat считает лимиты…</div>
      <template v-else-if="rows.length">
        <p class="hint">Предложение GigaChat по расходам за {{ period }}. Нажмите на категорию, чтобы увидеть траты.
          Поправьте суммы или снимите галочки: применятся только отмеченные. Пустое поле снимает лимит. Предложение сохранится, пока вы его не примените или не отмените.</p>
        <div v-for="r in rows" :key="r.id" :class="['advice-item', { off: !r.include }]">
          <div class="advice-row">
            <label class="check"><input type="checkbox" v-model="r.include" :aria-label="'Применить лимит: ' + r.category.name"></label>
            <button type="button" class="advice-text" :aria-expanded="openId === r.id" @click="toggle(r.id)">
              <b>{{ r.category.icon }} {{ label(r.category) }}</b>
              <small>в среднем {{ rub(r.average) }} в месяц<template v-if="r.category.monthly_limit"> · сейчас {{ rub(r.category.monthly_limit) }}</template></small>
              <small v-if="r.reason" class="advice-reason">{{ r.reason }}</small>
            </button>
            <span class="advice-input"><input v-model="r.value" inputmode="decimal" placeholder="Нет" :aria-label="'Лимит: ' + r.category.name"> ₽</span>
          </div>
          <div v-if="openId === r.id" class="advice-spending">
            <p v-if="spendingError" class="form-error">{{ spendingError }}</p>
            <p v-else-if="!spending" class="hint">Загрузка…</p>
            <p v-else-if="!spendingOf(r.id).length" class="hint">За этот период трат нет.</p>
            <template v-else>
              <div v-for="t in spendingOf(r.id)" :key="t.id" class="advice-tx">
                <span class="advice-tx-date">{{ shortDate(t.date) }}</span>
                <span class="advice-tx-main">{{ t.note || accName(t.account_id) }}</span>
                <b>{{ money(t.amount) }}</b>
              </div>
              <div class="advice-tx advice-tx-total"><span>Всего за период: {{ spendingOf(r.id).length }} шт.</span><b>{{ money(sumOf(spendingOf(r.id))) }}</b></div>
            </template>
          </div>
        </div>
        <p class="hint advice-total">Сумма отмеченных лимитов: <b>{{ rub(total) }}</b><template v-if="advice.income"> · средний доход {{ rub(advice.income) }}</template></p>
      </template>
      <p v-if="error" class="form-error" role="alert">{{ error }}</p>
      <div v-if="!busy" class="btn-row advisor-actions">
        <button type="button" class="btn ghost" :disabled="saving" @click="cancel">Отмена</button>
        <button v-if="!rows.length" type="button" class="btn" @click="load">Ещё раз</button>
        <button v-else type="button" class="btn primary" :disabled="saving || !selected.length || !!state.offline" @click="apply">
          {{ saving ? 'Применяю…' : 'Применить лимиты: ' + selected.length }}</button>
      </div>
    </div>`,
};
