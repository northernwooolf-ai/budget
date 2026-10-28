import { ref, onMounted } from 'vue';
import { lock, unlock, enableLock, disableLock } from '../lock.js?v=2610290245';
import { state, signOut, toast } from '../store.js?v=2610290245';

// Экран замка: приложение открыто, но данные скрыты до подтверждения отпечатком.
export const LockScreen = {
  setup() {
    const error = ref('');
    const busy = ref(false);
    async function tryUnlock() {
      error.value = '';
      busy.value = true;
      try { await unlock(); } catch { error.value = 'Не получилось подтвердить. Попробуйте ещё раз или войдите паролем.'; }
      busy.value = false;
    }
    async function usePassword() {
      lock.locked = false;
      await signOut();
    }
    onMounted(tryUnlock);
    return { error, busy, tryUnlock, usePassword };
  },
  template: `
    <div class="center-page">
      <div class="card auth-card lock-card">
        <img src="icons/icon.svg" alt="" width="64" height="64">
        <h1>Семейный бюджет</h1>
        <p class="hint center">Приложение защищено. Подтвердите вход отпечатком пальца или кодом телефона.</p>
        <button class="btn primary wide" :disabled="busy" @click="tryUnlock"><span aria-hidden="true">🔒</span> Разблокировать</button>
        <p v-if="error" class="form-error center" role="alert">{{ error }}</p>
        <button class="btn ghost wide" @click="usePassword">Войти паролем</button>
      </div>
    </div>`,
};

// Карточка в настройках.
export const SecuritySettings = {
  setup() {
    const busy = ref(false);
    async function toggle(e) {
      busy.value = true;
      try {
        if (lock.enabled) { disableLock(); toast('Вход по отпечатку выключен'); }
        else { await enableLock(state.session?.user?.email); toast('Вход по отпечатку включён'); }
      } catch {
        toast('Не удалось включить: подтверждение отменено или не поддерживается', 'error');
      } finally {
        busy.value = false;
        e.target.checked = lock.enabled; // переключатель показывает, что получилось на самом деле
      }
    }
    return { lock, busy, toggle };
  },
  template: `
    <div class="card pad stack">
      <h2>Безопасность</h2>
      <template v-if="lock.available || lock.enabled">
        <label class="switch-row">
          <span>
            <b>Вход по отпечатку</b><br>
            <small class="hint">При открытии приложения и после минуты в фоне попросит отпечаток пальца, лицо или код телефона.
              Настраивается на каждом устройстве отдельно.</small>
          </span>
          <input id="lock-toggle" type="checkbox" class="switch" :checked="lock.enabled" :disabled="busy" @change="toggle">
        </label>
      </template>
      <p v-else class="hint">На этом устройстве нет отпечатка пальца или кода блокировки, поэтому вход по отпечатку недоступен.</p>
    </div>`,
};
