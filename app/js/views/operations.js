import { ref, reactive, computed, watch, onMounted, nextTick } from 'vue';
import { state, isAdmin, canEditTx, saveTransaction, deleteTransaction, toast } from '../store.js?v=2610301632';
import { money, rub, dayLabel, today, parseAmount, amountToInput, localGet, localSet, bySort } from '../utils.js?v=2610301632';
import { ACCOUNT_TYPES, typeOf } from '../account-types.js?v=2610301632';
import { CategoryPicker } from './category-picker.js?v=2610301632';
import { Icon, Modal, MonthSwitcher, vLongPress } from '../components.js?v=2610301632';
import { cashbackHint } from './cashback.js?v=2610301632';
import { CardChip, AccountSelect } from '../cards.js?v=2610301632';

// Справочники для быстрого поиска по id — общие для списка и редактора.
export function useLookups() {
  const categoryById = computed(() => Object.fromEntries(state.categories.map((c) => [c.id, c])));
  const accountById = computed(() => Object.fromEntries(state.accounts.map((a) => [a.id, a])));
  const memberById = computed(() => Object.fromEntries(state.members.map((m) => [m.user_id, m])));
  return { categoryById, accountById, memberById };
}

// Чья это операция: выбранный участник, а для старых записей — тот, кто внёс.
export const ownerOf = (t) => t.spent_by ?? t.created_by;

// Заготовка новой операции по образцу старой: всё то же, но без номера, поэтому сохранится как новая.
export const copyOfTx = (t) => ({
  kind: t.kind, amount: t.amount, account_id: t.account_id, to_account_id: t.to_account_id,
  category_id: t.category_id, date: t.date, note: t.note, spent_by: ownerOf(t),
});

export const OperationsView = {
  components: { Icon, MonthSwitcher, CardChip },
  directives: { longPress: vLongPress },
  emits: ['edit', 'copy'],
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
        <div class="stat"><span class="stat-label">Расходы</span><span class="stat-value negative">{{ rub(totals.expense) }}</span></div>
        <div class="stat"><span class="stat-label">Итог месяца</span>
          <span :class="['stat-value', totals.diff < 0 ? 'negative' : 'income']">{{ Math.trunc(totals.diff) > 0 ? '+' : '' }}{{ rub(totals.diff) }}</span></div>
        <div class="stat"><span class="stat-label">Доходы</span><span class="stat-value income">{{ rub(totals.income) }}</span></div>
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
      <p v-else-if="!groups.length && state.offline" class="empty">Без интернета видны только месяцы, которые вы уже открывали.</p>
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
          <button v-for="t in g.items" :key="t.id" :class="['tx3', 'tx3-' + t.kind]" v-long-press="() => $emit('copy', t)" @click="$emit('edit', t)">
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
          <button v-for="t in g.items" :key="t.id" class="tx-row" v-long-press="() => $emit('copy', t)" @click="$emit('edit', t)">
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

export const TxEditor = {
  components: { Modal, Icon, AccountSelect, CategoryPicker },
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

    // Счета в выпадающем списке — по тем же группам, что на главной.
    const accountGroups = computed(() => ACCOUNT_TYPES
      .map((g) => ({ ...g, items: activeAccounts.value.filter((a) => typeOf(a).id === g.id).sort(bySort) }))
      .filter((g) => g.items.length));

    const author = t?.created_by && memberById.value[t.created_by]?.display_name;

    watch(() => form.kind, () => {
      if (categoryById.value[form.category_id]?.kind !== form.kind) form.category_id = null;
      if (form.kind === 'transfer' && !form.to_account_id) {
        form.to_account_id = activeAccounts.value.find((a) => a.id !== form.account_id && !a.archived)?.id ?? null;
      }
    });

    // В новой операции и в копии сразу можно вводить сумму; в копии старая сумма выделена и заменится при вводе.
    onMounted(() => { if (!t?.id) nextTick(() => { amountEl.value?.focus(); amountEl.value?.select(); }); });

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
      const after = now - effectOn(t?.id ? t : null, acc.id) + effectOn(draft, acc.id);
      if (after >= now) return '';
      if (type.id === 'credit') {
        const limit = Number(acc.credit_limit);
        if (!limit) return '';
        // Плюс на кредитке — сколько ещё можно снять (см. creditState): хватает, пока не ушли ниже нуля.
        if (now > 0 && after < 0) return `На «${acc.name}» доступно только ${money(now)}.`;
        if (now > 0 || after >= -limit) return '';
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
      state, form, accountGroups,
      readOnly, author, busy, error, warning, cashback, amountEl, save, remove, confirmDelete,
      title: readOnly ? 'Операция (просмотр)' : t?.id ? 'Операция' : t ? 'Копия операции' : 'Новая операция',
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
            <button type="button" role="radio" :aria-checked="form.kind==='expense'" :class="['k-expense', {active: form.kind==='expense'}]" @click="form.kind='expense'">Расход</button>
            <button type="button" role="radio" :aria-checked="form.kind==='transfer'" :class="{active: form.kind==='transfer'}" @click="form.kind='transfer'">Перевод</button>
            <button type="button" role="radio" :aria-checked="form.kind==='income'" :class="['k-income', {active: form.kind==='income'}]" @click="form.kind='income'">Доход</button>
          </div>

          <label class="amount-field">
            <span class="sr-only">Сумма</span>
            <input ref="amountEl" v-model="form.amount" inputmode="decimal" placeholder="0" autocomplete="off" aria-label="Сумма">
            <span class="currency">₽</span>
          </label>

          <div v-if="form.kind !== 'transfer'">
            <div class="field-label">Категория</div>
            <category-picker v-model="form.category_id" :kind="form.kind"/>
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
