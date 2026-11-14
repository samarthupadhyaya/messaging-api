exports.up = async (knex) => {
  await knex.schema.createTable('messages', (t) => {
    t.text('id').primary();
    t.text('tenant_id').notNullable();
    t.text('conversation_id').notNullable();
    t.text('to_number').notNullable();
    t.text('body').notNullable();
    t.text('status').notNullable().defaultTo('QUEUED');
    t.integer('version').notNullable().defaultTo(0);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('sent_at', { useTz: true });
    t.timestamp('delivered_at', { useTz: true });
    t.timestamp('read_at', { useTz: true });
    t.timestamp('failed_at', { useTz: true });
  });

  await knex.raw(`
    ALTER TABLE messages
    ADD CONSTRAINT messages_status_check
    CHECK (status IN ('QUEUED','SENT','DELIVERED','READ','FAILED'))
  `);

  await knex.raw(`
    CREATE INDEX idx_messages_conversation
    ON messages (tenant_id, conversation_id, created_at, id)
  `);
};

exports.down = (knex) => knex.schema.dropTableIfExists('messages');