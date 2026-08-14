# Calories — Journal (PWA)

Application de suivi des calories/macros/poids/eau, installable sur iPhone et
Mac, qui fonctionne **hors-ligne en premier** et se synchronise sur votre
propre Google Drive pour retrouver vos données sur tous vos appareils.

## Pourquoi vous ne perdrez pas de données

1. **Chaque saisie est écrite immédiatement dans la base locale du
   téléphone/Mac (IndexedDB)**, avant même toute tentative de synchronisation.
   L'app fonctionne à 100% sans connexion et sans compte Google connecté.
2. La synchronisation Drive ne **remplace jamais** vos données : à chaque
   synchro, l'app télécharge la version du Drive, la **fusionne**
   enregistrement par enregistrement avec la version locale (le plus récent
   des deux gagne, jamais un écrasement global), réécrit le résultat fusionné
   en local, puis le renvoie sur le Drive. Deux appareils modifiés hors-ligne
   puis reconnectés se fusionnent donc sans rien perdre.
3. Une **sauvegarde datée** est automatiquement créée sur le Drive une fois
   par jour (conservée ~14 jours) — un filet de sécurité supplémentaire en
   cas de bug de fusion.
4. Vous pouvez à tout moment **exporter un fichier JSON complet** depuis
   Profil → Sauvegarde locale, et le ré-importer (fusion, jamais un
   écrasement) sur n'importe quel appareil.
5. Le fichier de données vit dans le dossier caché *appDataFolder* de Drive :
   l'app ne peut voir ni toucher aucun autre fichier de votre Drive.

**Limite connue (iOS) :** Safari bloque parfois les cookies tiers utilisés
par Google pour reconnecter silencieusement votre session après avoir quitté
l'app. Si ça arrive, la pastille en haut de l'app affiche « Reconnecter » —
vos données ne sont **pas** perdues, elles restent en local et repartent en
synchro dès que vous retapez sur Google Drive.

## Configurer Google Drive (à faire une seule fois)

1. Allez sur [Google Cloud Console](https://console.cloud.google.com/) et
   créez un nouveau projet (ou réutilisez-en un).
2. **APIs & Services → Bibliothèque** → cherchez « Google Drive API » →
   Activer.
3. **APIs & Services → Écran de consentement OAuth** :
   - Type : *Externe*.
   - Renseignez un nom d'app (« Calories »), votre email en contact.
   - Statut de publication : laissez **Testing** (aucune vérification Google
     n'est nécessaire pour un usage personnel).
   - Dans **Utilisateurs test**, ajoutez votre propre adresse Gmail.
4. **APIs & Services → Identifiants → Créer des identifiants → ID client
   OAuth** :
   - Type d'application : *Application Web*.
   - **Origines JavaScript autorisées**, ajoutez (sans slash final) :
     - `https://VOTRE-COMPTE.github.io` (l'origine de votre GitHub Pages)
     - `http://localhost:8080` (pratique pour tester en local)
   - Créez, puis copiez le **Client ID** généré
     (`....apps.googleusercontent.com`).
5. Ouvrez `js/config.js` et remplacez :
   ```js
   export const GOOGLE_CLIENT_ID = 'REPLACE_WITH_YOUR_CLIENT_ID.apps.googleusercontent.com';
   ```
   par votre vrai Client ID, puis déployez (voir plus bas).

Tant que ce fichier garde la valeur `REPLACE_WITH_...`, l'app fonctionne
normalement en local uniquement (la carte Profil vous l'indique).

## Déployer avec GitHub Pages

1. Dans le repo GitHub → **Settings → Pages**.
2. **Source** : *Deploy from a branch*, branche `main` (ou la branche
   actuelle), dossier `/ (root)`.
3. Votre app sera accessible à :
   `https://VOTRE-COMPTE.github.io/index.html/calorie-tracker/`
   (adaptez selon le nom réel du repo).
4. Vérifiez que cette URL correspond bien à l'origine ajoutée dans les
   *Origines JavaScript autorisées* à l'étape précédente (uniquement le
   `https://VOTRE-COMPTE.github.io`, sans le chemin).

## Installer sur iPhone / Mac

- **iPhone (Safari)** : ouvrez l'URL → bouton Partager → *Sur l'écran
  d'accueil*.
- **Mac (Safari)** : ouvrez l'URL → menu Fichier → *Ajouter au Dock*
  (Safari 17+), ou *Partager → Ajouter au Dock*.
- **Mac (Chrome/Edge)** : icône d'installation dans la barre d'adresse.

## Développement local

Les modules JS (`type="module"`) nécessitent un vrai serveur HTTP (pas
`file://`). Par exemple :
```bash
cd calorie-tracker
python3 -m http.server 8080
# puis ouvrez http://localhost:8080
```
Les icônes de l'app (manifeste + icône iOS) sont encodées directement en
base64 dans `manifest.webmanifest` et `index.html` — aucun fichier binaire
séparé à gérer.

## Limites connues

- **Scan code-barres caméra** : repose sur l'API native `BarcodeDetector`,
  disponible sur Chrome/Android mais pas encore partout sur iOS Safari. Sur
  les appareils non supportés, l'app propose la saisie manuelle du
  code-barres (recherche ensuite via OpenFoodFacts).
- **Recherche d'aliments en ligne** : utilise l'API publique et gratuite
  [OpenFoodFacts](https://world.openfoodfacts.org/). Sans connexion, seuls
  les aliments intégrés et vos aliments personnels restent disponibles.
- **Reconnexion Google silencieuse sur iOS** : voir la note plus haut — sans
  impact sur l'intégrité des données, juste une reconnexion manuelle
  occasionnelle.
