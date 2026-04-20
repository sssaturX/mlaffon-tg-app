import bcrypt from "bcryptjs";
import { eq, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { admins, type AdminRole } from "../db/schema.js";

const SALT_ROUNDS = 12;

export async function findAdminByEmail(email: string) {
  const [row] = await db
    .select()
    .from(admins)
    .where(eq(admins.email, email.toLowerCase().trim()))
    .limit(1);
  return row ?? null;
}

export async function verifyAdminCredentials(
  email: string,
  password: string,
  passphrase: string
): Promise<
  | { ok: true; admin: { id: string; email: string; role: AdminRole } }
  | { ok: false; reason: string }
> {
  const admin = await findAdminByEmail(email);
  if (!admin || !admin.active) return { ok: false, reason: "invalid_credentials" };

  const pwOk = await bcrypt.compare(password, admin.passwordHash);
  if (!pwOk) return { ok: false, reason: "invalid_credentials" };

  const ppOk = await bcrypt.compare(passphrase, admin.passphraseHash);
  if (!ppOk) return { ok: false, reason: "invalid_credentials" };

  await db
    .update(admins)
    .set({ lastLoginAt: new Date() })
    .where(eq(admins.id, admin.id));

  return {
    ok: true,
    admin: {
      id: admin.id,
      email: admin.email,
      role: admin.role as AdminRole,
    },
  };
}

export async function ensureSeedAdmin(): Promise<void> {
  const email = process.env.ADMIN_EMAIL?.trim()?.toLowerCase();
  const password = process.env.ADMIN_PASSWORD?.trim();
  const passphrase = process.env.ADMIN_PASSPHRASE?.trim();
  if (!email || !password || !passphrase) return;

  const existing = await findAdminByEmail(email);
  if (existing) return;

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  const passphraseHash = await bcrypt.hash(passphrase, SALT_ROUNDS);

  await db.insert(admins).values({
    email,
    passwordHash,
    passphraseHash,
    role: "super_admin",
    active: true,
  });
}

export async function createAdmin(params: {
  email: string;
  password: string;
  passphrase: string;
  role: AdminRole;
}): Promise<{ id: string }> {
  const passwordHash = await bcrypt.hash(params.password, SALT_ROUNDS);
  const passphraseHash = await bcrypt.hash(params.passphrase, SALT_ROUNDS);
  const [row] = await db
    .insert(admins)
    .values({
      email: params.email.toLowerCase().trim(),
      passwordHash,
      passphraseHash,
      role: params.role,
      active: true,
    })
    .returning({ id: admins.id });
  return { id: row!.id };
}

export async function listAdmins() {
  return db
    .select({
      id: admins.id,
      email: admins.email,
      role: admins.role,
      active: admins.active,
      lastLoginAt: admins.lastLoginAt,
      createdAt: admins.createdAt,
    })
    .from(admins)
    .orderBy(admins.createdAt);
}

export async function updateAdminRole(
  adminId: string,
  role: AdminRole
): Promise<boolean> {
  const [u] = await db
    .update(admins)
    .set({ role, updatedAt: new Date() })
    .where(eq(admins.id, adminId))
    .returning({ id: admins.id });
  return !!u;
}

export async function deactivateAdmin(adminId: string): Promise<boolean> {
  const [u] = await db
    .update(admins)
    .set({ active: false, updatedAt: new Date() })
    .where(eq(admins.id, adminId))
    .returning({ id: admins.id });
  return !!u;
}
