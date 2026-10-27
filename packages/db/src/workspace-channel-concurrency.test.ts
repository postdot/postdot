import { expect, it } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { closeDatabase, createDatabase } from './client'
import { createManualStore } from './manual-store'
import { runMigrations } from './migrations'
import { seedTestWorkspace } from './testing'

it('serializes independent project planners against one shared cadence without partially committing the loser', async () => {
    const root = await mkdtemp(join(tmpdir(), 'postdot-concurrent-planning-'))
    const file = join(root, 'instance.sqlite')
    const database = createDatabase(file)
    const now = 1_800_000_000_000
    const source = `
        const {createDatabase,closeDatabase}=await import(${JSON.stringify(new URL('./client.ts', import.meta.url).href)});
        const {createManualStore}=await import(${JSON.stringify(new URL('./manual-store.ts', import.meta.url).href)});
        const {CadenceConflictError}=await import(${JSON.stringify(new URL('./channel-cadence.ts', import.meta.url).href)});
        const [file,projectId,channelId,index,root]=Bun.argv.slice(-5);
        const database=createDatabase(file);
        try {
            if(database.$client.query('select count(*) as count from posts').get().count!==0) throw new Error('Planner did not observe the initial empty plan');
            await Bun.write(root+'/ready-'+index,'ready');
            const deadline=Date.now()+5000;
            while(!await Bun.file(root+'/go').exists()) {
                if(Date.now()>deadline) throw new Error('Planner barrier timed out');
                await Bun.sleep(5);
            }
            try {
                const created=createManualStore(database,{now:()=>${now}}).createPost({
                    projectId,subjectId:'operator',
                    sourceContent:{body:{format:'plain_text',text:'Concurrent plan'},media:[]},
                    publications:[{channelId,deliveryMode:'manual',scheduledAt:${now + 86400000}}]
                });
                console.log(JSON.stringify({outcome:'created',postId:created.post.id}));
            } catch(error) {
                if(!(error instanceof CadenceConflictError)) throw error;
                console.log(JSON.stringify({outcome:'conflict',confirmation:error.confirmation,warnings:error.warnings}));
            }
        } finally {closeDatabase(database)}
    `
    const launch = (projectId: string, channelId: string, index: number) =>
        Bun.spawn(
            [process.execPath, '-e', source, file, projectId, channelId, String(index), root],
            {
                stdin: 'ignore',
                stdout: 'pipe',
                stderr: 'pipe',
            }
        )
    let children: ReturnType<typeof launch>[] = []
    try {
        runMigrations(database)
        const manual = createManualStore(database, { now: () => now })
        const workspaceId = seedTestWorkspace(database)
        const projects = ['First', 'Second'].map(
            name =>
                manual.createProject({
                    workspaceId,
                    name,
                    subjectId: 'operator',
                    displayName: 'Operator',
                }).project
        )
        const channel = manual.createChannel({
            projectId: projects[0]!.id,
            subjectId: 'operator',
            name: 'Shared',
        })!
        const context = manual.sharedChannels.contextFor({
            subjectId: 'operator',
            contextProjectId: projects[0]!.id,
            authorization: {
                authorizeProject: () => true,
                authorizeWorkspace: () => false,
                authorizeSharing: () => true,
            },
        })!
        manual.sharedChannels.attach(context, {
            channelId: channel.id,
            projectId: projects[1]!.id,
            expectedRevision: 1,
        })
        manual.sharedChannels.configureCadence(context, {
            channelId: channel.id,
            expectedRevision: 0,
            timeZone: 'UTC',
            dailyMax: 1,
            weeklyMax: null,
            minimumIntervalMs: null,
        })
        children = projects.map((project, index) => launch(project.id, channel.id, index))
        const deadline = Date.now() + 5000
        while (
            !(
                await Promise.all(
                    [0, 1].map(index => Bun.file(join(root, 'ready-' + index)).exists())
                )
            ).every(Boolean)
        ) {
            if (Date.now() > deadline)
                throw new Error('Independent planners did not reach the barrier')
            await Bun.sleep(5)
        }
        await Bun.write(join(root, 'go'), 'go')
        const results = await Promise.all(
            children.map(async child => {
                const [exitCode, stdout, stderr] = await Promise.all([
                    child.exited,
                    new Response(child.stdout).text(),
                    new Response(child.stderr).text(),
                ])
                expect(stderr).toBe('')
                expect(exitCode).toBe(0)
                return JSON.parse(stdout) as {
                    outcome: string
                    confirmation?: string
                    warnings?: { channelId: string; rule: string; count: number }[]
                }
            })
        )
        expect(results.map(result => result.outcome).sort()).toEqual(['conflict', 'created'])
        const conflict = results.find(result => result.outcome === 'conflict')!
        expect(conflict.confirmation).toHaveLength(64)
        expect(conflict.warnings).toMatchObject([
            { channelId: channel.id, rule: 'daily_max', count: 2 },
        ])
        for (const table of ['posts', 'publications', 'publication_working_drafts'])
            expect(database.$client.query(`select count(*) as count from ${table}`).get()).toEqual({
                count: 1,
            })
        expect(database.$client.query('pragma foreign_key_check').all()).toEqual([])
    } finally {
        for (const child of children) if (child.exitCode === null) child.kill()
        await Promise.all(children.map(child => child.exited))
        closeDatabase(database)
        await rm(root, { recursive: true, force: true })
    }
}, 15000)
