import type { View } from '../types'

export interface GuidanceInput {
  investigation: string | null
  selectionCount: number
  aiStatus: 'idle' | 'loading' | 'ready' | 'error' | 'canceled'
  recipeStatus: 'idle' | 'loading' | 'ready' | 'error'
  recipeStale: boolean
}

/**
 * Deterministic next-action guidance shared by the assistant panel and the
 * compact investigation summary. Pure: no invented progress stages, only the
 * actual store state.
 */
export function nextAction(input: GuidanceInput): string {
  if (input.investigation === null) {
    return 'Ask a question in AI Discovery to begin.'
  }
  if (input.aiStatus === 'loading') {
    return 'Waiting for search results…'
  }
  if (input.aiStatus === 'error') {
    return 'The last search failed — retry it from AI Discovery.'
  }
  if (input.aiStatus === 'canceled') {
    return 'The last search was canceled — run a new search when ready.'
  }
  if (input.selectionCount === 0) {
    return 'Add recommended datasets to your dataset collection.'
  }
  if (input.recipeStatus === 'loading') {
    return 'Waiting for your recipe…'
  }
  if (input.recipeStatus === 'error') {
    return 'Recipe generation failed — retry from Data Recipe.'
  }
  if (input.recipeStale) {
    return 'Your recipe is out of date — regenerate it.'
  }
  if (input.recipeStatus === 'ready') {
    return 'Review your recipe, or refine your question to iterate.'
  }
  return 'Review your dataset collection, then generate a data recipe.'
}

/** View where the next action happens, for the summary's action button. */
export function nextActionView(input: GuidanceInput): View {
  if (input.investigation === null) return 'discover'
  if (input.aiStatus === 'loading') return 'discover'
  if (input.aiStatus === 'error') return 'discover'
  if (input.aiStatus === 'canceled') return 'discover'
  if (input.selectionCount === 0) return 'discover'
  return 'recipe'
}
