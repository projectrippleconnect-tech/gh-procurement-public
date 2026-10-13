export const DEFAULT_ACCESS_POLICY = Object.freeze({
 time_enabled:true,location_enabled:true,days:[0,1,2,3,4,5],
 start_time:'07:30',end_time:'18:30',latitude:7.0552571,longitude:80.5345549,
 radius_m:100,location_name:'General Hardware, No. 14 Kandy Road, Nawalapitiya'
})

export function validateAccessPolicy(policy){
 if(!Array.isArray(policy.days)||!policy.days.length||policy.days.some(d=>!Number.isInteger(d)||d<0||d>6))return 'Select at least one permitted day.'
 if(!/^\d{2}:\d{2}$/.test(policy.start_time)||!/^\d{2}:\d{2}$/.test(policy.end_time)||policy.start_time>=policy.end_time)return 'Closing time must be later than opening time.'
 const time=s=>s.split(':').map(Number)
 if([policy.start_time,policy.end_time].some(s=>{const[h,m]=time(s);return h>23||m>59}))return 'Enter valid opening and closing times.'
 const lat=Number(policy.latitude),lon=Number(policy.longitude),radius=Number(policy.radius_m)
 if(!Number.isFinite(lat)||lat < -90||lat>90||!Number.isFinite(lon)||lon < -180||lon>180)return 'Enter valid map coordinates.'
 if(!Number.isFinite(radius)||radius<25||radius>5000)return 'Radius must be between 25 and 5,000 metres.'
 return null
}

export function accessMessage(reason){
 return ({checking:'Checking access…',outside_hours:'Access is closed at this time. Check your permitted days and working hours below.',
 location_required:'Verify your location to open the workspace.',outside_location:'You must be at the approved location to use this system.',
 inaccurate_location:'Your location is not accurate enough. Move near a window or outdoors and retry.',
 permission_denied:'Location permission is required. Enable it for this app in your device or browser settings, then retry.',
 location_unavailable:'Your location could not be obtained. Check your location services and retry.',
 disabled:'Your account or role is disabled. Contact Super Admin.',connection_error:'Access could not be verified. Check your connection and retry.'})[reason]||'Access could not be verified.'
}

export function currentPosition(){
 return new Promise((resolve,reject)=>{
  if(!globalThis.navigator?.geolocation){reject(Object.assign(new Error('Location services unavailable'),{code:2}));return}
  navigator.geolocation.getCurrentPosition(resolve,reject,{enableHighAccuracy:true,maximumAge:0,timeout:15000})
 })
}
