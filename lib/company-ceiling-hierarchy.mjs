/**
 * Source-specific hierarchy for the existing PANEL SHEETS ceiling-fitting matrix.
 * The source key and original item fields are intentionally NOT regenerated:
 * changing them during a Google Sheets refresh could duplicate linked stock rows.
 *
 * Sheet layout:
 *   B = White Plain; C = Black Line; D = Teak Plain; E = Teak Black Line.
 * An empty E value is a reviewable variant, never a guessed zero quantity.
 */
export const PANEL_CEILING_PATHS = Object.freeze({
  2: 'PANEL SHEETS / Ceiling Fittings / White Plain',
  3: 'PANEL SHEETS / Ceiling Fittings / Black Line',
  4: 'PANEL SHEETS / Ceiling Fittings / Teak / Plain',
  5: 'PANEL SHEETS / Ceiling Fittings / Teak / Black Line',
})

export function withPanelCeilingPaths(rows=[],title=''){
  if(String(title).trim().toUpperCase()!=='PANEL SHEETS')return rows
  return rows.map(row=>{
    if(String(row.subgroup||'').trim().toUpperCase()!=='CEILING FITTINGS')return row
    const position=String(row.source_position||'').split(':')
    const column=Number(position.at(-1))
    const section_path=PANEL_CEILING_PATHS[column]
    return section_path?{...row,section_path}:row
  })
}

function sectionPath(id,index){
  const labels=[],visited=new Set()
  while(id&&!visited.has(id)){
    visited.add(id)
    const s=index.get(id)
    if(!s)return ''
    labels.unshift(s.name)
    id=s.parent_id
  }
  return labels.join(' / ')
}

/**
 * Reconcile only still-unassigned or legacy default-section company rows.
 * Never override an administrator's explicit category move.
 * Does not change item IDs, source keys, quantities or item attributes.
 */
export async function reconcilePanelCeilingSections(db,company,rows=[]){
  if(String(company?.name||'').trim().toUpperCase()!=='PANEL SHEETS')return {created:0,moved:0,matched:0,skipped:0}
  const source=rows.filter(r=>r.section_path&&Object.values(PANEL_CEILING_PATHS).includes(r.section_path))
  if(!source.length)return {created:0,moved:0,matched:0,skipped:0}
  const {data:currentRows,error:rowError}=await db.from('proc_company_list_items')
    .select('id,source_key,section_id').eq('company_id',company.id).eq('active',true)
    .in('source_key',source.map(x=>x.source_key))
  if(rowError)throw rowError
  const {data:existingSections,error:sectionError}=await db.from('proc_company_sections')
    .select('id,name,parent_id,active').eq('company_id',company.id).eq('active',true)
  if(sectionError)throw sectionError
  const sections=[...(existingSections||[])],byId=new Map(sections.map(s=>[s.id,s]))
  let created=0,moved=0,skipped=0
  async function ensurePath(path){
    let parent=null
    for(const name of path.split(' / ')){
      let section=sections.find(s=>s.parent_id===parent&&s.name.toLowerCase()===name.toLowerCase())
      if(!section){
        const save=await db.from('proc_company_sections')
          .insert({company_id:company.id,parent_id:parent,name,sort_order:sections.length*10})
          .select('id,name,parent_id,active').single()
        if(save.error){
          // A parallel request may have created this unique sibling already.
          const query=await db.from('proc_company_sections')
            .select('id,name,parent_id,active').eq('company_id',company.id).eq('name',name)
          if(query.error)throw save.error
          section=(query.data||[]).find(s=>s.parent_id===parent&&s.active!==false)
          if(!section)throw save.error
        }else{section=save.data;created++}
        sections.push(section);byId.set(section.id,section)
      }
      parent=section.id
    }
    return parent
  }
  const paths=[...new Set(Object.values(PANEL_CEILING_PATHS))]
  const destination=new Map()
  for(const path of paths)destination.set(path,await ensurePath(path))
  const bySource=new Map((currentRows||[]).map(r=>[r.source_key,r]))
  const groups=new Map()
  const defaults=new Set(['','panel sheets','ceiling fittings','panel sheets / ceiling fittings'])
  for(const row of source){
    const stored=bySource.get(row.source_key)
    if(!stored){skipped++;continue}
    const target=destination.get(row.section_path)
    if(stored.section_id===target)continue
    const oldPath=sectionPath(stored.section_id,byId).toLowerCase()
    if(!defaults.has(oldPath)){skipped++;continue}
    if(!groups.has(target))groups.set(target,[])
    groups.get(target).push(stored.id)
  }
  for(const [target,ids] of groups){
    for(let i=0;i<ids.length;i+=500){
      const batch=ids.slice(i,i+500)
      const result=await db.rpc('proc_company_move_list_items',{
        p_company_id:company.id,p_section_id:target,p_item_ids:batch
      })
      if(result.error)throw result.error
      if(Number(result.data)!==batch.length)throw new Error('Ceiling-fitting category move was incomplete.')
      moved+=batch.length
    }
  }
  return {created,moved,matched:(currentRows||[]).length,skipped}
}
