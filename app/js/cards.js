// Мини-карточки счетов: в цветах банка (определяется по названию счёта) или своя картинка.
import { ref, reactive, computed, watch, onBeforeUnmount } from 'vue';
import { Icon } from './components.js?v=2610301653';
import { searchByName } from './utils.js?v=2610301653';

// Названия банков, как их пишут в счетах и как их называет GigaChat на скриншотах.
export const BANKS = {
  sber: ['сбер'],
  tbank: ['т-банк', 'т банк', 'тбанк', 'тинькофф', 'tinkoff', 'tbank'],
  otp: ['отп', 'otp'],
  ozon: ['озон', 'ozon'],
  mkb: ['мкб', 'московский кредитный'],
  wb: ['wildberries', 'вайлдберриз', 'вб банк', 'вб дк', 'вб кошел', 'wb банк', 'wb bank'],
  alfa: ['альфа', 'alfa'],
};

export const bankKey = (text) => {
  const t = String(text ?? '').toLowerCase();
  return Object.keys(BANKS).find((k) => BANKS[k].some((alias) => t.includes(alias))) ?? null;
};

// Оформление карт: фон, цвет надписей и подпись банка.
export const CARD_STYLES = {
  sber: { label: 'Сбер', bg: 'linear-gradient(135deg, #2bc04d, #10812f)', fg: '#ffffff', brand: 'СБЕР' },
  'sber-gray': { label: 'Сбер серая', bg: 'linear-gradient(135deg, #d6d8dc, #9da1a8)', fg: '#ffffff', brand: 'СБЕР' },
  tbank: { label: 'Т-Банк', bg: 'linear-gradient(135deg, #2b2b2b, #0d0d0d)', fg: '#ffffff', brand: 'Т', badge: '#ffdd2d' },
  otp: { label: 'ОТП', bg: 'linear-gradient(135deg, #d9ff5c, #b5e832)', fg: '#1d2b00', brand: 'ОТП' },
  ozon: { label: 'Озон', bg: 'linear-gradient(135deg, #1a6dff, #0047d6)', fg: '#ffffff', brand: 'ozon' },
  'ozon-violet': { label: 'Озон фиолетовая', bg: 'linear-gradient(135deg, #8b5cf6, #5b21d6)', fg: '#ffffff', brand: 'ozon' },
  mkb: { label: 'МКБ', bg: 'linear-gradient(135deg, #f1f1f1, #cfcfcf)', fg: '#d0021b', brand: 'МКБ' },
  alfa: { label: 'Альфа', bg: 'linear-gradient(135deg, #f04a3c, #c8170b)', fg: '#ffffff', brand: 'А' },
  wb: { label: 'WB', bg: 'linear-gradient(135deg, #cb11ab, #481173)', fg: '#ffffff', brand: 'WB' },
  slate: { label: 'Графит', bg: 'linear-gradient(135deg, #475569, #1e293b)', fg: '#ffffff', brand: '' },
  gold: { label: 'Золото', bg: 'linear-gradient(135deg, #f5d27a, #b8862b)', fg: '#3b2a05', brand: '' },
};

// Стиль по умолчанию: по банку из названия; у кредиток Озона — фиолетовый, как у настоящих.
export function defaultStyle(account) {
  const key = bankKey(account.name);
  if (key === 'ozon' && account.type === 'credit') return 'ozon-violet';
  return key && CARD_STYLES[key] ? key : 'slate';
}

export const isCardType = (account) => account?.type === 'debit' || account?.type === 'credit';

// Счета, которые не карты, рисуем плиткой того же размера, что и карта, с оттенком по типу счёта.
const TYPE_TINTS = { cash: '#22c55e', deposit: '#ec4899', investment: '#6366f1', lent: '#f59e0b', borrowed: '#ef4444' };
const tileBg = (type) => {
  const tint = TYPE_TINTS[type] ?? '#64748b';
  return `linear-gradient(135deg, color-mix(in srgb, ${tint} 32%, var(--surface-2)), color-mix(in srgb, ${tint} 12%, var(--surface-2)))`;
};

// Картинку карты обрезаем по центру под пропорции банковской карты и сжимаем,
// чтобы она занимала в базе считанные килобайты.
export async function cardImageFromFile(file) {
  const bitmap = await createImageBitmap(file);
  const ratio = 1.586;
  let sw = bitmap.width, sh = bitmap.width / ratio;
  if (sh > bitmap.height) { sh = bitmap.height; sw = sh * ratio; }
  const canvas = document.createElement('canvas');
  canvas.width = 320; canvas.height = Math.round(320 / ratio);
  canvas.getContext('2d').drawImage(bitmap, (bitmap.width - sw) / 2, (bitmap.height - sh) / 2, sw, sh, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.82);
}

// Светлая ли карта — чтобы подпись на ней была контрастной. Яркость по формуле восприятия (0–255).
const luma = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;
const LIGHT_FROM = 160;

function gradientIsLight(bg) {
  const colors = bg.match(/#[0-9a-f]{6}/gi) ?? [];
  const sum = colors.reduce((s, c) => s + luma(...[1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16))), 0);
  return sum / colors.length > LIGHT_FROM;
}

// Свои картинки карт: яркость считаем один раз по уменьшенной копии.
const imageLight = reactive(new Map());
function measureImage(url) {
  if (imageLight.has(url)) return;
  imageLight.set(url, false);
  const img = new Image();
  img.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = 8; canvas.height = 5;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, 8, 5);
    const d = ctx.getImageData(0, 0, 8, 5).data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) sum += luma(d[i], d[i + 1], d[i + 2]);
    imageLight.set(url, sum / (d.length / 4) > LIGHT_FROM);
  };
  img.src = url;
}

// <card-chip :account="a" size="sm|md|lg"/> — карточка для карт, значок для остальных счетов.
// percent — подпись прямо на карте (кэшбэк), тёмная на светлой карте и светлая на тёмной.
export const CardChip = {
  props: { account: Object, size: { type: String, default: 'md' }, percent: String },
  setup(props) {
    const style = computed(() => CARD_STYLES[props.account?.card_style] ?? CARD_STYLES[defaultStyle(props.account ?? {})]);
    const card = computed(() => isCardType(props.account) || !!props.account?.card_image);
    const tile = computed(() => tileBg(props.account?.type));
    const percentClass = computed(() => {
      const image = props.account?.card_image;
      if (image && props.percent) measureImage(image);
      return (image ? imageLight.get(image) : gradientIsLight(style.value.bg)) ? 'on-light' : 'on-dark';
    });
    return { style, card, tile, percentClass };
  },
  template: `
    <span v-if="!card" :class="['acc-emoji', size]" :style="{ background: tile }" aria-hidden="true">{{ account?.icon }}</span>
    <span v-else-if="account.card_image" :class="['card-chip', size]" aria-hidden="true"
      :style="{ backgroundImage: 'url(' + account.card_image + ')' }">
      <span v-if="percent" :class="['cc-percent', percentClass]">{{ percent }}</span>
    </span>
    <span v-else :class="['card-chip', size]" :style="{ background: style.bg, color: style.fg }" aria-hidden="true">
      <span v-if="style.badge" class="cc-badge" :style="{ background: style.badge }">{{ style.brand }}</span>
      <span v-else class="cc-brand">{{ style.brand }}</span>
      <span v-if="percent" :class="['cc-percent', percentClass]">{{ percent }}</span>
      <template v-else>
        <span v-if="account.card_last4" class="cc-last4">•• {{ account.card_last4 }}</span>
        <span class="cc-mir">МИР</span>
      </template>
    </span>`,
};

// <account-select v-model="id" :groups="[{ label, items }]"/> — выбор счёта с карточками
// вместо обычного списка (в системном списке телефона картинки не показать).
// Прямо в строке можно печатать: в списке остаются только подходящие счета.
export const AccountSelect = {
  components: { CardChip, Icon },
  props: { modelValue: String, groups: Array, label: String, placeholder: { type: String, default: 'Выберите' } },
  emits: ['update:modelValue'],
  setup(props, { emit }) {
    const open = ref(false);
    const query = ref('');
    const root = ref(null);
    const input = ref(null);
    const menuStyle = ref({});
    const current = computed(() => props.groups.flatMap((g) => g.items).find((a) => a.id === props.modelValue));
    const shown = computed(() => props.groups
      .map((g) => ({ ...g, items: searchByName(g.items, query.value) })).filter((g) => g.items.length));

    // Список — под строкой, а если снизу мало места (открыта клавиатура) — над ней.
    function place() {
      if (!root.value) return;
      const r = root.value.getBoundingClientRect();
      const vv = window.visualViewport;
      const top = vv?.offsetTop ?? 0, bottom = top + (vv?.height ?? window.innerHeight);
      const below = bottom - r.bottom - 12, above = r.top - top - 12;
      const down = below >= 200 || below >= above;
      const width = Math.max(r.width, Math.min(320, window.innerWidth - 24));
      menuStyle.value = {
        left: `${Math.max(12, Math.min(r.left, window.innerWidth - width - 12))}px`,
        width: `${width}px`,
        maxHeight: `${Math.max(down ? below : above, 120)}px`,
        ...(down ? { top: `${r.bottom + 4}px` } : { bottom: `${window.innerHeight - r.top + 4}px` }),
      };
    }
    function show() {
      if (open.value) return;
      query.value = '';
      place();
      open.value = true;
    }
    function close() {
      open.value = false;
      input.value?.blur();
    }
    function choose(a) {
      emit('update:modelValue', a.id);
      close();
    }
    const chooseFirst = () => { if (shown.value.length) choose(shown.value[0].items[0]); };
    function focusLine() {
      input.value?.focus();
      if (document.activeElement === input.value) show(); // уже в фокусе: событие focus не повторится
    }

    // Esc закрывает только список, а не окно под ним.
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      e.stopImmediatePropagation();
      close();
    };
    function listen(on) {
      const method = on ? 'addEventListener' : 'removeEventListener';
      window[method]('keydown', onKey, true);
      window.visualViewport?.[method]('resize', place);
      window.visualViewport?.[method]('scroll', place);
    }
    watch(open, listen);
    onBeforeUnmount(() => listen(false));
    return { open, query, root, input, menuStyle, current, shown, show, close, choose, chooseFirst, focusLine };
  },
  template: `
    <div ref="root" class="acc-select" @click="focusLine">
      <icon v-if="open" name="search" :size="18"/>
      <card-chip v-else-if="current" :account="current" size="sm"/>
      <!-- Не v-model: клавиатура телефона набирает слово «черновиком», и v-model ждёт его окончания. -->
      <input ref="input" :value="open ? query : current?.name ?? ''" :placeholder="current?.name ?? placeholder" :aria-label="label"
        role="combobox" aria-haspopup="listbox" :aria-expanded="open" autocomplete="off" enterkeyhint="done"
        @focus="show" @input="query = $event.target.value" @keydown.enter.prevent="chooseFirst">
      <icon name="down" :size="16"/>
    </div>
    <teleport to="body">
      <div v-if="open" class="acc-select-backdrop" @click.self="close">
        <div class="acc-select-menu" role="listbox" :aria-label="label" :style="menuStyle">
          <template v-for="g in shown" :key="g.label">
            <div v-if="g.label && shown.length > 1" class="acc-select-group">{{ g.label }}</div>
            <button v-for="a in g.items" :key="a.id" type="button" role="option" :aria-selected="a.id === modelValue"
              :class="['acc-select-opt', { selected: a.id === modelValue }]" @click="choose(a)">
              <card-chip :account="a" size="sm"/><span class="acc-select-name">{{ a.name }}</span>
            </button>
          </template>
          <p v-if="!shown.length" class="acc-select-empty">Ничего не нашлось</p>
        </div>
      </div>
    </teleport>`,
};
