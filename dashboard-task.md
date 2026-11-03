Work on Jonathan’s independent MetaFabric application in:
C:\Projects\metafabric

The React + TypeScript + Vite frontend already exists in ./frontend.
A working starter has been committed to Git. Inspect the existing files
and git status before editing.

Build the first interactive discovery dashboard using the existing
dependencies and ordinary CSS.

Scope:
- Modify only files within ./frontend.
- Do not create a backend or make model/MCP API calls yet.
- Do not change dependencies, package versions, or lint configuration.
- Preserve TypeScript 5.9.3.
- Do not commit, push, or deploy.
- This project is separate from MetaFabricAI; do not access or copy it.

Product:
MetaFabric helps people discover government open datasets and assemble
a Data Recipe explaining how selected datasets could support a question.

Layout:
1. Narrow left navigation with MetaFabric branding and two views:
   Discover and Data Recipe.
2. A wide central workspace.
3. A collapsible right assistant panel. Collapsing it must give the
   central workspace more space.

Visual direction:
- Dark navy background, restrained teal accents, clear readable text.
- Use spacing, borders, and typography to distinguish sections.
- Avoid oversized hero graphics, decorative statistics, and emoji.
- Desktop layout first, with a usable stacked layout on small screens.
- Remove starter logos and the starter layout styles that interfere.
- Use visible keyboard focus styles, labeled inputs, and semantic buttons.

Discover view:
- Heading: “What would you like to investigate?”
- A labeled question textarea and “Discover datasets” button.
- Three example-question cards:
  a. Pedestrian safety near schools in Washington, DC.
  b. Access to healthcare in Washington, DC.
  c. Flood exposure and community facilities in Washington, DC.
- Clicking an example fills the textarea and lets the user edit it;
  it must not automatically submit.
- Reject whitespace-only submissions with an inline message.
- Replace the existing alert popup with inline results.

Sample behavior:
- Clearly label this version as “Demo mode — sample datasets”.
- Keep typed sample records in a separate data file.
- Use small fictional fixtures for the three example scenarios.
- For those scenarios, display the corresponding sample results grouped
  by purpose, such as “Locations”, “Outcomes”, and “Context”.
- For an unsupported question, explain that this demo currently supports
  the three examples. Do not return unrelated fixtures.
- Do not suggest these results came from an AI model, live search, or MCP.
- Do not invent working dataset URLs, catalog IDs, freshness dates,
  confidence scores, or claims that records have been verified.

Dataset cards:
- Show title, source label, purpose, and a short explanation of usefulness.
- Include an accessible button to expand/collapse further sample details.
- Include a checkbox to add/remove the dataset from the selection.
- Show a selection count and a clear action to view the selection.
- Preserve selection while switching views.
- Clear the previous selection when submitting a different search.
- Do not add fake links or controls that silently do nothing.

Data Recipe view:
- Show the submitted question and selected datasets with removal controls.
- Show a helpful empty state when nothing is selected.
- Explain that live recipe generation will be connected in the next stage.
- Do not fabricate an AI-generated recipe or analysis results.

Assistant panel:
- Explain the three steps: ask a question, review datasets, build a recipe.
- Clearly indicate that the live assistant is not connected.
- Do not add a pretend chat input or simulated AI conversation.

Implementation:
- Keep App.tsx responsible for shared state and composing the screen.
- Extract a few useful components, such as DatasetCard and AssistantPanel.
- Keep types and fixture data separate where useful.
- Avoid unnecessary abstractions and additional libraries.
- Use CSS files for styling rather than extensive inline styles.

Verification:
- Run npm run build and npm run lint from ./frontend.
- Fix issues caused by your changes without disabling checks.
- If browser testing is available, check the main interactions and
  desktop/mobile layout. Otherwise explicitly report that visual and
  interaction checks still need manual verification.

Finish by reporting:
1. Files changed and their responsibilities.
2. Build/lint results.
3. What remains mocked.
4. A short manual test checklist.
5. A beginner-friendly explanation of the shared React state. 