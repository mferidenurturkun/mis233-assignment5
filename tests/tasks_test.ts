// MÜBECCEL FERİDE NUR TÜRKÜN, 2024502063
import { assertEquals } from "@std/assert";
import { freshApp } from "./helpers.ts";

async function registerAndLogin(
  app: Awaited<ReturnType<typeof freshApp>>,
  email: string,
  password = "password123",
): Promise<string> {
  await app.request("/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const loginRes = await app.request("/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const data = await loginRes.json();
  return data.token as string;
}

Deno.test("GET /api/tasks without token returns 401", async () => {
  const app = await freshApp();
  const res = await app.request("/api/tasks");
  assertEquals(res.status, 401);
});

Deno.test("POST and GET /api/tasks work for authenticated user", async () => {
  const app = await freshApp();
  const token = await registerAndLogin(app, "user1@example.com");

  const createRes = await app.request("/api/tasks", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ title: "Write tests", priority: "high" }),
  });
  assertEquals(createRes.status, 201);
  const created = await createRes.json();
  assertEquals(created.title, "Write tests");
  assertEquals(created.status, "todo");
  assertEquals(created.priority, "high");

  const listRes = await app.request("/api/tasks", {
    headers: { authorization: `Bearer ${token}` },
  });
  assertEquals(listRes.status, 200);
  const pageData = await listRes.json();
  assertEquals(pageData.total, 1);
  assertEquals(pageData.items.length, 1);
  assertEquals(pageData.items[0].title, "Write tests");
});

Deno.test("A user cannot read or update another user's task (403)", async () => {
  const app = await freshApp();
  const tokenA = await registerAndLogin(app, "alice@example.com");
  const tokenB = await registerAndLogin(app, "bob@example.com");

  const createRes = await app.request("/api/tasks", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${tokenA}`,
    },
    body: JSON.stringify({ title: "Alice private task" }),
  });
  const taskA = await createRes.json();

  const readByB = await app.request(`/api/tasks/${taskA.id}`, {
    headers: { authorization: `Bearer ${tokenB}` },
  });
  assertEquals(readByB.status, 403);

  const patchByB = await app.request(`/api/tasks/${taskA.id}`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${tokenB}`,
    },
    body: JSON.stringify({ status: "done" }),
  });
  assertEquals(patchByB.status, 403);
});

Deno.test("Invalid status returns 400 and pagination returns the right page", async () => {
  const app = await freshApp();
  const token = await registerAndLogin(app, "pager@example.com");

  const badStatus = await app.request("/api/tasks?status=invalid", {
    headers: { authorization: `Bearer ${token}` },
  });
  assertEquals(badStatus.status, 400);

  for (let i = 1; i <= 5; i++) {
    await app.request("/api/tasks", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ title: `Task ${i}` }),
    });
  }

  const page2 = await app.request("/api/tasks?page=2&limit=2", {
    headers: { authorization: `Bearer ${token}` },
  });
  assertEquals(page2.status, 200);
  const body = await page2.json();
  assertEquals(body.total, 5);
  assertEquals(body.page, 2);
  assertEquals(body.limit, 2);
  assertEquals(body.items.length, 2);
  assertEquals(body.items[0].title, "Task 3");
  assertEquals(body.items[1].title, "Task 4");
});