// Настройка категорий: разделы с нумерацией, перетаскивание, архив.
import { ref, reactive, computed } from 'vue';
import {
  state, isAdmin, saveCategory, deleteCategory, setArchived, reorder, moveCategory,
  saveCategoryGroup, deleteCategoryGroup,
} from '../store.js?v=2610290224';
import { money, parseAmount, amountToInput, bySort } from '../utils.js?v=2610290224';
import { expanded, toggleIn } from '../ui-state.js?v=2610290224';
import { categoryTree, groupLabel, categoryLabel } from '../categories.js?v=2610290224';
import { Icon, Modal, EmojiPicker, ConfirmButton, DragLockButton, vSortable } from '../components.js?v=2610290224';

const parseLimit = (s) => (s === '' ? null : parseAmount(s));

const GroupEditor = {
  components: { Modal },
  props: { group: Object },
  emits: ['close'],
  setup(props, { emit }) {
    const g = props.group;
    const form = reactive({
      id: g.id,
      name: g.name ?? '',
      kind: g.kind ?? 'expense',
      monthly_limit: amountToInput(g.monthly_limit),
      sort: g.sort ?? state.categoryGroups.length + 1,
    });
    const busy = ref(false);
    const error = ref('');

    async function save() {
      const limit = parseLimit(form.monthly_limit);
      if (!form.name.trim()) return (error.value = 'Введите название раздела');
      if (limit !== null && !(limit > 0)) return (error.value = 'Лимит должен быть больше нуля или пустым');
      busy.value = true;
      try {
        await saveCategoryGroup({ ...form, name: form.name.trim(), monthly_limit: form.kind === 'expense' ? limit : null });
        emit('close');
      } catch { /* показано */ } finally { busy.value = false; }
    }
    return { form, busy, error, save };
  },
  template: `
    <modal :title="form.id ? 'Раздел' : 'Новый раздел'" @close="$emit('close')">
      <form id="group-form" class="stack" @submit.prevent="save">
        <label class="field"><span>Название раздела</span>
          <input v-model="form.name" maxlength="40" required placeholder="Например, Еда"></label>
        <label v-if="form.kind==='expense'" class="field">
          <span>Общий лимит на раздел в месяц, ₽</span>
          <input v-model="form.monthly_limit" inputmode="decimal" placeholder="Без лимита">
          <small class="hint">Считаются траты по всем категориям раздела вместе</small>
        </label>
        <p class="hint">Номер раздела ставится сам по порядку. Чтобы поменять порядок, перетащите раздел за ⋮⋮.</p>
        <p v-if="error" class="form-error" role="alert">{{ error }}</p>
      </form>
      <template #footer>
        <span class="spacer"></span>
        <button type="button" class="btn ghost" @click="$emit('close')">Отмена</button>
        <button type="submit" form="group-form" class="btn primary" :disabled="busy">Сохранить</button>
      </template>
    </modal>`,
};

const CategoryEditor = {
  components: { Modal, EmojiPicker },
  props: { category: Object },
  emits: ['close'],
  setup(props, { emit }) {
    const c = props.category;
    const form = reactive({
      id: c.id,
      name: c.name ?? '',
      kind: c.kind ?? 'expense',
      group_id: c.group_id ?? null,
      icon: c.icon ?? '📦',
      monthly_limit: amountToInput(c.monthly_limit),
      archived: c.archived ?? false,
      sort: c.sort,
    });
    const busy = ref(false);
    const error = ref('');
    const groups = computed(() => state.categoryGroups.filter((g) => g.kind === form.kind).sort(bySort));
    const tree = computed(() => categoryTree(form.kind));

    async function save() {
      const limit = parseLimit(form.monthly_limit);
      if (!form.name.trim()) return (error.value = 'Введите название');
      if (limit !== null && !(limit > 0)) return (error.value = 'Лимит должен быть больше нуля или пустым');
      // Новая категория или перенесённая в другой раздел встаёт в его конец.
      const sort = form.id && form.group_id === (c.group_id ?? null) ? form.sort
        : state.categories.filter((x) => x.kind === form.kind && (x.group_id ?? null) === form.group_id).length + 1;
      busy.value = true;
      try {
        await saveCategory({
          ...form, sort, name: form.name.trim(), monthly_limit: form.kind === 'expense' ? limit : null,
        });
        emit('close');
      } catch { /* показано */ } finally { busy.value = false; }
    }

    async function toggleArchive() {
      busy.value = true;
      try {
        await setArchived('categories', c, !form.archived);
        emit('close');
      } catch { /* показано */ } finally { busy.value = false; }
    }

    return { form, groups, tree, busy, error, save, toggleArchive, groupLabel };
  },
  template: `
    <modal :title="form.id ? 'Категория' : 'Новая категория'" @close="$emit('close')">
      <form id="cat-form" class="stack" @submit.prevent="save">
        <div v-if="!form.id" class="segmented">
          <button type="button" :class="{active: form.kind==='expense'}" @click="form.kind='expense'; form.group_id=null">Расход</button>
          <button type="button" :class="{active: form.kind==='income'}" @click="form.kind='income'; form.group_id=null">Доход</button>
        </div>
        <label class="field"><span>Название</span><input v-model="form.name" maxlength="40" required placeholder="Например, Еда домой"></label>
        <label class="field">
          <span>Раздел</span>
          <select v-model="form.group_id">
            <option :value="null">Без раздела</option>
            <option v-for="g in groups" :key="g.id" :value="g.id">{{ groupLabel(tree, g) }}</option>
          </select>
        </label>
        <div><div class="field-label">Значок</div><emoji-picker v-model="form.icon"/></div>
        <label v-if="form.kind==='expense'" class="field">
          <span>Лимит в месяц, ₽</span>
          <input v-model="form.monthly_limit" inputmode="decimal" placeholder="Без лимита">
          <small class="hint">Приложение покажет, сколько осталось, и предупредит о превышении</small>
        </label>
        <p v-if="error" class="form-error" role="alert">{{ error }}</p>
      </form>
      <template #footer>
        <button v-if="form.id" type="button" class="btn ghost" :disabled="busy" @click="toggleArchive">
          {{ form.archived ? 'Вернуть из архива' : 'В архив' }}</button>
        <span class="spacer"></span>
        <button type="button" class="btn ghost" @click="$emit('close')">Отмена</button>
        <button type="submit" form="cat-form" class="btn primary" :disabled="busy">Сохранить</button>
      </template>
    </modal>`,
};

const CategoryRow = {
  components: { Icon, ConfirmButton },
  props: { category: Object, label: String, admin: Boolean },
  emits: ['open'],
  setup(props) {
    const archive = () => setArchived('categories', props.category, true).catch(() => {});
    return { archive, money };
  },
  template: `
    <div class="row s-item">
      <span v-if="admin" class="drag-handle" title="Перетащите, чтобы поменять порядок или раздел"><icon name="grip"/></span>
      <button class="row-main" :disabled="!admin" @click="$emit('open')">
        <span class="tx-icon" aria-hidden="true">{{ category.icon }}</span>
        <span class="tx-main">
          <span class="tx-title">{{ label }}</span>
          <span class="tx-sub">{{ category.monthly_limit ? 'лимит ' + money(category.monthly_limit) + ' в месяц' : '' }}</span>
        </span>
      </button>
      <confirm-button v-if="admin" label="Убрать в архив" confirm-text="В архив?" @confirm="archive"/>
    </div>`,
};

export const CategoriesSettings = {
  components: { Icon, ConfirmButton, CategoryRow, CategoryEditor, GroupEditor, DragLockButton },
  directives: { sortable: vSortable },
  setup() {
    const kind = ref('expense');
    const editingCat = ref(null);
    const editingGroup = ref(null);
    const showArchive = ref(false);
    const admin = computed(isAdmin);
    const tree = computed(() => categoryTree(kind.value));
    const archived = computed(() => state.categories.filter((c) => c.kind === kind.value && c.archived).sort(bySort));

    // Разделы при запуске свёрнуты; раскрытые помнятся, пока приложение открыто.
    const collapsed = { has: (id) => !expanded.categorySections.has(id) };
    const toggle = (id) => toggleIn(expanded.categorySections, id);

    const moveGroup = (from, to) => reorder('category_groups', tree.value.sections.map((s) => s.group), from, to);

    // Перетаскивание категории: внутри раздела — новый порядок, в другой раздел — перенос.
    function moveCat(items, from, to, toEl) {
      const cat = items[from];
      const source = tree.value.sections.find((s) => s.items.includes(cat))?.group.id ?? null;
      const target = toEl.dataset.groupId || null;
      if (source === target) return reorder('categories', items, from, to);
      const targetItems = target ? tree.value.sections.find((s) => s.group.id === target).items : tree.value.loose;
      moveCategory(cat, target, targetItems, to);
    }

    const removeGroup = (g) => deleteCategoryGroup(g.id).catch(() => {});
    const restore = (c) => setArchived('categories', c, false).catch(() => {});
    const removeForever = (c) => deleteCategory(c.id).catch(() => {});

    return {
      kind, editingCat, editingGroup, showArchive, admin, tree, archived, collapsed, toggle,
      moveGroup, moveCat, removeGroup, restore, removeForever, groupLabel, categoryLabel, money,
    };
  },
  template: `
    <div class="card pad stack">
      <div class="card-head">
        <h2>Категории</h2>
        <div v-if="admin" class="btn-row">
          <drag-lock-button/>
          <button class="btn" @click="editingGroup = { kind }"><icon name="plus"/> Раздел</button>
          <button class="btn" @click="editingCat = { kind }"><icon name="plus"/> Категория</button>
        </div>
      </div>
      <p v-if="!admin" class="hint">Категории и лимиты настраивает администратор бюджета.</p>
      <div class="segmented">
        <button :class="{active: kind==='expense'}" @click="kind='expense'">Расходы</button>
        <button :class="{active: kind==='income'}" @click="kind='income'">Доходы</button>
      </div>

      <div class="sections" v-sortable="{ onMove: moveGroup, handle: '.group-handle', disabled: !admin }">
        <div v-for="s in tree.sections" :key="s.group.id" class="section s-item">
          <div class="section-head">
            <span v-if="admin" class="drag-handle group-handle" title="Перетащите раздел вместе с категориями"><icon name="grip"/></span>
            <button class="section-toggle" :aria-expanded="!collapsed.has(s.group.id)" @click="toggle(s.group.id)">
              <icon name="down" :class="['chev', { closed: collapsed.has(s.group.id) }]" :size="18"/>
              <span class="section-text">
                <span class="section-title">{{ groupLabel(tree, s.group) }} <span class="group-count">{{ s.items.length }}</span></span>
                <span v-if="s.group.monthly_limit" class="section-limit">лимит {{ money(s.group.monthly_limit) }}</span>
              </span>
            </button>
            <template v-if="admin">
              <button class="icon-btn" title="Добавить категорию в раздел" aria-label="Добавить категорию в раздел"
                @click="editingCat = { kind, group_id: s.group.id }"><icon name="plus" :size="18"/></button>
              <button class="icon-btn" title="Изменить раздел" aria-label="Изменить раздел" @click="editingGroup = s.group"><icon name="edit" :size="18"/></button>
              <confirm-button label="Удалить раздел (категории останутся)" confirm-text="Удалить раздел?" @confirm="removeGroup(s.group)"/>
            </template>
          </div>
          <div v-show="!collapsed.has(s.group.id)" class="list bordered cat-list" :data-group-id="s.group.id"
            v-sortable="{ onMove: (f, t, toEl) => moveCat(s.items, f, t, toEl), group: 'cats', disabled: !admin }">
            <category-row v-for="c in s.items" :key="c.id" :category="c" :label="categoryLabel(tree, c)" :admin="admin" @open="editingCat = c"/>
            <p v-if="!s.items.length" class="drop-hint">Пусто. {{ admin ? 'Перетащите сюда категории' : '' }}</p>
          </div>
        </div>
      </div>

      <div class="section">
        <div class="section-head"><span class="section-title muted">Без раздела</span></div>
        <div class="list bordered cat-list" data-group-id=""
          v-sortable="{ onMove: (f, t, toEl) => moveCat(tree.loose, f, t, toEl), group: 'cats', disabled: !admin }">
          <category-row v-for="c in tree.loose" :key="c.id" :category="c" :label="c.name" :admin="admin" @open="editingCat = c"/>
          <p v-if="!tree.loose.length" class="drop-hint">Пусто</p>
        </div>
      </div>

      <template v-if="archived.length">
        <button class="group-head" :aria-expanded="showArchive" @click="showArchive = !showArchive">
          <icon name="down" :class="['chev', { closed: !showArchive }]" :size="18"/>
          <span class="group-title muted">🗄 Архив <span class="group-count">{{ archived.length }}</span></span>
        </button>
        <div v-show="showArchive" class="list bordered">
          <div v-for="c in archived" :key="c.id" class="row muted">
            <button class="row-main" :disabled="!admin" @click="editingCat = c">
              <span class="tx-icon" aria-hidden="true">{{ c.icon }}</span>
              <span class="tx-main"><span class="tx-title">{{ c.name }}</span></span>
            </button>
            <template v-if="admin">
              <button class="icon-btn" title="Вернуть из архива" aria-label="Вернуть из архива" @click="restore(c)"><icon name="undo" :size="18"/></button>
              <confirm-button label="Удалить навсегда" confirm-text="Удалить навсегда?" @confirm="removeForever(c)"/>
            </template>
          </div>
        </div>
        <p v-show="showArchive" class="hint">Категории из архива не предлагаются при вводе, но старые операции их сохраняют.</p>
      </template>

      <category-editor v-if="editingCat" :category="editingCat" @close="editingCat = null"/>
      <group-editor v-if="editingGroup" :group="editingGroup" @close="editingGroup = null"/>
    </div>`,
};
