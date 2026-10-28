// Демо-режим: всё хранится в этом браузере. Нужен, чтобы посмотреть приложение
// без подключения к базе. Повторяет поведение api-supabase.js.
import {
  friendlyError, ACCOUNT_FIELDS, CATEGORY_FIELDS, GROUP_FIELDS, TX_FIELDS, CASHBACK_FIELDS,
  DEFAULT_ACCOUNTS, DEFAULT_CATEGORY_GROUPS, DEFAULT_LOOSE_CATEGORIES,
} from './api-common.js?v=2610290240';
import { pick, isoDate, localGet, localSet } from './utils.js?v=2610290240';

const KEY = 'budget-demo-db-v3';
const PARTNER_ID = 'demo-partner';
const empty = () => ({
  session: null, users: [], households: [], members: [], accounts: [],
  category_groups: [], categories: [], transactions: [], cashbacks: [],
});

let db;
try { db = JSON.parse(localGet(KEY)) || empty(); } catch { db = empty(); }

const listeners = new Set();
const authListeners = new Set();
const persist = () => localSet(KEY, JSON.stringify(db));
const notify = () => { persist(); listeners.forEach((cb) => cb()); };
const uid = () => crypto.randomUUID();
const now = () => new Date().toISOString();
const me = () => db.session?.user.id;
const myHousehold = () => db.members.find((m) => m.user_id === me())?.household_id;
const mine = (rows) => rows.filter((r) => r.household_id === myHousehold());
const delay = () => new Promise((r) => setTimeout(r, 80));
const byDateDesc = (a, b) => b.date.localeCompare(a.date) || b.created_at.localeCompare(a.created_at);

// Изменения из другой вкладки — как «вторая половина» в настоящем приложении.
window.addEventListener('storage', (e) => {
  if (e.key !== KEY) return;
  try { db = JSON.parse(e.newValue) || empty(); } catch { return; }
  listeners.forEach((cb) => cb());
});

function setSession(session) {
  db.session = session;
  persist();
  authListeners.forEach((cb) => setTimeout(() => cb(session), 0));
}

// Те же права, что в базе: счета и категории меняет только администратор,
// участник — только свои траты и только записи, внесённые им самим.
const isAdmin = () => db.members.find((m) => m.user_id === me())?.role === 'admin';
const DENIED = 'Это может изменить только администратор бюджета';
function requireAdmin() { if (!isAdmin()) throw new Error(DENIED); }
function checkTx(obj) {
  if (isAdmin()) return;
  const existing = obj.id && db.transactions.find((t) => t.id === obj.id);
  const ownedByMe = (t) => t.created_by === me() && (t.spent_by ?? t.created_by) === me();
  if ((existing && !ownedByMe(existing)) || (obj.spent_by && obj.spent_by !== me())) throw new Error(DENIED);
}

function upsert(table, fields, obj) {
  // Копия через JSON: из интерфейса могут прийти «живые» объекты Vue, их нельзя хранить как есть.
  const data = JSON.parse(JSON.stringify(pick(obj, fields)));
  let row;
  if (obj.id) {
    row = mine(db[table]).find((r) => r.id === obj.id);
    if (!row) throw new Error('Запись не найдена');
    Object.assign(row, data, { updated_at: now() });
  } else {
    row = { id: uid(), household_id: myHousehold(), created_at: now(), updated_at: now(), ...data };
    if (table === 'transactions') {
      row.created_by = me();
      row.spent_by = data.spent_by ?? me();
    }
    db[table].push(row);
  }
  notify();
  return structuredClone(row);
}

// Примеры за полгода: несколько видов счетов, переводы, закрытый счёт в архиве.
function seedSample(hh) {
  const accounts = db.accounts.filter((a) => a.household_id === hh);
  const cash = accounts.find((a) => a.type === 'cash');
  const card = accounts.find((a) => a.type === 'debit');
  Object.assign(cash, { initial_balance: 25000 });
  Object.assign(card, { name: 'Тинькофф Black', initial_balance: 60000 });
  const account = (a) => {
    const row = { id: uid(), household_id: hh, archived: false, credit_limit: null, sort: 2, created_at: now(), ...a };
    db.accounts.push(row);
    return row;
  };
  const sber = account({ name: 'Сбербанк', icon: '💳', type: 'debit', initial_balance: 20000, archived: true });
  const credit = account({ name: 'Альфа кредитка', icon: '🏦', type: 'credit', initial_balance: -18000, credit_limit: 150000 });
  const savings = account({ name: 'Накопительный счёт', icon: '🐷', type: 'deposit', initial_balance: 250000 });
  const broker = account({ name: 'Брокерский счёт', icon: '📈', type: 'investment', initial_balance: 180000 });
  account({ name: 'Брат Андрей', icon: '🤝', type: 'lent', initial_balance: 30000 });
  const mortgage = account({ name: 'Ипотека', icon: '🏠', type: 'borrowed', initial_balance: -3200000 });

  const cat = (name, kind = 'expense') =>
    db.categories.find((c) => c.household_id === hh && c.name === name && c.kind === kind);
  db.category_groups.find((g) => g.household_id === hh && g.name === 'Еда').monthly_limit = 35000;
  cat('Кафе и рестораны').monthly_limit = 2500;
  cat('Одежда и обувь').monthly_limit = 3500;

  // Траты супруги внесены по-разному: часть она сама, часть — вы вечером за неё.
  let partnerTurn = 0;
  const tx = (date, kind, amount, acc, extra) => db.transactions.push({
    id: uid(), household_id: hh, kind, amount, account_id: acc.id, to_account_id: null, category_id: null,
    note: null, spent_by: me(), created_by: me(), created_at: now(), updated_at: now(), date, ...extra,
  });
  const authors = (by) => ({ spent_by: by, created_by: by === PARTNER_ID && partnerTurn++ % 2 ? me() : by });
  const spend = (date, amount, acc, category, note, by = me()) =>
    tx(date, 'expense', amount, acc, { category_id: cat(category).id, note, ...authors(by) });
  const earn = (date, amount, acc, category, note, by = me()) =>
    tx(date, 'income', amount, acc, { category_id: cat(category, 'income').id, note, ...authors(by) });
  const move = (date, amount, from, to, note) => tx(date, 'transfer', amount, from, { to_account_id: to.id, note });

  const base = new Date();
  const day = (monthsBack, d) => isoDate(new Date(base.getFullYear(), base.getMonth() - monthsBack, d));
  for (let m = 5; m >= 0; m--) {
    const at = (d) => day(m, m === 0 ? Math.min(d, base.getDate()) : d);
    const salaryCard = m >= 4 ? sber : card; // до закрытия Сбербанка зарплата приходила туда
    earn(at(5), 95000 + m * 1000, salaryCard, 'Зарплата', 'Аванс + зарплата');
    earn(at(10), 62000, card, 'Зарплата', null, PARTNER_ID);
    spend(at(2), 6400 + m * 150, card, 'Квартплата и ЖКХ', 'Квартплата');
    move(at(6), 48000, card, mortgage, 'Платёж по ипотеке');
    move(at(11), 15000, card, savings, 'Откладываем');
    move(at(4), 5000, card, cash, 'Сняли наличные');
    spend(at(3), 2350, cash, 'Еда домой', 'Рынок', PARTNER_ID);
    spend(at(7), 4870, salaryCard, 'Еда домой', 'Пятёрочка');
    spend(at(12), 3120, credit, 'Еда домой', null, PARTNER_ID);
    spend(at(16), 9800 - m * 300, card, 'Еда домой', 'Закупка на неделю', PARTNER_ID);
    spend(at(8), 3400, card, 'Еда на работе', 'Обеды за неделю');
    spend(at(13), 640, cash, 'Вкусняшки', 'Мороженое', PARTNER_ID);
    spend(at(9), 1800, credit, 'Кафе и рестораны', 'Пицца');
    spend(at(14), 2500, credit, 'Автомобиль', 'Бензин');
    spend(at(17), 450, card, 'Такси', null, PARTNER_ID);
    spend(at(15), 650, card, 'Связь и интернет', null, PARTNER_ID);
    spend(at(18), 3990 - m * 200, credit, 'Одежда и обувь', null, PARTNER_ID);
    spend(at(20), 1200, cash, 'Аптека и врачи', 'Аптека', PARTNER_ID);
    spend(at(22), 990, card, 'Подписки', 'Кино-сервис');
    move(at(25), 12000, card, credit, 'Погашение кредитки');
  }
  move(day(4, 1), 10000, card, broker, 'Купили облигации');
  // Закрыли Сбербанк: перевели остаток и убрали счёт в архив.
  const sberBalance = balanceOf(sber, db.transactions);
  move(day(3, 1), sberBalance, sber, card, 'Закрыли счёт, перевели остаток');

  db.members.push({ user_id: PARTNER_ID, household_id: hh, display_name: 'Супруга', role: 'member', created_at: now() });

  // Кэшбэки на текущий месяц.
  const month = isoDate(new Date(base.getFullYear(), base.getMonth(), 1));
  const cb = (account, label, percent, categories) => (db.cashbacks ??= []).push({
    id: uid(), household_id: hh, month, account_id: account.id, label, percent,
    category_ids: categories.map((n) => cat(n).id), created_at: now(),
  });
  cb(card, 'Супермаркеты', 5, ['Еда домой']);
  cb(card, 'АЗС', 3, ['Автомобиль']);
  cb(credit, 'Рестораны', 7, ['Кафе и рестораны']);
  cb(credit, 'Все покупки', 1.5, []);
}

function balanceOf(account, txs) {
  return txs.reduce((sum, t) => {
    if (t.account_id === account.id) sum += t.kind === 'income' ? t.amount : -t.amount;
    if (t.to_account_id === account.id && t.kind === 'transfer') sum += t.amount;
    return sum;
  }, Number(account.initial_balance));
}

function makeHousehold(name, displayName) {
  const hh = uid();
  db.households.push({
    id: hh, name: name?.trim() || 'Наша семья',
    invite_code: Math.random().toString(36).slice(2, 10).toUpperCase(), created_at: now(),
  });
  db.members.push({ user_id: me(), household_id: hh, display_name: displayName?.trim() || 'Я', role: 'admin', created_at: now() });
  DEFAULT_ACCOUNTS.forEach((a) => db.accounts.push({
    id: uid(), household_id: hh, initial_balance: 0, credit_limit: null, archived: false, sort: 1, created_at: now(), ...a,
  }));
  const category = (name, kind, icon, group_id, sort) => db.categories.push({
    id: uid(), household_id: hh, group_id, name, kind, icon, monthly_limit: null,
    archived: false, sort, created_at: now(),
  });
  DEFAULT_CATEGORY_GROUPS.forEach(([name, items], i) => {
    const group = { id: uid(), household_id: hh, name, kind: 'expense', monthly_limit: null, sort: i + 1, created_at: now() };
    db.category_groups.push(group);
    items.forEach(([n, icon], j) => category(n, 'expense', icon, group.id, j + 1));
  });
  DEFAULT_LOOSE_CATEGORIES.forEach(([n, kind, icon], i) => category(n, kind, icon, null, i + 1));
  return hh;
}

const bySort = (a, b) => a.sort - b.sort || a.created_at.localeCompare(b.created_at);

export default {
  async getSession() { return db.session; },
  onAuthChange(cb) { authListeners.add(cb); },

  async signUp(email, password) {
    await delay();
    if (!/^\S+@\S+\.\S+$/.test(email)) throw friendlyError('invalid email');
    if (password.length < 6) throw friendlyError('Password should be at least 6 characters');
    if (db.users.some((u) => u.email === email)) throw friendlyError('User already registered');
    const user = { id: uid(), email, password };
    db.users.push(user);
    setSession({ user: { id: user.id, email } });
    return { signedIn: true };
  },

  async signIn(email, password) {
    await delay();
    const user = db.users.find((u) => u.email === email && u.password === password);
    if (!user) throw friendlyError('Invalid login credentials');
    setSession({ user: { id: user.id, email } });
  },

  async signOut() { setSession(null); },

  async getMe(userId) {
    const m = db.members.find((x) => x.user_id === userId);
    if (!m) return null;
    const { id, name } = db.households.find((h) => h.id === m.household_id);
    return structuredClone({ ...m, household: { id, name } });
  },

  async getInviteCode() {
    return isAdmin() ? db.households.find((h) => h.id === myHousehold()).invite_code : null;
  },

  async createHousehold(name, displayName) {
    await delay();
    if (myHousehold()) throw new Error('Вы уже состоите в семье');
    const hh = makeHousehold(name, displayName);
    seedSample(hh);
    notify();
    return hh;
  },

  async joinHousehold(code, displayName) {
    await delay();
    if (myHousehold()) throw new Error('Вы уже состоите в семье');
    const h = db.households.find((x) => x.invite_code === code.trim().toUpperCase());
    if (!h) throw new Error('Код не найден. Проверьте, что он введён без ошибок');
    db.members.push({ user_id: me(), household_id: h.id, display_name: displayName?.trim() || 'Я', role: 'member', created_at: now() });
    notify();
    return h.id;
  },

  async listMembers() { return structuredClone(mine(db.members)); },
  async updateMember(userId, fields) {
    Object.assign(db.members.find((m) => m.user_id === userId), pick(fields, ['display_name']));
    notify();
  },
  async updateHousehold(id, fields) {
    requireAdmin();
    Object.assign(db.households.find((h) => h.id === id), pick(fields, ['name']));
    notify();
  },

  // Только в демо: переключиться между собой и «Супругой», чтобы увидеть её права.
  demoSwitchUser() {
    if (me() === PARTNER_ID) {
      const owner = db.users.find((u) => u.id === db.demoOwner);
      setSession(owner ? { user: { id: owner.id, email: owner.email } } : null);
    } else {
      db.demoOwner = me();
      setSession({ user: { id: PARTNER_ID, email: 'supruga@demo' } });
    }
  },

  async listAccounts() { return structuredClone(mine(db.accounts).sort(bySort)); },
  async saveAccount(a) { await delay(); requireAdmin(); return upsert('accounts', ACCOUNT_FIELDS, a); },
  async deleteAccount(id) {
    requireAdmin();
    if (db.transactions.some((t) => t.account_id === id || t.to_account_id === id)) {
      throw friendlyError({ code: '23503' });
    }
    db.accounts = db.accounts.filter((a) => a.id !== id);
    notify();
  },
  async listBalances() {
    const txs = mine(db.transactions);
    return mine(db.accounts).map((a) => ({ account_id: a.id, balance: balanceOf(a, txs) }));
  },

  async listCategories() { return structuredClone(mine(db.categories).sort(bySort)); },
  async saveCategory(c) { await delay(); requireAdmin(); return upsert('categories', CATEGORY_FIELDS, c); },
  async deleteCategory(id) {
    requireAdmin();
    if (db.transactions.some((t) => t.category_id === id)) throw friendlyError({ code: '23503' });
    db.categories = db.categories.filter((c) => c.id !== id);
    notify();
  },

  async listCategoryGroups() { return structuredClone(mine(db.category_groups).sort(bySort)); },
  async saveCategoryGroup(g) { await delay(); requireAdmin(); return upsert('category_groups', GROUP_FIELDS, g); },
  async deleteCategoryGroup(id) {
    requireAdmin();
    db.category_groups = db.category_groups.filter((g) => g.id !== id);
    db.categories.forEach((c) => { if (c.group_id === id) c.group_id = null; });
    notify();
  },

  async reorder(table, ids) {
    requireAdmin();
    ids.forEach((id, i) => {
      const row = mine(db[table]).find((r) => r.id === id);
      if (row) row.sort = i + 1;
    });
    notify();
  },

  async listTransactions(from, to) {
    await delay();
    return structuredClone(mine(db.transactions).filter((t) => t.date >= from && t.date < to).sort(byDateDesc));
  },
  async listAccountTransactions(accountId) {
    await delay();
    return structuredClone(mine(db.transactions)
      .filter((t) => t.account_id === accountId || t.to_account_id === accountId).sort(byDateDesc));
  },
  async saveTransaction(t) { await delay(); checkTx(t); return upsert('transactions', TX_FIELDS, t); },
  async insertTransactions(list) {
    await delay();
    list.forEach(checkTx); // сначала проверить все — сохраняются все или ни одной
    list.forEach((t) => upsert('transactions', TX_FIELDS, t));
  },
  async deleteTransaction(id) {
    checkTx({ id });
    db.transactions = db.transactions.filter((t) => t.id !== id);
    notify();
  },

  async monthlyTotals(from, to) {
    const map = new Map();
    for (const t of mine(db.transactions)) {
      if (t.date < from || t.date >= to || t.kind === 'transfer') continue;
      const m = t.date.slice(0, 8) + '01';
      const row = map.get(m) || { month: m, income: 0, expense: 0 };
      row[t.kind] += Number(t.amount);
      map.set(m, row);
    }
    return [...map.values()].sort((a, b) => a.month.localeCompare(b.month));
  },

  async listCashbacks(month) {
    return structuredClone(mine(db.cashbacks ??= []).filter((c) => c.month === month)
      .sort((a, b) => b.percent - a.percent));
  },
  async saveCashback(c) { await delay(); db.cashbacks ??= []; return upsert('cashbacks', CASHBACK_FIELDS, c); },
  async deleteCashback(id) {
    db.cashbacks = (db.cashbacks ?? []).filter((c) => c.id !== id);
    notify();
  },

  // В демо настоящего распознавания нет — возвращаем правдоподобный пример.
  async checkRecognizer() {
    await delay();
    return { ok: true, model: 'демо', models: ['демо-режим: GigaChat не подключён'] };
  },
  async recognize(body) {
    await new Promise((r) => setTimeout(r, 1200));
    const today = body.today, cat = (name) => body.categories.find((c) => c.name === name)?.id ?? null;
    return {
      bank: 'Т-Банк',
      operations: [
        { date: today, time: '19:42', amount: 1874.5, direction: 'expense', description: 'Пятёрочка', category_id: cat('Еда домой') },
        { date: today, time: '13:05', amount: 420, direction: 'expense', description: 'Столовая Вкусно', category_id: cat('Еда на работе') },
        { date: today, time: '09:10', amount: 189, direction: 'expense', description: 'Яндекс Такси', category_id: cat('Такси') },
        { date: today, time: '08:00', amount: 5000, direction: 'income', description: 'Перевод от Андрея', category_id: null },
      ],
    };
  },

  subscribe(cb) {
    listeners.add(cb);
    return () => listeners.delete(cb);
  },
};
