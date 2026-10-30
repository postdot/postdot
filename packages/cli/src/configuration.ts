import { randomUUID } from 'node:crypto'
import {
    closeSync,
    constants,
    existsSync,
    fstatSync,
    lstatSync,
    mkdirSync,
    openSync,
    readFileSync,
    renameSync,
    unlinkSync,
    writeFileSync,
    type Stats,
} from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'

import { CliError } from './errors'

export interface Profile {
    readonly name: string
    readonly origin: string
    readonly project?: string
}
interface Configuration {
    readonly version: 1
    readonly selected?: string
    readonly profiles: Profile[]
}
interface Credential {
    readonly profile: string
    readonly origin: string
    readonly token: string
}
export interface ConfigurationOptions {
    readonly configDir?: string
    readonly profile?: string
    readonly baseUrl?: string
    readonly project?: string
}

function record(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function fileError(error: unknown, code: string) {
    return error instanceof Error && 'code' in error && error.code === code
}
export function normalizeOrigin(value: string) {
    try {
        const url = new URL(value)
        if (
            ['http:', 'https:'].includes(url.protocol) &&
            !url.username &&
            !url.password &&
            !url.search &&
            !url.hash &&
            url.pathname === '/'
        )
            return url.origin
    } catch {
        /* Report the same error without echoing an input that may contain a secret. */
    }
    throw new CliError(
        'The server URL must be an HTTP(S) origin without credentials, query or path.',
        'invalid_input',
        2
    )
}
export function configurationDirectory(options: ConfigurationOptions) {
    const override = options.configDir ?? process.env.POSTDOT_CONFIG_DIR
    if (override) {
        if (!isAbsolute(override))
            throw new CliError(
                '--config-dir / POSTDOT_CONFIG_DIR must be an absolute path.',
                'invalid_input',
                2
            )
        return override
    }
    if (process.platform === 'win32')
        return join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'postdot')
    if (process.platform === 'darwin')
        return join(homedir(), 'Library', 'Application Support', 'postdot')
    const xdg = process.env.XDG_CONFIG_HOME
    return join(xdg && isAbsolute(xdg) ? xdg : join(homedir(), '.config'), 'postdot')
}

function checkPrivate(info: Stats) {
    if (
        process.platform !== 'win32' &&
        ((info.mode & 0o077) !== 0 || (process.getuid && info.uid !== process.getuid()))
    )
        throw new CliError(
            'Credential storage must be owned by your user with user-only permissions (directory 0700, files 0600).',
            'insecure_configuration',
            2
        )
}
function readJson(directory: string, filename: string, secret = false): unknown {
    if (secret && !existsSync(join(directory, filename))) return undefined
    let descriptor: number | undefined
    try {
        const info = lstatSync(join(directory, filename))
        if (!info.isFile() || info.isSymbolicLink()) throw new Error('Not a regular file')
        if (secret) {
            checkPrivate(lstatSync(directory))
            checkPrivate(info)
        }
        descriptor = openSync(
            join(directory, filename),
            constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)
        )
        const opened = fstatSync(descriptor)
        if (!opened.isFile() || opened.size > 1_048_576) throw new Error('Invalid file')
        if (secret) checkPrivate(opened)
        return JSON.parse(readFileSync(descriptor, 'utf8')) as unknown
    } catch (error) {
        if (fileError(error, 'ENOENT')) return undefined
        if (error instanceof CliError) throw error
        throw new CliError(
            `Cannot read ${filename}. Check its permissions and JSON format.`,
            'invalid_configuration',
            2
        )
    } finally {
        if (descriptor !== undefined) closeSync(descriptor)
    }
}
export function readConfiguration(directory: string): Configuration {
    const value = readJson(directory, 'config.json')
    if (value === undefined) return { version: 1, profiles: [] }
    if (
        !record(value) ||
        value.version !== 1 ||
        !Array.isArray(value.profiles) ||
        !value.profiles.every(
            (item: unknown): item is Profile =>
                record(item) &&
                typeof item.name === 'string' &&
                typeof item.origin === 'string' &&
                (item.project === undefined || typeof item.project === 'string')
        ) ||
        (value.selected !== undefined && typeof value.selected !== 'string')
    )
        throw new CliError('config.json has an unsupported format.', 'invalid_configuration', 2)
    const profiles: Profile[] = value.profiles
    if (
        new Set(profiles.map(profile => profile.name)).size !== profiles.length ||
        profiles.some(profile => normalizeOrigin(profile.origin) !== profile.origin) ||
        (typeof value.selected === 'string' &&
            !profiles.some(profile => profile.name === value.selected))
    )
        throw new CliError(
            'config.json contains inconsistent profiles.',
            'invalid_configuration',
            2
        )
    return {
        version: 1,
        profiles,
        ...(typeof value.selected === 'string' ? { selected: value.selected } : {}),
    }
}
function readCredentials(directory: string): Credential[] {
    const value = readJson(directory, 'credentials.json', true)
    if (value === undefined) return []
    if (
        !Array.isArray(value) ||
        !value.every(
            (item: unknown): item is Credential =>
                record(item) &&
                typeof item.profile === 'string' &&
                typeof item.origin === 'string' &&
                typeof item.token === 'string' &&
                item.token.length > 0
        )
    )
        throw new CliError(
            'credentials.json has an unsupported format.',
            'invalid_configuration',
            2
        )
    return value
}
export function selectedProfile(
    options: ConfigurationOptions,
    configuration = readConfiguration(configurationDirectory(options))
) {
    const name = options.profile ?? process.env.POSTDOT_PROFILE ?? configuration.selected
    const profile = configuration.profiles.find(item => item.name === name)
    if (name && !profile)
        throw new CliError(
            'The selected profile does not exist. Use config list or config add.',
            'profile_not_found',
            2
        )
    return profile
}
export function resolveConnection(options: ConfigurationOptions) {
    const directory = configurationDirectory(options)
    const profile = selectedProfile(options)
    const origin = normalizeOrigin(
        options.baseUrl ?? process.env.POSTDOT_URL ?? profile?.origin ?? 'http://localhost:3000'
    )
    const matchingProfile = profile?.origin === origin ? profile : undefined
    const environmentToken = process.env.POSTDOT_API_KEY || undefined
    const credential =
        !environmentToken && matchingProfile
            ? readCredentials(directory).find(
                  item => item.profile === matchingProfile.name && item.origin === origin
              )
            : undefined
    return {
        origin,
        profile: matchingProfile?.name,
        project: options.project ?? process.env.POSTDOT_PROJECT ?? matchingProfile?.project,
        token: environmentToken ?? credential?.token,
        credentialSource: environmentToken ? 'environment' : credential ? 'profile' : 'missing',
    }
}

function atomicWrite(directory: string, filename: string, value: unknown) {
    const temporary = join(directory, `.${filename}.${randomUUID()}.tmp`)
    const descriptor = openSync(temporary, 'wx', 0o600)
    try {
        try {
            writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`)
        } finally {
            closeSync(descriptor)
        }
        renameSync(temporary, join(directory, filename))
    } catch (error) {
        try {
            unlinkSync(temporary)
        } catch {
            /* Preserve the original write error. */
        }
        throw error
    }
}
function edit<T>(
    options: ConfigurationOptions,
    callback: (directory: string, configuration: Configuration) => T
): T {
    const directory = configurationDirectory(options)
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    const info = lstatSync(directory)
    if (!info.isDirectory() || info.isSymbolicLink())
        throw new CliError(
            'The configuration directory must be a regular directory.',
            'invalid_configuration',
            2
        )
    checkPrivate(info)
    const lock = join(directory, 'configuration.lock')
    let descriptor: number
    try {
        descriptor = openSync(lock, 'wx', 0o600)
    } catch (error) {
        if (fileError(error, 'EEXIST'))
            throw new CliError(
                'Configuration is locked. Retry after the other command finishes. Remove configuration.lock only if no configuration command is running.',
                'configuration_busy',
                2
            )
        throw error
    }
    try {
        return callback(directory, readConfiguration(directory))
    } finally {
        closeSync(descriptor)
        unlinkSync(lock)
    }
}
export function addProfile(options: ConfigurationOptions, profile: Profile) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(profile.name))
        throw new CliError(
            'Use a profile name of 1–64 letters, digits, underscores or hyphens.',
            'invalid_input',
            2
        )
    const origin = normalizeOrigin(profile.origin)
    return edit(options, (directory, config) => {
        if (config.profiles.some(item => item.name === profile.name))
            throw new CliError(
                'That profile already exists. Choose another name.',
                'profile_exists',
                2
            )
        const next = {
            ...config,
            selected: config.selected ?? profile.name,
            profiles: [...config.profiles, { ...profile, origin }],
        }
        atomicWrite(directory, 'config.json', next)
        return next
    })
}
export function useProfile(options: ConfigurationOptions, name: string) {
    return edit(options, (directory, config) => {
        if (!config.profiles.some(item => item.name === name))
            throw new CliError('That profile does not exist.', 'profile_not_found', 2)
        atomicWrite(directory, 'config.json', { ...config, selected: name })
    })
}
export function removeProfile(options: ConfigurationOptions, name: string) {
    return edit(options, (directory, config) => {
        if (!config.profiles.some(item => item.name === name))
            throw new CliError('That profile does not exist.', 'profile_not_found', 2)
        if (existsSync(join(directory, 'credentials.json')))
            atomicWrite(
                directory,
                'credentials.json',
                readCredentials(directory).filter(item => item.profile !== name)
            )
        atomicWrite(directory, 'config.json', {
            version: 1,
            profiles: config.profiles.filter(item => item.name !== name),
            ...(config.selected !== name ? { selected: config.selected } : {}),
        })
    })
}
export function setProject(options: ConfigurationOptions, project: string | undefined) {
    return edit(options, (directory, config) => {
        const profile = selectedProfile(options, config)
        if (!profile)
            throw new CliError('Select a profile first with config use.', 'profile_required', 2)
        const updated = {
            name: profile.name,
            origin: profile.origin,
            ...(project ? { project } : {}),
        }
        atomicWrite(directory, 'config.json', {
            ...config,
            profiles: config.profiles.map(item => (item.name === profile.name ? updated : item)),
        })
        return updated
    })
}
export function assertCredentialPersistence() {
    if (process.platform === 'win32')
        throw new CliError(
            'Persistent credentials are not qualified on Windows yet. Use POSTDOT_API_KEY.',
            'credential_storage_unavailable',
            2
        )
}
export function saveCredential(options: ConfigurationOptions, profile: Profile, token: string) {
    assertCredentialPersistence()
    return edit(options, (directory, config) => {
        const current = config.profiles.find(item => item.name === profile.name)
        if (!current || current.origin !== profile.origin)
            throw new CliError(
                'The profile changed during login. Review it and retry.',
                'configuration_changed',
                2
            )
        const credentials = readCredentials(directory).filter(item => item.profile !== profile.name)
        atomicWrite(directory, 'credentials.json', [
            ...credentials,
            { profile: profile.name, origin: profile.origin, token },
        ])
    })
}
export function clearCredential(options: ConfigurationOptions) {
    return edit(options, (directory, config) => {
        const profile = selectedProfile(options, config)
        if (!profile)
            throw new CliError('Select a profile first with config use.', 'profile_required', 2)
        const credentials = readCredentials(directory)
        const next = credentials.filter(item => item.profile !== profile.name)
        if (credentials.length !== next.length) atomicWrite(directory, 'credentials.json', next)
        return { profile: profile.name, removed: credentials.length !== next.length }
    })
}
