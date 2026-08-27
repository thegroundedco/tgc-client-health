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

export type Question = {
  // The column on public.checkins. Also the key in an Answers object.
  key: string
  prompt: string
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
      { key: 'comm_constructive', prompt: 'Provides constructive feedback.' },
      { key: 'comm_timely', prompt: 'Provides timely feedback.' },
      { key: 'comm_consistent', prompt: 'Provides consistent feedback.' },
    ],
  },
  growth: {
    label: 'Growth',
    initial: 'G',
    questions: [
      { key: 'growth_goals_defined', prompt: 'Short and long term goals are clearly defined.' },
      { key: 'growth_progress_trackable', prompt: 'We can track progress towards their goals.' },
      { key: 'growth_hitting_goals', prompt: 'We are hitting their goals.' },
    ],
  },
  finances: {
    label: 'Finances',
    initial: 'F',
    questions: [
      { key: 'fin_rack_rate', prompt: 'Paying rack rate.' },
      { key: 'fin_pays_on_time', prompt: 'Pays on time.' },
      { key: 'fin_rate_increased', prompt: 'Rate has increased over the last 90 days.' },
      { key: 'fin_on_terms', prompt: 'On terms -- a three-month commitment or longer.' },
    ],
  },
  relationship: {
    label: 'Relationship',
    initial: 'R',
    questions: [
      { key: 'rel_collaborative', prompt: 'They are collaborative.' },
      { key: 'rel_respectful', prompt: 'They are respectful.' },
      { key: 'rel_fun', prompt: 'They have fun with us.' },
      {
        key: 'rel_multi_threaded',
        prompt:
          'We are multi-threaded -- we work with their partners, and they work with ours.',
      },
    ],
  },
  delivery: {
    label: 'Delivery',
    initial: 'D',
    questions: [
      { key: 'del_on_time', prompt: 'We are delivering on time.' },
      { key: 'del_quantity', prompt: 'We are delivering a healthy quantity.' },
      { key: 'del_client_likes', prompt: 'The client likes our assets.' },
      { key: 'del_we_are_proud', prompt: 'We are proud of what we are delivering.' },
    ],
  },
  advocacy: {
    label: 'Advocacy',
    initial: 'A',
    questions: [
      { key: 'adv_left_review', prompt: 'They have left a review.' },
      { key: 'adv_case_study', prompt: 'We could use them for a case study.' },
      { key: 'adv_would_refer', prompt: 'They would refer us without being prompted.' },
      { key: 'adv_reference_check', prompt: 'We could send leads to them as a reference check.' },
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
