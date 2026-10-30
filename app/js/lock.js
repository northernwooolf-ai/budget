// Замок по отпечатку (или PIN телефона / Windows Hello): вы остаётесь вошедшим,
// но открыть приложение можно только после подтверждения на устройстве.
// Использует встроенную в браузер проверку (WebAuthn). Включается на каждом устройстве отдельно.
import { reactive } from 'vue';
import { localGet, localSet } from './utils.js?v=2610301646';

const KEY = 'lock-credential';
const AWAY_MS = 60_000; // через минуту в фоне приложение снова закрывается

const credentialId = () => localGet(KEY);

export const lock = reactive({
  enabled: !!credentialId(),
  locked: !!credentialId(),
  available: false,
});

const toBase64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const fromBase64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const random = (n) => crypto.getRandomValues(new Uint8Array(n));

// Есть ли на устройстве отпечаток / распознавание лица / PIN для подтверждения.
(async () => {
  try {
    lock.available = !!window.PublicKeyCredential
      && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch { lock.available = false; }
})();

export async function enableLock(email) {
  const cred = await navigator.credentials.create({
    publicKey: {
      challenge: random(32),
      rp: { name: 'Семейный бюджет' },
      user: { id: random(16), name: email || 'budget', displayName: email || 'Семейный бюджет' },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' },
      timeout: 60_000,
    },
  });
  localSet(KEY, toBase64(cred.rawId));
  lock.enabled = true;
}

export function disableLock() {
  try { localStorage.removeItem(KEY); } catch { /* не страшно */ }
  lock.enabled = false;
  lock.locked = false;
}

export async function unlock() {
  const id = credentialId();
  if (!id) { lock.locked = false; return; }
  await navigator.credentials.get({
    publicKey: {
      challenge: random(32),
      allowCredentials: [{ type: 'public-key', id: fromBase64(id) }],
      userVerification: 'required',
      timeout: 60_000,
    },
  });
  lock.locked = false;
}

// Свернули приложение больше чем на минуту — при возвращении снова просим отпечаток.
let hiddenAt = 0;
document.addEventListener('visibilitychange', () => {
  if (!lock.enabled) return;
  if (document.hidden) hiddenAt = Date.now();
  else if (hiddenAt && Date.now() - hiddenAt > AWAY_MS) lock.locked = true;
});
