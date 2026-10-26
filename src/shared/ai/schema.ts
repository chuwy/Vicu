/**
 * Validation against the JSON schema subset of docs/ai-assistant-v1.md section 2.2: `type`,
 * `properties`, `required`, `additionalProperties: false`, `items`, `enum`, `description` and
 * `anyOf`. Every answer and every set of tool arguments is checked here, whatever the provider's
 * strict mode promised. The first problem is what the repair request (2.2) and an
 * `invalid_arguments` tool result (2.3) quote.
 *
 * Pure; no imports besides the contract types.
 */
import { SCHEMA_SUBSET, type JsonSchema } from './contract'

function describe(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number'
  return typeof value
}

function matchesType(value: unknown, type: string): boolean {
  switch (type) {
    case 'object': return typeof value === 'object' && value !== null && !Array.isArray(value)
    case 'array': return Array.isArray(value)
    case 'string': return typeof value === 'string'
    case 'integer': return typeof value === 'number' && Number.isInteger(value)
    case 'number': return typeof value === 'number' && Number.isFinite(value)
    case 'boolean': return typeof value === 'boolean'
    case 'null': return value === null
    default: return false
  }
}

function typeNames(schema: JsonSchema): string {
  if (schema.anyOf) return schema.anyOf.map(typeNames).join(' or ')
  return schema.type ?? 'a value'
}

const at = (path: string): string => (path === '' ? 'the answer' : path)

/** The first problem of `value` against `schema`, or null when it matches. */
export function firstSchemaProblem(value: unknown, schema: JsonSchema, path = ''): string | null {
  if (schema.anyOf) {
    for (const option of schema.anyOf) {
      if (firstSchemaProblem(value, option, path) === null) return null
    }
    // Explain against the branch whose type matches, so the problem is specific.
    const sameType = schema.anyOf.find((option) => option.type && matchesType(value, option.type))
    if (sameType) return firstSchemaProblem(value, sameType, path)
    return `${at(path)} must be ${typeNames(schema)}, not ${describe(value)}`
  }
  if (schema.type && !matchesType(value, schema.type)) {
    return `${at(path)} must be ${schema.type}, not ${describe(value)}`
  }
  if (schema.enum && !schema.enum.some((allowed) => allowed === value)) {
    return `${at(path)} must be one of ${schema.enum.map((v) => JSON.stringify(v)).join(', ')}`
  }
  if (schema.type === 'object') {
    const object = value as Record<string, unknown>
    for (const key of schema.required ?? []) {
      if (!(key in object)) return `${at(path)} is missing "${key}"`
    }
    if (schema.additionalProperties === false) {
      const known = schema.properties ?? {}
      for (const key of Object.keys(object)) {
        if (!(key in known)) return `${at(path)} has an unknown field "${key}"`
      }
    }
    for (const [key, child] of Object.entries(schema.properties ?? {})) {
      if (!(key in object)) continue
      const problem = firstSchemaProblem(object[key], child, path === '' ? key : `${path}.${key}`)
      if (problem) return problem
    }
  }
  if (schema.type === 'array' && schema.items) {
    const items = value as unknown[]
    for (let i = 0; i < items.length; i++) {
      const problem = firstSchemaProblem(items[i], schema.items, `${path === '' ? 'the answer' : path}[${i}]`)
      if (problem) return problem
    }
  }
  return null
}

/**
 * Problems of a schema itself against the subset's rules (tests run every model-facing schema of
 * the fixture through it): only the subset's keywords and types, every object closed and listing
 * every property in `required`, optional values as `anyOf` with null.
 */
export function schemaSubsetProblems(schema: JsonSchema, path = '$'): string[] {
  const problems: string[] = []
  const keywords = new Set(SCHEMA_SUBSET.keywords)
  const types = new Set(SCHEMA_SUBSET.types)
  for (const key of Object.keys(schema)) {
    if (!keywords.has(key)) problems.push(`${path}: keyword "${key}" is not in the subset`)
  }
  if (schema.type !== undefined && !types.has(schema.type)) problems.push(`${path}: type "${schema.type}" is not in the subset`)
  if (schema.type === 'object') {
    if (schema.additionalProperties !== false) problems.push(`${path}: an object needs additionalProperties false`)
    const properties = Object.keys(schema.properties ?? {})
    const required = new Set(schema.required ?? [])
    for (const name of properties) {
      if (!required.has(name)) problems.push(`${path}: property "${name}" is not required`)
    }
    for (const name of required) {
      if (!properties.includes(name)) problems.push(`${path}: required "${name}" is not a property`)
    }
    for (const [name, child] of Object.entries(schema.properties ?? {})) {
      problems.push(...schemaSubsetProblems(child, `${path}.${name}`))
    }
  }
  if (schema.type === 'array') {
    if (!schema.items) problems.push(`${path}: an array needs items`)
    else problems.push(...schemaSubsetProblems(schema.items, `${path}[]`))
  }
  if (schema.anyOf) {
    schema.anyOf.forEach((option, i) => problems.push(...schemaSubsetProblems(option, `${path}.anyOf[${i}]`)))
  }
  if (schema.type === undefined && schema.anyOf === undefined) problems.push(`${path}: no type`)
  return problems
}

/**
 * The JSON of a model's structured answer: the text from the first `{` to the last `}` (2.2).
 * Throws with the problem when there is none or it does not parse.
 */
export function extractJsonObject(text: string): unknown {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end < start) throw new Error('the answer has no JSON object')
  try {
    return JSON.parse(text.slice(start, end + 1))
  } catch {
    throw new Error('the answer is not valid JSON')
  }
}
