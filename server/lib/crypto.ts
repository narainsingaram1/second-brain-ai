/**
 * Envelope for provider credentials: AES-256-GCM with a random 96-bit IV per write. The account and secret
 * name are bound in as additional authenticated data, so a ciphertext copied to another account or slot
 * fails to decrypt. Keys are versioned so they can be rotated without re-entering every credential.
 */
export interface SealedSecret { ciphertext: string; iv: string; keyVersion: number }
type Keyring = { current: number; keys: Map<number, CryptoKey> };

const encoder = new TextEncoder();
const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const fromBase64 = (text: string) => Uint8Array.from(atob(text), c => c.charCodeAt(0));
const aad = (userId: string, name: string) => encoder.encode(`synapse-secret|${userId}|${name}`);

const keyrings = new Map<string, Promise<Keyring>>();
/** Parses `base64` or `version:base64[,version:base64…]`. Throws when no valid 32-byte key is configured. */
export function keyring(config: string): Promise<Keyring> {
  let ring = keyrings.get(config);
  if (!ring) {
    ring = (async () => {
      const entries = config.split(",").map(s => s.trim()).filter(Boolean).map((entry, i) => {
        const [version, material] = entry.includes(":") ? entry.split(":", 2) : [String(i + 1), entry];
        let bytes: ReturnType<typeof fromBase64> | undefined;
        try { bytes = fromBase64(material); } catch { /* Reported below. */ }
        if (!bytes || !/^\d+$/.test(version) || Number(version) < 1 || bytes.length !== 32) throw new Error("SYNAPSE_SECRETS_KEY must be 32 random bytes in base64 (openssl rand -base64 32).");
        return [Number(version), bytes] as const;
      });
      if (!entries.length) throw new Error("Secure key storage is not configured on the server.");
      const keys = new Map<number, CryptoKey>();
      for (const [version, bytes] of entries) keys.set(version, await crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]));
      return { current: entries[0][0], keys };
    })();
    ring.catch(() => keyrings.delete(config));
    keyrings.set(config, ring);
  }
  return ring;
}

export async function sealSecret(config: string, userId: string, name: string, plaintext: string): Promise<SealedSecret> {
  const ring = await keyring(config);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad(userId, name) }, ring.keys.get(ring.current)!, encoder.encode(plaintext));
  return { ciphertext: toBase64(new Uint8Array(sealed)), iv: toBase64(iv), keyVersion: ring.current };
}

export async function openSecret(config: string, userId: string, name: string, secret: SealedSecret): Promise<string> {
  const ring = await keyring(config);
  const key = ring.keys.get(secret.keyVersion);
  if (!key) throw new Error("This credential was encrypted with a key the server no longer has. Enter it again in Settings.");
  try {
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64(secret.iv), additionalData: aad(userId, name) }, key, fromBase64(secret.ciphertext));
    return new TextDecoder().decode(plain);
  } catch {
    throw new Error("The stored credential could not be decrypted. Enter it again in Settings.");
  }
}
