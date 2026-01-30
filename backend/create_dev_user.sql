INSERT INTO users (id) VALUES ('dev-user-test-123') ON CONFLICT (id) DO NOTHING;
