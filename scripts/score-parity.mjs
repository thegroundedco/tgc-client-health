// Generates the SQL that proves meanOrNull() -- the arithmetic primitive
// scoreV2.ts's bucketScore() is built from -- agrees with the six
// per-bucket generated columns. Slice 4 step 1, extended in step 2.5,
// reunified in the one-answer-type step.
//
// Extended naively from five pillars to 21 questions, an exhaustive check
// would need 6^21 states -- dead on arrival. It survives because each
// bucket's generated expression references only its own questions, so the
// space decomposes per bucket.
//
// Every question is a smallint 1-5 (spec §3.2, amended 2026-08-31), so the
// sweep is uniform: 6 values per question -- except the hours question, whose
// column only accepts 1, 2, 3 or 5, so it sweeps {null,1,2,3,5}.
//
// Finances is the one bucket with two expressions behind one column
// (20261104120000_productive_hours.sql): fin_score divides by 4 when
// fin_hours_applies and by 3 when not. So Finances is enumerated over BOTH
// states of fin_hours_applies, and over every hours value in both -- in the
// false half, a stray hours answer must not move the score, and enumerating it
// is what proves that. 2 x 6^3 x 5 = 2,160 Finances states; with Communication
// and Growth (6^3 each) and the three four-question buckets (6^4 each):
// 216 + 216 + 2,160 + 3 x 1,296 = 6,480 states.
//
// Enumerating only the values the controls can write -- null, 5, 3, 1 -- would
// be smaller and would be a verifier that checks the UI's habits rather than
// the database's contract. The columns accept any smallint 1 to 5, and August
// 2026's Finance answers contain 2s and 4s that no current control can
// produce. This enumerates what the column can hold.
//
// The SQL side does not hard-code any expression: it reads the live one out
// of pg_attrdef, per bucket, and evaluates it with dynamic SQL. So this
// checks what is deployed, not a copy of what was intended. Nothing is
// inserted and no sequence advances -- each expression is evaluated over a
// VALUES list.
import { writeFileSync } from 'node:fs'

// Both imports are LEAF modules -- neither has a relative import of its own
// -- because plain Node cannot resolve this codebase's extensionless
// imports. See Global Constraints. Importing scoreV2.ts here would fail
// ERR_MODULE_NOT_FOUND, because scoreV2.ts imports './buckets'.
import { BUCKETS, HOURS_OPTIONS, HOURS_QUESTION, questionsFor } from '../src/lib/buckets.ts'
import { meanOrNull } from '../src/lib/scoreMath.ts'

export const OUT = 'scripts/.score-parity.generated.sql'

// The expected bucket score, composed from the same meanOrNull the
// application uses -- a recomposition of scoreV2.ts's bucketScore(), which
// cannot be imported directly because it imports './buckets' extensionlessly.
// There is no dispatch on kind: every bucket is one mean over one column
// type. meanOrNull() is not a reimplementation: it is the shipped function,
// imported unchanged. bucketScore() is pinned separately, against this same
// primitive, by scoreV2.test.ts -- this file does not re-prove that.
//
// Which questions are averaged follows the state's own fin_hours_applies,
// exactly as bucketScore follows its hoursApplies argument. Buckets other than
// Finances carry no such key, and questionsFor ignores the flag for them.
export function expectedBucketScore(state, bucket) {
  const hoursApplies = state[APPLIES_COLUMN] === true
  return meanOrNull(questionsFor(bucket, hoursApplies).map((question) => state[question.key]))
}

// The values any question can hold: unanswered, or 1 through 5.
const SCALE_VALUES = [null, 1, 2, 3, 4, 5]

// The hours column's own CHECK is (1, 2, 3, 5): its options' values.
const HOURS_VALUES = [null, ...HOURS_OPTIONS.map((option) => option.value).toSorted((a, b) => a - b)]

// The stored column fin_score's expression branches on.
export const APPLIES_COLUMN = 'fin_hours_applies'

// The bucket whose generated expression references APPLIES_COLUMN.
const HOURS_BUCKET = 'finances'

function valuesFor(key) {
  return key === HOURS_QUESTION ? HOURS_VALUES : SCALE_VALUES
}

// The columns a bucket's expression reads: every question it can ask (hours
// included, even when it does not apply), plus fin_hours_applies for Finances.
export function bucketColumns(bucket) {
  const keys = questionsFor(bucket, true).map((question) => question.key)
  return bucket === HOURS_BUCKET ? [...keys, APPLIES_COLUMN] : keys
}

// Every combination of values across one bucket's own columns. This is the
// whole reason the check survives 21 questions: a bucket's generated
// expression references only its own columns, so the space is small per
// bucket rather than 6^21 across the table.
export function enumerateBucketStates(bucket) {
  let states = [{}]
  for (const key of bucketColumns(bucket)) {
    const values = key === APPLIES_COLUMN ? [false, true] : valuesFor(key)
    states = states.flatMap((state) => values.map((value) => ({ ...state, [key]: value })))
  }
  return states
}

function literal(key, value) {
  if (key === APPLIES_COLUMN) return value ? 'true' : 'false'
  return value === null ? 'null::smallint' : `${value}::smallint`
}

const BUCKET_SCORE_COLUMN = {
  communication: 'comm_score',
  growth: 'growth_score',
  finances: 'fin_score',
  relationship: 'rel_score',
  delivery: 'del_score',
  advocacy: 'adv_score',
}

function bucketCheckSql(bucket) {
  const column = BUCKET_SCORE_COLUMN[bucket]
  const keys = bucketColumns(bucket)
  const states = enumerateBucketStates(bucket)

  const rows = states
    .map((state) => {
      const expected = expectedBucketScore(state, bucket)
      const values = keys.map((key) => literal(key, state[key]))
      values.push(expected === null ? 'null::numeric' : `${expected}::numeric`)
      return `(${values.join(', ')})`
    })
    .join(',\n    ')

  const columnList = [...keys, 'expected'].join(', ')

  return `
do $parity$
declare
  v_expr text;
  v_bad bigint;
begin
  select pg_get_expr(d.adbin, d.adrelid)
    into v_expr
    from pg_attrdef d
    join pg_attribute a
      on a.attrelid = d.adrelid and a.attnum = d.adnum
   where d.adrelid = 'public.checkins'::regclass
     and a.attname = '${column}';

  if v_expr is null then
    raise exception 'score parity COULD NOT VERIFY: no generated expression on ${column}';
  end if;

  execute format(
    'select count(*) from (values %s) as t(${columnList}) where round((%s)::numeric, 2) is distinct from t.expected',
    $rows$${rows}$rows$,
    v_expr
  ) into v_bad;

  if v_bad > 0 then
    raise exception 'score parity FAILED for ${column}: % of ${states.length} states disagree between scoreMath.ts''s meanOrNull() and the deployed expression', v_bad;
  end if;

  raise notice 'score parity ok for ${column}: ${states.length} states';
end
$parity$;
`
}

export function buildSql() {
  const blocks = BUCKETS.map((bucket) => bucketCheckSql(bucket))
  const total = BUCKETS.reduce(
    (sum, bucket) => sum + enumerateBucketStates(bucket).length,
    0,
  )

  const sql = `-- GENERATED by scripts/score-parity.mjs. Do not edit, and do not commit.
-- ${total} states across ${BUCKETS.length} buckets, decomposed per bucket -- each
-- bucket's generated expression references only its own questions, so this is
-- exhaustive without enumerating the full 6^21 state space.
-- Each block below raises an exception on the first disagreement and names
-- the bucket, so a green run means every state agreed for every bucket -- not
-- that the file was empty.
${blocks.join('\n')}
do $$
begin
  raise notice 'score parity PASSED: all ${total} states agree, across ${BUCKETS.length} buckets';
end $$;
`
  return { sql, total }
}

if (import.meta.main) {
  const { sql, total } = buildSql()
  writeFileSync(OUT, sql)
  console.log(`wrote ${OUT}: ${total} states across ${BUCKETS.length} buckets`)
}
