import jwt from "jsonwebtoken";

function secret(): string {
  const s =
    process.env.ADMIN_JWT_SECRET ??
    process.env.JWT_SECRET ??
    (process.env.NODE_ENV === "production" ? "" : "dev-admin-secret");
  if (!s) throw new Error("ADMIN_JWT_SECRET or JWT_SECRET required for admin");
  return s;
}

export function signAdminToken(email: string): string {
  return jwt.sign({ sub: email, role: "admin" }, secret(), {
    expiresIn: "8h",
  });
}

export function verifyAdminToken(token: string): { email: string } {
  const p = jwt.verify(token, secret()) as { sub: string; role?: string };
  if (p.role !== "admin") throw new Error("forbidden");
  return { email: p.sub };
}
