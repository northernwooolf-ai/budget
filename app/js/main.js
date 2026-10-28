import { createApp, ref, onMounted, onBeforeUnmount } from 'vue';
import { state, init } from './store.js?v=2610290215';
import { localGet, localSet } from './utils.js?v=2610290215';
import { Icon } from './components.js?v=2610290215';
import { appearance } from './appearance.js?v=2610290215';
import { lock } from './lock.js?v=2610290215';
import { LockScreen } from './views/lock-screen.js?v=2610290215';
import { AuthView, OnboardingView } from './views/auth.js?v=2610290215';
import { OperationsView, TxEditor } from './views/operations.js?v=2610290215';
import { HomeView } from './views/home.js?v=2610290215';
import { ReportsView } from './views/reports.js?v=2610290215';
import { SettingsView } from './views/settings.js?v=2610290215';

const TABS = [
  { id: 'home', label: 'Главная', icon: 'home' },
  { id: 'ops', label: 'Операции', icon: 'list' },
  { id: 'reports', label: 'Отчёты', icon: 'chart' },
  { id: 'settings', label: 'Настройки', icon: 'settings' },
];

const App = {
  components: { Icon, AuthView, OnboardingView, OperationsView, TxEditor, HomeView, ReportsView, SettingsView, LockScreen },
  setup() {
    const saved = localGet('tab');
    const tab = ref(TABS.some((t) => t.id === saved) ? saved : 'home');
    const editor = ref(null);
    const setTab = (id) => { tab.value = id; localSet('tab', id); window.scrollTo(0, 0); };
    const openEditor = (tx) => { editor.value = { tx }; };

    // Кнопка «+» прячется, пока листаете вниз, и возвращается при прокрутке вверх.
    const fabHidden = ref(false);
    let lastY = 0;
    const onScroll = () => {
      const y = window.scrollY;
      if (Math.abs(y - lastY) > 8) fabHidden.value = y > lastY && y > 80;
      lastY = y;
    };
    onMounted(() => window.addEventListener('scroll', onScroll, { passive: true }));
    onBeforeUnmount(() => window.removeEventListener('scroll', onScroll));

    return { state, appearance, lock, TABS, tab, editor, setTab, openEditor, fabHidden };
  },
  template: `
    <div v-if="appearance.bg" class="app-bg" :style="{ backgroundImage: 'url(' + appearance.bg + ')' }" aria-hidden="true"></div>
    <div v-if="state.isDemo" class="demo-banner">Демо-режим: данные хранятся только в этом браузере</div>
    <div v-if="!state.ready" class="center-page"><p class="muted">Загрузка…</p></div>
    <auth-view v-else-if="!state.session"/>
    <lock-screen v-else-if="lock.locked"/>
    <onboarding-view v-else-if="!state.me"/>
    <div v-else class="shell">
      <nav class="nav" aria-label="Разделы">
        <div class="nav-brand"><img src="icons/icon.svg" alt="" width="28" height="28"><span>{{ state.household.name }}</span></div>
        <button v-for="t in TABS" :key="t.id" :class="['nav-item', {active: tab===t.id}]"
          :aria-current="tab===t.id ? 'page' : null" @click="setTab(t.id)">
          <icon :name="t.icon" :size="22"/><span>{{ t.label }}</span>
        </button>
        <button class="btn primary nav-add" @click="openEditor(null)"><icon name="plus"/> Добавить операцию</button>
      </nav>
      <main class="main">
        <home-view v-if="tab==='home'" @edit="openEditor"/>
        <operations-view v-else-if="tab==='ops'" @edit="openEditor"/>
        <reports-view v-else-if="tab==='reports'"/>
        <settings-view v-else/>
      </main>
      <button v-if="tab==='ops' || tab==='home'" :class="['fab', { hidden: fabHidden }]" @click="openEditor(null)" aria-label="Добавить операцию">
        <icon name="plus" :size="28"/>
      </button>
      <tx-editor v-if="editor" :tx="editor.tx" @close="editor = null"/>
    </div>
    <div v-if="state.toast" :class="['toast', state.toast.type]" role="status">{{ state.toast.text }}</div>`,
};

createApp(App).mount('#app');
init();

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
