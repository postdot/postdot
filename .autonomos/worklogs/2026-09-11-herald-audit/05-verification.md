# Méthode, vérifications et preuves

## Périmètre et provenance

Lecture du workflow `.agent/workflows/session.md`, de la chaîne `AGENT.md` des périmètres inspectés, du tableau des tâches, des spécifications et décisions pertinentes. Le workflow distingue explicitement diagnostic et implémentation. Aucune tâche d’implémentation n’a été démarrée.

L’audit avait commencé sur un checkout comportant les changements non commités CHANNEL-142, à partir de `19fbcaed`. Après intervention du propriétaire, la référence a été rétablie sur `main@60bbb319`, arbre propre. Le diff depuis `19fbcaed` correspond aux profils réutilisables et à leurs intégrations. Les constats retenus ont été vérifiés sur l’état final, notamment par le probe ci-dessous et par un nouveau contrôle complet.

Environnement : Linux, Bun 1.4.0, Node v25.9.0, Turbo installé 2.10.12. Les résultats décrivent cet environnement, pas une garantie universelle sur toutes les installations.

Les skills Better Auth et React ont servi de guides de revue. La lecture des sources et des dépendances locales prime pour le comportement de cette révision. Aucun sous-agent n’a été utilisé. Aucun fichier de secrets n’a été inspecté.

## Vérifications exécutées

| Contrôle | Résultat | Portée |
| --- | --- | --- |
| `bun run check` sur main | Succès | Format, lint, TypeScript, tests workspaces, Playwright, build ; plusieurs étapes Turbo ont réutilisé leur cache |
| `bun run test:unit --force` sur main | 566 pass, 0 fail ; 17 workspaces ; 0 cache | Nouvelle exécution effective des suites unitaires et d’intégration des workspaces |
| `bun test scripts` | 8 pass, 0 fail | CLI et gestion des ressources E2E ; hors du gate habituel |
| Playwright inclus dans check | 16 pass, 35,8 s | Processus API/Vite et données jetables propres à l’invocation |
| Build exécuté avant remise sur main, puis réutilisé sur sources identiques | Succès, 17 workspaces | Compilation ; ne vaut pas nouveau build Docker |
| Probes métier sur main | H-01, H-02, H-03 reproduits | Base en mémoire et vraies routes via `app.handle` |
| Probe de projection et transformation d’événement | H-04/H-05 reproduits à leur frontière | Store simulé pour le nombre de lots ; fonction réelle pour la conversion SSE |
| Graphe `turbo run test --dry=json` | 17 tâches, sans tests racine | Confirme le périmètre de H-07 |
| Clone local jetable pour hypothèse de cache | Hypothèse écartée | Un changement du core invalide bien les hashes API et DB dans la configuration actuelle |

Une exécution Playwright antérieure à la remise sur main a donné 15 réussites et un échec sur l’attente du titre « Project invitation ». La nouvelle exécution sur main a réussi. Aucune cause unique n’a été établie : cette observation n’est pas classée comme défaut produit confirmé.

Les logs bruts de travail sont temporaires sous `/tmp/herald-audit-…-20260911.log`. Leurs résultats utiles sont transcrits ici afin que le rapport reste lisible après nettoyage de `/tmp`.

## Niveaux de preuve

- **Reproduction intégrée** : un effet a été observé via l’API avec une base fictive ; H-01, H-02 et H-03.
- **Reproduction ciblée et lecture du raccordement** : une frontière réelle a été exercée et son utilisation vérifiée ; H-04 et H-05. Aucun scénario de charge réel ou double navigateur supplémentaire n’est prétendu.
- **Défaut statique établi** : le script ou le graphe prouve le comportement ; H-06 et H-07. `clean` n’a volontairement pas été exécuté sur le dépôt.
- **Risque à investiguer** : arrêt en cours d’effet, reprise après kill, équité entre projets, coût des rafraîchissements. Ces sujets ne sont pas comptabilisés comme incidents reproduits.

## Sortie des probes

```text
viewer role: viewer
viewer PATCH project (control): 403
viewer POST channel: 201 Created by viewer
viewer POST post: 201 draft
publication history: {"stored":101,"returned":100,"responseKeys":["publications"]}
removed viewer GET channel (control): 404
removed viewer existing SSE receives event: true
projection needing 12 batches: {"processed":10,"state":"started"}
taxonomy mapped to SSE: null
```

Le 422 obtenu lors d’une première ébauche du probe de post provenait d’un corps de requête incorrect dans ce probe. Il a été corrigé selon le schéma réel avant la reproduction finale à 201 ; ce 422 n’était pas un défaut de Herald.

La fixture crée un administrateur et un second utilisateur, puis retire explicitement au second les privilèges administrateur ajoutés par le mode de test. Ce second utilisateur devient viewer du projet. Aucune vraie identité, clé ou destination externe n’est utilisée.

## Probe autonome utilisé

Code de diagnostic temporaire, non installé dans l’application et non ajouté aux suites du dépôt. Il s’exécute avec Bun ; les chemins absolus correspondent au checkout audité. Il effectue ses écritures métier uniquement dans `:memory:`. Il ne démarre pas le worker ni un serveur réseau.

```typescript
import { createAuth } from '/home/hakim/projects/herald/packages/auth/src/index.ts'
import { createDatabase, closeDatabase, runMigrations, createAccessStore, setDatabaseCommitObserver } from '/home/hakim/projects/herald/packages/db/src/index.ts'
import { createApp } from '/home/hakim/projects/herald/apps/api/src/app.ts'
import { createPublisherRuntime } from '/home/hakim/projects/herald/apps/api/src/modules/publishers/runtime.ts'
import { createProjectRealtimeRuntime } from '/home/hakim/projects/herald/apps/api/src/modules/projects/realtime-runtime.ts'
import { createNotificationProjectionRuntime } from '/home/hakim/projects/herald/apps/api/src/modules/notifications/runtime.ts'
import { toProjectRealtimeEvent } from '/home/hakim/projects/herald/apps/api/src/modules/projects/realtime-routes.ts'
const db = createDatabase(':memory:'); runMigrations(db)
const access = createAccessStore(db)
const baseURL = 'http://localhost:3000'
const auth = createAuth(db, {baseURL, secret:'audit-fixture-secret-longer-than-32-characters', access, allowAdditionalSignups:true})
const publisher = createPublisherRuntime(db, {apiOrigin:baseURL,webOrigin:baseURL,publisherEncryptionKey:new Uint8Array(32).fill(9),publisherEncryptionKeyId:'audit-fixture'})
const realtime = createProjectRealtimeRuntime()
const clear = setDatabaseCommitObserver(db, ids => realtime.publish(ids))
const app = createApp({auth,database:db,access,publisher,projectChanges:realtime.hub,userChanges:realtime.userHub})
async function request(path:string,cookie='',method='GET',body?:unknown,signal?:AbortSignal) { return app.handle(new Request(baseURL+path,{method,headers:{cookie,origin:baseURL,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal})) }
async function signup(email:string) {const r=await request('/api/auth/sign-up/email','','POST',{email,name:email,password:'audit-test-password-1234'});if(r.status!==200) throw new Error(await r.text());return r.headers.get('set-cookie')!.split(';')[0]!}
const owner=await signup('audit-owner@example.test');const viewer=await signup('audit-viewer@example.test')
const viewerId=db.$client.query('select id from user where email = ?').get('audit-viewer@example.test').id as string
// Neutralize the fixture-only additional-signup admin role.
db.$client.query("update user set role='user' where id=?").run(viewerId)
db.$client.query("update instance_memberships set role='member' where user_id=?").run(viewerId)
const pr=await request('/api/projects',owner,'POST',{name:'Audit fixture'}); const {project}=await pr.json() as any
const orgId=access.getProjectOrganizationId(project.id)!
const member=await auth.api.addMember({body:{organizationId:orgId,userId:viewerId,role:'viewer'}})
console.log('viewer role:',access.getProjectMembership(project.id,viewerId)?.role)
const denied=await request('/api/projects/'+project.id,viewer,'PATCH',{timeZone:'Europe/Paris'})
console.log('viewer PATCH project (control):',denied.status)
const cr=await request('/api/projects/'+project.id+'/channels',viewer,'POST',{name:'Created by viewer'})
const channelBody=await cr.json() as any; console.log('viewer POST channel:',cr.status,channelBody.channel?.name)
const post=await request('/api/projects/'+project.id+'/posts',viewer,'POST',{title:'Audit post',sourceContent:{body:{text:'Viewer-created content',format:'plain_text'},media:[]},publications:[{channelId:channelBody.channel.id,targetContent:{body:'Viewer-created content',media:[]},deliveryMode:'manual'}]})
const postBody=await post.json() as any;console.log('viewer POST post:',post.status,postBody.publications?.[0]?.state)
for(let i=0;i<100;i++) { const r=await request('/api/projects/'+project.id+'/posts',owner,'POST',{sourceContent:{body:{text:'history '+i,format:'plain_text'},media:[]},publications:[{channelId:channelBody.channel.id,targetContent:{body:'history '+i,media:[]},deliveryMode:'manual'}]});if(r.status!==201) throw new Error('fixture post failed: '+await r.text()) }; const listing=await request('/api/projects/'+project.id+'/publications',owner);const page=await listing.json() as any;console.log('publication history:',JSON.stringify({stored:db.$client.query('select count(*) as n from publications').get().n,returned:page.publications.length,responseKeys:Object.keys(page)}));
const controller=new AbortController()
const sr=await request('/api/projects/'+project.id+'/events',viewer,'GET',undefined,controller.signal)
const reader=sr.body!.getReader(); for(let i=0;i<3;i++) await reader.read()
await auth.api.removeMember({body:{organizationId:orgId,memberIdOrEmail:member.id},headers:new Headers({cookie:owner})})
const blocked=await request('/api/projects/'+project.id+'/channels',viewer)
console.log('removed viewer GET channel (control):',blocked.status)
await request('/api/projects/'+project.id+'/channels',owner,'POST',{name:'Private event after removal'})
const frame=await reader.read();console.log('removed viewer existing SSE receives event:',new TextDecoder().decode(frame.value).includes('channel.created'))
controller.abort();await reader.cancel();clear();realtime.stop();closeDatabase(db)
let batches=0
const projection=createNotificationProjectionRuntime({listProjectIds:()=>['audit'],project:()=>{batches++;return {scanned:100,created:100,hasMore:batches<12}}})
projection.start();await new Promise(r=>setTimeout(r,30));console.log('projection needing 12 batches:',JSON.stringify({processed:batches,state:projection.state}));projection.stop()
console.log('taxonomy mapped to SSE:',toProjectRealtimeEvent({id:'test',cursor:'event:1',projectId:'audit',version:1,name:'publication.tags_replaced',subject:{type:'publication',id:'p'},occurredAt:Date.now(),payload:{}} as any))
```

## Vérification négative du cache

Un clone local partagé, créé sous un répertoire temporaire propre à cet audit, a été inspecté avant/après ajout d’un commentaire au core dans cette seule copie. Les hashes sont passés de :

```text
@herald/core#test cbf97bfbc3bd01b8 -> b4f92e8955dc2ca6
@herald/api#test  77633eef0b88b25f -> 3b484ab4d84da50b
@herald/db#test   7b67bb473c646eca -> 7db3937547b6b84c
globalCacheInputs.hashOfInternalDependencies : changé
```

Le test invalide donc l’hypothèse initiale d’un cache aval forcément périmé faute de `dependsOn`. L’absence de cette option ne suffit pas à diagnostiquer un bug dans la topologie précise de Herald.

## Ce qui n’a pas été vérifié

Pas de fournisseur réel, SMTP réel, S3 réel, rotation réelle de secrets, installation Docker à neuf, restauration d’une installation existante, test d’intrusion complet ou campagne de performance globale. Les tests déjà présents de backup, migration, crypto et conformance ont été exécutés ; cela ne remplace pas toutes ces validations opérationnelles.

Pas d’affirmation que tous les fichiers ont été lus ligne par ligne. La revue a privilégié les frontières de responsabilité et les parcours critiques, puis suivi les indices par recherche ciblée et reproduction. Les différences de style ou la taille d’un fichier n’ont pas été traitées comme bugs.

## Clôture documentaire

Six rapports ont été créés dans ce dossier, sans modifier le code applicatif, les tests du dépôt, `TASKS.md`, `ISSUES.md`, les specs ou les ADR. Les commandes de vérification ont pu régénérer des sorties ignorées habituelles. Aucune correction ni nouvelle règle d’architecture n’a été appliquée.

Crystallization : les constats et suites possibles sont conservés dans ce dossier de rapports. Aucun état de tâche à changer pour ce diagnostic ; aucun `AGENT.md` mis à jour, puisque les recommandations restent à arbitrer dans les prochaines sessions.
