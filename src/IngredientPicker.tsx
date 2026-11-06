import {useState} from 'react'
import {FoodPicker} from './Journal'
import {LocalCatalog} from './LocalFoodPicker'
import type {FoodNutritionSnapshot} from './domain/nutrition/recipes'
import type {FoodQuantityInput} from './domain/nutrition/portions'
export {LocalCatalog} from './LocalFoodPicker'
export default function IngredientPicker({onSelect,onClose}:{onSelect:(food:FoodNutritionSnapshot,quantity:FoodQuantityInput)=>void;onClose:()=>void}){
 const [source,setSource]=useState('usda')
 return <section className="recipe-picker" aria-label="Choisir un ingrédient"><label>Source des ingrédients<select value={source} onChange={e=>setSource(e.target.value)}><option value="usda">USDA</option><option value="catalog">Catalogue local / personnel</option></select></label>
 {source==='usda'?<FoodPicker allowCatalog={false} addLabel="Ajouter cet ingrédient" onCancel={onClose} onSelect={onSelect}/>:<LocalCatalog onSelect={onSelect} onClose={onClose}/>}</section>
}
