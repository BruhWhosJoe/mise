import LiveRecipe from './LiveRecipe'

function RecipeView() {
  return (
    <div>
      <h1>Data Recipe</h1>
      <p className="lede">
        Turn your dataset collection into a generated analysis plan for your
        investigation question.
      </p>

      <LiveRecipe />

      <section aria-labelledby="recipe-next-heading" className="panel">
        <h2 id="recipe-next-heading">About generated recipes</h2>
        <p>
          Generated recipes are proposed analysis plans, not executed
          analysis. They never contain findings — verify joins, coverage,
          and methods against the source metadata before acting on them.
        </p>
      </section>
    </div>
  )
}

export default RecipeView
