export const DASHBOARD_AUTH_COOKIE = "inbound_dashboard_session";

const SESSION_MESSAGE = "inbound-dashboard-session-v1";

function encodeText(value: string) {
  return new TextEncoder().encode(value);
}

function toHex(buffer: ArrayBuffer) {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function constantTimeEqual(left: string, right: string) {
  if (left.length !== right.length) {
    return false;
  }

  let diff = 0;

  for (let index = 0; index < left.length; index += 1) {
    diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }

  return diff === 0;
}

export async function createDashboardSessionToken(password: string | undefined) {
  if (!password) {
    return null;
  }

  const key = await crypto.subtle.importKey("raw", encodeText(password), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign"
  ]);
  const signature = await crypto.subtle.sign("HMAC", key, encodeText(SESSION_MESSAGE));

  return toHex(signature);
}

export async function verifyDashboardSessionToken(token: string | undefined, password: string | undefined) {
  if (!token || !password) {
    return false;
  }

  const expected = await createDashboardSessionToken(password);

  return Boolean(expected && constantTimeEqual(token, expected));
}
