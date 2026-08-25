-- Bound AI-assistant persistence without rewriting existing history.

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'ck_ai_assistant_sessions_title_length'
          AND conrelid = 'ai_assistant_sessions'::regclass
    ) THEN
        ALTER TABLE ai_assistant_sessions
            ADD CONSTRAINT ck_ai_assistant_sessions_title_length
            CHECK (char_length(title) <= 200) NOT VALID;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'ck_ai_assistant_sessions_context_object'
          AND conrelid = 'ai_assistant_sessions'::regclass
    ) THEN
        ALTER TABLE ai_assistant_sessions
            ADD CONSTRAINT ck_ai_assistant_sessions_context_object
            CHECK (jsonb_typeof(context_json) = 'object') NOT VALID;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'ck_ai_assistant_sessions_context_size'
          AND conrelid = 'ai_assistant_sessions'::regclass
    ) THEN
        ALTER TABLE ai_assistant_sessions
            ADD CONSTRAINT ck_ai_assistant_sessions_context_size
            CHECK (octet_length(context_json::text) <= 262144) NOT VALID;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'ck_ai_assistant_messages_content_object'
          AND conrelid = 'ai_assistant_messages'::regclass
    ) THEN
        ALTER TABLE ai_assistant_messages
            ADD CONSTRAINT ck_ai_assistant_messages_content_object
            CHECK (jsonb_typeof(content_json) = 'object') NOT VALID;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'ck_ai_assistant_messages_content_size'
          AND conrelid = 'ai_assistant_messages'::regclass
    ) THEN
        ALTER TABLE ai_assistant_messages
            ADD CONSTRAINT ck_ai_assistant_messages_content_size
            CHECK (octet_length(content_json::text) <= 8388608) NOT VALID;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'ck_ai_assistant_image_blobs_mime_length'
          AND conrelid = 'ai_assistant_image_blobs'::regclass
    ) THEN
        ALTER TABLE ai_assistant_image_blobs
            ADD CONSTRAINT ck_ai_assistant_image_blobs_mime_length
            CHECK (char_length(mime_type) <= 255) NOT VALID;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'ck_ai_assistant_image_blobs_payload_size'
          AND conrelid = 'ai_assistant_image_blobs'::regclass
    ) THEN
        ALTER TABLE ai_assistant_image_blobs
            ADD CONSTRAINT ck_ai_assistant_image_blobs_payload_size
            CHECK (octet_length(payload_base64) <= 6990508) NOT VALID;
    END IF;
END
$$;
