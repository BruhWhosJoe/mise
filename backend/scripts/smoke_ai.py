"""Opt-in LIVE AI smoke test: one discovery + one recipe request.

WARNING: this consumes Meta model quota (typically 2 model calls plus one
repair attempt at most). It never runs as part of ordinary tests.

Run from the project root (requires MF_MODEL_API_KEY in backend/.env)::

    .venv\\Scripts\\python.exe backend/scripts/smoke_ai.py "flood risk in DC"

Flow:
  1. Run discovery for the given question (or a default one).
  2. Take up to 3 returned real AssignedIDs.
  3. Generate a recipe for the same question + those IDs.

Uses the same application services as the API routes. Prints IDs, titles,
and coverage only -- never request bodies, headers, or secrets. Exit codes:
0 passed, 1 failed, 2 skipped (AI not configured).
"""

import asyncio
import os
import sys

sys.path.insert(
    0, os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
)

from app import discovery, recipe  # noqa: E402
from app.mcp_service import MCPError  # noqa: E402
from app.model_client import ModelError, ModelNotConfiguredError  # noqa: E402

DEFAULT_QUESTION = 'Which datasets help assess flood risk in Washington, DC?'


async def main(question: str) -> int:
    try:
        found = await discovery.run_discovery(question)
    except ModelNotConfiguredError as exc:
        print(f'SKIPPED: {exc}')
        return 2
    except (ModelError, ValueError, MCPError) as exc:
        print(f'DISCOVERY FAILED: {type(exc).__name__}: {exc}')
        return 1
    print(f'question: {found.question}')
    print(f'goal: {found.interpretation.goal}')
    print(
        f'recommendations: {len(found.recommendations)} '
        f'(partial={found.partial})'
    )
    for item in found.recommendations:
        print(
            f'  - [{item.relevance} {item.relevance_score}] '
            f'{item.record.assigned_id}: {item.record.title}'
        )
    print(
        f'coverage: retrieved={found.coverage.records_retrieved} '
        f'complete={found.coverage.retrieval_complete} '
        f'evaluated={found.coverage.candidates_evaluated}'
    )
    ids = [
        item.record.assigned_id
        for item in found.recommendations
        if item.record.assigned_id is not None
    ][:3]
    if not ids:
        print('No recommended IDs returned; cannot run the recipe step.')
        return 1
    try:
        plan = await recipe.generate_recipe(question, ids)
    except (ModelError, ValueError, MCPError) as exc:
        print(f'RECIPE FAILED: {type(exc).__name__}: {exc}')
        return 1
    print(f'\nrecipe objective: {plan.objective}')
    print(f'workflow steps: {len(plan.workflow)}')
    print(f'combinations proposed: {len(plan.combinations)}')
    print(f'gaps noted: {len(plan.gaps)}')
    for gap in plan.gaps:
        print(f'  - {gap}')
    print(f'limitations noted: {len(plan.limitations)}')
    for limitation in plan.limitations:
        print(f'  - {limitation}')
    print(f'outputs proposed: {len(plan.outputs)}')
    for output in plan.outputs:
        print(f'  - {output}')
    print('\nAI SMOKE TEST PASSED')
    return 0


if __name__ == '__main__':
    asked = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_QUESTION
    raise SystemExit(asyncio.run(main(asked)))
