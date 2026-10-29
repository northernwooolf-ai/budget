import { ref, computed, watch } from 'vue';
import { api } from '../api.js?v=2610291514';
import { state, isAdmin, updateMyName, updateHouseholdName, signOut, toast } from '../store.js?v=2610291514';
import { isoDate, addMonths, downloadFile } from '../utils.js?v=2610291514';
import { Icon } from '../components.js?v=2610291514';
import { CategoriesSettings } from './categories-settings.js?v=2610291514';
import { AppearanceSettings } from './appearance-settings.js?v=2610291514';
import { SecuritySettings } from './lock-screen.js?v=2610291514';
import { AccountEditor } from './home.js?v=2610291514';
import { APP_VERSION } from '../config.js?v=2610291514';

export const SettingsView = {
  components: { Icon, CategoriesSettings, AppearanceSettings, SecuritySettings, AccountEditor },
  setup() {
    const addingAccount = ref(null);
    const admin = computed(isAdmin);
    const myName = ref(state.me.display_name);
    const familyName = ref(state.household.name);
    // Если имя поменяли на другом устройстве — подтянуть.
    watch(() => state.me.display_name, (v) => { myName.value = v; });
    watch(() => state.household.name, (v) => { familyName.value = v; });
    const exporting = ref(false);
    const partnerMode = computed(() => state.isDemo && !admin.value);

    // Код приглашения запрашивается отдельно — база отдаёт его только администратору.
    const inviteCode = ref('');
    watch(admin, async (isAdminNow) => {
      inviteCode.value = '';
      if (isAdminNow) {
        try { inviteCode.value = (await api.getInviteCode()) ?? ''; } catch (e) { toast(e.message, 'error'); }
      }
    }, { immediate: true });

    async function copyCode() {
      try {
        await navigator.clipboard.writeText(inviteCode.value);
        toast('Код скопирован');
      } catch {
        toast('Не удалось скопировать — перепишите код вручную', 'error');
      }
    }

    // Проверка связи с GigaChat: ключ принят и какие модели доступны.
    const check = ref({ busy: false, text: '', ok: null });
    async function checkRecognizer() {
      check.value = { busy: true, text: 'Проверяю…', ok: null };
      try {
        const r = await api.checkRecognizer();
        if (!Array.isArray(r?.models)) {
          throw new Error('Функция recognize установлена, но в ней пример кода Supabase, а не код распознавания. Замените код и нажмите Deploy');
        }
        const hasModel = r.models.includes(r.model);
        check.value = {
          busy: false, ok: hasModel,
          text: hasModel
            ? `GigaChat подключён. Модель для скриншотов: ${r.model}.`
            : `GigaChat подключён, но модели ${r.model} нет среди доступных: ${r.models.join(', ')}.`,
        };
      } catch (e) {
        check.value = { busy: false, ok: false, text: e.message };
      }
    }

    async function exportCsv(all) {
      exporting.value = true;
      try {
        const from = all ? '1900-01-01' : isoDate(state.month);
        const to = all ? '3000-01-01' : isoDate(addMonths(state.month, 1));
        const rows = await api.listTransactions(from, to);
        const cat = Object.fromEntries(state.categories.map((c) => [c.id, c.name]));
        const group = Object.fromEntries(state.categoryGroups.map((g) => [g.id, g.name]));
        const catGroup = Object.fromEntries(state.categories.map((c) => [c.id, group[c.group_id]]));
        const acc = Object.fromEntries(state.accounts.map((a) => [a.id, a.name]));
        const who = Object.fromEntries(state.members.map((m) => [m.user_id, m.display_name]));
        const kinds = { expense: 'Расход', income: 'Доход', transfer: 'Перевод' };
        const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
        const lines = [['Дата', 'Тип', 'Сумма', 'Раздел', 'Категория', 'Счёт', 'На счёт', 'Комментарий', 'Кто внёс']];
        for (const t of rows) {
          lines.push([t.date, kinds[t.kind], String(t.amount).replace('.', ','), catGroup[t.category_id],
            cat[t.category_id], acc[t.account_id], acc[t.to_account_id], t.note, who[t.created_by]]);
        }
        downloadFile(`budget-${all ? 'all' : isoDate(state.month).slice(0, 7)}.csv`,
          lines.map((l) => l.map(esc).join(';')).join('\r\n'));
      } catch (e) {
        toast(e.message, 'error');
      } finally {
        exporting.value = false;
      }
    }

    return {
      state, admin, addingAccount, myName, familyName, exporting, partnerMode, inviteCode, copyCode, exportCsv, check, checkRecognizer,
      updateMyName, updateHouseholdName, signOut, demoSwitch: () => api.demoSwitchUser(), APP_VERSION,
    };
  },
  template: `
    <section class="page">
      <header class="page-head"><h1 class="page-title">Настройки</h1></header>

      <div v-if="state.isDemo" class="card pad stack demo-card">
        <h2>Демо: права участников</h2>
        <p class="hint" v-if="!partnerMode">Вы — администратор. Посмотрите, что увидит и сможет супруга.</p>
        <p class="hint" v-else>Вы смотрите глазами супруги: она вносит свои траты и правит только то, что внесла сама.</p>
        <button class="btn" @click="demoSwitch">{{ partnerMode ? 'Вернуться к администратору' : 'Посмотреть глазами супруги' }}</button>
      </div>

      <div class="card pad stack">
        <h2>Семья</h2>
        <template v-if="admin">
          <div class="invite">
            <div>
              <div class="stat-label">Код приглашения</div>
              <div class="invite-code">{{ inviteCode || '…' }}</div>
            </div>
            <button class="btn" :disabled="!inviteCode" @click="copyCode"><icon name="copy"/> Скопировать</button>
          </div>
          <p class="hint">Супруга регистрируется в приложении, выбирает «Присоединиться по коду» и вводит этот код.</p>
        </template>
        <div>
          <div class="field-label">Участники</div>
          <ul class="members">
            <li v-for="m in state.members" :key="m.user_id">
              <span class="avatar">{{ m.display_name.charAt(0).toUpperCase() }}</span>{{ m.display_name }}
              <span v-if="m.user_id === state.me.user_id" class="muted">(вы)</span>
              <span v-if="m.role === 'admin'" class="badge">администратор</span>
            </li>
          </ul>
        </div>
        <form v-if="admin" class="inline-form" @submit.prevent="familyName.trim() && updateHouseholdName(familyName.trim())">
          <label class="field grow"><span>Название бюджета</span><input v-model="familyName" maxlength="40"></label>
          <button class="btn" :disabled="familyName.trim() === state.household.name">Сохранить</button>
        </form>
        <form class="inline-form" @submit.prevent="myName.trim() && updateMyName(myName.trim())">
          <label class="field grow"><span>Ваше имя</span><input v-model="myName" maxlength="30"></label>
          <button class="btn" :disabled="myName.trim() === state.me.display_name">Сохранить</button>
        </form>
      </div>

      <div v-if="admin" class="card pad stack">
        <h2>Счета</h2>
        <p class="hint">Наличные, карты, вклады, долги. Изменить или убрать в архив счёт можно, нажав на него на главной.</p>
        <div><button class="btn" @click="addingAccount = {}"><icon name="plus"/> Добавить счёт</button></div>
      </div>
      <account-editor v-if="addingAccount" :account="addingAccount" @close="addingAccount = null"/>

      <categories-settings/>

      <appearance-settings/>

      <security-settings/>

      <div v-if="admin" class="card pad stack">
        <h2>Распознавание скриншотов</h2>
        <p class="hint">Скриншоты из банков читает GigaChat. Проверьте, что ключ подключён и модель доступна.</p>
        <div><button id="check-recognizer" class="btn" :disabled="check.busy" @click="checkRecognizer">Проверить подключение</button></div>
        <p v-if="check.text" :class="check.ok === false ? 'form-error' : check.ok ? 'income' : 'hint'" role="status">{{ check.text }}</p>
      </div>

      <div class="card pad stack">
        <h2>Данные</h2>
        <p class="hint">Таблица открывается в Excel. Удобно для резервной копии.</p>
        <div class="btn-row">
          <button class="btn" :disabled="exporting" @click="exportCsv(false)"><icon name="download"/> Выгрузить месяц</button>
          <button class="btn" :disabled="exporting" @click="exportCsv(true)"><icon name="download"/> Выгрузить всё</button>
        </div>
      </div>

      <div class="card pad stack">
        <div class="muted">Вы вошли как {{ state.session.user.email }}</div>
        <button class="btn danger-ghost" @click="signOut"><icon name="logout"/> Выйти</button>
      </div>
      <p class="hint center">Версия {{ APP_VERSION }}<span v-if="state.isDemo"> · демо-режим</span></p>
    </section>`,
};
