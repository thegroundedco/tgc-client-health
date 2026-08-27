import { describe, expect, it } from 'vitest'
import { ALL_QUESTIONS, questionsFor } from './buckets'
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
  it('is all 22 when Advocacy applies', () => {
    expect(requiredQuestions(true)).toHaveLength(22)
  })

  it('is 18 when it does not, and excludes every Advocacy question', () => {
    const required = requiredQuestions(false)
    expect(required).toHaveLength(18)
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

  it('scores Advocacy like any other bucket -- the gate is not its business', () => {
    const answers: Answers = {
      adv_left_review: 1,
      adv_case_study: 2,
      adv_would_refer: 3,
      adv_reference_check: 4,
    }
    expect(bucketScore(answers, 'advocacy')).toBe(2.5)
  })
})

describe('overallScore', () => {
  it('is the mean of all 22 answers when Advocacy applies', () => {
    expect(overallScore(allAt(3), true)).toBe(3)
  })

  it('is the mean of the 18 non-Advocacy answers when it does not', () => {
    expect(overallScore(allAt(3), false)).toBe(3)
  })

  it('ignores Advocacy answers entirely when the gate is closed', () => {
    const answers = { ...allAt(5), adv_left_review: 1, adv_case_study: 1 }
    expect(overallScore(answers, false)).toBe(5)
  })

  // This is the test that fails loudly if anyone reverts to averaging the six
  // bucket means. Spec §3.2 and §10 decision 2. Communication is all 5s (3
  // questions) and everything else is all 2s (19 questions).
  //   question-equal: (3*5 + 19*2) / 22 = 53 / 22 = 2.41
  //   bucket-equal:   (5 + 2 + 2 + 2 + 2 + 2) / 6 = 15 / 6 = 2.50
  it('weighs every question equally, not every bucket', () => {
    const answers: Answers = {
      ...allAt(2),
      comm_constructive: 5,
      comm_timely: 5,
      comm_consistent: 5,
    }
    expect(overallScore(answers, true)).toBe(2.41)
    expect(overallScore(answers, true)).not.toBe(2.5)
  })

  it('is null when one required answer is missing', () => {
    const answers = { ...allAt(4) }
    delete answers.del_on_time
    expect(overallScore(answers, true)).toBeNull()
  })

  it('is null when Advocacy applies and an Advocacy answer is missing', () => {
    const answers = { ...allAt(4) }
    delete answers.adv_would_refer
    expect(overallScore(answers, true)).toBeNull()
  })

  it('is NOT null when Advocacy is gated out and every Advocacy answer is missing', () => {
    const answers: Answers = {}
    for (const key of requiredQuestions(false)) answers[key] = 4
    expect(overallScore(answers, false)).toBe(4)
  })
})

describe('answeredCount', () => {
  it('counts only required questions, so a gated-out sheet cannot exceed 18', () => {
    expect(answeredCount(allAt(3), false)).toBe(18)
  })

  it('counts all 22 when the gate is open', () => {
    expect(answeredCount(allAt(3), true)).toBe(22)
  })

  it('ignores stray keys, because a restored draft is arbitrary JSON', () => {
    const answers = { ...allAt(3), not_a_question: 5 }
    expect(answeredCount(answers, true)).toBe(22)
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
