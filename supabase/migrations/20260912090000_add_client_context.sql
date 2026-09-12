-- Two columns asked for on the 2026-09-11 call, both about knowing WHAT KIND OF
-- CLIENT this is rather than how they are doing.
--
-- `note` exists because there was nowhere to record what a client's invoice
-- actually is. The owner's boss explained one of them on that call -- it is a
-- draw he invoices through the agency rather than an ordinary engagement -- and
-- the owner said "I can add the Fusion one. And just leave a note that it's
-- whatever Fusion is having us do." There was no field to put it in:
-- `end_reason_note` is for departures and says so.
--
-- `type_code` exists because the boss wants to see PATTERNS across kinds of
-- client, not context per client: "I don't think we need the context in it if
-- we're just looking at the data... it's more about having the visibility into
-- what happened so then we know how to apply the context." A coded value can be
-- counted and grouped; a paragraph cannot.
--
-- THE VOCABULARY IS DELIBERATELY SHORT, and that is not laziness. Exactly one
-- category was named on the call -- e-commerce -- and this page has a history
-- worth respecting: six stat lines were once invented for the Overview screen,
-- the owner did not recognise them, and they were retired as never-sourced.
-- Inventing five plausible industries here would be the same mistake in a place
-- that is far more expensive to correct, because rows get entered against them.
-- The list is meant to grow the moment he says what the categories are, and it
-- lives in one place (src/clients/clientForm.ts) so growing it is one edit.
--
-- No grants and no revokes, deliberately, for the reason the lifecycle
-- migration gives: this is an ALTER, and the table-level
-- `grant select, insert, update on public.clients to authenticated` already
-- covers new columns. What stops the wrong person writing them is the RLS
-- policy asking for `manage_clients`, not a column grant.
--
-- No CHECK constraint on type_code, matching end_reason_code: the vocabulary is
-- expected to change, and a constraint would turn every addition into a
-- migration plus a deploy rather than one edit to a list.

alter table public.clients
  add column note text,
  add column type_code text;

comment on column public.clients.note is
  'Free text about what this client IS -- an unusual billing arrangement, a '
  'relationship that is not what its name suggests. Not about why they left: '
  'that is end_reason_note, and keeping them apart is what stops a departure '
  'note being read as a description of a live client.';

comment on column public.clients.type_code is
  'What kind of business this is, from a short list held in '
  'src/clients/clientForm.ts. Coded rather than free text so kinds of client '
  'can be counted and compared -- the owner''s boss asked for visibility into '
  'patterns, not context per client. Null means nobody has said yet, which is '
  'not the same as "other".';
