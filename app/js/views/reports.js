import { ref, computed, watch } from 'vue';
import { api } from '../api.js?v=2610290226';
import { state } from '../store.js?v=2610290226';
import { expanded, toggleIn } from '../ui-state.js?v=2610290226';
import { rub, isoDate, addMonths, monthLabel, bySort, localGet, localSet } from '../utils.js?v=2610290226';
import { categoryTree, groupLabel, categoryLabel, spendingMaps, limitStatus } from '../categories.js?v=2610290226';
import { RingChart, TrendChart, SLICE_COLORS, OTHER_COLOR } from '../charts.js?v=2610290226';
import { Icon, MonthSwitcher } from '../components.js?v=2610290226';

// Выбранный вид запоминается на устройстве.
function remembered(key, fallback) {
  const r = ref(localGet(key) ?? fallback);
  watch(r, (v) => localSet(key, String(v)));
  return r;
}

export const ReportsView = {
  components: { Icon, MonthSwitcher, RingChart, TrendChart },
  setup() {
    const open = expanded.reportGroups;
    const toggle = (id) => toggleIn(open, id);
    const spendView = remembered('report-spend-view', 'ring');
    const trendMode = remembered('report-trend-mode', 'lines');
    const months = remembered('report-months', '6');
    const subject = ref('flow');           // 'flow' — доходы и расходы, иначе id раздела расходов
    const drill = ref(null);               // раздел, открытый внутри кольца

    const tree = computed(() => categoryTree('expense'));
    const expenseGroups = computed(() => state.categoryGroups.filter((g) => g.kind === 'expense').sort(bySort));
    // Цвет раздела закреплён за его местом в списке, а не за размером суммы.
    const groupColor = (g) => SLICE_COLORS[expenseGroups.value.indexOf(g)] ?? OTHER_COLOR;

    // Расходы месяца по разделам (с раскрытием до категорий) и категориям без раздела.
    const spending = computed(() => {
      const { byCategory, byGroup } = spendingMaps(state.transactions);
      const total = [...byCategory.values()].reduce((a, b) => a + b, 0);
      const rows = [];
      for (const g of expenseGroups.value) {
        const sum = byGroup.get(g.id) ?? 0;
        if (!sum) continue;
        const children = state.categories.filter((c) => c.group_id === g.id && byCategory.has(c.id)).sort(bySort)
          .map((c, i) => ({ id: c.id, icon: c.icon, label: categoryLabel(tree.value, c), value: byCategory.get(c.id), color: SLICE_COLORS[i] ?? OTHER_COLOR }))
          .sort((a, b) => b.value - a.value);
        rows.push({ id: g.id, icon: '📂', label: groupLabel(tree.value, g), value: sum, color: groupColor(g), children });
      }
      const groupIds = new Set(state.categoryGroups.map((g) => g.id));
      for (const [id, sum] of byCategory) {
        const c = state.categories.find((x) => x.id === id);
        if (c && groupIds.has(c.group_id)) continue;
        rows.push({ id: id ?? 'none', icon: c?.icon ?? '❔', label: c?.name ?? 'Без категории', value: sum, color: OTHER_COLOR });
      }
      rows.sort((a, b) => b.value - a.value);
      const top = rows[0]?.value || 1;
      return { rows, total, width: (v) => (v / top) * 100, share: (v) => (total ? Math.round((v / total) * 100) : 0) };
    });

    // Кольцо: разделы или категории открытого раздела.
    const ring = computed(() => {
      const d = drill.value && spending.value.rows.find((r) => r.id === drill.value);
      if (d) return { items: d.children, total: d.value, label: d.label };
      return { items: spending.value.rows, total: spending.value.total, label: 'Все расходы' };
    });
    function selectSlice(item) {
      if (!drill.value && item.children?.length) drill.value = item.id;
    }
    watch(() => state.month, () => { drill.value = null; });
    // Открытый раздел пропал после обновления данных — вернуться ко всем разделам.
    watch(() => spending.value.rows, (rows) => {
      if (drill.value && !rows.some((r) => r.id === drill.value)) drill.value = null;
    });

    const limits = computed(() => limitStatus(state.transactions));

    // Динамика по месяцам: операции за выбранный период загружаются один раз.
    const history = ref([]);
    const historyError = ref('');
    let request = 0;
    async function loadHistory() {
      const req = ++request, n = Number(months.value);
      const from = addMonths(state.month, -(n - 1)), to = addMonths(state.month, 1);
      try {
        const tx = await api.listTransactions(isoDate(from), isoDate(to));
        if (req !== request) return; // пока грузили, переключили месяц
        const catGroup = Object.fromEntries(state.categories.map((c) => [c.id, c.group_id]));
        history.value = Array.from({ length: n }, (_, i) => {
          const d = addMonths(from, i), key = isoDate(d).slice(0, 7);
          const values = { income: 0, expense: 0 };
          for (const t of tx) {
            if (t.date.slice(0, 7) !== key || t.kind === 'transfer') continue;
            values[t.kind] += Number(t.amount);
            if (t.kind === 'expense') {
              const g = catGroup[t.category_id];
              if (g) values[g] = (values[g] ?? 0) + Number(t.amount);
            }
          }
          return { month: isoDate(d), date: d, values };
        });
        historyError.value = '';
      } catch (e) {
        historyError.value = e.message;
      }
    }
    watch([() => state.dataVersion, months], loadHistory, { immediate: true });

    const trendSeries = computed(() => {
      if (subject.value === 'flow') {
        return [{ key: 'income', label: 'Доходы', color: 'var(--series-income)' }, { key: 'expense', label: 'Расходы', color: 'var(--series-expense)' }];
      }
      const g = expenseGroups.value.find((x) => x.id === subject.value);
      return g ? [{ key: g.id, label: g.name, color: groupColor(g) === OTHER_COLOR ? 'var(--c1)' : groupColor(g) }] : [];
    });

    return {
      state, open, toggle, spendView, trendMode, months, subject, drill, spending, ring, selectSlice, limits,
      history, historyError, trendSeries, expenseGroups, tree, groupLabel, Math,
      money: rub, // в отчётах — итоги, показываем без копеек
    };
  },
  template: `
    <section class="page">
      <header class="page-head">
        <h1 class="page-title">Отчёты</h1>
        <month-switcher/>
      </header>

      <div class="card pad">
        <div class="card-head">
          <h2>Расходы за месяц</h2>
          <div class="segmented mini" role="radiogroup" aria-label="Вид">
            <button :class="{ active: spendView === 'ring' }" @click="spendView = 'ring'">Кольцо</button>
            <button :class="{ active: spendView === 'bars' }" @click="spendView = 'bars'">Полосы</button>
          </div>
        </div>
        <p v-if="!spending.rows.length" class="empty">Расходов в этом месяце нет</p>

        <div v-else-if="spendView === 'ring'" class="ring-layout">
          <ring-chart :items="ring.items" :total="ring.total" :center-label="drill ? ring.label : 'Все расходы'" @select="selectSlice"/>
          <div class="ring-legend">
            <button v-if="drill" class="btn ghost small" @click="drill = null"><icon name="left" :size="16"/> Все разделы</button>
            <button v-for="it in ring.items" :key="it.id" class="legend-row" @click="selectSlice(it)">
              <i class="swatch" :style="{ background: it.color }"></i>
              <span class="legend-label">{{ it.label }}</span>
              <span class="legend-value">{{ money(it.value) }}</span>
              <span class="legend-share">{{ ring.total ? Math.round(it.value / ring.total * 100) : 0 }}%</span>
            </button>
          </div>
        </div>

        <ul v-else class="hbars">
          <li v-for="r in spending.rows" :key="r.id">
            <button v-if="r.children" class="hbar-item" :aria-expanded="open.has(r.id)" @click="toggle(r.id)">
              <div class="hbar-label">
                <icon name="down" :class="['chev', { closed: !open.has(r.id) }]" :size="16"/>
                {{ r.label }}
              </div>
              <div class="hbar-value">{{ money(r.value) }} <span class="muted">{{ spending.share(r.value) }}%</span></div>
              <div class="hbar-track"><div class="hbar-fill" :style="{ width: spending.width(r.value) + '%' }"></div></div>
            </button>
            <div v-else class="hbar-item">
              <div class="hbar-label"><span aria-hidden="true">{{ r.icon }}</span> {{ r.label }}</div>
              <div class="hbar-value">{{ money(r.value) }} <span class="muted">{{ spending.share(r.value) }}%</span></div>
              <div class="hbar-track"><div class="hbar-fill" :style="{ width: spending.width(r.value) + '%' }"></div></div>
            </div>
            <ul v-if="r.children && open.has(r.id)" class="hbar-children">
              <li v-for="c in r.children" :key="c.id">
                <span><span aria-hidden="true">{{ c.icon }}</span> {{ c.label }}</span>
                <span class="hbar-value">{{ money(c.value) }}</span>
              </li>
            </ul>
          </li>
        </ul>
      </div>

      <div class="card pad">
        <div class="card-head"><h2>Лимиты на месяц</h2></div>
        <p v-if="!limits.length" class="empty">Лимиты не заданы. Их можно указать для разделов и категорий в «Настройки → Категории».</p>
        <ul class="limits">
          <li v-for="l in limits" :key="l.id">
            <div class="limit-top">
              <span :class="{ 'limit-group': l.isGroup }"><span aria-hidden="true">{{ l.icon }}</span> {{ l.label }}</span>
              <span>{{ money(l.spent) }} <span class="muted">из {{ money(l.limit) }}</span></span>
            </div>
            <div class="progress"><div :class="['progress-fill', l.level]" :style="{ width: Math.min(100, l.ratio * 100) + '%' }"></div></div>
            <small :class="['limit-note', l.level]">
              <template v-if="l.level === 'over'">⚠ Превышен на {{ money(-l.left) }}</template>
              <template v-else-if="l.level === 'warn'">● Осталось {{ money(l.left) }}, лимит почти исчерпан</template>
              <template v-else>✓ Осталось {{ money(l.left) }}</template>
            </small>
          </li>
        </ul>
      </div>

      <div class="card pad">
        <div class="card-head">
          <h2>Динамика</h2>
          <div class="segmented mini" role="radiogroup" aria-label="Вид графика">
            <button :class="{ active: trendMode === 'lines' }" @click="trendMode = 'lines'">Линии</button>
            <button :class="{ active: trendMode === 'bars' }" @click="trendMode = 'bars'">Столбцы</button>
          </div>
        </div>
        <div class="trend-controls">
          <select v-model="subject" aria-label="Что показать">
            <option value="flow">Доходы и расходы</option>
            <optgroup label="Расходы по разделу">
              <option v-for="g in expenseGroups" :key="g.id" :value="g.id">{{ groupLabel(tree, g) }}</option>
            </optgroup>
          </select>
          <div class="segmented mini" role="radiogroup" aria-label="Период">
            <button :class="{ active: months === '6' }" @click="months = '6'">6 мес</button>
            <button :class="{ active: months === '12' }" @click="months = '12'">12 мес</button>
          </div>
        </div>
        <p v-if="historyError" class="form-error">{{ historyError }}</p>
        <trend-chart v-else-if="history.length && trendSeries.length" :rows="history" :series="trendSeries" :mode="trendMode"/>
        <div v-if="history.length" class="table-wrap">
          <table class="table">
            <thead>
              <tr v-if="subject === 'flow'"><th>Месяц</th><th>Доходы</th><th>Расходы</th><th>Итог</th></tr>
              <tr v-else><th>Месяц</th><th>Потрачено</th></tr>
            </thead>
            <tbody>
              <tr v-for="r in history" :key="r.month">
                <td>{{ r.date.toLocaleDateString('ru-RU', { month: 'long', year: months === '12' ? '2-digit' : undefined }) }}</td>
                <template v-if="subject === 'flow'">
                  <td>{{ money(r.values.income) }}</td>
                  <td>{{ money(r.values.expense) }}</td>
                  <td :class="r.values.income - r.values.expense < 0 ? 'negative' : 'income'">{{ money(r.values.income - r.values.expense) }}</td>
                </template>
                <td v-else>{{ money(r.values[subject] ?? 0) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>`,
};
