// Рекомендованные лимиты: выбирается дата, до которой они будут действовать, траты за последние 90 дней
// уходят в GigaChat, предложенные лимиты можно поправить или снять галочку, и только потом они применяются.
// Предложение хранится на устройстве, пока его явно не применят или не отменят.
import { ref, reactive, computed, watch, onMounted, onBeforeUnmount } from 'vue';
import { api } from '../api.js?v=2610312124';
import { state, saveCategoryLimits, ADVICE_KEY, toast } from '../store.js?v=2610312124';
import { isoDate, parseIso, today, rub, money, parseAmount, amountToInput } from '../utils.js?v=2610312124';
import { categoryTree, categoryLabel, groupLabel } from '../categories.js?v=2610312124';
import { expanded, toggleIn } from '../ui-state.js?v=2610312124';
import { Icon } from '../components.js?v=2610312124';

const DAYS = 90;
const WINDOW_DAYS = 30; // для расчёта период делится на три отрезка: так виден разовый всплеск
const LATE_IN_MONTH_DAYS = 14; // когда до конца месяца осталось меньше, срок по умолчанию — конец следующего

const shiftDays = (iso, n) => { const d = parseIso(iso); d.setDate(d.getDate() + n); return isoDate(d); };
const shortDate = (iso) => parseIso(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }).replace('.', '');
const daysBetween = (from, until) => Math.round((parseIso(until) - parseIso(from)) / 86400000) + 1;

function defaultUntil() {
  const now = parseIso(today());
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const late = monthEnd.getDate() - now.getDate() < LATE_IN_MONTH_DAYS;
  return isoDate(late ? new Date(now.getFullYear(), now.getMonth() + 2, 0) : monthEnd);
}

// Предложение старой версии (без срока) не подходит: суммы в нём посчитаны на месяц.
function readAdvice() {
  try {
    const saved = JSON.parse(localStorage.getItem(ADVICE_KEY));
    return saved?.userId === state.me?.user_id && saved.until ? saved : null;
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

async function requestAdvice(until) {
  const stats = await collectStats();
  const spent = stats.categories.filter((c) => c.average > 0);
  if (!spent.length) throw new Error(`За последние ${DAYS} дней нет расходов, рассчитывать пока не из чего`);
  // Суммы заранее пересчитаны на выбранный срок: тогда и лимиты, и пояснения GigaChat сразу на него.
  const since = today(), days = daysBetween(since, until);
  const forTerm = (v) => Math.round((v * days) / WINDOW_DAYS);
  const { limits } = await api.adviseLimits({
    advise: spent.map((c) => ({ id: c.category.id, name: c.fullName, months: c.values.map(forTerm), average: forTerm(c.average) })),
    income: forTerm(stats.income), months: stats.labels, today: since,
  });
  const advice = Object.fromEntries(limits.map((l) => [l.id, l]));
  const saved = {
    userId: state.me.user_id, from: stats.from, to: stats.to, since, until, days, income: forTerm(stats.income),
    // Что GigaChat не предложил, остаётся с текущим лимитом и без галочки.
    rows: stats.categories.map((c) => {
      const a = advice[c.category.id];
      return { id: c.category.id, average: forTerm(c.average), include: !!a, value: amountToInput(a?.limit ?? c.category.monthly_limit), reason: a?.reason ?? '' };
    }),
  };
  writeAdvice(saved);
  return saved;
}

function startRequest(until) {
  inFlight ??= requestAdvice(until).finally(() => { inFlight = null; });
  return inFlight;
}

export const LimitAdvisor = {
  components: { Icon },
  emits: ['close'],
  setup(props, { emit }) {
    const busy = ref(false);
    const saving = ref(false);
    const error = ref('');
    const rows = ref([]);
    const advice = ref(null);
    const until = ref(defaultUntil());
    const minDate = today();
    const maxDate = shiftDays(minDate, 366);
    const untilDays = computed(() => (until.value >= minDate ? daysBetween(minDate, until.value) : 0));
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
        .map((r) => reactive(r));
    }

    // Предложение идёт в том же порядке и с теми же разделами, что и категории.
    const sections = computed(() => {
      const t = tree.value, byId = new Map(rows.value.map((r) => [r.id, r]));
      const pick = (items) => items.map((c) => byId.get(c.id)).filter(Boolean);
      return [
        ...t.sections.map((s) => ({ id: s.group.id, label: groupLabel(t, s.group), rows: pick(s.items) })),
        { id: 'loose', label: 'Без раздела', rows: pick(t.loose) },
      ].filter((s) => s.rows.length);
    });
    const openSections = expanded.adviceSections;
    const toggleSection = (id) => toggleIn(openSections, id);
    const checkedIn = (list) => list.filter((r) => r.include);

    async function load() {
      busy.value = true;
      error.value = '';
      try {
        const saved = await startRequest(until.value);
        if (mounted) show(saved);
      } catch (e) {
        if (mounted) error.value = e.message;
        else toast(e.message, 'error');
      } finally {
        busy.value = false;
      }
    }

    function calculate() {
      if (!(until.value >= minDate && until.value <= maxDate)) return (error.value = 'Выберите дату от сегодняшнего дня и не дальше чем через год');
      load();
    }

    onMounted(() => {
      const saved = !inFlight && readAdvice();
      if (saved) show(saved);
      else if (inFlight) load();
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
      const { since, until: end } = advice.value;
      if (end < today()) return (error.value = `Срок этого предложения закончился ${shortDate(end)}. Нажмите «Отмена» и рассчитайте заново`);
      const changes = [];
      for (const r of selected.value) {
        const empty = String(r.value).trim() === '';
        const limit = empty ? null : parseAmount(r.value);
        if (!empty && !(limit > 0)) return (error.value = `«${r.category.name}»: лимит должен быть больше нуля или пустым`);
        const c = r.category, current = c.monthly_limit == null ? null : Number(c.monthly_limit);
        if (empty && current !== null) changes.push({ category: c, monthly_limit: null, limit_from: null, limit_until: null });
        if (!empty && (limit !== current || c.limit_from !== since || c.limit_until !== end)) {
          changes.push({ category: c, monthly_limit: limit, limit_from: since, limit_until: end });
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
      spendingOf, sumOf, accName, shortDate, apply, cancel, calculate, rub, money, until, minDate, maxDate, untilDays,
      sections, openSections, toggleSection, checkedIn, DAYS,
    };
  },
  template: `
    <div class="advisor">
      <div v-if="busy" class="advisor-busy" role="status"><span class="spinner" aria-hidden="true"></span> GigaChat считает лимиты…</div>
      <template v-else-if="rows.length">
        <p class="hint"><b>Лимиты на срок {{ shortDate(advice.since) }} — {{ shortDate(advice.until) }} ({{ advice.days }} дн.).</b>
          Предложение GigaChat по расходам за {{ period }}. Нажмите на категорию, чтобы увидеть траты.
          Поправьте суммы или снимите галочки: применятся только отмеченные. Пустое поле снимает лимит. Предложение сохранится, пока вы его не примените или не отмените.</p>
        <div v-for="s in sections" :key="s.id" class="section">
          <div class="section-head">
            <button type="button" class="section-toggle" :aria-expanded="openSections.has(s.id)" @click="toggleSection(s.id)">
              <icon name="down" :class="['chev', { closed: !openSections.has(s.id) }]" :size="18"/>
              <span class="section-text">
                <span class="section-title">{{ s.label }} <span class="group-count">{{ checkedIn(s.rows).length }}/{{ s.rows.length }}</span></span>
              </span>
            </button>
          </div>
          <template v-if="openSections.has(s.id)">
            <div v-for="r in s.rows" :key="r.id" :class="['advice-item', { off: !r.include }]">
              <div class="advice-row">
                <label class="check"><input type="checkbox" v-model="r.include" :aria-label="'Применить лимит: ' + r.category.name"></label>
                <button type="button" class="advice-text" :aria-expanded="openId === r.id" @click="toggle(r.id)">
                  <b>{{ r.category.icon }} {{ label(r.category) }}</b>
                  <small>обычно {{ rub(r.average) }} за {{ advice.days }} дн.<template v-if="r.category.monthly_limit"> · сейчас {{ rub(r.category.monthly_limit) }}</template></small>
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
          </template>
        </div>
        <p class="hint advice-total">Сумма отмеченных лимитов: <b>{{ rub(total) }}</b><template v-if="advice.income"> · обычный доход за такой срок {{ rub(advice.income) }}</template></p>
      </template>
      <form v-else id="advice-date" class="stack" @submit.prevent="calculate">
        <label class="field"><span>Установить лимиты до</span>
          <input v-model="until" type="date" :min="minDate" :max="maxDate" required></label>
        <p class="hint">Лимиты начнут действовать сегодня и будут считать траты до этой даты включительно<template v-if="untilDays">: {{ untilDays }} дн.</template>
          GigaChat рассчитает суммы на весь срок по расходам за последние {{ DAYS }} дней.</p>
      </form>
      <p v-if="error" class="form-error" role="alert">{{ error }}</p>
      <div v-if="!busy" class="btn-row advisor-actions">
        <button type="button" class="btn ghost" :disabled="saving" @click="cancel">Отмена</button>
        <button v-if="!rows.length" type="submit" form="advice-date" class="btn primary">Рассчитать</button>
        <button v-else type="button" class="btn primary" :disabled="saving || !selected.length || !!state.offline" @click="apply">
          {{ saving ? 'Применяю…' : 'Применить лимиты: ' + selected.length }}</button>
      </div>
    </div>`,
};
