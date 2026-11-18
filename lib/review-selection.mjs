// Selection survives pagination; visible refreshed records replace saved snapshots.
export function selectedRequirementRows(selected,saved=[],visible=[]){
 const byId=new Map([...saved,...visible].map(row=>[row.id,row]))
 return [...selected].map(id=>byId.get(id)).filter(Boolean)
}
export function eligibleRfqRequirements(rows=[]){
 return rows.filter(row=>row.approval_status==='approved'&&Number(row.remaining_to_order)>0&&!row.has_active_rfq&&!['received','closed','cancelled'].includes(row.status))
}
export function paginateRfqItems(items,perPage=30){
 if(!Array.isArray(items)||!items.length)throw new Error('Select at least one item for the RFQ images.')
 if(![20,30,40].includes(Number(perPage)))throw new Error('Choose 20, 30 or 40 items per image.')
 const pages=[]
 for(let offset=0;offset<items.length;offset+=Number(perPage))pages.push({items:items.slice(offset,offset+Number(perPage)),startNumber:offset+1,pageNumber:pages.length+1,pageCount:Math.ceil(items.length/Number(perPage)),totalItems:items.length})
 return pages
}
