import { runGuidedSuite } from './guided-suite'

// UTC+13 in October: local mornings are still "yesterday" in UTC.
process.env.TZ = 'Pacific/Auckland'
runGuidedSuite({ zone: 'Pacific/Auckland', expectedOffsetMinutesInOctober: -780 })
