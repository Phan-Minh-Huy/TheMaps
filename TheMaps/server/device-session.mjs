import { getCookie, setCookie } from "hono/cookie";
import { createHash, randomBytes } from "node:crypto";

export async function deviceSession(c) {
  let token = getCookie(c, "atlas_session");

  if (!token || !/^[a-f0-9]{64}$/.test(token)) {
    token = randomBytes(32).toString("hex");

    setCookie(c, "atlas_session", token, {
      httpOnly: true,
      sameSite: "Lax",
      secure: new URL(c.req.url).protocol === "https:",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });
  }

  const id = createHash("sha256").update(token).digest("hex");

  return {
    id: `device:${id}`,
    name: "Thiết bị này",
    scope: "device",
  };
}
