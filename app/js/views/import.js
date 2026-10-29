// Загрузка скриншотов из банка: GigaChat находит операции, вы проверяете и добавляете.
import { ref, reactive, computed, onMounted, onBeforeUnmount } from 'vue';
import { api } from '../api.js?v=2610291514';
import { state, isAdmin, importTransactions, toast } from '../store.js?v=2610291514';
import { money, parseAmount, amountToInput, today, isoDate, parseIso, localGet, localSet, bySort } from '../utils.js?v=2610291514';
import { ACCOUNT_TYPES, typeOf } from '../account-types.js?v=2610291514';
import { categoryTree, groupLabel, categoryLabel } from '../categories.js?v=2610291514';
import { Icon, Modal } from '../components.js?v=2610291514';
import { bankKey } from '../cards.js?v=2610291514';

// ---------- Память: какой магазин в какую категорию, какой банк на какой счёт ----------

const MERCHANTS_KEY = 'merchant-categories';
const BANK_KEY = 'import-bank-account:';

const normalize = (s) => String(s ?? '').toLowerCase().replace(/ё/g, 'е')
  .replace(/[0-9*#№"«»'.,:;!?()[\]{}+\-_/\\]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);

function merchantMemory() {
  try { return JSON.parse(localGet(MERCHANTS_KEY)) ?? {}; } catch { return {}; }
}

function rememberMerchants(rows) {
  const memory = merchantMemory();
  for (const r of rows) if (normalize(r.note) && r.category_id) memory[normalize(r.note)] = r.category_id;
  localSet(MERCHANTS_KEY, JSON.stringify(memory));
}


// Карта этого банка; если в банке несколько карт — карта того, чья операция
// (по началу имени: «Антон» → «…Анто», «Свето» → «…Свето»), и дебетовая раньше вкладов.
function guessAccount(bank, ownerId) {
  const active = state.accounts.filter((a) => !a.archived);
  const key = bankKey(bank);
  if (key) {
    const remembered = localGet(BANK_KEY + key + ':' + ownerId);
    if (active.some((a) => a.id === remembered)) return remembered;
    const stem = (state.members.find((m) => m.user_id === ownerId)?.display_name ?? '').slice(0, 4).toLowerCase();
    const score = (a) => (stem && a.name.toLowerCase().includes(stem) ? 2 : 0) + (typeOf(a).id === 'debit' ? 1 : 0);
    const byName = active.filter((a) => bankKey(a.name) === key).sort((a, b) => score(b) - score(a));
    if (byName.length) return byName[0].id;
  }
  const last = localGet('last-account');
  return active.some((a) => a.id === last) ? last : active[0]?.id ?? null;
}

// ---------- Подготовка изображения: уменьшить и перевести в JPEG ----------

async function prepareImage(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1280 / bitmap.width, 2800 / bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.88).split(',')[1];
}

export const ImportView = {
  components: { Modal, Icon },
  emits: ['close'],
  setup(props, { emit }) {
    const admin = isAdmin();
    const step = ref('pick');        // pick → work → review
    const progress = ref('');
    const failures = ref([]);
    const rows = ref([]);
    const existing = ref([]);        // уже внесённые операции за те же даты — для поиска повторов
    const busy = ref(false);
    const error = ref('');
    const fileInput = ref(null);

    const trees = computed(() => ({ expense: categoryTree('expense'), income: categoryTree('income') }));
    const accountGroups = computed(() => ACCOUNT_TYPES
      .map((g) => ({ ...g, items: state.accounts.filter((a) => !a.archived && typeOf(a).id === g.id).sort(bySort) }))
      .filter((g) => g.items.length));

    function makeRow(op, bank) {
      const memory = merchantMemory();
      const remembered = memory[normalize(op.description)];
      const valid = (id) => state.categories.some((c) => c.id === id && c.kind === op.direction && !c.archived);
      return reactive({
        key: crypto.randomUUID(),
        include: true,
        date: op.date ?? today(),
        amount: amountToInput(op.amount),
        kind: op.direction,
        note: op.description,
        category_id: valid(remembered) ? remembered : valid(op.category_id) ? op.category_id : null,
        account_id: guessAccount(bank, state.me.user_id),
        spent_by: state.me.user_id,
        bank,
      });
    }

    async function recognizeFiles(files) {
      const images = [...files].filter((f) => f.type.startsWith('image/'));
      if (!images.length) return toast('Выберите изображение (скриншот)', 'error');
      step.value = 'work';
      failures.value = [];
      const found = [];
      const categories = state.categories.filter((c) => !c.archived).map((c) => ({ id: c.id, name: c.name, kind: c.kind }));
      for (const [i, file] of images.entries()) {
        progress.value = images.length > 1 ? `Распознаю скриншот ${i + 1} из ${images.length}…` : 'Распознаю скриншот…';
        try {
          const result = await api.recognize({ image: await prepareImage(file), mime: 'image/jpeg', today: today(), categories });
          for (const op of result.operations) found.push(makeRow(op, result.bank));
          if (result.rejected) {
            failures.value.push(`${file.name || 'Скриншот ' + (i + 1)}: не удалось разобрать сумму у операций: ${result.rejected}. Внесите их вручную`);
          }
        } catch (e) {
          failures.value.push(`${file.name || 'Скриншот ' + (i + 1)}: ${e.message}`);
        }
      }
      rows.value = [...rows.value, ...found];
      await loadExisting();
      for (const r of found) if (isDuplicate(r)) r.include = false;
      step.value = rows.value.length || failures.value.length ? 'review' : 'pick';
    }

    async function loadExisting() {
      const dates = rows.value.map((r) => r.date).filter(Boolean).sort();
      if (!dates.length) return;
      const to = parseIso(dates[dates.length - 1]); to.setDate(to.getDate() + 1);
      try { existing.value = await api.listTransactions(dates[0], isoDate(to)); } catch { existing.value = []; }
    }

    function isDuplicate(r) {
      const amount = parseAmount(r.amount);
      const seen = existing.value.some((t) => t.date === r.date && Number(t.amount) === amount
        && t.kind === r.kind && t.account_id === r.account_id);
      // Один и тот же скриншот загрузили дважды или операция попала на два скриншота.
      const twin = rows.value.some((o) => o !== r && o.include && rows.value.indexOf(o) < rows.value.indexOf(r)
        && o.date === r.date && parseAmount(o.amount) === amount && o.kind === r.kind && o.note === r.note);
      return seen || twin;
    }

    const selected = computed(() => rows.value.filter((r) => r.include));
    const total = computed(() => selected.value.reduce((s, r) => s + (r.kind === 'expense' ? 1 : -1) * (parseAmount(r.amount) || 0), 0));

    function setKind(r, kind) {
      r.kind = kind;
      if (!state.categories.some((c) => c.id === r.category_id && c.kind === kind)) r.category_id = null;
    }

    async function save() {
      error.value = '';
      const list = [];
      for (const [i, r] of rows.value.entries()) {
        if (!r.include) continue;
        const amount = parseAmount(r.amount);
        const n = i + 1;
        if (!(amount > 0)) return (error.value = `Строка ${n}: укажите сумму`);
        if (!r.date) return (error.value = `Строка ${n}: укажите дату`);
        if (!r.account_id) return (error.value = `Строка ${n}: выберите счёт`);
        if (!r.category_id) return (error.value = `Строка ${n} («${r.note}»): выберите категорию`);
        list.push({
          kind: r.kind, amount, date: r.date, account_id: r.account_id, to_account_id: null,
          category_id: r.category_id, note: r.note?.trim() || null,
          spent_by: admin ? r.spent_by : state.me.user_id,
        });
      }
      if (!list.length) return (error.value = 'Не выбрано ни одной операции');
      busy.value = true;
      try {
        await importTransactions(list);
        rememberMerchants(selected.value);
        for (const r of selected.value) {
          const key = bankKey(r.bank);
          if (key) localSet(BANK_KEY + key + ':' + (admin ? r.spent_by : state.me.user_id), r.account_id);
        }
        emit('close');
      } catch { /* показано */ } finally {
        busy.value = false;
      }
    }

    // Вставка скриншота из буфера (Ctrl+V) на компьютере.
    function onPaste(e) {
      const files = [...(e.clipboardData?.files ?? [])];
      if (files.length && step.value !== 'work') { e.preventDefault(); recognizeFiles(files); }
    }
    onMounted(() => document.addEventListener('paste', onPaste));
    onBeforeUnmount(() => document.removeEventListener('paste', onPaste));

    const onFiles = (e) => { recognizeFiles(e.target.files); e.target.value = ''; };

    return {
      state, admin, step, progress, failures, rows, busy, error, fileInput, trees, accountGroups,
      selected, total, isDuplicate, setKind, save, onFiles, money, groupLabel, categoryLabel,
    };
  },
  template: `
    <modal title="Операции со скриншота" class="wide" @close="$emit('close')">
      <input ref="fileInput" type="file" accept="image/*" multiple hidden @change="onFiles">

      <div v-if="step === 'pick'" class="import-pick">
        <button class="drop-zone" @click="fileInput.click()">
          <span class="drop-icon" aria-hidden="true">📷</span>
          <b>Выберите скриншоты из банка</b>
          <span class="hint">Можно несколько сразу. На компьютере можно вставить скриншот из буфера: Ctrl+V.</span>
        </button>
        <p class="hint">Подходят экраны «История операций» из Сбербанка, ОТП, Т-Банка, Озон Банка, МКБ и Wildberries Банка.
          Скриншот отправляется на распознавание в GigaChat и после этого удаляется.</p>
      </div>

      <div v-else-if="step === 'work'" class="import-work" role="status">
        <span class="spinner" aria-hidden="true"></span>
        <b>{{ progress }}</b>
        <span class="hint">Обычно 5–15 секунд на один скриншот</span>
      </div>

      <div v-else class="stack">
        <div v-if="failures.length" class="warn-box" role="alert">
          <b>Не всё удалось распознать</b>
          <span v-for="f in failures" :key="f">{{ f }}</span>
        </div>
        <p v-if="rows.length" class="hint">
          Найдено операций: {{ rows.length }}. Проверьте суммы и категории, снимите галочку с лишних.
          Похожие на уже внесённые отмечены и не выбраны.
        </p>

        <div v-for="(r, i) in rows" :key="r.key" :class="['import-row', { off: !r.include }]">
          <div class="import-top">
            <label class="check"><input type="checkbox" v-model="r.include" :aria-label="'Добавить строку ' + (i + 1)"></label>
            <input v-model="r.date" type="date" class="import-date" aria-label="Дата">
            <div class="segmented mini" role="radiogroup" aria-label="Тип">
              <button type="button" :class="{ active: r.kind === 'expense' }" @click="setKind(r, 'expense')">Расход</button>
              <button type="button" :class="{ active: r.kind === 'income' }" @click="setKind(r, 'income')">Доход</button>
            </div>
            <span class="import-amount"><input v-model="r.amount" inputmode="decimal" aria-label="Сумма"> ₽</span>
          </div>
          <span v-if="isDuplicate(r)" class="dup-badge">Похоже, уже внесено</span>
          <input v-model="r.note" class="import-note" maxlength="200" aria-label="Описание" placeholder="Описание">
          <div class="import-fields">
            <select v-model="r.category_id" aria-label="Категория" :class="{ missing: r.include && !r.category_id }">
              <option :value="null">— выберите категорию —</option>
              <optgroup v-for="s in trees[r.kind].sections" :key="s.group.id" :label="groupLabel(trees[r.kind], s.group)">
                <option v-for="c in s.items" :key="c.id" :value="c.id">{{ c.icon }} {{ categoryLabel(trees[r.kind], c) }}</option>
              </optgroup>
              <optgroup v-if="trees[r.kind].loose.length" label="Без раздела">
                <option v-for="c in trees[r.kind].loose" :key="c.id" :value="c.id">{{ c.icon }} {{ c.name }}</option>
              </optgroup>
            </select>
            <select v-model="r.account_id" aria-label="Счёт">
              <optgroup v-for="g in accountGroups" :key="g.id" :label="g.label">
                <option v-for="a in g.items" :key="a.id" :value="a.id">{{ a.icon }} {{ a.name }}</option>
              </optgroup>
            </select>
          </div>
        </div>

        <button class="btn ghost" @click="fileInput.click()"><icon name="plus"/> Ещё скриншот</button>
        <p v-if="error" class="form-error" role="alert">{{ error }}</p>
      </div>

      <template #footer>
        <span v-if="step === 'review' && selected.length" class="muted import-sum">
          {{ selected.length }} шт. · {{ total >= 0 ? '−' : '+' }}{{ money(Math.abs(total)) }}</span>
        <span class="spacer"></span>
        <button type="button" class="btn ghost" @click="$emit('close')">Отмена</button>
        <button v-if="step === 'review'" type="button" class="btn primary" :disabled="busy || !selected.length" @click="save">
          {{ busy ? 'Добавляю…' : 'Добавить выбранные' }}</button>
      </template>
    </modal>`,
};
