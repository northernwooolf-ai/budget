// Группы счетов на главной, в порядке показа.
// Остаток у всех счетов вводится и хранится одинаково: плюс — деньги, минус — долг.
// people: счета людей — плюс значит «должен нам», минус — «мы должны».
// Внутренние коды lent/borrowed исторические: lent — «Расчёты с людьми», borrowed — «Кредиты и займы».
export const ACCOUNT_TYPES = [
  { id: 'cash', label: 'Наличные', icon: '💵' },
  { id: 'debit', label: 'Дебетовые карты', icon: '💳' },
  { id: 'credit', label: 'Кредитные карты', icon: '🏦' },
  { id: 'deposit', label: 'Вклады и накопления', icon: '🐷' },
  { id: 'investment', label: 'Инвестиции', icon: '📈' },
  { id: 'lent', label: 'Расчёты с людьми', icon: '🤝', people: true },
  { id: 'borrowed', label: 'Кредиты и займы', icon: '🧾' },
];

const byId = Object.fromEntries(ACCOUNT_TYPES.map((t) => [t.id, t]));

// Старые записи без типа считаем дебетовыми.
export const typeOf = (account) => byId[account.type] ?? byId.debit;

// Вклады и инвестиции можно отметить ликвидными: деньги с них снимаются в любой день без потерь.
export const canBeLiquid = (typeId) => typeId === 'deposit' || typeId === 'investment';

// Кредитка. Минус на счёте — это долг. Плюс при заданном лимите — сколько ещё можно снять,
// как показывает банк: лимит 500 000, на карте 300 000 — значит, долг 200 000.
export function creditState(account, balance) {
  const limit = Number(account.credit_limit) || 0;
  if (balance > 0 && limit) return { limit, available: balance, debt: Math.max(limit - balance, 0) };
  return { limit, available: limit + Math.min(balance, 0), debt: Math.max(-balance, 0) };
}

// Пояснение к остатку счёта человека.
export const peopleNote = (balance) => (balance > 0 ? 'должен нам' : balance < 0 ? 'мы должны' : 'в расчёте');
