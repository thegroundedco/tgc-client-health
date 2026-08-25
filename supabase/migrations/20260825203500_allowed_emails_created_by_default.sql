-- allowed_emails.created_by records who issued an invitation. Until this
-- migration it recorded nothing at all.
--
-- 20260825201024_create_allowed_emails.sql declared the column and commented it
-- as a record ("losing a person must never delete the record"), but nothing ever
-- wrote it: useUsers.invite sends `{ email, role }` and no trigger fills the
-- gap, so every row this project has ever held has created_by = null. A column
-- comment describing a record that does not exist is the false-claim defect this
-- codebase keeps a tally of, wearing a schema for a mask -- a future reader
-- would reasonably query created_by to answer "who invited this person" and get
-- a screenful of nulls that look like data loss rather than like a column nobody
-- populated.
--
-- Two ways to make the comment true: delete the column, or write it. Writing it
-- is right -- the column costs nothing, the record is genuinely wanted, and
-- deleting it would drop the FK that already handles the "the inviter left"
-- case.
--
-- A DEFAULT rather than a client-side value or a trigger:
--
--   * The client cannot be trusted with it. `created_by` is supplied by whoever
--     sends the INSERT, so a browser could name somebody else as the inviter.
--     auth.uid() evaluated inside the database reads the request's JWT and
--     cannot be spoofed by the payload.
--   * A BEFORE INSERT trigger would do the same job and is more machinery than
--     one clause needs. The guard trigger on profiles exists because Postgres
--     has no per-column RLS; there is no comparable gap here.
--   * The screen keeps sending `{ email, role }` and needs no change at all: an
--     omitted column takes its default. That is also why this is safe to apply
--     before the code that benefits from it -- there is no such code.
--
-- SYNTAX, and it is not the usual house style. Every POLICY in this schema wraps
-- auth.uid() in a subselect so Postgres evaluates it once per statement instead
-- of once per row. A DEFAULT cannot do that: `default (select auth.uid())` is
-- rejected -- "cannot use subquery in DEFAULT expression" -- because a default
-- expression may not contain a subquery at all. `default auth.uid()` is the
-- correct and only form here, and it is not the same mistake the policies avoid:
-- a default is evaluated once per row being inserted regardless.
--
-- WHAT THIS DOES NOT DO. It does not backfill. Existing rows keep their nulls,
-- which is honest: nobody knows who created them, and inventing an inviter would
-- be the same lie in the other direction. And created_by still dies with the row
-- when private.handle_new_user consumes the invitation on first sign-in --
-- Slice 3 design §5.2 records that as an accepted cost, and this migration does
-- not change it.

alter table public.allowed_emails
  alter column created_by set default auth.uid();

-- Restated in full, because a comment is the only place this default explains
-- itself to somebody reading \d+ rather than the migrations. The two sentences
-- from 20260825201024 are kept verbatim: they are still true, and dropping them
-- to make room would lose the FK's reasoning.
comment on column public.allowed_emails.created_by is
  'Who issued the invitation. Defaults to auth.uid(), so it is recorded by the database rather than supplied by the browser -- a client-sent value could name somebody else. Direct SQL (a migration, service_role, a repair from a terminal) carries no uid and stores null, which is correct: nobody issued it from the screen. Set null on profile delete, following clients.owner_id: losing a person must never delete the record. Dies with the row when the invitation is consumed -- Slice 3 design §5.2 records that as an accepted cost.';
