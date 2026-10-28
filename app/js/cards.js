// Мини-карточки счетов: в цветах банка (определяется по названию счёта) или своя картинка.
import { computed } from 'vue';

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

// <card-chip :account="a" size="sm|md|lg"/> — карточка для карт, значок для остальных счетов.
export const CardChip = {
  props: { account: Object, size: { type: String, default: 'md' } },
  setup(props) {
    const style = computed(() => CARD_STYLES[props.account?.card_style] ?? CARD_STYLES[defaultStyle(props.account ?? {})]);
    const card = computed(() => isCardType(props.account) || !!props.account?.card_image);
    return { style, card };
  },
  template: `
    <span v-if="!card" :class="['acc-emoji', size]" aria-hidden="true">{{ account?.icon }}</span>
    <span v-else-if="account.card_image" :class="['card-chip', size]" aria-hidden="true"
      :style="{ backgroundImage: 'url(' + account.card_image + ')' }"></span>
    <span v-else :class="['card-chip', size]" :style="{ background: style.bg, color: style.fg }" aria-hidden="true">
      <span v-if="style.badge" class="cc-badge" :style="{ background: style.badge }">{{ style.brand }}</span>
      <span v-else class="cc-brand">{{ style.brand }}</span>
      <span v-if="account.card_last4" class="cc-last4">•• {{ account.card_last4 }}</span>
      <span class="cc-mir">МИР</span>
    </span>`,
};
