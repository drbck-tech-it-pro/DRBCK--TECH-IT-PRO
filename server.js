```javascript
const http = require("http");
const crypto = require("crypto");

const PORT = process.env.PORT || 3000;
const SITE_ORIGIN = "https://drbck-tech-it-pro.github.io";

const sessions = new Map();
const rateLimits = new Map();

function json(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });

  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";

    req.on("data", chunk => {
      raw += chunk;

      if (raw.length > 200000) {
        reject(new Error("Données trop volumineuses."));
        req.destroy();
      }
    });

    req.on("end", () => {
      try {
        resolve(JSON.parse(raw || "{}"));
      } catch {
        reject(new Error("Format JSON invalide."));
      }
    });

    req.on("error", reject);
  });
}

function supabaseConfig() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;

  if (!url || !key) {
    throw new Error("Configuration Supabase manquante.");
  }

  return {
    url: url.replace(/\/+$/, ""),
    key
  };
}

async function supabase(path, options = {}) {
  const { url, key } = supabaseConfig();

  return fetch(`${url}/rest/v1/${path}`, {
    ...options,

    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
}

function isAdmin(req) {
  const token = (req.headers.authorization || "")
    .replace(/^Bearer\s+/i, "");

  const session = sessions.get(token);

  if (!session || session.expiresAt < Date.now()) {
    sessions.delete(token);
    return false;
  }

  return true;
}

function publicServiceFilter() {
  return "services?select=id,nom,description,prix,photo_url,actif,publication_status,created_at&actif=eq.true&publication_status=eq.published&order=id.asc";
}

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin;

  res.setHeader("Vary", "Origin");

  if (origin === SITE_ORIGIN) {
    res.setHeader("Access-Control-Allow-Origin", SITE_ORIGIN);

    res.setHeader(
      "Access-Control-Allow-Methods",
      "GET, POST, PATCH, DELETE, OPTIONS"
    );

    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization"
    );
  }

  if (req.method === "OPTIONS") {
    if (origin !== SITE_ORIGIN) {
      return json(res, 403, {
        error: "Origine non autorisée."
      });
    }

    res.writeHead(204);
    return res.end();
  }

  if (origin && origin !== SITE_ORIGIN) {
    return json(res, 403, {
      error: "Accès refusé."
    });
  }

  const url = new URL(req.url, "http://localhost");
  const path = url.pathname;

  try {

    // 1. SERVEUR
    if (req.method === "GET" && path === "/") {
      return json(res, 200, {
        success: true,
        message: "Serveur DRBCK TECH.IT.PRO opérationnel."
      });
    }

    // 2. SERVICES PUBLICS
    if (req.method === "GET" && path === "/api/services") {
      const response = await supabase(publicServiceFilter());
      const data = await response.json();

      if (!response.ok) {
        console.error(data);

        return json(res, 502, {
          error: "Impossible de récupérer les services."
        });
      }

      return json(res, 200, data);
    }

    // 3. CONNEXION ADMINISTRATEUR
    if (req.method === "POST" && path === "/api/admin/login") {
      const data = await readBody(req);
      const password = process.env.ADMIN_PASSWORD;

      if (!password) {
        return json(res, 500, {
          error: "ADMIN_PASSWORD non configuré sur Render."
        });
      }

      if (
        typeof data.password !== "string" ||
        data.password !== password
      ) {
        return json(res, 401, {
          error: "Mot de passe incorrect."
        });
      }

      const token = crypto.randomBytes(32).toString("hex");

      sessions.set(token, {
        expiresAt: Date.now() + 8 * 60 * 60 * 1000
      });

      return json(res, 200, {
        success: true,
        token
      });
    }

    // 4. ADMINISTRATION
    if (path.startsWith("/api/admin/")) {

      if (!isAdmin(req)) {
        return json(res, 401, {
          error: "Connexion administrateur requise."
        });
      }

      // LIRE LES SERVICES
      if (
        path === "/api/admin/services" &&
        req.method === "GET"
      ) {
        const response = await supabase(
          "services?select=*&order=id.asc"
        );

        const data = await response.json();

        if (!response.ok) {
          console.error(data);

          return json(res, 502, {
            error: "Impossible de lire les services."
          });
        }

        return json(res, 200, data);
      }

      // AJOUTER UN SERVICE
      if (
        path === "/api/admin/services" &&
        req.method === "POST"
      ) {
        const data = await readBody(req);

        if (
          typeof data.nom !== "string" ||
          !data.nom.trim() ||
          data.prix === undefined ||
          String(data.prix).trim() === ""
        ) {
          return json(res, 400, {
            error: "Le nom et le prix sont obligatoires."
          });
        }

        const row = {
          nom: data.nom.trim(),

          description:
            typeof data.description === "string"
              ? data.description.trim()
              : "",

          prix: String(data.prix).trim(),

          photo_url: data.photo_url || null,

          actif: data.actif !== false,

          publication_status:
            [
              "draft",
              "pending",
              "approved",
              "published",
              "rejected"
            ].includes(data.publication_status)
              ? data.publication_status
              : "published"
        };

        const response = await supabase("services", {
          method: "POST",

          headers: {
            Prefer: "return=representation"
          },

          body: JSON.stringify(row)
        });

        const result = await response.json();

        if (!response.ok) {
          console.error(result);

          return json(res, 502, {
            error: "Ajout du service impossible."
          });
        }

        return json(res, 201, {
          success: true,
          service: result[0]
        });
      }

      const match = path.match(
        /^\/api\/admin\/services\/(\d+)$/
      );

      // MODIFIER UN SERVICE
      if (match && req.method === "PATCH") {
        const data = await readBody(req);
        const changes = {};

        for (const key of [
          "nom",
          "description",
          "prix",
          "photo_url",
          "actif",
          "publication_status"
        ]) {
          if (data[key] !== undefined) {
            changes[key] = data[key];
          }
        }

        if (
          changes.nom !== undefined &&
          !String(changes.nom).trim()
        ) {
          return json(res, 400, {
            error: "Le nom est obligatoire."
          });
        }

        if (
          changes.prix !== undefined &&
          !String(changes.prix).trim()
        ) {
          return json(res, 400, {
            error: "Le prix est obligatoire."
          });
        }

        if (!Object.keys(changes).length) {
          return json(res, 400, {
            error: "Aucune modification fournie."
          });
        }

        const response = await supabase(
          `services?id=eq.${match[1]}`,
          {
            method: "PATCH",

            headers: {
              Prefer: "return=representation"
            },

            body: JSON.stringify(changes)
          }
        );

        const result = await response.json();

        if (!response.ok) {
          console.error(result);

          return json(res, 502, {
            error: "Modification impossible."
          });
        }

        return json(res, 200, {
          success: true,
          service: result[0] || null
        });
      }

      // SUPPRIMER UN SERVICE
      if (match && req.method === "DELETE") {
        const response = await supabase(
          `services?id=eq.${match[1]}`,
          {
            method: "DELETE",

            headers: {
              Prefer: "return=representation"
            }
          }
        );

        if (!response.ok) {
          const result = await response.json();
          console.error(result);

          return json(res, 502, {
            error: "Suppression impossible."
          });
        }

        return json(res, 200, {
          success: true
        });
      }

      return json(res, 404, {
        error: "Route administrateur introuvable."
      });
    }

    // 5. ASSISTANT DRBCK TECH IA
    if (req.method === "POST" && path === "/api/chat") {
      const ip = req.socket.remoteAddress || "unknown";
      const now = Date.now();

      const recent = (rateLimits.get(ip) || [])
        .filter(t => now - t < 60000);

      if (recent.length >= 10) {
        return json(res, 429, {
          error: "Trop de messages. Réessayez dans une minute."
        });
      }

      recent.push(now);
      rateLimits.set(ip, recent);

      if (!process.env.OPENAI_API_KEY) {
        return json(res, 503, {
          error: "Assistant IA non configuré."
        });
      }

      if (!process.env.OPENAI_MODEL) {
        return json(res, 503, {
          error: "OPENAI_MODEL non configuré."
        });
      }

      const data = await readBody(req);

      if (
        typeof data.message !== "string" ||
        !data.message.trim()
      ) {
        return json(res, 400, {
          error: "Message invalide."
        });
      }

      const serviceResponse = await supabase(
        publicServiceFilter()
      );

      const services = await serviceResponse.json();

      if (!serviceResponse.ok) {
        throw new Error(
          "Impossible de lire les services publiés."
        );
      }

      const serviceText = services.length
        ? services.map(s =>
            `- ${s.nom} : ${s.description || "Description non précisée"} | Prix : ${s.prix}`
          ).join("\n")
        : "Aucun service publié actuellement.";

      const instructions =
        `Tu es DRBCK TECH IA, assistant officiel de DRBCK TECH.IT.PRO à Likasi, RDC.
Tu réponds en français, poliment et simplement.
Ne dis jamais que tu es ChatGPT ou un autre assistant.
N'invente aucun service ni tarif.
Utilise uniquement cette liste de services publiés :
${serviceText}
Pour les commandes, contacte WhatsApp +243 972 052 103.
Si un prix ou un service manque, invite le client à demander confirmation à l'entreprise.`;

      const ai = await fetch(
        "https://api.openai.com/v1/responses",
        {
          method: "POST",

          headers: {
            "Content-Type": "application/json",

            Authorization:
              `Bearer ${process.env.OPENAI_API_KEY}`
          },

          body: JSON.stringify({
            model: process.env.OPENAI_MODEL,
            instructions,
            input: data.message.trim()
          })
        }
      );

      const result = await ai.json();

      if (!ai.ok) {
        console.error(result);

        return json(res, 502, {
          error: "L'assistant IA n'a pas pu répondre. Vérifiez OPENAI_MODEL et la clé API."
        });
      }

      const reply = (result.output || [])
        .flatMap(item => item.content || [])
        .filter(item => item.type === "output_text")
        .map(item => item.text)
        .join("\n");

      if (!reply.trim()) {
        return json(res, 502, {
          error: "Réponse IA vide."
        });
      }

      return json(res, 200, {
        reply
      });
    }

    return json(res, 404, {
      error: "Route introuvable."
    });

  } catch (error) {
    console.error("Erreur serveur:", error);

    return json(res, 500, {
      error: error.message || "Erreur serveur."
    });
  }
});

server.listen(PORT, () => {
  console.log(
    `DRBCK TECH.IT.PRO démarré sur le port ${PORT}`
  );
});
