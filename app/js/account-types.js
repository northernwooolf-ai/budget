// Группы счетов на главной, в порядке показа.
// debt: остаток таких счетов — долг (хранится со знаком минус, вводится положительным числом).
// people: счета людей — плюс значит «должен нам», минус — «мы должны».
// Внутренние коды lent/borrowed исторические: lent — «Расчёты с людьми», borrowed — «Кредиты и займы».
export const ACCOUNT_TYPES = [
  { id: 'cash', label: 'Наличные', icon: '💵' },
  { id: 'debit', label: 'Дебетовые карты', icon: '💳' },
  { id: 'credit', label: 'Кредитные карты', icon: '🏦', debt: true },
  { id: 'deposit', label: 'Вклады и накопления', icon: '🐷' },
  { id: 'investment', label: 'Инвестиции', icon: '📈' },
  { id: 'lent', label: 'Расчёты с людьми', icon: '🤝', people: true },
  { id: 'borrowed', label: 'Кредиты и займы', icon: '🧾', debt: true },
];

const byId = Object.fromEntries(ACCOUNT_TYPES.map((t) => [t.id, t]));

// Старые записи без типа считаем дебетовыми.
export const typeOf = (account) => byId[account.type] ?? byId.debit;
export const isDebt = (typeId) => !!byId[typeId]?.debt;

// Пояснение к остатку счёта человека.
export const peopleNote = (balance) => (balance > 0 ? 'должен нам' : balance < 0 ? 'мы должны' : 'в расчёте');
