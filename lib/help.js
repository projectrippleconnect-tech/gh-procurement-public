export const HELP_TOPICS={
 stock_entry:{
  title:{en:'Fast Stock Entry',ta:'வேக ஸ்டாக் பதிவு'},
  body:{en:'Enter the physical quantity on the right, then use the keyboard Next/Enter key to move directly to the next product. Draft values are retained until submission.',ta:'வலப்புறத்தில் நேரடி அளவை உள்ளிட்டு, கீபோர்டின் Next/Enter விசையை அழுத்தி அடுத்த பொருளுக்கு செல்லவும். சமர்ப்பிக்கும் வரை உள்ளீடுகள் பாதுகாக்கப்படும்.'}
 },
 reorder_level:{
  title:{en:'Reorder Level',ta:'மீள் ஆர்டர் அளவு'},
  body:{en:'The approximate stock threshold where replenishment should be considered. It is shown as a compact R: value during counting.',ta:'புதிய ஸ்டாக் வாங்க பரிசீலிக்க வேண்டிய சுமார் அளவு. கணக்கிடும் போது R: என்ற குறுகிய மதிப்பாக காட்டப்படும்.'}
 },
 movement:{
  title:{en:'Movement',ta:'ஸ்டாக் நகர்வு'},
  body:{en:'FAST, NORMAL or SLOW indicates how quickly the item usually moves and helps determine count frequency and reorder attention.',ta:'FAST, NORMAL அல்லது SLOW என்பது பொருள் எவ்வளவு வேகமாக நகர்கிறது என்பதை காட்டி, கணக்கிடும் இடைவெளி மற்றும் மீள் ஆர்டர் கவனத்தை நிர்ணயிக்க உதவும்.'}
 },
 maximum_stock:{
  title:{en:'Maximum Stock',ta:'அதிகபட்ச ஸ்டாக்'},
  body:{en:'The planning ceiling used when calculating a suggested replenishment quantity after a stock count.',ta:'ஸ்டாக் கணக்கிற்குப் பிறகு பரிந்துரைக்கப்படும் கொள்முதல் அளவை கணக்கிட பயன்படும் திட்டமிட்ட அதிகபட்ச அளவு.'}
 },
 urgent_orders:{
  title:{en:'Urgent Actions',ta:'அவசர நடவடிக்கைகள்'},
  body:{en:'Flags zero stock, customer-paid needs, fast movers or other time-critical requirements for priority procurement attention.',ta:'பூஜ்ஜிய ஸ்டாக், வாடிக்கையாளர் பணம் செலுத்திய தேவைகள், வேகமாக நகரும் பொருட்கள் போன்ற அவசர தேவைகளை முன்னுரிமைக்காக குறிக்கும்.'}
 },
 quotation_comparison:{
  title:{en:'Quotation Comparison',ta:'விலை ஒப்பீடு'},
  body:{en:'Compares supplier pricing and commercial terms so the purchasing decision can be reviewed before an order is created.',ta:'கொள்முதல் ஆணை உருவாக்குவதற்கு முன் சப்ளையர் விலை மற்றும் வணிக நிபந்தனைகளை ஒப்பிட்டு முடிவை பரிசீலிக்க உதவும்.'}
 },
 po_approval:{
  title:{en:'Purchase Order Approval',ta:'கொள்முதல் ஆணை ஒப்புதல்'},
  body:{en:'Purchase orders can be prepared by permitted staff, but approval is a separate protected action. This prevents an order from being sent without an authorized review.',ta:'அனுமதி பெற்ற பணியாளர்கள் கொள்முதல் ஆணையைத் தயாரிக்கலாம்; ஆனால் ஒப்புதல் தனி பாதுகாக்கப்பட்ட செயலாகும். அதிகாரப்பூர்வ மதிப்பாய்வு இல்லாமல் ஆர்டர் அனுப்பப்படுவதை இது தடுக்கும்.'}
 },
 receiving:{
  title:{en:'Goods Receiving',ta:'பொருள் பெறுதல்'},
  body:{en:'Record what physically arrived, split accepted and rejected quantities, and keep the receipt linked to the purchase order. Accepted quantities update stock; rejected quantities remain in follow-up.',ta:'உண்மையில் வந்த அளவை பதிவு செய்து, ஏற்றுக்கொண்ட மற்றும் நிராகரித்த அளவுகளை பிரித்து, ரசீதைக் கொள்முதல் ஆணையுடன் இணைக்கவும். ஏற்றுக்கொண்ட அளவு ஸ்டாக்கை புதுப்பிக்கும்; நிராகரித்த அளவு தொடர்ச்சி கண்காணிப்பில் இருக்கும்.'}
 },
 roles_permissions:{
  title:{en:'Roles & Permissions',ta:'பாத்திரங்கள் & அனுமதிகள்'},
  body:{en:'Permissions control both what the user sees and what the backend allows. Disabling a permission therefore removes the UI action and blocks the protected database/API operation.',ta:'அனுமதிகள் பயனர் பார்க்கும் UI-யையும் backend அனுமதிக்கும் செயல்களையும் கட்டுப்படுத்தும். ஒரு அனுமதியை நீக்கினால் பொத்தான் மறையும்; பாதுகாக்கப்பட்ட API/தரவுத்தள செயலும் மறுக்கப்படும்.'}
 }
}

export function getHelpTopic(key,language='en'){
 const x=HELP_TOPICS[key]
 if(!x)return null
 const lang=language==='ta'?'ta':'en'
 return {key,title:x.title[lang]||x.title.en,body:x.body[lang]||x.body.en}
}
export function getAllHelpTopics(language='en'){
 return Object.keys(HELP_TOPICS).map(k=>getHelpTopic(k,language)).filter(Boolean)
}
