# Suite proposée pour les prochaines sessions

Ce document propose un ordre de travail ; il n’accepte aucune nouvelle architecture et ne crée aucune tâche. Les horizons désignent des étapes de maturité, sans promesse de calendrier. [SPEC-005](/home/hakim/projects/herald/.autonomos/specs/SPEC-005-continuous-product-scope.md) reste le cadre de développement continu ; il n’est pas nécessaire d’inventer une V1 pour remettre de l’ordre.

## Court terme — rétablir les garanties déjà promises

| Ordre | Session proposée | Pourquoi maintenant | Critère de sortie |
| --- | --- | --- | --- |
| 1 | Autorisations de toutes les mutations, H-01 | Le rôle lecture seule est déjà proposé aux utilisateurs | Matrice owner/editor/viewer/clé projet couvrant chaque famille de routes ; refus sans écritures ni effets |
| 2 | Révocation des connexions longues, H-02 | Un accès retiré doit cesser d’observer le projet | Flux ouvert fermé ou réautorisé dans un délai défini après retrait, bannissement et expiration |
| 3 | Exhaustivité Queue/calendrier, H-03 | La fonction centrale devient trompeuse dès 101 publications | Pagination stable et calendrier par intervalle ; tests multi-pages, filtres et états historiques |
| 4 | Rattrapage notification et contrat d’événements, H-04/H-05 | Le journal doit réellement alimenter les vues promises | Rattrapage sans nouveau commit ; modifications de tags visibles entre deux clients |
| 5 | Nettoyage et inventaire du gate, H-06/H-07 | Petits changements qui protègent les sessions suivantes | Migrations conservées après clean ; tests CLI/scripts obligatoires dans check |

Les vérifications accompagnent chaque correction ; elles ne sont pas repoussées à la cinquième session. Les corrections petites et indépendantes de H-06/H-07 peuvent être traitées plus tôt si cela facilite le travail. Pour H-01, commencer par la reproduction qui doit échouer avant de généraliser la frontière évite de corriger uniquement les deux routes démontrées.

À ce stade, je différerais l’ajout de nouveaux providers et les nouvelles surfaces analytics. Ce n’est pas une remise en cause de leur intérêt ; le rendement immédiat vient de la fiabilité des capacités déjà exposées.

## Moyen terme — prouver l’usage durable et réduire le coût des évolutions

1. **Arrêt et reprise.** Tester SIGTERM pendant un effet fournisseur simulé lent, pendant une projection et pendant une opération média. Vérifier le drainage, les enregistrements finaux et la propriété du verrou. Définir explicitement le comportement après arrêt forcé.
2. **Base conservée.** Décider quand les données cessent d’être jetables. À partir de cette date, tester chaque migration sur un état antérieur rempli ; vérifier une restauration avec médias et déchiffrement dans un environnement local isolé. Conserver séparément les exigences pour un S3 réel.
3. **Matrice d’intégration.** Croiser rôle × opération × état de publication × mode de livraison, puis ajouter les transitions essentielles : retrait d’accès, conflit de révision, redémarrage, perte de réseau, événement ignoré et destinataire déconnecté. Chercher une couverture des risques plutôt qu’un nombre arbitraire de tests.
4. **Lecture et invalidation web.** Après le contrat paginé, découper les lectures par ressource utile et mesurer les rafraîchissements. Exiger des états partiels exploitables lorsqu’une ressource secondaire échoue. Conserver les primitives UI communes et la localisation.
5. **Expérience opérationnelle.** Montrer clairement retard du scheduler, jobs ambigus, connexions à renouveler, dernière projection réussie et état de la sauvegarde. Les métriques doivent aider à prendre une décision ; ne pas afficher un simple voyant vert pour un retard non traité.
6. **Documentation courante.** Une page courte décrit capacités réellement utilisables, contraintes de déploiement et preuves fournisseur. Les ADR conservent la justification ; les worklogs conservent l’historique. Statuer sur le prototype temps réel livré.

Sortie attendue : un scénario réel maîtrisé peut être exécuté, interrompu, repris et expliqué depuis les outils du produit ; les garanties de rôle, d’historique et de récupération restent vraies sur un projet ancien et partagé.

## Long terme — étendre sur preuve

**Providers.** Approfondir les fournisseurs utilisés : expiration et rotation, changements de scopes, médias, réponses ambiguës, limites et compatibilité d’API. Conserver la conformance commune, mais ne pas confondre réussite d’un mock et validation chez le fournisseur. Les essais publics restent des actions délibérément autorisées dans leurs sessions.

**Analytics.** Préserver la séparation entre fonctionnement de Herald et engagement externe. Exiger provenance, fraîcheur et couverture historique explicites. Ne construire une projection supplémentaire que si les mesures de coût ou de latence le justifient, en s’appuyant sur les travaux existants plutôt qu’en dupliquant leurs contrats.

**Capacité et architecture.** Mesurer tailles de base, temps de requête, retard maximal de publication, mémoire et contention sur des volumes représentatifs. Envisager équité entre projets ou concurrence bornée avant une infrastructure distribuée. SQLite reste défendable tant que ces mesures respectent les objectifs retenus.

**Maintenance.** Toute nouvelle fonction devrait nommer son propriétaire métier, sa politique d’accès, son événement de changement, sa stratégie de reprise, son impact sur sauvegarde/migration et sa preuve de fonctionnement. Ce petit contrat d’intégration est plus utile qu’un nouveau niveau générique d’abstraction.

## Ce que je ne recommande pas sur les preuves actuelles

- Une réécriture de Herald ou un remplacement de stack pour uniformiser le style.
- Redis, Temporal, des microservices ou plusieurs workers sans mesure préalable.
- Une couche universelle de repositories/plugins qui cacherait les transactions existantes.
- La multiplication d’ADRs ou de tests sans comportement précis à protéger.
- Un pourcentage de couverture global comme critère suffisant de fiabilité.

La direction proposée est de **consolider les contrats existants, prouver la durée de vie des données et des accès, puis élargir le produit**. Les concepts fondamentaux méritent d’être conservés ; les preuves d’intégration doivent rattraper l’étendue fonctionnelle.
