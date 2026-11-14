exports.up = async (knex) => {
  await knex.schema.createTable('webhook_events', (t) => {
    t.bigIncrements('id').primary();
    t.text('event_id').notNullable().unique();
    t.text('message_id').notNullable();
    t.text('tenant_id');
    t.text('status').notNullable();
    t.timestamp('occurred_at', { useTz: true }).notNullable();
    t.timestamp('received_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.text('processing_result').notNullable();
    t.jsonb('raw_payload');
  });

  await knex.raw(`
    ALTER TABLE webhook_events
    ADD CONSTRAINT webhook_events_status_check
    CHECK (status IN ('SENT','DELIVERED','READ','FAILED'))
  `);

  await knex.raw(`
    ALTER TABLE webhook_events
    ADD CONSTRAINT webhook_events_result_check
    CHECK (processing_result IN ('APPLIED','IGNORED_STALE','IGNORED_TERMINAL','UNMATCHED'))
  `);

  await knex.raw(`CREATE INDEX idx_webhook_events_message ON webhook_events (message_id)`);
};

exports.down = (knex) => knex.schema.dropTableIfExists('webhook_events');