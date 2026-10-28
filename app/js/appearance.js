// Оформление: тема, цветовая схема, акцентный цвет и фоновая картинка.
// Хранится на каждом устройстве отдельно (localStorage), в базу не попадает.
import { reactive, watch } from 'vue';
import { localGet, localSet } from './utils.js?v=2610290221';

const KEY = 'appearance';
const BG_KEY = 'appearance-bg';

export const SCHEMES = [
  { id: 'classic', label: 'Классика', swatches: ['#f4f5f3', '#ffffff', '#0f1110'] },
  { id: 'graphite', label: 'Графит', swatches: ['#eef0f3', '#ffffff', '#16181d'] },
  { id: 'ocean', label: 'Океан', swatches: ['#eaf2f8', '#f8fbfe', '#0c1622'] },
  { id: 'warm', label: 'Тёплая', swatches: ['#f5f1ea', '#fffdf9', '#17140f'] },
];

export const ACCENTS = [
  { id: 'teal', label: 'Бирюзовый', color: '#0f766e' },
  { id: 'blue', label: 'Синий', color: '#2563eb' },
  { id: 'violet', label: 'Фиолетовый', color: '#7c3aed' },
  { id: 'pink', label: 'Розовый', color: '#db2777' },
  { id: 'red', label: 'Красный', color: '#dc2626' },
  { id: 'orange', label: 'Оранжевый', color: '#ea580c' },
  { id: 'amber', label: 'Янтарный', color: '#b45309' },
  { id: 'green', label: 'Зелёный', color: '#15803d' },
];

const DEFAULTS = { theme: 'auto', scheme: 'classic', accent: '#0f766e', blur: 8, dim: 35, glass: 82 };

function load() {
  try { return { ...DEFAULTS, ...JSON.parse(localGet(KEY)) }; } catch { return { ...DEFAULTS }; }
}

export const appearance = reactive({ ...load(), bg: localGet(BG_KEY) });

function apply() {
  const root = document.documentElement;
  if (appearance.theme === 'auto') delete root.dataset.theme;
  else root.dataset.theme = appearance.theme;
  root.dataset.scheme = appearance.scheme;
  root.style.setProperty('--accent', appearance.accent);
  root.style.setProperty('--bg-blur', `${appearance.blur}px`);
  root.style.setProperty('--bg-dim', `${appearance.dim / 100}`);
  root.style.setProperty('--glass', `${appearance.glass}%`);
  root.classList.toggle('has-bg', !!appearance.bg);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', appearance.accent);
}

watch(appearance, () => {
  const { bg, ...rest } = appearance;
  localSet(KEY, JSON.stringify(rest));
  apply();
}, { deep: true });
apply();

// Картинку уменьшаем до 1600 px и сохраняем в JPEG, чтобы поместилась в память браузера.
export async function setBackground(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const url = canvas.toDataURL('image/jpeg', 0.8);
  try { localStorage.setItem(BG_KEY, url); } catch { throw new Error('Картинка слишком большая для памяти браузера, выберите другую'); }
  appearance.bg = url;
}

export function clearBackground() {
  try { localStorage.removeItem(BG_KEY); } catch { /* не страшно */ }
  appearance.bg = null;
}

export function resetAppearance() {
  clearBackground();
  Object.assign(appearance, DEFAULTS);
}
