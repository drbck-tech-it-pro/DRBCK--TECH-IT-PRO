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

// --------------------------------------------------
// PRODUITS PUBLICS — SEULEMENT LES PRODUITS PUBLIES
// --------------------------------------------------

async function chargerProduitsPublics() {
  const liste = document.getElementById("products-list");
  if (!liste) return;

  liste.replaceChildren(element("p", "Chargement des produits..."));

  try {
    const response = await fetch(`${API_BASE}/api/products`, {
      cache: "no-store"
    });
    const data = await response.json();

    if (!response.ok || data.success === false) {
      throw new Error(data.message || "Erreur de chargement des produits.");
    }

    const produits = Array.isArray(data.products) ? data.products : [];
    liste.replaceChildren();

    if (!produits.length) {
      liste.appendChild(element("p", "Aucun produit publié pour le moment."));
      return;
    }

    produits.forEach(produit => {
      const card = element("article", null, "service-card");

      if (produit.image_url && /^https?:\/\//i.test(produit.image_url)) {
        const image = element("img", null, "service-photo");
        image.src = produit.image_url;
        image.alt = produit.name || "Photo du produit";
        image.loading = "lazy";
        image.onerror = () => image.remove();
        card.appendChild(image);
      }

      card.appendChild(element("h3", produit.name || "Produit"));
      card.appendChild(element("p", produit.description || "Contactez-nous pour plus d'informations."));

      const currency = produit.currency || "USD";
      const price = Number(produit.price);
      card.appendChild(element(
        "strong",
        Number.isFinite(price) ? `Prix : ${price.toFixed(2)} ${currency}` : "Prix : sur demande"
      ));

      card.appendChild(element(
        "p",
        produit.product_type === "digital" ? "Produit numérique" : "Produit physique"
      ));

      if (produit.product_type === "physical" && Number.isFinite(Number(produit.stock))) {
        card.appendChild(element(
          "p",
          Number(produit.stock) > 0 ? `Stock disponible : ${produit.stock}` : "Rupture de stock"
        ));
      }

      const link = element("a", "Commander sur WhatsApp");
      link.href = `https://wa.me/${numeroWhatsApp}?text=${encodeURIComponent(
        "Bonjour DRBCK TECH.IT.PRO, je souhaite commander : " + (produit.name || "ce produit")
      )}`;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      if (produit.product_type === "physical" && Number(produit.stock) === 0) {
        link.textContent = "Demander la disponibilité";
      }
      card.appendChild(link);

      const orderButton = element("button", "Commander sur le site");
      orderButton.type = "button";
      orderButton.className = "btn";
      const orderForm = document.createElement("form");
      orderForm.hidden = true;
      orderForm.className = "product-order-form";
      const nameInput = document.createElement("input");
      nameInput.name = "customer_name";
      nameInput.placeholder = "Votre nom complet";
      nameInput.required = true;
      nameInput.maxLength = 120;
      const phoneInput = document.createElement("input");
      phoneInput.name = "customer_phone";
      phoneInput.placeholder = "Votre numéro de téléphone";
      phoneInput.required = true;
      phoneInput.maxLength = 40;
      const emailInput = document.createElement("input");
      emailInput.name = "customer_email";
      emailInput.type = "email";
      emailInput.placeholder = "E-mail (facultatif)";
      emailInput.maxLength = 180;
      const quantityInput = document.createElement("input");
      quantityInput.name = "quantity";
      quantityInput.type = "number";
      quantityInput.min = "1";
      quantityInput.max = "50";
      quantityInput.value = "1";
      quantityInput.required = true;
      const submitOrder = element("button", "Envoyer la commande");
      submitOrder.type = "submit";
      const orderMessage = element("p", "");
      orderMessage.setAttribute("aria-live", "polite");
      orderForm.append(nameInput, phoneInput, emailInput, quantityInput, submitOrder, orderMessage);
      orderButton.addEventListener("click", () => {
        orderForm.hidden = !orderForm.hidden;
        if (!orderForm.hidden) nameInput.focus();
      });
      orderForm.addEventListener("submit", async event => {
        event.preventDefault();
        submitOrder.disabled = true;
        let orderCreated = false;
        orderMessage.textContent = "Enregistrement de votre commande...";
        try {
          const response = await fetch(`${API_BASE}/api/orders`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              product_id: produit.id,
              customer_name: nameInput.value.trim(),
              customer_phone: phoneInput.value.trim(),
              customer_email: emailInput.value.trim(),
              quantity: Number(quantityInput.value)
            })
          });
          const result = await response.json();
          if (!response.ok || !result.success) throw new Error(result.message || "Impossible d'enregistrer la commande.");
          orderCreated = true;
          nameInput.disabled = true;
          phoneInput.disabled = true;
          emailInput.disabled = true;
          quantityInput.disabled = true;
          submitOrder.textContent = "Commande enregistrée";
          orderMessage.textContent = "Commande " + result.order.order_number + " enregistrée. Total : " +
            Number(result.order.total_amount).toFixed(2) + " " + result.order.currency +
            ". Paiement en attente de vérification. Notre équipe vous contactera.";
          orderForm.reset();
          quantityInput.value = "1";
          const oldPanel = orderForm.querySelector(".payment-reference-panel");
          if (oldPanel) oldPanel.remove();
          const paymentPanel = document.createElement("section");
          paymentPanel.className = "payment-reference-panel";
          paymentPanel.appendChild(element("h4", "Effectuer le paiement"));
          const paymentInfo = element("p", "Chargement des moyens de paiement...");
          const paymentForm = document.createElement("div");
          const methodSelect = document.createElement("select");
          methodSelect.required = true;
          const referenceInput = document.createElement("input");
          referenceInput.placeholder = "Référence de transaction";
          referenceInput.required = true;
          referenceInput.maxLength = 120;
          const paymentSubmit = element("button", "Envoyer la référence");
          paymentSubmit.type = "button";
          const paymentStatus = element("p", "");
          paymentStatus.setAttribute("aria-live", "polite");
          paymentForm.append(methodSelect, referenceInput, paymentSubmit, paymentStatus);
          paymentPanel.append(paymentInfo, paymentForm);
          orderForm.appendChild(paymentPanel);
          try {
            const methodsResponse = await fetch(`${API_BASE}/api/payment-methods`, { cache: "no-store" });
            const methodsData = await methodsResponse.json();
            const methods = Array.isArray(methodsData.payment_methods) ? methodsData.payment_methods : [];
            methodSelect.replaceChildren();
            methods.forEach(method => {
              const option = document.createElement("option");
              option.value = method.name;
              option.textContent = method.name;
              methodSelect.appendChild(option);
            });
            const showMethodDetails = () => {
              const selected = methods.find(method => method.name === methodSelect.value);
              if (!selected) {
                paymentInfo.textContent = "Aucun moyen de paiement configuré. Contactez-nous sur WhatsApp.";
                return;
              }
              const details = selected.account_details || {};
              const accountText = details.phone ? "Numéro : " + details.phone :
                details.email ? "Compte : " + details.email : "";
              paymentInfo.textContent = [selected.instructions || "", accountText,
                "Le paiement sera confirmé après vérification."].filter(Boolean).join(" ");
            };
            methodSelect.addEventListener("change", showMethodDetails);
            showMethodDetails();
            if (!methods.length) paymentForm.hidden = true;
            paymentSubmit.addEventListener("click", async () => {
              if (!methodSelect.value || !referenceInput.value.trim()) {
                paymentStatus.textContent = "Choisissez un moyen de paiement et saisissez la référence.";
                return;
              }
              paymentSubmit.disabled = true;
              paymentStatus.textContent = "Enregistrement...";
              try {
                const paymentResponse = await fetch(`${API_BASE}/api/orders/${encodeURIComponent(result.order.id)}/payment-reference`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ method: methodSelect.value, transaction_reference: referenceInput.value.trim() })
                });
                const paymentResult = await paymentResponse.json();
                if (!paymentResponse.ok || !paymentResult.success) throw new Error(paymentResult.message || "Référence non enregistrée.");
                paymentStatus.textContent = paymentResult.message;
                referenceInput.value = "";
              } catch (paymentError) {
                paymentStatus.textContent = paymentError.message;
              } finally {
                paymentSubmit.disabled = false;
              }
            });
          } catch (paymentError) {
            paymentInfo.textContent = "Moyens de paiement indisponibles. Contactez-nous sur WhatsApp.";
            paymentForm.hidden = true;
          }
        } catch (error) {
          orderMessage.textContent = error.message;
        } finally {
          submitOrder.disabled = orderCreated;
        }
      });
      card.append(orderButton, orderForm);
      liste.appendChild(card);
    });
  } catch (error) {
    console.error("Erreur produits DRBCK :", error);
    liste.replaceChildren(element(
      "p",
      "La boutique est momentanément indisponible. Contactez-nous sur WhatsApp au +243 972 052 103."
    ));
  }
}

chargerProduitsPublics();

