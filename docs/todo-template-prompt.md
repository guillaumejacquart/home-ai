# Prompt — Modèle « Tâches » (première template)

Copie ce prompt dans la création d'app (nom : `Tâches`) puis itère dans l'éditeur. Conçu pour être généré via la factory (plan → code) puis promu en `templates/todo/`.

---

## Prompt initial (coller tel quel)

```
Crée une app « Tâches » — une todo list familiale simple qui fonctionne en liste ET en tableau (kanban), au choix de l'utilisateur.

Données — une seule clé de stockage table :
- clé `tasks` (table) : chaque tâche a `id` (généré), `title` (string, requis), `status` (`todo` | `doing` | `done`), `priority` (`low` | `medium` | `high`), `dueDate` (string `YYYY-MM-DD` ou vide), `category` (string, ex. Maison/Travail/Courses ou vide), `createdAt` (ISO). Ajoute aussi une clé `prefs` (kv) de type `{ view: "list" | "board" }` pour mémoriser la vue choisie.

Stockage déclaré :
- laisse en commentaire HTML `<!-- storage: tasks, prefs -->`
- et un manifeste dans `<script type="application/json" id="home-manifest">` qui déclare :
  storages: [{ key:"tasks", kind:"table", description:"Tâches de la famille", schema:{ type:"object", properties:{ title:{type:"string"}, status:{type:"string"}, priority:{type:"string"}, dueDate:{type:"string"}, category:{type:"string"}, createdAt:{type:"string"} }, required:["title","status"] }}, { key:"prefs", kind:"kv", description:"Préférences d'affichage" }]
  tools: [
    { name:"add_task", description:"Ajoute une tâche", parameters:{ type:"object", properties:{ title:{type:"string"}, priority:{type:"string"}, dueDate:{type:"string"}, category:{type:"string"} }, required:["title"] }, storage:{ op:"append", key:"tasks" } },
    { name:"list_tasks", description:"Liste toutes les tâches", storage:{ op:"list", key:"tasks" } },
    { name:"update_task", description:"Met à jour une tâche (statut, priorité, titre, date, catégorie)", parameters:{ type:"object", properties:{ id:{type:"string"}, patch:{type:"object"} }, required:["id","patch"] }, storage:{ op:"update", key:"tasks" } },
    { name:"remove_task", description:"Supprime une tâche", parameters:{ type:"object", properties:{ id:{type:"string"} }, required:["id"] }, storage:{ op:"remove", key:"tasks" } }
  ]

Interface — en français, sobre, Tailwind + Alpine (fournis par la plateforme) :
- Structure globale : `function app()` exposée globalement + `x-data="app()"` sur le conteneur racine. Pas de `Alpine.data`, pas de `alpine:init`.
- Header : titre « Tâches », champ d'ajout rapide (input + bouton « Ajouter »), compteur « X tâches ».
- Switch « Liste / Tableau » (deux boutons) : persistant via `homeSDK.storage.get/set("prefs")` et `prefs.view`. Au chargement, lire `prefs` puis `tasks`.
- Liste utilise uniquement `homeSDK.storage.table.*` (add/update/remove) et `homeSDK.storage.get/set` pour prefs — jamais localStorage/sessionStorage.
- Vue Liste : filtre par statut (filtres « Toutes / À faire / En cours / Terminées ») + filtre par catégorie (datalist dérivée des valeurs existantes, « Toutes catégories » par défaut), tri par priorité puis dueDate, chaque ligne avec checkbox (passe `done` via `storage.table.update(tasks, id, {status})`), édition inline du titre au double-clic, sélecteurs priorité, dueDate et catégorie (avec datalist), badges catégorie/priorité, bouton supprimer. État vide soigné.
- Vue Tableau (kanban) : 3 colonnes « À faire » / « En cours » / « Terminé », drag & drop HTML5 natif entre colonnes (sans librairie externe) qui appelle `storage.table.update(tasks, id, {status: newStatus})`. Cartes avec titre, badge priorité couleur + badge catégorie violet, dueDate. Compteur par colonne. Filtre catégorie s'applique aussi au tableau.
- Toute écriture passe par `storage.table.*` (opérations ligne atomiques) pour éviter les conflits.

Contraintes plateforme : pas de fetch direct, uniquement `homeSDK`. Réponses JSON. Code HTML autonome complet.
```

---

## Après génération

1. Vérifier dans l'aperçu : ajouter une tâche, basculer Liste/Tableau, déplacer une carte par drag & drop, vérifier que le switch persiste après reload.
2. Tester via l'assistant : « ajoute une tâche acheter du pain en priorité haute » → doit appeler `add_task`.
3. Itérer par petits prompts (« ajoute un filtre par priorité », « colore les tâches en retard », etc.) si besoin.
4. Quand satisfaisant : récupérer le HTML final (`GET /api/apps/[id]/html`) et le promouvoir :
   - `templates/todo/template.json` : `{ "name":"Tâches", "description":"Liste et tableau kanban pour la famille — avec drag & drop et filtres.", "tags":["productivité","famille"] }`
   - `templates/todo/app.html` : le HTML final
5. Vérifier `GET /api/templates` liste bien `todo`, puis `POST /api/templates/todo/install` crée une app fonctionnelle.
