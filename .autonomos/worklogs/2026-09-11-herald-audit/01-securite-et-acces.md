# Sécurité et accès

Référence : `main@60bbb319`. Les deux défauts ci-dessous ont été reproduits avec des comptes fictifs, une base SQLite en mémoire et `app.handle`, sans serveur partagé ni fournisseur externe.

## H-01 — P1 — Le rôle viewer n’interdit pas toutes les écritures

**Contrat attendu.** [ADR-061](/home/hakim/projects/herald/.autonomos/decisions/ADR-061-human-account-and-instance-access-policy.md:83) définit le viewer comme un membre en lecture seule. Le même contrat autorise les écritures opérationnelles à l’editor et réserve la gestion des accès à l’owner.

**Comportement observé.** Après création d’un utilisateur non administrateur et ajout comme viewer d’un projet :

- `PATCH /api/projects/:id` pour modifier le fuseau renvoie 403, conformément au contrat ;
- `POST /api/projects/:id/channels` renvoie 201 et crée effectivement un canal ;
- `POST /api/projects/:id/posts` renvoie 201 et crée une publication en brouillon.

Le compte a bien le rôle projet `viewer`. Les privilèges administrateur propres au mécanisme de fixtures ont été retirés avant la reproduction.

**Cause.** [La composition des routes](/home/hakim/projects/herald/apps/api/src/modules/projects/index.ts:94) appelle `canAccessProject` sans rôle minimal. [Le store d’accès](/home/hakim/projects/herald/packages/db/src/access-store.ts:904) utilise alors `viewer`. [La création de canal](/home/hakim/projects/herald/apps/api/src/modules/projects/channel-routes.ts:66) délègue directement au store. [Le store](/home/hakim/projects/herald/packages/db/src/manual-store/project-channel-store.ts:338) vérifie la présence du projet et d’un acteur, sans contrôler le rôle. [Le chargement d’acteur](/home/hakim/projects/herald/packages/db/src/manual-store.ts:260) sert à l’attribution mais ne constitue pas une autorisation d’écriture.

**Impact.** Un utilisateur invité en lecture seule peut modifier le contenu du projet. La protection présente dans la page de gestion des membres ou sur la route de fuseau ne protège pas les autres routes. Les autres mutations qui emploient ce modèle demandent une revue systématique ; cet audit ne prétend pas avoir exécuté chacune d’elles ni avoir publié vers un service externe avec un viewer.

**Suite recommandée.** Définir une frontière d’autorisation appliquée à chaque action : lecteur, éditeur, propriétaire, administrateur d’instance et clé projet. Conserver l’acteur comme identité d’audit. Éviter de traiter l’existence historique de cet acteur comme un droit courant. L’emplacement exact du contrôle reste une décision d’implémentation ; aucun remplacement de Better Auth n’est requis.

**Acceptation.** Tester au minimum lecture, création/édition de contenu, promotion, publication manuelle, connexion/déconnexion fournisseur, médias, tags, profils de canaux et gestion des accès pour chaque principal. Vérifier aussi le refus après rétrogradation et retrait. Une requête refusée ne doit laisser ni écriture ni effet externe.

## H-02 — P1 — Une connexion SSE projet survit à la révocation de l’accès

**Reproduction.** Un viewer ouvre `/api/projects/:id/events`. L’owner retire ce membre. Une nouvelle lecture de canaux renvoie 404, preuve que l’appartenance courante a été révoquée. L’owner crée ensuite un canal ; le lecteur de l’ancienne connexion reçoit encore un événement `channel.created`.

**Cause.** [La route SSE](/home/hakim/projects/herald/apps/api/src/modules/projects/realtime-routes.ts:156) contrôle l’accès à l’ouverture. [La boucle du flux](/home/hakim/projects/herald/apps/api/src/modules/projects/realtime-routes.ts:336) contrôle l’annulation de la requête, puis relit le journal du projet ; elle ne reçoit aucun moyen de revalider la session ou l’appartenance. Une révocation n’annule pas automatiquement le `Request.signal` de cette connexion.

**Impact précis.** Le flux contient des identifiants, types d’événements, sujets et horodatages. Son `payload` est vide : la reproduction démontre une fuite de métadonnées et d’activité, pas une fuite de texte des posts ou de tokens. La connexion peut rester ouverte après la disparition du droit qui l’autorisait.

Le flux utilisateur recalcule les projets visibles lors de ses lectures : c’est une protection supplémentaire réelle. Cela ne vaut pas preuve de fermeture sur expiration ou révocation de session. Ces scénarios doivent être testés séparément.

**Suite recommandée.** Coupler les connexions longues à la validité de leur principal, avec fermeture ou revalidation bornée après retrait, bannissement, expiration et déconnexion. Définir le délai de révocation acceptable. Ne pas envoyer de nouveau fait privé après ce délai ; une reconnexion doit refaire tous les contrôles.

## Protections à préserver

- Better Auth détient les identités humaines et les appartenances Organization ; Herald conserve ses règles d’instance et son attribution métier.
- [Les clés projet](/home/hakim/projects/herald/apps/api/src/modules/projects/index.ts:59) sont vérifiées, liées à une organisation et à un projet. La macro refuse le mauvais projet ; les routes de gestion des clés exigent un owner humain.
- [Les mutations Better Auth réservées](/home/hakim/projects/herald/packages/auth/src/index.ts:66) sont bloquées sur le montage HTTP public afin de faire passer les opérations concernées par les routes Herald. Cette liste demande un contrôle de compatibilité à chaque évolution des plugins.
- Les secrets fournisseurs sont séparés des comptes de connexion Herald et chiffrés au repos ; la connexion appartient au projet.
- [L’egress HTTP](/home/hakim/projects/herald/packages/custom-http/src/egress.ts:76) classe les adresses résolues, applique la politique privée et refuse les métadonnées d’infrastructure. [Le transport](/home/hakim/projects/herald/packages/custom-http/src/node-requester.ts:40) emploie l’adresse sélectionnée. C’est une frontière concrète, supérieure à une simple validation de chaîne URL.
- Les contrats de schémas et de médias sont bornés ; ils n’autorisent pas l’exécution de scripts persistés.

Ces protections ne compensent pas H-01 et H-02, mais elles justifient de corriger des frontières ciblées plutôt que de reconstruire toute la sécurité.

## Points non certifiés

Pas de conclusion sur l’absence de toutes les vulnérabilités, de dépendances vulnérables ou de failles d’authentification. Les parcours de vérification d’email, d’administration, d’invitation et les plugins exposent une surface substantielle. Une prochaine revue devrait être guidée par une matrice de permissions et de cycles de vie, avec des versions de dépendances précises.

La [documentation officielle Better Auth sur les sessions](https://better-auth.com/docs/concepts/session-management) a servi de référence pour distinguer session, expiration et révocation. Les constats H-01/H-02 reposent sur Herald et les reproductions locales, pas sur une hypothèse concernant un défaut de Better Auth.
