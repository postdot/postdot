-- postdot:common
CREATE TABLE publication_thread_messages (
    project_id text NOT NULL,
    execution_revision_id text NOT NULL,
    position bigint NOT NULL,
    state text NOT NULL DEFAULT 'pending',
    external_id text,
    external_url text,
    external_cid text,
    error_message text,
    PRIMARY KEY (project_id, execution_revision_id, position),
    FOREIGN KEY (project_id, execution_revision_id) REFERENCES publication_execution_revisions(project_id,id) ON DELETE cascade DEFERRABLE INITIALLY IMMEDIATE,
    CONSTRAINT thread_position_valid CHECK(position >= 0 AND position < 25),
    CONSTRAINT thread_state_valid CHECK(state IN ('pending','sending','confirmed','failed','ambiguous')),
    CONSTRAINT thread_receipt_valid CHECK(
        (state = 'confirmed' AND external_id IS NOT NULL AND length(trim(external_id)) > 0 AND error_message IS NULL)
        OR (state IN ('pending','sending') AND external_id IS NULL AND external_url IS NULL AND external_cid IS NULL AND error_message IS NULL)
        OR (state IN ('failed','ambiguous') AND external_id IS NULL AND external_url IS NULL AND external_cid IS NULL AND error_message IS NOT NULL AND length(trim(error_message)) > 0)
    )
);
