// Кэшбэки: раз в месяц выбираете по картам («Супермаркеты 7%»), привязываете к своим категориям,
// а приложение подсказывает, какой картой что выгоднее покупать.
import { ref, computed, watch } from 'vue';
import { api } from '../api.js';
import { state, saveCashbackMonth, currentMonthIso, toast } from '../store.js';
import { monthLabel, isoDate, addMonths, parseIso, parseAmount, bySort } from '../utils.js';
import { categoryTree, groupLabel, categoryLabel } from '../categories.js';
import { Icon, Modal } from '../components.js';

// Карты, по которым бывает кэшбэк: наличные и вклады не нужны.
const cardAccounts = () => state.accounts
  .filter((a) => !a.archived && (a.type === 'debit' || a.type === 'credit')).sort(bySort);

const accountName = (id) => state.accounts.find((a) => a.id === id)?.name ?? '?';
const formatPercent = (p) => `${String(Number(p)).replace('.', ',')}%`;

// Лучшие кэшбэки этого месяца для категории (пустой список категорий — «на все покупки»).
export function cashbacksFor(categoryId) {
  const active = new Set(state.accounts.filter((a) => !a.archived).map((a) => a.id));
  return state.cashbacks
    .filter((c) => active.has(c.account_id) && (!c.category_ids?.length || c.category_ids.includes(categoryId)))
    .sort((a, b) => Number(b.percent) - Number(a.percent));
}

// Подсказка для окна операции: выгоднее другой картой или эта карта уже лучшая.
export function cashbackHint(categoryId, accountId) {
  const list = cashbacksFor(categoryId);
  if (!list.length) return null;
  const best = list[0];
  const here = list.find((c) => c.account_id === accountId);
  if (here && Number(here.percent) >= Number(best.percent)) return { kind: 'ok', percent: here.percent, label: here.label };
  return { kind: 'better', percent: best.percent, label: best.label, accountId: best.account_id, accountName: accountName(best.account_id) };
}

const LABELS = ['Супермаркеты', 'Рестораны и кафе', 'Фастфуд', 'АЗС', 'Такси', 'Транспорт', 'Аптеки', 'Красота',
  'Одежда и обувь', 'Маркетплейсы', 'Дом и ремонт', 'Детские товары', 'Животные', 'Цветы', 'Кино', 'Развлечения',
  'Электроника', 'Путешествия', 'Все покупки'];

const CashbackEditor = {
  components: { Modal, Icon },
  emits: ['close'],
  setup(props, { emit }) {
    const month = ref(parseIso(currentMonthIso()));
    const rows = ref([]);
    const removed = ref([]);
    const loading = ref(true);
    const busy = ref(false);
    const error = ref('');
    const cards = computed(cardAccounts);
    const tree = computed(() => categoryTree('expense'));
    const draft = ref({ account_id: cards.value[0]?.id ?? null, label: '', percent: '' });

    async function load() {
      loading.value = true;
      removed.value = [];
      try {
        rows.value = (await api.listCashbacks(isoDate(month.value))).map((c) => ({ ...c, percent: String(c.percent).replace('.', ',') }));
      } catch (e) { toast(e.message, 'error'); rows.value = []; }
      loading.value = false;
    }
    watch(month, load, { immediate: true });

    async function copyPrevious() {
      const prev = await api.listCashbacks(isoDate(addMonths(month.value, -1)));
      if (!prev.length) return toast('В прошлом месяце кэшбэков нет', 'error');
      rows.value = prev.map(({ account_id, label, percent, category_ids }) => ({
        account_id, label, percent: String(percent).replace('.', ','), category_ids: [...category_ids],
      }));
    }

    function addRow() {
      error.value = '';
      const percent = parseAmount(draft.value.percent);
      if (!draft.value.account_id) return (error.value = 'Выберите карту');
      if (!draft.value.label.trim()) return (error.value = 'Напишите категорию кэшбэка, как в банке');
      if (!(percent > 0 && percent <= 100)) return (error.value = 'Процент — число от 0 до 100');
      rows.value.push({ account_id: draft.value.account_id, label: draft.value.label.trim(), percent: draft.value.percent, category_ids: [] });
      draft.value = { ...draft.value, label: '', percent: '' };
    }

    function removeRow(r) {
      if (r.id) removed.value.push(r.id);
      rows.value = rows.value.filter((x) => x !== r);
    }

    function addCategory(r, e) {
      const id = e.target.value;
      e.target.value = '';
      if (id && !r.category_ids.includes(id)) r.category_ids.push(id);
    }
    const catName = (id) => {
      const c = state.categories.find((x) => x.id === id);
      return c ? `${c.icon} ${categoryLabel(tree.value, c)}` : '?';
    };

    // Группы по картам; счета не из списка карт (например, ушедшие в архив) тоже показываем,
    // чтобы такие кэшбэки можно было увидеть и удалить.
    const byCard = computed(() => {
      const ids = [...new Set([...cards.value.map((a) => a.id), ...rows.value.map((r) => r.account_id)])];
      return ids.map((id) => ({
        account: state.accounts.find((a) => a.id === id) ?? { id, name: 'Удалённый счёт', icon: '❔' },
        rows: rows.value.filter((r) => r.account_id === id),
      })).filter((g) => g.rows.length);
    });

    async function save() {
      error.value = '';
      const out = [];
      for (const r of rows.value) {
        const percent = parseAmount(r.percent);
        if (!r.label.trim()) return (error.value = `«${accountName(r.account_id)}»: пустое название кэшбэка`);
        if (!(percent > 0 && percent <= 100)) return (error.value = `«${r.label}»: процент — число от 0 до 100`);
        out.push({ id: r.id, month: isoDate(month.value), account_id: r.account_id, label: r.label.trim(), percent, category_ids: [...r.category_ids] });
      }
      busy.value = true;
      try {
        await saveCashbackMonth(out, removed.value);
        emit('close');
      } catch {
        // Часть уже сохранилась: запоминаем полученные номера, чтобы не создать их повторно.
        out.forEach((o, i) => { if (o.id) rows.value[i].id = o.id; });
      } finally { busy.value = false; }
    }

    return {
      month, rows, loading, busy, error, cards, tree, draft, byCard, LABELS,
      shift: (n) => { month.value = addMonths(month.value, n); },
      copyPrevious, addRow, removeRow, addCategory, catName, save, monthLabel, groupLabel, categoryLabel,
    };
  },
  template: `
    <modal title="Кэшбэки" class="wide" @close="$emit('close')">
      <div class="stack">
        <div class="month-switch center-row">
          <button class="icon-btn" aria-label="Предыдущий месяц" @click="shift(-1)"><icon name="left"/></button>
          <span class="month-label">{{ monthLabel(month) }}</span>
          <button class="icon-btn" aria-label="Следующий месяц" @click="shift(1)"><icon name="right"/></button>
        </div>
        <p class="hint">Впишите категории кэшбэка, которые выбрали в банках, и привяжите их к своим категориям —
          тогда при вводе траты приложение подскажет, какой картой выгоднее. Без привязки кэшбэк считается «на все покупки».</p>

        <div class="cb-add">
          <select v-model="draft.account_id" aria-label="Карта">
            <option v-for="a in cards" :key="a.id" :value="a.id">{{ a.icon }} {{ a.name }}</option>
          </select>
          <input v-model="draft.label" list="cb-labels" placeholder="Категория в банке" aria-label="Категория в банке">
          <input v-model="draft.percent" inputmode="decimal" placeholder="%" class="cb-percent" aria-label="Процент">
          <button type="button" class="btn" @click="addRow"><icon name="plus"/> Добавить</button>
          <datalist id="cb-labels"><option v-for="l in LABELS" :key="l" :value="l"></option></datalist>
        </div>

        <p v-if="loading" class="empty">Загрузка…</p>
        <div v-else-if="!rows.length" class="empty">
          <p>На этот месяц кэшбэки не выбраны.</p>
          <button class="btn" @click="copyPrevious">Скопировать с прошлого месяца</button>
        </div>

        <div v-for="g in byCard" :key="g.account.id" class="cb-card">
          <div class="field-label">{{ g.account.icon }} {{ g.account.name }}</div>
          <div v-for="(r, i) in g.rows" :key="r.id ?? i" class="cb-row">
            <div class="cb-row-top">
              <input v-model="r.label" list="cb-labels" aria-label="Категория в банке">
              <input v-model="r.percent" inputmode="decimal" class="cb-percent" aria-label="Процент"><span>%</span>
              <button type="button" class="icon-btn" aria-label="Удалить кэшбэк" @click="removeRow(r)"><icon name="trash" :size="18"/></button>
            </div>
            <div class="cb-cats">
              <span v-for="id in r.category_ids" :key="id" class="chip small">
                {{ catName(id) }}
                <button type="button" class="chip-x" aria-label="Убрать категорию" @click="r.category_ids = r.category_ids.filter(x => x !== id)">×</button>
              </span>
              <span v-if="!r.category_ids.length" class="hint">на все покупки</span>
              <select class="cb-cat-add" aria-label="Привязать категорию" @change="addCategory(r, $event)">
                <option value="">+ категория</option>
                <optgroup v-for="s in tree.sections" :key="s.group.id" :label="groupLabel(tree, s.group)">
                  <option v-for="c in s.items" :key="c.id" :value="c.id">{{ c.icon }} {{ categoryLabel(tree, c) }}</option>
                </optgroup>
                <optgroup v-if="tree.loose.length" label="Без раздела">
                  <option v-for="c in tree.loose" :key="c.id" :value="c.id">{{ c.icon }} {{ c.name }}</option>
                </optgroup>
              </select>
            </div>
          </div>
        </div>
        <p v-if="error" class="form-error" role="alert">{{ error }}</p>
      </div>
      <template #footer>
        <span class="spacer"></span>
        <button type="button" class="btn ghost" @click="$emit('close')">Отмена</button>
        <button type="button" class="btn primary" :disabled="busy || loading" @click="save">Сохранить</button>
      </template>
    </modal>`,
};

// Карточка на главной: какой картой что покупать в этом месяце.
export const CashbackCard = {
  components: { Icon, CashbackEditor },
  setup() {
    const editing = ref(false);
    // Для каждой категории кэшбэка («Супермаркеты») — лучшая карта.
    const best = computed(() => {
      const map = new Map();
      for (const c of state.cashbacks) {
        if (state.accounts.find((a) => a.id === c.account_id)?.archived) continue;
        const key = c.label.trim().toLowerCase();
        const cur = map.get(key);
        if (!cur || Number(c.percent) > Number(cur.percent)) map.set(key, c);
      }
      return [...map.values()].sort((a, b) => Number(b.percent) - Number(a.percent));
    });
    const IN_MONTH = ['январе', 'феврале', 'марте', 'апреле', 'мае', 'июне', 'июле', 'августе', 'сентябре', 'октябре', 'ноябре', 'декабре'];
    return { state, editing, best, accountName, formatPercent, inMonth: IN_MONTH[new Date().getMonth()] };
  },
  template: `
    <div class="card pad cashback-card">
      <div class="card-head nowrap-head">
        <h2>💳 Кэшбэк в {{ inMonth }}</h2>
        <button class="btn small" @click="editing = true">{{ best.length ? 'Изменить' : 'Выбрать' }}</button>
      </div>
      <p v-if="!best.length" class="hint">Отметьте, какие кэшбэки вы выбрали в банках в этом месяце, — здесь будет видно, какой картой что выгоднее покупать.</p>
      <ul v-else class="cb-best">
        <li v-for="c in best" :key="c.id">
          <span class="cb-label">{{ c.label }}</span>
          <span class="cb-account">{{ accountName(c.account_id) }}</span>
          <b class="cb-pct">{{ formatPercent(c.percent) }}</b>
        </li>
      </ul>
      <cashback-editor v-if="editing" @close="editing = false"/>
    </div>`,
};
