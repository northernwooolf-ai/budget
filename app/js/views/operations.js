import { ref, reactive, computed, watch, onMounted, nextTick } from 'vue';
import { state, isAdmin, canEditTx, saveTransaction, deleteTransaction, toast } from '../store.js?v=2610290230';
import { money, rub, dayLabel, today, parseAmount, amountToInput, localGet, localSet, bySort } from '../utils.js?v=2610290230';
import { ACCOUNT_TYPES, typeOf } from '../account-types.js?v=2610290230';
import { categoryTree, groupLabel } from '../categories.js?v=2610290230';
import { Icon, Modal, MonthSwitcher } from '../components.js?v=2610290230';
import { cashbackHint } from './cashback.js?v=2610290230';
import { CardChip, AccountSelect } from '../cards.js?v=2610290230';

// Справочники для быстрого поиска по id — общие для списка и редактора.
export function useLookups() {
  const categoryById = computed(() => Object.fromEntries(state.categories.map((c) => [c.id, c])));
  const accountById = computed(() => Object.fromEntries(state.accounts.map((a) => [a.id, a])));
  const memberById = computed(() => Object.fromEntries(state.members.map((m) => [m.user_id, m])));
  return { categoryById, accountById, memberById };
}

// Чья это операция: выбранный участник, а для старых записей — тот, кто внёс.
export const ownerOf = (t) => t.spent_by ?? t.created_by;

export const OperationsView = {
  components: { Icon, MonthSwitcher, CardChip },
  emits: ['edit'],
  setup() {
    const { categoryById, accountById } = useLookups();
    const list = computed(() => state.transactions);

    const totals = computed(() => {
      let income = 0, expense = 0;
      for (const t of list.value) {
        if (t.kind === 'income') income += Number(t.amount);
        if (t.kind === 'expense') expense += Number(t.amount);
      }
      return { income, expense, diff: income - expense };
    });

    // Фильтр по типу: нажатие на «расходы / переводы / доходы» оставляет только их, повторное — снимает.
    const kindFilter = ref(null);
    const toggleKind = (k) => { kindFilter.value = kindFilter.value === k ? null : k; };

    const groups = computed(() => {
      const out = [];
      for (const t of list.value) {
        if (kindFilter.value && t.kind !== kindFilter.value) continue;
        let g = out[out.length - 1];
        if (!g || g.date !== t.date) out.push(g = { date: t.date, items: [], expense: 0 });
        g.items.push(t);
        if (t.kind === 'expense') g.expense += Number(t.amount);
      }
      return out;
    });

    function view(t) {
      const cat = categoryById.value[t.category_id];
      const acc = accountById.value[t.account_id];
      if (t.kind === 'transfer') {
        const to = accountById.value[t.to_account_id];
        return { icon: '🔄', title: 'Перевод', sub: [`${acc?.name ?? '?'} → ${to?.name ?? '?'}`, t.note], acc, to };
      }
      return { icon: cat?.icon ?? '❔', title: cat?.name ?? 'Без категории', sub: [t.note, acc?.name], acc };
    }

    // Вид «как в таблице»: расход слева, переводы посередине, доход справа — тип виден по месту суммы.
    const listView = ref(localGet('ops-view', 'table'));
    watch(listView, (v) => localSet('ops-view', v));

    const KINDS = [
      { id: 'expense', label: 'расходы', table: '← расходы', cls: 'negative' },
      { id: 'transfer', label: 'переводы', table: 'переводы', cls: '' },
      { id: 'income', label: 'доходы', table: 'доходы →', cls: 'income' },
    ];

    return { state, totals, groups, view, listView, kindFilter, toggleKind, KINDS, money, rub, dayLabel };
  },
  template: `
    <section class="page">
      <header class="page-head">
        <h1 class="page-title">Операции</h1>
        <month-switcher/>
      </header>

      <div class="summary">
        <div class="stat"><span class="stat-label">Доходы</span><span class="stat-value income">{{ rub(totals.income) }}</span></div>
        <div class="stat"><span class="stat-label">Расходы</span><span class="stat-value">{{ rub(totals.expense) }}</span></div>
        <div class="stat"><span class="stat-label">Итог месяца</span>
          <span :class="['stat-value', totals.diff < 0 ? 'negative' : 'income']">{{ Math.trunc(totals.diff) > 0 ? '+' : '' }}{{ rub(totals.diff) }}</span></div>
      </div>

      <!-- Переключатель по центру и не двигается. -->
      <div class="view-bar">
        <div class="segmented mini" role="radiogroup" aria-label="Вид списка">
          <button :class="{ active: listView === 'table' }" @click="listView = 'table'">Как в таблице</button>
          <button :class="{ active: listView === 'list' }" @click="listView = 'list'">Обычный</button>
        </div>
      </div>
      <!-- Плашка-фильтр прилипает к верху экрана при прокрутке; в виде «как в таблице» подписи стоят над своими колонками. -->
      <div :class="['plate', 'sticky-plate', 'view-legend', { filtered: kindFilter }]" role="group" aria-label="Показать только">
        <button v-for="k in KINDS" :key="k.id" type="button" :class="[k.cls, { on: kindFilter === k.id }]"
          :aria-pressed="kindFilter === k.id" @click="toggleKind(k.id)">
          {{ listView === 'table' ? k.table : k.label }}
        </button>
      </div>

      <p v-if="state.txLoading && !groups.length" class="empty">Загрузка…</p>
      <p v-else-if="!groups.length && kindFilter" class="empty">В этом месяце таких операций нет.</p>
      <div v-else-if="!groups.length" class="empty">
        <p>В этом месяце операций пока нет.</p>
        <button class="btn primary" @click="$emit('edit', null)"><icon name="plus"/> Добавить первую</button>
      </div>

      <div v-for="g in groups" :key="g.date" class="day">
        <div class="day-head">
          <span>{{ dayLabel(g.date) }}</span>
          <span v-if="g.expense" class="muted">−{{ rub(g.expense) }}</span>
        </div>
        <div v-if="listView === 'table'" class="card list">
          <button v-for="t in g.items" :key="t.id" :class="['tx3', 'tx3-' + t.kind]" @click="$emit('edit', t)">
            <template v-if="t.kind === 'expense'">
              <span class="z-left tx3-amount negative">−{{ money(t.amount) }}</span>
              <span class="z-mid"><span class="tx3-cat">{{ view(t).icon }} {{ view(t).title }}</span><small v-if="t.note">{{ t.note }}</small></span>
              <span class="z-right tx3-acc"><card-chip :account="view(t).acc" size="sm"/><span class="acc-name">{{ view(t).acc?.name ?? '?' }}</span></span>
            </template>
            <template v-else-if="t.kind === 'income'">
              <span class="z-left tx3-acc"><card-chip :account="view(t).acc" size="sm"/><span class="acc-name">{{ view(t).acc?.name ?? '?' }}</span></span>
              <span class="z-mid"><span class="tx3-cat">{{ view(t).icon }} {{ view(t).title }}</span><small v-if="t.note">{{ t.note }}</small></span>
              <span class="z-right tx3-amount income">+{{ money(t.amount) }}</span>
            </template>
            <template v-else>
              <span class="z-left tx3-acc"><card-chip :account="view(t).acc" size="sm"/><span class="acc-name">{{ view(t).acc?.name ?? '?' }}</span></span>
              <span class="z-mid"><span class="tx3-amount">{{ money(t.amount) }}</span><small class="tx3-arrow">перевод →</small>
                <small v-if="t.note">{{ t.note }}</small></span>
              <span class="z-right tx3-acc"><card-chip :account="view(t).to" size="sm"/><span class="acc-name">{{ view(t).to?.name ?? '?' }}</span></span>
            </template>
          </button>
        </div>
        <div v-else class="card list">
          <button v-for="t in g.items" :key="t.id" class="tx-row" @click="$emit('edit', t)">
            <span class="tx-icon" aria-hidden="true">{{ view(t).icon }}</span>
            <span class="tx-main">
              <span class="tx-title">{{ view(t).title }}</span>
              <span class="tx-sub">{{ view(t).sub.filter(Boolean).join(' · ') }}</span>
            </span>
            <span :class="['tx-amount', t.kind]">
              {{ t.kind === 'income' ? '+' : t.kind === 'expense' ? '−' : '' }}{{ money(t.amount) }}
            </span>
          </button>
        </div>
      </div>
    </section>`,
};

const lastGroupKey = (kind) => `last-cat-group-${kind}`;

export const TxEditor = {
  components: { Modal, Icon, AccountSelect },
  props: { tx: Object },
  emits: ['close'],
  setup(props, { emit }) {
    const t = props.tx;
    const { categoryById, memberById } = useLookups();
    const admin = isAdmin();
    const readOnly = !canEditTx(t);
    const activeAccounts = computed(() => state.accounts.filter((a) => !a.archived || a.id === form.account_id || a.id === form.to_account_id));
    const firstAccount = () => state.accounts.find((a) => !a.archived)?.id ?? null;
    const lastAccount = localGet('last-account');

    const form = reactive({
      id: t?.id,
      kind: t?.kind ?? 'expense',
      amount: amountToInput(t?.amount),
      category_id: t?.category_id ?? null,
      account_id: t?.account_id ?? (state.accounts.some((a) => a.id === lastAccount && !a.archived) ? lastAccount : firstAccount()),
      to_account_id: t?.to_account_id ?? null,
      date: t?.date ?? today(),
      note: t?.note ?? '',
      spent_by: t ? ownerOf(t) : state.me.user_id,
    });
    const busy = ref(false);
    const error = ref('');
    const amountEl = ref(null);

    // Категории по разделам. Раскрыт раздел выбранной категории или последний использованный.
    const tree = computed(() => categoryTree(form.kind));
    const selected = computed(() => categoryById.value[form.category_id]);
    const archivedSelected = computed(() => (selected.value?.archived ? selected.value : null));
    const open = reactive(new Set());
    function openDefault() {
      open.clear();
      const g = selected.value?.group_id ?? localGet(lastGroupKey(form.kind));
      if (g) open.add(g);
    }
    openDefault();
    const toggleOpen = (id) => (open.has(id) ? open.delete(id) : open.add(id));
    function pick(c) {
      form.category_id = c.id;
      if (c.group_id) localSet(lastGroupKey(form.kind), c.group_id);
      if (query.value) {
        query.value = '';
        open.clear();
        if (c.group_id) open.add(c.group_id);
      }
    }

    // Поиск категории по первым буквам: сначала те, где слово начинается с введённого.
    const query = ref('');
    const found = computed(() => {
      const q = query.value.trim().toLowerCase();
      if (!q) return [];
      const all = [...tree.value.sections.flatMap((s) => s.items), ...tree.value.loose];
      const rank = (c) => {
        const name = c.name.toLowerCase();
        if (name.startsWith(q)) return 0;
        if (name.split(/[\s,.\-–—()]+/).some((w) => w.startsWith(q))) return 1;
        return name.includes(q) ? 2 : -1;
      };
      return all.map((c) => ({ c, r: rank(c) })).filter((x) => x.r >= 0).sort((a, b) => a.r - b.r).map((x) => x.c);
    });
    const pickFirstFound = () => { if (found.value.length) pick(found.value[0]); };

    // Счета в выпадающем списке — по тем же группам, что на главной.
    const accountGroups = computed(() => ACCOUNT_TYPES
      .map((g) => ({ ...g, items: activeAccounts.value.filter((a) => typeOf(a).id === g.id).sort(bySort) }))
      .filter((g) => g.items.length));

    const author = t?.created_by && memberById.value[t.created_by]?.display_name;

    watch(() => form.kind, () => {
      if (selected.value?.kind !== form.kind) form.category_id = null;
      openDefault();
      if (form.kind === 'transfer' && !form.to_account_id) {
        form.to_account_id = activeAccounts.value.find((a) => a.id !== form.account_id && !a.archived)?.id ?? null;
      }
    });

    onMounted(() => { if (!t) nextTick(() => amountEl.value?.focus()); });

    // Как операция меняет остаток счёта accId (для старой версии при редактировании — тоже).
    function effectOn(tx, accId) {
      if (!tx) return 0;
      const amount = Number(tx.amount);
      if (tx.kind === 'transfer' && tx.to_account_id === accId) return amount;
      if (tx.account_id === accId) return tx.kind === 'income' ? amount : -amount;
      return 0;
    }

    // Текст предупреждения, если после операции на счёте станет минус
    // (для кредитки — если долг превысит кредитный лимит). Долги «нам/мы должны» не проверяем.
    function overdraftWarning(draft) {
      if (draft.kind === 'income') return '';
      const acc = state.accounts.find((a) => a.id === draft.account_id);
      const type = typeOf(acc);
      if (type.id === 'lent' || type.id === 'borrowed') return '';
      const now = state.balances[acc.id] ?? Number(acc.initial_balance);
      const after = now - effectOn(t, acc.id) + effectOn(draft, acc.id);
      if (after >= now) return '';
      if (type.id === 'credit') {
        const limit = Number(acc.credit_limit);
        if (!limit || after >= -limit) return '';
        return `По «${acc.name}» долг станет ${money(-after)} — больше кредитного лимита ${money(limit)}.`;
      }
      if (after >= 0) return '';
      return `На «${acc.name}» сейчас ${money(now)}, после операции станет ${money(after)}.`;
    }
    const warning = ref('');
    // Подсказка, какой картой эту трату выгоднее оплатить по кэшбэку месяца.
    const cashback = computed(() => (form.kind === 'expense' && form.category_id
      ? cashbackHint(form.category_id, form.account_id) : null));
    watch(() => [form.amount, form.account_id, form.kind, form.to_account_id], () => { warning.value = ''; });

    async function save() {
      error.value = '';
      const amount = parseAmount(form.amount);
      if (!(amount > 0)) return (error.value = 'Введите сумму больше нуля');
      if (!form.account_id) return (error.value = 'Выберите счёт');
      if (form.kind === 'transfer') {
        if (!form.to_account_id) return (error.value = 'Выберите, на какой счёт перевод');
        if (form.to_account_id === form.account_id) return (error.value = 'Счета перевода должны различаться');
      } else if (!form.category_id) return (error.value = 'Выберите категорию');

      const draft = {
        id: form.id,
        kind: form.kind,
        amount,
        account_id: form.account_id,
        to_account_id: form.kind === 'transfer' ? form.to_account_id : null,
        category_id: form.kind === 'transfer' ? null : form.category_id,
        date: form.date || today(),
        note: form.note.trim() || null,
        // «Чья трата» в интерфейсе больше не выбирается: у старых записей сохраняется,
        // у новых — тот, кто внёс (на этом держатся права участника).
        spent_by: admin ? form.spent_by : state.me.user_id,
      };
      // Уход в минус: первое нажатие предупреждает, второе сохраняет.
      const overdraft = overdraftWarning(draft);
      if (overdraft && warning.value !== overdraft) return (warning.value = overdraft);

      busy.value = true;
      try {
        await saveTransaction(draft);
        localSet('last-account', form.account_id);
        emit('close');
      } catch {
        // ошибку уже показали всплывающим сообщением
      } finally {
        busy.value = false;
      }
    }

    // Удаление в два нажатия: первое спрашивает, второе удаляет.
    const confirmDelete = ref(false);
    async function remove() {
      if (!confirmDelete.value) return (confirmDelete.value = true);
      busy.value = true;
      try {
        await deleteTransaction(form.id);
        emit('close');
      } catch { /* показано */ } finally {
        busy.value = false;
      }
    }

    if (!state.accounts.some((a) => !a.archived)) toast('Сначала добавьте счёт на главной', 'error');

    return {
      state, form, tree, selected, archivedSelected, open, toggleOpen, pick, accountGroups, query, found, pickFirstFound,
      readOnly, author, busy, error, warning, cashback, amountEl, save, remove, confirmDelete,
      groupLabel, title: readOnly ? 'Операция (просмотр)' : t ? 'Операция' : 'Новая операция',
    };
  },
  template: `
    <modal :title="title" @close="$emit('close')">
      <p v-if="readOnly" class="readonly-note">
        Эту запись сделал(а) {{ author ?? 'другой участник' }}. Изменить её может только администратор бюджета.
      </p>
      <form id="tx-form" class="stack" @submit.prevent="save">
        <fieldset class="plain stack" :disabled="readOnly">
          <div class="segmented kind-switch" role="radiogroup" aria-label="Тип операции">
            <button type="button" role="radio" :aria-checked="form.kind==='expense'" :class="{active: form.kind==='expense'}" @click="form.kind='expense'">Расход</button>
            <button type="button" role="radio" :aria-checked="form.kind==='income'" :class="{active: form.kind==='income'}" @click="form.kind='income'">Доход</button>
            <button type="button" role="radio" :aria-checked="form.kind==='transfer'" :class="{active: form.kind==='transfer'}" @click="form.kind='transfer'">Перевод</button>
          </div>

          <label class="amount-field">
            <span class="sr-only">Сумма</span>
            <input ref="amountEl" v-model="form.amount" inputmode="decimal" placeholder="0" autocomplete="off" aria-label="Сумма">
            <span class="currency">₽</span>
          </label>

          <div v-if="form.kind !== 'transfer'">
            <div class="field-label">Категория</div>
            <div class="picker">
              <label class="cat-search">
                <icon name="search" :size="18"/>
                <!-- Не v-model: клавиатура телефона набирает слово «черновиком», и v-model ждёт его окончания. -->
                <input :value="query" @input="query = $event.target.value" type="search" placeholder="Поиск категории" aria-label="Поиск категории"
                  autocomplete="off" enterkeyhint="done" @keydown.enter.prevent="pickFirstFound">
              </label>
              <template v-if="query.trim()">
                <div v-if="found.length" class="cat-grid" role="radiogroup" aria-label="Найденные категории">
                  <button v-for="c in found" :key="c.id" type="button" role="radio" :aria-checked="form.category_id===c.id"
                    :class="['cat-opt', {selected: form.category_id===c.id}]" @click="pick(c)">
                    <span v-if="tree.nums[c.id]" class="cat-num">{{ tree.nums[c.id] }}</span>
                    <span class="cat-emoji" aria-hidden="true">{{ c.icon }}</span><span class="cat-name">{{ c.name }}</span>
                  </button>
                </div>
                <p v-else class="hint">Ничего не нашлось</p>
              </template>
              <template v-else>
              <div v-if="archivedSelected" class="cat-grid">
                <button type="button" class="cat-opt selected">
                  <span class="cat-emoji" aria-hidden="true">{{ archivedSelected.icon }}</span>
                  <span class="cat-name">{{ archivedSelected.name }} (в архиве)</span>
                </button>
              </div>
              <div v-for="s in tree.sections" :key="s.group.id" class="picker-section">
                <button type="button" :class="['picker-head', { open: open.has(s.group.id) }]"
                  :aria-expanded="open.has(s.group.id)" @click="toggleOpen(s.group.id)">
                  <icon name="down" :class="['chev', { closed: !open.has(s.group.id) }]" :size="18"/>
                  <span class="picker-title">{{ groupLabel(tree, s.group) }}</span>
                  <span v-if="selected && selected.group_id === s.group.id && !open.has(s.group.id)" class="picker-picked">
                    {{ selected.icon }} {{ selected.name }}</span>
                </button>
                <div v-show="open.has(s.group.id)" class="cat-grid" role="radiogroup" :aria-label="s.group.name">
                  <button v-for="c in s.items" :key="c.id" type="button" role="radio" :aria-checked="form.category_id===c.id"
                    :class="['cat-opt', {selected: form.category_id===c.id}]" @click="pick(c)">
                    <span class="cat-num">{{ tree.nums[c.id] }}</span>
                    <span class="cat-emoji" aria-hidden="true">{{ c.icon }}</span><span class="cat-name">{{ c.name }}</span>
                  </button>
                </div>
              </div>
              <div v-if="tree.loose.length" class="cat-grid" role="radiogroup" aria-label="Категории без раздела">
                <button v-for="c in tree.loose" :key="c.id" type="button" role="radio" :aria-checked="form.category_id===c.id"
                  :class="['cat-opt', {selected: form.category_id===c.id}]" @click="pick(c)">
                  <span class="cat-emoji" aria-hidden="true">{{ c.icon }}</span><span class="cat-name">{{ c.name }}</span>
                </button>
              </div>
              </template>
            </div>
          </div>

          <div class="row-2">
            <label class="field">
              <span>{{ form.kind==='transfer' ? 'Откуда' : 'Счёт' }}</span>
              <account-select v-model="form.account_id" :groups="accountGroups" :label="form.kind==='transfer' ? 'Откуда' : 'Счёт'"/>
            </label>
            <label v-if="form.kind==='transfer'" class="field">
              <span>Куда</span>
              <account-select v-model="form.to_account_id" :groups="accountGroups" label="Куда"/>
            </label>
            <label v-else class="field">
              <span>Дата</span>
              <input v-model="form.date" type="date">
            </label>
          </div>
          <label v-if="form.kind==='transfer'" class="field">
            <span>Дата</span>
            <input v-model="form.date" type="date">
          </label>
          <label class="field">
            <span>Комментарий</span>
            <input v-model="form.note" maxlength="200" placeholder="Необязательно">
          </label>
          <div v-if="cashback && !readOnly" :class="['cb-hint', cashback.kind]">
            <template v-if="cashback.kind === 'ok'">✓ Кэшбэк {{ String(cashback.percent).replace('.', ',') }}% по этой карте ({{ cashback.label }})</template>
            <template v-else>
              <span>💡 Выгоднее картой «{{ cashback.accountName }}» — кэшбэк {{ String(cashback.percent).replace('.', ',') }}% ({{ cashback.label }})</span>
              <button type="button" class="btn small" @click="form.account_id = cashback.accountId">Выбрать</button>
            </template>
          </div>
          <div v-if="warning" class="warn-box" role="alert">
            <b>⚠ Счёт уйдёт в минус</b>
            <span>{{ warning }} Проверьте сумму и счёт. Если всё верно, нажмите «Сохранить всё равно».</span>
          </div>
          <p v-if="error" class="form-error" role="alert">{{ error }}</p>
        </fieldset>
      </form>
      <template #footer>
        <template v-if="!readOnly">
          <button v-if="form.id" type="button" :class="['btn', confirmDelete ? 'danger' : 'danger-ghost']" :disabled="busy" @click="remove">{{ confirmDelete ? 'Точно удалить?' : 'Удалить' }}</button>
          <span class="spacer"></span>
          <button type="button" class="btn ghost" @click="$emit('close')">Отмена</button>
          <button type="submit" form="tx-form" class="btn primary" :disabled="busy">
            {{ busy ? 'Сохраняю…' : warning ? 'Сохранить всё равно' : 'Сохранить' }}</button>
        </template>
        <template v-else>
          <span class="spacer"></span>
          <button type="button" class="btn" @click="$emit('close')">Закрыть</button>
        </template>
      </template>
    </modal>`,
};
