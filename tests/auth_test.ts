// MÜBECCEL FERİDE NUR TÜRKÜN, 2024502063
import { assertEquals, assertExists } from "@std/assert";
import { freshApp } from "./helpers.ts";

Deno.test("POST /auth/register creates user (201) and rejects duplicate email (409)", async () => {
  const app = await freshApp();

  const first = await app.request("/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "ada@example.com", password: "password123" }),
  });
  assertEquals(first.status, 201);
  const created = await first.json();
  assertExists(created.id);
  assertEquals(created.email, "ada@example.com");
  assertEquals("passwordHash" in created, false);

  const duplicate = await app.request("/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "ada@example.com", password: "password123" }),
  });
  assertEquals(duplicate.status, 409);
});

Deno.test("POST /auth/register rejects bad body (400)", async () => {
  const app = await freshApp();

  const res = await app.request("/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "not-an-email", password: "123" }),
  });
  assertEquals(res.status, 400);
});

Deno.test("POST /auth/login rejects wrong password (401) and returns token on valid login (200)", async () => {
  const app = await freshApp();

  await app.request("/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "grace@example.com", password: "password123" }),
  });

  const wrong = await app.request("/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "grace@example.com", password: "wrongpassword" }),
  });
  assertEquals(wrong.status, 401);

  const ok = await app.request("/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "grace@example.com", password: "password123" }),
  });
  assertEquals(ok.status, 200);
  const body = await ok.json();
  assertExists(body.token);
});

