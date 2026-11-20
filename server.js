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
    // CONNEXION ADMINISTRATEUR SUPABASE
    // ----------------------------------------------

    if (
      req.method === "POST" &&
      pathname === "/api/admin/login"
    ) {
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
