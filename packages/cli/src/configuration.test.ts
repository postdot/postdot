import { expect, test } from 'bun:test'
import {
    chmodSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    statSync,
    symlinkSync,
    writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
    addProfile,
    clearCredential,
    readConfiguration,
    removeProfile,
    resolveConnection,
    saveCredential,
    selectedProfile,
    setProject,
    useProfile,
} from './configuration'

function isolated(run: (options: { configDir: string }) => void) {
    const configDir = mkdtempSync(join(tmpdir(), 'postdot-cli-config-'))
    const keys = [
        'POSTDOT_PROFILE',
        'POSTDOT_URL',
        'POSTDOT_API_KEY',
        'POSTDOT_PROJECT',
        'POSTDOT_CONFIG_DIR',
    ]
    const saved = keys.map(key => [key, process.env[key]] as const)
    for (const key of keys) delete process.env[key]
    try {
        run({ configDir })
    } finally {
        for (const [key, value] of saved) {
            if (value === undefined) delete process.env[key]
            else process.env[key] = value
        }
        rmSync(configDir, { recursive: true, force: true })
    }
}

test('profiles keep credentials and project defaults bound to their own origin', () =>
    isolated(options => {
        const first = { name: 'production', origin: 'https://one.example', project: 'one' }
        const second = { name: 'staging', origin: 'https://two.example', project: 'two' }
        addProfile(options, first)
        addProfile(options, second)
        saveCredential(options, first, 'key-one')
        saveCredential(options, second, 'key-two')
        expect(resolveConnection(options)).toMatchObject({
            origin: first.origin,
            token: 'key-one',
            project: 'one',
        })
        expect(resolveConnection({ ...options, profile: 'staging' })).toMatchObject({
            origin: second.origin,
            token: 'key-two',
            project: 'two',
        })
        // An origin override cannot implicitly choose another profile's saved key.
        expect(resolveConnection({ ...options, baseUrl: second.origin })).toMatchObject({
            token: undefined,
            project: undefined,
            profile: undefined,
        })
        process.env.POSTDOT_PROFILE = 'staging'
        expect(resolveConnection(options).token).toBe('key-two')
        expect(resolveConnection({ ...options, profile: 'production' }).token).toBe('key-one')
        process.env.POSTDOT_API_KEY = 'environment-key'
        process.env.POSTDOT_PROJECT = 'environment-project'
        expect(resolveConnection({ ...options, profile: 'production' })).toMatchObject({
            token: 'environment-key',
            project: 'environment-project',
        })
        expect(resolveConnection({ ...options, project: 'explicit-project' }).project).toBe(
            'explicit-project'
        )
    }))

test('local logout preserves environment authentication and profile removal chooses no other server', () =>
    isolated(options => {
        const profile = { name: 'first', origin: 'https://one.example' }
        addProfile(options, profile)
        addProfile(options, { name: 'second', origin: 'https://two.example' })
        saveCredential(options, profile, 'saved-key')
        process.env.POSTDOT_API_KEY = 'environment-key'
        expect(clearCredential(options)).toEqual({ profile: 'first', removed: true })
        expect(resolveConnection(options).token).toBe('environment-key')
        delete process.env.POSTDOT_API_KEY
        expect(resolveConnection(options).token).toBeUndefined()
        removeProfile(options, 'first')
        expect(readConfiguration(options.configDir).selected).toBeUndefined()
        expect(selectedProfile(options)).toBeUndefined()
        expect(() => resolveConnection({ ...options, profile: 'missing' })).toThrow(
            'profile does not exist'
        )
        useProfile(options, 'second')
        setProject(options, 'chosen-project')
        expect(resolveConnection(options).project).toBe('chosen-project')
        setProject(options, undefined)
        expect(resolveConnection(options).project).toBeUndefined()
    }))

test('a profile changed while login is being verified cannot receive the old origin credential', () =>
    isolated(options => {
        const original = { name: 'work', origin: 'https://one.example' }
        addProfile(options, original)
        removeProfile(options, original.name)
        addProfile(options, { name: 'work', origin: 'https://two.example' })
        expect(() => saveCredential(options, original, 'old-origin-key')).toThrow(
            'profile changed during login'
        )
        expect(resolveConnection(options).token).toBeUndefined()
    }))

test('configuration locks and malformed files cannot silently discard saved profiles', () =>
    isolated(options => {
        addProfile(options, { name: 'first', origin: 'https://one.example' })
        const before = readFileSync(join(options.configDir, 'config.json'), 'utf8')
        writeFileSync(join(options.configDir, 'configuration.lock'), '', { mode: 0o600 })
        expect(() =>
            addProfile(options, { name: 'second', origin: 'https://two.example' })
        ).toThrow('Configuration is locked')
        expect(readFileSync(join(options.configDir, 'config.json'), 'utf8')).toBe(before)
        rmSync(join(options.configDir, 'configuration.lock'))
        writeFileSync(join(options.configDir, 'config.json'), '{broken')
        expect(() =>
            addProfile(options, { name: 'second', origin: 'https://two.example' })
        ).toThrow('Cannot read config.json')
        expect(readFileSync(join(options.configDir, 'config.json'), 'utf8')).toBe('{broken')
    }))

test('saved keys use private files, refuse broad permissions and are not written into profile metadata', () =>
    isolated(options => {
        const profile = { name: 'first', origin: 'https://one.example' }
        addProfile(options, profile)
        saveCredential(options, profile, 'saved-key')
        const file = join(options.configDir, 'credentials.json')
        expect(statSync(options.configDir).mode & 0o777).toBe(0o700)
        expect(statSync(file).mode & 0o777).toBe(0o600)
        expect(readFileSync(join(options.configDir, 'config.json'), 'utf8')).not.toContain(
            'saved-key'
        )
        chmodSync(file, 0o644)
        expect(() => resolveConnection(options)).toThrow('user-only permissions')
        chmodSync(file, 0o600)
        const target = join(options.configDir, 'outside.json')
        writeFileSync(target, readFileSync(file), { mode: 0o600 })
        rmSync(file)
        symlinkSync(target, file)
        expect(() => resolveConnection(options)).toThrow('Cannot read credentials.json')
    }))
