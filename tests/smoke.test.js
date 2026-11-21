"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const server = fs.readFileSync(path.join(root, "server.js"), "utf8");
const admin = fs.readFileSync(path.join(root, "admin.html"), "utf8");
const publicScript = fs.readFileSync(path.join(root, "script.js"), "utf8");

test("server and browser scripts parse", () => {
  assert.doesNotThrow(() => new Function(server));
  const scripts = [...admin.matchAll(new RegExp("<script[^>]*>([\\s\\S]*?)</script>", "gi"))];
  assert.ok(scripts.length > 0, "admin.html must contain an inline script");
  for (const script of scripts) assert.doesNotThrow(() => new Function(script[1]));
  assert.doesNotThrow(() => new Function(publicScript));
});

test("public checkout creates orders without public customer accounts", () => {
  assert.match(server, /pathname === "\/api\/orders"/);
  assert.match(publicScript, /Commander sur le site/);
  assert.match(server, /order_items/);
  assert.doesNotMatch(server, /\/api\/customer\/register/);
});

test("limited stock is reserved with a compare-and-swap update", () => {
  assert.match(server, /stock=eq\." \+ encodeURIComponent\(String\(stockBefore\)\)/);
  assert.match(server, /stock: stockAfter/);
});

test("payment references stay pending until verified", () => {
  assert.match(server, /status: "pending", verified_at: null/);
  assert.match(server, /payment_status === "confirmed"/);
  assert.match(server, /transaction_reference/);
});

test("public payment methods expose only approved account details", () => {
  assert.match(server, /pathname === "\/api\/payment-methods"/);
  assert.match(server, /if \(name === "Airtel Money" \|\| name === "M-Pesa"\)/);
  assert.match(server, /if \(name === "PayPal"\)/);
});

test("invoice creation requires a confirmed payment and private storage", () => {
  assert.match(server, /order\.payment_status !== "confirmed"/);
  assert.match(server, /customer-invoices/);
  assert.match(server, /createInvoiceSignedUrl/);
  assert.match(admin, /Créer \/ télécharger la facture PDF/);
});

test("digital downloads recheck payment and enforce limits", () => {
  const paidCheck = server.indexOf('orders[0].payment_status !== "confirmed"');
  const counter = server.indexOf("let claimed = false");
  assert.ok(paidCheck >= 0 && counter > paidCheck, "payment must be rechecked before consuming a download");
  assert.match(server, /max_downloads: 3/);
  assert.match(server, /7 \* 24 \* 60 \* 60 \* 1000/);
  assert.match(server, /store-products/);
});

test("admin refresh and role checks are present", () => {
  assert.match(server, /pathname === "\/api\/admin\/refresh"/);
  assert.match(server, /allowedRoles = \["admin", "super_admin"\]/);
  assert.match(admin, /drbck_admin_refresh_token/);
  assert.match(admin, /refreshAdminSession/);
});

test("AI media stays private until manual publication", () => {
  assert.match(server, /\/api\/admin\/ai\/description/);
  assert.match(server, /\/api\/admin\/ai\/image/);
  assert.match(server, /status: "draft"/);
  assert.match(admin, /Valider et publier/);
});

test("public product responses never include private file paths", () => {
  const routeStart = server.indexOf('pathname === "/api/products"');
  const routeEnd = server.indexOf("// ----------------------------------------------", routeStart + 30);
  assert.ok(routeStart >= 0);
  const route = server.slice(routeStart, routeEnd);
  assert.doesNotMatch(route, /file_path/);
});

test("checkout uses a non-nested payment panel and prevents duplicate orders", () => {
  assert.match(publicScript, /const paymentForm = document\.createElement\("div"\)/);
  assert.match(publicScript, /paymentSubmit\.addEventListener\("click"/);
  assert.match(publicScript, /let orderCreated = false/);
});

test("public API CORS is restricted to the official GitHub Pages origin", () => {
  assert.match(server, /origin === SITE_ORIGIN/);
  assert.match(server, /https:\/\/drbck-tech-it-pro\.github\.io/);
});

test("manual payment verification is audited and synchronizes the order", () => {
  assert.ok(server.includes("paymentVerifyMatch = pathname.match"));
  assert.match(server, /verification_note/);
  assert.match(server, /payment_status: "confirmed"/);
  assert.match(admin, /Confirmer après vérification/);
  assert.match(admin, /Refuser après vérification/);
});

test("anonymous analytics feed the administrator dashboard", () => {
  assert.match(server, /pathname === "\/api\/events"/);
  assert.match(server, /site_events\?select=id,visitor_id,event_type/);
  assert.match(publicScript, /drbckTrackEvent\("page_view"\)/);
  assert.match(publicScript, /whatsapp_click/);
  assert.match(admin, /Visites du site/);
});

test("rate limits use the proxy-provided client address instead of the first spoofable header", () => {
  assert.match(server, /function getClientIP\(req\)/);
  assert.match(server, /forwarded\[forwarded\.length - 1\]/);
});
