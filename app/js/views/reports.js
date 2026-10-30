import { ref, computed, watch } from 'vue';
import { api } from '../api.js?v=2610301646';
import { state } from '../store.js?v=2610301646';
import { expanded, toggleIn } from '../ui-state.js?v=2610301646';
import { rub, money, isoDate, parseIso, addMonths, monthLabel, bySort, localGet, localSet } from '../utils.js?v=2610301646';
import { categoryTree, groupLabel, categoryLabel, spendingMaps, limitStatus } from '../categories.js?v=2610301646';
import { RingChart, TrendChart, SLICE_COLORS, OTHER_COLOR } from '../charts.js?v=2610301646';
import { Icon, MonthSwitcher, vLongPress } from '../components.js?v=2610301646';

// Выбранный вид запоминается на устройстве.
function remembered(key, fallback) {
  const r = ref(localGet(key) ?? fallback);
  watch(r, (v) => localSet(key, String(v)));
  return r;
}

export const ReportsView = {
  components: { Icon, MonthSwitcher, RingChart, TrendChart },
  directives: { longPress: vLongPress },
  emits: ['edit', 'copy'],
  setup() {
    const open = expanded.reportGroups;
    const toggle = (id) => toggleIn(open, id);
    const spendView = remembered('report-spend-view', 'ring');
    const trendMode = remembered('report-trend-mode', 'lines');
    const months = remembered('report-months', '6');
    const subject = ref('flow');           // 'flow' — доходы и расходы, иначе id раздела расходов
    const drill = ref(null);               // раздел, открытый внутри кольца
    const flowKind = remembered('report-flow-kind', 'expense'); // расходы или доходы в верхнем отчёте
    const FLOW_TEXT = {
      expense: { title: 'Расходы за месяц', all: 'Все расходы', empty: 'Расходов в этом месяце нет', none: 'Трат нет.', other: 'Показать доходы', sign: '−' },
      income: { title: 'Доходы за месяц', all: 'Все доходы', empty: 'Доходов в этом месяце нет', none: 'Доходов нет.', other: 'Показать расходы', sign: '+' },
    };
    const flow = computed(() => FLOW_TEXT[flowKind.value]);
    const toggleFlow = () => { flowKind.value = flowKind.value === 'expense' ? 'income' : 'expense'; };

    const tree = computed(() => categoryTree(flowKind.value));
    const flowGroups = computed(() => state.categoryGroups.filter((g) => g.kind === flowKind.value).sort(bySort));
    // Динамика ниже всегда показывает разделы расходов.
    const expenseTree = computed(() => categoryTree('expense'));
    const expenseGroups = computed(() => state.categoryGroups.filter((g) => g.kind === 'expense').sort(bySort));
    // Цвет раздела закреплён за его местом в списке, а не за размером суммы.
    const groupColor = (g) => SLICE_COLORS[expenseGroups.value.indexOf(g)] ?? OTHER_COLOR;

    // Операции месяца по разделам (с раскрытием до категорий) и категориям без раздела.
    const spending = computed(() => {
      const { byCategory, byGroup } = spendingMaps(state.transactions, flowKind.value);
      const total = [...byCategory.values()].reduce((a, b) => a + b, 0);
      const rows = [];
      flowGroups.value.forEach((g, place) => {
        const sum = byGroup.get(g.id) ?? 0;
        if (!sum) return;
        const children = state.categories.filter((c) => c.group_id === g.id && byCategory.has(c.id)).sort(bySort)
          .map((c, i) => ({ id: c.id, icon: c.icon, label: categoryLabel(tree.value, c), value: byCategory.get(c.id), color: SLICE_COLORS[i] ?? OTHER_COLOR }))
          .sort((a, b) => b.value - a.value);
        rows.push({ id: g.id, icon: '📂', label: groupLabel(tree.value, g), value: sum, color: SLICE_COLORS[place] ?? OTHER_COLOR, children });
      });
      // Категории без раздела (доходы обычно только такие) красим следующими цветами, чтобы их можно было различить.
      const groupIds = new Set(state.categoryGroups.map((g) => g.id));
      const loose = [...byCategory.entries()]
        .map(([id, sum]) => ({ id, sum, c: state.categories.find((x) => x.id === id) }))
        .filter((x) => !(x.c && groupIds.has(x.c.group_id)))
        .sort((a, b) => (a.c && b.c ? bySort(a.c, b.c) : a.c ? -1 : 1));
      loose.forEach(({ id, sum, c }, i) => {
        rows.push({ id: id ?? 'none', icon: c?.icon ?? '❔', label: c?.name ?? 'Без категории', value: sum, color: SLICE_COLORS[flowGroups.value.length + i] ?? OTHER_COLOR });
      });
      rows.sort((a, b) => b.value - a.value);
      const top = rows[0]?.value || 1;
      return { rows, total, width: (v) => (v / top) * 100, share: (v) => (total ? Math.round((v / total) * 100) : 0) };
    });

    // Кольцо: разделы или категории открытого раздела.
    const ring = computed(() => {
      const d = drill.value && spending.value.rows.find((r) => r.id === drill.value);
      if (d) return { items: d.children, total: d.value, label: d.label };
      return { items: spending.value.rows, total: spending.value.total, label: flow.value.all };
    });
    // Выбранная категория: под графиком — список её трат за месяц. Повторное нажатие снимает выбор.
    const picked = ref(null);
    function selectSlice(item) {
      if (!drill.value && item.children?.length) { drill.value = item.id; picked.value = null; return; }
      picked.value = picked.value?.id === item.id ? null : item;
    }
    watch(drill, () => { picked.value = null; });
    watch([() => state.month, flowKind], () => { drill.value = null; picked.value = null; });

    // Траты выбранной категории, а если категория не выбрана, но открыт раздел — всего раздела.
    const pickedList = computed(() => {
      const group = spendView.value === 'ring' && drill.value && spending.value.rows.find((r) => r.id === drill.value);
      const target = picked.value ?? group;
      if (!target) return null;
      const ids = target.children ? new Set(target.children.map((c) => c.id)) : new Set([target.id === 'none' ? null : target.id]);
      const items = state.transactions
        .filter((t) => t.kind === flowKind.value && ids.has(t.category_id ?? null))
        .sort((a, b) => b.date.localeCompare(a.date) || Number(b.amount) - Number(a.amount));
      return { title: target.label, icon: target.icon, items, total: items.reduce((s, t) => s + Number(t.amount), 0) };
    });
    const catById = computed(() => Object.fromEntries(state.categories.map((c) => [c.id, c])));
    const accName = (id) => state.accounts.find((a) => a.id === id)?.name ?? '';
    const shortDate = (iso) => parseIso(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
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
        historyError.value = state.offline ? 'Динамика по месяцам появится, когда будет интернет' : e.message;
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
      history, historyError, trendSeries, expenseGroups, expenseTree, groupLabel, Math, flowKind, flow, toggleFlow,
      picked, pickedList, catById, accName, shortDate,
      money: rub, // в отчётах — итоги, показываем без копеек
      exact: money, // а суммы отдельных трат — как есть
    };
  },
  template: `
    <section class="page">
      <header class="page-head">
        <h1 class="page-title">Отчёты</h1>
        <month-switcher/>
      </header>

      <div class="card pad">
        <div class="card-head nowrap-head flow-head">
          <h2><button type="button" class="title-switch" :title="flow.other" :aria-label="flow.title + '. ' + flow.other" @click="toggleFlow">
            {{ flow.title }} <icon name="swap" :size="16"/></button></h2>
          <div class="segmented mini" role="radiogroup" aria-label="Вид">
            <button :class="{ active: spendView === 'ring' }" role="radio" :aria-checked="spendView === 'ring'" title="Кольцевая диаграмма" aria-label="Кольцевая диаграмма" @click="spendView = 'ring'"><icon name="ring" :size="20"/></button>
            <button :class="{ active: spendView === 'bars' }" role="radio" :aria-checked="spendView === 'bars'" title="Столбчатая диаграмма" aria-label="Столбчатая диаграмма" @click="spendView = 'bars'"><icon name="bars" :size="20"/></button>
          </div>
        </div>
        <p v-if="!spending.rows.length" class="empty">{{ flow.empty }}</p>

        <div v-else-if="spendView === 'ring'" class="ring-layout">
          <ring-chart :items="ring.items" :total="ring.total" :center-label="ring.label" @select="selectSlice"/>
          <div class="ring-legend">
            <button v-if="drill" class="btn ghost small" @click="drill = null"><icon name="left" :size="16"/> Все разделы</button>
            <button v-for="it in ring.items" :key="it.id" :class="['legend-row', { on: picked?.id === it.id }]"
              :aria-pressed="picked?.id === it.id" @click="selectSlice(it)">
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
            <button v-else :class="['hbar-item', { on: picked?.id === r.id }]" :aria-pressed="picked?.id === r.id" @click="selectSlice(r)">
              <div class="hbar-label"><span aria-hidden="true">{{ r.icon }}</span> {{ r.label }}</div>
              <div class="hbar-value">{{ money(r.value) }} <span class="muted">{{ spending.share(r.value) }}%</span></div>
              <div class="hbar-track"><div class="hbar-fill" :style="{ width: spending.width(r.value) + '%' }"></div></div>
            </button>
            <ul v-if="r.children && open.has(r.id)" class="hbar-children">
              <li v-for="c in r.children" :key="c.id">
                <button :class="{ on: picked?.id === c.id }" :aria-pressed="picked?.id === c.id" @click="selectSlice(c)">
                  <span><span aria-hidden="true">{{ c.icon }}</span> {{ c.label }}</span>
                  <span class="hbar-value">{{ money(c.value) }}</span>
                </button>
              </li>
            </ul>
          </li>
        </ul>

        <!-- Траты выбранной категории (или открытого раздела): на что именно ушли деньги. -->
        <div v-if="pickedList" class="picked-list">
          <div class="plate picked-head">
            <span class="picked-title">{{ pickedList.icon }} {{ pickedList.title }}</span>
            <span class="muted">{{ pickedList.items.length }} · {{ money(pickedList.total) }}</span>
            <button v-if="picked" type="button" class="chip-x" aria-label="Закрыть список" @click="picked = null">×</button>
          </div>
          <p v-if="!pickedList.items.length" class="hint">{{ flow.none }}</p>
          <button v-for="t in pickedList.items" :key="t.id" type="button" class="tx-row" v-long-press="() => $emit('copy', t)" @click="$emit('edit', t)">
            <span class="tx-icon" aria-hidden="true">{{ catById[t.category_id]?.icon ?? '❔' }}</span>
            <span class="tx-main">
              <span class="tx-title">{{ t.note || catById[t.category_id]?.name || 'Без категории' }}</span>
              <span class="tx-sub">{{ shortDate(t.date) }} · {{ accName(t.account_id) }}</span>
            </span>
            <span :class="['tx-amount', flowKind]">{{ flow.sign }}{{ exact(t.amount) }}</span>
          </button>
        </div>
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
              <option v-for="g in expenseGroups" :key="g.id" :value="g.id">{{ groupLabel(expenseTree, g) }}</option>
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
