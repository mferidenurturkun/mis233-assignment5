// MÜBECCEL FERİDE NUR TÜRKÜN, 2024502063
import { Hono, type Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z } from "zod";
import { eq } from "drizzle-orm";
import type { Db } from "./db.ts";
import { users } from "./schema.ts";
import { checkPassword, createSession, hashPassword, requireAuth } from "./auth.ts";
import type { Env } from "./auth.ts";

/** Build the whole application around a database, so tests can give it their own. */
export function createApp(db: Db) {
  const app = new Hono<Env>();

  // ── Yardımcı: standart hata şekli ──────────────────────────────────────
  const fail = (
    c: Context<Env>,
    status: ContentfulStatusCode,
    message: string,
    issues?: unknown[],
  ) => c.json({ error: message, ...(issues ? { issues } : {}) }, status);

  // ── Health ──────────────────────────────────────────────────────────────
  app.get("/health", (c) => c.json({ ok: true }));

  // ── Zod şeması: email + şifre (en az 8 karakter) ───────────────────────
  const Credentials = z.object({
    email: z.string().email(),
    password: z.string().min(8),
  });

  // ── POST /auth/register ─────────────────────────────────────────────────
  app.post("/auth/register", async (c) => {
    const parsed = Credentials.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) {
      return fail(c, 400, "validation failed", parsed.error.issues);
    }
    const { email, password } = parsed.data;

    // Email daha önce alınmış mı?
    const existing = await db.db.select().from(users).where(eq(users.email, email));
    if (existing.length > 0) {
      return fail(c, 409, "email already taken");
    }

    // Şifreyi hashle, kullanıcıyı kaydet
    const passwordHash = await hashPassword(password);
    const [user] = await db.db.insert(users).values({ email, passwordHash }).returning();

    // Hash'i asla döndürme!
    return c.json({ id: user.id, email: user.email }, 201);
  });

  // ── POST /auth/login ────────────────────────────────────────────────────
  app.post("/auth/login", async (c) => {
    const parsed = Credentials.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) {
      return fail(c, 400, "validation failed", parsed.error.issues);
    }
    const { email, password } = parsed.data;

    // Kullanıcıyı bul
    const [user] = await db.db.select().from(users).where(eq(users.email, email));

    // Yanlış email veya yanlış şifre → aynı mesaj (güvenlik!)
    if (!user || !(await checkPassword(password, user.passwordHash))) {
      return fail(c, 401, "invalid email or password");
    }

    const token = await createSession(db, user.id);
    return c.json({ token });
  });

  // ── Auth middleware: /api/* altındaki her route için ───────────────────
  app.use("/api/*", requireAuth(db));

  // ── 404 ─────────────────────────────────────────────────────────────────
  app.notFound((c) => fail(c, 404, "not found"));

  return app;
}