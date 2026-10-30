// Рекомендованные лимиты: траты за три последних полных месяца уходят в GigaChat,
// предложенные лимиты можно поправить или снять галочку, и только потом они применяются к категориям.
import { ref, reactive, computed, onMounted } from 'vue';
import { api } from '../api.js?v=2610301653';
import { state, saveCategoryLimits } from '../store.js?v=2610301653';
import { addMonths, monthStart, isoDate, parseIso, today, rub, parseAmount, amountToInput } from '../utils.js?v=2610301653';
import { categoryTree, categoryLabel } from '../categories.js?v=2610301653';

const MONTHS = 3;

// Траты по категориям и средний доход за полные месяцы. Месяцы совсем без расходов (учёт ещё не вели)
// в среднее не входят, иначе лимиты вышли бы заниженными.
async function collectStats() {
  const to = monthStart(new Date()), from = addMonths(to, -MONTHS);
  const months = Array.from({ length: MONTHS }, (_, i) => isoDate(addMonths(from, i)).slice(0, 7));
  const tx = await api.listTransactions(isoDate(from), isoDate(to));
  const used = months.filter((m) => tx.some((t) => t.kind === 'expense' && t.date.startsWith(m)));
  const byCategory = new Map();
  let income = 0;
  for (const t of tx) {
    if (t.kind === 'income') income += Number(t.amount);
    if (t.kind !== 'expense' || !t.category_id) continue;
    if (!byCategory.has(t.category_id)) byCategory.set(t.category_id, {});
    const row = byCategory.get(t.category_id), m = t.date.slice(0, 7);
    row[m] = (row[m] ?? 0) + Number(t.amount);
  }
  const tree = categoryTree('expense');
  const groupName = Object.fromEntries(state.categoryGroups.map((g) => [g.id, g.name]));
  const categories = [...tree.sections.flatMap((s) => s.items), ...tree.loose]
    .filter((c) => byCategory.has(c.id) || c.monthly_limit)
    .map((c) => {
      const row = byCategory.get(c.id) ?? {};
      const values = used.map((m) => Math.round(row[m] ?? 0));
      const average = used.length ? Math.round(values.reduce((a, b) => a + b, 0) / used.length) : 0;
      return {
        category: c, label: categoryLabel(tree, c), values, average,
        fullName: groupName[c.group_id] ? `${groupName[c.group_id]} / ${c.name}` : c.name,
      };
    });
  return { used, categories, income: used.length ? Math.round(income / used.length) : 0 };
}

export const LimitAdvisor = {
  emits: ['close'],
  setup(props, { emit }) {
    const busy = ref(true);
    const saving = ref(false);
    const error = ref('');
    const rows = ref([]);
    const period = ref('');
    const income = ref(0);

    async function load() {
      busy.value = true;
      error.value = '';
      try {
        const stats = await collectStats();
        if (!stats.categories.some((c) => c.average > 0)) {
          error.value = 'За три последних полных месяца нет расходов, рассчитывать пока не из чего';
          return;
        }
        income.value = stats.income;
        const monthName = (m) => parseIso(`${m}-01`).toLocaleDateString('ru-RU', { month: 'long' });
        period.value = stats.used.length === 1 ? monthName(stats.used[0]) : `${monthName(stats.used[0])} — ${monthName(stats.used.at(-1))}`;
        const { limits } = await api.adviseLimits({
          advise: stats.categories.filter((c) => c.average > 0).map((c) => ({ id: c.category.id, name: c.fullName, months: c.values, average: c.average })),
          income: stats.income, months: stats.used, today: today(),
        });
        const advice = Object.fromEntries(limits.map((l) => [l.id, l]));
        // Что GigaChat не предложил, остаётся с текущим лимитом и без галочки.
        rows.value = stats.categories.map((c) => {
          const a = advice[c.category.id];
          return reactive({ ...c, include: !!a, value: amountToInput(a?.limit ?? c.category.monthly_limit), reason: a?.reason ?? '' });
        });
      } catch (e) {
        error.value = e.message;
      } finally {
        busy.value = false;
      }
    }
    onMounted(load);

    const selected = computed(() => rows.value.filter((r) => r.include));
    const total = computed(() => selected.value.reduce((s, r) => s + (parseAmount(r.value) || 0), 0));

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
      if (!changes.length) return emit('close');
      saving.value = true;
      try {
        await saveCategoryLimits(changes);
        emit('close');
      } catch { /* показано */ } finally { saving.value = false; }
    }

    return { busy, saving, error, rows, period, income, selected, total, apply, load, rub };
  },
  template: `
    <div class="advisor">
      <div v-if="busy" class="advisor-busy" role="status"><span class="spinner" aria-hidden="true"></span> GigaChat считает лимиты…</div>
      <template v-else-if="rows.length">
        <p class="hint">Предложение GigaChat по расходам за {{ period }}. Поправьте суммы или снимите галочки: применятся только отмеченные. Пустое поле снимает лимит.</p>
        <div v-for="r in rows" :key="r.category.id" :class="['advice-row', { off: !r.include }]">
          <label class="check"><input type="checkbox" v-model="r.include" :aria-label="'Применить лимит: ' + r.category.name"></label>
          <div class="advice-text">
            <b>{{ r.category.icon }} {{ r.label }}</b>
            <small>в среднем {{ rub(r.average) }}<template v-if="r.category.monthly_limit"> · сейчас {{ rub(r.category.monthly_limit) }}</template></small>
            <small v-if="r.reason" class="advice-reason">{{ r.reason }}</small>
          </div>
          <span class="advice-input"><input v-model="r.value" inputmode="decimal" placeholder="Нет" :aria-label="'Лимит: ' + r.category.name"> ₽</span>
        </div>
        <p class="hint advice-total">Сумма отмеченных лимитов: <b>{{ rub(total) }}</b><template v-if="income"> · средний доход {{ rub(income) }}</template></p>
      </template>
      <p v-if="error" class="form-error" role="alert">{{ error }}</p>
      <div v-if="!busy" class="btn-row advisor-actions">
        <button type="button" class="btn ghost" :disabled="saving" @click="$emit('close')">Отмена</button>
        <button v-if="!rows.length" type="button" class="btn" @click="load">Ещё раз</button>
        <button v-else type="button" class="btn primary" :disabled="saving || !selected.length" @click="apply">
          {{ saving ? 'Применяю…' : 'Применить лимиты: ' + selected.length }}</button>
      </div>
    </div>`,
};
