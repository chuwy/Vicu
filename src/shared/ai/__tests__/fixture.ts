import { readFileSync } from 'fs'
import { join } from 'path'

/** test-fixtures/ai-tools-v1.json, read whole (the app imports only the blocks it uses). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const aiFixture: any = JSON.parse(readFileSync(join(__dirname, '../../../../test-fixtures/ai-tools-v1.json'), 'utf8'))
