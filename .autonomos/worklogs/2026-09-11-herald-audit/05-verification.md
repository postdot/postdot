# Method, checks, and evidence

## Scope and provenance

Read the `.agent/workflows/session.md` workflow, the scoped `AGENT.md` chain, the task table, and relevant specifications and decisions. The workflow explicitly distinguishes diagnosis from implementation. No implementation task was started.

The audit began on a checkout with uncommitted CHANNEL-142 changes, based on `19fbcaed`. After owner intervention, the reference was restored to a clean `main@60bbb319`. The diff from `19fbcaed` contains reusable profiles and their integrations. Findings were checked on the final state, including the probe below and a new full check.

Environment: Linux, Bun 1.4.0, Node v25.9.0, Turbo 2.10.12. Results describe this environment and are not a universal guarantee for every installation.

Better Auth and React skills were used as review guides. Local source and dependency behavior takes precedence for this revision. No sub-agent was used. No secret file was inspected.

## Executed checks

| Check | Result | Scope |
| --- | --- | --- |
| `bun run check` on main | Passed | Format, lint, TypeScript, workspace tests, Playwright, and build; several Turbo steps reused cache |
| `bun run test:unit --force` on main | 566 passed, 0 failed; 17 workspaces; 0 cache | Fresh workspace unit and integration suites |
| `bun test scripts` | 8 passed, 0 failed | CLI and E2E resource management; outside the usual gate |
| Playwright included in check | 16 passed, 35.8 s | API/Vite processes and per-invocation disposable data |
| Build before returning to main, then reused from identical sources | Passed, 17 workspaces | Compilation; not a new Docker build |
| Domain probes on main | H-01, H-02, H-03 reproduced | In-memory database and real routes through `app.handle` |
| Projection and event-transformation probe | H-04/H-05 reproduced at their boundary | Simulated batch count and real SSE conversion function |
| `turbo run test --dry=json` graph | 17 tasks, no root tests | Confirms H-07 scope |
| Disposable local clone for cache hypothesis | Hypothesis rejected | Core change invalidated API and DB hashes in the current configuration |

A browser run before branch cleanup produced 15 passes and one failure waiting for the “Project invitation” title. The new run on main passed. No single cause was established; the observation is not classified as a stable main product defect.

Temporary raw work logs lived under `/tmp/herald-audit-…-20260911.log`. Useful results are transcribed here so the report remains readable after temporary cleanup.

## Evidence levels

- **Integrated reproduction:** an effect was observed through the API with a fictional database; H-01, H-02, and H-03.
- **Targeted reproduction and connection review:** a real boundary was exercised and its use verified; H-04 and H-05. No real load scenario or additional two-browser claim is made.
- **Established static defect:** a script or graph proves the behavior; H-06 and H-07. `clean` was intentionally not run on the repository.
- **Risk to investigate:** stopping during an effect, recovery after kill, fairness across projects, and refresh cost. These are not counted as reproduced incidents.

## Probe output

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

The 422 returned by an early version of the post probe came from an incorrect request body in that probe. It was corrected against the actual schema before the final 201 reproduction; the 422 was not a Herald defect.

The fixture creates an administrator and a second user, then explicitly removes the second user's administrator privileges added by the test mode. That user becomes a project viewer. No real identity, key, or external destination is used.

## Autonomous probe used

Temporary diagnostic code, not installed in the application and not added to repository suites. It runs with Bun; absolute paths refer to the audited checkout. Business writes occur only in `:memory:`. It does not start the worker or a network server.

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

## Negative cache verification

A shared local clone created under an audit-specific temporary directory was inspected before and after adding a comment to core in that copy. Hashes changed as follows:

```text
@herald/core#test cbf97bfbc3bd01b8 -> b4f92e8955dc2ca6
@herald/api#test  77633eef0b88b25f -> 3b484ab4d84da50b
@herald/db#test   7b67bb473c646eca -> 7db3937547b6b84c
globalCacheInputs.hashOfInternalDependencies : changed
```

The test invalidates the original hypothesis that downstream cache entries are necessarily stale without `dependsOn`. The absence of that option is not enough to diagnose a bug in Herald's exact topology.

## Not verified

No real provider, SMTP, S3, real secret rotation, clean Docker installation, restore of an existing installation, full penetration test, or global performance campaign was performed. Existing backup, migration, crypto, and conformance tests were run; they do not replace these operational validations.

There is no claim that every file was read line by line. The review prioritized responsibility boundaries and critical journeys, then followed targeted search clues and reproductions. Style differences and file size were not treated as defects.

## Documentation closure

Six reports were created in this directory without changing application code, repository tests, `TASKS.md`, `ISSUES.md`, specifications, or ADRs. Verification commands may have regenerated the usual ignored outputs. No fix or new architecture rule was applied.

Crystallization: findings and possible follow-ups are kept in this report set. No task state changed for this diagnosis; no `AGENT.md` was updated because the recommendations still required decisions in future sessions.
