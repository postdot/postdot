# Architecture, client et qualité

Référence : `main@60bbb319`.

## La structure générale est défendable

Le produit est un monolithe modulaire, pas un assemblage de services distribués artificiels. Le core porte les concepts et contrats partagés ; les packages fournisseurs portent les particularités externes ; le package DB porte les transactions et les écritures durables ; l’API compose les adaptateurs et les routes ; le client web utilise les mêmes opérations métier que le CLI.

Il est raisonnable que les transactions métier soient proches du SQL. Les déplacer systématiquement dans un service abstrait « pur » ne serait pas automatiquement une amélioration : l’atomicité, l’optimistic concurrency et les contraintes de révisions doivent rester visibles. En revanche, le fait qu’un store reçoive `subjectId` sans contrat de permission explicite favorise H-01. L’attribution et l’autorisation méritent une séparation plus nette.

## H-05 — P2 — La taxonomie n’invalide pas les autres clients

[Le store de taxonomie](/home/hakim/projects/herald/packages/db/src/taxonomy-store.ts:835) écrit `publication.tags_replaced` dans le journal et signale le commit. Il émet aussi `project_tag.created`, `renamed`, `archived` et `restored`. Ces types n’existent pas dans [la table SSE serveur](/home/hakim/projects/herald/apps/api/src/modules/projects/realtime-routes.ts:17), ni dans [la liste acceptée par le navigateur](/home/hakim/projects/herald/apps/web/src/lib/project-realtime.tsx:13).

La transformation d’un événement `publication.tags_replaced`, version 1, sujet publication, retourne `null`. Le journal contient donc le changement, mais le client distant n’en reçoit pas le signal. Le contexte de données utilise `staleTime: Infinity`, sans refetch au focus ni à la reconnexion réseau Query ; il dépend du pont SSE ou d’une action locale pour se rafraîchir.

**Conséquence.** Dans un autre onglet ou une autre session ouverte, des tags et filtres peuvent rester périmés après une opération réussie. Un autre événement pris en charge, une reconnexion SSE ou un rechargement peut masquer le défaut. La reproduction porte sur le contrat de diffusion ; le scénario à deux navigateurs n’a pas été ajouté aux tests du dépôt pendant cet audit.

**Correction à préparer.** Relier chaque mutation visible à un contrat explicite d’invalidation et à un test. Partager ou vérifier automatiquement les types d’événements entre serveur et client. Vérifier les événements de taxonomie, les préférences et l’état propre au destinataire de notifications ; ne pas supposer qu’une ligne dans le journal est forcément diffusée.

## H-07 — P2 — Le contrôle complet omet huit tests de scripts

[La racine](/home/hakim/projects/herald/package.json:18) définit `test:unit` comme `turbo test`. Le graphe comprend les 17 workspaces, pas les tests de la racine sous `scripts/`. `test:e2e` ne les exécute pas non plus. La CI appelle ce même `bun run check`.

[Les tests du CLI](/home/hakim/projects/herald/scripts/herald.test.ts) vérifient notamment le choix session/clé projet et la gestion de tokens. [Les tests d’isolation E2E](/home/hakim/projects/herald/scripts/e2e-runtime.test.ts) vérifient répertoires, ports et réutilisation du runtime parent. Les huit tests passent avec `bun test scripts`, mais leur succès n’est pas exigé par le contrôle standard.

**Correction à préparer.** Ajouter leur exécution au gate et maintenir un inventaire simple des familles de tests requises. Le test d’acceptation doit montrer qu’une régression volontaire dans cette famille échoue dans le contrôle standard d’une copie jetable.

## Qualité des tests : réelle, mais concentrée sur les parcours connus

L’exécution forcée donne 566 tests répartis sur 17 workspaces. Beaucoup portent sur les révisions, les états invalides, l’ambiguïté, les médias ou les frontières de providers. Ce ne sont pas des commandes factices. Les 16 scénarios Playwright couvrent aussi médias, gestion des accès, états vides/remplis, récupération et temps réel.

Cependant, [le test de rôles existant](/home/hakim/projects/herald/apps/api/src/app.test.ts:1582) vérifie un refus de modification de fuseau pour le viewer et des restrictions de token, sans prouver le refus des écritures de canal ou de post. Le défaut n’est pas « il manque plus de tests » en général : il manque des tests transversaux dérivés des permissions et des invariants plutôt que seulement du périmètre de chaque tâche.

L’exécution navigateur avant la remise en ordre des branches avait échoué sur l’affichage d’une invitation. Sur `main`, le contrôle complet est passé. L’échec préalable est conservé comme observation de vérification, pas présenté comme un bug stable de `main` ni attribué sans preuve à la branche ou au produit.

## Coût de maintenance et cohérence du client

| Périmètre, hors tests et code généré | Fichiers TS/TSX | Lignes |
| --- | ---: | ---: |
| API | 66 | 15 420 |
| Web | 92 | 17 418 |
| DB | 46 | 23 530 |
| Core | 21 | 6 013 |

Ce sont des mesures de taille, pas des scores de qualité. Le store analytics approche 2 000 lignes, le store média 1 661 ; l’éditeur de publication atteint 803 lignes. Les extractions précédentes du manual store sont utiles, mais découper encore sans clarifier les contrats n’empêcherait pas les défauts constatés.

**Chargement global.** [Le contexte projet](/home/hakim/projects/herald/apps/web/src/lib/dashboard-context.tsx:44) charge ensemble cinq ressources. [Le pont SSE](/home/hakim/projects/herald/apps/web/src/lib/project-realtime.tsx:345) invalide cette donnée projet plusieurs fois sur une fenêtre de rattrapage. Ce mécanisme peut recharger canaux, publications, connexions et tags pour un changement limité. Après H-03, augmenter les volumes sans revoir cette granularité accentuerait le coût. Mesurer le nombre de requêtes, la taille des réponses et le délai visible lors d’une rafale avant toute optimisation.

**Prototype toujours livré.** [La route de prototype temps réel](/home/hakim/projects/herald/apps/web/src/routes/dashboard/projects/$projectId/realtime-prototype.tsx) reste compilée dans l’application. Le build produit un chunk d’environ 318,68 kB non compressé, 88,65 kB gzip, pour ce prototype. C’est un chunk séparé : il serait faux de l’imputer entièrement au chargement initial. Décider de conserver cette surface comme outil explicite de diagnostic ou de la sortir du produit ; entretenir deux prototypes et leurs dépendances sans statut clair augmente la maintenance.

**Typage.** Les contournements autour d’Elysia beta et Better Auth sont localisés et expliqués, notamment les `as unknown as` de leurs frontières. Ce compromis n’est pas une faute en soi. Les contrats exportés doivent néanmoins être éprouvés par des requêtes réelles, car un type reconstitué à la main ne garantit pas la politique runtime. Ne pas remplacer les frameworks sur cette seule base.

## Gouvernance et documentation

Le dépôt compte 69 décisions et 184 worklogs Markdown au niveau principal inspecté. Cette traçabilité aide à comprendre les choix ; son volume exige aussi une hiérarchie claire entre état accepté actuel, preuves historiques et anciennes instructions.

[SPEC-005](/home/hakim/projects/herald/.autonomos/specs/SPEC-005-continuous-product-scope.md) définit un développement continu et remplace le cadrage V1 de SPEC-001. Plusieurs textes racine conservent le vocabulaire V1. [Le README](/home/hakim/projects/herald/README.md) présente encore une procédure LinkedIn centrée sur le membre et une liste de packages partielle. Le runtime gère désormais plusieurs providers, des applications configurables et les destinations organisation LinkedIn. Ce décalage ne rend pas toutes les instructions fausses, mais fragilise la compréhension des capacités et de leur statut.

Une tâche cochée devrait renvoyer à un comportement vérifié et à ses limites. Le cas H-01 montre que « rôles disponibles dans l’UI et test de rôle sur une route » n’équivaut pas à « rôle appliqué à tout le produit ». Garder les audits historiques ; améliorer les critères de fermeture, sans réécrire rétroactivement les preuves.

## Hypothèse de cache écartée

L’absence de `dependsOn` sur les tests Turbo semblait pouvoir laisser un cache aval périmé après un changement du core. La [documentation officielle Turbo](https://turborepo.dev/docs/crafting-your-repository/configuring-tasks) justifie normalement de vérifier cette dépendance. Une expérimentation en clone local jetable a toutefois montré que, dans ce dépôt, le changement du core modifie le hash global des dépendances internes et invalide aussi les tests API et DB. **Aucun défaut de cache n’est retenu sur cette preuve.**
