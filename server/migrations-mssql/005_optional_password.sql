-- Passwords become optional.
--
-- The manager decides what a staff account is protected by, including nothing
-- at all: a warehouse tablet that half a dozen people share is a real setup,
-- and forcing a password onto it produces a sticky note on the screen rather
-- than security.
--
-- NULL is the marker, deliberately, rather than an empty string or a sentinel
-- hash: it makes "this account has no password" a state the column itself can
-- express, so `password_hash IS NULL` is the only test any code path needs and
-- there is no magic value to remember. An empty string would have been
-- indistinguishable from a corrupted row.
--
-- Note that the *auth* consequence lives in code, not here: see
-- routes/auth.routes.js, which lets a NULL-password account sign in with no
-- secret. This migration only stops the column from insisting on one.

ALTER TABLE users ALTER COLUMN password_hash nvarchar(200) NULL;
GO
