INSERT INTO batches (id, status, payload)
VALUES ("seed-batch-1", "pending", '{"source":"seed"}');

INSERT INTO events (id, type, data)
VALUES ("seed-event-1", "batch.seeded", '{"source":"seed"}');
