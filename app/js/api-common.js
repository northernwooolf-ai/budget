// Общее для обеих реализаций хранилища (Supabase и демо).

export const ACCOUNT_FIELDS = ['name', 'icon', 'type', 'initial_balance', 'credit_limit', 'archived', 'sort',
  'card_style', 'card_last4', 'card_image'];
export const CATEGORY_FIELDS = ['name', 'kind', 'group_id', 'icon', 'monthly_limit', 'archived', 'sort'];
export const GROUP_FIELDS = ['name', 'kind', 'monthly_limit', 'sort'];
export const CASHBACK_FIELDS = ['month', 'account_id', 'label', 'percent', 'category_ids'];
export const TX_FIELDS = ['kind', 'amount', 'account_id', 'to_account_id', 'category_id', 'date', 'note', 'spent_by'];

const MESSAGES = [
  [/invalid login credentials/i, 'Неверная почта или пароль'],
  [/user already registered/i, 'Эта почта уже зарегистрирована. Попробуйте войти'],
  [/email not confirmed/i, 'Почта не подтверждена. Откройте письмо от Supabase и нажмите ссылку'],
  [/password should be at least/i, 'Пароль должен быть не короче 6 символов'],
  [/unable to validate email|invalid email|email address .* is invalid/i, 'Похоже, в адресе почты ошибка'],
  [/signups not allowed/i, 'Регистрация новых пользователей отключена'],
  [/rate limit/i, 'Слишком много попыток. Подождите пару минут'],
  [/failed to fetch|networkerror|load failed/i, 'Нет связи с сервером. Проверьте интернет'],
];

export function friendlyError(err) {
  if (err?.code === '23503') {
    return new Error('Удалить навсегда нельзя: по этой записи есть операции. Она останется в архиве, история сохранится');
  }
  const msg = err?.message || String(err);
  for (const [re, text] of MESSAGES) if (re.test(msg)) return new Error(text);
  return new Error(msg);
}

export const DEFAULT_ACCOUNTS = [
  { name: 'Наличные', icon: '💵', type: 'cash' },
  { name: 'Карта', icon: '💳', type: 'debit' },
];

// Повторяет стартовый набор из supabase/schema.sql (create_household).
// Разделы расходов: [название раздела, [[категория, значок], …]].
export const DEFAULT_CATEGORY_GROUPS = [
  ['Еда', [['Еда домой', '🛒'], ['Еда на работе', '🥪'], ['Кафе и рестораны', '🍽️'], ['Вкусняшки', '🍫']]],
  ['Дом', [['Квартплата и ЖКХ', '🏠'], ['Связь и интернет', '📱'], ['Товары для дома', '🧴']]],
  ['Транспорт', [['Общественный транспорт', '🚌'], ['Такси', '🚕'], ['Автомобиль', '⛽']]],
  ['Здоровье и красота', [['Аптека и врачи', '💊'], ['Красота и уход', '💇']]],
  ['Семья', [['Дети', '🧸'], ['Одежда и обувь', '👕'], ['Подарки', '🎁']]],
  ['Отдых', [['Развлечения', '🎬'], ['Путешествия', '✈️'], ['Подписки', '🔁']]],
];
// Категории без раздела: [название, вид, значок].
export const DEFAULT_LOOSE_CATEGORIES = [
  ['Прочее', 'expense', '📦'],
  ['Зарплата', 'income', '💼'], ['Подработка', 'income', '🧰'], ['Проценты и кешбэк', 'income', '💰'],
  ['Подарки', 'income', '🎁'], ['Прочие доходы', 'income', '➕'],
];
