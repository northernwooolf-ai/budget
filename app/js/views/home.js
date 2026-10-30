// Главная: сводка, счета по группам, выписка по счёту и редактор счёта.
import { ref, reactive, computed, watch } from 'vue';
import { api } from '../api.js?v=2610301506';
import { state, isAdmin, saveAccount, saveStartBalances, deleteAccount, setArchived, reorder, toast } from '../store.js?v=2610301506';
import { limitStatus } from '../categories.js?v=2610301506';
import { expanded, toggleIn, simpleView } from '../ui-state.js?v=2610301506';
import { money, rub, parseAmount, amountToInput, bySort, localGet, localSet, monthLabel, parseIso } from '../utils.js?v=2610301506';
import { ACCOUNT_TYPES, typeOf, isDebt, peopleNote, canBeLiquid, creditState } from '../account-types.js?v=2610301506';
import { Icon, Modal, EmojiPicker, ConfirmButton, DragLockButton, vSortable } from '../components.js?v=2610301506';
import { useLookups } from './operations.js?v=2610301506';
import { CashbackCard } from './cashback.js?v=2610301506';
import { CardChip, CARD_STYLES, defaultStyle, isCardType, cardImageFromFile } from '../cards.js?v=2610301506';

const balanceOf = (a) => state.balances[a.id] ?? Number(a.initial_balance);

function creditInfo(a) {
  if (a.type !== 'credit' || !Number(a.credit_limit)) return '';
  const balance = balanceOf(a), { limit, available, debt } = creditState(a, balance);
  // В строке уже видна одна из сумм, рядом показываем вторую.
  return balance > 0 ? `долг ${money(debt)} из ${money(limit)}` : `доступно ${money(available)} из ${money(limit)}`;
}

const AccountRow = {
  components: { Icon, ConfirmButton, CardChip },
  props: { account: Object, archived: Boolean, plain: Boolean }, // plain — без перетаскивания и кнопок (упрощённый вид)
  emits: ['open'],
  setup(props) {
    const balance = computed(() => balanceOf(props.account));
    const sub = computed(() => creditInfo(props.account)
      || (typeOf(props.account).people ? peopleNote(balance.value) : '')
      || (props.archived ? typeOf(props.account).label : ''));
    const archive = (value) => setArchived('accounts', props.account, value).catch(() => {});
    const remove = () => deleteAccount(props.account.id).catch(() => {});
    return { balance, sub, archive, remove, money, admin: computed(isAdmin) };
  },
  template: `
    <div :class="['row', 's-item', { muted: archived }]">
      <span v-if="admin && !archived && !plain" class="drag-handle" title="Перетащите, чтобы поменять порядок"><icon name="grip"/></span>
      <button class="row-main" @click="$emit('open', account)">
        <card-chip :account="account" size="md"/>
        <span class="tx-main">
          <span class="tx-title">{{ account.name }}</span>
          <span class="tx-sub">{{ sub }}</span>
        </span>
        <span :class="['tx-amount', { negative: balance < 0 }]">{{ money(balance) }}</span>
      </button>
      <template v-if="!admin || plain"></template>
      <confirm-button v-else-if="!archived" label="Убрать в архив" confirm-text="В архив?" @confirm="archive(true)"/>
      <template v-else>
        <button class="icon-btn" title="Вернуть из архива" aria-label="Вернуть из архива" @click="archive(false)"><icon name="undo" :size="18"/></button>
        <confirm-button label="Удалить навсегда" confirm-text="Удалить навсегда?" @confirm="remove"/>
      </template>
    </div>`,
};

export const AccountEditor = {
  components: { Modal, EmojiPicker, CardChip },
  props: { account: Object },
  emits: ['close'],
  setup(props, { emit }) {
    const a = props.account;
    const type = a.type ?? 'debit';
    const initial = Number(a.initial_balance ?? 0);
    const form = reactive({
      id: a.id,
      type,
      name: a.name ?? '',
      icon: a.icon ?? typeOf({ type }).icon,
      // Долги вводятся положительным числом, а хранятся со знаком минус.
      initial_balance: amountToInput(isDebt(type) ? -initial : initial),
      credit_limit: amountToInput(a.credit_limit),
      archived: a.archived ?? false,
      sort: a.sort ?? state.accounts.length + 1,
      card_style: a.card_style ?? null,
      card_last4: a.card_last4 ?? '',
      card_image: a.card_image ?? null,
      liquid: a.liquid ?? false,
    });
    const busy = ref(false);
    const error = ref('');
    // Вид карты: пока стиль не выбран вручную, он подбирается по банку из названия.
    const preview = computed(() => ({ ...form, card_style: form.card_style ?? defaultStyle(form) }));
    const showCard = computed(() => isCardType(form));
    const imageInput = ref(null);
    async function onCardImage(e) {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (!file) return;
      try { form.card_image = await cardImageFromFile(file); } catch { error.value = 'Не удалось прочитать картинку'; }
    }
    const balanceLabel = computed(() => ({
      credit: 'Долг по карте на начало учёта, ₽',
      borrowed: 'Сколько осталось выплатить на начало учёта, ₽',
      lent: 'Расчёт на начало учёта, ₽: плюс — должны нам, минус — мы должны',
    }[form.type] ?? 'Остаток на начало учёта, ₽'));

    watch(() => form.type, (t, old) => {
      // Значок по умолчанию следует за типом, пока его не выбрали вручную.
      if (form.icon === typeOf({ type: old }).icon) form.icon = typeOf({ type: t }).icon;
      // Для долговых счетов в поле вводится сумма долга, для остальных — остаток.
      // При смене одного на другое меняем знак, чтобы реальный остаток не изменился.
      const v = parseAmount(form.initial_balance);
      if (isDebt(t) !== isDebt(old) && v) form.initial_balance = amountToInput(-v);
    });

    async function save() {
      error.value = '';
      const value = form.initial_balance === '' ? 0 : parseAmount(form.initial_balance);
      const limit = form.credit_limit === '' ? null : parseAmount(form.credit_limit);
      if (!form.name.trim()) return (error.value = 'Введите название');
      if (Number.isNaN(value)) return (error.value = 'Сумма на начало учёта должна быть числом');
      if (limit !== null && !(limit > 0)) return (error.value = 'Кредитный лимит должен быть больше нуля или пустым');
      const last4 = String(form.card_last4 ?? '').trim();
      if (last4 && !/^\d{4}$/.test(last4)) return (error.value = 'Последние цифры карты — ровно 4 цифры');
      busy.value = true;
      try {
        await saveAccount({
          ...form,
          name: form.name.trim(),
          initial_balance: isDebt(form.type) ? -value : value,
          credit_limit: form.type === 'credit' ? limit : null,
          card_last4: last4 || null,
          // Поле отправляем, только когда оно важно: так счета сохраняются и до обновления базы.
          liquid: canBeLiquid(form.type) && form.liquid ? true : a.liquid ? false : undefined,
        });
        emit('close');
      } catch { /* показано */ } finally { busy.value = false; }
    }

    async function toggleArchive() {
      busy.value = true;
      try {
        await setArchived('accounts', a, !form.archived);
        emit('close');
      } catch { /* показано */ } finally { busy.value = false; }
    }

    return {
      form, busy, error, balanceLabel, save, toggleArchive, ACCOUNT_TYPES,
      preview, showCard, imageInput, onCardImage, CARD_STYLES, canBeLiquid,
    };
  },
  template: `
    <modal :title="form.id ? 'Счёт' : 'Новый счёт'" @close="$emit('close')">
      <form id="acc-form" class="stack" @submit.prevent="save">
        <div>
          <div class="field-label">Тип</div>
          <div class="type-grid" role="radiogroup" aria-label="Тип счёта">
            <button v-for="t in ACCOUNT_TYPES" :key="t.id" type="button" role="radio" :aria-checked="form.type===t.id"
              :class="['type-opt', {selected: form.type===t.id}]" @click="form.type=t.id">
              <span aria-hidden="true">{{ t.icon }}</span> {{ t.label }}
            </button>
          </div>
        </div>
        <label class="field"><span>Название</span>
          <input v-model="form.name" maxlength="40" required placeholder="Например, Сбербанк зарплатная"></label>
        <div v-if="showCard" class="stack card-designer">
          <div class="field-label">Вид карты</div>
          <div class="card-preview"><card-chip :account="preview" size="xl"/></div>
          <div class="style-grid" role="radiogroup" aria-label="Цвета карты">
            <button v-for="(s, id) in CARD_STYLES" :key="id" type="button" role="radio" :title="s.label" :aria-label="s.label"
              :aria-checked="preview.card_style === id && !form.card_image"
              :class="['style-opt', { selected: preview.card_style === id && !form.card_image }]"
              :style="{ background: s.bg }" @click="form.card_style = id; form.card_image = null"></button>
          </div>
          <input ref="imageInput" type="file" accept="image/*" hidden @change="onCardImage">
          <div class="btn-row">
            <button type="button" class="btn small" @click="imageInput.click()">{{ form.card_image ? 'Заменить картинку' : 'Своя картинка карты' }}</button>
            <button v-if="form.card_image" type="button" class="btn ghost small" @click="form.card_image = null">Убрать картинку</button>
          </div>
          <small class="hint">Картинку можно взять со скриншота карты из банковского приложения или Mir Pay — приложение обрежет её под форму карты.</small>
          <label class="field">
            <span>Последние 4 цифры карты</span>
            <input v-model="form.card_last4" inputmode="numeric" maxlength="4" placeholder="Например, 3244">
          </label>
        </div>
        <div v-else><div class="field-label">Значок</div><emoji-picker v-model="form.icon"/></div>
        <label class="field">
          <span>{{ balanceLabel }}</span>
          <input v-model="form.initial_balance" inputmode="decimal">
          <small class="hint">Дальше остаток считается сам по операциям и переводам</small>
        </label>
        <label v-if="form.type==='credit'" class="field">
          <span>Кредитный лимит, ₽</span>
          <input v-model="form.credit_limit" inputmode="decimal" placeholder="Необязательно">
          <small class="hint">Минус на карте — это долг. Плюс — сколько ещё можно снять: долг будет равен лимиту минус эта сумма.</small>
        </label>
        <div v-if="canBeLiquid(form.type)">
          <label class="check"><input id="acc-liquid" type="checkbox" v-model="form.liquid"> Ликвидный</label>
          <small class="hint">Деньги можно снять в любой день без потерь. Такой счёт прибавляется к доступным деньгам на главной, если там отмечено «С учётом ликвидных вкладов».</small>
        </div>
        <p v-if="error" class="form-error" role="alert">{{ error }}</p>
      </form>
      <template #footer>
        <button v-if="form.id" type="button" class="btn ghost" :disabled="busy" @click="toggleArchive">
          {{ form.archived ? 'Вернуть из архива' : 'В архив' }}</button>
        <span class="spacer"></span>
        <button type="button" class="btn ghost" @click="$emit('close')">Отмена</button>
        <button type="submit" form="acc-form" class="btn primary" :disabled="busy">Сохранить</button>
      </template>
    </modal>`,
};

// Стартовые остатки всех счетов в одной форме. Для долговых счетов вводится сумма долга.
const StartBalances = {
  components: { Modal },
  emits: ['close'],
  setup(props, { emit }) {
    const groups = ACCOUNT_TYPES.map((t) => ({
      ...t,
      rows: state.accounts.filter((a) => !a.archived && typeOf(a).id === t.id).sort(bySort).map((a) => {
        const initial = Number(a.initial_balance);
        return reactive({ account: a, value: amountToInput(t.debt ? -initial : initial) });
      }),
    })).filter((g) => g.rows.length);
    const busy = ref(false);
    const error = ref('');

    async function save() {
      error.value = '';
      const changes = [];
      for (const g of groups) {
        for (const r of g.rows) {
          const v = r.value === '' ? 0 : parseAmount(r.value);
          if (Number.isNaN(v)) return (error.value = `«${r.account.name}»: сумма должна быть числом`);
          const initial = g.debt ? -v : v;
          if (initial !== Number(r.account.initial_balance)) changes.push({ account: r.account, initial_balance: initial });
        }
      }
      if (!changes.length) return emit('close');
      busy.value = true;
      try {
        await saveStartBalances(changes);
        emit('close');
      } catch { /* показано */ } finally { busy.value = false; }
    }

    return { groups, busy, error, save };
  },
  template: `
    <modal title="Стартовые остатки" @close="$emit('close')">
      <form id="start-form" class="stack" @submit.prevent="save">
        <p class="hint">Сколько денег было на каждом счёте в момент, с которого вы начинаете учёт.
          Дальше остатки будут считаться сами по операциям и переводам.</p>
        <div v-for="g in groups" :key="g.id" class="stack start-group">
          <div class="field-label">{{ g.icon }} {{ g.label }}{{ g.debt ? ' — сумма долга' : '' }}</div>
          <label v-for="r in g.rows" :key="r.account.id" class="start-row">
            <span class="start-name">{{ r.account.icon }} {{ r.account.name }}</span>
            <span class="start-input"><input v-model="r.value" inputmode="decimal" placeholder="0"
              :aria-label="'Стартовый остаток: ' + r.account.name"> ₽</span>
          </label>
        </div>
        <p v-if="error" class="form-error" role="alert">{{ error }}</p>
      </form>
      <template #footer>
        <span class="spacer"></span>
        <button type="button" class="btn ghost" @click="$emit('close')">Отмена</button>
        <button type="submit" form="start-form" class="btn primary" :disabled="busy">Сохранить</button>
      </template>
    </modal>`,
};

// Выписка: все движения по счёту и остаток после каждого.
const AccountStatement = {
  components: { Modal, Icon, CardChip },
  props: { account: Object },
  emits: ['close', 'edit', 'edit-account'],
  setup(props) {
    const { categoryById, accountById } = useLookups();
    const rows = ref(null);
    const account = computed(() => state.accounts.find((a) => a.id === props.account.id) ?? props.account);
    const balance = computed(() => balanceOf(account.value));

    async function load() {
      try { rows.value = await api.listAccountTransactions(props.account.id); } catch (e) { toast(e.message, 'error'); }
    }
    watch(() => state.dataVersion, load, { immediate: true });

    const items = computed(() => {
      let running = balance.value;
      return (rows.value ?? []).map((t) => {
        const id = props.account.id;
        const amount = Number(t.amount);
        const effect = t.to_account_id === id ? amount : t.kind === 'income' ? amount : -amount;
        const after = running;
        running -= effect;
        let icon, title;
        if (t.kind === 'transfer') {
          icon = '🔄';
          title = t.to_account_id === id
            ? `Перевод из «${accountById.value[t.account_id]?.name ?? '?'}»`
            : `Перевод в «${accountById.value[t.to_account_id]?.name ?? '?'}»`;
        } else {
          const c = categoryById.value[t.category_id];
          icon = c?.icon ?? '❔';
          title = c?.name ?? 'Без категории';
        }
        return { t, effect, after, icon, title };
      });
    });

    const shortDate = (iso) => parseIso(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: '2-digit' });
    return { account, balance, items, rows, money, shortDate, creditInfo, admin: computed(isAdmin) };
  },
  template: `
    <modal :title="account.icon + ' ' + account.name" @close="$emit('close')">
      <div class="statement-head">
        <card-chip :account="account" size="lg"/>
        <div class="grow">
          <div class="stat-label">Остаток сейчас</div>
          <div :class="['hero', { negative: balance < 0 }]">{{ money(balance) }}</div>
          <div v-if="creditInfo(account)" class="hint">{{ creditInfo(account) }}</div>
        </div>
        <button v-if="admin" class="btn" @click="$emit('edit-account', account)"><icon name="edit" :size="18"/> Изменить</button>
      </div>
      <p v-if="rows === null" class="empty">Загрузка…</p>
      <p v-else-if="!items.length" class="empty">Движений по счёту пока нет</p>
      <div v-else class="list statement">
        <button v-for="i in items.slice(0, 300)" :key="i.t.id" class="tx-row" @click="$emit('edit', i.t)">
          <span class="tx-icon" aria-hidden="true">{{ i.icon }}</span>
          <span class="tx-main">
            <span class="tx-title">{{ i.title }}</span>
            <span class="tx-sub">{{ [shortDate(i.t.date), i.t.note].filter(Boolean).join(' · ') }}</span>
          </span>
          <span class="amount-col">
            <span :class="['tx-amount', i.effect > 0 ? 'income' : '']">{{ i.effect > 0 ? '+' : '−' }}{{ money(Math.abs(i.effect)) }}</span>
            <span :class="['after', { negative: i.after < 0 }]">{{ money(i.after) }}</span>
          </span>
        </button>
      </div>
    </modal>`,
};

const LIQUID_KEY = 'capital-with-liquid';

export const HomeView = {
  components: { Icon, AccountRow, AccountEditor, AccountStatement, StartBalances, CashbackCard, DragLockButton },
  directives: { sortable: vSortable },
  emits: ['edit'],
  setup() {
    const editing = ref(null);
    const viewing = ref(null);
    const startOpen = ref(false);
    // Подсказка для только что созданного бюджета: остатки не заданы и операций ещё нет.
    const needsStart = computed(() => state.accounts.length > 0
      && state.accounts.every((a) => Number(a.initial_balance) === 0)
      && Object.values(state.balances).every((b) => b === 0));
    // Группы при запуске свёрнуты; раскрытые помнятся, пока приложение открыто.
    const collapsed = { has: (id) => !expanded.accountGroups.has(id) };
    const toggle = (id) => toggleIn(expanded.accountGroups, id);
    const showArchive = computed(() => expanded.accountGroups.has('archive'));

    const active = computed(() => state.accounts.filter((a) => !a.archived));
    const archived = computed(() => state.accounts.filter((a) => a.archived).sort(bySort));

    const groups = computed(() => ACCOUNT_TYPES.map((t) => {
      const items = active.value.filter((a) => typeOf(a).id === t.id).sort(bySort);
      // У кредиток в итоге группы — общий долг: остаток на такой карте может означать и долг, и доступную сумму.
      const total = t.id === 'credit'
        ? -items.reduce((s, a) => s + creditState(a, balanceOf(a)).debt, 0)
        : items.reduce((s, a) => s + balanceOf(a), 0);
      return { ...t, items, total };
    }).filter((g) => g.items.length));
    // Упрощённый вид: наличные, дебетовые и кредитные карты подряд, в том же порядке, без разделителей.
    const simpleAccounts = computed(() => groups.value
      .filter((g) => ['cash', 'debit', 'credit'].includes(g.id)).flatMap((g) => g.items));

    // «С учётом ликвидных вкладов» — прибавлять ли счета, с которых можно снять в любой день.
    const withLiquid = ref(localGet(LIQUID_KEY) === '1');
    watch(withLiquid, (v) => localSet(LIQUID_KEY, v ? '1' : '0'));
    const details = ref(false);

    // Доступные деньги — наличные и дебетовые карты; вклады и инвестиции отдельно,
    // потому что их не всегда можно быстро снять. Долги считаются по реальным минусам,
    // а у кредитки с лимитом — ещё и по плюсу (см. creditState). Плюс на кредите
    // или кредитке без лимита в итог не идёт: чаще всего там записана ошибка.
    // Такая сумма показывается отдельной подсказкой, чтобы её поправили.
    const totals = computed(() => {
      let available = 0, savings = 0, liquid = 0, owedToUs = 0, weOwe = 0, other = 0;
      for (const a of active.value) {
        const b = balanceOf(a), t = typeOf(a).id;
        if (t === 'cash' || t === 'debit') available += b;
        else if (canBeLiquid(t)) { savings += b; if (a.liquid) liquid += b; }
        else if (t === 'credit' && b > 0 && Number(a.credit_limit)) weOwe += creditState(a, b).debt;
        else if (b < 0) weOwe -= b;
        else if (t === 'lent') owedToUs += b;
        else other += b;
      }
      return {
        available, savings, liquid, owedToUs, weOwe,
        other,
        hero: available + (withLiquid.value ? liquid : 0),
        total: available + savings + owedToUs - weOwe,
      };
    });

    const month = computed(() => {
      let income = 0, expense = 0;
      for (const t of state.transactions) {
        if (t.kind === 'income') income += Number(t.amount);
        if (t.kind === 'expense') expense += Number(t.amount);
      }
      return { income, expense, diff: income - expense };
    });

    // Разделы и категории, где потрачено 80% лимита и больше.
    const alerts = computed(() => limitStatus(state.transactions).filter((l) => l.ratio >= 0.8));

    function editAccount(a) {
      viewing.value = null;
      editing.value = a;
    }

    return {
      state, editing, viewing, startOpen, needsStart, collapsed, showArchive, toggle, groups, archived, totals, withLiquid, details, month, alerts,
      editAccount, reorder, money, rub, monthLabel, Math, admin: computed(isAdmin), simpleView, simpleAccounts,
    };
  },
  template: `
    <section class="page">
      <header class="page-head">
        <h1 class="page-title">Главная</h1>
        <div class="head-actions">
          <button type="button" class="btn small" :aria-pressed="simpleView" @click="simpleView = !simpleView">
            {{ simpleView ? 'Обычный вид' : 'Упрощённый вид' }}</button>
          <drag-lock-button v-if="admin && !simpleView"/>
        </div>
      </header>

      <!-- Упрощённый вид: доступные деньги и кэшбэки прилипают к верху, ниже — карты и наличные. -->
      <template v-if="simpleView">
        <div class="simple-top">
          <div class="plate money-plate" role="status">
            <span class="money-plate-label">Доступные деньги</span>
            <b :class="{ negative: totals.available < 0 }">{{ rub(totals.available) }}</b>
          </div>
          <cashback-card/>
        </div>
        <div v-if="simpleAccounts.length" class="card list">
          <account-row v-for="a in simpleAccounts" :key="a.id" :account="a" plain @open="viewing = $event"/>
        </div>
      </template>
      <template v-else>

      <div v-if="admin && needsStart" class="card pad start-hint">
        <b>С чего начать</b>
        <p class="hint">Укажите, сколько денег сейчас на каждом счёте, и добавьте свои карты, вклады и долги: «Настройки» → «Счета» → «Добавить счёт».</p>
        <button class="btn primary" @click="startOpen = true">Указать стартовые остатки</button>
      </div>

      <!-- Главная сумма — отдельной плашкой, которая прилипает к верху экрана при прокрутке. -->
      <div class="plate sticky-plate money-plate" role="status">
        <span class="money-plate-label">{{ withLiquid ? 'Доступно с ликвидными вкладами' : 'Доступные деньги' }}</span>
        <b :class="{ negative: totals.hero < 0 }">{{ rub(totals.hero) }}</b>
      </div>

      <div class="card pad capital">
        <div class="capital-head">
          <span class="hint">Наличные и дебетовые карты{{ withLiquid ? ' плюс ликвидные вклады' : '' }}</span>
          <label class="check small"><input id="with-liquid" type="checkbox" v-model="withLiquid"> С учётом ликвидных вкладов</label>
        </div>
        <!-- Расшифровка свёрнута при каждом открытии. -->
        <button type="button" class="plate details-toggle" :aria-expanded="details" @click="details = !details">
          <span>Подробнее</span>
          <icon name="down" :class="['chev', { closed: !details }]" :size="16"/>
        </button>
        <div v-if="details" class="kv-list">
          <div class="kv"><span>Доступные деньги</span>
            <b :class="{ negative: totals.available < 0 }">{{ rub(totals.available) }}</b></div>
          <div class="kv"><span>Вклады и инвестиции</span>
            <b :class="{ negative: totals.savings < 0 }">{{ rub(totals.savings) }}</b></div>
          <div v-if="totals.liquid" class="kv"><span>из них ликвидные</span><b>{{ rub(totals.liquid) }}</b></div>
          <div class="kv"><span>Нам должны</span><b>{{ rub(totals.owedToUs) }}</b></div>
          <div class="kv"><span>Мы должны и кредиты</span>
            <b :class="{ negative: totals.weOwe > 0 }">{{ totals.weOwe > 0 ? '−' : '' }}{{ rub(totals.weOwe) }}</b></div>
          <div class="kv kv-total"><span>Всего с вкладами и долгами</span>
            <b :class="{ negative: totals.total < 0 }">{{ rub(totals.total) }}</b></div>
        </div>
        <p v-if="details && totals.other > 0" class="hint kv-note">
          ⚠ Не учтено: +{{ rub(totals.other) }} на кредитах и кредитных картах без лимита. Похоже, там ошибка:
          поправьте остаток через «Изменить» в карточке счёта.
        </p>
        <!-- Как в таблице: месяц плашкой, ниже расходы — итог — доходы (в целых рублях, чтобы влезало). -->
        <div class="month-sum">
          <div class="plate">{{ monthLabel(state.month) }}</div>
          <div class="month-sum-row">
            <div><small>Расходы</small><b class="negative">{{ rub(month.expense) }}</b></div>
            <div><small>Итог</small>
              <b :class="month.diff < 0 ? 'negative' : 'income'">{{ Math.trunc(month.diff) > 0 ? '+' : '' }}{{ rub(month.diff) }}</b></div>
            <div><small>Доходы</small><b class="income">{{ rub(month.income) }}</b></div>
          </div>
        </div>
      </div>

      <cashback-card/>

      <div v-if="alerts.length" class="card pad alerts">
        <div v-for="c in alerts" :key="c.id" :class="['alert', c.ratio > 1 ? 'over' : 'warn']">
          <span>{{ c.ratio > 1 ? '⚠' : '●' }}</span>
          <span>{{ c.icon }} {{ c.label }}:
            {{ c.ratio > 1 ? 'лимит превышен' : 'потрачено ' + Math.round(c.ratio * 100) + '% лимита' }}</span>
        </div>
      </div>

      <div v-if="!groups.length" class="card empty">
        <p>Счетов пока нет. {{ admin ? 'Добавьте наличные, карту или вклад.' : 'Их добавляет администратор бюджета.' }}</p>
        <button v-if="admin" class="btn primary" @click="editing = {}"><icon name="plus"/> Добавить счёт</button>
      </div>

      <div v-for="g in groups" :key="g.id" class="group">
        <button class="group-head" :aria-expanded="!collapsed.has(g.id)" @click="toggle(g.id)">
          <icon name="down" :class="['chev', { closed: collapsed.has(g.id) }]" :size="18"/>
          <span class="group-title"><span aria-hidden="true">{{ g.icon }}</span> {{ g.label }} <span class="group-count">{{ g.items.length }}</span></span>
          <span :class="['group-total', { negative: g.total < 0 }]">{{ rub(g.total) }}</span>
        </button>
        <div v-show="!collapsed.has(g.id)" class="card list"
          v-sortable="{ onMove: (from, to) => reorder('accounts', g.items, from, to), disabled: !admin }">
          <account-row v-for="a in g.items" :key="a.id" :account="a" @open="viewing = $event"/>
        </div>
      </div>

      <div v-if="archived.length" class="group">
        <button class="group-head" :aria-expanded="showArchive" @click="toggle('archive')">
          <icon name="down" :class="['chev', { closed: !showArchive }]" :size="18"/>
          <span class="group-title muted">🗄 Архив <span class="group-count">{{ archived.length }}</span></span>
        </button>
        <div v-show="showArchive" class="card list">
          <account-row v-for="a in archived" :key="a.id" :account="a" archived @open="viewing = $event"/>
        </div>
        <p v-show="showArchive" class="hint">Счета в архиве не учитываются в сводке, но вся их история сохранена.</p>
      </div>
      </template>

      <account-statement v-if="viewing" :account="viewing" @close="viewing = null"
        @edit="$emit('edit', $event)" @edit-account="editAccount"/>
      <account-editor v-if="editing" :account="editing" @close="editing = null"/>
      <start-balances v-if="startOpen" @close="startOpen = false"/>
    </section>`,
};
