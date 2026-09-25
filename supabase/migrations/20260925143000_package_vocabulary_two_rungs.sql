-- The package vocabulary is two rungs, not three. This corrects a COMMENT only:
-- no column, constraint, policy or row changes.
--
-- 20260912140000_add_client_packages.sql described package_code as "Foundation,
-- grow or scale -- the three named on the 2026-09-11 call". That was an accurate
-- record of the call and a wrong description of the business, and because a
-- comment lives in the database rather than in the file, the stale text is what
-- anyone inspecting the schema reads. The migration that wrote it is history and
-- is not edited; this supersedes it.
--
-- What the owner corrected on 2026-09-25:
--
--   Foundation is a finite PHASE, done by itself at the start of an engagement
--   -- branding, messaging, website, photoshoot.
--
--   Grow is the ongoing creative, in sprints, and is where a client lives once
--   Foundation is finished.
--
--   Scale is NOT a rung. It is a class of post-foundation PROJECT -- a website
--   rebuild, a rebrand, a roadshow, event collateral -- and it runs ALONGSIDE
--   Grow rather than after it.
--
-- A client signs at Foundation or at Grow, never at Scale, and may end the
-- relationship during Foundation without ever reaching Grow.
--
-- WHY THE OLD TEXT WAS DANGEROUS RATHER THAN MERELY WRONG. Ordered above grow,
-- scale broke both directions at once: a Grow client starting a website rebuild
-- read as having CLIMBED, and left the Grow count while doing the most work;
-- finishing that project read as a DESCENT, which the Overview page published
-- under the client's own name. Neither event happened. A schema comment naming
-- scale as a rung invites exactly that model back.
--
-- No CHECK constraint is added, and that stays deliberate: the vocabulary lives
-- in src/clients/clientPackages.ts so a rung is one edit rather than a migration,
-- the same arrangement clients.end_reason_code has. tests/packageImport.test.ts
-- guards the one duplicate copy, in the backfill script node runs directly.

comment on column public.client_packages.package_code is
  'Foundation or grow -- the two rungs a client can sign at and move between. '
  'Scale is NOT a rung: it is a class of post-foundation project (website '
  'rebuild, rebrand, roadshow) that runs alongside grow, and this tool has no '
  'concept of projects. The vocabulary lives in src/clients/clientPackages.ts '
  'and there is deliberately no CHECK constraint here, so a rung is one edit '
  'rather than a migration. The same arrangement clients.end_reason_code has.';
