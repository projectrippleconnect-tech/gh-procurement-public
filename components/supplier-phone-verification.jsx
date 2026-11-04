'use client'
import {useState} from 'react'
import {supplierClient} from '@/lib/supplier-client'

export function SupplierPhoneVerification({token,onVerified,language='en'}){
 const [phone,setPhone]=useState(''),[code,setCode]=useState(''),[challenge,setChallenge]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('')
 const copy=language==='ta'?{
  title:'தொலைபேசி சரிபார்ப்பு',phone:'சப்ளையர் பட்டியலில் உள்ள தொலைபேசி எண்',request:'குறியீட்டைக் கோருக',code:'6 இலக்கக் குறியீடு',verify:'சரிபார்க்க',hint:'GH ஊழியர் உங்கள் பதிவு செய்யப்பட்ட WhatsApp எண்ணிற்குக் குறியீட்டை அனுப்புவார். குறியீடு 5 நிமிடங்களில் காலாவதியாகும்.',sent:'கோரிக்கை பதிவு செய்யப்பட்டது. GH அனுப்பும் குறியீட்டை உள்ளிடவும்.',waiting:'காத்திருக்கவும்…'
 }:{title:'Verify your phone',phone:'Supplier directory phone number',request:'Request code',code:'6-digit code',verify:'Verify phone',hint:'GH staff will send a code to your registered WhatsApp number. Codes expire after 5 minutes.',sent:'Request recorded. Enter the code GH sends to your registered number.',waiting:'Please wait…'}
 async function run(name,args,next){setBusy(true);setError('');try{const {data,error}=await supplierClient.rpc(name,args);if(error)throw error;if(!data.ok)throw Error(data.error||'Verification failed.');next(data)}catch(e){setError(e.message)}finally{setBusy(false)}}
 return <section className="card pad" style={{maxWidth:480,margin:'24px auto'}} lang={language}>
  <h1>{copy.title}</h1><p>{copy.hint}</p>
  <label>{copy.phone}<input className="input" type="tel" autoComplete="tel" value={phone} onChange={e=>{setPhone(e.target.value);setChallenge('');setCode('')}} placeholder="+947…" disabled={busy}/></label>
  <button className="btn section" disabled={busy||!phone} onClick={()=>run('proc_supplier_request_code_v1',{p_token:token,p_phone:phone},data=>{setChallenge(data.challenge_id);setNotice(copy.sent)})}>{busy?copy.waiting:copy.request}</button>
  {challenge&&<><label style={{display:'block',marginTop:16}}>{copy.code}<input className="input" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={e=>setCode(e.target.value.replace(/\D/g,''))}/></label><button className="btn primary section" disabled={busy||code.length!==6} onClick={()=>run('proc_supplier_verify_code_v1',{p_token:token,p_challenge_id:challenge,p_code:code},data=>{setCode('');onVerified(data.session)})}>{copy.verify}</button></>}
  {notice&&<p role="status">{notice}</p>}{error&&<p role="alert" className="error">{error}</p>}
 </section>
}
