ALTER TABLE "chat_conversation" ADD COLUMN "title" text;--> statement-breakpoint
ALTER TABLE "chat_conversation" ADD COLUMN "message_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE "chat_conversation" SET
  "message_count" = CASE WHEN jsonb_typeof("messages") = 'array' THEN jsonb_array_length("messages") ELSE 0 END,
  "title" = (
    SELECT left(btrim(regexp_replace(chat_part.part ->> 'text', '\s+', ' ', 'g')), 96)
    FROM jsonb_array_elements(CASE WHEN jsonb_typeof("messages") = 'array' THEN "messages" ELSE '[]'::jsonb END) WITH ORDINALITY AS chat_message(message, message_index)
    CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(chat_message.message -> 'parts') = 'array' THEN chat_message.message -> 'parts' ELSE '[]'::jsonb END) WITH ORDINALITY AS chat_part(part, part_index)
    WHERE chat_message.message ->> 'role' = 'user'
      AND chat_part.part ->> 'type' = 'text'
      AND btrim(coalesce(chat_part.part ->> 'text', '')) <> ''
    ORDER BY chat_message.message_index, chat_part.part_index
    LIMIT 1
  );
