import { describe, expect, test } from 'bun:test'

import {
    extractMessageStrings,
    findVocabularyViolations,
    stripPlaceholders,
    validateAllowlist,
} from './i18n-vocabulary'

describe('i18n-vocabulary guard', () => {
    test('extracts string values and plural match values', () => {
        expect(extractMessageStrings('Plain text')).toEqual(['Plain text'])
        expect(
            extractMessageStrings([
                {
                    declarations: ['input count', 'local countPlural = count: plural'],
                    selectors: ['countPlural'],
                    match: {
                        'countPlural=one': '{count} channel',
                        'countPlural=other': '{count} channels',
                    },
                },
            ])
        ).toEqual(['{count} channel', '{count} channels'])
    })

    test('ignores interpolation variable names while catching rendered terms', () => {
        expect(stripPlaceholders('{target} media in this channel · {source} in the post')).toBe(
            '  media in this channel ·   in the post'
        )
        const emptyAllowlist = new Map<string, string>()
        expect(
            findVocabularyViolations(
                'en',
                {
                    source_review_media: '{target} media in this channel · {source} in the post',
                },
                emptyAllowlist
            )
        ).toEqual([])
    })

    test('matches banned terms case-insensitively on Unicode word boundaries', () => {
        const emptyAllowlist = new Map<string, string>()
        const enViolations = findVocabularyViolations(
            'en',
            {
                ok_substring: 'Targeting and profiling are distinct from the banned nouns',
                bad_plural: [
                    {
                        match: {
                            one: '{count} Target',
                            other: '{count} targets',
                        },
                    },
                ],
                bad_json: 'Paste JSON here',
            },
            emptyAllowlist
        )
        expect(enViolations.map(v => `${v.key}:${v.value}`)).toEqual([
            'bad_plural:{count} Target',
            'bad_plural:{count} targets',
            'bad_json:Paste JSON here',
        ])

        /* cspell:disable */
        const frViolations = findVocabularyViolations(
            'fr',
            {
                fr_rev: 'Révision 2',
                fr_tag: 'Gérer les tags',
                fr_ws: 'Mon workspace',
            },
            emptyAllowlist
        )
        /* cspell:enable */
        expect(frViolations.map(v => v.key)).toEqual(['fr_rev', 'fr_tag', 'fr_ws'])
    })

    test('honors allowlist entries and requires non-empty reasons', () => {
        const allowlist = new Map([['account_profile', 'Account settings user profile']])
        expect(
            findVocabularyViolations(
                'en',
                {
                    account_profile: 'Profile',
                    channel_thing: 'Channel profile',
                },
                allowlist
            ).map(v => v.key)
        ).toEqual(['channel_thing'])

        expect(() => validateAllowlist(new Map([['bad_key', '   ']]))).toThrow(
            /must include a non-empty reason/
        )
    })
})
