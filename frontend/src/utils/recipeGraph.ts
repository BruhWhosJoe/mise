import type { RecipeResponse } from '../services/api'

export interface RecipeGraphNode {
  assignedId: string
  title: string
  /** Workflow step numbers that reference this dataset, ascending. */
  steps: number[]
}

export type RecipeLinkKind = 'workflow' | 'proposed'

export interface RecipeGraphLink {
  /** Endpoint node ids, sorted so (a, b) is a stable pair key. */
  a: string
  b: string
  kind: RecipeLinkKind
  /** Human source label, e.g. "Step 2 · Compare coverage". */
  source: string
}

export interface RecipeGraph {
  nodes: RecipeGraphNode[]
  links: RecipeGraphLink[]
}

function orderedPair(x: string, y: string): [string, string] {
  return x <= y ? [x, y] : [y, x]
}

/**
 * Derive the recipe relationship graph from actual generated data only:
 * nodes are the recipe's resolved datasets; links are dataset pairs that
 * appear together in one generated workflow step or one generated
 * combination. No other relationship kinds exist, so nothing else is
 * emitted; combinations are always marked proposed.
 */
export function buildRecipeGraph(recipe: RecipeResponse): RecipeGraph {
  const known = new Map(
    recipe.datasets.map((dataset) => [dataset.assigned_id, dataset]),
  )
  const stepsById = new Map<string, number[]>()
  for (const id of known.keys()) stepsById.set(id, [])

  const links: RecipeGraphLink[] = []
  const seen = new Set<string>()

  function addLinks(ids: readonly string[], kind: RecipeLinkKind, source: string) {
    // Keep only ids the recipe actually resolved, drop self-pairs.
    const usable = [...new Set(ids)].filter((id) => known.has(id))
    for (let i = 0; i < usable.length; i++) {
      for (let j = i + 1; j < usable.length; j++) {
        const [a, b] = orderedPair(usable[i], usable[j])
        const key = `${kind}|${a}|${b}|${source}`
        if (seen.has(key)) continue
        seen.add(key)
        links.push({ a, b, kind, source })
      }
    }
  }

  for (const step of recipe.workflow) {
    for (const id of new Set(step.dataset_ids)) {
      if (known.has(id)) stepsById.get(id)?.push(step.step)
    }
    addLinks(step.dataset_ids, 'workflow', `Step ${step.step} · ${step.title}`)
  }
  recipe.combinations.forEach((combo, index) => {
    addLinks(combo.dataset_ids, 'proposed', `Proposed combination ${index + 1}`)
  })

  const nodes: RecipeGraphNode[] = recipe.datasets.map((dataset) => ({
    assignedId: dataset.assigned_id,
    title: dataset.title ?? 'Untitled record',
    steps: [...new Set(stepsById.get(dataset.assigned_id) ?? [])].sort(
      (x, y) => x - y,
    ),
  }))

  links.sort((x, y) => {
    if (x.kind !== y.kind) return x.kind === 'workflow' ? -1 : 1
    if (x.source !== y.source) return x.source.localeCompare(y.source)
    if (x.a !== y.a) return x.a.localeCompare(y.a)
    return x.b.localeCompare(y.b)
  })

  return { nodes, links }
}

/** Short label for diagram nodes; the full title stays in tooltips and lists. */
export function shortNodeLabel(title: string, maxLength = 30): string {
  if (title.length <= maxLength) return title
  return `${title.slice(0, maxLength - 1).trimEnd()}…`
}
