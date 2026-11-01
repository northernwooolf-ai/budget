// Диаграммы отчётов: кольцо (доли) и динамика по месяцам (столбцы или линии).
import { ref, computed, watch } from 'vue';
// Графики показывают итоги — без копеек.
import { rub as money, monthShort, monthLabel } from './utils.js?v=2611011509';

// Цвета частей в фиксированном порядке; девятая и дальше части уходят в «Остальное».
export const SLICE_COLORS = ['var(--c1)', 'var(--c2)', 'var(--c3)', 'var(--c4)', 'var(--c5)', 'var(--c6)', 'var(--c7)', 'var(--c8)'];
export const OTHER_COLOR = 'var(--muted)';

const short = (s, n = 18) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

// items: [{ id, label, value, color }]; центр показывает итог или часть под курсором.
export const RingChart = {
  props: { items: Array, total: Number, centerLabel: String },
  emits: ['select'],
  setup(props) {
    const R = 70, C = 2 * Math.PI * R, GAP = 2;
    const hover = ref(null);
    const arcs = computed(() => {
      let offset = 0;
      return props.items.filter((it) => it.value > 0).map((it) => {
        const len = props.total ? (it.value / props.total) * C : 0;
        const arc = { ...it, dash: `${Math.max(0.5, len - GAP)} ${C}`, offset: -offset };
        offset += len;
        return arc;
      });
    });
    const active = computed(() => arcs.value.find((a) => a.id === hover.value));
    // На телефоне «увода курсора» нет — сбрасываем выделение, когда части сменились.
    watch(() => props.items, () => { hover.value = null; });
    return { R, hover, arcs, active, money, short };
  },
  template: `
    <svg viewBox="0 0 200 200" class="ring" role="img" :aria-label="centerLabel + ': ' + money(total)">
      <g transform="rotate(-90 100 100)">
        <circle cx="100" cy="100" :r="R" fill="none" class="ring-track" stroke-width="26"/>
        <circle v-for="a in arcs" :key="a.id" cx="100" cy="100" :r="R" fill="none" :stroke="a.color" stroke-width="26"
          :stroke-dasharray="a.dash" :stroke-dashoffset="a.offset" :class="['ring-seg', { dim: hover && hover !== a.id }]"
          @mouseenter="hover = a.id" @mouseleave="hover = null" @click="$emit('select', a)">
          <title>{{ a.label }}: {{ money(a.value) }}</title>
        </circle>
      </g>
      <text x="100" y="93" text-anchor="middle" class="ring-sub">{{ short(active ? active.label : centerLabel) }}</text>
      <text x="100" y="117" text-anchor="middle" class="ring-total">{{ money(active ? active.value : total) }}</text>
    </svg>`,
};

// Шаг шкалы: 1, 2, 2,5 или 5, умноженные на степень десяти, примерно 4 деления на графике.
function niceStep(top) {
  const raw = top / 4, power = 10 ** Math.floor(Math.log10(raw)), n = raw / power;
  return Math.max(1, (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * power);
}
// Подпись на оси: 150 000 → «150 тыс», 1 500 000 → «1,5 млн».
function shortMoney(v) {
  const text = (n) => String(Math.round(n * 100) / 100).replace('.', ',');
  if (v >= 1e6) return `${text(v / 1e6)} млн`;
  return v >= 1000 ? `${text(v / 1000)} тыс` : String(v);
}

// rows: [{ date, values: { key: число } }], series: [{ key, label, color }], mode: 'bars' | 'lines'.
export const TrendChart = {
  props: { rows: Array, series: Array, mode: String },
  setup(props) {
    const W = 340, H = 190, PAD_R = 8, PAD_B = 24, PAD_T = 14;
    const hover = ref(null);
    watch(() => props.rows.length, () => { hover.value = null; });
    const top = computed(() => Math.max(1, ...props.rows.flatMap((r) => props.series.map((s) => r.values[s.key] ?? 0))));
    // Шкала с круглыми подписями: верх графика — ближайшее круглое значение над самым большим.
    const tickStep = computed(() => niceStep(top.value));
    const max = computed(() => Math.ceil(top.value / tickStep.value) * tickStep.value);
    const ticks = computed(() => Array.from({ length: Math.round(max.value / tickStep.value) }, (_, i) => (i + 1) * tickStep.value));
    // Слева оставляем столько места, сколько занимает самая длинная подпись: шрифт на телефонах бывает шире.
    const padL = computed(() => Math.max(...ticks.value.map((v) => shortMoney(v).length)) * 7.2 + 8);
    const step = computed(() => (W - padL.value - PAD_R) / Math.max(1, props.rows.length));
    const cx = (i) => padL.value + step.value * i + step.value / 2;
    const y = (v) => PAD_T + (H - PAD_B - PAD_T) * (1 - v / max.value);
    const base = H - PAD_B;

    // Столбцы: по одному на серию в каждом месяце, скруглённый верх, ровный низ.
    const barW = computed(() => Math.min(18, (step.value - 12) / props.series.length - 2));
    function bar(i, si, v) {
      const w = barW.value, x = cx(i) - (props.series.length * (w + 2)) / 2 + si * (w + 2) + 1;
      const top = Math.min(y(v), base - (v > 0 ? 2 : 0)), r = Math.min(4, w / 2, base - top);
      if (!(v > 0)) return '';
      return `M${x},${base}V${top + r}Q${x},${top} ${x + r},${top}H${x + w - r}Q${x + w},${top} ${x + w},${top + r}V${base}Z`;
    }
    // Линии: плавные кривые без «вылетов» ниже нуля, под ними лёгкая заливка.
    function line(key) {
      return props.rows.map((r, i) => {
        const px = cx(i), py = y(r.values[key] ?? 0);
        if (!i) return `M${px},${py}`;
        const prevX = cx(i - 1), prevY = y(props.rows[i - 1].values[key] ?? 0), mid = (prevX + px) / 2;
        return `C${mid},${prevY} ${mid},${py} ${px},${py}`;
      }).join(' ');
    }
    const area = (key) => `${line(key)} L${cx(props.rows.length - 1)},${base} L${cx(0)},${base} Z`;

    return { W, H, padL, base, hover, step, cx, y, ticks, shortMoney, bar, line, area, money, monthShort, monthLabel };
  },
  template: `
    <div class="chart-wrap">
      <div class="legend">
        <span v-for="s in series" :key="s.key"><i class="swatch" :style="{ background: s.color }"></i>{{ s.label }}</span>
      </div>
      <svg :viewBox="'0 0 ' + W + ' ' + H" class="chart" role="img" :aria-label="series.map(s => s.label).join(' и ') + ' по месяцам'">
        <defs>
          <linearGradient v-for="s in series" :key="s.key" :id="'grad-' + s.key" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" :stop-color="s.color" stop-opacity=".28"/><stop offset="1" :stop-color="s.color" stop-opacity="0"/>
          </linearGradient>
        </defs>
        <template v-for="v in ticks" :key="v">
          <line :x1="padL" :x2="W" :y1="y(v)" :y2="y(v)" class="gridline"/>
          <text :x="padL - 5" :y="y(v) + 3" text-anchor="end" class="tick">{{ shortMoney(v) }}</text>
        </template>
        <line :x1="padL" :x2="W" :y1="base" :y2="base" class="axis"/>
        <text :x="padL - 5" :y="base + 3" text-anchor="end" class="tick">0</text>
        <rect v-if="hover !== null" :x="cx(hover) - step / 2" y="0" :width="step" :height="base" class="hit on"/>
        <template v-if="mode === 'lines'">
          <template v-for="s in series" :key="s.key">
            <path :d="area(s.key)" :fill="'url(#grad-' + s.key + ')'" stroke="none"/>
            <path :d="line(s.key)" fill="none" :stroke="s.color" stroke-width="2.25" stroke-linecap="round"/>
            <circle v-for="(r, i) in rows" :key="i" :cx="cx(i)" :cy="y(r.values[s.key] ?? 0)" :r="hover === i ? 5 : 3"
              :fill="s.color" class="dot"/>
          </template>
        </template>
        <template v-else>
          <g v-for="(r, i) in rows" :key="r.month">
            <path v-for="(s, si) in series" :key="s.key" :d="bar(i, si, r.values[s.key] ?? 0)" :fill="s.color"/>
          </g>
        </template>
        <text v-for="(r, i) in rows" :key="'t' + i" :x="cx(i)" :y="H - 7" text-anchor="middle" class="tick">{{ monthShort(r.date) }}</text>
        <rect v-for="(r, i) in rows" :key="'h' + i" :x="cx(i) - step / 2" y="0" :width="step" :height="H" fill="transparent"
          @mouseenter="hover = i" @mouseleave="hover = null" @click="hover = hover === i ? null : i"/>
      </svg>
      <div class="chart-tip" v-if="hover !== null && rows[hover]">
        <b>{{ monthLabel(rows[hover].date) }}</b>
        <span v-for="s in series" :key="s.key"><i class="swatch" :style="{ background: s.color }"></i>{{ s.label }}: {{ money(rows[hover].values[s.key] ?? 0) }}</span>
      </div>
    </div>`,
};
