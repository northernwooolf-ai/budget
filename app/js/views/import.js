// Операции со скриншотов из банка или надиктованные голосом: GigaChat находит операции, вы проверяете и добавляете.
import { ref, reactive, computed, onMounted, onBeforeUnmount } from 'vue';
import { api } from '../api.js?v=2610301632';
import { state, isAdmin, importTransactions, toast } from '../store.js?v=2610301632';
import { money, parseAmount, amountToInput, today, isoDate, parseIso, localGet, localSet, bySort } from '../utils.js?v=2610301632';
import { ACCOUNT_TYPES, typeOf } from '../account-types.js?v=2610301632';
import { Icon, Modal } from '../components.js?v=2610301632';
import { bankKey, AccountSelect } from '../cards.js?v=2610301632';
import { CategoryPicker } from './category-picker.js?v=2610301632';
import { speechSupported, listen } from '../speech.js?v=2610301632';

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
  components: { Modal, Icon, AccountSelect, CategoryPicker },
  props: { mode: { type: String, default: 'shot' } }, // shot — скриншоты, voice — диктовка
  emits: ['close'],
  setup(props, { emit }) {
    const voice = props.mode === 'voice';
    // Дата, указанная вручную, важнее даты со скриншота: на нём её бывает не видно.
    const shotDate = ref('');
    // Карта, указанная вручную, важнее всего, что удастся понять по скриншоту.
    const shotAccount = ref(null);
    const admin = isAdmin();
    const step = ref('pick');        // pick → work → review
    const progress = ref('');
    const failures = ref([]);
    const rows = ref([]);
    const existing = ref([]);        // уже внесённые операции за те же даты — для поиска повторов
    const busy = ref(false);
    const error = ref('');
    const fileInput = ref(null);

    const accountGroups = computed(() => ACCOUNT_TYPES
      .map((g) => ({ ...g, items: state.accounts.filter((a) => !a.archived && typeOf(a).id === g.id).sort(bySort) }))
      .filter((g) => g.items.length));

    // Какой счёт подставить: выбранный вручную → по цифрам карты со скриншота → названный GigaChat
    // (если банк совпадает, он иногда угадывает) → последний выбранный для этого банка.
    function accountFor(op, bank) {
      const active = state.accounts.filter((a) => !a.archived);
      if (!voice && active.some((a) => a.id === shotAccount.value)) return shotAccount.value;
      const byDigits = op.card && active.find((a) => a.card_last4 === op.card);
      if (byDigits) return byDigits.id;
      const named = active.find((a) => a.id === op.account_id);
      const key = bankKey(bank), namedKey = bankKey(named?.name);
      if (named && (!key || !namedKey || key === namedKey)) return named.id;
      return guessAccount(bank, state.me.user_id);
    }

    // Счета для GigaChat: по ним он определяет карту в тексте или на скриншоте.
    const accountsBrief = () => state.accounts.filter((a) => !a.archived)
      .map((a) => ({ id: a.id, name: a.name, type: a.type, last4: a.card_last4 ?? null }));

    let nextBatch = 0; // номер скриншота или диктовки: повторы внутри одного не считаются дублями

    function makeRow(op, bank, batch) {
      const memory = merchantMemory();
      const remembered = memory[normalize(op.description)];
      const valid = (id) => state.categories.some((c) => c.id === id && c.kind === op.direction && !c.archived);
      return reactive({
        key: crypto.randomUUID(),
        include: true,
        date: (!voice && shotDate.value) || op.date || today(),
        amount: amountToInput(op.amount),
        kind: op.direction,
        note: op.description,
        category_id: valid(remembered) ? remembered : valid(op.category_id) ? op.category_id : null,
        account_id: accountFor(op, bank),
        to_account_id: null,
        spent_by: state.me.user_id,
        bank,
        batch,
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
          const result = await api.recognize({ image: await prepareImage(file), mime: 'image/jpeg', today: today(), categories, accounts: accountsBrief() });
          const batch = nextBatch++;
          for (const op of result.operations) found.push(makeRow(op, result.bank, batch));
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

    // ---------- Диктовка ----------
    const spoken = ref('');
    const listening = ref(false);
    let stop = null;

    function startListening() {
      error.value = '';
      spoken.value = '';
      listening.value = true;
      stop = listen({
        onText: (text) => { spoken.value = text; },
        onEnd: (err) => {
          listening.value = false;
          stop = null;
          if (err) error.value = err;
          else if (spoken.value) recognizeText();
        },
      });
    }
    const stopListening = () => stop?.();
    onBeforeUnmount(stopListening);

    async function recognizeText() {
      const text = spoken.value.trim();
      if (!text) return (error.value = 'Скажите или напишите, что купили и на сколько');
      error.value = '';
      step.value = 'work';
      progress.value = 'Разбираю, что вы сказали…';
      failures.value = [];
      const categories = state.categories.filter((c) => !c.archived).map((c) => ({ id: c.id, name: c.name, kind: c.kind }));
      const found = [];
      try {
        const result = await api.recognize({ text, today: today(), categories, accounts: accountsBrief() });
        const batch = nextBatch++;
        for (const op of result.operations) found.push(makeRow(op, null, batch));
        if (!found.length) failures.value.push(`Не нашёл операций в «${text}». Назовите, что купили и сумму`);
      } catch (e) {
        failures.value.push(e.message);
      }
      rows.value = [...rows.value, ...found];
      await loadExisting();
      for (const r of found) if (isDuplicate(r)) r.include = false;
      spoken.value = '';
      step.value = 'review';
    }

    async function loadExisting() {
      const dates = rows.value.map((r) => r.date).filter(Boolean).sort();
      if (!dates.length) return;
      const to = parseIso(dates[dates.length - 1]); to.setDate(to.getDate() + 1);
      try { existing.value = await api.listTransactions(dates[0], isoDate(to)); } catch { existing.value = []; }
    }

    // Одинаковые строки на одном скриншоте — это разные траты (несколько поездок на автобусе),
    // поэтому повтором считаем только столько строк, сколько таких уже есть:
    // внесённых раньше и на более раннем скриншоте (его загрузили дважды или операция попала на два).
    function isDuplicate(r) {
      const amount = parseAmount(r.amount);
      const same = (o) => o.date === r.date && parseAmount(o.amount) === amount && o.kind === r.kind && o.note === r.note;
      const saved = existing.value.filter((t) => t.date === r.date && Number(t.amount) === amount
        && t.kind === r.kind && t.account_id === r.account_id).length;
      const earlier = {};
      for (const o of rows.value) if (o.batch < r.batch && o.include && same(o)) earlier[o.batch] = (earlier[o.batch] ?? 0) + 1;
      const place = rows.value.filter((o) => o.batch === r.batch && same(o)).indexOf(r);
      return place < saved + Math.max(0, ...Object.values(earlier));
    }

    const selected = computed(() => rows.value.filter((r) => r.include));
    // Переводы между своими счетами не меняют итог.
    const SIGN = { expense: 1, income: -1, transfer: 0 };
    const total = computed(() => selected.value.reduce((s, r) => s + SIGN[r.kind] * (parseAmount(r.amount) || 0), 0));

    function setKind(r, kind) {
      r.kind = kind;
      if (!state.categories.some((c) => c.id === r.category_id && c.kind === kind)) r.category_id = null;
      if (kind === 'transfer' && !r.to_account_id) {
        r.to_account_id = state.accounts.find((a) => !a.archived && a.id !== r.account_id)?.id ?? null;
      }
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
        const transfer = r.kind === 'transfer';
        if (transfer && !r.to_account_id) return (error.value = `Строка ${n}: выберите, на какой счёт перевод`);
        if (transfer && r.to_account_id === r.account_id) return (error.value = `Строка ${n}: счета перевода должны различаться`);
        if (!transfer && !r.category_id) return (error.value = `Строка ${n} («${r.note}»): выберите категорию`);
        list.push({
          kind: r.kind, amount, date: r.date, account_id: r.account_id, to_account_id: transfer ? r.to_account_id : null,
          category_id: transfer ? null : r.category_id, note: r.note?.trim() || null,
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
      if (!voice && files.length && step.value !== 'work') { e.preventDefault(); recognizeFiles(files); }
    }
    onMounted(() => document.addEventListener('paste', onPaste));
    onBeforeUnmount(() => document.removeEventListener('paste', onPaste));

    const onFiles = (e) => { recognizeFiles(e.target.files); e.target.value = ''; };

    return {
      state, admin, step, progress, failures, rows, busy, error, fileInput, accountGroups,
      selected, total, isDuplicate, setKind, save, onFiles, money,
      shotDate, shotAccount, voice, spoken, listening, speechSupported, startListening, stopListening, recognizeText,
    };
  },
  template: `
    <modal :title="voice ? 'Операции голосом' : 'Операции со скриншота'" class="wide" @close="$emit('close')">
      <input ref="fileInput" type="file" accept="image/*" multiple hidden @change="onFiles">

      <div v-if="step === 'pick' && voice" class="import-pick">
        <p v-if="rows.length" class="hint">Уже найдено операций: {{ rows.length }}. Надиктуйте ещё — они добавятся к списку.
          <button type="button" class="link-btn" @click="step = 'review'">Вернуться к списку</button></p>
        <button v-if="speechSupported" type="button" :class="['drop-zone', { listening }]"
          @click="listening ? stopListening() : startListening()">
          <span class="drop-icon" aria-hidden="true">{{ listening ? '🔴' : '🎙️' }}</span>
          <b>{{ listening ? 'Слушаю… нажмите, чтобы закончить' : 'Нажмите и скажите' }}</b>
          <span class="hint">Например: «Купил еды в Пятёрочке с дебетовой Тинькофф на 392 рубля»</span>
        </button>
        <label class="field">
          <span>{{ speechSupported ? 'Или напишите' : 'Скажите через микрофон на клавиатуре или напишите' }}</span>
          <textarea v-model="spoken" rows="3" maxlength="2000" :readonly="listening"
            placeholder="Вчера заправился на 2500 с кредитки Сбера, сегодня кофе 250 наличными"></textarea>
        </label>
        <p class="hint">Можно несколько операций сразу. Текст отправляется в GigaChat, чтобы разобрать сумму, карту и категорию.</p>
        <p v-if="error" class="form-error" role="alert">{{ error }}</p>
      </div>

      <div v-else-if="step === 'pick'" class="import-pick">
        <label class="field">
          <span>За какую дату скриншоты</span>
          <input id="shot-date" v-model="shotDate" type="date">
          <small class="hint">Необязательно. Укажите, если даты нет на скриншоте: она будет у всех операций из них. Если оставить пустым, дату определит GigaChat.</small>
        </label>
        <div class="field">
          <span>С какой карты операции</span>
          <account-select v-model="shotAccount" :groups="accountGroups" label="С какой карты операции" placeholder="Определить автоматически"/>
          <button v-if="shotAccount" type="button" class="link-btn import-clear" @click="shotAccount = null">Определить автоматически</button>
          <small class="hint">Необязательно. Если не выбрать, GigaChat поищет карту на скриншоте. Если её там не видно, подставится карта, которую вы выбирали для этого банка в прошлый раз.</small>
        </div>
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
        <span class="hint">{{ voice ? 'Обычно несколько секунд' : 'Обычно 5–15 секунд на один скриншот' }}</span>
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
              <button type="button" :class="['k-expense', { active: r.kind === 'expense' }]" @click="setKind(r, 'expense')">Расход</button>
              <button type="button" :class="{ active: r.kind === 'transfer' }" @click="setKind(r, 'transfer')">Перевод</button>
              <button type="button" :class="['k-income', { active: r.kind === 'income' }]" @click="setKind(r, 'income')">Доход</button>
            </div>
            <span class="import-amount"><input v-model="r.amount" inputmode="decimal" aria-label="Сумма"> ₽</span>
          </div>
          <span v-if="isDuplicate(r)" class="dup-badge">Похоже, уже внесено</span>
          <input v-model="r.note" class="import-note" maxlength="200" aria-label="Описание" placeholder="Описание">
          <category-picker v-if="r.kind !== 'transfer'" v-model="r.category_id" :kind="r.kind"
            :class="{ missing: r.include && !r.category_id }"/>
          <div class="import-accounts">
            <account-select v-model="r.account_id" :groups="accountGroups" :label="r.kind === 'transfer' ? 'Откуда' : 'Счёт'"/>
            <account-select v-if="r.kind === 'transfer'" v-model="r.to_account_id" :groups="accountGroups" label="Куда"/>
          </div>
        </div>

        <button v-if="voice" class="btn ghost" @click="step = 'pick'"><icon name="plus"/> Надиктовать ещё</button>
        <template v-else>
          <label class="field">
            <span>Дата для следующих скриншотов</span>
            <input v-model="shotDate" type="date">
          </label>
          <div class="field">
            <span>Карта для следующих скриншотов</span>
            <account-select v-model="shotAccount" :groups="accountGroups" label="Карта для следующих скриншотов" placeholder="Определить автоматически"/>
            <button v-if="shotAccount" type="button" class="link-btn import-clear" @click="shotAccount = null">Определить автоматически</button>
          </div>
          <button class="btn ghost" @click="fileInput.click()"><icon name="plus"/> Ещё скриншот</button>
        </template>
        <p v-if="error" class="form-error" role="alert">{{ error }}</p>
      </div>

      <template #footer>
        <span v-if="step === 'review' && selected.length" class="muted import-sum">
          {{ selected.length }} шт. · {{ total > 0 ? '−' : total < 0 ? '+' : '' }}{{ money(Math.abs(total)) }}</span>
        <span class="spacer"></span>
        <button type="button" class="btn ghost" @click="$emit('close')">Отмена</button>
        <button v-if="step === 'pick' && voice && !listening && spoken.trim()" type="button" class="btn primary" @click="recognizeText">Разобрать</button>
        <button v-if="step === 'review'" type="button" class="btn primary" :disabled="busy || !selected.length" @click="save">
          {{ busy ? 'Добавляю…' : 'Добавить выбранные' }}</button>
      </template>
    </modal>`,
};
