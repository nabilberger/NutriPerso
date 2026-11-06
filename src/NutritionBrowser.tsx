import { requestFoodCatalog } from './catalog-client'
import {useEffect,useState,type FormEvent} from 'react'
import {requestPrivateJson} from './auth/client'

type SearchFood={fdcId:number;description:string;dataType:string|null;brandOwner:string|null;foodCategory:'generic'|'branded'}
type Nutrient={id:number|null;name:string;unitName:string;value:string;basis:{quantity:number;unit:'g'|'ml';source:string}|null}
type FoodDetail={fdcId:number;description:string|null;dataType:string|null;keyNutrients:{energy:Nutrient|null;protein:Nutrient|null;carbohydrates:Nutrient|null;fat:Nutrient|null;fiber:Nutrient|null}}
type SearchResponse={foods:SearchFood[];totalHits:number}
type Recipe={id:string;name:string;revision:number;ingredients:unknown[]}
function labelNumber(n:Nutrient|null):string{
  if(!n || !n.basis)return '—'
  const number=Number(n.value)
  if(!Number.isFinite(number))return '—'
  return number.toLocaleString('fr-MA',{maximumFractionDigits:1})+' '+(n.unitName||'')
}
export function FoodExplorer(){
  const [query,setQuery]=useState('')
  const [searched,setSearched]=useState('')
  const [foods,setFoods]=useState<SearchFood[]>([])
  const [total,setTotal]=useState(0)
  const [selected,setSelected]=useState<FoodDetail|null>(null)
  const [searching,setSearching]=useState(false)
  const [loadingFdcId,setLoadingFdcId]=useState<number|null>(null)
  const [searchUnavailable,setSearchUnavailable]=useState(false)
  const [error,setError]=useState('')
  async function search(e:FormEvent<HTMLFormElement>){
    e.preventDefault();const q=query.trim();if(q.length<2){setError('Saisissez au moins deux caractères.');return}
    setSearching(true);setSearchUnavailable(false);setError('');setSelected(null);setFoods([]);setTotal(0);setSearched(q)
    try{
      const response=await requestFoodCatalog('/api/foods/search?q='+encodeURIComponent(q)+'&pageSize=25')
      if(!response.ok)throw new Error('La recherche des aliments est momentanément indisponible.')
      const data=await response.json() as SearchResponse
      setFoods(data.foods);setTotal(data.totalHits)
    }catch(e){setSearchUnavailable(true);setError(e instanceof Error?e.message:'Erreur de recherche.')}
    finally{setSearching(false)}
  }
  async function choose(food:SearchFood){
    setLoadingFdcId(food.fdcId);setSelected(null);setError('')
    try{
      const response=await requestFoodCatalog('/api/foods/'+food.fdcId)
      if(!response.ok)throw new Error('La fiche nutritionnelle est indisponible.')
      setSelected(await response.json() as FoodDetail)
    }catch(e){setError(e instanceof Error?e.message:'Fiche indisponible.')}
    finally{setLoadingFdcId(null)}
  }
  return <div className="data-page">
    <div className="data-heading"><small>CATALOGUE NUTRITIONNEL</small><h1>Explorez <em>vos aliments.</em></h1><p>Retrouvez les compositions nutritionnelles de référence dans FoodData Central.</p></div>
    <form onSubmit={e=>void search(e)} className="food-search">
      <label htmlFor="food-q">Rechercher un aliment</label>
      <div><input id="food-q" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Ex. lentilles, sardines, poulet…"/><button type="submit" disabled={searching}>{searching?'Recherche…':'Rechercher'}</button></div>
    </form>
    {error&&<p role="alert" className="data-error">{error}</p>}
    <div className="food-layout"><section className="data-card" aria-busy={searching}>
      <h2>{searched ? 'Résultats pour « '+searched+' »' : 'Commencez votre recherche'}</h2>
      {searched&&<p className="data-muted">{total} aliment(s) trouvé(s) — premiers résultats</p>}
      {searching?<div className="data-empty" role="status">Recherche des aliments…</div>:foods.length===0?<div className="data-empty">{searchUnavailable?'Les résultats ne sont pas disponibles pour le moment.':searched?'Aucun résultat dans la sélection.':'Cherchez un aliment pour consulter ses valeurs de référence.'}</div>:
        <div className="food-results">{foods.map(food=><button key={food.fdcId} type="button" disabled={searching||loadingFdcId!==null} aria-pressed={food.fdcId===selected?.fdcId} className={food.fdcId===selected?.fdcId?'food-result selected':'food-result'} onClick={()=>void choose(food)}>
          <b>{food.description}</b><small>{food.brandOwner??(food.foodCategory==='generic'?'Aliment générique':'Produit de marque')}</small>
        </button>)}</div>}
    </section>
    <section className="data-card" aria-busy={loadingFdcId!==null}>
      <h2>Fiche nutritionnelle</h2>
      {loadingFdcId!==null?<div className="data-empty" role="status">Chargement de la fiche nutritionnelle…</div>:!selected?<div className="data-empty">Sélectionnez un aliment pour voir ses valeurs.</div>:<>
        <h3>{selected.description}</h3><p className="data-muted">Valeurs de référence fournies par l'USDA. Une base inconnue reste non calculable.</p>
        <div className="nutrients-grid">
          {([['Énergie',selected.keyNutrients.energy],['Protéines',selected.keyNutrients.protein],['Glucides',selected.keyNutrients.carbohydrates],['Lipides',selected.keyNutrients.fat],['Fibres',selected.keyNutrients.fiber]] as const).map(([label,n])=><div key={label}><small>{label}</small><strong>{labelNumber(n)}</strong><span>{n?.basis?'pour '+n.basis.quantity+' '+n.basis.unit:'Base non établie'}</span></div>)}
        </div>
      </>}
    </section></div>
    <p className="data-disclaimer">Les données présentées sont indicatives. L'ajout au journal nécessitera la validation d'une quantité et d'une portion.</p>
  </div>
}

export function RecipeLibrary(){
  const [recipes,setRecipes]=useState<Recipe[]>([])
  const [loading,setLoading]=useState(true)
  const [error,setError]=useState('')
  useEffect(()=>{
    let active=true
    void requestPrivateJson<{recipes:Recipe[]}>('/api/private/recipes?limit=50').then(r=>{if(active)setRecipes(r.recipes)}).catch((e:unknown)=>{if(active)setError(e instanceof Error?e.message:'Recettes inaccessibles.')}).finally(()=>{if(active)setLoading(false)})
    return()=>{active=false}
  },[])
  return <div className="data-page">
    <div className="data-heading"><small>MA CUISINE</small><h1>Mes recettes, <em>à portée de main.</em></h1><p>Vos recettes enregistrées, prêtes à être retrouvées et réutilisées.</p></div>
    <section className="data-card">
      <h2>Bibliothèque personnelle</h2>
      {loading?<p className="data-muted">Chargement des recettes…</p>:error?<p className="data-error" role="alert">{error}</p>
      :recipes.length===0?<div className="data-empty">Aucune recette enregistrée pour le moment. La création et l'édition des recettes seront raccordées prochainement.</div>
      :<div className="recipes-list">{recipes.map(r=><article key={r.id}><div className="recipe-symbol">♧</div><div><h3>{r.name}</h3><p>{r.ingredients.length} ingrédient(s) • Version {r.revision}</p></div></article>)}</div>}
    </section>
  </div>
}
