import { ref, reactive } from 'vue';
import { api } from '../api.js?v=2610290226';
import { state, setupHousehold, signOut } from '../store.js?v=2610290226';
import { Icon } from '../components.js?v=2610290226';
import { localGet, localSet } from '../utils.js?v=2610290226';

const EMAIL_KEY = 'last-email';

export const AuthView = {
  components: { Icon },
  setup() {
    const mode = ref('signin');
    const showPassword = ref(false);
    // Почта последнего входа подставляется сама; пароль сохраняет и подставляет браузер.
    const form = reactive({ email: localGet(EMAIL_KEY, ''), password: '' });
    const busy = ref(false);
    const error = ref('');

    async function submit() {
      error.value = '';
      busy.value = true;
      try {
        const email = form.email.trim();
        localSet(EMAIL_KEY, email);
        if (mode.value === 'signin') await api.signIn(email, form.password);
        else {
          const { signedIn } = await api.signUp(email, form.password);
          if (!signedIn) error.value = 'Мы отправили письмо для подтверждения. Откройте его, затем войдите.';
        }
      } catch (e) {
        error.value = e.message;
      } finally {
        busy.value = false;
      }
    }

    return { state, mode, form, busy, error, submit, showPassword };
  },
  template: `
    <div class="center-page">
      <form class="card auth-card" @submit.prevent="submit">
        <div class="brand-big">
          <img src="icons/icon.svg" alt="" width="56" height="56">
          <h1>Семейный бюджет</h1>
        </div>
        <div class="segmented" role="tablist">
          <button type="button" role="tab" :aria-selected="mode==='signin'" :class="{active: mode==='signin'}" @click="mode='signin'; error=''">Вход</button>
          <button type="button" role="tab" :aria-selected="mode==='signup'" :class="{active: mode==='signup'}" @click="mode='signup'; error=''">Регистрация</button>
        </div>
        <label class="field">
          <span>Электронная почта</span>
          <input id="email" name="email" v-model="form.email" type="email" autocomplete="username" required>
        </label>
        <label class="field">
          <span>Пароль</span>
          <span class="password-box">
            <input id="password" name="password" v-model="form.password" :type="showPassword ? 'text' : 'password'" minlength="6" required
              :autocomplete="mode==='signin' ? 'current-password' : 'new-password'">
            <button type="button" class="icon-btn" :aria-label="showPassword ? 'Скрыть пароль' : 'Показать пароль'"
              :title="showPassword ? 'Скрыть пароль' : 'Показать пароль'" @click="showPassword = !showPassword">
              <icon :name="showPassword ? 'eyeOff' : 'eye'"/>
            </button>
          </span>
          <small v-if="mode==='signup'" class="hint">Не короче 6 символов</small>
        </label>
        <p v-if="error" class="form-error" role="alert">{{ error }}</p>
        <button class="btn primary wide" :disabled="busy">
          {{ busy ? 'Подождите…' : (mode==='signin' ? 'Войти' : 'Зарегистрироваться') }}
        </button>
        <p v-if="state.isDemo" class="hint center">Демо-режим: зарегистрируйтесь с любой почтой и паролем от 6 символов.</p>
      </form>
    </div>`,
};

export const OnboardingView = {
  setup() {
    const mode = ref('create');
    const form = reactive({ displayName: '', name: 'Наша семья', code: '' });
    const busy = ref(false);
    const error = ref('');

    async function submit() {
      error.value = '';
      busy.value = true;
      try {
        await setupHousehold(mode.value, form);
      } catch (e) {
        error.value = e.message;
      } finally {
        busy.value = false;
      }
    }

    return { state, mode, form, busy, error, submit, signOut };
  },
  template: `
    <div class="center-page">
      <form class="card auth-card" @submit.prevent="submit">
        <h1>Давайте познакомимся</h1>
        <label class="field">
          <span>Как вас зовут?</span>
          <input v-model="form.displayName" required maxlength="30" placeholder="Например, Сергей">
          <small class="hint">Это имя увидит супруга рядом с вашими операциями</small>
        </label>
        <div class="choice-list">
          <label :class="['choice', {active: mode==='create'}]">
            <input type="radio" value="create" v-model="mode">
            <span><b>Создать семейный бюджет</b><br><small>Если вы начинаете первым</small></span>
          </label>
          <label :class="['choice', {active: mode==='join'}]">
            <input type="radio" value="join" v-model="mode">
            <span><b>Присоединиться по коду</b><br><small>Если супруга уже создала бюджет и прислала код</small></span>
          </label>
        </div>
        <label v-if="mode==='create'" class="field">
          <span>Название</span>
          <input v-model="form.name" maxlength="40">
        </label>
        <label v-else class="field">
          <span>Код приглашения</span>
          <input v-model="form.code" required maxlength="8" class="code-input" autocapitalize="characters" placeholder="ABCD1234">
          <small class="hint">Код есть у супруги в разделе «Настройки»</small>
        </label>
        <p v-if="error" class="form-error" role="alert">{{ error }}</p>
        <button class="btn primary wide" :disabled="busy">{{ busy ? 'Подождите…' : 'Продолжить' }}</button>
        <button type="button" class="btn ghost wide" @click="signOut">Выйти из аккаунта</button>
      </form>
    </div>`,
};
