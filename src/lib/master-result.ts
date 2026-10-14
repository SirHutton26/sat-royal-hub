/** Shared rules for the Master Result sheet and its printed report */

const CORE: { key: string; test: RegExp }[] = [
  { key: 'english', test: /english/i },
  { key: 'maths', test: /math/i },
  { key: 'science', test: /science/i },
  { key: 'social', test: /social/i },
]

// "Social Studies" contains no "science", but "Integrated Science" must not be read as Social
const coreIndex = (name: string) => CORE.findIndex((c) => c.test.test(name))

/** English, Maths, Science, Social first (in that order), then the rest A-Z */
export function orderSubjects(subjects: string[]): string[] {
  const core = subjects.filter((s) => coreIndex(s) >= 0).sort((a, b) => coreIndex(a) - coreIndex(b))
  const rest = subjects.filter((s) => coreIndex(s) < 0).sort((a, b) => a.localeCompare(b))
  return [...core, ...rest]
}

export const isCore = (name: string) => coreIndex(name) >= 0

/** 1 (best) to 9 (worst) grade for a score out of 100 */
export function gradePoint(score: number): number {
  if (score >= 80) return 1
  if (score >= 70) return 2
  if (score >= 65) return 3
  if (score >= 60) return 4
  if (score >= 55) return 5
  if (score >= 50) return 6
  if (score >= 45) return 7
  if (score >= 40) return 8
  return 9
}

/**
 * Aggregate = grades of the 4 core subjects + the best 2 of the other subjects (lower is better).
 * A missing score counts as 0 (grade 9). Returns null when the class has no full set of core subjects.
 */
export function aggregate(subjects: string[], scores: Record<string, number | null | undefined>): number | null {
  const core = subjects.filter(isCore)
  if (core.length < 4) return null
  const pts = (s: string) => gradePoint(Number(scores[s] ?? 0))
  const coreSum = core.reduce((sum, s) => sum + pts(s), 0)
  const others = subjects
    .filter((s) => !isCore(s))
    .map(pts)
    .sort((a, b) => a - b)
    .slice(0, 2)
  return coreSum + others.reduce((a, b) => a + b, 0)
}