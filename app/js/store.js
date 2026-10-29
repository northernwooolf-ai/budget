// Состояние приложения и действия над ним. Экраны читают state и вызывают эти функции.
import { reactive } from 'vue';
import { api, isDemo } from './api.js?v=2610291514';
import { monthStart, addMonths, isoDate } from './utils.js?v=2610291514';

export const state = reactive({
  isDemo,
  ready: false,
  session: null,
  me: null,          // запись members текущего пользователя
  household: null,
  members: [],
  accounts: [],
  categoryGroups: [],
  categories: [],
  cashbacks: [],     // кэшбэки текущего календарного месяца
  balances: {},      // account_id → остаток
  month: monthStart(new Date()),
  transactions: [],  // операции выбранного месяца
  txLoading: false,
  dataVersion: 0,    // растёт при каждом обновлении данных — чтобы отчёты пересчитывались
  offline: null,     // { savedAt } — нет интернета, показан последний сохранённый снимок
  toast: null,
});

// ---------- Снимок данных для работы без интернета ----------
// После каждой загрузки последние данные сохраняются на устройстве. Без сети приложение
// открывается с ними: можно посмотреть остатки, кэшбэки и историю, но не менять.
const SNAPSHOT_KEY = 'offline-snapshot-v1';
const SNAPSHOT_MONTHS = 6; // сколько последних просмотренных месяцев операций хранить

function readSnapshot() {
  try { return JSON.parse(localStorage.getItem(SNAPSHOT_KEY)); } catch { return null; }
}

function saveSnapshot() {
  if (isDemo || state.offline || !state.me || !state.session) return;
  try {
    const prev = readSnapshot();
    const userId = state.session.user.id;
    const months = { ...(prev?.user?.id === userId ? prev.months : {}), [isoDate(state.month)]: state.transactions };
    const keep = Object.keys(months).sort().slice(-SNAPSHOT_MONTHS);
    localStorage.setItem(SNAPSHOT_KEY, JSON.stringify({
      savedAt: Date.now(),
      user: { id: userId, email: state.session.user.email },
      me: state.me, household: state.household, members: state.members, accounts: state.accounts,
      categoryGroups: state.categoryGroups, categories: state.categories, cashbacks: state.cashbacks,
      balances: state.balances, months: Object.fromEntries(keep.map((k) => [k, months[k]])),
    }));
  } catch { /* места нет или хранилище недоступно — просто не сохраняем */ }
}

export const OFFLINE_TEXT = 'Нет интернета — изменения недоступны';
const isNetworkError = (e) => /связи с сервером|failed to fetch|networkerror|load failed/i.test(e?.message ?? '');

function goOffline(snap) {
  Object.assign(state, {
    session: { user: snap.user }, me: snap.me, household: snap.household, members: snap.members,
    accounts: snap.accounts, categoryGroups: snap.categoryGroups, categories: snap.categories,
    cashbacks: snap.cashbacks, balances: snap.balances,
    transactions: snap.months[isoDate(state.month)] ?? [],
    offline: { savedAt: snap.savedAt },
  });
  state.dataVersion++;
}

// Сеть вернулась — загрузить свежие данные и снова разрешить изменения.
async function reconnect() {
  if (!state.offline) return;
  try {
    const session = await api.getSession();
    if (!session) return;
    state.session = session;
    state.offline = null;
    await loadProfile();
    listenAuth();
    toast('Связь восстановлена, данные обновлены');
  } catch {
    const snap = readSnapshot();
    if (snap) goOffline(snap);
  }
}
if (!isDemo) window.addEventListener('online', () => setTimeout(reconnect, 1000));

let authListening = false;
function listenAuth() {
  if (authListening) return;
  authListening = true;
  api.onAuthChange((session) => {
    if (state.offline) return;
    const changed = session?.user?.id !== state.session?.user?.id;
    state.session = session;
    if (changed) loadProfile().catch((e) => toast(e.message, 'error'));
  });
}

let unsubscribe = null;
let refreshTimer = null;
let monthRequest = 0;
let toastTimer = null;

export function toast(text, type = 'ok') {
  state.toast = { text, type };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { state.toast = null; }, type === 'error' ? 5000 : 2500);
}

export async function init() {
  const snap = isDemo ? null : readSnapshot();
  try {
    if (snap && navigator.onLine === false) return goOffline(snap);
    state.session = await api.getSession();
    listenAuth();
    await loadProfile();
  } catch (e) {
    if (snap && isNetworkError(e)) goOffline(snap);
    else toast(e.message, 'error');
  } finally {
    state.ready = true;
  }
}

export async function loadProfile() {
  unsubscribe?.();
  unsubscribe = null;
  if (!state.session) {
    Object.assign(state, {
      me: null, household: null, members: [], accounts: [], categoryGroups: [], categories: [], cashbacks: [],
      transactions: [], balances: {},
    });
    return;
  }
  const me = await api.getMe(state.session.user.id);
  state.me = me;
  state.household = me?.household ?? null;
  if (!me) return;
  await loadAll();
  unsubscribe = api.subscribe(scheduleRefresh);
}

function scheduleRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => loadAll().catch(() => {}), 400);
}

export async function loadAll() {
  const [me, members, accounts, categoryGroups, categories, cashbacks] = await Promise.all([
    api.getMe(state.session.user.id),
    api.listMembers(), api.listAccounts(), api.listCategoryGroups(), api.listCategories(),
    api.listCashbacks(currentMonthIso()), loadBalances(), loadMonth(),
  ]);
  if (!me) return loadProfile(); // нас удалили из семьи — вернуться на экран выбора
  Object.assign(state, { me, household: me.household, members, accounts, categoryGroups, categories, cashbacks });
  saveSnapshot();
}

export const currentMonthIso = () => isoDate(monthStart(new Date()));

// Кэшбэки месяца целиком: rows — что должно остаться, removedIds — что удалить.
export const saveCashbackMonth = (rows, removedIds) => act(async () => {
  // Удалённые и сохранённые сразу отмечаются, чтобы повторное нажатие после сбоя ничего не задвоило.
  while (removedIds.length) {
    await api.deleteCashback(removedIds[0]);
    removedIds.shift();
  }
  for (const row of rows) row.id = (await api.saveCashback(row)).id;
}, 'Кэшбэки сохранены');

// Администратор меняет счета, категории и любые операции; участник — только свои траты.
export const isAdmin = () => state.me?.role === 'admin';
// Участник правит запись, только если внёс её сам и она по-прежнему его (её) трата.
export const canEditTx = (t) => isAdmin() || !t?.id
  || (t.created_by === state.me?.user_id && (t.spent_by ?? t.created_by) === state.me?.user_id);

async function loadBalances() {
  const rows = await api.listBalances();
  state.balances = Object.fromEntries(rows.map((r) => [r.account_id, Number(r.balance)]));
}

export async function loadMonth() {
  const req = ++monthRequest;
  if (state.offline) {
    // Без интернета — операции месяца из снимка, если этот месяц уже открывали.
    state.transactions = readSnapshot()?.months?.[isoDate(state.month)] ?? [];
    state.dataVersion++;
    return;
  }
  state.txLoading = true;
  try {
    const rows = await api.listTransactions(isoDate(state.month), isoDate(addMonths(state.month, 1)));
    if (req !== monthRequest) return; // пока грузили, пользователь переключил месяц
    state.transactions = rows;
    state.dataVersion++;
    saveSnapshot();
  } finally {
    if (req === monthRequest) state.txLoading = false;
  }
}

export function shiftMonth(n) {
  state.month = addMonths(state.month, n);
  loadMonth().catch((e) => toast(e.message, 'error'));
}

// Обёртка для действий: показывает ошибку и обновляет данные после успеха.
async function act(fn, okText) {
  if (state.offline) {
    toast(OFFLINE_TEXT, 'error');
    throw new Error(OFFLINE_TEXT);
  }
  try {
    const result = await fn();
    await loadAll();
    if (okText) toast(okText);
    return result;
  } catch (e) {
    toast(e.message, 'error');
    throw e;
  }
}

export const saveTransaction = (t) => act(() => api.saveTransaction(t), t.id ? 'Изменения сохранены' : 'Операция добавлена');
// Несколько операций разом (из распознанного скриншота) одним запросом:
// при ошибке не сохраняется ни одна, и повторное нажатие не создаст дублей.
export const importTransactions = (list) =>
  act(() => api.insertTransactions(list), `Добавлено операций: ${list.length}`);

export const deleteTransaction = (id) => act(() => api.deleteTransaction(id), 'Операция удалена');
export const saveAccount = (a) => act(() => api.saveAccount(a), 'Счёт сохранён');

// Стартовые остатки сразу для нескольких счетов: [{ account, initial_balance }].
export const saveStartBalances = (changes) => act(async () => {
  for (const { account, initial_balance } of changes) await api.saveAccount({ ...account, initial_balance });
}, 'Стартовые остатки сохранены');
export const deleteAccount = (id) => act(() => api.deleteAccount(id), 'Счёт удалён');
export const saveCategory = (c) => act(() => api.saveCategory(c), 'Категория сохранена');
export const deleteCategory = (id) => act(() => api.deleteCategory(id), 'Категория удалена');
export const saveCategoryGroup = (g) => act(() => api.saveCategoryGroup(g), 'Раздел сохранён');
export const deleteCategoryGroup = (id) =>
  act(() => api.deleteCategoryGroup(id), 'Раздел удалён, его категории перенесены в «Без раздела»');

// Перенос категории в другой раздел (groupId = null — «без раздела») на место index.
export async function moveCategory(category, groupId, targetItems, index) {
  if (state.offline) return toast(OFFLINE_TEXT, 'error');
  const list = targetItems.filter((c) => c.id !== category.id);
  list.splice(index, 0, category);
  category.group_id = groupId;
  list.forEach((c, i) => { c.sort = i + 1; });
  try {
    await api.saveCategory({ ...category });
    await api.reorder('categories', list.map((c) => c.id));
  } catch (e) {
    toast(e.message, 'error');
  }
  await loadAll().catch(() => {});
}

// Архив: запись пропадает из списков и выбора, но её история остаётся.
export function setArchived(table, item, archived) {
  const save = table === 'accounts' ? api.saveAccount : api.saveCategory;
  return act(() => save({ ...item, archived }), archived ? `«${item.name}» в архиве` : `«${item.name}» возвращён из архива`);
}

// Перетаскивание: items — записи одной группы в текущем порядке.
export async function reorder(table, items, from, to) {
  if (state.offline) return toast(OFFLINE_TEXT, 'error');
  const list = items.slice();
  const [moved] = list.splice(from, 1);
  list.splice(to, 0, moved);
  list.forEach((row, i) => { row.sort = i + 1; }); // сразу показать новый порядок
  try {
    await api.reorder(table, list.map((row) => row.id));
  } catch (e) {
    toast(e.message, 'error');
    await loadAll().catch(() => {});
  }
}

export const updateMyName = (name) =>
  act(() => api.updateMember(state.me.user_id, { display_name: name }), 'Имя сохранено');

export const updateHouseholdName = (name) =>
  act(() => api.updateHousehold(state.household.id, { name }), 'Название сохранено');

export async function setupHousehold(mode, { name, code, displayName }) {
  if (mode === 'create') await api.createHousehold(name, displayName);
  else await api.joinHousehold(code, displayName);
  await loadProfile();
}

// При выходе снимок данных стирается: на устройстве не остаётся чужих денег.
export async function signOut() {
  try { localStorage.removeItem(SNAPSHOT_KEY); } catch { /* хранилище недоступно */ }
  if (state.offline) {
    state.offline = null;
    state.session = null;
    await api.signOut().catch(() => {});
    return loadProfile();
  }
  return api.signOut();
}
