// DRBCK TECH.IT.PRO — SERVICES PUBLICS
const API_BASE = "https://drbck-tech-it-pro.onrender.com";
const numeroWhatsApp = "243972052103";

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text != null) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function nettoyerUrlPhoto(value) {
  if (!value || typeof value !== "string") return "";
  const match = value.trim().match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/);
  const url = match ? match[2] : value.trim();
  return /^https?:\/\//i.test(url) ? url : "";
}

async function chargerServicesPublics() {
  const liste = document.getElementById("services-list");
  if (!liste) return;

  liste.replaceChildren(element("p", "Chargement des services..."));

  try {
    const response = await fetch(`${API_BASE}/api/services`, {
      cache: "no-store"
    });

    const data = await response.json();

    if (!response.ok || data.success === false) {
      throw new Error(data.error || "Erreur de chargement");
    }

    // Accepte le format { success: true, services: [...] }
    // ainsi qu'un tableau direct.
    const services = Array.isArray(data)
      ? data
      : Array.isArray(data.services) ? data.services : [];

    liste.replaceChildren();

    if (!services.length) {
      liste.appendChild(element("p", "Aucun service publié pour le moment."));
      return;
    }

    services
      .filter(service =>
        service &&
        service.actif !== false &&
        (!service.publication_status ||
          service.publication_status === "published")
      )
      .forEach(service => {
        const card = element("article", null, "service-card");
        const photo = nettoyerUrlPhoto(service.photo_url);

        if (photo) {
          const img = element("img", null, "service-photo");
          img.src = photo;
          img.alt = service.nom || "Photo du service";
          img.loading = "lazy";
          img.onerror = () => img.remove();
          card.appendChild(img);
        }

        card.appendChild(element("h3", service.nom || "Service"));
        card.appendChild(element(
          "p",
          service.description || "Contactez-nous pour plus d'informations."
        ));
        card.appendChild(element(
          "strong",
          `Prix : ${service.prix || "Sur demande"}`
        ));

        const link = element("a", "Commander sur WhatsApp");
        link.href = `https://wa.me/${numeroWhatsApp}?text=${encodeURIComponent(
          "Bonjour DRBCK TECH.IT.PRO, je souhaite des informations sur : " +
          (service.nom || "un service")
        )}`;
        link.target = "_blank";
        link.rel = "noopener noreferrer";

        card.appendChild(link);
        liste.appendChild(card);
      });

  } catch (error) {
    console.error("Erreur services DRBCK :", error);
    liste.replaceChildren(element(
      "p",
      "Les services sont momentanément indisponibles. Contactez-nous sur WhatsApp au +243 972 052 103."
    ));
  }
}

const whatsappLink = document.getElementById("whatsapp-link");

if (whatsappLink) {
  whatsappLink.href = `https://wa.me/${numeroWhatsApp}`;
  whatsappLink.target = "_blank";
  whatsappLink.rel = "noopener noreferrer";
}

chargerServicesPublics();
