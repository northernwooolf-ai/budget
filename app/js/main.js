import { createApp, ref, onMounted, onBeforeUnmount } from 'vue';
import { state, init } from './store.js?v=2610291841';
import { localGet, localSet } from './utils.js?v=2610291841';
import { Icon } from './components.js?v=2610291841';
import { appearance } from './appearance.js?v=2610291841';
import { lock } from './lock.js?v=2610291841';
import { LockScreen } from './views/lock-screen.js?v=2610291841';
import { AuthView, OnboardingView } from './views/auth.js?v=2610291841';
import { OperationsView, TxEditor } from './views/operations.js?v=2610291841';
import { HomeView } from './views/home.js?v=2610291841';
import { ReportsView } from './views/reports.js?v=2610291841';
import { SettingsView } from './views/settings.js?v=2610291841';
import { ImportView } from './views/import.js?v=2610291841';
import { AssistantChat } from './views/assistant.js?v=2610291841';
import { simpleView } from './ui-state.js?v=2610291841';

const TABS = [
  { id: 'home', label: 'Главная', icon: 'home' },
  { id: 'ops', label: 'Операции', icon: 'list' },
  { id: 'reports', label: 'Отчёты', icon: 'chart' },
  { id: 'settings', label: 'Настройки', icon: 'settings' },
];

const App = {
  components: { Icon, AuthView, OnboardingView, OperationsView, TxEditor, HomeView, ReportsView, SettingsView, LockScreen, ImportView, AssistantChat },
  setup() {
    const saved = localGet('tab');
    const tab = ref(TABS.some((t) => t.id === saved) ? saved : 'home');
    const editor = ref(null);
    const setTab = (id) => { tab.value = id; localSet('tab', id); window.scrollTo(0, 0); };
    const openEditor = (tx) => { editor.value = { tx }; };
    // «+» сначала раскрывает плашки: новая операция, голосом, со скриншота или вопрос помощнику.
    const fabOpen = ref(false);
    const importing = ref(null); // 'shot' или 'voice'
    const asking = ref(false);
    const fabPick = (what) => {
      fabOpen.value = false;
      if (what === 'tx') openEditor(null);
      else if (what === 'ask') asking.value = true;
      else importing.value = what;
    };

    // Кнопка «+» прячется, пока листаете вниз, и возвращается при прокрутке вверх.
    const fabHidden = ref(false);
    let lastY = 0;
    const onScroll = () => {
      const y = window.scrollY;
      if (Math.abs(y - lastY) > 8) fabHidden.value = y > lastY && y > 80;
      if (fabHidden.value) fabOpen.value = false;
      lastY = y;
    };
    onMounted(() => window.addEventListener('scroll', onScroll, { passive: true }));
    onBeforeUnmount(() => window.removeEventListener('scroll', onScroll));

    const savedAtLabel = (ts) => new Date(ts).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

    return { state, appearance, lock, TABS, tab, editor, setTab, openEditor, fabHidden, fabOpen, fabPick, importing, asking, savedAtLabel, simpleView };
  },
  template: `
    <div v-if="appearance.bg" class="app-bg" :style="{ backgroundImage: 'url(' + appearance.bg + ')' }" aria-hidden="true"></div>
    <div v-if="state.isDemo" class="demo-banner">Демо-режим: данные хранятся только в этом браузере</div>
    <div v-if="state.offline" class="demo-banner offline-banner" role="status">
      Нет интернета · данные на {{ savedAtLabel(state.offline.savedAt) }} · только просмотр
    </div>
    <div v-if="!state.ready" class="center-page"><p class="muted">Загрузка…</p></div>
    <auth-view v-else-if="!state.session"/>
    <lock-screen v-else-if="lock.locked"/>
    <onboarding-view v-else-if="!state.me"/>
    <div v-else :class="['shell', { simple: simpleView }]">
      <nav v-if="!simpleView" class="nav" aria-label="Разделы">
        <div class="nav-brand"><img src="icons/icon.svg" alt="" width="28" height="28"><span>{{ state.household.name }}</span></div>
        <button v-for="t in TABS" :key="t.id" :class="['nav-item', {active: tab===t.id}]"
          :aria-current="tab===t.id ? 'page' : null" @click="setTab(t.id)">
          <icon :name="t.icon" :size="22"/><span>{{ t.label }}</span>
        </button>
        <button class="btn primary nav-add" @click="openEditor(null)"><icon name="plus"/> Добавить операцию</button>
        <button v-if="!state.offline" class="btn nav-add" @click="importing = 'voice'">🎙️ Надиктовать</button>
        <button v-if="!state.offline" class="btn nav-add nav-ask" @click="asking = true">💬 Спросить помощника</button>
      </nav>
      <main class="main">
        <home-view v-if="tab==='home' || simpleView" @edit="openEditor"/>
        <operations-view v-else-if="tab==='ops'" @edit="openEditor"/>
        <reports-view v-else-if="tab==='reports'" @edit="openEditor"/>
        <settings-view v-else/>
      </main>
      <template v-if="(tab==='ops' || tab==='home') && !state.offline && !simpleView">
        <div v-if="fabOpen" class="fab-backdrop" @click="fabOpen = false"></div>
        <div v-if="fabOpen" class="fab-menu" role="menu">
          <button type="button" class="fab-pill" role="menuitem" @click="fabPick('ask')"><span aria-hidden="true">💬</span> Спросить</button>
          <button type="button" class="fab-pill" role="menuitem" @click="fabPick('shot')"><span aria-hidden="true">📷</span> Скриншот</button>
          <button type="button" class="fab-pill" role="menuitem" @click="fabPick('voice')"><span aria-hidden="true">🎙️</span> Диктовать</button>
          <button type="button" class="fab-pill" role="menuitem" @click="fabPick('tx')"><span aria-hidden="true">🪙</span> Операция</button>
        </div>
        <button :class="['fab', { hidden: fabHidden, open: fabOpen }]" :aria-expanded="fabOpen" aria-haspopup="menu"
          aria-label="Добавить" @click="fabOpen = !fabOpen">
          <icon name="plus" :size="28"/>
        </button>
      </template>
      <tx-editor v-if="editor" :tx="editor.tx" @close="editor = null"/>
      <import-view v-if="importing" :mode="importing" @close="importing = null"/>
      <assistant-chat v-if="asking" @close="asking = false"/>
    </div>
    <div v-if="state.toast" :class="['toast', state.toast.type]" role="status">{{ state.toast.text }}</div>`,
};

createApp(App).mount('#app');
init();

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
