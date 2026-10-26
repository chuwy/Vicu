import { runDictationChecksSuite } from './dictation-checks-suite'

process.env.TZ = 'America/New_York'
runDictationChecksSuite('America/New_York')
