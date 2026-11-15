```javascript
const http = require("http");
const crypto = require("crypto");

const SITE = "https://drbck-tech-it-pro.github.io";

const requests = new Map();
const sessions = new Map();

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin;

  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Vary", "Origin");

  if (origin === SITE) {
    res.setHeader("Access-Control-Allow-Origin", SITE);
  }

  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, POST, PATCH, DELETE, OPTIONS"
  );

  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization"
  );

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    return res.end();
  }

  if (origin !== SITE) {
    res.writeHead(403);
    return res.end(JSON.stringify({
      error: "Accès refusé."
    }));
  }

  function send(status, data) {
    res.writeHead(status);
    res.end(JSON.stringify(data));
  }

  async function readBody() {
    let body = "";

    for await (const chunk of req) {
      body += chunk;

      if (body.length > 20000) {
        throw new Error("Message trop long.");
      }
    }

    return JSON.parse(body || "{}");
  }

  function getSupabaseConfig() {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SECRET_KEY;

    if (!url || !key) {
      throw new Error("Configuration Supabase manquante.");
    }

    return {
      url: url.replace(/\/$/, ""),
      key
    };
  }

  async function supabaseRequest(path, options = {}) {
    const config = getSupabaseConfig();

    return fetch(
      config.url + "/rest/v1/" + path,
      {
        ...options,
        headers: {
          "apikey": config.key,
          "Content-Type": "application/json",
          ...(options.headers || {})
        }
      }
    );
  }

  function checkAdmin() {
    const authorization = req.headers.authorization || "";
    const token = authorization.replace(/^Bearer\s+/i, "");
    const session = sessions.get(token);

    if (!session || session.expires < Date.now()) {
      sessions.delete(token);
      return false;
    }

    return true;
  }

  try {
    const url = new URL(req.url, "http://localhost");
    const path = url.pathname;

    // =====================================
    // SERVICES PUBLICS : RÉCUPÉRATION SUPABASE
    // =====================================

    if (path === "/api/services" && req.method === "GET") {
      const response = await supabaseRequest(
        "services?select=id,nom,description,prix,photo_url,actif,created_at&actif=eq.true&order=id.asc"
      );

      const result = await response.json();

      if (!response.ok) {
        console.error("Erreur Supabase :", result);

        return send(500, {
          error: "Impossible de récupérer les services."
        });
      }

      return send(200, result);
    }

    // =====================================
    // CONNEXION ADMINISTRATEUR
    // =====================================

    if (path === "/api/admin/login" && req.method === "POST") {
      const data = await readBody();
      const password = process.env.ADMIN_PASSWORD;

      if (!password) {
        return send(500, {
          error: "Mot de passe administrateur non configuré."
        });
      }

      if (
        typeof data.password !== "string" ||
        data.password !== password
      ) {
        return send(401, {
          error: "Mot de passe incorrect."
        });
      }

      const token = crypto.randomBytes(32).toString("hex");

      sessions.set(token, {
        expires: Date.now() + 8 * 60 * 60 * 1000
      });

      return send(200, {
        success: true,
        token
      });
    }

    // =====================================
    // PROTECTION DES FONCTIONS ADMIN
    // =====================================

    if (path.startsWith("/api/admin/")) {
      if (!checkAdmin()) {
        return send(401, {
          error: "Connexion administrateur requise."
        });
      }

      // AFFICHER TOUS LES SERVICES

      if (
        path === "/api/admin/services" &&
        req.method === "GET"
      ) {
        const response = await supabaseRequest(
          "services?select=*&order=id.asc"
        );

        const result = await response.json();

        if (!response.ok) {
          return send(500, {
            error: "Impossible de lire les services."
          });
        }

        return send(200, result);
      }

      // AJOUTER UN SERVICE

      if (
        path === "/api/admin/services" &&
        req.method === "POST"
      ) {
        const data = await readBody();

        if (
          typeof data.nom !== "string" ||
          !data.nom.trim() ||
          typeof data.prix !== "string" ||
          !data.prix.trim()
        ) {
          return send(400, {
            error: "Le nom et le prix sont obligatoires."
          });
        }

        const nouveauService = {
          nom: data.nom.trim(),
          description: data.description || "",
          prix: data.prix.trim(),
          photo_url: data.photo_url || null,
          actif: data.actif !== false
        };

        const response = await supabaseRequest(
          "services",
          {
            method: "POST",
            headers: {
              "Prefer": "return=representation"
            },
            body: JSON.stringify(nouveauService)
          }
        );

        const result = await response.json();

        if (!response.ok) {
          console.error("Erreur ajout :", result);

          return send(500, {
            error: "Impossible d'ajouter le service."
          });
        }

        return send(201, {
          success: true,
          service: result[0]
        });
      }

      // MODIFIER OU SUPPRIMER UN SERVICE

      const match = path.match(
        /^\/api\/admin\/services\/(\d+)$/
      );

      if (match) {
        const id = match[1];

        // MODIFIER

        if (req.method === "PATCH") {
          const data = await readBody();
          const modifications = {};

          for (const champ of [
            "nom",
            "description",
            "prix",
            "photo_url",
            "actif"
          ]) {
            if (data[champ] !== undefined) {
              modifications[champ] = data[champ];
            }
          }

          if (
            modifications.nom !== undefined &&
            !String(modifications.nom).trim()
          ) {
            return send(400, {
              error: "Le nom est obligatoire."
            });
          }

          if (
            modifications.prix !== undefined &&
            !String(modifications.prix).trim()
          ) {
            return send(400, {
              error: "Le prix est obligatoire."
            });
          }

          if (!Object.keys(modifications).length) {
            return send(400, {
              error: "Aucune modification fournie."
            });
          }

          const response = await supabaseRequest(
            "services?id=eq." + id,
            {
              method: "PATCH",
              headers: {
                "Prefer": "return=representation"
              },
              body: JSON.stringify(modifications)
            }
          );

          const result = await response.json();

          if (!response.ok) {
            return send(500, {
              error: "Impossible de modifier le service."
            });
          }

          return send(200, {
            success: true,
            service: result[0] || null
          });
        }

        // SUPPRIMER

        if (req.method === "DELETE") {
          const response = await supabaseRequest(
            "services?id=eq." + id,
            {
              method: "DELETE",
              headers: {
                "Prefer": "return=representation"
              }
            }
          );

          if (!response.ok) {
            return send(500, {
              error: "Impossible de supprimer le service."
            });
          }

          return send(200, {
            success: true,
            message: "Service supprimé."
          });
        }
      }

      return send(404, {
        error: "Fonction administrateur introuvable."
      });
    }

    // =====================================
    // ASSISTANT PUBLIC DRBCK TECH IA
    // =====================================

    if (req.method !== "POST" || path !== "/api/chat") {
      return send(404, {
        error: "Page introuvable."
      });
    }

    const ip = req.socket.remoteAddress;
    const now = Date.now();
    const previous = requests.get(ip) || [];

    const recent = previous.filter(
      t => now - t < 60000
    );

    if (recent.length >= 10) {
      return send(429, {
        error: "Trop de messages. Réessaie dans une minute."
      });
    }

    recent.push(now);
    requests.set(ip, recent);

    if (!process.env.OPENAI_API_KEY) {
      return send(500, {
        error: "Service IA non configuré."
      });
    }

    const data = await readBody();

    if (
      typeof data.message !== "string" ||
      !data.message.trim()
    ) {
      return send(400, {
        error: "Message invalide."
      });
    }

    // RÉCUPÉRATION DES SERVICES DEPUIS SUPABASE

    const servicesResponse = await supabaseRequest(
      "services?select=nom,description,prix&actif=eq.true&order=nom.asc"
    );

    const services = await servicesResponse.json();

    if (!servicesResponse.ok) {
      throw new Error("Impossible de lire les services.");
    }

    const listeServices = services.length
      ? services.map(service =>
          "- " + service.nom +
          " | Description : " +
          (service.description || "Non précisée") +
          " | Prix : " + service.prix
        ).join("\n")
      : "Aucun service actif enregistré.";

    const INSTRUCTIONS = `
Tu es DRBCK TECH IA, l'assistant officiel de DRBCK TECH.IT.PRO,
une entreprise informatique située à Likasi,
en République démocratique du Congo.

Ton nom est DRBCK TECH IA.
Ne te présente jamais comme ChatGPT.
Réponds toujours en français, avec politesse et simplicité.

SERVICES ET TARIFS :
${listeServices}

RÈGLES :
- Utilise uniquement les services et tarifs fournis.
- N'invente jamais de prix.
- Ne présente pas un service inactif comme disponible.
- Pour les commandes et renseignements, oriente les clients
vers WhatsApp au +243 972 052 103.
- Ne prétends jamais avoir effectué une réparation.
- Si un service n'est pas dans la liste, demande au client
de contacter l'entreprise pour confirmation.
`;

    const response = await fetch(
      "https://api.openai.com/v1/responses",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization":
            "Bearer " + process.env.OPENAI_API_KEY
        },
        body: JSON.stringify({
          model: process.env.OPENAI_MODEL || "gpt-6-luna",
          instructions: INSTRUCTIONS,
          input: "Message du client : " + data.message.trim()
        })
      }
    );

    const result = await response.json();

    if (!response.ok) {
      console.error("Erreur OpenAI :", result);

      throw new Error("Erreur API OpenAI");
    }

    const texte = (result.output || [])
      .flatMap(item => item.content || [])
      .filter(item => item.type === "output_text")
      .map(item => item.text)
      .join("\n");

    if (!texte.trim()) {
      throw new Error("Réponse IA vide");
    }

    return send(200, {
      reply: texte
    });

  } catch (error) {
    console.error(error);

    return send(500, {
      error: "Une erreur est survenue sur le serveur."
    });
  }
});

server.listen(process.env.PORT || 3000);
