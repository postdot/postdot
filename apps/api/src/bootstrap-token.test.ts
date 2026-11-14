import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
    hashBootstrapToken,
    initializeInstanceBootstrapGuard,
    normalizeBootstrapTokenHash,
    readBootstrapTokenFile,
    verifyBootstrapTokenDigest,
} from './bootstrap-token'

const directories: string[] = []

afterEach(async () => {
    while (directories.length > 0) {
        await rm(directories.pop()!, { recursive: true, force: true })
    }
})

async function createTempDirectory(): Promise<string> {
    const directory = await mkdtemp(join(tmpdir(), 'postdot-bootstrap-token-'))
    directories.push(directory)
    return directory
}

describe('bootstrap token helpers and guard', () => {
    it('hashes and verifies tokens in constant time', () => {
        const token = 'bootstrap-secret-token-value'
        const digest = hashBootstrapToken(token)
        expect(normalizeBootstrapTokenHash(`sha256:${digest.toUpperCase()}`)).toBe(digest)
        expect(verifyBootstrapTokenDigest(token, digest)).toBe(true)
        expect(verifyBootstrapTokenDigest(`${token}-wrong`, digest)).toBe(false)
        expect(verifyBootstrapTokenDigest('', digest)).toBe(false)
    })

    it('rejects symbolic links and short or oversized secret files', async () => {
        const directory = await createTempDirectory()
        const regularFile = join(directory, 'token.txt')
        const linkFile = join(directory, 'token-link.txt')
        await writeFile(regularFile, 'valid-bootstrap-token-1234\n', 'utf8')
        await symlink(regularFile, linkFile)

        expect(await readBootstrapTokenFile(regularFile)).toBe('valid-bootstrap-token-1234')
        await expect(readBootstrapTokenFile(linkFile)).rejects.toThrow(
            'unreadable or a symbolic link'
        )

        const shortFile = join(directory, 'short.txt')
        await writeFile(shortFile, 'too-short', 'utf8')
        await expect(readBootstrapTokenFile(shortFile)).rejects.toThrow('at least 16 characters')
    })

    it('auto-generates a 0600 bootstrap token file in production-style token_required mode and cleans it up on claim', async () => {
        const directory = await createTempDirectory()
        const databasePath = join(directory, 'postdot.sqlite')
        const logged: string[] = []

        const guard = await initializeInstanceBootstrapGuard({
            bootstrap: { mode: 'token_required' },
            database: {
                engine: 'sqlite',
                fileName: databasePath,
                migrationsDirectory: '/tmp/migrations',
            },
            mediaDirectory: join(directory, 'media'),
            instanceClaimable: true,
            logInfo: message => logged.push(message),
        })

        expect(guard.mode).toBe('token_required')
        expect(guard.tokenFilePath).toBe(join(directory, 'bootstrap-token'))
        const fileStat = await stat(guard.tokenFilePath!)
        expect(fileStat.mode & 0o777).toBe(0o600)

        const token = (await readFile(guard.tokenFilePath!, 'utf8')).trim()
        expect(token.length).toBeGreaterThanOrEqual(16)
        expect(logged[0]).toContain(guard.tokenFilePath!)
        expect(logged[0]).toContain(token)
        expect(guard.verifyToken(token)).toBe(true)
        expect(guard.verifyToken('wrong-token-000000')).toBe(false)

        // A second startup before claim reuses the existing file token cleanly.
        const secondLogged: string[] = []
        const reused = await initializeInstanceBootstrapGuard({
            bootstrap: { mode: 'token_required' },
            database: {
                engine: 'sqlite',
                fileName: databasePath,
                migrationsDirectory: '/tmp/migrations',
            },
            mediaDirectory: join(directory, 'media'),
            instanceClaimable: true,
            logInfo: message => secondLogged.push(message),
        })
        expect(reused.verifyToken(token)).toBe(true)
        expect(secondLogged[0]).not.toContain(token)

        await guard.onClaimed()
        await expect(stat(guard.tokenFilePath!)).rejects.toThrow()
    })

    it('skips generating or requiring files once the instance is already claimed', async () => {
        const directory = await createTempDirectory()
        const guard = await initializeInstanceBootstrapGuard({
            bootstrap: { mode: 'token_required', tokenFile: join(directory, 'missing-token') },
            database: {
                engine: 'postgres',
                url: 'postgres://localhost/postdot',
                poolSize: 5,
                migrationsDirectory: '/tmp/migrations',
            },
            mediaDirectory: join(directory, 'media'),
            instanceClaimable: false,
        })

        expect(guard.mode).toBe('token_required')
        expect(guard.tokenFilePath).toBeUndefined()
        expect(guard.verifyToken('anything-at-all-1234')).toBe(false)
    })
})
