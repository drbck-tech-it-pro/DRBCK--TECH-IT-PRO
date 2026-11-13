// NUMERO WHATSAPP
const numeroWhatsApp = "243XXXXXXXXX";

// SERVICES DRBCK TECH.IT.PRO
const services = [
  {
    nom: "Déblocage de téléphone",
    description: "Déblocage de téléphones Android et Apple, toutes marques.",
    prix: "5 à 20 $",
    photo: "https://images.unsplash.com/photo-1511709268805-4e9c2d4c3b7d?w=700"
  },
  {
    nom: "Installation Windows",
    description: "Installation et configuration de Windows.",
    prix: "10 $",
    photo: "https://images.unsplash.com/photo-1498050108023-c5249f4df085?w=700"
  },
  {
    nom: "Installation Microsoft Office",
    description: "Installation des logiciels bureautiques.",
    prix: "5 $",
    photo: "https://images.unsplash.com/photo-1516321318423-f06f85e504b3?w=700"
  },
  {
    nom: "Maintenance informatique",
    description: "Entretien et dépannage des ordinateurs.",
    prix: "10 $",
    photo: "https://images.unsplash.com/photo-1581092918056-0c4c3acd3789?w=700"
  },
  {
    nom: "Réparation logicielle",
    description: "Correction des problèmes logiciels.",
    prix: "10 $",
    photo: "https://images.unsplash.com/photo-1518770660439-4636190af475?w=700"
  },
  {
    nom: "Installation de logiciels",
    description: "Installation des programmes nécessaires.",
    prix: "5 $",
    photo: "https://images.unsplash.com/photo-1498050108023-c5249f4df085?w=700"
  },
  {
    nom: "Suppression de virus",
    description: "Nettoyage et protection de votre appareil.",
    prix: "10 $",
    photo: "https://images.unsplash.com/photo-1550751827-4bd374c3f58b?w=700"
  },
  {
    nom: "Récupération de données",
    description: "Récupération de fichiers lorsque c'est possible.",
    prix: "À partir de 10 $",
    photo: "https://images.unsplash.com/photo-1531492746076-161ca9bcad58?w=700"
  },
  {
    nom: "Configuration de téléphone",
    description: "Configuration et assistance pour votre téléphone.",
    prix: "5 $",
    photo: "https://images.unsplash.com/photo-1511709268805-4e9c2d4c3b7d?w=700"
  },
  {
    nom: "Assistance informatique",
    description: "Conseils et aide en informatique.",
    prix: "5 $",
    photo: "https://images.unsplash.com/photo-1516321318423-f06f85e504b3?w=700"
  }
];

// AFFICHAGE DES SERVICES
const liste = document.getElementById("services-list");

if (liste) {
  services.forEach(function(service) {
    const carte = document.createElement("div");

    carte.className = "service-card";

    carte.innerHTML = `
      <img
        src="${service.photo}"
        alt="${service.nom}"
        class="service-photo"
        loading="lazy"
      >

      <h3>${service.nom}</h3>

      <p>${service.description}</p>

      <strong>Prix : ${service.prix}</strong>

      <br><br>

      <a
        href="https://wa.me/${numeroWhatsApp}?text=${encodeURIComponent(
          "Bonjour DRBCK TECH.IT.PRO, je souhaite commander : " + service.nom
        )}"
        target="_blank"
      >
        Commander sur WhatsApp
      </a>
    `;

    liste.appendChild(carte);
  });
}

// BOUTON WHATSAPP PRINCIPAL
const boutonWhatsApp = document.getElementById("whatsapp-link");

if (boutonWhatsApp) {
  boutonWhatsApp.href = "https://wa.me/" + numeroWhatsApp;
  boutonWhatsApp.target = "_blank";
}