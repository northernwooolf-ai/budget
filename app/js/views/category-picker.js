// <category-picker v-model="id" :kind="'expense'"/> — выбор категории: поиск по буквам и разделы.
// После выбора список сворачивается, чтобы до следующих полей не приходилось листать.
import { ref, reactive, computed, watch } from 'vue';
import { state } from '../store.js?v=2610301605';
import { localGet, localSet, searchByName } from '../utils.js?v=2610301605';
import { categoryTree, groupLabel } from '../categories.js?v=2610301605';
import { toggleIn } from '../ui-state.js?v=2610301605';
import { Icon } from '../components.js?v=2610301605';

const lastGroupKey = (kind) => `last-cat-group-${kind}`;

export const CategoryPicker = {
  components: { Icon },
  props: { modelValue: String, kind: String },
  emits: ['update:modelValue'],
  setup(props, { emit }) {
    const tree = computed(() => categoryTree(props.kind));
    const selected = computed(() => state.categories.find((c) => c.id === props.modelValue));
    const browsing = ref(false); // нажали «Другая»: выбранная категория есть, но показать весь список

    // Раскрыт раздел выбранной категории или последний использованный.
    const open = reactive(new Set());
    function openDefault() {
      open.clear();
      const g = selected.value?.group_id ?? localGet(lastGroupKey(props.kind));
      if (g) open.add(g);
    }
    openDefault();
    const toggleOpen = (id) => toggleIn(open, id);
    const browse = () => { browsing.value = true; openDefault(); };

    const query = ref('');
    const found = computed(() => (query.value.trim()
      ? searchByName([...tree.value.sections.flatMap((s) => s.items), ...tree.value.loose], query.value) : []));

    function pick(c) {
      emit('update:modelValue', c.id);
      if (c.group_id) localSet(lastGroupKey(props.kind), c.group_id);
      browsing.value = false;
      document.activeElement?.blur?.(); // убрать клавиатуру: дальше нужны поля ниже
    }
    const pickFirstFound = () => { if (found.value.length) pick(found.value[0]); };

    watch(() => props.kind, () => { query.value = ''; browsing.value = false; openDefault(); });

    return { tree, selected, browsing, open, toggleOpen, browse, query, found, pick, pickFirstFound, groupLabel };
  },
  template: `
    <div class="picker">
      <label class="cat-search">
        <icon name="search" :size="18"/>
        <!-- Не v-model: клавиатура телефона набирает слово «черновиком», и v-model ждёт его окончания. -->
        <input :value="query" @input="query = $event.target.value" type="search" placeholder="Поиск категории" aria-label="Поиск категории"
          autocomplete="off" enterkeyhint="done" @keydown.enter.prevent="pickFirstFound">
      </label>
      <!-- Пока в поиске есть текст, видны только подходящие категории — и после выбора тоже. -->
      <template v-if="query.trim()">
        <div v-if="found.length" class="cat-grid" role="radiogroup" aria-label="Найденные категории">
          <button v-for="c in found" :key="c.id" type="button" role="radio" :aria-checked="modelValue===c.id"
            :class="['cat-opt', {selected: modelValue===c.id}]" @click="pick(c)">
            <span v-if="tree.nums[c.id]" class="cat-num">{{ tree.nums[c.id] }}</span>
            <span class="cat-emoji" aria-hidden="true">{{ c.icon }}</span><span class="cat-name">{{ c.name }}</span>
          </button>
        </div>
        <p v-else class="hint">Ничего не нашлось</p>
      </template>
      <div v-else-if="selected && !browsing" class="cat-picked">
        <span class="cat-emoji" aria-hidden="true">{{ selected.icon }}</span>
        <span class="cat-picked-name">{{ tree.nums[selected.id] ? tree.nums[selected.id] + '. ' : '' }}{{ selected.name }}{{ selected.archived ? ' (в архиве)' : '' }}</span>
        <button type="button" class="btn small" @click="browse">Другая</button>
      </div>
      <template v-else>
        <div v-for="s in tree.sections" :key="s.group.id" class="picker-section">
          <button type="button" :class="['picker-head', { open: open.has(s.group.id) }]"
            :aria-expanded="open.has(s.group.id)" @click="toggleOpen(s.group.id)">
            <icon name="down" :class="['chev', { closed: !open.has(s.group.id) }]" :size="18"/>
            <span class="picker-title">{{ groupLabel(tree, s.group) }}</span>
          </button>
          <div v-show="open.has(s.group.id)" class="cat-grid" role="radiogroup" :aria-label="s.group.name">
            <button v-for="c in s.items" :key="c.id" type="button" role="radio" :aria-checked="modelValue===c.id"
              :class="['cat-opt', {selected: modelValue===c.id}]" @click="pick(c)">
              <span class="cat-num">{{ tree.nums[c.id] }}</span>
              <span class="cat-emoji" aria-hidden="true">{{ c.icon }}</span><span class="cat-name">{{ c.name }}</span>
            </button>
          </div>
        </div>
        <div v-if="tree.loose.length" class="cat-grid" role="radiogroup" aria-label="Категории без раздела">
          <button v-for="c in tree.loose" :key="c.id" type="button" role="radio" :aria-checked="modelValue===c.id"
            :class="['cat-opt', {selected: modelValue===c.id}]" @click="pick(c)">
            <span class="cat-emoji" aria-hidden="true">{{ c.icon }}</span><span class="cat-name">{{ c.name }}</span>
          </button>
        </div>
      </template>
    </div>`,
};
