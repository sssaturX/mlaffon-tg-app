import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { users } from "../db/schema.js";

export async function isUserBanned(userId: string): Promise<boolean> {
  const [row] = await db
    .select({ banned: users.banned })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row?.banned === true;
}
