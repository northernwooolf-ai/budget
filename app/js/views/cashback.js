// Кэшбэки: раз в месяц выбираете по картам («Супермаркеты 7%»), привязываете к своим категориям,
// а приложение подсказывает, какой картой что выгоднее покупать.
import { ref, computed, watch, nextTick } from 'vue';
import { api } from '../api.js?v=2610301642';
import { state, saveCashbackMonth, currentMonthIso, toast } from '../store.js?v=2610301642';
import { monthLabel, isoDate, addMonths, parseIso, parseAmount, bySort } from '../utils.js?v=2610301642';
import { categoryTree, groupLabel, categoryLabel } from '../categories.js?v=2610301642';
import { Icon, Modal } from '../components.js?v=2610301642';
import { toggleIn } from '../ui-state.js?v=2610301642';
import { CardChip, AccountSelect } from '../cards.js?v=2610301642';
import { ACCOUNT_TYPES, typeOf } from '../account-types.js?v=2610301642';

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

// Окно выбора категорий кэшбэка: галочки по одной, целым разделом или сразу все.
const CategoryChecklist = {
  components: { Modal, Icon },
  props: { tree: Object, modelValue: Array },
  emits: ['update:modelValue', 'close'],
  setup(props, { emit }) {
    const open = ref(new Set());
    const allIds = computed(() => [...props.tree.sections.flatMap((s) => s.items), ...props.tree.loose].map((c) => c.id));
    const picked = computed(() => new Set(props.modelValue));
    const countIn = (ids) => ids.filter((id) => picked.value.has(id)).length;
    // Состояние галочки для набора: 'all' | 'some' | 'none'.
    const stateOf = (ids) => { const n = countIn(ids); return n && n === ids.length ? 'all' : n ? 'some' : 'none'; };
    const sectionIds = (s) => s.items.map((c) => c.id);
    function setMany(ids, on) {
      const next = new Set(props.modelValue);
      ids.forEach((id) => (on ? next.add(id) : next.delete(id)));
      emit('update:modelValue', [...next]);
    }
    const toggleOpen = (id) => { const s = new Set(open.value); toggleIn(s, id); open.value = s; };
    return { open, allIds, picked, stateOf, sectionIds, setMany, toggleOpen, countIn, groupLabel };
  },
  template: `
    <modal title="Категории кэшбэка" @close="$emit('close')">
      <div class="checklist">
        <label class="check-row strong">
          <input type="checkbox" :checked="stateOf(allIds) === 'all'" :indeterminate="stateOf(allIds) === 'some'"
            @change="setMany(allIds, $event.target.checked)">
          <span>Все категории</span>
        </label>
        <div v-for="s in tree.sections" :key="s.group.id" class="check-section">
          <div class="check-row check-head">
            <input type="checkbox" :aria-label="'Весь раздел ' + s.group.name" :disabled="!s.items.length"
              :checked="s.items.length && stateOf(sectionIds(s)) === 'all'" :indeterminate="stateOf(sectionIds(s)) === 'some'"
              @change="setMany(sectionIds(s), $event.target.checked)">
            <button type="button" class="check-toggle" :aria-expanded="open.has(s.group.id)" @click="toggleOpen(s.group.id)">
              <span>{{ groupLabel(tree, s.group) }}</span>
              <span class="hint">{{ countIn(sectionIds(s)) }}/{{ s.items.length }}</span>
              <icon name="down" :class="['chev', { closed: !open.has(s.group.id) }]" :size="18"/>
            </button>
          </div>
          <div v-show="open.has(s.group.id)" class="check-items">
            <label v-for="c in s.items" :key="c.id" class="check-row">
              <input type="checkbox" :checked="picked.has(c.id)" @change="setMany([c.id], $event.target.checked)">
              <span>{{ tree.nums[c.id] }} {{ c.icon }} {{ c.name }}</span>
            </label>
          </div>
        </div>
        <label v-for="c in tree.loose" :key="c.id" class="check-row">
          <input type="checkbox" :checked="picked.has(c.id)" @change="setMany([c.id], $event.target.checked)">
          <span>{{ c.icon }} {{ c.name }}</span>
        </label>
      </div>
      <template #footer>
        <span class="spacer"></span>
        <button type="button" class="btn primary" @click="$emit('close')">Готово</button>
      </template>
    </modal>`,
};

// Одна строка кэшбэка: название в банке, процент, привязанные категории.
const CashbackRow = {
  components: { Icon },
  props: { row: Object, chips: Array },
  emits: ['remove', 'pick', 'unpick'],
  template: `
    <div class="cb-row">
      <div class="cb-row-top">
        <input v-model="row.label" :data-cb-key="row._key" list="cb-labels" placeholder="Категория в банке" aria-label="Категория в банке">
        <input v-model="row.percent" inputmode="decimal" class="cb-percent" placeholder="0" aria-label="Процент"><span>%</span>
        <button type="button" class="icon-btn" aria-label="Удалить кэшбэк" @click="$emit('remove')"><icon name="trash" :size="18"/></button>
      </div>
      <div class="cb-cats">
        <span v-for="ch in chips" :key="ch.key" class="chip small">
          {{ ch.text }}
          <button type="button" class="chip-x" aria-label="Убрать" @click="$emit('unpick', ch.ids)">×</button>
        </span>
        <span v-if="!row.category_ids.length" class="hint">на все покупки</span>
        <button type="button" class="btn small" @click="$emit('pick')">+ категории</button>
      </div>
    </div>`,
};

const CashbackEditor = {
  components: { Modal, Icon, CardChip, AccountSelect, CategoryChecklist, CashbackRow },
  emits: ['close'],
  setup(props, { emit }) {
    const month = ref(parseIso(currentMonthIso()));
    const rows = ref([]);
    const removed = ref([]);
    const loading = ref(true);
    const busy = ref(false);
    const error = ref('');
    const badKey = ref(null); // строка, которую надо дозаполнить
    const cards = computed(cardAccounts);
    const tree = computed(() => categoryTree('expense'));
    // Выбранная карта: «Добавить» добавляет на неё ещё одну пустую строку кэшбэка.
    const cardId = ref(cards.value[0]?.id ?? null);
    let nextKey = 0;
    const withKey = (r) => ({ ...r, _key: `k${nextKey++}` });

    async function load() {
      loading.value = true;
      removed.value = [];
      try {
        rows.value = (await api.listCashbacks(isoDate(month.value))).map((c) => withKey({ ...c, percent: String(c.percent).replace('.', ',') }));
      } catch (e) { toast(e.message, 'error'); rows.value = []; }
      loading.value = false;
    }
    watch(month, load, { immediate: true });

    async function copyPrevious() {
      const prev = await api.listCashbacks(isoDate(addMonths(month.value, -1)));
      if (!prev.length) return toast('В прошлом месяце кэшбэков нет', 'error');
      rows.value = prev.map(({ account_id, label, percent, category_ids }) => withKey({
        account_id, label, percent: String(percent).replace('.', ','), category_ids: [...category_ids],
      }));
    }

    // Новая строка появляется над кнопкой «Добавить кэшбэк», у выбранной карты;
    // в общий список по картам она уходит после сохранения.
    async function addRow() {
      error.value = '';
      if (!cardId.value) return (error.value = 'Выберите карту');
      const row = withKey({ account_id: cardId.value, label: '', percent: '', category_ids: [], _new: true });
      rows.value.push(row);
      await nextTick();
      const input = document.querySelector(`[data-cb-key="${row._key}"]`);
      input?.focus();
      input?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }

    function removeRow(r) {
      if (r.id) removed.value.push(r.id);
      rows.value = rows.value.filter((x) => x !== r);
    }

    const catName = (id) => {
      const c = state.categories.find((x) => x.id === id);
      return c ? `${c.icon} ${categoryLabel(tree.value, c)}` : '?';
    };
    // Выбранные категории для показа: целиком выбранный раздел (или всё сразу) — одним значком.
    function chipsOf(r) {
      const picked = new Set(r.category_ids);
      const has = (ids) => ids.length && ids.every((id) => picked.has(id));
      const all = [...tree.value.sections.flatMap((s) => s.items), ...tree.value.loose].map((c) => c.id);
      if (has(all)) return [{ key: 'all', text: '✅ Все категории', ids: r.category_ids }];
      const chips = [];
      const covered = new Set();
      for (const s of tree.value.sections) {
        const ids = s.items.map((c) => c.id);
        if (!has(ids)) continue;
        chips.push({ key: s.group.id, text: `📂 ${groupLabel(tree.value, s.group)}`, ids });
        ids.forEach((id) => covered.add(id));
      }
      for (const id of r.category_ids) if (!covered.has(id)) chips.push({ key: id, text: catName(id), ids: [id] });
      return chips;
    }
    const unpick = (r, ids) => { r.category_ids = r.category_ids.filter((x) => !ids.includes(x)); };
    const pickingFor = ref(null);
    const cardGroups = computed(() => ACCOUNT_TYPES
      .map((g) => ({ label: g.label, items: cards.value.filter((a) => typeOf(a).id === g.id) }))
      .filter((g) => g.items.length));

    const isDraft = (r) => r._new && r.account_id === cardId.value;
    const drafts = computed(() => rows.value.filter(isDraft));
    const currentCard = computed(() => state.accounts.find((a) => a.id === cardId.value));

    // Группы по картам в порядке карт; счета не из списка карт (например, ушедшие в архив) тоже показываем,
    // чтобы такие кэшбэки можно было увидеть и удалить.
    const byCard = computed(() => {
      const ids = [...new Set([...cards.value.map((a) => a.id), ...rows.value.map((r) => r.account_id)])];
      return ids.map((id) => ({
        account: state.accounts.find((a) => a.id === id) ?? { id, name: 'Удалённый счёт', icon: '❔' },
        rows: rows.value.filter((r) => r.account_id === id && !isDraft(r)),
      })).filter((g) => g.rows.length);
    });

    async function save() {
      error.value = '';
      badKey.value = null;
      // Показать, что не так: окно длинное, поэтому сообщение всплывает, а строка подсвечивается и видна на экране.
      const complain = (r, text) => {
        error.value = text;
        badKey.value = r._key;
        toast(text, 'error');
        nextTick(() => document.querySelector(`[data-cb-key="${r._key}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }));
      };
      // Совсем пустые новые строки (добавили и не заполнили) просто пропускаем.
      const filled = rows.value.filter((r) => r.id || r.label.trim() || String(r.percent).trim());
      const out = [];
      for (const r of filled) {
        const percent = parseAmount(r.percent);
        if (!r.label.trim()) return complain(r, `«${accountName(r.account_id)}»: напишите категорию кэшбэка, как в банке`);
        if (!(percent > 0 && percent <= 100)) return complain(r, `«${r.label}»: укажите процент от 0 до 100`);
        out.push({ id: r.id, month: isoDate(month.value), account_id: r.account_id, label: r.label.trim(), percent, category_ids: [...r.category_ids] });
      }
      busy.value = true;
      try {
        await saveCashbackMonth(out, removed.value);
        // Окно остаётся открытым: новые строки уходят в список по картам.
        rows.value = filled.map((r, i) => ({ ...r, id: out[i].id, label: out[i].label, _new: false }));
        removed.value = [];
      } catch {
        // Часть уже сохранилась: запоминаем полученные номера, чтобы не создать их повторно.
        out.forEach((o, i) => { if (o.id) filled[i].id = o.id; });
      } finally { busy.value = false; }
    }

    return {
      month, rows, loading, busy, error, badKey, cards, tree, cardId, byCard, drafts, currentCard, LABELS,
      shift: (n) => { month.value = addMonths(month.value, n); },
      copyPrevious, addRow, removeRow, chipsOf, unpick, pickingFor, cardGroups, save, monthLabel, groupLabel, categoryLabel,
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

        <!-- Карта, под ней новые (ещё не сохранённые) строки, под ними кнопка — она съезжает вниз с каждой строкой. -->
        <div class="cb-new stack">
          <account-select v-model="cardId" :groups="cardGroups" label="Карта"/>
          <cashback-row v-for="r in drafts" :key="r._key" :row="r" :chips="chipsOf(r)" :class="{ invalid: badKey === r._key }"
            @remove="removeRow(r)" @pick="pickingFor = r" @unpick="(ids) => unpick(r, ids)"/>
          <button type="button" class="btn" @click="addRow"><icon name="plus"/> Добавить кэшбэк{{ currentCard ? ' на «' + currentCard.name + '»' : '' }}</button>
          <datalist id="cb-labels"><option v-for="l in LABELS" :key="l" :value="l"></option></datalist>
        </div>

        <p v-if="loading" class="empty">Загрузка…</p>
        <div v-else-if="!byCard.length && !drafts.length" class="empty">
          <p>На этот месяц кэшбэки не выбраны.</p>
          <button class="btn" @click="copyPrevious">Скопировать с прошлого месяца</button>
        </div>

        <div v-for="g in byCard" :key="g.account.id" class="cb-card">
          <div class="field-label cb-card-head"><card-chip :account="g.account" size="sm"/> {{ g.account.name }}</div>
          <cashback-row v-for="r in g.rows" :key="r._key" :row="r" :chips="chipsOf(r)" :class="{ invalid: badKey === r._key }"
            @remove="removeRow(r)" @pick="pickingFor = r" @unpick="(ids) => unpick(r, ids)"/>
        </div>
        <category-checklist v-if="pickingFor" :tree="tree" v-model="pickingFor.category_ids" @close="pickingFor = null"/>
        <p v-if="error" class="form-error" role="alert">{{ error }}</p>
      </div>
      <template #footer>
        <span class="spacer"></span>
        <button type="button" class="btn ghost" @click="$emit('close')">Закрыть</button>
        <button type="button" class="btn primary" :disabled="busy || loading" @click="save">Сохранить кэшбэк</button>
      </template>
    </modal>`,
};

// Окно «Оплатить»: какой картой платить. Открыть Mir Pay из веб-приложения нельзя:
// браузер запускает только приложения с открытыми ссылками, а у Mir Pay их нет.
const PaySheet = {
  components: { Modal, CardChip },
  props: { cashback: Object },
  emits: ['close'],
  setup(props) {
    const account = computed(() => state.accounts.find((a) => a.id === props.cashback.account_id));
    return { account, formatPercent };
  },
  template: `
    <modal :title="cashback.label + ' — ' + formatPercent(cashback.percent)" @close="$emit('close')">
      <div class="pay-sheet">
        <card-chip v-if="account" :account="account" size="xl"/>
        <b class="pay-card-name">{{ account?.name ?? 'Удалённый счёт' }}<template v-if="account?.card_last4"> •• {{ account.card_last4 }}</template></b>
        <p class="hint">Платите этой картой: откройте Mir Pay, пролистайте до неё и приложите телефон к терминалу.</p>
      </div>
    </modal>`,
};

// Карточка на главной: какой картой что покупать в этом месяце.
export const CashbackCard = {
  components: { Icon, CashbackEditor, PaySheet, CardChip },
  setup() {
    const editing = ref(false);
    const paying = ref(null);
    // Каждая категория кэшбэка («Супермаркеты») — одной строкой, рядом все карты с ней: выгоднейшая первой.
    const groups = computed(() => {
      const order = new Map(ACCOUNT_TYPES
        .flatMap((t) => state.accounts.filter((a) => typeOf(a).id === t.id).sort(bySort))
        .map((a, i) => [a.id, i]));
      const pos = (c) => order.get(c.account_id) ?? Infinity;
      const byPercent = (a, b) => Number(b.percent) - Number(a.percent) || pos(a) - pos(b);
      const map = new Map();
      for (const c of state.cashbacks) {
        const account = state.accounts.find((a) => a.id === c.account_id);
        if (!account || account.archived) continue;
        const key = c.label.trim().toLowerCase();
        if (!map.has(key)) map.set(key, { key, label: c.label.trim(), items: [] });
        map.get(key).items.push(c);
      }
      const list = [...map.values()];
      list.forEach((g) => g.items.sort(byPercent));
      // Порядок строк — как у карт на главной (по лучшей карте строки), у одной карты — по проценту.
      return list.sort((a, b) => pos(a.items[0]) - pos(b.items[0]) || byPercent(a.items[0], b.items[0]));
    });
    const IN_MONTH = ['январе', 'феврале', 'марте', 'апреле', 'мае', 'июне', 'июле', 'августе', 'сентябре', 'октябре', 'ноябре', 'декабре'];
    const accountOf = (id) => state.accounts.find((a) => a.id === id);
    return { editing, paying, groups, accountName, accountOf, formatPercent, inMonth: IN_MONTH[new Date().getMonth()] };
  },
  template: `
    <div class="card pad cashback-card">
      <div class="card-head nowrap-head">
        <h2>💳 Кэшбэк в {{ inMonth }}</h2>
        <button class="btn small" @click="editing = true">{{ groups.length ? 'Изменить' : 'Выбрать' }}</button>
      </div>
      <p v-if="!groups.length" class="hint">Отметьте, какие кэшбэки вы выбрали в банках в этом месяце, — здесь будет видно, какой картой что выгоднее покупать.</p>
      <ul v-else class="cb-best">
        <li v-for="g in groups" :key="g.key" class="cb-line">
          <span class="cb-label">{{ g.label }}</span>
          <span class="cb-cards">
            <button v-for="c in g.items" :key="c.id" type="button" class="cb-card-btn"
              :aria-label="accountName(c.account_id) + ', кэшбэк ' + formatPercent(c.percent)" :title="accountName(c.account_id)" @click="paying = c">
              <card-chip :account="accountOf(c.account_id)" size="cb" :percent="formatPercent(c.percent)"/>
            </button>
          </span>
        </li>
      </ul>
      <cashback-editor v-if="editing" @close="editing = false"/>
      <pay-sheet v-if="paying" :cashback="paying" @close="paying = null"/>
    </div>`,
};
