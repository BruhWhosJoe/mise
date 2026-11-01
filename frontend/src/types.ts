export type View = 'discover' | 'recipe'

export type ScenarioId =
  | 'pedestrian-safety'
  | 'healthcare-access'
  | 'flood-exposure'

/** A fictional sample dataset record used only for demo mode. */
export interface SampleDataset {
  id: string
  title: string
  source: string
  purpose: string
  usefulness: string
  details: string[]
}

export interface ResultGroup {
  purpose: string
  datasets: SampleDataset[]
}

export interface ScenarioFixture {
  id: ScenarioId
  exampleQuestion: string
  groups: ResultGroup[]
}
