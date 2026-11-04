'use client'
export function ProcurementGuide({canNavigate=()=>false,language='en'}){
 const tamil=language==='ta',buying=canNavigate('requirements')
 const steps=buying?[
  ['Stock count','Save draft → review → final confirm','கையிருப்பு எண்ணிக்கை','வரைவு → சரிபார்ப்பு → உறுதிப்படுத்தல்'],
  ['RFQ or Direct PO','Use the saved category route and supplier','விலை கோரல் அல்லது நேரடி கொள்முதல்','வகை மற்றும் வழங்குநர் விதிப்படி'],
  ['Supplier prices','Verified supplier confirms price and available quantity','வழங்குநர் விலைகள்','சரிபார்க்கப்பட்ட விலை மற்றும் கிடைக்கும் அளவு'],
  ['Review and approve','Check terms, eligible landed cost and purchase limits','சரிபார்த்து அனுமதி','நிபந்தனைகள், மொத்த செலவு மற்றும் வரம்புகள்'],
  ['Send supplier PO','PNG + caption; private owner audit copy','கொள்முதல் ஆணையை அனுப்புதல்','படம், செய்தி மற்றும் உரிமையாளரின் தனிப்பட்ட பதிவு'],
  ['Receive and reconcile','Accept actual quantities; follow up shortages and invoice differences','பெறுதல் மற்றும் ஒப்பிடுதல்','பெற்ற அளவு, குறைபாடு மற்றும் விலைப்பட்டியல் வேறுபாடு']
 ]:[['Stock count','Save draft → review → final confirm','கையிருப்பு எண்ணிக்கை','வரைவு → சரிபார்ப்பு → உறுதிப்படுத்தல்'],['Submission history','Open an item’s History to check submitted counts','சமர்ப்பிப்பு வரலாறு','உருப்படியின் வரலாற்றில் எண்ணிக்கையைப் பார்க்கவும்']]
 return <details className="card pad section"><summary>{tamil?'கொள்முதல் செயல்முறை':'How procurement works'}</summary><ol className="procurement-guide">{steps.map(([title,body,ta,tb],i)=><li key={title}><b>{tamil?ta:title}</b><p className="muted tiny">{tamil?tb:body}</p>{buying&&i===1&&<small>{tamil?'நேரடி ஆணைக்கு விலை கோரல் தேவையில்லை.':'Direct PO continues to approval without an RFQ.'}</small>}</li>)}</ol>{buying&&<p className="muted tiny">{tamil?'அனுமதிக்கப்பட்ட சுற்று: 6 மணி நேரத்தில் தேர்வு; ஒதுக்கப்படாத அளவுக்கு ஒரு 24 மணி நேர சுற்று.':'Approved quotation rounds close after 6 hours. Unallocated quantities may reopen once for 24 hours. Sending and purchase approval have separate controls.'}</p>}</details>
}
