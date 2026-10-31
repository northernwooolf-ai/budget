// Дерево категорий: разделы («1 — Еда») с категориями («1.1. Еда домой»)
// и категории без раздела. Номера ставятся по порядку и пересчитываются сами.
import { state } from './store.js?v=2610312014';
import { bySort, isoDate, addMonths, today } from './utils.js?v=2610312014';

export function categoryTree(kind) {
  const groups = state.categoryGroups.filter((g) => g.kind === kind).sort(bySort);
  const active = state.categories.filter((c) => c.kind === kind && !c.archived).sort(bySort);
  const nums = {};
  const sections = groups.map((group, i) => {
    const items = active.filter((c) => c.group_id === group.id);
    nums[group.id] = String(i + 1);
    items.forEach((c, j) => { nums[c.id] = `${i + 1}.${j + 1}`; });
    return { group, items };
  });
  const groupIds = new Set(groups.map((g) => g.id));
  const loose = active.filter((c) => !groupIds.has(c.group_id));
  return { sections, loose, nums };
}

export const groupLabel = (tree, g) => `${tree.nums[g.id]} — ${g.name}`;
export const categoryLabel = (tree, c) => (tree.nums[c.id] ? `${tree.nums[c.id]}. ${c.name}` : c.name);

// Траты (или доходы) за месяц по категориям и по разделам (архивные категории тоже считаются).
export function spendingMaps(transactions, kind = 'expense') {
  const byCategory = new Map();
  for (const t of transactions) {
    if (t.kind === kind) byCategory.set(t.category_id, (byCategory.get(t.category_id) ?? 0) + Number(t.amount));
  }
  const byGroup = new Map();
  for (const c of state.categories) {
    if (c.group_id && byCategory.has(c.id)) byGroup.set(c.group_id, (byGroup.get(c.group_id) ?? 0) + byCategory.get(c.id));
  }
  return { byCategory, byGroup };
}

const levelOf = (ratio) => (ratio > 1 ? 'over' : ratio >= 0.8 ? 'warn' : 'ok');

// Лимиты в порядке категорий: разделы со своими категориями и категории без раздела.
// Лимит раздела считается за выбранный месяц. Лимит категории со сроком — за свой срок,
// без срока — тоже за месяц. Лимит, срок которого начнётся позже выбранного месяца, не показывается.
export function limitTree(transactions = state.transactions, periodTx = state.limitTx) {
  const { byCategory, byGroup } = spendingMaps(transactions);
  const tree = categoryTree('expense');
  const monthEnd = isoDate(addMonths(state.month, 1)), now = today();
  const make = (item, spent, label, isGroup) => {
    const limit = Number(item.monthly_limit), ratio = spent / limit;
    return {
      id: item.id, icon: isGroup ? '📂' : item.icon, label, isGroup, spent, limit, ratio, left: limit - spent,
      level: levelOf(ratio), until: isGroup ? null : item.limit_until ?? null, expired: !isGroup && !!item.limit_until && item.limit_until < now,
    };
  };
  const catRow = (c) => {
    if (!c.monthly_limit || (c.limit_from && c.limit_from >= monthEnd)) return null;
    const spent = c.limit_until
      ? periodTx.filter((t) => t.category_id === c.id && t.date >= c.limit_from && t.date <= c.limit_until).reduce((s, t) => s + Number(t.amount), 0)
      : byCategory.get(c.id) ?? 0;
    return make(c, spent, categoryLabel(tree, c), false);
  };
  const sections = tree.sections.map((s) => {
    const items = s.items.map(catRow).filter(Boolean);
    const own = s.group.monthly_limit ? make(s.group, byGroup.get(s.group.id) ?? 0, groupLabel(tree, s.group), true) : null;
    if (!own && !items.length) return null;
    // У раздела без своего лимита в заголовке — сумма по его категориям.
    const spent = own ? own.spent : items.reduce((a, r) => a + r.spent, 0);
    const limit = own ? own.limit : items.reduce((a, r) => a + r.limit, 0);
    return { id: s.group.id, label: groupLabel(tree, s.group), own, items, spent, limit, ratio: spent / limit, left: limit - spent, level: own ? own.level : levelOf(spent / limit) };
  }).filter(Boolean);
  return { sections, loose: tree.loose.map(catRow).filter(Boolean) };
}

// Те же лимиты одним списком, сначала самые «горящие».
export function limitStatus(transactions) {
  const { sections, loose } = limitTree(transactions);
  return [...sections.flatMap((s) => (s.own ? [s.own, ...s.items] : s.items)), ...loose].sort((a, b) => b.ratio - a.ratio);
}
