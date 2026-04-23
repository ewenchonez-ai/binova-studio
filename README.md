# Binova Studio

Planning éditorial partagé pour la chaîne Binova — 3 vidéos/semaine (Lun/Mer/Ven), synchronisation YouTube, analyse IA.

---

## Ce que contient le projet

- **Frontend React + Vite** — l'interface que tu connais déjà
- **Netlify Blobs** — stockage partagé entre tous les membres de ton équipe (tout le monde voit le même planning)
- **2 fonctions serverless** :
  - `storage` : lecture/écriture dans le stockage partagé
  - `claude` : proxy vers l'API Anthropic (ta clé reste cachée côté serveur)

---

## Pré-requis

Tu auras besoin de trois comptes gratuits :

1. **[GitHub](https://github.com/signup)** — pour héberger le code
2. **[Netlify](https://netlify.com)** — pour déployer et héberger l'app
3. **[Anthropic Console](https://console.anthropic.com)** — pour obtenir une clé API (l'analyse IA est payante à l'usage mais très bon marché, environ 0,01 à 0,03 € par analyse)

Et optionnellement :
4. **[Google Cloud Console](https://console.cloud.google.com/apis/credentials)** — pour la clé YouTube Data API v3 (gratuite, 10 000 requêtes/jour)

---

## Déploiement — étape par étape

### 1. Mettre le code sur GitHub

```bash
cd binova-studio
git init
git add .
git commit -m "Initial commit"
```

Crée un nouveau repo sur GitHub (privé de préférence), puis :

```bash
git remote add origin https://github.com/TON-PSEUDO/binova-studio.git
git branch -M main
git push -u origin main
```

### 2. Connecter Netlify à GitHub

1. Va sur [app.netlify.com](https://app.netlify.com) et clique sur **Add new site** → **Import an existing project**
2. Choisis GitHub, autorise Netlify, sélectionne ton repo `binova-studio`
3. Netlify détecte automatiquement la config depuis `netlify.toml`. Laisse les réglages par défaut :
   - Build command : `npm run build`
   - Publish directory : `dist`
4. Clique sur **Deploy site**

Le premier build prend ~1 minute. Netlify te donne ensuite une URL du type `https://binova-studio-XXXX.netlify.app`. Tu peux la renommer dans **Site configuration → Site details → Change site name**.

### 3. Configurer la clé Anthropic (pour l'analyse IA)

1. Récupère une clé sur [console.anthropic.com](https://console.anthropic.com) → **API Keys** → **Create Key**
2. Dans Netlify, va dans **Site configuration → Environment variables → Add a variable**
3. Crée :
   - **Key** : `ANTHROPIC_API_KEY`
   - **Value** : ta clé (commence par `sk-ant-...`)
   - Coche toutes les scopes (Builds + Functions + Runtime)
4. Redeploie une fois depuis **Deploys → Trigger deploy → Deploy site**

### 4. Activer Netlify Blobs (stockage partagé)

Sur le plan gratuit de Netlify, Blobs est actif par défaut dès que tu déploies une fonction qui l'utilise. **Rien à configurer.**

Tu peux voir/gérer les blobs sur **Site configuration → Blobs**.

### 5. Configurer la clé YouTube dans l'app

Une fois l'app en ligne :
1. Ouvre l'app, clique sur l'icône ⚙️ en haut à droite
2. Colle ta clé YouTube Data API v3 (obtenue sur [Google Cloud Console](https://console.cloud.google.com/apis/credentials))
3. (Recommandé) Sur Google Cloud, restreins ta clé par **HTTP referrer** à l'URL de ton app Netlify pour qu'elle ne soit pas utilisable ailleurs

La clé est stockée dans Netlify Blobs, partagée entre toi et ta team.

---

## Développement local (optionnel)

Si tu veux modifier l'app sur ta machine :

```bash
npm install
npm run dev         # Vite seul (sans fonctions)
```

Pour tester les fonctions serverless localement, installe le CLI Netlify :

```bash
npm install -g netlify-cli
netlify login
netlify link       # lie ton dossier à ton site Netlify
netlify dev        # démarre Vite + les fonctions avec Blobs connecté
```

---

## Sécurité & accès équipe

**Par défaut, l'URL est publique.** Quiconque la trouve peut voir et modifier le planning. Pour un usage en petite team, tant que tu ne partages pas l'URL, c'est OK.

Si tu veux une vraie protection :
- **Netlify Identity** (gratuit, recommandé) — ajoute un login. Docs : [docs.netlify.com/security/secure-access-to-sites/identity](https://docs.netlify.com/security/secure-access-to-sites/identity/)
- **Password protection** (plan Netlify Pro, $19/mois) — mot de passe global sur le site

---

## Limites à connaître

- **Netlify free tier** : 125 000 invocations de fonctions/mois, 100 GB de bande passante, 5 GB de Blobs. Largement suffisant pour une équipe de quelques personnes.
- **Miniatures** : on compresse les images à 1280px JPEG 85% avant stockage. Compte ~100 KB par miniature. Tu peux en stocker des milliers sans soucis.
- **Coût Anthropic** : l'analyse IA coûte environ 0,01-0,03 €/analyse (quelques centaines de tokens en entrée, 1 200 max en sortie). Si 5 personnes la lancent 10×/jour pendant 30 jours, tu seras à ~15-40 € de facture max.

---

## Support / évolution

Structure du code :
- `src/App.jsx` — toute l'interface dans un seul fichier
- `src/storage.js` — wrapper autour du stockage
- `netlify/functions/storage.mjs` — fonction backend de stockage
- `netlify/functions/claude.mjs` — proxy API Anthropic

Pour modifier l'interface : édite `src/App.jsx`, commit, push. Netlify redeploie automatiquement.
