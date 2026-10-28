import { ref, reactive, computed, watch, onMounted, nextTick } from 'vue';
import { state, isAdmin, canEditTx, saveTransaction, deleteTransaction, toast } from '../store.js';
import { money, dayLabel, today, parseAmount, amountToInput, localGet, localSet, bySort } from '../utils.js';
import { ACCOUNT_TYPES, typeOf } from '../account-types.js';
import { categoryTree, groupLabel } from '../categories.js';
import { Icon, Modal, MonthSwitcher } from '../components.js';
import { ImportView } from './import.js';
import { cashbackHint } from './cashback.js';

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
  components: { Icon, MonthSwitcher, ImportView },
  emits: ['edit'],
  setup() {
    const { categoryById, accountById } = useLookups();
    const importing = ref(false);
    const list = computed(() => state.transactions);

    const totals = computed(() => {
      let income = 0, expense = 0;
      for (const t of list.value) {
        if (t.kind === 'income') income += Number(t.amount);
        if (t.kind === 'expense') expense += Number(t.amount);
      }
      return { income, expense, diff: income - expense };
    });

    const groups = computed(() => {
      const out = [];
      for (const t of list.value) {
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

    return { state, importing, totals, groups, view, listView, money, dayLabel };
  },
  template: `
    <section class="page">
      <header class="page-head">
        <h1 class="page-title">Операции</h1>
        <button id="import-screenshot" class="btn" @click="importing = true"><span aria-hidden="true">📷</span> Со скриншота</button>
        <month-switcher/>
      </header>
      <import-view v-if="importing" @close="importing = false"/>

      <div class="summary">
        <div class="stat"><span class="stat-label">Доходы</span><span class="stat-value income">{{ money(totals.income) }}</span></div>
        <div class="stat"><span class="stat-label">Расходы</span><span class="stat-value">{{ money(totals.expense) }}</span></div>
        <div class="stat"><span class="stat-label">Итог месяца</span>
          <span :class="['stat-value', totals.diff < 0 ? 'negative' : 'income']">{{ totals.diff > 0 ? '+' : '' }}{{ money(totals.diff) }}</span></div>
      </div>

      <div class="view-bar">
        <span v-if="listView === 'table'" class="view-legend">
          <span class="negative">← расходы</span><span>переводы</span><span class="income">доходы →</span>
        </span>
        <span v-else></span>
        <div class="segmented mini" role="radiogroup" aria-label="Вид списка">
          <button :class="{ active: listView === 'table' }" @click="listView = 'table'">Как в таблице</button>
          <button :class="{ active: listView === 'list' }" @click="listView = 'list'">Обычный</button>
        </div>
      </div>

      <p v-if="state.txLoading && !groups.length" class="empty">Загрузка…</p>
      <div v-else-if="!groups.length" class="empty">
        <p>В этом месяце операций пока нет.</p>
        <button class="btn primary" @click="$emit('edit', null)"><icon name="plus"/> Добавить первую</button>
      </div>

      <div v-for="g in groups" :key="g.date" class="day">
        <div class="day-head">
          <span>{{ dayLabel(g.date) }}</span>
          <span v-if="g.expense" class="muted">−{{ money(g.expense) }}</span>
        </div>
        <div v-if="listView === 'table'" class="card list">
          <button v-for="t in g.items" :key="t.id" :class="['tx3', t.kind]" @click="$emit('edit', t)">
            <template v-if="t.kind === 'expense'">
              <span class="z-left tx3-amount negative">−{{ money(t.amount) }}</span>
              <span class="z-mid"><span class="tx3-cat">{{ view(t).icon }} {{ view(t).title }}</span><small v-if="t.note">{{ t.note }}</small></span>
              <span class="z-right tx3-acc"><span aria-hidden="true">{{ view(t).acc?.icon }}</span> {{ view(t).acc?.name ?? '?' }}</span>
            </template>
            <template v-else-if="t.kind === 'income'">
              <span class="z-left tx3-acc"><span aria-hidden="true">{{ view(t).acc?.icon }}</span> {{ view(t).acc?.name ?? '?' }}</span>
              <span class="z-mid"><span class="tx3-cat">{{ view(t).icon }} {{ view(t).title }}</span><small v-if="t.note">{{ t.note }}</small></span>
              <span class="z-right tx3-amount income">+{{ money(t.amount) }}</span>
            </template>
            <template v-else>
              <span class="z-left tx3-acc"><span aria-hidden="true">{{ view(t).acc?.icon }}</span> {{ view(t).acc?.name ?? '?' }}</span>
              <span class="z-mid"><span class="tx3-amount">{{ money(t.amount) }}</span><small class="tx3-arrow">перевод →</small>
                <small v-if="t.note">{{ t.note }}</small></span>
              <span class="z-right tx3-acc"><span aria-hidden="true">{{ view(t).to?.icon }}</span> {{ view(t).to?.name ?? '?' }}</span>
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
  components: { Modal, Icon },
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
    }

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
      state, form, tree, selected, archivedSelected, open, toggleOpen, pick, accountGroups,
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
            </div>
          </div>

          <div class="row-2">
            <label class="field">
              <span>{{ form.kind==='transfer' ? 'Откуда' : 'Счёт' }}</span>
              <select v-model="form.account_id">
                <optgroup v-for="g in accountGroups" :key="g.id" :label="g.label">
                  <option v-for="a in g.items" :key="a.id" :value="a.id">{{ a.icon }} {{ a.name }}</option>
                </optgroup>
              </select>
            </label>
            <label v-if="form.kind==='transfer'" class="field">
              <span>Куда</span>
              <select v-model="form.to_account_id">
                <optgroup v-for="g in accountGroups" :key="g.id" :label="g.label">
                  <option v-for="a in g.items" :key="a.id" :value="a.id">{{ a.icon }} {{ a.name }}</option>
                </optgroup>
              </select>
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
