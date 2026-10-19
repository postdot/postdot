import { describe, expect, it } from 'bun:test'

import {
    BundleRequireScanError,
    classifySpecifier,
    collectExternalRequires,
    isPackageSpecifier,
} from './bundle-requires'

/**
 * The fixtures are the shapes a bundle takes, not a built bundle. The
 * TypeBox loader is the shape that broke the production image: Elysia reaches
 * for the namespaces through a require function the bundler cannot inline.
 */
const typeboxLoader = `
function resolveNamespaces() {
    const req = import.meta.require ?? globalThis.process?.getBuiltinModule?.("module")?.createRequire(import.meta.url);
    if (!req) throw new Error("TypeBox couldn't be loaded");
    return {
        type: req("typebox/type"),
        system: req("typebox/system"),
    };
}
`

describe('bundle require scan', () => {
    it('reports an aliased dynamic require with the alias and the specifier', () => {
        expect(collectExternalRequires(typeboxLoader, new Set())).toEqual([
            { specifier: 'typebox/type', shape: 'dynamic require', alias: 'req' },
            { specifier: 'typebox/system', shape: 'dynamic require', alias: 'req' },
        ])
    })

    it('reports a literal require of a package', () => {
        expect(
            collectExternalRequires(`const typebox = require('typebox/system')`, new Set())
        ).toEqual([{ specifier: 'typebox/system', shape: 'literal require', alias: null }])
        expect(
            collectExternalRequires(
                `const typebox = import.meta.require('typebox/compile')`,
                new Set()
            )
        ).toEqual([{ specifier: 'typebox/compile', shape: 'literal require', alias: null }])
    })

    it('accepts a relative, an absolute and a builtin require', () => {
        const source = `
const local = require('./local')
const parent = require('../parent')
const absolute = require('/opt/app/module')
const nodePrefixed = require('node:fs')
const builtin = require('fs')
const bunPrefixed = require('bun:sqlite')
`

        expect(collectExternalRequires(source, new Set())).toEqual([])
    })

    it('accepts a package name that only appears in a comment or in a string', () => {
        const source = `
// require('typebox/system')
/* require('typebox/compile') */
const label = 'typebox/system'
const code = "require('typebox/compile')"
const template = \`typebox/system\`
`

        expect(collectExternalRequires(source, new Set())).toEqual([])
    })

    it('does not report a dynamic require of a package the bundle carries', () => {
        const source = `
function resolveNamespaces() {
    const req = import.meta.require;
    return req('typebox/system');
}
`

        expect(collectExternalRequires(source, new Set(['typebox/system']))).toEqual([])
    })

    it('reports a call of the alias only inside the scope that declares it', () => {
        const source = `
function load() {
    const requireTypebox = createRequire(import.meta.url)
    return requireTypebox('typebox/system')
}
function elsewhere() {
    return requireTypebox('typebox/compile')
}
`

        expect(collectExternalRequires(source, new Set())).toEqual([
            { specifier: 'typebox/system', shape: 'dynamic require', alias: 'requireTypebox' },
        ])
    })

    it('does not detect a require held in a variable', () => {
        const source = `
const requirePackage = require
export function load() {
    return requirePackage('typebox/system')
}
`

        expect(collectExternalRequires(source, new Set())).toEqual([])
    })

    it('does not detect a require called with a computed specifier', () => {
        const source = `
const requireTypebox = createRequire(import.meta.url)
const packageName = 'typebox/system'
export function load() {
    return requireTypebox(packageName)
}
export function loadPrefixed() {
    return requireTypebox('typebox/' + packageName)
}
`

        expect(collectExternalRequires(source, new Set())).toEqual([])
    })

    it('reports the doubt when the source cannot be lexed', () => {
        const source =
            'function broken() { const requireTypebox = createRequire(import.meta.url); return requireTypebox('

        expect(() => collectExternalRequires(source, new Set())).toThrow(BundleRequireScanError)
        expect(() => collectExternalRequires(source, new Set())).toThrow(
            'The bundle could not be lexed, the block structure is incomplete'
        )
    })

    it('classifies a specifier the way a runtime resolves it', () => {
        expect(classifySpecifier('./local')).toBe('relative')
        expect(classifySpecifier('../parent')).toBe('relative')
        expect(classifySpecifier('/opt/app/module')).toBe('absolute')
        expect(classifySpecifier('file:///opt/app/module')).toBe('absolute')
        expect(classifySpecifier('node:fs')).toBe('builtin')
        expect(classifySpecifier('bun:sqlite')).toBe('builtin')
        expect(classifySpecifier('fs')).toBe('builtin')
        expect(classifySpecifier('typebox/system')).toBe('package')

        expect(isPackageSpecifier('typebox/system')).toBe(true)
        expect(isPackageSpecifier('fs')).toBe(false)
        expect(isPackageSpecifier('node:fs')).toBe(false)
    })
})
