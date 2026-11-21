"use strict";

const http = require("http");
const crypto = require("crypto");

const PORT = process.env.PORT || 3000;

const SITE_ORIGIN = "https://drbck-tech-it-pro.github.io";

const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || "";
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || "";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-6-astra";

const sessions = new Map();
const rateLimits = new Map();

const SESSION_DURATION = 8 * 60 * 60 * 1000;
const MAX_BODY_SIZE = 2 * 1024 * 1024;

// --------------------------------------------------
// REPONSES JSON
// --------------------------------------------------

function sendJSON(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });

  res.end(JSON.stringify(data));
}

// --------------------------------------------------
// CORS
// --------------------------------------------------

function setCors(req, res) {
  const origin = req.headers.origin;

  if (origin === SITE_ORIGIN) {
    res.setHeader("Access-Control-Allow-Origin", SITE_ORIGIN);
    res.setHeader("Vary", "Origin");
  }

  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, POST, PATCH, DELETE, OPTIONS"
  );

  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization"
  );

  res.setHeader("Access-Control-Max-Age", "86400");
}

// --------------------------------------------------
// LECTURE DU CORPS DE LA REQUETE
// --------------------------------------------------

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";

    req.on("data", (chunk) => {
      body += chunk.toString();

      if (body.length > MAX_BODY_SIZE) {
        reject(new Error("Corps de requête trop volumineux."));
        req.destroy();
      }
    });

    req.on("end", () => {
      if (!body) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(new Error("JSON invalide."));
      }
    });

    req.on("error", reject);
  });
}

// --------------------------------------------------
// SUPABASE REST
// --------------------------------------------------

async function supabaseRequest(path, options = {}) {
  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
    throw new Error("Configuration Supabase manquante.");
  }

  const response = await fetch(
    SUPABASE_URL + "/rest/v1/" + path,
    {
      method: options.method || "GET",

      headers: {
        "apikey": SUPABASE_SECRET_KEY,
        "Authorization": "Bearer " + SUPABASE_SECRET_KEY,
        "Content-Type": "application/json",
        "Prefer": options.prefer || "return=representation",
        ...(options.headers || {})
      },

      body: options.body
        ? JSON.stringify(options.body)
        : undefined
    }
  );

  const text = await response.text();

  let data = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch (error) {
    data = text;
  }

  if (!response.ok) {
    console.error("Erreur Supabase :", response.status, data);

    throw new Error(
      (data && data.message) ||
      (data && data.error_description) ||
      "Erreur Supabase."
    );
  }

  return data;
}

async function writeAdminHistory(admin, action, targetType, targetId, details = {}) {
  try {
    await supabaseRequest("admin_history", {
      method: "POST",
      body: {
        admin_id: admin && admin.profile ? admin.profile.user_id : null,
        action,
        target_type: targetType,
        target_id: targetId ? String(targetId) : null,
        details
      },
      prefer: "return=minimal"
    });
  } catch (error) {
    console.error("Échec journalisation administrative :", error.message);
  }
}

function pdfSafeText(value) {
  return String(value == null ? "" : value).normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7E]/g, "?").replace(/([\\()])/g, "\\$1");
}
function buildInvoicePdf(order, items, invoiceNumber) {
  const lines = ["DRBCK TECH.IT.PRO", "Service rapide et fiable a Likasi",
    "FACTURE " + invoiceNumber, "Date : " + new Date().toLocaleDateString("fr-FR"),
    "Client : " + (order.customer_name || "Client"), "E-mail : " + (order.customer_email || "-"),
    "Telephone : " + (order.customer_phone || "-"), "Commande : " + (order.order_number || order.id),
    "Article                         Qte       Prix       Total"];
  for (const item of items) lines.push(String(item.item_name || "Article").slice(0, 30) + "    " +
    Number(item.quantity || 1) + "    " + Number(item.unit_price || 0).toFixed(2) + " USD    " +
    Number(item.total_price || 0).toFixed(2) + " USD");
  lines.push("TOTAL : " + Number(order.total_amount || 0).toFixed(2) + " USD",
    "Paiement : " + (order.payment_status || "pending"), "Merci pour votre confiance. WhatsApp : +243 972 052 103");
  const commands = ["BT", "/F1 10 Tf", "50 790 Td", "14 TL"];
  lines.forEach((line, index) => { if (index) commands.push("T*"); commands.push("(" + pdfSafeText(line) + ") Tj"); });
  commands.push("ET");
  const stream = commands.join("\n");
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Length " + Buffer.byteLength(stream, "ascii") + " >>\nstream\n" + stream + "\nendstream"];
  let pdf = "%PDF-1.4\n"; const offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(pdf, "ascii")); pdf += (index + 1) + " 0 obj\n" + object + "\nendobj\n"; });
  const xrefOffset = Buffer.byteLength(pdf, "ascii");
  pdf += "xref\n0 " + (objects.length + 1) + "\n0000000000 65535 f \n";
  for (let i = 1; i < offsets.length; i++) pdf += String(offsets[i]).padStart(10, "0") + " 00000 n \n";
  pdf += "trailer\n<< /Size " + (objects.length + 1) + " /Root 1 0 R >>\nstartxref\n" + xrefOffset + "\n%%EOF";
  return Buffer.from(pdf, "ascii");
}
async function uploadPrivateInvoice(storagePath, pdfBuffer) {
  const response = await fetch(SUPABASE_URL + "/storage/v1/object/customer-invoices/" +
    storagePath.split("/").map(encodeURIComponent).join("/"), { method: "POST",
      headers: { "apikey": SUPABASE_SECRET_KEY, "Authorization": "Bearer " + SUPABASE_SECRET_KEY,
        "Content-Type": "application/pdf", "x-upsert": "false" }, body: pdfBuffer });
  if (!response.ok) { console.error("Echec stockage facture :", response.status, await response.text());
    throw new Error("Impossible de stocker le PDF de la facture."); }
}
async function createInvoiceSignedUrl(storagePath) {
  const response = await fetch(SUPABASE_URL + "/storage/v1/object/sign/customer-invoices/" +
    storagePath.split("/").map(encodeURIComponent).join("/"), { method: "POST",
      headers: { "apikey": SUPABASE_SECRET_KEY, "Authorization": "Bearer " + SUPABASE_SECRET_KEY,
        "Content-Type": "application/json" }, body: JSON.stringify({ expiresIn: 300 }) });
  const data = await response.json();
  if (!response.ok || !data.signedURL) throw new Error("Impossible de créer le lien sécurisé de la facture.");
  return data.signedURL.startsWith("http") ? data.signedURL : SUPABASE_URL + data.signedURL;
}

// --------------------------------------------------
// AUTHENTIFICATION SUPABASE
// --------------------------------------------------

async function verifySupabaseUser(accessToken) {
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
    throw new Error("Configuration Supabase Auth manquante.");
  }

  const response = await fetch(
    SUPABASE_URL + "/auth/v1/user",
    {
      method: "GET",
      headers: {
        "apikey": SUPABASE_PUBLISHABLE_KEY,
        "Authorization": "Bearer " + accessToken
      }
    }
  );

  if (!response.ok) {
    return null;
  }

  return await response.json();
}

// --------------------------------------------------
// VERIFICATION DU COMPTE ADMINISTRATEUR
// --------------------------------------------------

async function verifyAdmin(accessToken) {
  const user = await verifySupabaseUser(accessToken);

  if (!user || !user.id) {
    return null;
  }

  const profiles = await supabaseRequest(
    "admin_profiles?select=*&user_id=eq." +
    encodeURIComponent(user.id) +
    "&limit=1"
  );

  if (!Array.isArray(profiles) || profiles.length === 0) {
    return null;
  }

  const profile = profiles[0];

  const allowedRoles = ["admin", "super_admin"];

  if (!allowedRoles.includes(profile.role)) {
    return null;
  }

  if (profile.active !== true) {
    return null;
  }

  return {
    user: user,
    profile: profile
  };
}

// --------------------------------------------------
// RECUPERATION DU TOKEN ADMIN
// --------------------------------------------------

function getBearerToken(req) {
  const header = req.headers.authorization || "";

  if (!header.startsWith("Bearer ")) {
    return null;
  }

  return header.substring(7).trim();
}

// --------------------------------------------------
// LIMITATION DES REQUETES
// --------------------------------------------------

function checkRateLimit(key, maxRequests, windowMs) {
  const now = Date.now();

  let record = rateLimits.get(key);

  if (!record || now > record.resetAt) {
    record = {
      count: 0,
      resetAt: now + windowMs
    };
  }

  record.count += 1;
  rateLimits.set(key, record);

  return record.count <= maxRequests;
}

// --------------------------------------------------
// RECUPERATION DES SERVICES PUBLIES
// --------------------------------------------------

async function getPublicServices() {
  return await supabaseRequest(
    "services?select=id,nom,description,prix,photo_url,actif,publication_status,created_at&actif=eq.true&publication_status=eq.published&order=created_at.desc"
  );
}

// --------------------------------------------------
// INSTRUCTIONS DE DRBCK TECH IA
// --------------------------------------------------

function buildAIInstructions(services) {
  const serviceList = JSON.stringify(services || []);

  return [
    "Tu es DRBCK TECH IA.",
    "Tu es l'assistant officiel de DRBCK TECH.IT.PRO.",
    "L'entreprise est située à Likasi, en République démocratique du Congo.",
    "Réponds toujours en français.",
    "Sois poli, simple, professionnel et précis.",
    "Ne dis jamais que tu es ChatGPT.",
    "Ne prétends jamais être un humain.",
    "Présente les services et les prix uniquement à partir de la liste fournie.",
    "N'invente jamais un prix.",
    "Si un prix n'est pas disponible, dis au client de contacter l'entreprise.",
    "Pour contacter l'entreprise sur WhatsApp : +243 972 052 103.",
    "Voici les services actuellement publiés dans la base de données :",
    serviceList
  ].join("\n");
}

// --------------------------------------------------
// EXTRACTION DE LA REPONSE OPENAI
// --------------------------------------------------

function extractOpenAIText(data) {
  if (data && typeof data.output_text === "string") {
    return data.output_text;
  }

  let result = "";

  if (data && Array.isArray(data.output)) {
    for (const item of data.output) {
      if (!Array.isArray(item.content)) {
        continue;
      }

      for (const part of item.content) {
        if (
          part.type === "output_text" &&
          typeof part.text === "string"
        ) {
          result += part.text;
        }
      }
    }
  }

  return result;
}

// --------------------------------------------------
// SERVEUR HTTP
// --------------------------------------------------

const server = http.createServer(async (req, res) => {
  setCors(req, res);

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(
    req.url,
    "http://localhost:" + PORT
  );

  const pathname = url.pathname;

  try {

    // ----------------------------------------------
    // PAGE DE VERIFICATION DU SERVEUR
    // ----------------------------------------------

    if (req.method === "GET" && pathname === "/") {
      sendJSON(res, 200, {
        success: true,
        message: "Serveur DRBCK TECH.IT.PRO opérationnel."
      });

      return;
    }


    const publicDownloadMatch = pathname.match(new RegExp("^/api/download/([0-9a-fA-F-]{36})$"));
    if (req.method === "GET" && publicDownloadMatch) {
      const token = publicDownloadMatch[1];
      const tokenRows = await supabaseRequest("downloads?select=id,order_item_id,access_token,max_downloads,downloads_count,expires_at&access_token=eq." +
        encodeURIComponent(token) + "&limit=1");
      if (!Array.isArray(tokenRows) || !tokenRows.length) {
        sendJSON(res, 404, { success: false, message: "Lien de téléchargement invalide." }); return;
      }
      const record = tokenRows[0];
      const now = new Date();
      if (!record.expires_at || new Date(record.expires_at).getTime() <= now.getTime()) {
        sendJSON(res, 410, { success: false, message: "Ce lien de téléchargement a expiré." }); return;
      }
      const maxDownloads = Number(record.max_downloads || 0);
      let claimed = false;
      for (let attempt = 0; attempt < 3 && !claimed; attempt++) {
        const count = Number(record.downloads_count || 0);
        if (count >= maxDownloads) {
          sendJSON(res, 410, { success: false, message: "La limite de téléchargements est atteinte." }); return;
        }
        const updated = await supabaseRequest("downloads?id=eq." + encodeURIComponent(record.id) +
          "&downloads_count=eq." + count + "&expires_at=gt." + encodeURIComponent(now.toISOString()), {
            method: "PATCH", body: { downloads_count: count + 1 }
          });
        if (Array.isArray(updated) && updated.length) claimed = true;
        else {
          const refreshed = await supabaseRequest("downloads?select=id,order_item_id,access_token,max_downloads,downloads_count,expires_at&id=eq." +
            encodeURIComponent(record.id) + "&limit=1");
          if (!Array.isArray(refreshed) || !refreshed.length) break;
          Object.assign(record, refreshed[0]);
        }
      }
      if (!claimed) {
        sendJSON(res, 409, { success: false, message: "Lien déjà utilisé simultanément. Réessayez." }); return;
      }
      const items = await supabaseRequest("order_items?select=id,product_id,item_name&id=eq." +
        encodeURIComponent(record.order_item_id) + "&limit=1");
      if (!Array.isArray(items) || !items.length || !items[0].product_id) {
        sendJSON(res, 404, { success: false, message: "Fichier numérique introuvable." }); return;
      }
      const products = await supabaseRequest("products?select=id,name,product_type,file_path&id=eq." +
        encodeURIComponent(items[0].product_id) + "&limit=1");
      if (!Array.isArray(products) || !products.length || products[0].product_type !== "digital" || !products[0].file_path) {
        sendJSON(res, 404, { success: false, message: "Fichier numérique indisponible." }); return;
      }
      let storagePath = String(products[0].file_path);
      if (storagePath.startsWith("/")) storagePath = storagePath.slice(1);
      const signedResponse = await fetch(SUPABASE_URL + "/storage/v1/object/sign/store-products/" +
        storagePath.split("/").map(encodeURIComponent).join("/"), {
          method: "POST",
          headers: { "apikey": SUPABASE_SECRET_KEY, "Authorization": "Bearer " + SUPABASE_SECRET_KEY,
            "Content-Type": "application/json" },
          body: JSON.stringify({ expiresIn: 60 })
        });
      const signedData = await signedResponse.json();
      if (!signedResponse.ok || !signedData.signedURL) {
        sendJSON(res, 502, { success: false, message: "Le fichier est temporairement indisponible." }); return;
      }
      const signedUrl = signedData.signedURL.startsWith("http") ? signedData.signedURL : SUPABASE_URL + signedData.signedURL;
      res.writeHead(302, { "Location": signedUrl, "Cache-Control": "no-store" });
      res.end();
      return;
    }


    // ----------------------------------------------
    // COMMANDE PUBLIQUE DE PRODUIT (SANS COMPTE CLIENT)
    // ----------------------------------------------
    if (req.method === "POST" && pathname === "/api/orders") {
      const clientIP = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
        req.socket.remoteAddress || "unknown";
      if (!checkRateLimit("public-order:" + clientIP, 6, 60 * 60 * 1000)) {
        sendJSON(res, 429, { success: false, message: "Trop de commandes envoyées. Réessayez plus tard." });
        return;
      }
      const body = await readBody(req);
      const productId = String(body.product_id || "");
      const customerName = String(body.customer_name || "").trim().slice(0, 120);
      const customerPhone = String(body.customer_phone || "").trim().slice(0, 40);
      const customerEmail = String(body.customer_email || "").trim().slice(0, 180);
      const quantity = Number(body.quantity);
      if (!/^[0-9a-fA-F-]{36}$/.test(productId) || !customerName || !customerPhone ||
          !Number.isInteger(quantity) || quantity < 1 || quantity > 50) {
        sendJSON(res, 400, { success: false, message: "Produit, nom, téléphone et quantité valide sont obligatoires." });
        return;
      }
      if (customerEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail)) {
        sendJSON(res, 400, { success: false, message: "Adresse e-mail invalide." });
        return;
      }
      const products = await supabaseRequest("products?select=id,name,price,currency,product_type,stock,active,publication_status&id=eq." +
        encodeURIComponent(productId) + "&limit=1");
      if (!Array.isArray(products) || !products.length || products[0].active !== true ||
          products[0].publication_status !== "published") {
        sendJSON(res, 404, { success: false, message: "Ce produit n'est plus disponible." });
        return;
      }
      const product = products[0];
      if (product.stock !== null && product.stock !== undefined && Number(product.stock) < quantity) {
        sendJSON(res, 409, { success: false, message: "Stock insuffisant. Contactez-nous pour vérifier la disponibilité." });
        return;
      }
      const unitPrice = Number(product.price);
      if (!Number.isFinite(unitPrice) || unitPrice < 0) {
        sendJSON(res, 409, { success: false, message: "Le prix de ce produit doit être vérifié par notre équipe." });
        return;
      }
      const total = Math.round(unitPrice * quantity * 100) / 100;
      const orderNumber = "DRBCK-" + new Date().toISOString().slice(0, 10).replace(/-/g, "") +
        "-" + crypto.randomBytes(4).toString("hex").toUpperCase();
      const created = await supabaseRequest("orders", { method: "POST", body: {
        order_number: orderNumber, customer_name: customerName,
        customer_email: customerEmail || null, customer_phone: customerPhone,
        source: "website", total_amount: total, currency: product.currency || "USD",
        status: "pending", payment_status: "pending", delivery_status: "pending"
      }});
      const order = Array.isArray(created) ? created[0] : created;
      try {
        await supabaseRequest("order_items", { method: "POST", body: {
          order_id: order.id, product_id: product.id, item_name: product.name,
          quantity, unit_price: unitPrice, total_price: total
        }});
      } catch (error) {
        await supabaseRequest("orders?id=eq." + encodeURIComponent(order.id), {
          method: "DELETE", prefer: "return=minimal"
        }).catch(() => {});
        throw error;
      }
      sendJSON(res, 201, { success: true, message: "Commande enregistrée. Le paiement reste en attente jusqu'à sa vérification par DRBCK TECH.IT.PRO.",
        order: { id: order.id, order_number: orderNumber, total_amount: total,
          currency: product.currency || "USD", payment_status: "pending" } });
      return;
    }


    // ----------------------------------------------
    // MOYENS DE PAIEMENT PUBLICS (CHAMPS AUTORISES)
    // ----------------------------------------------
    if (req.method === "GET" && pathname === "/api/payment-methods") {
      const rows = await supabaseRequest("payment_methods?select=name,account_details,instructions&enabled=eq.true&order=created_at.asc");
      const methods = (Array.isArray(rows) ? rows : []).map(row => {
        const name = String(row.name || "");
        const details = row.account_details && typeof row.account_details === "object" ? row.account_details : {};
        let account = {};
        if (name === "Airtel Money" || name === "M-Pesa") account.phone = String(details.phone || "");
        if (name === "PayPal") account.email = String(details.email || "");
        return { name, account_details: account, instructions: String(row.instructions || "").slice(0, 1000) };
      });
      sendJSON(res, 200, { success: true, payment_methods: methods });
      return;
    }

    // ----------------------------------------------
    // ENREGISTRER UNE REFERENCE DE PAIEMENT CLIENT
    // ----------------------------------------------
    const paymentReferenceMatch = pathname.match(new RegExp("^/api/orders/([0-9a-fA-F-]{36})/payment-reference$"));
    if (req.method === "POST" && paymentReferenceMatch) {
      const clientIP = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
        req.socket.remoteAddress || "unknown";
      if (!checkRateLimit("payment-reference:" + clientIP, 10, 60 * 60 * 1000)) {
        sendJSON(res, 429, { success: false, message: "Trop de tentatives. Réessayez plus tard." }); return;
      }
      const orderId = paymentReferenceMatch[1];
      const body = await readBody(req);
      const method = String(body.method || "").trim();
      const reference = String(body.transaction_reference || "").trim().slice(0, 120);
      if (!reference || reference.length < 4) {
        sendJSON(res, 400, { success: false, message: "Référence de transaction obligatoire." }); return;
      }
      const [orders, methods, duplicateReferences] = await Promise.all([
        supabaseRequest("orders?select=id,total_amount,currency,payment_status&id=eq." + encodeURIComponent(orderId) + "&limit=1"),
        supabaseRequest("payment_methods?select=name,enabled&enabled=eq.true"),
        supabaseRequest("payments?select=id&method=eq." + encodeURIComponent(method) +
          "&transaction_reference=eq." + encodeURIComponent(reference) + "&limit=1")
      ]);
      if (!Array.isArray(orders) || !orders.length) {
        sendJSON(res, 404, { success: false, message: "Commande introuvable." }); return;
      }
      const order = orders[0];
      if (order.payment_status === "confirmed") {
        sendJSON(res, 409, { success: false, message: "Cette commande est déjà payée." }); return;
      }
      if (!Array.isArray(methods) || !methods.some(row => row.name === method && row.enabled === true)) {
        sendJSON(res, 400, { success: false, message: "Moyen de paiement indisponible." }); return;
      }
      if (Array.isArray(duplicateReferences) && duplicateReferences.length) {
        sendJSON(res, 409, { success: false, message: "Cette référence de transaction a déjà été soumise." }); return;
      }
      const created = await supabaseRequest("payments", { method: "POST", body: {
        order_id: orderId, method, transaction_reference: reference,
        amount: Number(order.total_amount), currency: order.currency || "USD",
        status: "pending", verified_at: null
      }});
      const payment = Array.isArray(created) ? created[0] : created;
      sendJSON(res, 201, { success: true, message: "Référence enregistrée. Le paiement reste en attente jusqu'à vérification réelle.", payment: {
        id: payment && payment.id, status: "pending", method
      }});
      return;
    }

    // ----------------------------------------------
    // SERVICES PUBLICS
    // ----------------------------------------------

    if (
      req.method === "GET" &&
      pathname === "/api/services"
    ) {
      const services = await getPublicServices();

      sendJSON(res, 200, {
        success: true,
        services: services
      });

      return;
    }

    // ----------------------------------------------
    // PRODUITS PUBLICS (SANS CHEMINS DE FICHIERS PRIVES)
    // ----------------------------------------------

    if (req.method === "GET" && pathname === "/api/products") {
      const products = await supabaseRequest(
        "products?select=id,name,description,price,currency,product_type,image_url,stock,created_at&active=eq.true&publication_status=eq.published&order=created_at.desc"
      );

      sendJSON(res, 200, {
        success: true,
        products: Array.isArray(products) ? products : []
      });

      return;
    }

    // ----------------------------------------------
    // CONNEXION ADMINISTRATEUR SUPABASE
    // ----------------------------------------------

    if (
      req.method === "POST" &&
      pathname === "/api/admin/login"
    ) {
      const forwardedIP = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
      const clientIP = forwardedIP || req.socket.remoteAddress || "unknown";
      if (!checkRateLimit("admin-login:" + clientIP, 8, 15 * 60 * 1000)) {
        sendJSON(res, 429, {
          success: false,
          message: "Trop de tentatives. Réessayez dans 15 minutes."
        });
        return;
      }

      const body = await readBody(req);

      if (!body.email || !body.password) {
        sendJSON(res, 400, {
          success: false,
          message: "Adresse e-mail et mot de passe obligatoires."
        });

        return;
      }

      if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
        sendJSON(res, 500, {
          success: false,
          message: "Configuration Supabase Auth manquante."
        });

        return;
      }

      const response = await fetch(
        SUPABASE_URL + "/auth/v1/token?grant_type=password",
        {
          method: "POST",

          headers: {
            "apikey": SUPABASE_PUBLISHABLE_KEY,
            "Content-Type": "application/json"
          },

          body: JSON.stringify({
            email: body.email,
            password: body.password
          })
        }
      );

      const authData = await response.json();

      if (!response.ok || !authData.access_token) {
        sendJSON(res, 401, {
          success: false,
          message: "Identifiants incorrects."
        });

        return;
      }

      const admin = await verifyAdmin(authData.access_token);

      if (!admin) {
        sendJSON(res, 403, {
          success: false,
          message: "Accès administrateur refusé."
        });

        return;
      }

      sendJSON(res, 200, {
        success: true,
        message: "Connexion administrateur réussie.",
        access_token: authData.access_token,
        refresh_token: authData.refresh_token,
        expires_in: authData.expires_in,
        user: admin.user,
        profile: admin.profile
      });

      return;
    }

    // ----------------------------------------------
    // VERIFICATION DE LA SESSION ADMIN
    // ----------------------------------------------

    if (
      req.method === "GET" &&
      pathname === "/api/admin/me"
    ) {
      const token = getBearerToken(req);

      if (!token) {
        sendJSON(res, 401, {
          success: false,
          message: "Authentification nécessaire."
        });

        return;
      }

      const admin = await verifyAdmin(token);

      if (!admin) {
        sendJSON(res, 403, {
          success: false,
          message: "Session administrateur invalide."
        });

        return;
      }

      sendJSON(res, 200, {
        success: true,
        user: admin.user,
        profile: admin.profile
      });

      return;
    }

    // ----------------------------------------------
    // DECONNEXION ET REVOCATION DU JETON
    // ----------------------------------------------

    if (req.method === "POST" && pathname === "/api/admin/logout") {
      const token = getBearerToken(req);
      const response = await fetch(SUPABASE_URL + "/auth/v1/logout", {
        method: "POST",
        headers: {
          "apikey": SUPABASE_PUBLISHABLE_KEY,
          "Authorization": "Bearer " + token
        }
      });

      if (!response.ok) {
        sendJSON(res, 502, {
          success: false,
          message: "La révocation de la session a échoué. Réessayez."
        });
        return;
      }

      sendJSON(res, 200, { success: true, message: "Session révoquée." });
      return;
    }

    // ----------------------------------------------
    // VERIFICATION POUR LES AUTRES ROUTES ADMIN
    // ----------------------------------------------

    if (pathname.startsWith("/api/admin/")) {
      const token = getBearerToken(req);

      if (!token) {
        sendJSON(res, 401, {
          success: false,
          message: "Authentification nécessaire."
        });

        return;
      }

      const admin = await verifyAdmin(token);

      if (!admin) {
        sendJSON(res, 403, {
          success: false,
          message: "Accès administrateur refusé."
        });

        return;
      }

      // --------------------------------------------
      // VUE D'ENSEMBLE ADMINISTRATEUR
      // --------------------------------------------

      if (req.method === "GET" && pathname === "/api/admin/overview") {
        const tables = [
          "services?select=id&limit=1000",
          "products?select=id&limit=1000",
          "orders?select=id,status,payment_status,total_amount&limit=1000",
          "payments?select=id,status,amount&limit=1000",
          "media_library?select=id&limit=1000",
          "invoices?select=id&limit=1000"
        ];

        const [services, products, orders, payments, media, invoices] =
          await Promise.all(tables.map(path => supabaseRequest(path)));

        const safeArray = value => Array.isArray(value) ? value : [];
        const orderRows = safeArray(orders);
        const paymentRows = safeArray(payments);

        const sum = rows => rows.reduce((total, row) => {
          const amount = Number(row.amount ?? row.total_amount);
          return total + (Number.isFinite(amount) ? amount : 0);
        }, 0);

        sendJSON(res, 200, {
          success: true,
          overview: {
            services: safeArray(services).length,
            products: safeArray(products).length,
            orders: orderRows.length,
            pendingOrders: orderRows.filter(row => row.status === "pending").length,
            payments: paymentRows.length,
            confirmedPayments: paymentRows.filter(row => row.status === "confirmed").length,
            pendingPayments: paymentRows.filter(row => row.status === "pending").length,
            confirmedAmount: sum(paymentRows.filter(row => row.status === "confirmed")),
            media: safeArray(media).length,
            invoices: safeArray(invoices).length,
            sampleLimited: true
          }
        });

        return;
      }

      // --------------------------------------------
      // LECTURE DES MODULES ADMIN (DONNEES REELLES)
      // --------------------------------------------

      const paymentMethodMatch = pathname.match(/^\/api\/admin\/payment-methods\/([0-9a-fA-F-]{36})$/);
      if (paymentMethodMatch && req.method === "PATCH") {
        const paymentMethodId = paymentMethodMatch[1];
        const body = await readBody(req);
        const updates = {};
        if (Object.prototype.hasOwnProperty.call(body, "enabled")) {
          if (typeof body.enabled !== "boolean") {
            sendJSON(res, 400, { success: false, message: "État du moyen de paiement invalide." });
            return;
          }
          updates.enabled = body.enabled;
        }
        if (Object.prototype.hasOwnProperty.call(body, "instructions")) {
          if (typeof body.instructions !== "string" || body.instructions.length > 3000) {
            sendJSON(res, 400, { success: false, message: "Instructions invalides (3 000 caractères maximum)." });
            return;
          }
          updates.instructions = body.instructions.trim();
        }
        if (Object.prototype.hasOwnProperty.call(body, "account_details")) {
          if (!body.account_details || typeof body.account_details !== "object" || Array.isArray(body.account_details)) {
            sendJSON(res, 400, { success: false, message: "Les coordonnées doivent être un objet JSON." });
            return;
          }
          updates.account_details = body.account_details;
        }
        if (!Object.keys(updates).length) {
          sendJSON(res, 400, { success: false, message: "Aucune modification reçue." });
          return;
        }
        updates.updated_at = new Date().toISOString();
        const changed = await supabaseRequest("payment_methods?id=eq." + encodeURIComponent(paymentMethodId), {
          method: "PATCH", body: updates
        });
        if (!Array.isArray(changed) || !changed.length) {
          sendJSON(res, 404, { success: false, message: "Moyen de paiement introuvable." });
          return;
        }
        await writeAdminHistory(admin, "payment_method.updated", "payment_method", paymentMethodId, {
          fields: Object.keys(updates).filter(key => key !== "account_details"),
          accountDetailsUpdated: Object.prototype.hasOwnProperty.call(updates, "account_details")
        });
        sendJSON(res, 200, { success: true, paymentMethod: changed[0] });
        return;
      }

      const readOnlyModules = {
        "/api/admin/products": {
          table: "products",
          select: "id,name,description,price,currency,product_type,image_url,stock,active,publication_status,created_at,updated_at",
          order: "created_at.desc",
          key: "products"
        },
        "/api/admin/orders": {
          table: "orders",
          select: "id,order_number,customer_name,customer_email,customer_phone,source,total_amount,currency,status,payment_status,delivery_status,created_at,updated_at",
          order: "created_at.desc",
          key: "orders"
        },
        "/api/admin/payments": {
          table: "payments",
          select: "id,order_id,method,transaction_reference,amount,currency,status,verified_at,created_at",
          order: "created_at.desc",
          key: "payments"
        },
        "/api/admin/media": {
          table: "media_library",
          select: "id,file_name,file_type,storage_path,public_url,source,status,created_at",
          order: "created_at.desc",
          key: "media"
        },
        "/api/admin/invoices": {
          table: "invoices",
          select: "id,order_id,invoice_number,customer_name,customer_email,amount,currency,pdf_path,status,created_at",
          order: "created_at.desc",
          key: "invoices"
        },
        "/api/admin/settings": {
          table: "site_settings",
          select: "id,setting_key,setting_value,updated_at",
          order: "setting_key.asc",
          key: "settings"
        },
        "/api/admin/history": {
          table: "admin_history",
          select: "id,admin_id,action,target_type,target_id,details,created_at",
          order: "created_at.desc",
          key: "history"
        },
        "/api/admin/shipments": {
          table: "shipments",
          select: "id,order_id,delivery_address,tracking_number,delivery_status,notes,created_at,updated_at",
          order: "created_at.desc",
          key: "shipments"
        },
        "/api/admin/payment-methods": {
          table: "payment_methods",
          select: "id,name,account_details,instructions,enabled,created_at,updated_at",
          order: "created_at.desc",
          key: "paymentMethods"
        },
        "/api/admin/events": {
          table: "site_events",
          select: "id,visitor_id,event_type,page_path,product_id,metadata,created_at",
          order: "created_at.desc",
          key: "events"
        }
      };

      if (req.method === "GET" && readOnlyModules[pathname]) {
        const module = readOnlyModules[pathname];
        const rows = await supabaseRequest(
          module.table + "?select=" + module.select +
          "&order=" + module.order + "&limit=100"
        );

        sendJSON(res, 200, {
          success: true,
          [module.key]: Array.isArray(rows) ? rows : [],
          limit: 100
        });
        return;
      }

      // Les clients sont calculés à partir des commandes : aucun compte client public.
      if (req.method === "GET" && pathname === "/api/admin/customers") {
        const rows = await supabaseRequest(
          "orders?select=customer_name,customer_email,customer_phone,total_amount,currency,created_at&order=created_at.desc&limit=1000"
        );
        const customers = new Map();

        for (const order of (Array.isArray(rows) ? rows : [])) {
          const email = String(order.customer_email || "").trim().toLowerCase();
          const phone = String(order.customer_phone || "").trim();
          const key = email || phone;
          if (!key) continue;

          if (!customers.has(key)) {
            customers.set(key, {
              customer_name: order.customer_name || "",
              customer_email: order.customer_email || "",
              customer_phone: phone,
              orders_count: 0,
              total_spent: 0,
              currency: order.currency || "USD",
              last_order_at: order.created_at || null
            });
          }

          const customer = customers.get(key);
          customer.orders_count += 1;
          const amount = Number(order.total_amount);
          if (Number.isFinite(amount)) customer.total_spent += amount;
          if (!customer.customer_name && order.customer_name) {
            customer.customer_name = order.customer_name;
          }
        }

        sendJSON(res, 200, {
          success: true,
          customers: Array.from(customers.values()),
          derivedFromOrders: true,
          sourceRowsLimit: 1000
        });
        return;
      }

      // --------------------------------------------
      // MISE A JOUR SECURISEE DES COMMANDES
      // --------------------------------------------

      const orderDetailsMatch = pathname.match(/^\/api\/admin\/orders\/([0-9a-fA-F-]{36})\/details$/);
      if (orderDetailsMatch && req.method === "GET") {
        const orderId = orderDetailsMatch[1];
        const [orders, items, payments, shipments] = await Promise.all([
          supabaseRequest("orders?select=id,order_number,customer_name,customer_email,customer_phone,source,total_amount,currency,status,payment_status,delivery_status,created_at,updated_at&id=eq." + encodeURIComponent(orderId) + "&limit=1"),
          supabaseRequest("order_items?select=id,product_id,item_name,quantity,unit_price,total_price,created_at&order_id=eq." + encodeURIComponent(orderId) + "&order=created_at.asc"),
          supabaseRequest("payments?select=id,method,transaction_reference,amount,currency,status,verified_at,created_at&order_id=eq." + encodeURIComponent(orderId) + "&order=created_at.desc"),
          supabaseRequest("shipments?select=id,delivery_address,tracking_number,delivery_status,notes,created_at,updated_at&order_id=eq." + encodeURIComponent(orderId) + "&order=created_at.desc")
        ]);

        if (!Array.isArray(orders) || !orders.length) {
          sendJSON(res, 404, { success: false, message: "Commande introuvable." });
          return;
        }

        sendJSON(res, 200, {
          success: true,
          order: orders[0],
          items: Array.isArray(items) ? items : [],
          payments: Array.isArray(payments) ? payments : [],
          shipments: Array.isArray(shipments) ? shipments : []
        });
        return;
      }

      const orderMatch = pathname.match(/^\/api\/admin\/orders\/([0-9a-fA-F-]{36})$/);
      if (orderMatch && req.method === "PATCH") {
        const orderId = orderMatch[1];
        const body = await readBody(req);
        const updates = {};
        const allowedOrderStatuses = ["pending", "processing", "completed", "cancelled", "refunded"];
        const allowedDeliveryStatuses = ["pending", "preparing", "shipped", "delivered", "returned"];

        if (Object.prototype.hasOwnProperty.call(body, "status")) {
          if (!allowedOrderStatuses.includes(body.status)) {
            sendJSON(res, 400, { success: false, message: "Statut de commande invalide." });
            return;
          }
          updates.status = body.status;
        }
        if (Object.prototype.hasOwnProperty.call(body, "delivery_status")) {
          if (!allowedDeliveryStatuses.includes(body.delivery_status)) {
            sendJSON(res, 400, { success: false, message: "Statut de livraison invalide." });
            return;
          }
          updates.delivery_status = body.delivery_status;
        }
        if (!Object.keys(updates).length) {
          sendJSON(res, 400, { success: false, message: "Aucun changement de commande reçu." });
          return;
        }
        updates.updated_at = new Date().toISOString();
        const updated = await supabaseRequest("orders?id=eq." + encodeURIComponent(orderId), { method: "PATCH", body: updates });
        await writeAdminHistory(admin, "order.updated", "order", orderId, { fields: Object.keys(updates) });
        sendJSON(res, 200, { success: true, message: "Commande mise à jour.", order: updated });
        return;
      }

      // --------------------------------------------
      // CREATION D'UNE LIVRAISON
      // --------------------------------------------




      // ASSISTANT IA ADMINISTRATEUR : DESCRIPTION DE PRODUIT OU SERVICE
      if (req.method === "POST" && pathname === "/api/admin/ai/description") {
        if (!checkRateLimit("admin-ai-description:" + admin.user.id, 10, 60 * 60 * 1000)) {
          sendJSON(res, 429, { success: false, message: "Limite de génération atteinte. Réessayez plus tard." }); return;
        }
        const body = await readBody(req);
        const prompt = String(body.prompt || "").trim().slice(0, 2000);
        const kind = body.kind === "service" ? "service informatique" : "produit";
        if (!prompt) { sendJSON(res, 400, { success: false, message: "Décrivez le produit ou le service." }); return; }
        if (!OPENAI_API_KEY) { sendJSON(res, 503, { success: false, message: "La clé OpenAI n'est pas configurée." }); return; }
        const response = await fetch("https://api.openai.com/v1/responses", {
          method: "POST",
          headers: { "Authorization": "Bearer " + OPENAI_API_KEY, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: OPENAI_MODEL,
            instructions: "Tu es l'assistant rédactionnel interne de DRBCK TECH.IT.PRO à Likasi. Rédige en français une description claire, professionnelle et honnête. N'invente aucune caractéristique, garantie, compatibilité ou prix. Réponds uniquement par la description prête à publier.",
            input: "Type : " + kind + "\nInformations fournies : " + prompt
          })
        });
        const data = await response.json();
        if (!response.ok) {
          console.error("Erreur IA description :", response.status, data);
          sendJSON(res, response.status === 429 ? 503 : 502, { success: false,
            message: "Génération indisponible. Vérifiez le crédit et les autorisations du compte OpenAI." }); return;
        }
        const description = extractOpenAIText(data);
        if (!description) { sendJSON(res, 502, { success: false, message: "Aucune description reçue." }); return; }
        await writeAdminHistory(admin, "ai.description.generated", kind, null, { promptLength: prompt.length });
        sendJSON(res, 200, { success: true, description });
        return;
      }

      // GENERATION D'IMAGE IA : STOCKAGE EN BROUILLON PRIVE
      if (req.method === "POST" && pathname === "/api/admin/ai/image") {
        if (!checkRateLimit("admin-ai-image:" + admin.user.id, 3, 60 * 60 * 1000)) {
          sendJSON(res, 429, { success: false, message: "Limite de génération d'images atteinte. Réessayez plus tard." }); return;
        }
        const body = await readBody(req);
        const prompt = String(body.prompt || "").trim().slice(0, 2500);
        if (!prompt) { sendJSON(res, 400, { success: false, message: "Décrivez l'image à créer." }); return; }
        if (!OPENAI_API_KEY) { sendJSON(res, 503, { success: false, message: "La clé OpenAI n'est pas configurée." }); return; }
        const generated = await fetch("https://api.openai.com/v1/images/generations", {
          method: "POST",
          headers: { "Authorization": "Bearer " + OPENAI_API_KEY, "Content-Type": "application/json" },
          body: JSON.stringify({ model: "gpt-image-2.6-flare", prompt,
            n: 1, size: "1024x1024", output_format: "png" })
        });
        const imageData = await generated.json();
        if (!generated.ok) {
          console.error("Erreur IA image :", generated.status, imageData);
          sendJSON(res, generated.status === 429 ? 503 : 502, { success: false,
            message: "Génération d'image indisponible. Vérifiez le crédit et l'accès aux modèles d'image OpenAI." }); return;
        }
        const encoded = imageData && imageData.data && imageData.data[0] && imageData.data[0].b64_json;
        if (!encoded) { sendJSON(res, 502, { success: false, message: "Aucune image reçue du fournisseur." }); return; }
        const imageBuffer = Buffer.from(encoded, "base64");
        if (!imageBuffer.length || imageBuffer.length > 12 * 1024 * 1024) {
          sendJSON(res, 502, { success: false, message: "Taille d'image invalide." }); return;
        }
        const fileName = "ai-" + crypto.randomUUID() + ".png";
        const storagePath = "generated/" + fileName;
        const upload = await fetch(SUPABASE_URL + "/storage/v1/object/admin-media/" + storagePath, {
          method: "POST",
          headers: { "apikey": SUPABASE_SECRET_KEY, "Authorization": "Bearer " + SUPABASE_SECRET_KEY,
            "Content-Type": "image/png", "x-upsert": "false" },
          body: imageBuffer
        });
        if (!upload.ok) {
          console.error("Echec stockage image IA :", upload.status, await upload.text());
          sendJSON(res, 502, { success: false, message: "Image générée, mais impossible de l'enregistrer dans la médiathèque." }); return;
        }
        let media;
        try {
          const inserted = await supabaseRequest("media_library", { method: "POST", body: {
            file_name: fileName, file_type: "image/png", storage_path: storagePath,
            public_url: null, source: "ai", status: "draft"
          }});
          media = Array.isArray(inserted) ? inserted[0] : inserted;
        } catch (error) {
          await fetch(SUPABASE_URL + "/storage/v1/object/admin-media/" + storagePath, {
            method: "DELETE", headers: { "apikey": SUPABASE_SECRET_KEY, "Authorization": "Bearer " + SUPABASE_SECRET_KEY }
          }).catch(() => {});
          throw error;
        }
        const signed = await fetch(SUPABASE_URL + "/storage/v1/object/sign/admin-media/" + storagePath, {
          method: "POST",
          headers: { "apikey": SUPABASE_SECRET_KEY, "Authorization": "Bearer " + SUPABASE_SECRET_KEY,
            "Content-Type": "application/json" },
          body: JSON.stringify({ expiresIn: 3600 })
        });
        const signedData = await signed.json();
        if (!signed.ok || !signedData.signedURL) {
          sendJSON(res, 502, { success: false, message: "Image enregistrée en brouillon, mais aperçu temporairement indisponible.", media }); return;
        }
        const previewUrl = signedData.signedURL.startsWith("http") ? signedData.signedURL : SUPABASE_URL + signedData.signedURL;
        await writeAdminHistory(admin, "ai.image.generated", "media", media && media.id, { file_name: fileName, status: "draft" });
        sendJSON(res, 201, { success: true, message: "Image générée et enregistrée en brouillon. Elle n'est pas publiée.", media, preview_url: previewUrl });
        return;
      }

      const digitalDownloadsMatch = pathname.match(new RegExp("^/api/admin/orders/([0-9a-fA-F-]{36})/downloads$"));
      if (digitalDownloadsMatch && req.method === "POST") {
        const orderId = digitalDownloadsMatch[1];
        const orders = await supabaseRequest("orders?select=id,payment_status&id=eq." + encodeURIComponent(orderId) + "&limit=1");
        if (!Array.isArray(orders) || !orders.length) {
          sendJSON(res, 404, { success: false, message: "Commande introuvable." }); return;
        }
        if (orders[0].payment_status !== "confirmed") {
          sendJSON(res, 409, { success: false, message: "Les téléchargements sont disponibles après vérification réelle du paiement." }); return;
        }
        const items = await supabaseRequest("order_items?select=id,product_id,item_name&order_id=eq." + encodeURIComponent(orderId));
        const links = [];
        for (const item of (Array.isArray(items) ? items : [])) {
          if (!item.product_id) continue;
          const products = await supabaseRequest("products?select=id,name,product_type,file_path&id=eq." +
            encodeURIComponent(item.product_id) + "&limit=1");
          if (!Array.isArray(products) || !products.length || products[0].product_type !== "digital" || !products[0].file_path) continue;
          const accessToken = crypto.randomUUID();
          const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
          await supabaseRequest("downloads", { method: "POST", body: {
            order_item_id: item.id, access_token: accessToken, max_downloads: 3,
            downloads_count: 0, expires_at: expiresAt
          }});
          links.push({ item_name: item.item_name || products[0].name,
            url: "https://drbck-tech-it-pro.onrender.com/api/download/" + accessToken,
            expires_at: expiresAt, max_downloads: 3 });
        }
        if (!links.length) {
          sendJSON(res, 409, { success: false, message: "Aucun fichier numérique prêt à être livré pour cette commande." }); return;
        }
        await writeAdminHistory(admin, "downloads.issued", "order", orderId, { count: links.length });
        sendJSON(res, 201, { success: true, message: "Liens sécurisés créés (7 jours, 3 téléchargements maximum chacun).", downloads: links });
        return;
      }

      const invoiceOrderMatch = pathname.match(new RegExp("^/api/admin/orders/([0-9a-fA-F-]{36})/invoice$"));
      if (invoiceOrderMatch && req.method === "POST") {
        const orderId = invoiceOrderMatch[1];
        const [orders, items, existing] = await Promise.all([
          supabaseRequest("orders?select=id,order_number,customer_name,customer_email,customer_phone,total_amount,currency,payment_status&id=eq." + encodeURIComponent(orderId) + "&limit=1"),
          supabaseRequest("order_items?select=item_name,quantity,unit_price,total_price&order_id=eq." + encodeURIComponent(orderId) + "&order=created_at.asc"),
          supabaseRequest("invoices?select=id,invoice_number,pdf_path,status&order_id=eq." + encodeURIComponent(orderId) + "&limit=1")
        ]);
        if (!Array.isArray(orders) || !orders.length) { sendJSON(res, 404, { success: false, message: "Commande introuvable." }); return; }
        const order = orders[0];
        if (order.payment_status !== "confirmed") { sendJSON(res, 409, { success: false, message: "Facture indisponible : le paiement doit d'abord être réellement vérifié." }); return; }
        if (Array.isArray(existing) && existing.length) {
          const signedUrl = await createInvoiceSignedUrl(existing[0].pdf_path);
          sendJSON(res, 200, { success: true, invoice: existing[0], signed_url: signedUrl, reused: true }); return;
        }
        const invoiceNumber = "DRBCK-" + new Date().toISOString().slice(0, 10).replace(/-/g, "") + "-" + crypto.randomBytes(6).toString("hex").toUpperCase();
        const storagePath = "invoices/" + invoiceNumber + ".pdf";
        await uploadPrivateInvoice(storagePath, buildInvoicePdf(order, Array.isArray(items) ? items : [], invoiceNumber));
        let created;
        try {
          created = await supabaseRequest("invoices", { method: "POST", body: {
            order_id: orderId, invoice_number: invoiceNumber, customer_name: order.customer_name || "Client",
            customer_email: order.customer_email || null, amount: Number(order.total_amount || 0),
            currency: order.currency || "USD", pdf_path: storagePath, status: "issued"
          }});
        } catch (error) {
          await fetch(SUPABASE_URL + "/storage/v1/object/customer-invoices/" + storagePath.split("/").map(encodeURIComponent).join("/"),
            { method: "DELETE", headers: { "apikey": SUPABASE_SECRET_KEY, "Authorization": "Bearer " + SUPABASE_SECRET_KEY } }).catch(() => {});
          throw error;
        }
        const invoice = Array.isArray(created) ? created[0] : created;
        await writeAdminHistory(admin, "invoice.created", "invoice", invoice && invoice.id, { order_id: orderId, invoice_number: invoiceNumber });
        const signedUrl = await createInvoiceSignedUrl(storagePath);
        sendJSON(res, 201, { success: true, message: "Facture PDF créée.", invoice, signed_url: signedUrl }); return;
      }
      const invoiceDownloadMatch = pathname.match(new RegExp("^/api/admin/invoices/([0-9a-fA-F-]{36})/download$"));
      if (invoiceDownloadMatch && req.method === "GET") {
        const rows = await supabaseRequest("invoices?select=id,invoice_number,pdf_path,status&id=eq." + encodeURIComponent(invoiceDownloadMatch[1]) + "&limit=1");
        if (!Array.isArray(rows) || !rows.length || !rows[0].pdf_path) { sendJSON(res, 404, { success: false, message: "Facture introuvable." }); return; }
        const signedUrl = await createInvoiceSignedUrl(rows[0].pdf_path);
        sendJSON(res, 200, { success: true, signed_url: signedUrl, expires_in: 300 }); return;
      }

      if (req.method === "POST" && pathname === "/api/admin/shipments") {
        const body = await readBody(req);
        const orderId = String(body.order_id || "");
        if (!/^[0-9a-fA-F-]{36}$/.test(orderId)) {
          sendJSON(res, 400, { success: false, message: "Identifiant de commande invalide." });
          return;
        }
        const deliveryStatus = body.delivery_status || "pending";
        if (!["pending", "preparing", "shipped", "delivered", "returned"].includes(deliveryStatus)) {
          sendJSON(res, 400, { success: false, message: "Statut de livraison invalide." });
          return;
        }
        const shipment = {
          order_id: orderId,
          delivery_address: String(body.delivery_address || "").trim() || null,
          tracking_number: String(body.tracking_number || "").trim() || null,
          delivery_status: deliveryStatus,
          notes: String(body.notes || "").trim() || null
        };
        const created = await supabaseRequest("shipments", { method: "POST", body: shipment });
        const item = Array.isArray(created) ? created[0] : created;
        await writeAdminHistory(admin, "shipment.created", "shipment", item && item.id, { order_id: orderId, delivery_status: deliveryStatus });
        sendJSON(res, 201, { success: true, message: "Livraison créée.", shipment: item });
        return;
      }

      const shipmentMatch = pathname.match(/^\/api\/admin\/shipments\/([0-9a-fA-F-]{36})$/);
      if (shipmentMatch && req.method === "PATCH") {
        const shipmentId = shipmentMatch[1];
        const body = await readBody(req);
        const updates = {};
        for (const field of ["delivery_address", "tracking_number", "notes"]) {
          if (Object.prototype.hasOwnProperty.call(body, field)) {
            updates[field] = String(body[field] || "").trim() || null;
          }
        }
        if (Object.prototype.hasOwnProperty.call(body, "delivery_status")) {
          if (!["pending", "preparing", "shipped", "delivered", "returned"].includes(body.delivery_status)) {
            sendJSON(res, 400, { success: false, message: "Statut de livraison invalide." });
            return;
          }
          updates.delivery_status = body.delivery_status;
        }
        if (!Object.keys(updates).length) {
          sendJSON(res, 400, { success: false, message: "Aucune modification reçue." });
          return;
        }
        updates.updated_at = new Date().toISOString();
        const updated = await supabaseRequest("shipments?id=eq." + encodeURIComponent(shipmentId), { method: "PATCH", body: updates });
        await writeAdminHistory(admin, "shipment.updated", "shipment", shipmentId, { fields: Object.keys(updates) });
        sendJSON(res, 200, { success: true, message: "Livraison modifiée.", shipment: updated });
        return;
      }

      // --------------------------------------------
      // GESTION DES PRODUITS (ADMIN)
      // --------------------------------------------

      if (req.method === "POST" && pathname === "/api/admin/products") {
        const body = await readBody(req);
        const name = String(body.name || "").trim();
        const price = Number(body.price);
        const productType = body.product_type || "digital";
        const status = body.publication_status || "draft";
        const allowedStatuses = ["draft", "pending", "approved", "published", "rejected"];

        if (!name || !Number.isFinite(price) || price < 0) {
          sendJSON(res, 400, { success: false, message: "Nom et prix valide obligatoires." });
          return;
        }
        if (!["digital", "physical"].includes(productType) || !allowedStatuses.includes(status)) {
          sendJSON(res, 400, { success: false, message: "Type ou statut de publication invalide." });
          return;
        }
        const stock = body.stock === null || body.stock === undefined || body.stock === ""
          ? null : Number(body.stock);
        if (stock !== null && (!Number.isInteger(stock) || stock < 0)) {
          sendJSON(res, 400, { success: false, message: "Le stock doit être un entier positif ou nul." });
          return;
        }

        const product = {
          name,
          description: String(body.description || "").trim(),
          price,
          currency: "USD",
          product_type: productType,
          image_url: body.image_url ? String(body.image_url).trim() : null,
          file_path: body.file_path ? String(body.file_path).trim() : null,
          stock,
          active: status === "published" && body.active === true,
          publication_status: status
        };
        const created = await supabaseRequest("products", { method: "POST", body: product });
        const item = Array.isArray(created) ? created[0] : created;
        await writeAdminHistory(admin, "product.created", "product", item && item.id, { name, publication_status: status });
        sendJSON(res, 201, { success: true, message: "Produit créé.", product: item });
        return;
      }

      const productMatch = pathname.match(/^\/api\/admin\/products\/([0-9a-fA-F-]{36})$/);
      if (productMatch) {
        const productId = productMatch[1];

        if (req.method === "PATCH") {
          const body = await readBody(req);
          const updates = {};
          const allowed = ["name", "description", "price", "product_type", "image_url", "file_path", "stock", "publication_status", "active"];
          for (const field of allowed) {
            if (Object.prototype.hasOwnProperty.call(body, field)) updates[field] = body[field];
          }
          if (Object.keys(updates).length === 0) {
            sendJSON(res, 400, { success: false, message: "Aucune modification reçue." });
            return;
          }
          if (Object.prototype.hasOwnProperty.call(updates, "name")) {
            updates.name = String(updates.name || "").trim();
            if (!updates.name) {
              sendJSON(res, 400, { success: false, message: "Le nom du produit est obligatoire." });
              return;
            }
          }
          if (Object.prototype.hasOwnProperty.call(updates, "price")) {
            updates.price = Number(updates.price);
            if (!Number.isFinite(updates.price) || updates.price < 0) {
              sendJSON(res, 400, { success: false, message: "Prix invalide." });
              return;
            }
          }
          if (Object.prototype.hasOwnProperty.call(updates, "stock") && updates.stock !== null && updates.stock !== "") {
            updates.stock = Number(updates.stock);
            if (!Number.isInteger(updates.stock) || updates.stock < 0) {
              sendJSON(res, 400, { success: false, message: "Stock invalide." });
              return;
            }
          }
          if (Object.prototype.hasOwnProperty.call(updates, "product_type") && !["digital", "physical"].includes(updates.product_type)) {
            sendJSON(res, 400, { success: false, message: "Type de produit invalide." });
            return;
          }
          if (Object.prototype.hasOwnProperty.call(updates, "publication_status") && !["draft", "pending", "approved", "published", "rejected"].includes(updates.publication_status)) {
            sendJSON(res, 400, { success: false, message: "Statut de publication invalide." });
            return;
          }
          if (updates.publication_status && updates.publication_status !== "published") updates.active = false;
          if (updates.publication_status === "published" && !Object.prototype.hasOwnProperty.call(updates, "active")) updates.active = true;
          if (updates.active === true) {
            let resultingStatus = updates.publication_status;
            if (!resultingStatus) {
              const current = await supabaseRequest("products?select=publication_status&id=eq." + encodeURIComponent(productId) + "&limit=1");
              resultingStatus = Array.isArray(current) && current[0] ? current[0].publication_status : null;
            }
            if (resultingStatus !== "published") {
              sendJSON(res, 400, { success: false, message: "Un produit doit être publié pour être activé." });
              return;
            }
          }
          const updated = await supabaseRequest("products?id=eq." + encodeURIComponent(productId), { method: "PATCH", body: updates });
          await writeAdminHistory(admin, "product.updated", "product", productId, { fields: Object.keys(updates) });
          sendJSON(res, 200, { success: true, message: "Produit modifié.", product: updated });
          return;
        }

        if (req.method === "DELETE") {
          await supabaseRequest("products?id=eq." + encodeURIComponent(productId), { method: "DELETE", prefer: "return=minimal" });
          await writeAdminHistory(admin, "product.deleted", "product", productId);
          sendJSON(res, 200, { success: true, message: "Produit supprimé." });
          return;
        }
      }

      // --------------------------------------------
      // LISTE DES SERVICES POUR ADMIN
      // --------------------------------------------

      if (
        req.method === "GET" &&
        pathname === "/api/admin/services"
      ) {
        const services = await supabaseRequest(
          "services?select=*&order=created_at.desc"
        );

        sendJSON(res, 200, {
          success: true,
          services: services
        });

        return;
      }

      // --------------------------------------------
      // AJOUTER UN SERVICE
      // --------------------------------------------

      if (
        req.method === "POST" &&
        pathname === "/api/admin/services"
      ) {
        const body = await readBody(req);

        if (!body.nom || !String(body.nom).trim()) {
          sendJSON(res, 400, {
            success: false,
            message: "Le nom du service est obligatoire."
          });

          return;
        }

        const newService = {
          nom: String(body.nom).trim(),
          description: String(body.description || "").trim(),
          prix: body.prix || null,
          photo_url: body.photo_url || null,
          actif: body.actif === true,
          publication_status: body.publication_status || "draft"
        };

        const created = await supabaseRequest(
          "services",
          {
            method: "POST",
            body: newService
          }
        );

        const createdService = Array.isArray(created) ? created[0] : created;
        await writeAdminHistory(admin, "service.created", "service", createdService && createdService.id, { nom: newService.nom });
        sendJSON(res, 201, {
          success: true,
          message: "Service ajouté.",
          service: created
        });

        return;
      }

      // --------------------------------------------
      // MODIFIER OU SUPPRIMER UN SERVICE
      // --------------------------------------------

      const serviceMatch = pathname.match(
        /^\/api\/admin\/services\/([0-9]+)$/
      );

      if (serviceMatch) {
        const serviceId = serviceMatch[1];

        // ------------------------------------------
        // MODIFIER UN SERVICE
        // ------------------------------------------

        if (req.method === "PATCH") {
          const body = await readBody(req);

          const allowedFields = [
            "nom",
            "description",
            "prix",
            "photo_url",
            "actif",
            "publication_status"
          ];

          const updates = {};

          for (const field of allowedFields) {
            if (Object.prototype.hasOwnProperty.call(body, field)) {
              updates[field] = body[field];
            }
          }

          if (Object.keys(updates).length === 0) {
            sendJSON(res, 400, {
              success: false,
              message: "Aucune modification reçue."
            });

            return;
          }

          const updated = await supabaseRequest(
            "services?id=eq." + encodeURIComponent(serviceId),
            {
              method: "PATCH",
              body: updates
            }
          );

          await writeAdminHistory(admin, "service.updated", "service", serviceId, { fields: Object.keys(updates) });
          sendJSON(res, 200, {
            success: true,
            message: "Service modifié.",
            service: updated
          });

          return;
        }

        // ------------------------------------------
        // SUPPRIMER UN SERVICE
        // ------------------------------------------

        if (req.method === "DELETE") {
          await supabaseRequest(
            "services?id=eq." + encodeURIComponent(serviceId),
            {
              method: "DELETE",
              prefer: "return=minimal"
            }
          );

          await writeAdminHistory(admin, "service.deleted", "service", serviceId);
          sendJSON(res, 200, {
            success: true,
            message: "Service supprimé."
          });

          return;
        }
      }

      sendJSON(res, 404, {
        success: false,
        message: "Route administrateur introuvable."
      });

      return;
    }

    // ----------------------------------------------
    // ASSISTANT PUBLIC DRBCK TECH IA
    // ----------------------------------------------

    if (
      req.method === "POST" &&
      pathname === "/api/chat"
    ) {
      const clientIP =
        req.headers["x-forwarded-for"] ||
        req.socket.remoteAddress ||
        "unknown";

      if (!checkRateLimit(clientIP, 20, 60 * 1000)) {
        sendJSON(res, 429, {
          success: false,
          message: "Trop de demandes. Réessayez dans une minute."
        });

        return;
      }

      const body = await readBody(req);

      const message = String(
        body.message || body.question || ""
      ).trim();

      if (!message) {
        sendJSON(res, 400, {
          success: false,
          message: "Veuillez écrire votre question."
        });

        return;
      }

      if (!OPENAI_API_KEY) {
        sendJSON(res, 500, {
          success: false,
          message: "Le service IA n'est pas configuré."
        });

        return;
      }

      const services = await getPublicServices();

      const instructions = buildAIInstructions(services);

      const openAIResponse = await fetch(
        "https://api.openai.com/v1/responses",
        {
          method: "POST",

          headers: {
            "Authorization": "Bearer " + OPENAI_API_KEY,
            "Content-Type": "application/json"
          },

          body: JSON.stringify({
            model: OPENAI_MODEL,
            instructions: instructions,
            input: message
          })
        }
      );

      const aiData = await openAIResponse.json();

      if (!openAIResponse.ok) {
        console.error("Erreur OpenAI :", aiData);

        sendJSON(res, 502, {
          success: false,
          message: "L'assistant IA est momentanément indisponible."
        });

        return;
      }

      const answer = extractOpenAIText(aiData);

      if (!answer) {
        sendJSON(res, 502, {
          success: false,
          message: "Aucune réponse reçue de l'assistant."
        });

        return;
      }

      sendJSON(res, 200, {
        success: true,
        assistant: "DRBCK TECH IA",
        reply: answer,
        answer: answer
      });

      return;
    }

    // ----------------------------------------------
    // ROUTE INCONNUE
    // ----------------------------------------------

    sendJSON(res, 404, {
      success: false,
      message: "Route introuvable."
    });

  } catch (error) {
    console.error("Erreur serveur :", error);

    sendJSON(res, 500, {
      success: false,
      message: error.message || "Erreur interne du serveur."
    });
  }
});

// --------------------------------------------------
// DEMARRAGE DU SERVEUR
// --------------------------------------------------

server.listen(PORT, () => {
  console.log(
    "DRBCK TECH.IT.PRO démarré sur le port " + PORT
  );
});
