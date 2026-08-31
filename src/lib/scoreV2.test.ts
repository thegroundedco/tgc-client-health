import { describe, expect, it } from 'vitest'
import { ALL_QUESTIONS, isYesNo, OVERALL_QUESTIONS, questionsFor } from './buckets'
import {
  answeredCount,
  bandFor,
  bucketScore,
  overallScore,
  requiredQuestions,
  type Answers,
} from './scoreV2'

// Builds a complete answer sheet with every question set to `value`.
function allAt(value: number): Answers {
  return Object.fromEntries(ALL_QUESTIONS.map((key) => [key, value]))
}

describe('requiredQuestions', () => {
  it('is all 21 when Advocacy applies', () => {
    expect(requiredQuestions(true)).toHaveLength(21)
  })

  it('is 17 when it does not, and excludes every Advocacy question', () => {
    const required = requiredQuestions(false)
    expect(required).toHaveLength(17)
    for (const question of questionsFor('advocacy')) {
      expect(required).not.toContain(question.key)
    }
  })
})

describe('bucketScore', () => {
  it('is the mean of the bucket\'s own questions', () => {
    const answers: Answers = {
      comm_constructive: 5,
      comm_timely: 4,
      comm_consistent: 3,
    }
    expect(bucketScore(answers, 'communication')).toBe(4)
  })

  it('rounds to two decimals', () => {
    const answers: Answers = {
      comm_constructive: 5,
      comm_timely: 4,
      comm_consistent: 4,
    }
    // 13 / 3 = 4.333...
    expect(bucketScore(answers, 'communication')).toBe(4.33)
  })

  it('is null when any of its questions is unanswered', () => {
    const answers: Answers = { comm_constructive: 5, comm_timely: 4 }
    expect(bucketScore(answers, 'communication')).toBeNull()
  })

  it('is null when a question is explicitly null, not just absent', () => {
    const answers: Answers = {
      comm_constructive: 5,
      comm_timely: 4,
      comm_consistent: null,
    }
    expect(bucketScore(answers, 'communication')).toBeNull()
  })

  // Retired 2026-08-28: Advocacy's four questions became yes/no booleans, so
  // this can no longer be a mean of 1-5 numbers. Replaced in place (not merged
  // with the new yes/no test below) with the boolean equivalent: two Yeses and
  // two Noes is 1 + 2 = 3, the same arithmetic yesNoScore.test.ts covers directly.
  it('scores Advocacy with yes/no arithmetic, not a mean -- the gate is not its business', () => {
    const answers: Answers = {
      adv_left_review: true,
      adv_case_study: true,
      adv_would_refer: false,
      adv_reference_check: false,
    }
    expect(bucketScore(answers, 'advocacy')).toBe(3)
  })
})

describe('overallScore', () => {
  // Retitled 2026-08-28: the signature lost its gate parameter, because the
  // divisor is now always 17 regardless of the gate. Value is unchanged from
  // before the amendment only because allAt(3) happens to set the 17 scale
  // answers to 3 as well; the "when Advocacy applies" framing is what's retired.
  it('is the mean of the 17 scale answers', () => {
    expect(overallScore(allAt(3))).toBe(3)
  })

  // Retitled 2026-08-28, same reason as above: this was the gate-false
  // counterpart of the test just above, and with the gate parameter gone the
  // two calls are now identical. Kept rather than merged, per this project's
  // rule against folding tests together, even though they now overlap exactly.
  it('is the mean of the 17 non-Advocacy answers', () => {
    expect(overallScore(allAt(3))).toBe(3)
  })

  // Retitled 2026-08-28: this is no longer conditional on a gate -- Advocacy is
  // ignored unconditionally now. The values still exercise the same case (some
  // Advocacy answers present and low) with the gate argument simply removed.
  it('ignores Advocacy answers entirely', () => {
    const answers = { ...allAt(5), adv_left_review: 1, adv_case_study: 1 }
    expect(overallScore(answers)).toBe(5)
  })

  // This is the test that fails loudly if anyone reverts to averaging the six
  // bucket means. Spec §3.2 and §10 decision 2, amended 2026-08-28, and Task 2
  // of the On-Terms removal: the divisor dropped from 22 to 18 when Advocacy
  // left it, then from 18 to 17 when fin_on_terms was removed, so the
  // arithmetic below is recomputed against the 17. Communication is all 5s (3
  // questions) and the other four non-Advocacy buckets are all 2s (14
  // questions); Advocacy itself is irrelevant here since overallScore never
  // reads it.
  //   question-equal: (3*5 + 14*2) / 17 = 43 / 17 = 2.53
  //   bucket-equal:   (5 + 2 + 2 + 2 + 2) / 5 = 13 / 5 = 2.60
  it('weighs every question equally, not every bucket', () => {
    const answers: Answers = {
      ...allAt(2),
      comm_constructive: 5,
      comm_timely: 5,
      comm_consistent: 5,
    }
    expect(overallScore(answers)).toBe(2.53)
    expect(overallScore(answers)).not.toBe(2.6)
  })

  it('is null when one required answer is missing', () => {
    const answers = { ...allAt(4) }
    delete answers.del_on_time
    expect(overallScore(answers)).toBeNull()
  })

  // Retired 2026-08-28: this used to assert null, back when Advocacy still
  // counted toward the divisor. The amendment's whole point is that it no
  // longer does, so a missing Advocacy answer must NOT null out the overall --
  // replaced in place with that corrected expectation, not merged with the
  // "every Advocacy answer is blank" case below, which is the all-four version
  // of this same one-missing case.
  it('is NOT null when an Advocacy answer is missing -- Advocacy is not in the divisor', () => {
    const answers = { ...allAt(4) }
    delete answers.adv_would_refer
    expect(overallScore(answers)).toBe(4)
  })

  it('is NOT null when Advocacy is gated out and every Advocacy answer is missing', () => {
    const answers: Answers = {}
    for (const key of requiredQuestions(false)) answers[key] = 4
    expect(overallScore(answers)).toBe(4)
  })
})

describe('answeredCount', () => {
  it('counts only required questions, so a gated-out sheet cannot exceed 17', () => {
    expect(answeredCount(allAt(3), false)).toBe(17)
  })

  it('counts all 21 when the gate is open', () => {
    expect(answeredCount(allAt(3), true)).toBe(21)
  })

  it('ignores stray keys, because a restored draft is arbitrary JSON', () => {
    const answers = { ...allAt(3), not_a_question: 5 }
    expect(answeredCount(answers, true)).toBe(21)
  })
})

describe('bandFor', () => {
  it('reports not scored for null', () => {
    expect(bandFor(null)).toBe('incomplete')
  })

  it('is healthy at the threshold and above', () => {
    expect(bandFor(3.6)).toBe('healthy')
    expect(bandFor(5)).toBe('healthy')
  })

  it('is watch from its threshold up to just under healthy', () => {
    expect(bandFor(2.2)).toBe('watch')
    expect(bandFor(3.59)).toBe('watch')
  })

  it('is at risk below the watch threshold', () => {
    expect(bandFor(2.19)).toBe('at_risk')
    expect(bandFor(1)).toBe('at_risk')
  })
})

describe('overallScore (amendment coverage)', () => {
  // Spec §3.2 amended: Advocacy never counts. The signature has no gate
  // parameter at all, which is the point -- there is no way to ask for the old
  // 21-divisor behaviour by accident.
  it('is the mean of the 17, and ignores Advocacy entirely', () => {
    const seventeen = Object.fromEntries(OVERALL_QUESTIONS.map((k) => [k, 4]))
    expect(overallScore(seventeen)).toBe(4)
    // Adding every Advocacy answer, either way, must not move it.
    const withYes = { ...seventeen, adv_left_review: true, adv_case_study: true,
                      adv_would_refer: true, adv_reference_check: true }
    const withNo = { ...seventeen, adv_left_review: false, adv_case_study: false,
                     adv_would_refer: false, adv_reference_check: false }
    expect(overallScore(withYes)).toBe(4)
    expect(overallScore(withNo)).toBe(4)
  })

  // The regression that would signal a reversion to the old model.
  it('still has an overall when every Advocacy answer is blank', () => {
    const seventeen = Object.fromEntries(OVERALL_QUESTIONS.map((k) => [k, 3]))
    expect(overallScore(seventeen)).toBe(3)
  })

  it('is null when any one of the 17 is missing', () => {
    for (const key of OVERALL_QUESTIONS) {
      const answers = Object.fromEntries(OVERALL_QUESTIONS.map((k) => [k, 3]))
      delete answers[key]
      expect(overallScore(answers)).toBeNull()
    }
  })
})

describe('bucketScore (amendment coverage)', () => {
  it('uses the yes/no arithmetic for Advocacy and the mean for the rest', () => {
    expect(bucketScore({ adv_left_review: true, adv_case_study: true,
                         adv_would_refer: false, adv_reference_check: false },
                       'advocacy')).toBe(3)
    expect(bucketScore({ comm_constructive: 2, comm_timely: 4,
                         comm_consistent: 3 }, 'communication')).toBe(3)
  })

  it('is null for a bucket with any unanswered question, either kind', () => {
    expect(bucketScore({ adv_left_review: true }, 'advocacy')).toBeNull()
    expect(bucketScore({ comm_constructive: 2 }, 'communication')).toBeNull()
  })
})

describe('requiredQuestions and answeredCount (amendment coverage)', () => {
  // UNCHANGED by the amendment. required is about COMPLETENESS -- how many
  // answers before a check-in may be submitted -- and is still 21 gate-open.
  // Only the overall's divisor moved. Keeping these two apart is the point.
  it('still requires 21 when the gate is open and 17 when it is shut', () => {
    expect(requiredQuestions(true)).toHaveLength(21)
    expect(requiredQuestions(false)).toHaveLength(17)
  })

  // false is an ANSWER. Counting it as unanswered would make a complete
  // check-in permanently unsubmittable for a client with nothing to advocate.
  it('counts a No as answered', () => {
    const answers = Object.fromEntries(requiredQuestions(true).map(
      (k) => [k, isYesNo(k) ? false : 3]))
    expect(answeredCount(answers, true)).toBe(21)
  })
})
