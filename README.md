# Repas Healthy

Web app (PWA) pour planifier des menus healthy et équilibrés (½ légumes · ¼ protéines · ¼ féculents complets), générer la liste de courses avec liens vers Leclerc Drive, et cuisiner en mode pas à pas avec minuteurs.

- Aucune dépendance, aucun build : HTML/CSS/JS statiques, hébergés sur GitHub Pages.
- `recipes.js` : base de recettes (quantités par portion).
- `app.js` : logique (menu, courses, mode cuisine).
- `sw.js` : fonctionnement hors ligne.

## Feuille de route
1. ✅ v1 — menu, liste de courses Leclerc, mode cuisine, données locales
2. Synchronisation temps réel entre téléphones (Supabase) + recettes générées par IA
3. Extension navigateur pour remplir le panier Leclerc automatiquement
