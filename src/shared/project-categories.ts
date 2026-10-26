/**
 * Project categories (docs/cross-app-semantics-v1.md section 13): optional named headers that group
 * the top-level projects of the project list ("Work", "Home"). They belong to the user and sync
 * through the preferences carrier (section 11) as `category.<categoryId>` (`{ name, order }`) and
 * `category.project.<projectId>` (the category a top-level project is in). Vikunja knows nothing
 * of them. This module holds the rules: reading the entries, the layout, and the entries each
 * change writes. Android has the same rules; both run the `projectCategories` vectors of
 * `test-fixtures/cross-app-semantics-v1.json`.
 *
 * Import-free, so every tsconfig can include it.
 */

export const CATEGORY_KEY_PREFIX = 'category.'
export const PROJECT_CATEGORY_KEY_PREFIX = 'category.project.'
/** The distance between the orders of neighbouring categories (section 13.4). */
export const CATEGORY_ORDER_STEP = 65_536
/** Neighbours closer than this leave no room between them: every category is renumbered. */
const MIN_ORDER_GAP = 1

const CATEGORY_ID = /^[A-Za-z0-9_-]{1,64}$/
const PROJECT_ID = /^[1-9]\d*$/
/** `project` would read as the start of a `category.project.<id>` key. */
const RESERVED_CATEGORY_ID = 'project'

/** A category's value: what an app uses of it (other fields are kept in the entry, never read). */
export interface CategoryPref {
  name: string
  order: number
}

export interface ProjectCategory extends CategoryPref {
  id: string
}

/** What the layout needs of a project. */
export interface CategoryLayoutProject {
  id: number
  parent_project_id?: number | null
  /** A missing position counts as 0. */
  position?: number | null
  is_archived?: boolean
}

/** One group of the project list: a category (null: the projects without one) and its top-level projects. */
export interface CategoryGroup {
  category: ProjectCategory | null
  projectIds: number[]
}

/** The entries a change writes, by key (`null` deletes a category or takes a project out of its category). */
export type CategoryWrites = Record<string, unknown>

type Values = Readonly<Record<string, unknown>>

export function isCategoryId(id: unknown): id is string {
  return typeof id === 'string' && CATEGORY_ID.test(id) && id !== RESERVED_CATEGORY_ID
}

export function categoryKey(categoryId: string): string {
  return `${CATEGORY_KEY_PREFIX}${categoryId}`
}

export function projectCategoryKey(projectId: number): string {
  return `${PROJECT_CATEGORY_KEY_PREFIX}${projectId}`
}

/** The project id of a `category.project.<id>` key (a server id, above 0), or null. */
export function projectIdOfCategoryKey(key: string): number | null {
  if (!key.startsWith(PROJECT_CATEGORY_KEY_PREFIX)) return null
  const raw = key.slice(PROJECT_CATEGORY_KEY_PREFIX.length)
  if (!PROJECT_ID.test(raw)) return null
  const id = Number(raw)
  return Number.isSafeInteger(id) ? id : null
}

/** The category id of a `category.<id>` key, or null (an assignment key is not a category key). */
export function categoryIdOfKey(key: string): string | null {
  if (!key.startsWith(CATEGORY_KEY_PREFIX) || key.startsWith(PROJECT_CATEGORY_KEY_PREFIX)) return null
  const id = key.slice(CATEGORY_KEY_PREFIX.length)
  return isCategoryId(id) ? id : null
}

/** A category value: a name that is not blank and a number as its order, or null. Other fields are left out. */
export function readCategoryPref(value: unknown): CategoryPref | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const { name, order } = value as Record<string, unknown>
  if (typeof name !== 'string' || name.trim() === '') return null
  if (typeof order !== 'number' || !Number.isFinite(order)) return null
  return { name, order }
}

/** An assignment value: a category id, or null (no entry, a reset, or a value that cannot name one). */
export function readProjectCategoryPref(value: unknown): string | null {
  return isCategoryId(value) ? value : null
}

/** Display order (13.3): by order, then by name lowercased, then by id, both by UTF-16 code units. */
export function compareCategories(a: ProjectCategory, b: ProjectCategory): number {
  if (a.order !== b.order) return a.order < b.order ? -1 : 1
  const left = a.name.toLowerCase()
  const right = b.name.toLowerCase()
  if (left !== right) return left < right ? -1 : 1
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/** The usable categories (deleted and malformed ones left out), in display order. */
export function usableCategories(values: Values): ProjectCategory[] {
  const categories: ProjectCategory[] = []
  for (const [key, value] of Object.entries(values)) {
    const id = categoryIdOfKey(key)
    const category = id ? readCategoryPref(value) : null
    if (id && category) categories.push({ id, ...category })
  }
  return categories.sort(compareCategories)
}

export function hasUsableCategories(values: Values): boolean {
  return usableCategories(values).length > 0
}

const positionOf = (project: CategoryLayoutProject) => project.position ?? 0

/**
 * The top-level projects (13.2), by position and then id: not archived, not the Inbox, and with
 * a parent of 0 or one that is not listed (archived, the Inbox, or not visible to the user).
 */
export function topLevelProjects<T extends CategoryLayoutProject>(projects: readonly T[], inboxProjectId: number): T[] {
  const listed = new Map<number, T>()
  for (const project of projects) {
    if (!project.is_archived && project.id !== inboxProjectId) listed.set(project.id, project)
  }
  return [...listed.values()]
    .filter((project) => {
      const parent = project.parent_project_id ?? 0
      return parent === 0 || !listed.has(parent)
    })
    .sort((a, b) => positionOf(a) - positionOf(b) || a.id - b.id)
}

/** The usable category a top-level project's own entry names, or null. */
function categoryIdOfProject(values: Values, projectId: number, usable: ReadonlySet<string>): string | null {
  const id = readProjectCategoryPref(values[projectCategoryKey(projectId)])
  return id !== null && usable.has(id) ? id : null
}

/**
 * The project list's groups (13.3): first the top-level projects without a category (always
 * there, even empty; it has no header), then every usable category with its top-level projects.
 * Subprojects stay below their parent and are not listed here.
 */
export function categoryLayout(projects: readonly CategoryLayoutProject[], inboxProjectId: number, values: Values): CategoryGroup[] {
  const categories = usableCategories(values)
  const usable = new Set(categories.map((category) => category.id))
  const groups: CategoryGroup[] = [
    { category: null, projectIds: [] },
    ...categories.map((category) => ({ category, projectIds: [] as number[] })),
  ]
  const byId = new Map(groups.map((group) => [group.category?.id ?? null, group]))
  for (const project of topLevelProjects(projects, inboxProjectId)) {
    byId.get(categoryIdOfProject(values, project.id, usable))!.projectIds.push(project.id)
  }
  return groups
}

/** The group a top-level project is in, or null for a project that is not top-level. */
export function groupOfProject(layout: readonly CategoryGroup[], projectId: number): CategoryGroup | null {
  return layout.find((group) => group.projectIds.includes(projectId)) ?? null
}

// --- Changes (13.4) --------------------------------------------------------------------------

/**
 * The orders that place `movedId` where it is in `order` (category ids in the new display order),
 * by id: the moved one's alone, or every category's when its neighbours leave no room.
 */
function ordersAfterMove(order: readonly string[], movedId: string, orderOf: (id: string) => number): Map<string, number> {
  const index = order.indexOf(movedId)
  const before = index > 0 ? orderOf(order[index - 1]) : null
  const after = index < order.length - 1 ? orderOf(order[index + 1]) : null
  if (before === null && after === null) return new Map([[movedId, CATEGORY_ORDER_STEP]])
  if (before === null) return new Map([[movedId, after! - CATEGORY_ORDER_STEP]])
  if (after === null) return new Map([[movedId, before + CATEGORY_ORDER_STEP]])
  if (after - before >= MIN_ORDER_GAP) return new Map([[movedId, (before + after) / 2]])
  return new Map(order.map((id, position) => [id, (position + 1) * CATEGORY_ORDER_STEP]))
}

/** The category's entry as stored (its other fields kept) with a new order or name. */
function rewritten(values: Values, categoryId: string, change: Partial<CategoryPref>): Record<string, unknown> {
  const stored = values[categoryKey(categoryId)] as Record<string, unknown>
  return { ...stored, ...change }
}

/** The writes that give `order` its orders, the new category's (`created`) included when there is one. */
function writesForOrder(
  values: Values,
  categories: readonly ProjectCategory[],
  order: readonly string[],
  movedId: string,
  created?: CategoryPref,
): CategoryWrites {
  const known = new Map(categories.map((category) => [category.id, category.order]))
  const orders = ordersAfterMove(order, movedId, (id) => (id === movedId && created ? created.order : known.get(id)!))
  const writes: CategoryWrites = {}
  for (const [id, newOrder] of orders) {
    if (id === movedId && created) writes[categoryKey(id)] = { ...created, order: newOrder }
    else if (known.get(id) !== newOrder) writes[categoryKey(id)] = rewritten(values, id, { order: newOrder })
  }
  return writes
}

/** A new category goes last: the highest order of the usable categories plus the step (the step when there is none). */
export function planNewCategory(values: Values, categoryId: string, name: string): CategoryWrites {
  const categories = usableCategories(values)
  const order = categories.length === 0
    ? CATEGORY_ORDER_STEP
    : Math.max(...categories.map((category) => category.order)) + CATEGORY_ORDER_STEP
  return { [categoryKey(categoryId)]: { name: name.trim(), order } }
}

/** Moves a category to `to`, its index in the new display order. Nothing when it already is there. */
export function planMoveCategory(values: Values, categoryId: string, to: number): CategoryWrites {
  const categories = usableCategories(values)
  const current = categories.map((category) => category.id)
  if (!current.includes(categoryId)) return {}
  const order = current.filter((id) => id !== categoryId)
  order.splice(Math.max(0, Math.min(to, order.length)), 0, categoryId)
  if (order.every((id, index) => id === current[index])) return {}
  return writesForOrder(values, categories, order, categoryId)
}

/** Renames a category (trimmed); its order and other fields stay. Nothing for an unusable category or the same name. */
export function planRenameCategory(values: Values, categoryId: string, name: string): CategoryWrites {
  const category = readCategoryPref(values[categoryKey(categoryId)])
  const trimmed = name.trim()
  if (!category || trimmed === '' || trimmed === category.name) return {}
  return { [categoryKey(categoryId)]: rewritten(values, categoryId, { name: trimmed }) }
}

/**
 * Deletes a category: `null` for it and for every `category.project.<id>` that names it, whatever
 * project that is. Its projects stay, without a category.
 */
export function planDeleteCategory(values: Values, categoryId: string): CategoryWrites {
  const writes: CategoryWrites = { [categoryKey(categoryId)]: null }
  for (const [key, value] of Object.entries(values)) {
    if (projectIdOfCategoryKey(key) !== null && value === categoryId) writes[key] = null
  }
  return writes
}

/**
 * A project moved to a category (`null`: to none) from a menu. Nothing when it already is in that
 * category; an entry that names no usable category counts as none.
 */
export function planAssignProject(values: Values, projectId: number, categoryId: string | null): CategoryWrites {
  const usable = new Set(usableCategories(values).map((category) => category.id))
  if (categoryIdOfProject(values, projectId, usable) === categoryId) return {}
  return { [projectCategoryKey(projectId)]: categoryId }
}

/**
 * Whether "Add category above" is offered on a project: a top-level project that is not the first
 * of a category (there it would only leave that category empty).
 */
export function canAddCategoryAbove(layout: readonly CategoryGroup[], projectId: number): boolean {
  const group = groupOfProject(layout, projectId)
  return group !== null && (group.category === null || group.projectIds[0] !== projectId)
}

/**
 * "Add category above" a top-level project: the new category starts at that project, right after
 * the project's own category (before every category when it has none), and takes that project and
 * every project after it in its group. Null when it is not offered there.
 */
export function planAddCategoryAbove(
  projects: readonly CategoryLayoutProject[],
  inboxProjectId: number,
  values: Values,
  projectId: number,
  categoryId: string,
  name: string,
): CategoryWrites | null {
  const layout = categoryLayout(projects, inboxProjectId, values)
  if (!canAddCategoryAbove(layout, projectId)) return null
  const group = groupOfProject(layout, projectId)!
  const categories = usableCategories(values)
  const order = categories.map((category) => category.id)
  order.splice(group.category ? order.indexOf(group.category.id) + 1 : 0, 0, categoryId)
  const writes = writesForOrder(values, categories, order, categoryId, { name: name.trim(), order: 0 })
  for (const id of group.projectIds.slice(group.projectIds.indexOf(projectId))) writes[projectCategoryKey(id)] = categoryId
  return writes
}
