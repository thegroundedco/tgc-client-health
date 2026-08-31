// Generates the SQL that proves meanOrNull() and yesNoScore() -- the
// arithmetic primitives scoreV2.ts's bucketScore() is built from -- agree
// with the six per-bucket generated columns. Slice 4 step 1, extended in
// step 2.5.
//
// Extended naively from five pillars to 22 questions, an exhaustive check
// would need 6^22 states -- dead on arrival. It survives because each
// bucket's generated expression references only its own questions, so the
// space decomposes per bucket.
//
// Advocacy's four questions became yes/no booleans (spec §3.1/§3.2, amended
// 2026-08-28): each has THREE reachable states -- unanswered, yes, no --
// rather than six, so its arm is checked through yesNoScore() over 3^4 = 81
// states rather than through meanOrNull() over 6^4 = 1,296. The other five
// buckets are unchanged: 6^3 = 216 states for each of the three
// three-question buckets, and 6^4 = 1,296 for each of the two
// four-question scale buckets. 3*6^3 (Communication, Growth, Finances) +
// 2*6^4 (Relationship, Delivery) + 3^4 (Advocacy) = 648 + 2,592 + 81 = 3,321
// states -- fewer than the 5,616 the pre-step-2.5 version checked, and
// still exhaustive -- every reachable input to every deployed bucket
// expression.
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
import { BUCKETS, questionsFor } from '../src/lib/buckets.ts'
import { meanOrNull, yesNoScore } from '../src/lib/scoreMath.ts'

export const OUT = 'scripts/.score-parity.generated.sql'

// The expected bucket score, composed here from the same meanOrNull /
// yesNoScore the application uses -- a line-for-line recomposition of
// scoreV2.ts's own bucketScore(), which cannot be imported directly (see
// above). Dispatch is on the QUESTION's kind, never on the bucket's name:
// today only Advocacy holds yesno questions, but the rubric -- not this
// file -- is what knows that. Neither primitive is a reimplementation: both
// are the shipped functions, imported unchanged. bucketScore() is pinned
// separately, against these same primitives, by scoreV2.test.ts -- this
// file does not re-prove that.
function expectedBucketScore(state, bucket) {
  const questions = questionsFor(bucket)
  const values = questions.map((question) => state[question.key])
  // A bucket's questions share one kind today (buckets.test.ts pins that),
  // so the first question's kind decides which primitive the whole bucket
  // uses.
  return questions[0].kind === 'yesno' ? yesNoScore(values) : meanOrNull(values)
}

// The values a scale question can hold: unanswered, or 1 through 5. A yesno
// question holds only three: unanswered, yes, no.
const SCALE_VALUES = [null, 1, 2, 3, 4, 5]
const YESNO_VALUES = [null, true, false]

function valuesFor(question) {
  return question.kind === 'yesno' ? YESNO_VALUES : SCALE_VALUES
}

// Every combination of values across one bucket's own questions. This is the
// whole reason the check survives 21 questions: a bucket's generated
// expression references only its own columns, so the space is (3 or 6)^n
// per bucket rather than 6^21 across the table.
export function enumerateBucketStates(bucket) {
  const questions = questionsFor(bucket)
  let states = [{}]
  for (const question of questions) {
    const values = valuesFor(question)
    states = states.flatMap((state) =>
      values.map((value) => ({ ...state, [question.key]: value })),
    )
  }
  return states
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
  const questions = questionsFor(bucket)
  const keys = questions.map((question) => question.key)
  const states = enumerateBucketStates(bucket)

  const rows = states
    .map((state) => {
      const expected = expectedBucketScore(state, bucket)
      const values = questions.map((question) => {
        const value = state[question.key]
        const sqlType = question.kind === 'yesno' ? 'boolean' : 'smallint'
        return value === null ? `null::${sqlType}` : `${value}::${sqlType}`
      })
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
    raise exception 'score parity FAILED for ${column}: % of ${states.length} states disagree between scoreMath.ts''s meanOrNull()/yesNoScore() and the deployed expression', v_bad;
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
