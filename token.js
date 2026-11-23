// Constant-time comparison of an incoming header token against one or more env secrets.
import crypto from "node:crypto";

export function headerTokenMatches(given, ...secrets) {
  const a = Buffer.from(String(given ?? ""));
  let ok = false;
  for (const secret of secrets) {
    if (!secret) continue;
    const b = Buffer.from(String(secret));
    if (a.length === b.length) {
      if (crypto.timingSafeEqual(a, b)) ok = true;
    } else {
      // Same-length dummy compare so a shorter/longer secret does not return immediately.
      crypto.timingSafeEqual(a, Buffer.alloc(a.length));
    }
  }
  return ok;
}
