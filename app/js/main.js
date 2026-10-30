import { createApp, ref, onMounted, onBeforeUnmount } from 'vue';
import { state, init } from './store.js?v=2610301605';
import { localGet, localSet } from './utils.js?v=2610301605';
import { Icon } from './components.js?v=2610301605';
import { appearance } from './appearance.js?v=2610301605';
import { lock } from './lock.js?v=2610301605';
import { LockScreen } from './views/lock-screen.js?v=2610301605';
import { AuthView, OnboardingView } from './views/auth.js?v=2610301605';
import { OperationsView, TxEditor, copyOfTx } from './views/operations.js?v=2610301605';
import { HomeView } from './views/home.js?v=2610301605';
import { ReportsView } from './views/reports.js?v=2610301605';
import { SettingsView } from './views/settings.js?v=2610301605';
import { ImportView } from './views/import.js?v=2610301605';
import { AssistantChat } from './views/assistant.js?v=2610301605';
import { simpleView } from './ui-state.js?v=2610301605';

const TABS = [
  { id: 'home', label: 'Главная', icon: 'home' },
  { id: 'ops', label: 'Операции', icon: 'list' },
  { id: 'reports', label: 'Отчёты', icon: 'chart' },
  { id: 'ask', label: 'Помощник', icon: 'chat' },
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
    // Удержание на операции: окно новой операции, заполненное как в образце.
    const openCopy = (tx) => openEditor(copyOfTx(tx));
    // «+» сначала раскрывает круглые кнопки по дуге: новая операция, голосом или со скриншота.
    const fabOpen = ref(false);
    const importing = ref(null); // 'shot' или 'voice'
    const fabPick = (what) => {
      fabOpen.value = false;
      if (what === 'tx') openEditor(null);
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

    return { state, appearance, lock, TABS, tab, editor, setTab, openEditor, openCopy, fabHidden, fabOpen, fabPick, importing, savedAtLabel, simpleView };
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
        <button v-if="!state.offline" class="btn nav-add" @click="importing = 'shot'"><icon name="camera"/> Загрузить скриншот</button>
        <button v-if="!state.offline" class="btn nav-add" @click="importing = 'voice'"><icon name="mic"/> Надиктовать</button>
      </nav>
      <main :class="['main', { 'main-chat': tab==='ask' && !simpleView }]">
        <home-view v-if="tab==='home' || simpleView" @edit="openEditor" @copy="openCopy"/>
        <operations-view v-else-if="tab==='ops'" @edit="openEditor" @copy="openCopy"/>
        <reports-view v-else-if="tab==='reports'" @edit="openEditor" @copy="openCopy"/>
        <assistant-chat v-else-if="tab==='ask'"/>
        <settings-view v-else/>
      </main>
      <template v-if="(tab==='ops' || tab==='home') && !state.offline && !simpleView">
        <div :class="['fab-backdrop', { open: fabOpen }]" @click="fabOpen = false"></div>
        <div :class="['fab-arc', { open: fabOpen }]" role="menu" aria-label="Что добавить">
          <button type="button" class="fab-round arc-1" role="menuitem" :tabindex="fabOpen ? 0 : -1" title="Скриншот" aria-label="Скриншот" @click="fabPick('shot')"><icon name="camera" :size="24"/></button>
          <button type="button" class="fab-round arc-2" role="menuitem" :tabindex="fabOpen ? 0 : -1" title="Диктовать" aria-label="Диктовать" @click="fabPick('voice')"><icon name="mic" :size="24"/></button>
          <button type="button" class="fab-round arc-3" role="menuitem" :tabindex="fabOpen ? 0 : -1" title="Новая операция" aria-label="Новая операция" @click="fabPick('tx')"><icon name="coin" :size="24"/></button>
        </div>
        <button :class="['fab', { hidden: fabHidden, open: fabOpen }]" :aria-expanded="fabOpen" aria-haspopup="menu"
          aria-label="Добавить" @click="fabOpen = !fabOpen">
          <icon name="plus" :size="28"/>
        </button>
      </template>
      <tx-editor v-if="editor" :tx="editor.tx" @close="editor = null"/>
      <import-view v-if="importing" :mode="importing" @close="importing = null"/>
    </div>
    <div v-if="state.toast" :class="['toast', state.toast.type]" role="status">{{ state.toast.text }}</div>`,
};

createApp(App).mount('#app');
init();

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
