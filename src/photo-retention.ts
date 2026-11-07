/** Local copies follow the same retention; pending offline requests require explicit cancellation. */
export function expireLocalPhotos(storage: Storage, now=Date.now()) {
 for (const key of Object.keys(storage)) {
  if (!key.startsWith('nutrip-photo-expiry:')) continue
  const journalKey=key.slice('nutrip-photo-expiry:'.length)
  try {
   const pending=JSON.parse(storage.getItem('nutrip-photo-v1:'+journalKey)??'null')?.pending
   if (Number(storage.getItem(key))>now || pending) continue
   const journal=JSON.parse(storage.getItem(journalKey)??'null')
   if (journal) storage.setItem(journalKey,JSON.stringify({...journal,photoDataUrl:null}))
   storage.removeItem('nutrip-photo-v1:'+journalKey);storage.removeItem(key)
  }catch{/* Storage failure must not alter journal nutrition. */}
 }
}
