import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_KEY } from './config.js?v=2610301646';
import { friendlyError, ACCOUNT_FIELDS, CATEGORY_FIELDS, GROUP_FIELDS, TX_FIELDS, CASHBACK_FIELDS } from './api-common.js?v=2610301646';
import { pick } from './utils.js?v=2610301646';

const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

function unwrap({ data, error }) {
  if (error) throw friendlyError(error);
  return data;
}

async function run(promise) {
  try {
    return unwrap(await promise);
  } catch (e) {
    throw friendlyError(e);
  }
}

// Supabase отдаёт не больше 1000 строк за раз — забираем постранично.
async function fetchAll(build) {
  const size = 1000;
  const rows = [];
  for (let from = 0; ; from += size) {
    const page = await run(build().range(from, from + size - 1));
    rows.push(...page);
    if (page.length < size) return rows;
  }
}

async function save(table, fields, obj) {
  const data = pick(obj, fields);
  const query = obj.id
    ? sb.from(table).update(data).eq('id', obj.id)
    : sb.from(table).insert(data);
  return run(query.select().single());
}

const remove = (table, id) => run(sb.from(table).delete().eq('id', id));

// Серверная функция отвечает { error: "понятный текст" } — показываем его, а не технический код.
async function invokeFunction(name, body) {
  const { data, error } = await sb.functions.invoke(name, { body });
  if (!error) return data;
  let message = error.message;
  try { message = (await error.context.json()).error ?? message; } catch { /* ответа нет */ }
  // Старая версия функции умеет только скриншоты: диктовка и помощник требуют обновить её код.
  if (message === 'Не передано изображение' && !body.image) {
    message = 'Функцию recognize в Supabase нужно обновить: вставьте новый код и нажмите Deploy';
  }
  if (/failed to send a request/i.test(message)) {
    message = 'Функция распознавания не отвечает. Проверьте, что она установлена в Supabase под именем recognize';
  }
  throw friendlyError(new Error(message));
}

export default {
  async getSession() {
    const { data, error } = await sb.auth.getSession();
    // Без сети токен не обновить, но это не выход из аккаунта: сообщаем, что нет связи.
    if (error && /fetch|network|load failed/i.test(`${error.name} ${error.message}`)) throw friendlyError(error);
    return data.session;
  },

  onAuthChange(cb) {
    // Вызывать другие функции Supabase прямо внутри этого обработчика нельзя — откладываем.
    sb.auth.onAuthStateChange((_event, session) => setTimeout(() => cb(session), 0));
  },

  async signUp(email, password) {
    const data = await run(sb.auth.signUp({ email, password }));
    return { signedIn: !!data.session };
  },

  signIn: (email, password) => run(sb.auth.signInWithPassword({ email, password })),
  signOut: () => sb.auth.signOut(),

  getMe: (userId) =>
    run(sb.from('members').select('*, household:households(id, name)').eq('user_id', userId).maybeSingle()),

  // Код приглашения отдаётся только администратору.
  getInviteCode: () => run(sb.rpc('get_invite_code')),

  createHousehold: (name, displayName) =>
    run(sb.rpc('create_household', { p_name: name, p_display_name: displayName })),
  joinHousehold: (code, displayName) =>
    run(sb.rpc('join_household', { p_code: code, p_display_name: displayName })),

  listMembers: () => run(sb.from('members').select('*').order('created_at')),
  updateMember: (userId, fields) =>
    run(sb.from('members').update(pick(fields, ['display_name'])).eq('user_id', userId)),
  updateHousehold: (id, fields) =>
    run(sb.from('households').update(pick(fields, ['name'])).eq('id', id)),

  listAccounts: () => run(sb.from('accounts').select('*').order('sort').order('created_at')),
  saveAccount: (a) => save('accounts', ACCOUNT_FIELDS, a),
  deleteAccount: (id) => remove('accounts', id),
  listBalances: () => run(sb.from('account_balances').select('*')),

  listCategories: () => run(sb.from('categories').select('*').order('sort').order('created_at')),
  saveCategory: (c) => save('categories', CATEGORY_FIELDS, c),
  deleteCategory: (id) => remove('categories', id),

  listCategoryGroups: () => run(sb.from('category_groups').select('*').order('sort').order('created_at')),
  saveCategoryGroup: (g) => save('category_groups', GROUP_FIELDS, g),
  deleteCategoryGroup: (id) => remove('category_groups', id),

  listTransactions: (from, to) =>
    fetchAll(() => sb.from('transactions').select('*')
      .gte('date', from).lt('date', to)
      .order('date', { ascending: false }).order('created_at', { ascending: false }).order('id')),
  saveTransaction: (t) => save('transactions', TX_FIELDS, t),
  // Несколько новых операций одним запросом: сохраняются все или ни одной.
  insertTransactions: (list) => run(sb.from('transactions').insert(list.map((t) => pick(t, TX_FIELDS)))),
  deleteTransaction: (id) => remove('transactions', id),

  // Все движения по одному счёту: и списания с него, и переводы на него.
  listAccountTransactions: (accountId) =>
    fetchAll(() => sb.from('transactions').select('*')
      .or(`account_id.eq.${accountId},to_account_id.eq.${accountId}`)
      .order('date', { ascending: false }).order('created_at', { ascending: false }).order('id')),

  // Новый порядок записей после перетаскивания (table — 'accounts', 'categories' или 'category_groups').
  reorder: (table, ids) =>
    Promise.all(ids.map((id, i) => run(sb.from(table).update({ sort: i + 1 }).eq('id', id)))),

  monthlyTotals: (from, to) => run(sb.rpc('monthly_totals', { p_from: from, p_to: to })),

  // Кэшбэки по картам на месяц (month — первое число месяца, YYYY-MM-01).
  // Если таблицы ещё нет (не запущено обновление базы), возвращаем пустой список.
  async listCashbacks(month) {
    const { data, error } = await sb.from('cashbacks').select('*').eq('month', month).order('percent', { ascending: false });
    if (error?.code === '42P01' || error?.code === 'PGRST205') return [];
    if (error) throw friendlyError(error);
    return data;
  },
  saveCashback: (c) => save('cashbacks', CASHBACK_FIELDS, c),
  deleteCashback: (id) => remove('cashbacks', id),

  // Распознавание скриншота банка (серверная функция recognize → GigaChat).
  // Та же функция разбирает надиктованный текст ({ text }) и отвечает на вопросы помощнику ({ chat }).
  recognize: (body) => invokeFunction('recognize', body),
  ask: (body) => invokeFunction('recognize', body),
  checkRecognizer: () => invokeFunction('recognize', { check: true }),

  // Изменения, сделанные вторым человеком, приходят сразу.
  subscribe(cb) {
    const channel = sb.channel('household-changes');
    for (const table of ['transactions', 'accounts', 'category_groups', 'categories', 'members', 'households']) {
      channel.on('postgres_changes', { event: '*', schema: 'public', table }, cb);
    }
    channel.subscribe();
    // Кэшбэки — отдельным каналом: если обновление базы для них ещё не запущено,
    // это не должно ломать обновления остальных данных.
    const cashbacks = sb.channel('household-cashbacks')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cashbacks' }, cb);
    cashbacks.subscribe();
    return () => { sb.removeChannel(channel); sb.removeChannel(cashbacks); };
  },
};
