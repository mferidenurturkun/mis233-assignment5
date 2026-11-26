// MÜBECCEL FERİDE NUR TÜRKÜN, 2024502063
import { Hono, type Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z } from "zod";
import { and, asc, eq, sql } from "drizzle-orm";
import type { Db } from "./db.ts";
import { tasks, users } from "./schema.ts";
import { checkPassword, createSession, hashPassword, requireAuth } from "./auth.ts";
import type { Env } from "./auth.ts";

const TASK_STATUSES = ["todo", "in-progress", "done"] as const;
const TASK_PRIORITIES = ["low", "medium", "high"] as const;

type OwnedTaskResult =
  | { ok: true; task: typeof tasks.$inferSelect }
  | { ok: false; status: 403 | 404; message: string };

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

  // ── Zod şemaları ────────────────────────────────────────────────────────
  const Credentials = z.object({
    email: z.string().email(),
    password: z.string().min(8),
  });

  const CreateTaskBody = z.object({
    title: z.string().trim().min(1),
    status: z.enum(TASK_STATUSES).optional(),
    priority: z.enum(TASK_PRIORITIES).optional(),
  });

  const UpdateTaskBody = z.object({
    title: z.string().trim().min(1).optional(),
    status: z.enum(TASK_STATUSES).optional(),
    priority: z.enum(TASK_PRIORITIES).optional(),
  });

  // ── Yardımcı: :id doğrulama ve sahiplik kontrolü ────────────────────────
  function parseTaskId(rawId: string | undefined): number | null {
    if (!rawId || !/^\d+$/.test(rawId)) return null;
    const num = Number(rawId);
    return Number.isSafeInteger(num) && num > 0 ? num : null;
  }

  async function findOwnedTask(taskId: number, userId: number): Promise<OwnedTaskResult> {
    const [task] = await db.db.select().from(tasks).where(eq(tasks.id, taskId));
    if (!task) return { ok: false, status: 404, message: "task not found" };
    if (task.userId !== userId) return { ok: false, status: 403, message: "forbidden" };
    return { ok: true, task };
  }

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

  // ── GET /api/tasks ──────────────────────────────────────────────────────
  app.get("/api/tasks", async (c) => {
    const userId = c.get("userId");
    const statusParam = c.req.query("status");
    const priorityParam = c.req.query("priority");
    const pageParam = c.req.query("page") ?? "1";
    const limitParam = c.req.query("limit") ?? "10";

    if (
      statusParam !== undefined &&
      !TASK_STATUSES.includes(statusParam as typeof TASK_STATUSES[number])
    ) {
      return fail(c, 400, "invalid status filter");
    }
    if (
      priorityParam !== undefined &&
      !TASK_PRIORITIES.includes(priorityParam as typeof TASK_PRIORITIES[number])
    ) {
      return fail(c, 400, "invalid priority filter");
    }

    const page = Number(pageParam);
    const limit = Number(limitParam);
    if (
      !Number.isInteger(page) || page < 1 || !Number.isInteger(limit) || limit < 1 ||
      limit > 100
    ) {
      return fail(c, 400, "invalid pagination parameters");
    }

    const conditions = [eq(tasks.userId, userId)];
    if (statusParam !== undefined) {
      conditions.push(eq(tasks.status, statusParam as typeof TASK_STATUSES[number]));
    }
    if (priorityParam !== undefined) {
      conditions.push(eq(tasks.priority, priorityParam as typeof TASK_PRIORITIES[number]));
    }

    const whereClause = and(...conditions);

    const [countRow] = await db.db
      .select({ count: sql<number>`count(*)` })
      .from(tasks)
      .where(whereClause);
    const total = Number(countRow?.count ?? 0);

    const items = await db.db
      .select()
      .from(tasks)
      .where(whereClause)
      .orderBy(asc(tasks.id))
      .limit(limit)
      .offset((page - 1) * limit);

    return c.json({ items, page, limit, total });
  });

  // ── POST /api/tasks ─────────────────────────────────────────────────────
  app.post("/api/tasks", async (c) => {
    const userId = c.get("userId");
    const parsed = CreateTaskBody.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) {
      return fail(c, 400, "validation failed", parsed.error.issues);
    }

    const [created] = await db.db
      .insert(tasks)
      .values({
        userId,
        title: parsed.data.title,
        ...(parsed.data.status ? { status: parsed.data.status } : {}),
        ...(parsed.data.priority ? { priority: parsed.data.priority } : {}),
      })
      .returning();

    return c.json(created, 201);
  });

  // ── GET /api/tasks/:id ──────────────────────────────────────────────────
  app.get("/api/tasks/:id", async (c) => {
    const userId = c.get("userId");
    const taskId = parseTaskId(c.req.param("id"));
    if (!taskId) return fail(c, 400, "invalid task id");

    const found = await findOwnedTask(taskId, userId);
    if (!found.ok) return fail(c, found.status, found.message);

    return c.json(found.task);
  });

  // ── PATCH & PUT /api/tasks/:id ──────────────────────────────────────────
  const handleUpdateTask = async (c: Context<Env>) => {
    const userId = c.get("userId");
    const taskId = parseTaskId(c.req.param("id"));
    if (!taskId) return fail(c, 400, "invalid task id");

    const found = await findOwnedTask(taskId, userId);
    if (!found.ok) return fail(c, found.status, found.message);

    const parsed = UpdateTaskBody.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) {
      return fail(c, 400, "validation failed", parsed.error.issues);
    }

    const updates: Partial<typeof tasks.$inferInsert> = {};
    if (parsed.data.title !== undefined) updates.title = parsed.data.title;
    if (parsed.data.status !== undefined) updates.status = parsed.data.status;
    if (parsed.data.priority !== undefined) updates.priority = parsed.data.priority;

    if (Object.keys(updates).length === 0) {
      return fail(c, 400, "no valid fields to update");
    }

    const [updated] = await db.db
      .update(tasks)
      .set(updates)
      .where(and(eq(tasks.id, taskId), eq(tasks.userId, userId)))
      .returning();

    return c.json(updated);
  };

  app.patch("/api/tasks/:id", handleUpdateTask);
  app.put("/api/tasks/:id", handleUpdateTask);

  // ── DELETE /api/tasks/:id ───────────────────────────────────────────────
  app.delete("/api/tasks/:id", async (c) => {
    const userId = c.get("userId");
    const taskId = parseTaskId(c.req.param("id"));
    if (!taskId) return fail(c, 400, "invalid task id");

    const found = await findOwnedTask(taskId, userId);
    if (!found.ok) return fail(c, found.status, found.message);

    await db.db.delete(tasks).where(and(eq(tasks.id, taskId), eq(tasks.userId, userId)));
    return c.json({ deleted: true, id: taskId });
  });

  // ── 404 ─────────────────────────────────────────────────────────────────
  app.notFound((c) => fail(c, 404, "not found"));

  return app;
}