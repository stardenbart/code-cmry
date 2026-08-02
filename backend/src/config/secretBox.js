import crypto from "crypto";

// ── Symmetric encryption for secrets stored in MySQL (per-user Gemini API keys) ─
// Key material is derived from JWT_SECRET so no extra env var is required.
// Format stored in DB: v1:<iv-hex>:<tag-hex>:<ciphertext-hex>

const SALT = "cod-ai-secretbox-v1";

let cachedKey = null;

function getKey() {
  if (cachedKey) return cachedKey;
  const secret = process.env.JWT_SECRET || "jwt_secret_key";
  cachedKey = crypto.scryptSync(secret, SALT, 32);
  return cachedKey;
}

export function encryptSecret(plain) {
  if (!plain) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getKey(), iv);
  const enc = Buffer.concat([cipher.update(String(plain), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("hex")}:${tag.toString("hex")}:${enc.toString("hex")}`;
}

export function decryptSecret(stored) {
  if (!stored) return null;
  const parts = String(stored).split(":");
  if (parts.length !== 4 || parts[0] !== "v1") return null;
  try {
    const [, ivHex, tagHex, dataHex] = parts;
    const decipher = crypto.createDecipheriv("aes-256-gcm", getKey(), Buffer.from(ivHex, "hex"));
    decipher.setAuthTag(Buffer.from(tagHex, "hex"));
    const dec = Buffer.concat([
      decipher.update(Buffer.from(dataHex, "hex")),
      decipher.final(),
    ]);
    return dec.toString("utf8");
  } catch {
    // Wrong JWT_SECRET or tampered row — treat as "no key stored"
    return null;
  }
}

// Shows only the tail of a key so the UI can confirm which key is saved
export function maskSecret(plain) {
  if (!plain) return null;
  const s = String(plain);
  if (s.length <= 8) return "••••";
  return `••••••••${s.slice(-4)}`;
}
