import { useEffect, useState } from 'react'
import { requestPrivateJson } from './auth/client'
export default function PrivatePhotos(){
 const [photos,setPhotos]=useState<{id:string;expiresAt:string}[]>([]),[error,setError]=useState('')
 const load=()=>requestPrivateJson<{photos:typeof photos}>('/api/private/photos').then(r=>setPhotos(r.photos)).catch(()=>setError('Liste des photos privées indisponible.'))
 useEffect(()=>{void load()},[])
 return <section className="private-photos" aria-label="Photos privées"><button onClick={()=>void load()}>Actualiser les photos privées</button>{error&&<p role="alert">{error}</p>}{photos.map(p=><div key={p.id}>Photo · expiration {new Date(p.expiresAt).toLocaleDateString()} <button onClick={()=>void requestPrivateJson('/api/private/photos/'+p.id,{method:'DELETE'}).then(()=>load()).catch(()=>setError('Suppression impossible. Réessayez.'))}>Supprimer cette photo privée</button></div>)}</section>
}
