const http = require("http");

const ALLOWED_ORIGIN =
  "https://drbck-tech-it-pro.github.io";

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin;

  res.setHeader("Content-Type", "application/json; charset=utf-8");

  if (origin && origin !== ALLOWED_ORIGIN) {
    res.writeHead(403);
    return res.end(JSON.stringify({
      error: "Origine non autorisée."
    }));
  }

  res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    return res.end();
  }

  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200);
    return res.end(JSON.stringify({
      status: "DRBCK TECH IA en ligne"
    }));
  }

  if (req.method === "POST" && req.url === "/api/chat") {
    if (!process.env.OPENAI_API_KEY) {
      res.writeHead(500);
      return res.end(JSON.stringify({
        error: "Clé API non configurée."
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
            "Authorization":
              `Bearer ${process.env.OPENAI_API_KEY}`
          },
          body: JSON.stringify({
            model: process.env.OPENAI_MODEL || "gpt-6-luna",
            input: data.message.trim()
          })
        }
      );

      const result = await response.json();

      if (!response.ok) {
        res.writeHead(502);
        return res.end(JSON.stringify({
          error: "Le service IA rencontre un problème."
        }));
      }

      res.writeHead(200);
      res.end(JSON.stringify({
        answer: result.output_text || "Aucune réponse reçue."
      }));

    } catch (error) {
      res.writeHead(500);
      res.end(JSON.stringify({
        error: "Impossible de contacter DRBCK TECH IA."
      }));
    }

    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({
    error: "Page introuvable."
  }));
});

server.listen(process.env.PORT || 3000);