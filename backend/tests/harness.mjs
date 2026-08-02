// Minimal test harness — this project does not use a test framework.
import "dotenv/config";
import jwt from "jsonwebtoken";

const BASE = process.env.TEST_BASE || "http://localhost:5050";

export const results = { pass: 0, fail: 0 };

export function ok(name, cond, extra = "") {
  if (cond) {
    results.pass += 1;
    console.log(`  PASS  ${name}`);
  } else {
    results.fail += 1;
    console.log(`  FAIL  ${name} ${extra}`);
  }
}

export function section(title) {
  console.log(`\n═══ ${title} ═══`);
}

/** Mints a token the same way POST /api/login does. */
export function tokenFor(id, username) {
  return jwt.sign({ id, username }, process.env.JWT_SECRET || "jwt_secret_key", {
    expiresIn: "1h",
  });
}

export async function req(method, path, { token, body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body && !["GET", "HEAD"].includes(method) ? JSON.stringify(body) : undefined,
  });
  let parsed = null;
  try { parsed = await res.json(); } catch { /* non-JSON body */ }
  return { status: res.status, body: parsed };
}

export function summary() {
  console.log(`\n──────── ${results.pass} passed, ${results.fail} failed ────────\n`);
  return results.fail === 0;
}
