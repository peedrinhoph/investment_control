/* Backup criptografado: PBKDF2-SHA256 (310 mil iterações) + AES-GCM 256, via Web Crypto do navegador. */
const enc = new TextEncoder(), dec = new TextDecoder();
export const FORMAT = 'patrimonio-encrypted';
const ITERATIONS = 310000;

function b64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));

export const cryptoAvailable = () => !!(globalThis.crypto?.subtle);

async function deriveKey(password, salt, iterations) {
  const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export async function encryptJSON(obj, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt, ITERATIONS);
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(obj))));
  return { app: 'Patrimonio PWA', format: FORMAT, v: 1, exportedAt: new Date().toISOString(),
           kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: ITERATIONS, salt: b64(salt) }, cipher: { name: 'AES-GCM', iv: b64(iv) }, data: b64(data) };
}

export const isEncrypted = obj => obj && obj.format === FORMAT && obj.data && obj.kdf && obj.cipher;

export async function decryptJSON(obj, password) {
  const iterations = Number(obj.kdf.iterations) || ITERATIONS;
  if (iterations > 5_000_000) throw new Error('parâmetros de criptografia inválidos.');
  const key = await deriveKey(password, unb64(obj.kdf.salt), iterations);
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(obj.cipher.iv) }, key, unb64(obj.data));
    return JSON.parse(dec.decode(plain));
  } catch (_) { throw new Error('senha incorreta ou arquivo corrompido.'); }
}
