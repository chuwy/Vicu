import { runDictationChecksSuite } from './dictation-checks-suite'

// UTC+13 in October: local mornings are still "yesterday" in UTC.
process.env.TZ = 'Pacific/Auckland'
runDictationChecksSuite('Pacific/Auckland')
