// Какие разделители раскрыты. При каждом запуске приложения всё свёрнуто,
// а пока приложение открыто, раскрытое остаётся раскрытым при переходах между экранами.
import { reactive } from 'vue';

export const expanded = {
  accountGroups: reactive(new Set()),  // группы счетов на главной
  categorySections: reactive(new Set()), // разделы категорий в настройках
  reportGroups: reactive(new Set()),   // разделы в отчётах
};

export function toggleIn(set, id) {
  if (set.has(id)) set.delete(id);
  else set.add(id);
}
