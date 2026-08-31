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

export type QuestionKind = 'scale' | 'yesno'

export type Question = {
  // The column on public.checkins. Also the key in an Answers object.
  key: string
  prompt: string
  // How it is answered, and therefore what column type holds it. 'scale' is a
  // 1-5 smallint; 'yesno' is a boolean. Carried per question rather than per
  // bucket, even though today every yesno question happens to be in Advocacy:
  // the rubric is the one place that knows what a question IS, and a consumer
  // asking "is this bucket Advocacy?" to decide how to render a control would
  // be reading identity where it means to read type.
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
      { key: 'fin_rack_rate', prompt: 'Paying rack rate.', kind: 'scale' },
      { key: 'fin_pays_on_time', prompt: 'Pays on time.', kind: 'scale' },
      { key: 'fin_rate_increased', prompt: 'Rate has increased over the last 90 days.', kind: 'scale' },
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
      { key: 'adv_left_review', prompt: 'They have left a review.', kind: 'yesno' },
      { key: 'adv_case_study', prompt: 'We could use them for a case study.', kind: 'yesno' },
      { key: 'adv_would_refer', prompt: 'They would refer us without being prompted.', kind: 'yesno' },
      {
        key: 'adv_reference_check',
        prompt: 'We could send leads to them as a reference check.',
        kind: 'yesno',
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

export function isYesNo(key: string): boolean {
  return YESNO_KEYS.includes(key)
}

const YESNO_KEYS: readonly string[] = BUCKETS.flatMap((bucket) =>
  questionsFor(bucket)
    .filter((question) => question.kind === 'yesno')
    .map((question) => question.key),
)

// The seventeen the overall is the mean of. Spec §3.2 as amended: Advocacy is
// excluded whether the gate is open or shut, so unlike requiredQuestions() in
// scoreV2 this takes no gate argument and never varies. Keeping the two apart
// is the whole point -- they were one number before 2026-08-28 and are two now.
export const OVERALL_QUESTIONS: readonly string[] = BUCKETS.flatMap((bucket) =>
  questionsFor(bucket)
    .filter((question) => question.kind === 'scale')
    .map((question) => question.key),
)
