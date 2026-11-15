import { resolve } from 'node:path'

interface InlangSettings {
    baseLocale: string
    locales: string[]
}

export type MessageCatalog = Record<string, unknown>

export interface VocabularyViolation {
    locale: string
    key: string
    value: string
    matches: string[]
}

const rootDirectory = resolve(import.meta.dir, '..')
const webDirectory = resolve(rootDirectory, 'apps/web')
const settingsPath = resolve(webDirectory, 'project.inlang/settings.json')
const messagesDirectory = resolve(webDirectory, 'messages')

/* cspell:disable */
const BANNED_PATTERNS_BY_LOCALE: Record<string, readonly string[]> = {
    en: [
        'profiles?',
        'targets?',
        'payloads?',
        'contracts?',
        'revisions?',
        'rebas(?:e|ed|es|ing)',
        'promot(?:e|ed|es|ing|ions?)',
        'snapshots?',
        'runtimes?',
        'workers?',
        'reconcil(?:e|ed|es|ing|iation)',
        'claim(?:ed|ing|s|able)?',
        'graphemes?',
        'escape hatch(?:es)?',
        'json',
        'schemas?',
        'bindings?',
        'capabilit(?:y|ies)',
        'ambiguous',
        'outcomes?',
        'sources?',
        'destinations?',
        'instances?',
        'provider applications?',
        'oauth applications?',
        'mime',
        'weighted characters?',
        'manual delivery',
        'due manual work',
        'overrides?',
        'queued',
        'compositions?',
    ],
    fr: [
        'profils?',
        'cibles?',
        'payloads?',
        'charges? utiles?',
        'contrats?',
        'r[eé]visions?',
        'rebas(?:e|er|[eé]e?s?|age)',
        'promouvoir',
        'promotions?',
        'promu(?:e|s|es)?',
        'instantan[eé]e?s?',
        'snapshots?',
        'runtimes?',
        'workers?',
        'r[eé]concili(?:er|[eé]e?s?|ation)',
        'r[eé]clam(?:er|[eé]e?s?)',
        'revendiqu(?:er|[eé]e?s?)',
        'graph[eè]mes?',
        'json',
        'sch[eé]mas?',
        'liaisons?',
        'bindings?',
        'capacit[eé]s?',
        'ambig(?:u|u[eë]s?|us)',
        'sources?',
        'destinations?',
        'instances?',
        'applications? fournisseur',
        'applications? oauth',
        'mime',
        'workspaces?',
        'tags?',
        'caract[eè]res? pond[eé]r[eé]s?',
        'surcharges?',
        'overrides?',
        'en file',
        'compositions?',
    ],
    es: [
        'perfiles?',
        'objetivos?',
        'destinos?',
        'payloads?',
        'cargas? [uú]tiles?',
        'contratos?',
        'revisiones',
        'revisi[oó]n\\s+de\\s+destino',
        '^\\s*revisi[oó]n\\s*$',
        'rebas(?:e|ar|ado|ada|ando)',
        'promover',
        'promociones?',
        'promoci[oó]n',
        'promovido(?:s|a|as)?',
        'instant[aá]neas?',
        'snapshots?',
        'runtimes?',
        'workers?',
        'reconcili(?:ar|ado|ada|aci[oó]n)',
        'reclam(?:ar|ado|ada)',
        'grafemas?',
        'json',
        'esquemas?',
        'vinculaciones?',
        'enlaces? de campo',
        'bindings?',
        'capacidades?',
        'ambigu[oa]s?',
        'or[ií]genes',
        'origen',
        'fuentes?',
        'instancias?',
        'aplicaciones? de proveedor',
        'aplicaciones? del proveedor',
        'aplicaciones? oauth',
        'aplicaci[oó]n de proveedor',
        'aplicaci[oó]n del proveedor',
        'aplicaci[oó]n oauth',
        'mime',
        'workspaces?',
        'caracteres ponderados',
        'sustituciones?',
        'en cola',
        'composici[oó]n',
        'composiciones',
    ],
    de: [
        'profil(?:e|s|en)?',
        'kanalprofil(?:e|s|en)?',
        'profil[äa]nderung(?:en)?',
        'ziel(?:e|s|en|es)?',
        'zielinhalt(?:e|s|en)?',
        'zielvertrag',
        'zielfelder(?:n)?',
        'zielrevision(?:en)?',
        'zielauswirkung(?:en)?',
        'zielsicher(?:e|er|es|en)?',
        'payloads?',
        'bereitstellungs-payload',
        'vertr[aä]ge?',
        'kanalvertrag',
        'webhook-vertrag',
        'revision(?:en)?',
        'rebas(?:e|en|ed)',
        'hochstuf(?:e|en|ung|te)',
        'hochgestuft',
        'bef[oö]rder(?:n|t|ung)',
        'promotion',
        'snapshots?',
        'test-snapshot',
        'momentaufnahmen?',
        'runtimes?',
        'runtime-vertrag',
        'workers?',
        'abgleich(?:en)?',
        'abgeglichen',
        'beanspruch(?:en|t|ung)',
        'graphem(?:e|en)?',
        'json',
        'schem(?:a|ata|en)',
        'inhaltsschema',
        'schema-[a-zäöüß-]+',
        'bindings?',
        'feldverkn[uü]pfung(?:en)?',
        'verkn[uü]pfung(?:en)?',
        'f[aä]higkeit(?:en)?',
        'mehrdeutig(?:e|en|er|es)?',
        'ambig(?:e|en)?',
        'quell(?:e|en|dokument|inhalt(?:e|en)?|beitrag|modus|text)',
        'wertequelle',
        'instanz(?:en)?',
        'instanzadministrator',
        'instanzbenutzer',
        'instanz-url',
        'instanz-ursprung',
        'anbieter-apps?',
        'anbieter-anwendung(?:en)?',
        'anbieteranwendung(?:en)?',
        'provider-apps?',
        'oauth-apps?',
        'oauth-anwendung(?:en)?',
        'mime',
        'mime-typen',
        'gewichtete zeichen',
        'in die warteschlange eingereiht',
        'zusammensetzung(?:en)?',
        'workspaces?(?:-[a-zäöüß-]+)?',
    ],
}
/* cspell:enable */

/**
 * Explicit allowlist (`key -> reason`) for message keys whose use of a banned
 * term is legitimate under ADR-103 §1. Every entry requires a non-empty reason.
 * Initially seeded with pre-existing violations; Step 2 shrinks this list to
 * genuinely justified exceptions only.
 */
export const VOCABULARY_ALLOWLIST = new Map<string, string>([
    // Legitimate exceptions
    ['account_profile', 'Account settings section legitimately names the user profile'],
    ['account_saved', 'Account settings confirmation legitimately refers to the user profile'],
    [
        'provider_apps_client_metadata_url_placeholder',
        'Example OAuth client metadata URL necessarily ends with .json',
    ],
    [
        'api_keys_action_manage_channels',
        'API-key capability label naming the API channel/profile permission',
    ],
    [
        'api_keys_action_administer_instance',
        'API-key capability label naming the API instance:admin permission',
    ],
    [
        'editor_field_devto_tag',
        'Refers to external DEV.to article tags rather than Studio internal tags',
    ],
    [
        'editor_field_devto_tags_duplicate',
        'Refers to external DEV.to article tags rather than Studio internal tags',
    ],
    [
        'search_aliases_account',
        'Hidden Cmd+K search keywords allowing users to find Account via familiar synonyms',
    ],
    [
        'search_aliases_provider_apps',
        'Hidden Cmd+K search keywords allowing users to find Platform setup via OAuth/provider terms',
    ],
    [
        'search_aliases_channels',
        'Hidden Cmd+K search keywords allowing users to find Channels via destination synonyms',
    ],
    [
        'search_aliases_workspace',
        'Hidden Cmd+K search keywords allowing DE users to find Workspace settings via "workspace"',
    ],

    // Pending COPY-653 Step 2 catalog rewrite
    ['common_revision', 'Pending COPY-653 rewrite'],
    ['common_profile_version', 'Pending COPY-653 rewrite'],
    ['common_change_count', 'Pending COPY-653 rewrite'],
    ['common_target_impact_count', 'Pending COPY-653 rewrite'],
    ['auth_sign_up_description', 'Pending COPY-653 rewrite'],
    ['auth_bootstrap_token_hint', 'Pending COPY-653 rewrite'],
    ['publication_resume_composition', 'Pending COPY-653 rewrite'],
    ['provider_apps_select', 'Pending COPY-653 rewrite'],
    ['overview_recent_empty_title', 'Pending COPY-653 rewrite'],
    ['approval_requests_active_profile_mismatch', 'Pending COPY-653 rewrite'],
    ['publication_review_outcome', 'Pending COPY-653 rewrite'],
    ['publication_outcome_saving', 'Pending COPY-653 rewrite'],
    ['publication_outcome_failed', 'Pending COPY-653 rewrite'],
    ['publication_structured_target', 'Pending COPY-653 rewrite'],
    ['channel_creation_description', 'Pending COPY-653 rewrite'],
    ['channel_creation_profile_description', 'Pending COPY-653 rewrite'],
    ['channel_custom_profile_description', 'Pending COPY-653 rewrite'],
    ['channel_custom_profile_fallback', 'Pending COPY-653 rewrite'],
    ['channel_custom_profile_starter_description', 'Pending COPY-653 rewrite'],
    ['channel_custom_profile_validation', 'Pending COPY-653 rewrite'],
    ['channel_template_custom_manual_description', 'Pending COPY-653 rewrite'],
    ['channel_template_custom_webhook_description', 'Pending COPY-653 rewrite'],
    ['channel_lifecycle_archive_description', 'Pending COPY-653 rewrite'],
    ['publisher_no_connections_description', 'Pending COPY-653 rewrite'],
    ['publisher_manual_only', 'Pending COPY-653 rewrite'],
    ['publisher_x_admin_setup_required', 'Pending COPY-653 rewrite'],
    ['publisher_callback_incompatible_profile_title', 'Pending COPY-653 rewrite'],
    ['publisher_callback_incompatible_profile_description', 'Pending COPY-653 rewrite'],
    ['provider_instance', 'Pending COPY-653 rewrite'],
    ['provider_instance_help', 'Pending COPY-653 rewrite'],
    ['provider_instance_required', 'Pending COPY-653 rewrite'],
    ['provider_instance_invalid', 'Pending COPY-653 rewrite'],
    ['provider_instance_origin', 'Pending COPY-653 rewrite'],
    ['provider_mastodon_help', 'Pending COPY-653 rewrite'],
    ['provider_path_auth_help', 'Pending COPY-653 rewrite'],
    ['media_description', 'Pending COPY-653 rewrite'],
    ['notifications_dialog_description', 'Pending COPY-653 rewrite'],
    ['notifications_preferences_description', 'Pending COPY-653 rewrite'],
    ['api_keys_admin_role_required', 'Pending COPY-653 rewrite'],
    ['api_keys_all_projects_required_notice', 'Pending COPY-653 rewrite'],
    ['access_instance_claimed', 'Pending COPY-653 rewrite'],
    ['access_instance_claimable', 'Pending COPY-653 rewrite'],
    ['editor_source_title', 'Pending COPY-653 rewrite'],
    ['editor_source_description', 'Pending COPY-653 rewrite'],
    ['editor_target_read_only_description', 'Pending COPY-653 rewrite'],
    ['editor_promotion_title', 'Pending COPY-653 rewrite'],
    ['editor_promotion_description', 'Pending COPY-653 rewrite'],
    ['editor_promotion_autosave', 'Pending COPY-653 rewrite'],
    ['editor_promotion_active_profile_mismatch', 'Pending COPY-653 rewrite'],
    ['editor_resolve_issues', 'Pending COPY-653 rewrite'],
    ['editor_rebasing', 'Pending COPY-653 rewrite'],
    ['editor_promoted', 'Pending COPY-653 rewrite'],
    ['publication_new_linkedin_override', 'Pending COPY-653 rewrite'],
    ['publication_new_target_override', 'Pending COPY-653 rewrite'],
    ['editor_source_description_extended', 'Pending COPY-653 rewrite'],
    ['editor_target_validation_issues', 'Pending COPY-653 rewrite'],
    ['editor_x_weighted_count_invalid', 'Pending COPY-653 rewrite'],
    ['api_invalid_provider_application', 'Pending COPY-653 rewrite'],
    ['api_invalid_instance', 'Pending COPY-653 rewrite'],
    ['notification_reconciled_body', 'Pending COPY-653 rewrite'],
    ['editor_lab_restore', 'Pending COPY-653 rewrite'],
    ['editor_lab_saved', 'Pending COPY-653 rewrite'],
    ['editor_lab_source', 'Pending COPY-653 rewrite'],
    ['editor_lab_raw', 'Pending COPY-653 rewrite'],
    ['editor_lab_unsupported', 'Pending COPY-653 rewrite'],
    ['profile_adoption_title', 'Pending COPY-653 rewrite'],
    ['profile_adoption_load_failed', 'Pending COPY-653 rewrite'],
    ['profile_adoption_failed', 'Pending COPY-653 rewrite'],
    ['profile_adoption_recovery_mismatch', 'Pending COPY-653 rewrite'],
    ['profile_adoption_refresh', 'Pending COPY-653 rewrite'],
    ['profile_issue_root_object', 'Pending COPY-653 rewrite'],
    ['profile_issue_duplicate', 'Pending COPY-653 rewrite'],
    ['profile_issue_schema_field', 'Pending COPY-653 rewrite'],
    ['profile_issue_binding', 'Pending COPY-653 rewrite'],
    ['profile_issue_media_types', 'Pending COPY-653 rewrite'],
    ['profile_issue_self_relation', 'Pending COPY-653 rewrite'],
    ['profile_issue_schema_keyword', 'Pending COPY-653 rewrite'],
    ['notification_email_toggle', 'Pending COPY-653 rewrite'],
    ['notification_email_unavailable', 'Pending COPY-653 rewrite'],
    ['notification_email_description', 'Pending COPY-653 rewrite'],
    ['notification_email_delivery_failed', 'Pending COPY-653 rewrite'],
    ['request_ambiguous', 'Pending COPY-653 rewrite'],
    ['request_status_invalid', 'Pending COPY-653 rewrite'],
    ['request_status_overlap', 'Pending COPY-653 rewrite'],
    ['request_body_existing', 'Pending COPY-653 rewrite'],
    ['request_body_source', 'Pending COPY-653 rewrite'],
    ['request_value_source', 'Pending COPY-653 rewrite'],
    ['comments_refresh_failed_saved', 'Pending COPY-653 rewrite'],
    ['comments_empty', 'Pending COPY-653 rewrite'],
    ['replies_ambiguous', 'Pending COPY-653 rewrite'],
    ['replies_request_rejected', 'Pending COPY-653 rewrite'],
    ['first_comment_state_ambiguous', 'Pending COPY-653 rewrite'],
    ['engagement_difference', 'Pending COPY-653 rewrite'],
    ['engagement_history_scope', 'Pending COPY-653 rewrite'],
    ['engagement_history_empty', 'Pending COPY-653 rewrite'],
    ['engagement_chart_scope', 'Pending COPY-653 rewrite'],
    ['engagement_single_snapshot', 'Pending COPY-653 rewrite'],
    ['engagement_snapshot_table', 'Pending COPY-653 rewrite'],
    ['engagement_newer', 'Pending COPY-653 rewrite'],
    ['engagement_older', 'Pending COPY-653 rewrite'],
    ['taxonomy_tags', 'Pending COPY-653 rewrite'],
    ['taxonomy_internal_tags', 'Pending COPY-653 rewrite'],
    ['taxonomy_manage_tags', 'Pending COPY-653 rewrite'],
    ['taxonomy_no_tags', 'Pending COPY-653 rewrite'],
    ['taxonomy_select_tags', 'Pending COPY-653 rewrite'],
    ['taxonomy_selected_tags', 'Pending COPY-653 rewrite'],
    ['taxonomy_clear_tags', 'Pending COPY-653 rewrite'],
    ['taxonomy_filter_tags', 'Pending COPY-653 rewrite'],
    ['taxonomy_assignment_failed', 'Pending COPY-653 rewrite'],
    ['project_tags_title', 'Pending COPY-653 rewrite'],
    ['project_tags_description', 'Pending COPY-653 rewrite'],
    ['project_tags_read_only', 'Pending COPY-653 rewrite'],
    ['project_tags_create', 'Pending COPY-653 rewrite'],
    ['project_tags_create_title', 'Pending COPY-653 rewrite'],
    ['project_tags_name', 'Pending COPY-653 rewrite'],
    ['project_tags_rename_title', 'Pending COPY-653 rewrite'],
    ['project_tags_active', 'Pending COPY-653 rewrite'],
    ['project_tags_archived', 'Pending COPY-653 rewrite'],
    ['project_tags_no_active', 'Pending COPY-653 rewrite'],
    ['project_tags_empty_title', 'Pending COPY-653 rewrite'],
    ['project_tags_empty_description', 'Pending COPY-653 rewrite'],
    ['project_tags_action_failed', 'Pending COPY-653 rewrite'],
    ['project_tags_refresh_failed', 'Pending COPY-653 rewrite'],
    ['project_tags_error_duplicate', 'Pending COPY-653 rewrite'],
    ['configuration_provider_apps_description', 'Pending COPY-653 rewrite'],
    ['overview_setup_channels_description', 'Pending COPY-653 rewrite'],
    ['performance_tag_filter_selected', 'Pending COPY-653 rewrite'],
    ['performance_tag_filter_show_archived', 'Pending COPY-653 rewrite'],
    ['performance_tag_filter_limit_reached', 'Pending COPY-653 rewrite'],
    ['performance_tag_filter_unavailable', 'Pending COPY-653 rewrite'],
    ['performance_tag_filter_catalog_failed', 'Pending COPY-653 rewrite'],
    ['performance_tag_filter_no_tags', 'Pending COPY-653 rewrite'],
    ['performance_tag_filter_no_matches_title', 'Pending COPY-653 rewrite'],
    ['performance_tag_filter_no_matches_description', 'Pending COPY-653 rewrite'],
    ['composer_conflict_tag_unavailable', 'Pending COPY-653 rewrite'],
    ['composer_conflict_details_unavailable', 'Pending COPY-653 rewrite'],
    ['taxonomy_add_tag', 'Pending COPY-653 rewrite'],
    ['provider_apps_description', 'Pending COPY-653 rewrite'],
    ['auth_start_workspace', 'Pending COPY-653 rewrite'],
    ['nav_aria_label', 'Pending COPY-653 rewrite'],
    ['nav_workspace', 'Pending COPY-653 rewrite'],
    ['nav_toggle', 'Pending COPY-653 rewrite'],
    ['nav_select_workspace', 'Pending COPY-653 rewrite'],
    ['nav_search_workspace', 'Pending COPY-653 rewrite'],
    ['nav_no_matching_workspaces', 'Pending COPY-653 rewrite'],
    ['dashboard_select_project_description', 'Pending COPY-653 rewrite'],
    ['nav_create_workspace', 'Pending COPY-653 rewrite'],
    ['nav_workspace_name', 'Pending COPY-653 rewrite'],
    ['nav_workspace_navigation', 'Pending COPY-653 rewrite'],
    ['api_keys_action_manage_workspaces', 'Pending COPY-653 rewrite'],
    ['access_workspace_unavailable', 'Pending COPY-653 rewrite'],
    ['access_workspace_member_updated', 'Pending COPY-653 rewrite'],
    ['access_workspace_member_removed', 'Pending COPY-653 rewrite'],
    ['access_workspace_owner_protected', 'Pending COPY-653 rewrite'],
    ['access_workspace_self_update', 'Pending COPY-653 rewrite'],
    ['access_workspace_self_removal', 'Pending COPY-653 rewrite'],
    ['access_workspace_last_admin', 'Pending COPY-653 rewrite'],
    ['access_workspace_groups_loading', 'Pending COPY-653 rewrite'],
    ['access_workspace_groups_empty', 'Pending COPY-653 rewrite'],
    ['access_workspace_groups_action_failed', 'Pending COPY-653 rewrite'],
    ['access_workspace_group_member_placeholder', 'Pending COPY-653 rewrite'],
    ['access_workspace_invite_created', 'Pending COPY-653 rewrite'],
    ['access_workspace_invite_revoked', 'Pending COPY-653 rewrite'],
    ['access_project_add_member', 'Pending COPY-653 rewrite'],
    ['access_project_add_group', 'Pending COPY-653 rewrite'],
    ['access_project_member_placeholder', 'Pending COPY-653 rewrite'],
    ['access_project_group_placeholder', 'Pending COPY-653 rewrite'],
    ['access_project_inherited_protected', 'Pending COPY-653 rewrite'],
    ['access_workspace_invitation_accept_title', 'Pending COPY-653 rewrite'],
    ['access_workspace_invitation_accept_description', 'Pending COPY-653 rewrite'],
    ['access_workspace_invitation_accept_button', 'Pending COPY-653 rewrite'],
    ['access_workspace_invitation_accepted', 'Pending COPY-653 rewrite'],
    ['channel_share_manager_workspace', 'Pending COPY-653 rewrite'],
    ['lifecycle_restore_workspace_explanation', 'Pending COPY-653 rewrite'],
    ['lifecycle_replacement', 'Pending COPY-653 rewrite'],
    ['lifecycle_error_replacement', 'Pending COPY-653 rewrite'],
    ['lifecycle_error_workspace', 'Pending COPY-653 rewrite'],
])

export function extractMessageStrings(value: unknown): string[] {
    if (typeof value === 'string') return [value]
    if (!Array.isArray(value)) return []

    const extracted: string[] = []
    for (const item of value) {
        if (
            item !== null &&
            typeof item === 'object' &&
            'match' in item &&
            item.match !== null &&
            typeof item.match === 'object'
        ) {
            for (const candidate of Object.values(item.match as Record<string, unknown>)) {
                if (typeof candidate === 'string') {
                    extracted.push(candidate)
                }
            }
        }
    }
    return extracted
}

export function stripPlaceholders(value: string): string {
    return value.replaceAll(/\{[^{}]+\}/g, ' ')
}

export function buildBannedTermRegex(locale: string): RegExp | null {
    const patterns = BANNED_PATTERNS_BY_LOCALE[locale]
    if (!patterns || patterns.length === 0) return null
    return new RegExp(`(?<![\\p{L}\\p{N}_])(?:${patterns.join('|')})(?![\\p{L}\\p{N}_])`, 'giu')
}

export function validateAllowlist(allowlist: ReadonlyMap<string, string>) {
    for (const [key, reason] of allowlist) {
        if (reason.trim().length === 0) {
            throw new Error(`Vocabulary allowlist entry "${key}" must include a non-empty reason`)
        }
    }
}

export function findVocabularyViolations(
    locale: string,
    catalog: MessageCatalog,
    allowlist: ReadonlyMap<string, string> = VOCABULARY_ALLOWLIST
): VocabularyViolation[] {
    validateAllowlist(allowlist)
    const regex = buildBannedTermRegex(locale)
    if (!regex) return []

    const violations: VocabularyViolation[] = []
    for (const [key, rawValue] of Object.entries(catalog)) {
        if (allowlist.has(key)) continue
        for (const text of extractMessageStrings(rawValue)) {
            const matches = stripPlaceholders(text).match(regex)
            if (matches && matches.length > 0) {
                violations.push({
                    locale,
                    key,
                    value: text,
                    matches: [...new Set(matches)],
                })
            }
        }
    }
    return violations
}

async function readCatalog(locale: string): Promise<MessageCatalog> {
    const path = resolve(messagesDirectory, `${locale}.json`)
    const value = await Bun.file(path).json()
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`Localization catalog must be a JSON object: ${path}`)
    }
    return value as MessageCatalog
}

async function main() {
    const settings = (await Bun.file(settingsPath).json()) as InlangSettings
    const allViolations: VocabularyViolation[] = []

    console.log(`i18n vocabulary (ADR-103 §1, base locale: ${settings.baseLocale})`)
    for (const locale of settings.locales) {
        const catalog = await readCatalog(locale)
        const violations = findVocabularyViolations(locale, catalog)
        allViolations.push(...violations)
        console.log(`- ${locale}: ${violations.length} violation(s)`)
        for (const violation of violations) {
            console.log(
                `  ${violation.key}: ${JSON.stringify(violation.value)} ` +
                    `[banned: ${violation.matches.join(', ')}]`
            )
        }
    }

    if (allViolations.length > 0) {
        throw new Error(
            `Studio catalogs contain ${allViolations.length} banned vocabulary occurrence(s) under ADR-103 §1`
        )
    }

    console.log(`i18n vocabulary passed (allowlist: ${VOCABULARY_ALLOWLIST.size} keys)`)
}

if (import.meta.main) {
    await main()
}
