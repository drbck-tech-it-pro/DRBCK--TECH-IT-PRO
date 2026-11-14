const http = require("http");

const SITE = "https://drbck-tech-it-pro.github.io";
const requests = new Map();

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin;

  res.setHeader(
    "Content-Type",
    "application/json; charset=utf-8"
  );

  if (origin === SITE) {
    res.setHeader("Access-Control-Allow-Origin", SITE);
  }

  res.setHeader("Vary", "Origin");
  res.setHeader(
    "Access-Control-Allow-Methods",
    "POST, OPTIONS"
  );
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type"
  );

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    return res.end();
  }

  if (req.method !== "POST" || req.url !== "/api/chat") {
    res.writeHead(404);
    return res.end(JSON.stringify({
      error: "Page introuvable."
    }));
  }

  if (origin !== SITE) {
    res.writeHead(403);
    return res.end(JSON.stringify({
      error: "Accès refusé."
    }));
  }

  const ip = req.socket.remoteAddress;
  const now = Date.now();
  const previous = requests.get(ip) || [];
  const recent = previous.filter(
    t => now - t < 60000
  );

  if (recent.length >= 10) {
    res.writeHead(429);
    return res.end(JSON.stringify({
      error: "Trop de messages. Réessaie dans une minute."
    }));
  }

  recent.push(now);
  requests.set(ip, recent);

  if (!process.env.OPENAI_API_KEY) {
    res.writeHead(500);
    return res.end(JSON.stringify({
      error: "Service IA non configuré."
    }));
  }

  try {
    let body = "";

    for await (const chunk of req) {
      body += chunk;

      if (body.length > 10000) {
        res.writeHead(413);
        return res.end(JSON.stringify({
          error: "Message trop long."
        }));
      }
    }

    const data = JSON.parse(body);

    if (
      typeof data.message !== "string" ||
      !data.message.trim()
    ) {
      res.writeHead(400);
      return res.end(JSON.stringify({
        error: "Message invalide."
      }));
    }

    const response = await fetch(
      "https://api.openai.com/v1/responses",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer " + process.env.OPENAI_API_KEY
        },
        body: JSON.stringify({
          model: process.env.OPENAI_MODEL || "gpt-6-luna",
          input: data.message.trim()
        })
      }
    );

    const result = await response.json();

    if (!response.ok) {
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

    res.writeHead(200);
    res.end(JSON.stringify({
      reply: texte
    }));

  } catch (error) {
    console.error(error);

    res.writeHead(500);
    res.end(JSON.stringify({
      error: "Impossible de contacter l'assistant IA."
    }));
  }
});

server.listen(process.env.PORT || 3000);