/**
 * The production image carries the bundle, the migrations and the dashboard
 * assets, and no `node_modules`. The bundle must therefore not need a module
 * the image cannot resolve.
 *
 * This module scans a built bundle for the runtime requires such an image
 * cannot satisfy, and it implements one rule:
 *
 * - A literal require of a package is always a violation. The bundle carries
 *   the package's code, not a name the image could resolve, so the require
 *   fails in the image even when the package itself is part of the bundle.
 * - A dynamic require of a package the bundle does not carry is a violation,
 *   because then neither the bundle nor the image can supply the package.
 * - A dynamic require of a package the bundle does carry is not reported
 *   here: it is not a dependency of the bundle. Only the serving check proves
 *   that the image cannot reach it, because the image cannot resolve a
 *   carried package by name either.
 *
 * A dynamic require is what a bundler leaves behind when a module is loaded
 * through a require function it cannot see: the call site reads `name("pkg")`
 * instead of `require("pkg")`.
 *
 * The analysis reads the source, it does not run it, and it has limits that
 * `scripts/bundle-requires.test.ts` pins:
 *
 * - A require held in a variable is not detected, and a require called with a
 *   computed specifier is not detected.
 * - The alias and scope analysis is a hand written lexer. When it cannot read
 *   the source, it reports the doubt with a `BundleRequireScanError` instead
 *   of returning a partial result that would pass silently.
 */

/** What a runtime require of a package asks the runtime to load. */
export type SpecifierKind = 'relative' | 'absolute' | 'builtin' | 'package'

/**
 * A runtime require of a package the image cannot satisfy.
 *
 * The shape is either a `literal require`, a call site that spells out
 * `require`, or a `dynamic require`, a call site that reaches the require
 * function through a local name. A literal require has no alias: the call
 * site spells out `require`. A dynamic require names the local binding that
 * holds the require function, so the report says which binding reached for
 * the package.
 */
export type ExternalRequire =
    | {
          readonly shape: 'literal require'
          readonly specifier: string
          readonly alias: null
      }
    | {
          readonly shape: 'dynamic require'
          readonly specifier: string
          readonly alias: string
      }

/**
 * The scan could not read the source. The scan fails closed: a source it
 * cannot understand is a doubt to report, never a result to trust.
 */
export class BundleRequireScanError extends Error {
    constructor(message: string) {
        super(message)
        this.name = 'BundleRequireScanError'
    }
}

/**
 * Collects the runtime requires of the bundle that the image cannot satisfy.
 *
 * @param source The built bundle text.
 * @param carriedSpecifiers The package specifiers the bundle carries, as
 * the build metafile reports them. A dynamic require of one of them is not a
 * dependency of the bundle and is not reported.
 * @throws {BundleRequireScanError} When the source cannot be lexed.
 */
export function collectExternalRequires(
    source: string,
    carriedSpecifiers: ReadonlySet<string>
): ExternalRequire[] {
    const lexed = lexSource(source)
    const violations: ExternalRequire[] = []
    const seen = new Set<string>()

    const literalPattern = /\b(?:import\.meta\.)?require\s*\(\s*(['"])([^'"]*)\1\s*\)/g
    for (const match of source.matchAll(literalPattern)) {
        const specifier = match[2]!
        if (isInsideLiteral(lexed, match.index)) continue
        if (classifySpecifier(specifier) !== 'package') continue
        seen.add(`literal ${specifier}`)
        violations.push({ specifier, shape: 'literal require', alias: null })
    }

    for (const call of findDynamicRequireCalls(source, lexed)) {
        if (classifySpecifier(call.specifier) !== 'package') continue
        if (carriedSpecifiers.has(call.specifier)) continue
        const key = `dynamic ${call.specifier}`
        if (seen.has(key)) continue
        seen.add(key)
        violations.push({
            specifier: call.specifier,
            shape: 'dynamic require',
            alias: call.alias,
        })
    }

    return violations
}

/**
 * Classifies a specifier the way a runtime resolves it. The list of Node
 * builtins is explicit: an unknown specifier is a package, because the image
 * cannot resolve it either.
 */
export function classifySpecifier(specifier: string): SpecifierKind {
    if (specifier.startsWith('./') || specifier.startsWith('../')) return 'relative'
    if (specifier.startsWith('/') || specifier.startsWith('file://')) return 'absolute'
    if (specifier.startsWith('node:') || specifier.startsWith('bun:')) return 'builtin'
    if (nodeBuiltins.has(specifier)) return 'builtin'
    return 'package'
}

/**
 * Whether a specifier is a package name a runtime could look up. A package
 * name is what the image cannot resolve, so this is the filter the serving
 * probe uses to name the packages the bundle carries.
 */
export function isPackageSpecifier(specifier: string): boolean {
    return (
        classifySpecifier(specifier) === 'package' &&
        /^[a-z@][\w@]*(?:\/[\w@./-]+)*$/.test(specifier)
    )
}

/**
 * Node builtins a bundle may require at runtime. The list is explicit: an
 * unknown specifier is never accepted, because the image cannot resolve it.
 */
const nodeBuiltins = new Set([
    'assert',
    'async_hooks',
    'buffer',
    'child_process',
    'cluster',
    'console',
    'constants',
    'crypto',
    'dgram',
    'diagnostics_channel',
    'dns',
    'domain',
    'events',
    'fs',
    'http',
    'http2',
    'https',
    'inspector',
    'module',
    'net',
    'os',
    'path',
    'perf_hooks',
    'process',
    'punycode',
    'querystring',
    'readline',
    'repl',
    'stream',
    'string_decoder',
    'timers',
    'tls',
    'trace_events',
    'tty',
    'url',
    'util',
    'v8',
    'vm',
    'wasi',
    'worker_threads',
    'zlib',
])

interface SourceRange {
    readonly start: number
    readonly end: number
}

interface LexedSource {
    readonly blocks: SourceRange[]
    readonly strings: SourceRange[]
    readonly comments: SourceRange[]
}

/**
 * A small JavaScript lexer. It skips comments, string literals, template
 * literals and regular expressions, so only real braces change the block
 * depth. The final depth must be zero; a non-zero depth means the lexer lost
 * track of the source, and the caller has to fail instead of trusting a
 * partial result.
 */
function lexSource(source: string): LexedSource {
    const blocks: SourceRange[] = []
    const strings: SourceRange[] = []
    const comments: SourceRange[] = []
    const openBlocks: number[] = []
    const templateExpressions: number[] = []
    let index = 0
    let inTemplate = false
    let templateTextStart = 0

    while (index < source.length) {
        const character = source[index]!
        if (inTemplate) {
            if (character === '\\') {
                index += 2
                continue
            }
            if (character === '`') {
                strings.push({ start: templateTextStart, end: index + 1 })
                inTemplate = false
                index += 1
                continue
            }
            if (character === '$' && source[index + 1] === '{') {
                strings.push({ start: templateTextStart, end: index })
                templateExpressions.push(openBlocks.length)
                inTemplate = false
                index += 2
                continue
            }
            index += 1
            continue
        }
        if (character === '/' && source[index + 1] === '/') {
            const end = source.indexOf('\n', index)
            const stop = end === -1 ? source.length : end
            comments.push({ start: index, end: stop })
            index = stop
            continue
        }
        if (character === '/' && source[index + 1] === '*') {
            const end = source.indexOf('*/', index + 2)
            const stop = end === -1 ? source.length : end + 2
            comments.push({ start: index, end: stop })
            index = stop
            continue
        }
        if (character === '"' || character === "'") {
            const start = index
            index = skipQuotedString(source, index, character)
            strings.push({ start, end: index })
            continue
        }
        if (character === '`') {
            inTemplate = true
            templateTextStart = index
            index += 1
            continue
        }
        if (character === '/' && regularExpressionCanStart(source, index)) {
            index = skipRegularExpression(source, index)
            continue
        }
        if (character === '{') {
            openBlocks.push(index)
            index += 1
            continue
        }
        if (character === '}') {
            const templateDepth = templateExpressions[templateExpressions.length - 1]
            if (templateDepth !== undefined && openBlocks.length === templateDepth) {
                templateExpressions.pop()
                inTemplate = true
                templateTextStart = index + 1
                index += 1
                continue
            }
            const start = openBlocks.pop()
            if (start !== undefined) blocks.push({ start, end: index })
            index += 1
            continue
        }
        index += 1
    }

    if (openBlocks.length > 0 || templateExpressions.length > 0) {
        throw new BundleRequireScanError(
            'The bundle could not be lexed, the block structure is incomplete; the require scan cannot trust its result'
        )
    }

    return { blocks, strings, comments }
}

function skipQuotedString(source: string, start: number, quote: string): number {
    let index = start + 1
    while (index < source.length) {
        const character = source[index]!
        if (character === '\\') {
            index += 2
            continue
        }
        if (character === quote) return index + 1
        index += 1
    }
    return source.length
}

function skipRegularExpression(source: string, start: number): number {
    let index = start + 1
    let inCharacterClass = false
    while (index < source.length) {
        const character = source[index]!
        if (character === '\\') {
            index += 2
            continue
        }
        if (character === '[') {
            inCharacterClass = true
            index += 1
            continue
        }
        if (character === ']') {
            inCharacterClass = false
            index += 1
            continue
        }
        if (character === '/' && !inCharacterClass) {
            index += 1
            while (index < source.length && /[a-z]/i.test(source[index]!)) index += 1
            return index
        }
        if (character === '\n') return index
        index += 1
    }
    return source.length
}

const regularExpressionPrefixes = new Set([
    'return',
    'typeof',
    'instanceof',
    'in',
    'of',
    'new',
    'delete',
    'void',
    'case',
    'do',
    'else',
    'yield',
    'await',
    'throw',
])

function regularExpressionCanStart(source: string, index: number): boolean {
    let previous = index - 1
    while (previous >= 0 && /\s/.test(source[previous]!)) previous -= 1
    if (previous < 0) return true
    const character = source[previous]!
    if ('(,=:[!&|?{};+-*%<>~^'.includes(character)) return true
    if (!/[)\]}A-Za-z0-9_$]/.test(character)) return false
    let wordStart = previous
    while (wordStart >= 0 && /[A-Za-z0-9_$]/.test(source[wordStart]!)) wordStart -= 1
    return regularExpressionPrefixes.has(source.slice(wordStart + 1, previous + 1))
}

/**
 * Whether an offset sits inside a literal of the source: a string, a template
 * literal or a comment. A require written inside one of those is text, not a
 * call the runtime makes.
 */
function isInsideLiteral(lexed: LexedSource, offset: number): boolean {
    return isInsideRange(lexed.strings, offset) || isInsideRange(lexed.comments, offset)
}

function isInsideRange(ranges: SourceRange[], offset: number): boolean {
    return ranges.some(range => offset >= range.start && offset < range.end)
}

interface RequireAlias {
    readonly name: string
    readonly declaration: number
    readonly scopeEnd: number
}

interface DynamicRequireCall {
    readonly specifier: string
    readonly alias: string
    readonly offset: number
}

/**
 * Finds the calls of a require function the bundle obtains at runtime, which
 * is how a bundler leaves a package behind: the require is reachable through
 * a local name, so the call site is `name("package")` rather than
 * `require("package")`.
 */
function findDynamicRequireCalls(source: string, lexed: LexedSource): DynamicRequireCall[] {
    const aliases = findRequireAliases(source, lexed).toSorted(
        (left, right) => left.scopeEnd - right.scopeEnd
    )
    const calls: DynamicRequireCall[] = []
    const seen = new Set<number>()

    for (const alias of aliases) {
        const pattern = new RegExp(
            `(?<![\\w$.])${alias.name.replace(/\$/g, '\\$')}\\s*\\(\\s*(['"])([^'"\\n]+)\\1\\s*\\)`,
            'g'
        )
        for (const match of source.matchAll(pattern)) {
            if (match.index < alias.declaration || match.index > alias.scopeEnd) continue
            if (isInsideLiteral(lexed, match.index)) continue
            if (seen.has(match.index)) continue
            seen.add(match.index)
            calls.push({ specifier: match[2]!, alias: alias.name, offset: match.index })
        }
    }

    return calls
}

/**
 * Collects the local names that hold a require function: a direct assignment
 * of `import.meta.require` or of a `createRequire` result, and a
 * `createRequire` binding pulled out of the module namespace.
 */
function findRequireAliases(source: string, lexed: LexedSource): RequireAlias[] {
    const aliases: RequireAlias[] = []
    const assignmentPattern =
        /(?:^|[;,({=\s])(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*[^;]{0,400}?\b(?:import\.meta\.require|createRequire)\b/g
    for (const match of source.matchAll(assignmentPattern)) {
        aliases.push(
            createRequireAlias(match[1]!, match.index + match[0].indexOf(match[1]!), lexed)
        )
    }
    const destructuredPattern =
        /\{[^{}]{0,120}?createRequire\s*:\s*([A-Za-z_$][\w$]*)[^{}]{0,120}?\}\s*=\s*[A-Za-z_$][\w$]*\(/g
    for (const match of source.matchAll(destructuredPattern)) {
        aliases.push(
            createRequireAlias(match[1]!, match.index + match[0].indexOf(match[1]!), lexed)
        )
    }

    return aliases
}

function createRequireAlias(name: string, declaration: number, lexed: LexedSource): RequireAlias {
    if (isInsideLiteral(lexed, declaration)) {
        return { name, declaration, scopeEnd: declaration }
    }
    return { name, declaration, scopeEnd: scopeEndFor(lexed.blocks, declaration) }
}

/**
 * The end of the block that holds the declaration. A local name is only
 * visible inside that block, so a call of it outside the block belongs to
 * another binding with the same name.
 */
function scopeEndFor(blocks: SourceRange[], declaration: number): number {
    let innermost: SourceRange | undefined
    for (const block of blocks) {
        if (block.start >= declaration || block.end <= declaration) continue
        if (innermost === undefined || block.start > innermost.start) innermost = block
    }

    return innermost === undefined ? Number.POSITIVE_INFINITY : innermost.end
}
