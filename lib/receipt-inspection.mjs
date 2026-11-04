export function allReceivedAccepted(value={}){
 return value.received!==''&&Number(value.received)>0&&Number.isFinite(Number(value.received))&&Number(value.accepted)===Number(value.received)&&Number(value.rejected||0)===0
}
export function acceptReceived(value={},accepted){
 if(!accepted)return {...value,accepted:'',rejected:'0',reason:''}
 if(value.received===''||!Number.isFinite(Number(value.received))||Number(value.received)<=0)return value
 return {...value,accepted:value.received,rejected:'0',reason:''}
}
