import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;

const SALT_BYTES = 16;
const KEY_BYTES = 64;
const STORED = /^scrypt\$([0-9a-f]{32})\$([0-9a-f]{128})$/;

// Used on login for an unknown email, so that both failures run one scrypt.
// The password behind it was random and thrown away.
export const DUMMY_HASH =
  "scrypt$b7afa19d22b61f2752fadcea3cb0de65$d1d117c4037f5e0721539c416ff1b072d9e5802376cd1acb7bc0d4473f1093752b9c4b13cbd3aef301685e2a38cab1003d30b5c0d57d403922299afd21db5547";

// Returns `scrypt$<salt hex>$<key hex>` with a new random salt.
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await scryptAsync(password, salt, KEY_BYTES);
  return `scrypt$${salt.toString("hex")}$${key.toString("hex")}`;
}

// Re-derives the key with the stored salt and compares in constant time.
// A malformed stored value verifies false.
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const match = STORED.exec(stored);
  if (!match) return false;
  const salt = Buffer.from(match[1], "hex");
  const expected = Buffer.from(match[2], "hex");
  const actual = await scryptAsync(password, salt, KEY_BYTES);
  return timingSafeEqual(actual, expected);
}
