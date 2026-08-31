# Prompt — "Tasks" template (first template)

Paste this prompt into app creation (name: `Tâches`) then iterate in the editor. Meant to be generated via the factory (plan → code) and then promoted to `templates/todo/`.

---

## Initial prompt (paste as-is)

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

## After generation

1. Check in the preview: add a task, switch between List/Board, drag a card via drag & drop, verify the switch persists after reload.
2. Test via the assistant: "add a task buy bread with high priority" → should call `add_task`.
3. Iterate with small prompts ("add a filter by priority", "highlight overdue tasks in red", etc.) as needed.
4. Once satisfied: fetch the final HTML (`GET /api/apps/[id]/html`) and promote it:
   - `templates/todo/template.json`: `{ "name":"Tâches", "description":"Liste et tableau kanban pour la famille — avec drag & drop et filtres.", "tags":["productivité","famille"] }`
   - `templates/todo/app.html`: the final HTML
5. Verify `GET /api/templates` correctly lists `todo`, then `POST /api/templates/todo/install` creates a working app.
