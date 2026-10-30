const rubles = new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 });
const kopecks = new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', minimumFractionDigits: 2 });

// Копейки показываем только когда они есть: «1 250 ₽», «1 250,50 ₽».
export function money(v) {
  const n = Math.round((Number(v) || 0) * 100) / 100 || 0; // «|| 0» убирает «−0»
  return (Number.isInteger(n) ? rubles : kopecks).format(n).replace('-', '−');
}

// Итоги на дашбордах — в целых рублях, копейки просто отбрасываем (3,99 → 3).
export const rub = (v) => money(Math.trunc(Number(v) || 0));

// «1 234,50» → 1234.5; NaN, если ввели не число.
export function parseAmount(s) {
  const n = Number(String(s ?? '').replace(/[\s ]/g, '').replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
}

export function amountToInput(v) {
  return v == null ? '' : String(Number(v)).replace('.', ',');
}

// Даты храним строками YYYY-MM-DD в местном времени, без часовых поясов.
export function isoDate(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function parseIso(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export const today = () => isoDate(new Date());
export const monthStart = (d) => new Date(d.getFullYear(), d.getMonth(), 1);
export const addMonths = (d, n) => new Date(d.getFullYear(), d.getMonth() + n, 1);

const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);

export function monthLabel(d) {
  return capitalize(d.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' }).replace(/\s*г\.$/, ''));
}

export function monthShort(d) {
  return d.toLocaleDateString('ru-RU', { month: 'short' }).replace('.', '');
}

export function dayLabel(iso) {
  const t = today();
  if (iso === t) return 'Сегодня';
  const y = new Date(); y.setDate(y.getDate() - 1);
  if (iso === isoDate(y)) return 'Вчера';
  const d = parseIso(iso);
  const opts = { day: 'numeric', month: 'long', weekday: 'long' };
  if (d.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
  return capitalize(d.toLocaleDateString('ru-RU', opts));
}

// Поиск по первым буквам: сначала названия, где слово начинается с введённого. Возвращает подходящие.
export function searchByName(items, query, nameOf = (x) => x.name) {
  const clean = (s) => s.trim().toLowerCase().replace(/ё/g, 'е');
  const q = clean(query);
  if (!q) return items;
  const rank = (x) => {
    const name = clean(nameOf(x));
    if (name.startsWith(q)) return 0;
    if (name.split(/[\s,.\-–—()]+/).some((w) => w.startsWith(q))) return 1;
    return name.includes(q) ? 2 : -1;
  };
  return items.map((x) => ({ x, r: rank(x) })).filter((e) => e.r >= 0).sort((a, b) => a.r - b.r).map((e) => e.x);
}

export function localGet(key, fallback = null) {
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}

export function localSet(key, value) {
  try { localStorage.setItem(key, value); } catch { /* приватный режим — не страшно */ }
}

export const bySort = (a, b) => a.sort - b.sort || a.created_at.localeCompare(b.created_at);

export function pick(obj, keys) {
  const out = {};
  for (const k of keys) if (obj[k] !== undefined) out[k] = obj[k];
  return out;
}

export function downloadFile(name, text, type = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob(['﻿' + text], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
