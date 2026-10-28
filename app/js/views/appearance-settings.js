import { ref } from 'vue';
import { appearance, SCHEMES, ACCENTS, setBackground, clearBackground, resetAppearance } from '../appearance.js?v=2610290209';
import { toast } from '../store.js?v=2610290209';

export const AppearanceSettings = {
  setup() {
    const fileInput = ref(null);
    async function onFile(e) {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (!file) return;
      try { await setBackground(file); } catch (err) { toast(err.message, 'error'); }
    }
    const THEMES = [['auto', 'Как в системе'], ['light', 'Светлая'], ['dark', 'Тёмная']];
    return { appearance, SCHEMES, ACCENTS, THEMES, fileInput, onFile, clearBackground, resetAppearance };
  },
  template: `
    <div class="card pad stack">
      <h2>Оформление</h2>
      <p class="hint">Настраивается отдельно на каждом устройстве.</p>

      <div>
        <div class="field-label">Тема</div>
        <div class="segmented" role="radiogroup" aria-label="Тема">
          <button v-for="[id, label] in THEMES" :key="id" type="button" role="radio" :aria-checked="appearance.theme === id"
            :class="{ active: appearance.theme === id }" @click="appearance.theme = id">{{ label }}</button>
        </div>
      </div>

      <div>
        <div class="field-label">Цветовая схема</div>
        <div class="scheme-grid" role="radiogroup" aria-label="Цветовая схема">
          <button v-for="s in SCHEMES" :key="s.id" type="button" role="radio" :aria-checked="appearance.scheme === s.id"
            :class="['scheme-opt', { selected: appearance.scheme === s.id }]" @click="appearance.scheme = s.id">
            <span class="scheme-swatches"><i v-for="c in s.swatches" :key="c" :style="{ background: c }"></i></span>
            {{ s.label }}
          </button>
        </div>
      </div>

      <div>
        <div class="field-label">Акцентный цвет</div>
        <div class="accent-row" role="radiogroup" aria-label="Акцентный цвет">
          <button v-for="a in ACCENTS" :key="a.id" type="button" role="radio" :aria-checked="appearance.accent === a.color"
            :title="a.label" :aria-label="a.label" :class="['accent-dot', { selected: appearance.accent === a.color }]"
            :style="{ background: a.color }" @click="appearance.accent = a.color"></button>
          <label class="accent-custom" title="Свой цвет">
            <input id="accent-custom" type="color" v-model="appearance.accent" aria-label="Свой цвет">
          </label>
        </div>
      </div>

      <div class="stack">
        <div class="field-label">Фоновое изображение</div>
        <input ref="fileInput" type="file" accept="image/*" hidden @change="onFile">
        <div class="bg-row">
          <div class="bg-preview" :style="appearance.bg ? { backgroundImage: 'url(' + appearance.bg + ')' } : {}">
            <span v-if="!appearance.bg" class="hint">нет</span>
          </div>
          <div class="btn-row">
            <button type="button" class="btn" @click="fileInput.click()">{{ appearance.bg ? 'Заменить' : 'Выбрать картинку' }}</button>
            <button v-if="appearance.bg" type="button" class="btn ghost" @click="clearBackground">Убрать</button>
          </div>
        </div>
        <template v-if="appearance.bg">
          <label class="slider">
            <span>Размытие фона <b>{{ appearance.blur }} px</b></span>
            <input id="bg-blur" type="range" min="0" max="30" v-model.number="appearance.blur">
          </label>
          <label class="slider">
            <span>Затемнение фона <b>{{ appearance.dim }}%</b></span>
            <input id="bg-dim" type="range" min="0" max="85" v-model.number="appearance.dim">
          </label>
          <label class="slider">
            <span>Плотность карточек <b>{{ appearance.glass }}%</b></span>
            <input id="bg-glass" type="range" min="40" max="100" v-model.number="appearance.glass">
          </label>
        </template>
      </div>

      <div><button type="button" class="btn ghost" @click="resetAppearance">Вернуть оформление по умолчанию</button></div>
    </div>`,
};
