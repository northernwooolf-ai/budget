// Дерево категорий: разделы («1 — Еда») с категориями («1.1. Еда домой»)
// и категории без раздела. Номера ставятся по порядку и пересчитываются сами.
import { state } from './store.js?v=2610301642';
import { bySort } from './utils.js?v=2610301642';

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

// Лимиты разделов и категорий с долей потраченного, сначала самые «горящие».
export function limitStatus(transactions) {
  const { byCategory, byGroup } = spendingMaps(transactions);
  const tree = categoryTree('expense');
  const row = (item, spent, label, isGroup) => {
    const limit = Number(item.monthly_limit), ratio = spent / limit;
    return {
      id: item.id, icon: isGroup ? '📂' : item.icon, label, isGroup, spent, limit, ratio, left: limit - spent,
      level: ratio > 1 ? 'over' : ratio >= 0.8 ? 'warn' : 'ok',
    };
  };
  const groups = tree.sections.filter((s) => s.group.monthly_limit)
    .map((s) => row(s.group, byGroup.get(s.group.id) ?? 0, groupLabel(tree, s.group), true));
  const cats = state.categories.filter((c) => c.kind === 'expense' && !c.archived && c.monthly_limit)
    .map((c) => row(c, byCategory.get(c.id) ?? 0, categoryLabel(tree, c), false));
  return [...groups, ...cats].sort((a, b) => b.ratio - a.ratio);
}
