import { Type, type TSchema } from 'typebox'
import { Value } from 'typebox/value'

export type EnvironmentSource = Readonly<Record<string, string | undefined>>

type EnvironmentPrimitive = boolean | number | string
type EnvironmentValue = EnvironmentPrimitive | undefined
type EnvironmentDefault<Value extends EnvironmentValue> =
    | Value
    | ((values: Readonly<Record<string, unknown>>) => Value)

export interface EnvironmentVariable<Value extends EnvironmentValue = EnvironmentValue> {
    readonly schema: TSchema
    readonly parse: (rawValue: string, variableName: string) => Value
    readonly defaultValue?: EnvironmentDefault<Value>
    readonly optional?: boolean
}

export type EnvironmentDefinitions = Record<string, EnvironmentVariable>

export type InferEnvironment<Definitions extends EnvironmentDefinitions> = {
    readonly [Key in keyof Definitions]: Definitions[Key] extends EnvironmentVariable<infer Value>
        ? Value
        : never
}

interface DefaultValueOptions<Value extends EnvironmentPrimitive> {
    readonly defaultValue?: EnvironmentDefault<Value>
}

export const env = {
    string(
        options: DefaultValueOptions<string> & { readonly minLength?: number } = {}
    ): EnvironmentVariable<string> {
        return {
            schema: Type.String(
                options.minLength === undefined ? {} : { minLength: options.minLength }
            ),
            parse: rawValue => rawValue,
            defaultValue: options.defaultValue,
        }
    },

    optionalString(
        options: { readonly minLength?: number } = {}
    ): EnvironmentVariable<string | undefined> {
        return {
            schema: Type.Union([
                Type.String(
                    options.minLength === undefined ? {} : { minLength: options.minLength }
                ),
                Type.Undefined(),
            ]),
            optional: true,
            parse: (rawValue, _variableName) => {
                const value = rawValue.trim()
                return value.length === 0 ? undefined : value
            },
        }
    },

    secret(
        options: DefaultValueOptions<string> & {
            readonly example?: string
            readonly minLength?: number
        } = {}
    ): EnvironmentVariable<string> {
        return {
            schema: Type.String({ minLength: options.minLength ?? 32 }),
            parse: (rawValue, _variableName) => {
                if (options.example !== undefined && rawValue === options.example) {
                    throw new Error('must replace the example placeholder')
                }

                return rawValue
            },
            defaultValue: options.defaultValue,
        }
    },

    hexSecret(
        options: DefaultValueOptions<string> & { readonly example?: string } = {}
    ): EnvironmentVariable<string> {
        return {
            schema: Type.String({ pattern: '^[0-9a-fA-F]{64}$', minLength: 64, maxLength: 64 }),
            parse: rawValue => {
                if (options.example !== undefined && rawValue === options.example) {
                    throw new Error('must replace the example placeholder')
                }
                if (!/^[0-9a-fA-F]{64}$/.test(rawValue)) {
                    throw new Error('must be exactly 32 bytes encoded as 64 hexadecimal characters')
                }

                return rawValue
            },
            defaultValue: options.defaultValue,
        }
    },

    integer(
        options: DefaultValueOptions<number> & {
            readonly minimum?: number
            readonly maximum?: number
        } = {}
    ): EnvironmentVariable<number> {
        return {
            schema: Type.Integer({
                ...(options.minimum === undefined ? {} : { minimum: options.minimum }),
                ...(options.maximum === undefined ? {} : { maximum: options.maximum }),
            }),
            parse: (rawValue, variableName) => {
                if (!/^-?\d+$/.test(rawValue)) {
                    throw new Error(`${variableName} must be an integer`)
                }

                return Number(rawValue)
            },
            defaultValue: options.defaultValue,
        }
    },

    boolean(options: DefaultValueOptions<boolean> = {}): EnvironmentVariable<boolean> {
        return {
            schema: Type.Boolean(),
            parse: (rawValue, variableName) => {
                if (rawValue === 'true') return true
                if (rawValue === 'false') return false

                throw new Error(`${variableName} must be either true or false`)
            },
            defaultValue: options.defaultValue,
        }
    },

    url(options: DefaultValueOptions<string> = {}): EnvironmentVariable<string> {
        return {
            schema: Type.String({ format: 'uri' }),
            parse: (rawValue, variableName) => {
                let url: URL

                try {
                    url = new URL(rawValue)
                } catch {
                    throw new Error(`${variableName} must be an absolute URL`)
                }

                if (url.protocol !== 'http:' && url.protocol !== 'https:') {
                    throw new Error(`${variableName} must use http or https`)
                }

                return url.origin
            },
            defaultValue: options.defaultValue,
        }
    },

    enum<const Values extends readonly [string, ...string[]]>(
        values: Values,
        options: DefaultValueOptions<Values[number]> = {}
    ): EnvironmentVariable<Values[number]> {
        const pattern = `^(?:${values.map(value => escapeRegExp(value)).join('|')})$`

        return {
            schema: Type.String({ pattern }),
            parse: (rawValue, variableName) => {
                if (!values.includes(rawValue as Values[number])) {
                    throw new Error(`${variableName} must be one of: ${values.join(', ')}`)
                }

                return rawValue as Values[number]
            },
            defaultValue: options.defaultValue,
        }
    },
}

export function createEnvironment<const Definitions extends EnvironmentDefinitions>(
    definitions: Definitions,
    source: EnvironmentSource
): InferEnvironment<Definitions> {
    const values: Record<string, unknown> = {}
    const errors: string[] = []

    for (const [variableName, definition] of Object.entries(definitions)) {
        const rawValue = source[variableName]
        let value: EnvironmentValue

        try {
            if (rawValue === undefined) {
                if (definition.defaultValue === undefined) {
                    if (definition.optional === true) {
                        value = undefined
                    } else {
                        errors.push(`${variableName} is required`)
                        continue
                    }
                } else {
                    value =
                        typeof definition.defaultValue === 'function'
                            ? definition.defaultValue(values)
                            : definition.defaultValue
                }
            } else {
                value = definition.parse(rawValue, variableName)
            }
        } catch (error) {
            errors.push(`${variableName}: ${errorMessage(error)}`)
            continue
        }

        if (!Value.Check(definition.schema, value)) {
            const validationError = Value.Errors(definition.schema, value)[0]
            errors.push(`${variableName}: ${validationError?.message ?? 'has an invalid value'}`)
            continue
        }

        values[variableName] = value
    }

    if (errors.length > 0) {
        throw new Error(
            `Invalid environment configuration:\n${errors.map(error => `- ${error}`).join('\n')}`
        )
    }

    return values as InferEnvironment<Definitions>
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'has an invalid value'
}
