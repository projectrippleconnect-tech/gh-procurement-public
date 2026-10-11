import {createClient} from 'npm:@supabase/supabase-js@2.117.2'

const cors={
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods':'POST, OPTIONS'
}

Deno.serve(async req=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:cors})
  if(req.method!=='POST')return new Response(JSON.stringify({error:'Method not allowed'}),{status:405,headers:{...cors,'Content-Type':'application/json'}})

  try{
    const supabaseUrl=Deno.env.get('SUPABASE_URL')
    const anonKey=Deno.env.get('SUPABASE_ANON_KEY')
    const serviceKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if(!supabaseUrl||!anonKey||!serviceKey)throw new Error('Server authentication configuration is incomplete.')

    const authHeader=req.headers.get('Authorization')||''
    if(!authHeader.startsWith('Bearer '))return new Response(JSON.stringify({error:'Not authenticated'}),{status:401,headers:{...cors,'Content-Type':'application/json'}})

    const userClient=createClient(supabaseUrl,anonKey,{
      global:{headers:{Authorization:authHeader}},
      auth:{persistSession:false,autoRefreshToken:false}
    })
    const service=createClient(supabaseUrl,serviceKey,{
      auth:{persistSession:false,autoRefreshToken:false}
    })

    const {data:{user:caller},error:userError}=await userClient.auth.getUser()
    if(userError||!caller)return new Response(JSON.stringify({error:'Not authenticated'}),{status:401,headers:{...cors,'Content-Type':'application/json'}})

    const {data:callerProfile,error:profileError}=await service.from('proc_profiles').select('role_key,active').eq('id',caller.id).maybeSingle()
    if(profileError)throw profileError
    const {data:callerPermission,error:permissionError}=callerProfile?.role_key
      ?await service.from('proc_role_permissions').select('permission_key').eq('role_key',callerProfile.role_key).eq('permission_key','admin.users.manage').eq('allowed',true).maybeSingle()
      :{data:null,error:null}
    if(permissionError)throw permissionError
    if(!callerProfile?.active||!callerPermission){
      return new Response(JSON.stringify({error:'User-management permission required'}),{status:403,headers:{...cors,'Content-Type':'application/json'}})
    }

    const body=await req.json().catch(()=>({}))
    const email=String(body.email||'').trim().toLowerCase()
    const displayName=String(body.display_name||'').trim()
    const roleKey=String(body.role_key||body.role||'viewer').trim()
    const delivery=body.delivery||'email'
    if(!['email','link'].includes(delivery))throw new Error('Invalid invitation delivery method.')
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new Error('Enter a valid email address.')
    if(!displayName)throw new Error('Enter the user name.')
    const {data:targetRole,error:roleError}=await service.from('proc_roles').select('role_key,base_role,name,enabled').eq('role_key',roleKey).maybeSingle()
    if(roleError)throw roleError
    if(!targetRole?.enabled)throw new Error('Invalid or disabled procurement role.')
    const role=targetRole.base_role

    let existingUser=null
    for(let page=1;page<=5&&!existingUser;page++){
      const {data,error}=await service.auth.admin.listUsers({page,perPage:200})
      if(error)throw error
      existingUser=(data.users||[]).find(u=>String(u.email||'').toLowerCase()===email)||null
      if((data.users||[]).length<200)break
    }

    const redirectTo='https://gh-procurement-production.up.railway.app/?recovery=1'
    let setupEmailSent=false
    let setupLink=null
    let invited=false
    let authUser=existingUser
    if(delivery==='link'){
      const {data,error}=await service.auth.admin.generateLink({
        type:existingUser?'recovery':'invite',email,
        options:{redirectTo,data:{display_name:displayName,gh_procurement_role:role,gh_procurement_role_key:roleKey}}
      })
      if(error)throw error
      authUser=data.user
      // Send staff directly to this application's recovery screen. A token hash
      // stays in the URL fragment (not HTTP logs) until verifyOtp exchanges it.
      const tokenHash=data.properties?.hashed_token
      const linkType=existingUser?'recovery':'invite'
      setupLink=tokenHash
        ?redirectTo+'#token_hash='+encodeURIComponent(tokenHash)+'&type='+linkType
        :data.properties?.action_link
      if(!setupLink)throw new Error('The setup link could not be generated.')
      invited=!existingUser
    }else if(!authUser){
      const {data,error}=await service.auth.admin.inviteUserByEmail(email,{
        redirectTo,
        data:{display_name:displayName,gh_procurement_role:role,gh_procurement_role_key:roleKey}
      })
      if(error)throw error
      authUser=data.user
      invited=true
    }

    if(!authUser?.id)throw new Error('The user account could not be created.')
    if(delivery==='email'&&existingUser?.invited_at&&!existingUser?.last_sign_in_at){
      const {error}=await service.auth.resetPasswordForEmail(email,{redirectTo})
      if(error)throw error
      setupEmailSent=true
    }

    const {data:existingAppUser}=await service.from('app_users').select('custom_data').eq('id',authUser.id).maybeSingle()
    const {error:appUserError}=await service.from('app_users').upsert({
      id:authUser.id,
      email,
      display_name:displayName,
      active:true,
      custom_data:{
        ...(existingAppUser?.custom_data||{}),
        gh_procurement_access:true,
        gh_procurement_role:role,
        gh_procurement_role_key:roleKey
      },
      updated_at:new Date().toISOString()
    },{onConflict:'id'})
    if(appUserError)throw appUserError

    const {error:procProfileError}=await service.from('proc_profiles').upsert({
      id:authUser.id,
      display_name:displayName,
      role,
      role_key:roleKey,
      active:true,
      deleted_at:null,
      deleted_by:null,
      updated_at:new Date().toISOString()
    },{onConflict:'id'})
    if(procProfileError)throw procProfileError

    const {error:directoryError}=await service.from('proc_user_directory').upsert({
      user_id:authUser.id,
      email,
      display_name:displayName,
      updated_at:new Date().toISOString()
    },{onConflict:'user_id'})
    if(directoryError)throw directoryError

    const {data:pending}=await service.from('proc_user_invites').select('id').eq('status','pending').ilike('email',email).maybeSingle()
    const invitePayload={
      email,display_name:displayName,role,role_key:roleKey,
      status:(invited||setupEmailSent||setupLink)?'pending':'accepted',
      invited_by:caller.id,
      invited_user_id:authUser.id,
      invited_at:new Date().toISOString(),
      expires_at:(invited||setupEmailSent||setupLink)?new Date(Date.now()+7*86400000).toISOString():null,
      accepted_at:(invited||setupEmailSent||setupLink)?null:new Date().toISOString(),
      error_message:null,
      updated_at:new Date().toISOString()
    }
    if(pending?.id){
      const {error}=await service.from('proc_user_invites').update(invitePayload).eq('id',pending.id)
      if(error)throw error
    }else{
      const {error}=await service.from('proc_user_invites').insert(invitePayload)
      if(error)throw error
    }

    return new Response(JSON.stringify({
      ok:true,
      invited,
      existing:!invited,
      user_id:authUser.id,
      email,
      role:roleKey,
      role_name:targetRole.name,
      setup_link:setupLink,
      message:setupLink?'One-time setup link generated. Share it only with the invited person.':invited?'Invitation email sent.':setupEmailSent?'Fresh password-setup email sent. Use the newest email.':'Existing account enabled and assigned to the selected role.'
    }),{status:200,headers:{...cors,'Content-Type':'application/json','Cache-Control':'no-store'}})
  }catch(error){
    return new Response(JSON.stringify({error:String(error?.message||error)}),{status:400,headers:{...cors,'Content-Type':'application/json'}})
  }
})
