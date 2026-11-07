/** Provider-neutral suggestions; nutrition numbers deliberately absent. */
export type PhotoSuggestion = { name: string; amount: string | null; unit: 'g' | 'ml'; source: string; uncertainty: string }
export type PhotoProposal = { version: 1; items: PhotoSuggestion[]; warning: string }
export function parsePhotoProposal(value: unknown): PhotoProposal {
  if (!value || typeof value !== 'object') throw new Error('Proposition IA invalide.')
  const v = value as Record<string, unknown>
  if (v.version !== 1 || !Array.isArray(v.items) || v.items.length > 20 || typeof v.warning !== 'string' || v.warning.length > 500) throw new Error('Proposition IA invalide.')
  const items = v.items.map((item: unknown) => {
    if (!item || typeof item !== 'object') throw new Error('Aliment IA invalide.')
    const x = item as Record<string, unknown>
    if (typeof x.name !== 'string' || !x.name.trim() || x.name.length > 120 || !['g','ml'].includes(String(x.unit)) || typeof x.source !== 'string' || x.source.length > 120 || typeof x.uncertainty !== 'string' || x.uncertainty.length > 500 || (x.amount !== null && (typeof x.amount !== 'string' || !/^\d{1,5}(\.\d{1,3})?$/.test(x.amount) || Number(x.amount) <= 0))) throw new Error('Aliment IA invalide.')
    return { name: x.name.trim(), amount: x.amount as string | null, unit: x.unit as 'g'|'ml', source: x.source, uncertainty: x.uncertainty }
  })
  return { version: 1, items, warning: v.warning }
}
export function validatePhotoData(data: unknown): string {
  if (typeof data !== 'string' || data.length > 1_400_000 || !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(data)) throw new Error('Photo JPEG compressée requise (1 Mo maximum).')
  const bytes = atob(data.split(',')[1]!)
  if (bytes.charCodeAt(0) !== 255 || bytes.charCodeAt(1) !== 216 || bytes.charCodeAt(2) !== 255) throw new Error('JPEG invalide.')
  let offset=2,dimensions=false
  while(offset+4<bytes.length){
    if(bytes.charCodeAt(offset)!==255)break
    const marker=bytes.charCodeAt(offset+1);offset+=2
    if(marker===0xda || marker===0xd9)break
    const length=bytes.charCodeAt(offset)*256+bytes.charCodeAt(offset+1)
    if(length<2 || offset+length>bytes.length)throw new Error('JPEG invalide.')
    if([0xc0,0xc1,0xc2].includes(marker)){
      const height=bytes.charCodeAt(offset+3)*256+bytes.charCodeAt(offset+4)
      const width=bytes.charCodeAt(offset+5)*256+bytes.charCodeAt(offset+6)
      if(length<8 || !width || !height || width>1280 || height>1280)throw new Error('Dimensions photo invalides.')
      dimensions=true;break
    }
    offset+=length
  }
  if(!dimensions)throw new Error('Dimensions JPEG introuvables.')
  return data.split(',')[1]!
}
