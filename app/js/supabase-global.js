// Библиотека Supabase лежит в vendor/supabase.js (подключается в index.html обычным скриптом)
// и создаёт глобальный объект window.supabase. Здесь он отдаётся как обычный модуль.
export const createClient = (...args) => window.supabase.createClient(...args);
