// Распознавание речи браузером (в Chrome на Android — через Google, по-русски).
// Где его нет, остаётся обычное поле: можно диктовать микрофоном клавиатуры.
const Recognition = window.SpeechRecognition ?? window.webkitSpeechRecognition;

export const speechSupported = !!Recognition;

const ERRORS = {
  'not-allowed': 'Нет доступа к микрофону. Разрешите его в настройках браузера для этого сайта',
  'service-not-allowed': 'Нет доступа к микрофону. Разрешите его в настройках браузера для этого сайта',
  'audio-capture': 'Микрофон не найден',
  network: 'Для распознавания речи нужен интернет',
};

// onText(text, final) вызывается по мере распознавания; onEnd(error) — когда запись закончилась.
// Возвращает функцию, которая останавливает запись.
export function listen({ onText, onEnd }) {
  const r = new Recognition();
  r.lang = 'ru-RU';
  r.interimResults = true;
  r.continuous = false;
  let error = null;
  r.onresult = (e) => {
    const text = [...e.results].map((res) => res[0].transcript).join(' ').replace(/\s+/g, ' ').trim();
    onText(text, e.results[e.results.length - 1].isFinal);
  };
  r.onerror = (e) => { if (e.error !== 'no-speech' && e.error !== 'aborted') error = ERRORS[e.error] ?? `Ошибка распознавания речи: ${e.error}`; };
  r.onend = () => onEnd(error);
  try { r.start(); } catch (e) { onEnd(e.message); }
  return () => r.stop();
}
