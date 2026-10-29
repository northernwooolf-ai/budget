// Единая точка доступа к данным. Работает либо с Supabase, либо в демо-режиме,
// у обоих вариантов одинаковый набор функций.
import { SUPABASE_URL, SUPABASE_KEY } from './config.js?v=2610291514';

// Адрес с ?demo открывает демо-режим даже при подключённой базе — для проверок.
export const isDemo = !SUPABASE_URL || !SUPABASE_KEY || new URLSearchParams(location.search).has('demo');

export const api = isDemo
  ? (await import('./api-demo.js?v=2610291514')).default
  : (await import('./api-supabase.js?v=2610291514')).default;
