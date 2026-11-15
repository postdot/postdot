-- postdot:common
CREATE TABLE identity_images (
    sha256 text PRIMARY KEY NOT NULL,
    content_type text NOT NULL,
    byte_size bigint NOT NULL,
    width bigint NOT NULL,
    height bigint NOT NULL,
    bytes blob NOT NULL,
    created_at bigint NOT NULL,
    CONSTRAINT identity_images_sha256_valid CHECK(length(trim(sha256)) = 64),
    CONSTRAINT identity_images_content_type_valid CHECK(content_type IN ('image/webp','image/png')),
    CONSTRAINT identity_images_byte_size_valid CHECK(byte_size > 0 AND byte_size <= 262144),
    CONSTRAINT identity_images_dimensions_valid CHECK(width > 0 AND width <= 256 AND height > 0 AND height <= 256 AND width = height),
    CONSTRAINT identity_images_bytes_valid CHECK(octet_length(bytes) = byte_size)
);

ALTER TABLE projects ADD COLUMN website_url text;
ALTER TABLE projects ADD COLUMN image_url text;
ALTER TABLE projects ADD COLUMN image_source text;

ALTER TABLE workspaces ADD COLUMN website_url text;
ALTER TABLE workspaces ADD COLUMN image_url text;
ALTER TABLE workspaces ADD COLUMN image_source text;

DROP VIEW project_channel_contexts;
ALTER TABLE channels ADD COLUMN website_url text;
ALTER TABLE channels ADD COLUMN image_url text;
ALTER TABLE channels ADD COLUMN image_source text;
CREATE VIEW project_channel_contexts AS SELECT a.project_id,c.*,a.state AS attachment_state,a.revision AS attachment_revision FROM project_channel_attachments a JOIN channels c ON c.workspace_id=a.workspace_id AND c.id=a.channel_id;

-- postdot:down
DROP VIEW project_channel_contexts;
ALTER TABLE channels DROP COLUMN image_source;
ALTER TABLE channels DROP COLUMN image_url;
ALTER TABLE channels DROP COLUMN website_url;
CREATE VIEW project_channel_contexts AS SELECT a.project_id,c.*,a.state AS attachment_state,a.revision AS attachment_revision FROM project_channel_attachments a JOIN channels c ON c.workspace_id=a.workspace_id AND c.id=a.channel_id;

ALTER TABLE workspaces DROP COLUMN image_source;
ALTER TABLE workspaces DROP COLUMN image_url;
ALTER TABLE workspaces DROP COLUMN website_url;

ALTER TABLE projects DROP COLUMN image_source;
ALTER TABLE projects DROP COLUMN image_url;
ALTER TABLE projects DROP COLUMN website_url;

DROP TABLE identity_images;
