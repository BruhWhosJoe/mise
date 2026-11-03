import { useId, useMemo } from 'react'
import type { RecipeResponse } from '../services/api'
import {
  buildRecipeGraph,
  shortNodeLabel,
} from '../utils/recipeGraph'

const NODE_X = 8
const NODE_W = 220
const NODE_H = 32
const ROW_H = 50
const TOP_PAD = 14
const EDGE_X = NODE_X + NODE_W + 10
const EDGE_SPREAD = 18

function RecipeDiagram({ recipe }: { recipe: RecipeResponse }) {
  const titleId = useId()
  const listId = useId()
  const graph = useMemo(() => buildRecipeGraph(recipe), [recipe])
  const { nodes, links } = graph

  const height = TOP_PAD * 2 + nodes.length * ROW_H
  const edgeReach =
    links.length === 0
      ? 0
      : 34 + Math.min(links.length, 6) * EDGE_SPREAD
  const width = Math.max(430, EDGE_X + edgeReach + 12)

  const nodeY = (index: number) => TOP_PAD + index * ROW_H
  const nodeCenterY = (index: number) => nodeY(index) + NODE_H / 2
  const indexById = new Map(
    nodes.map((node, index) => [node.assignedId, index]),
  )
  const labelById = new Map(
    nodes.map((node) => [node.assignedId, node.title]),
  )

  return (
    <section aria-labelledby={titleId} className="recipe-diagram">
      <h3 id={titleId}>How the datasets relate</h3>
      <p className="sample-note">
        Derived only from this generated recipe: datasets used together in a
        workflow step, plus proposed combinations (dashed, clearly marked).
      </p>
      <figure className="recipe-figure">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="recipe-svg"
          role="img"
          aria-describedby={listId}
        >
          <title>
            {nodes.length} datasets
            {links.length === 0
              ? ' with no shared workflow steps or combinations'
              : ` with ${links.length} relationships`}
          </title>
          {links.map((link, linkIndex) => {
            const from = indexById.get(link.a) ?? 0
            const to = indexById.get(link.b) ?? 0
            const y1 = nodeCenterY(from)
            const y2 = nodeCenterY(to)
            const bow = EDGE_X + 34 + (linkIndex % 6) * EDGE_SPREAD
            return (
              <path
                key={`${link.kind}-${link.a}-${link.b}-${link.source}`}
                d={`M ${EDGE_X} ${y1} C ${bow} ${y1}, ${bow} ${y2}, ${EDGE_X} ${y2}`}
                className={
                  link.kind === 'proposed'
                    ? 'recipe-edge recipe-edge-proposed'
                    : 'recipe-edge'
                }
              >
                <title>
                  {link.kind === 'proposed' ? 'Proposed: ' : ''}
                  {labelById.get(link.a) ?? link.a} and{' '}
                  {labelById.get(link.b) ?? link.b} — {link.source}
                </title>
              </path>
            )
          })}
          {nodes.map((node, index) => (
            <g key={node.assignedId}>
              <rect
                x={NODE_X}
                y={nodeY(index)}
                width={NODE_W}
                height={NODE_H}
                rx={6}
                className="recipe-node"
              >
                <title>
                  {node.title} (ID: {node.assignedId}
                  {node.steps.length > 0
                    ? `; workflow steps ${node.steps.join(', ')}`
                    : '; not referenced by a workflow step'}
                  )
                </title>
              </rect>
              <text
                x={NODE_X + 10}
                y={nodeY(index) + 14}
                className="recipe-node-title"
              >
                {shortNodeLabel(node.title)}
              </text>
              <text
                x={NODE_X + 10}
                y={nodeY(index) + 26}
                className="recipe-node-sub"
              >
                {node.steps.length > 0
                  ? `Steps ${node.steps.join(', ')}`
                  : 'No workflow step'}
              </text>
            </g>
          ))}
        </svg>
        <figcaption className="recipe-legend">
          <span className="legend-item">
            <svg width="24" height="8" aria-hidden="true" focusable="false">
              <line
                x1="0"
                y1="4"
                x2="24"
                y2="4"
                className="recipe-edge legend-line"
              />
            </svg>
            Used together in a workflow step
          </span>
          <span className="legend-item">
            <svg width="24" height="8" aria-hidden="true" focusable="false">
              <line
                x1="0"
                y1="4"
                x2="24"
                y2="4"
                className="recipe-edge recipe-edge-proposed legend-line"
              />
            </svg>
            Proposed combination
          </span>
        </figcaption>
      </figure>
      <h4 className="recipe-rel-heading">Relationships in this recipe</h4>
      {links.length === 0 ? (
        <p className="sample-note" id={listId}>
          Each dataset stands alone: no workflow step or proposed combination
          uses two datasets together.
        </p>
      ) : (
        <ul className="recipe-rel-list" id={listId}>
          {links.map((link) => (
            <li key={`${link.kind}-${link.a}-${link.b}-${link.source}`}>
              {link.kind === 'proposed' && (
                <span className="proposed-flag">Proposed</span>
              )}{' '}
              <span className="dataset-chip">
                {labelById.get(link.a) ?? link.a}
              </span>{' '}
              and{' '}
              <span className="dataset-chip">
                {labelById.get(link.b) ?? link.b}
              </span>{' '}
              — {link.source}.
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export default RecipeDiagram
