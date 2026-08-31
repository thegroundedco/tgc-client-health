// The rubric, as code rather than as a table -- the same ruling that deferred
// `pillar_definitions` in Slice 1. Spec §10 decision 5 records the cost: unlike
// the five pillars, which changed zero times in a year, this list is days old,
// and under the schema shape chosen in spec §5 a NEW question is a migration
// rather than an edit. If it moves twice more, revisit.
//
// Every `key` below is the literal column name on public.checkins. There is no
// mapping layer between the rubric and the schema on purpose: a mapping is one
// more place a typo can send an answer to the wrong column and still typecheck.

export const BUCKETS = [
  'communication',
  'growth',
  'finances',
  'relationship',
  'delivery',
  'advocacy',
] as const

export type Bucket = (typeof BUCKETS)[number]

// Advocacy is not scored inside a client's first 90 days. Named rather than
// written as the string at each call site, so the gate has one definition.
export const GATED_BUCKET: Bucket = 'advocacy'

export type QuestionKind = 'scale' | 'choice'

export type Question = {
  // The column on public.checkins. Also the key in an Answers object.
  key: string
  prompt: string
  // Which CONTROL the check-in screen draws, and nothing more. Every answer,
  // whatever its kind, is a nullable smallint 1-5 in the same shape of column
  // and is scored by the same mean (spec §3.2, amended 2026-08-31). 'scale'
  // draws five numbered radios; 'choice' draws the three in CHOICE_OPTIONS.
  //
  // This USED to decide how a bucket was scored and, through a filter on it,
  // which questions the overall averaged. Both of those were wrong: the first
  // capped a three-question yes/no bucket at 4.00, and the second meant that
  // changing a question's control silently changed the headline divisor.
  kind: QuestionKind
}

export type BucketDefinition = {
  label: string
  // The one letter the board's card puts under that bucket's bar. Written out
  // rather than derived from label[0], because a derivation cannot complain
  // when two buckets collide -- buckets.test.ts asserts all six stay distinct
  // AND that each still matches its label, so a rename fails the build.
  initial: string
  questions: readonly Question[]
}

export const BUCKET_DEFINITIONS: Record<Bucket, BucketDefinition> = {
  communication: {
    label: 'Communication',
    initial: 'C',
    questions: [
      { key: 'comm_constructive', prompt: 'Provides constructive feedback.', kind: 'scale' },
      { key: 'comm_timely', prompt: 'Provides timely feedback.', kind: 'scale' },
      { key: 'comm_consistent', prompt: 'Provides consistent feedback.', kind: 'scale' },
    ],
  },
  growth: {
    label: 'Growth',
    initial: 'G',
    questions: [
      { key: 'growth_goals_defined', prompt: 'Short and long term goals are clearly defined.', kind: 'scale' },
      { key: 'growth_progress_trackable', prompt: 'We can track progress towards their goals.', kind: 'scale' },
      { key: 'growth_hitting_goals', prompt: 'We are hitting their goals.', kind: 'scale' },
    ],
  },
  finances: {
    label: 'Finances',
    initial: 'F',
    questions: [
      { key: 'fin_rack_rate', prompt: 'Paying rack rate.', kind: 'choice' },
      { key: 'fin_pays_on_time', prompt: 'Pays on time.', kind: 'choice' },
      { key: 'fin_rate_increased', prompt: 'Rate has increased over the last 90 days.', kind: 'choice' },
    ],
  },
  relationship: {
    label: 'Relationship',
    initial: 'R',
    questions: [
      { key: 'rel_collaborative', prompt: 'They are collaborative.', kind: 'scale' },
      { key: 'rel_respectful', prompt: 'They are respectful.', kind: 'scale' },
      { key: 'rel_fun', prompt: 'They have fun with us.', kind: 'scale' },
      {
        key: 'rel_multi_threaded',
        prompt:
          'We are multi-threaded, we work with their partners, and they work with ours.',
        kind: 'scale',
      },
    ],
  },
  delivery: {
    label: 'Delivery',
    initial: 'D',
    questions: [
      { key: 'del_on_time', prompt: 'We are delivering on time.', kind: 'scale' },
      { key: 'del_quantity', prompt: 'We are delivering a healthy quantity.', kind: 'scale' },
      { key: 'del_client_likes', prompt: 'The client likes our assets.', kind: 'scale' },
      { key: 'del_we_are_proud', prompt: 'We are proud of what we are delivering.', kind: 'scale' },
    ],
  },
  advocacy: {
    label: 'Advocacy',
    initial: 'A',
    questions: [
      { key: 'adv_left_review', prompt: 'They have left a review.', kind: 'choice' },
      { key: 'adv_case_study', prompt: 'We could use them for a case study.', kind: 'choice' },
      { key: 'adv_would_refer', prompt: 'They would refer us without being prompted.', kind: 'choice' },
      {
        key: 'adv_reference_check',
        prompt: 'We could send leads to them as a reference check.',
        kind: 'choice',
      },
    ],
  },
}

export function questionsFor(bucket: Bucket): readonly Question[] {
  return BUCKET_DEFINITIONS[bucket].questions
}

export const ALL_QUESTIONS: readonly string[] = BUCKETS.flatMap((bucket) =>
  questionsFor(bucket).map((question) => question.key),
)

export type QuestionKey = (typeof ALL_QUESTIONS)[number]

// The three answers a `choice` question offers, and the value each writes.
//
// Ascending, so that every control on the check-in screen runs worse-left to
// better-right -- the same direction as QuestionRow's 1 through 5. The old
// two-option row read Yes then No, against that direction; on a screen where 14
// rows run one way and 7 the other, the leftmost box is a trap.
//
// The values are the losslessness argument of spec §3.2, not a preference: a
// four-question bucket answered in 5s and 1s produces exactly what the retired
// `1 + yeses` produced, so no Advocacy score moves. Changing them rescales
// history.
export const CHOICE_OPTIONS = [
  { label: 'No', value: 1 },
  { label: 'Unsure', value: 3 },
  { label: 'Yes', value: 5 },
] as const

// The label a `choice` answer reads as, for the "last month" line. Undefined for
// a value no control can write -- a legacy 2 or 4 in a Finance column, which is
// real data (August 2026) and must not be rendered as though it were a choice.
export function choiceLabel(value: number): string | undefined {
  return CHOICE_OPTIONS.find((option) => option.value === value)?.label
}

// The one bucket the headline number leaves out. Named apart from GATED_BUCKET
// even though both are Advocacy today, because they are two unrelated facts
// that coincide: the gate is about a client being too new to judge, and this is
// the owner's ruling that Advocacy must not move the number clients are
// compared on (spec §3.2). Deriving one from the other would mean that changing
// the gate silently changed the divisor.
export const OVERALL_EXCLUDED: Bucket = 'advocacy'

// The seventeen the overall is the mean of: every question except Advocacy's,
// whether the gate is open or shut. Unlike requiredQuestions() in scoreV2 this
// takes no gate argument and never varies.
//
// This filtered on `kind === 'scale'` until 2026-08-31, which gave the right
// answer for the wrong reason -- it excluded Advocacy BECAUSE Advocacy was
// answered with booleans. The moment Finances moved to the same control, that
// filter would have dropped Finances out of the headline score too: divisor 17
// to 14, every client's number moved, and nothing failing. buckets.test.ts pins
// the count at seventeen.
export const OVERALL_QUESTIONS: readonly string[] = BUCKETS.filter(
  (bucket) => bucket !== OVERALL_EXCLUDED,
).flatMap((bucket) => questionsFor(bucket).map((question) => question.key))
