// Мелкие общие элементы интерфейса.
import { ref, onMounted, onBeforeUnmount } from 'vue';
import Sortable from 'sortablejs';
import { state, shiftMonth } from './store.js?v=2610290215';
import { monthLabel } from './utils.js?v=2610290215';

const ICONS = {
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  wallet: 'M3 7a2 2 0 0 1 2-2h13v4M3 7v11a2 2 0 0 0 2 2h15V9H5a2 2 0 0 1-2-2zM16 14.5h.01',
  chart: 'M3 3v18h18M7 16v-4M12 16V8M17 16v-7',
  settings: 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6',
  plus: 'M12 5v14M5 12h14',
  close: 'M18 6 6 18M6 6l12 12',
  left: 'M15 18l-6-6 6-6',
  right: 'M9 18l6-6-6-6',
  copy: 'M8 8h12v12H8zM16 8V4H4v12h4',
  logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
  download: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3',
  arrow: 'M5 12h14M13 6l6 6-6 6',
  home: 'M3 11l9-8 9 8M5 9.5V20h5v-6h4v6h5V9.5',
  trash: 'M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6',
  grip: 'M9 6h.01M9 12h.01M9 18h.01M15 6h.01M15 12h.01M15 18h.01',
  down: 'M6 9l6 6 6-6',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-5-5',
  undo: 'M9 14L4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3',
  edit: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z',
  eye: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  eyeOff: 'M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4M6.6 6.6C3.8 8.4 2 12 2 12s3.6 7 10 7a9.6 9.6 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2',
};

export const Icon = {
  props: { name: String, size: { type: Number, default: 20 } },
  computed: { d() { return ICONS[this.name]; } },
  template: `<svg :width="size" :height="size" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path :d="d"/></svg>`,
};

// Кнопка с подтверждением: первое нажатие спрашивает, второе выполняет.
// Через 3 секунды без второго нажатия возвращается в исходный вид.
export const ConfirmButton = {
  components: { Icon },
  props: { icon: { type: String, default: 'trash' }, label: String, confirmText: String },
  emits: ['confirm'],
  setup(props, { emit }) {
    const armed = ref(false);
    let timer;
    function click() {
      clearTimeout(timer);
      if (armed.value) {
        armed.value = false;
        emit('confirm');
      } else {
        armed.value = true;
        timer = setTimeout(() => { armed.value = false; }, 3000);
      }
    }
    onBeforeUnmount(() => clearTimeout(timer));
    return { armed, click };
  },
  template: `
    <button type="button" :class="['confirm-btn', { armed }]" :title="label"
      :aria-label="armed ? confirmText : label" @click.stop="click">
      <span v-if="armed">{{ confirmText }}</span><icon v-else :name="icon" :size="18"/>
    </button>`,
};

// Перетаскивание строк (.s-item) за значок-ручку.
//   v-sortable="(from, to, toEl) => …"
//   v-sortable="{ onMove, handle: '.group-handle', group: 'cats' }" — group позволяет
//   переносить строки между списками с одинаковым group; toEl — список, куда бросили.
// Порядок в данных меняет обработчик, а Vue перерисовывает список сам.
const sortableOptions = (value) => (typeof value === 'function' ? { onMove: value } : value);

export const vSortable = {
  mounted(el, binding) {
    el._sortableValue = binding.value;
    const { handle = '.drag-handle', group, disabled = false } = sortableOptions(binding.value);
    let nextSibling = null;
    el._sortable = Sortable.create(el, {
      handle,
      group,
      disabled,
      draggable: '.s-item',
      animation: 150,
      forceFallback: true, // одинаково на телефоне и компьютере
      onStart(e) { nextSibling = e.item.nextSibling; },
      onEnd(e) {
        // Вернуть строку на прежнее место в DOM — иначе Vue запутается.
        e.from.insertBefore(e.item, nextSibling);
        if (e.from !== e.to || e.oldDraggableIndex !== e.newDraggableIndex) {
          sortableOptions(el._sortableValue).onMove(e.oldDraggableIndex, e.newDraggableIndex, e.to);
        }
      },
    });
  },
  updated(el, binding) {
    el._sortableValue = binding.value;
    el._sortable.option('disabled', !!sortableOptions(binding.value).disabled);
  },
  unmounted(el) { el._sortable.destroy(); },
};

const openModals = [];

export const Modal = {
  components: { Icon },
  props: { title: String },
  emits: ['close'],
  setup(props, { emit }) {
    // Окна могут открываться поверх друг друга — Esc закрывает только верхнее.
    const onKey = (e) => { if (e.key === 'Escape' && openModals.at(-1) === onKey) emit('close'); };
    onMounted(() => { openModals.push(onKey); document.addEventListener('keydown', onKey); });
    onBeforeUnmount(() => {
      openModals.splice(openModals.indexOf(onKey), 1);
      document.removeEventListener('keydown', onKey);
    });
  },
  template: `
    <div class="modal-backdrop" @mousedown.self="$emit('close')">
      <div class="modal" role="dialog" aria-modal="true" :aria-label="title">
        <header class="modal-head">
          <h2>{{ title }}</h2>
          <button class="icon-btn" @click="$emit('close')" aria-label="Закрыть"><icon name="close"/></button>
        </header>
        <div class="modal-body"><slot/></div>
        <footer v-if="$slots.footer" class="modal-foot"><slot name="footer"/></footer>
      </div>
    </div>`,
};

export const MonthSwitcher = {
  components: { Icon },
  setup: () => ({ state, shiftMonth, monthLabel }),
  template: `
    <div class="month-switch">
      <button class="icon-btn" @click="shiftMonth(-1)" aria-label="Предыдущий месяц"><icon name="left"/></button>
      <span class="month-label">{{ monthLabel(state.month) }}</span>
      <button class="icon-btn" @click="shiftMonth(1)" aria-label="Следующий месяц"><icon name="right"/></button>
    </div>`,
};

const EMOJI = ['🛒', '🥪', '🍫', '🍽️', '☕', '🧴', '🚕', '🚌', '🚕', '⛽', '🚗', '🏠', '💡', '📱', '💊', '🏥', '👕', '👟', '🧸', '🎓',
  '📚', '🎬', '🎮', '🎁', '💇', '🐶', '✈️', '🏖️', '🏋️', '🔁', '🧾', '🛠️', '📦', '💼', '🧰', '💰',
  '💵', '💳', '🏦', '🐷', '📈', '🤝', '🧾', '➕', '❤️'];

export const EmojiPicker = {
  props: { modelValue: String },
  emits: ['update:modelValue'],
  setup: () => ({ EMOJI }),
  template: `
    <div class="emoji-grid" role="radiogroup" aria-label="Значок">
      <button v-for="e in EMOJI" :key="e" type="button" role="radio" :aria-checked="modelValue === e"
        :class="['emoji-opt', { selected: modelValue === e }]" @click="$emit('update:modelValue', e)">{{ e }}</button>
    </div>`,
};
