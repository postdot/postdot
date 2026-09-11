# Herald — audit critique des fondations

Date : 11 septembre 2026. Référence finale : `main`, commit `60bbb319` (`merge: consolidate local work into main`). Rapport de diagnostic ; aucune correction, nouvelle décision normative ou modification du backlog.

## Verdict

**Herald possède des fondations techniques sérieuses, mais la cohérence de son intégration ne permet pas encore de considérer tous ses contrats comme fiables.** Je recommande de conserver l’architecture et de consacrer les prochaines sessions à sa consolidation avant une nouvelle expansion fonctionnelle.

Le modèle Post / Publication, la séparation Channel / Publisher, les révisions immuables, le journal transactionnel et la reconnaissance explicite des résultats externes ambigus répondent à de vrais problèmes du produit. Le monolithe avec SQLite convient au déploiement prévu. Rien dans cet audit ne justifie une réécriture, une migration immédiate vers PostgreSQL, un moteur de workflow externe ou des microservices.

En revanche, des fonctions récentes ne prolongent pas toujours les garanties existantes. Les rôles sont définis sans être imposés partout ; le temps réel protège l’ouverture d’une connexion mais pas sa durée de vie ; le calendrier et la Queue consomment une liste tronquée ; une projection durable peut cesser de rattraper son retard tout en se déclarant active. Ce sont des défauts de produit, pas de simples préférences de style.

## Lecture des rapports

1. [Sécurité et autorisations](/home/hakim/projects/herald/.autonomos/worklogs/2026-09-11-herald-audit/01-securite-et-acces.md) — rôles, révocation et protections existantes.
2. [Fiabilité, données et exploitation](/home/hakim/projects/herald/.autonomos/worklogs/2026-09-11-herald-audit/02-fiabilite-donnees-exploitation.md) — listes, notifications, nettoyage et arrêt du processus.
3. [Architecture, client et qualité](/home/hakim/projects/herald/.autonomos/worklogs/2026-09-11-herald-audit/03-architecture-client-qualite.md) — cohérence, coût de maintenance et angles morts des contrôles.
4. [Suite à court, moyen et long terme](/home/hakim/projects/herald/.autonomos/worklogs/2026-09-11-herald-audit/04-suite-proposee.md) — ordre recommandé et critères de sortie des futures sessions.
5. [Méthode et preuves](/home/hakim/projects/herald/.autonomos/worklogs/2026-09-11-herald-audit/05-verification.md) — contrôles exécutés, reproductions, limites et hypothèses écartées.

## Constats prioritaires

| ID | Priorité | Constat | Preuve |
| --- | --- | --- | --- |
| H-01 | P1 | Un viewer peut créer un canal et un post malgré son rôle en lecture seule | Reproduction par l’API en mémoire : HTTP 201 pour les deux opérations |
| H-02 | P1 | Un membre retiré continue de recevoir des événements projet sur son SSE ouvert | Nouvelle requête refusée en 404, événement ultérieur reçu sur l’ancien flux |
| H-03 | P1 | La liste des publications est limitée à 100 sans pagination exploitable | 101 lignes stockées, 100 retournées, aucun curseur dans la réponse |
| H-04 | P2 | Le rattrapage des notifications s’arrête après dix lots et peut rester incomplet | Runtime demandant douze lots : dix exécutés, état `started` |
| H-05 | P2 | Les événements de taxonomie sont exclus de la diffusion SSE | Événement réel `publication.tags_replaced` transformé en `null` |
| H-06 | P2 | La commande `clean` supprime les migrations suivies dans Git | Script `@herald/db`: `rimraf dist .turbo drizzle` |
| H-07 | P2 | Les tests des scripts et du CLI ne font pas partie de `bun run check` | Graphe Turbo : seulement les workspaces ; huit tests supplémentaires exécutés séparément |

P1 signifie à corriger en priorité avant de se fier à la fonction concernée en usage partagé ou soutenu. P2 désigne un défaut réel dont le déclenchement ou l’impact est plus circonscrit. Aucun P0 démontré. Une base conservée mais mal affichée n’est pas une base ayant perdu ses données.

## Bilan équilibré

| Domaine | Appréciation |
| --- | --- |
| Modèle métier et publication durable | Bonne fondation ; conserver les distinctions et les invariants |
| Isolation entre projets | Contrôles d’accès présents ; cet audit ne démontre pas de traversée générale entre projets |
| Rôles et révocation | Garantie incomplète et défauts reproduits |
| Médias et secrets | Frontières utiles et tests substantiels ; pas de certification exhaustive |
| Client web | Surface réelle et testée, mais dépendante d’un contrat de liste incomplet et de signaux d’invalidation incomplets |
| Exploitation | Sauvegarde/restauration pensées sérieusement ; garanties de reprise et d’arrêt à compléter |
| Qualité | Contrôles réels qui passent ; matrice de comportements encore incomplète |

Sur l’état final : `bun run check` réussit, dont **16 tests navigateur**. Une exécution forcée séparée confirme **566 tests de workspaces réussis, sans cache**. Les **8 tests de scripts** passent aussi lorsqu’on les lance explicitement. Ces résultats sont une base positive, mais ne réfutent pas les défauts reproduits.

## Interprétation du travail produit par agents

L’origine IA n’est pas une preuve de mauvaise qualité. Les indices observables sont plutôt ceux d’un développement par tranches : plusieurs contrats parallèles, des tableaux d’événements recopiés, des tests qui suivent les parcours ajoutés et des anciennes hypothèses conservées dans des fonctions désormais utilisées plus largement.

Exemples concrets : le passage à la collaboration n’a pas remplacé partout le contrôle « un acteur existe » par un contrôle de rôle ; l’ajout de tags n’a pas étendu la liste des événements SSE ; une liste bornée est devenue la source du calendrier. L’effort suivant doit porter sur ces jonctions et sur leurs scénarios négatifs, davantage que sur le nombre de fonctionnalités ou le découpage mécanique des fichiers.

## Limites

Audit de code et de contrats, accompagné de tests locaux isolés. Aucun appel à un fournisseur réel, aucune inspection de secrets ou de données utilisateur, aucun test destructif sur une installation existante. Pas de campagne exhaustive de sécurité, de test de charge complet, de validation S3 réelle ni de nouvelle construction/restauration Docker. Les constats visuels se limitent aux preuves des tests navigateur et à la structure du client ; ceci n’est pas un nouvel audit visuel complet.
