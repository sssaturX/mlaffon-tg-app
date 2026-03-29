import jwt from "jsonwebtoken";

const secret = () => {
  const s =
    process.env.JWT_SECRET ??
    (process.env.NODE_ENV === "production" ? "" : "dev-only-change-me");
  if (!s) throw new Error("JWT_SECRET is not set");
  return s;
};

export interface SessionPayload {
  sub: string;
  tg: string;
}

export function signSession(userId: string, telegramId: bigint): string {
  return jwt.sign({ sub: userId, tg: telegramId.toString() }, secret(), {
    expiresIn: "7d",
  });
}

export function verifySession(token: string): SessionPayload {
  const p = jwt.verify(token, secret()) as SessionPayload;
  return p;
}
