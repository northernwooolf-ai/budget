// Какие разделители раскрыты. При каждом запуске приложения всё свёрнуто,
// а пока приложение открыто, раскрытое остаётся раскрытым при переходах между экранами.
import { reactive, ref, watch } from 'vue';
import { localGet, localSet } from './utils.js?v=2610301632';

export const expanded = {
  accountGroups: reactive(new Set()),  // группы счетов на главной
  categorySections: reactive(new Set()), // разделы категорий в настройках
  reportGroups: reactive(new Set()),   // разделы в отчётах
};

// Упрощённый вид: только главная — доступные деньги, кэшбэки и карты. Запоминается на этом устройстве.
export const simpleView = ref(localGet('simple-view') === '1');
watch(simpleView, (v) => localSet('simple-view', v ? '1' : '0'));

// Раскрывать только один разделитель: новый сворачивает остальные. Настройка этого устройства.
export const accordion = ref(localGet('accordion', '1') === '1');
watch(accordion, (v) => localSet('accordion', v ? '1' : '0'));

export function toggleIn(set, id) {
  if (set.has(id)) return set.delete(id);
  if (accordion.value) set.clear();
  set.add(id);
}
