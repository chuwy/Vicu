import type { LocationTrigger } from '../../../shared/synced-prefs'

/** A saved place the parser may read: its id and the name the user gave it. */
export interface PlaceRef {
  id: string
  name: string
}

/**
 * A place phrase in a text: the place, arrive or leave, where its words are (`start` until `end`,
 * what the input highlights) and what it takes out of the text (`consumed`: the words and the
 * comma or dash that joined them to the rest).
 */
export interface PlaceMatch {
  place: PlaceRef
  trigger: LocationTrigger
  start: number
  end: number
  consumed: { start: number; end: number }
}

const ARRIVE = [
  'when i get back to', 'when i get back', 'when i get to', 'when i get',
  'when i arrive back at', 'when i arrive at', 'when i arrive in', 'when i arrive',
  "when i'm back at", "when i'm back", 'when i am back at', 'when i am back',
  "when i'm at", 'when i am at', "when i'm", 'when i am',
  'when i come back to', 'when i come back', 'when i come to', 'when i come',
  'when i reach', 'once i get to', 'once i get', "once i'm at", "once i'm", 'arriving at',
]
const LEAVE = [
  'when i leave', "when i'm leaving", 'when i am leaving', 'when i get out of', 'once i leave', 'leaving',
]
const ARTICLES = ['', 'the ', 'my ']
const SEPARATORS = ' ,;:-'
const END_PUNCTUATION = '.!?'
const WORD_PART = /[\p{L}\p{Nd}']/u
const WHITESPACE = /\s/

/** Lowercased one character at a time (so positions stay put), with straight apostrophes. */
function lowercase(text: string): string {
  let out = ''
  for (const c of text) {
    if (c === '’' || c === '‘') {
      out += "'"
      continue
    }
    const lower = c.toLowerCase()
    out += lower.length === c.length ? lower : c
  }
  return out
}

function isBlank(text: string): boolean {
  return text.trim() === ''
}

/**
 * The phrase and what joins it to the rest: at the start the separators after it ("When I get
 * home, call mom"), at the end the separators before it and the closing full stop, in the middle a
 * comma right after it ("Buy milk, when I get home, and bread").
 */
function consumedRange(text: string, start: number, end: number, atStart: boolean, atEnd: boolean) {
  let first = start
  let last = end
  if (atEnd) {
    last = text.length
    while (first > 0 && SEPARATORS.includes(text[first - 1])) first--
  } else if (atStart) {
    while (last < text.length && SEPARATORS.includes(text[last])) last++
  } else {
    let next = last
    while (next < text.length && text[next] === ' ') next++
    if (next < text.length && ',;'.includes(text[next])) last = next + 1
  }
  return { start: first, end: last }
}

function titleWithout(text: string, consumed: { start: number; end: number }): string {
  const joined = `${text.slice(0, consumed.start)} ${text.slice(consumed.end)}`.replace(/\s+/g, ' ')
  let from = 0
  let to = joined.length
  const trimmable = (c: string) => SEPARATORS.includes(c) || WHITESPACE.test(c)
  while (from < to && trimmable(joined[from])) from++
  while (to > from && trimmable(joined[to - 1])) to--
  return joined.slice(from, to)
}

/**
 * Reads "when I get home", "when I arrive at Work" or "when I leave the office" in the typed text,
 * for a saved place (docs/cross-app-semantics-v1.md section 5.3; the phone's `PlacePhrases`). A
 * phrase that starts with "when" or "once" counts anywhere; the bare "leaving work" and "arriving
 * at work" only at the start or the end, where they cannot be part of the task. The longest phrase
 * wins, then the earliest; of two places with the same name, the one whose id sorts first. Null when
 * there is none or nothing would be left for a title.
 */
export function matchPlacePhrase(text: string, places: readonly PlaceRef[]): PlaceMatch | null {
  if (places.length === 0) return null
  const lower = lowercase(text)
  const candidates: Array<{ words: string; place: PlaceRef; trigger: LocationTrigger; anywhere: boolean }> = []
  // By id, so of two places with the same name the first id wins (the candidates keep this order).
  const byId = [...places].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  for (const place of byId) {
    const name = lowercase(place.name).trim()
    if (!name) continue
    for (const article of ARTICLES) {
      for (const [lead, trigger] of [
        ...ARRIVE.map((l) => [l, 'arrive'] as const),
        ...LEAVE.map((l) => [l, 'leave'] as const),
      ]) {
        candidates.push({
          words: `${lead} ${article}${name}`,
          place,
          trigger,
          anywhere: lead.startsWith('when ') || lead.startsWith('once '),
        })
      }
    }
  }

  let best: PlaceMatch | null = null
  for (const candidate of candidates) {
    let from = 0
    for (;;) {
      const start = lower.indexOf(candidate.words, from)
      if (start < 0) break
      from = start + 1
      const end = start + candidate.words.length
      if (best) {
        const length = end - start
        const bestLength = best.end - best.start
        if (length < bestLength || (length === bestLength && start >= best.start)) continue
      }
      if (start > 0 && WORD_PART.test(lower[start - 1])) continue
      if (end < lower.length && WORD_PART.test(lower[end])) continue
      const atStart = isBlank(text.slice(0, start))
      const atEnd = [...text.slice(end)].every((c) => WHITESPACE.test(c) || END_PUNCTUATION.includes(c))
      if (!candidate.anywhere && !atStart && !atEnd) continue
      const consumed = consumedRange(text, start, end, atStart, atEnd)
      if (!titleWithout(text, consumed)) continue
      best = { place: candidate.place, trigger: candidate.trigger, start, end, consumed }
    }
  }
  return best
}
