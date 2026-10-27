import { runGuidedSuite } from './guided-suite'

// The machine's own time zone (whatever the developer or CI runner uses).
runGuidedSuite({ zone: 'the system time zone' })
