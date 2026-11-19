import { createClient } from "npm:@supabase/supabase-js@2";
const corsHeaders={ "Access-Control-Allow-Origin":"*", "Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods":"POST, OPTIONS" };
function response(data:unknown,status=200){return new Response(JSON.stringify(data),{status,headers:{...corsHeaders,"Content-Type":"application/json"}});}
function normalise(v:string){return v.trim().toLowerCase().replace(/\s+/g," ");}
async function derivePinHash(pin:string,saltBase64:string){const salt=Uint8Array.from(atob(saltBase64),(c)=>c.charCodeAt(0));const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(pin),"PBKDF2",false,["deriveBits"]);const bits=await crypto.subtle.deriveBits({name:"PBKDF2",salt,iterations:210000,hash:"SHA-256"},key,256);return Array.from(new Uint8Array(bits)).map(b=>b.toString(16).padStart(2,"0")).join("");}
function constantTimeEqual(a:string,b:string){if(a.length!==b.length)return false;let d=0;for(let i=0;i<a.length;i++)d|=a.charCodeAt(i)^b.charCodeAt(i);return d===0;}
async function hashToken(token:string){const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(token));return Array.from(new Uint8Array(digest)).map(b=>b.toString(16).padStart(2,"0")).join("");}
function generateToken(){return Array.from(crypto.getRandomValues(new Uint8Array(32))).map(b=>b.toString(16).padStart(2,"0")).join("");}

async function writeSecurityAudit(db:any,eventType:string,outcome:string,severity:string,actorReference:number|null,details:Record<string,unknown>={}){
 try{
  const {error}=await db.from("system_admin_audit_log").insert({
   source_system:"match_availability_parent_portal",severity,event_type:eventType,outcome,
   actor_type:"parent",actor_reference:actorReference===null?null:String(actorReference),details
  });
  if(error)console.error("Security audit write failed:",error.message);
 }catch(error){console.error("Security audit write failed:",error);}
}

async function authenticateParent(db:any,name:string,pin:string){
  const normalised=normalise(name);
  const {data:account,error}=await db.from("match_parent_access")
    .select("id,parent_name,pin_salt,pin_hash,failed_attempts,locked_until")
    .eq("normalised_name",normalised).maybeSingle();
  if(error)throw new Error("Unable to verify parent access");
  if(!account){
    await writeSecurityAudit(db,"parent_pin_verification","failed","warning",null,{reason:"account_not_found"});
    return {ok:false,status:401,error:"Parent account not found. Please register first."};
  }
  if(account.locked_until&&new Date(account.locked_until).getTime()>Date.now()){
    await writeSecurityAudit(db,"parent_pin_verification","blocked","warning",Number(account.id),{reason:"account_locked"});
    return {ok:false,status:429,error:"Too many incorrect PIN attempts. Please try again in 10 minutes."};
  }
  return await verifyParentPinAtomically(db,account,pin);
}

async function verifyParentPinAtomically(supabase: any, account: any, pin: string) {
  const suppliedHash = await derivePinHash(pin, account.pin_salt);
  const { data: result, error } = await supabase.rpc("verify_parent_pin_attempt", {
    p_parent_access_id: Number(account.id),
    p_supplied_hash: suppliedHash,
  });
  if (error || !result || typeof result.reason === "undefined" && result.ok !== true) {
    console.error("Parent PIN verification failed:", error?.message);
    throw new Error("Unable to verify parent access");
  }
  if (result.ok === true) {
    return { ok: true, account };
  }
  const reason = result.reason;
  const locked = reason === "five_failed_attempts";
  const blocked = reason === "account_locked";
  const outcome = locked ? "locked_out" : blocked ? "blocked" : "failed";
  const severity = locked ? "critical" : "warning";
  await writeSecurityAudit(supabase, "parent_pin_verification", outcome, severity, Number(account.id), {
    reason: locked ? "five_failed_attempts" : blocked ? "account_locked" : "incorrect_pin",
  });
  return {
    ok: false,
    status: locked || blocked ? 429 : 401,
    error: locked || blocked
      ? "Too many incorrect PIN attempts. Please try again in 10 minutes."
      : "That PIN is incorrect. Please try again.",
  };
}

async function markParentActivity(db:any,parentId:number){
 const {data:membership,error:membershipError}=await db.from("match_parent_family_members").select("family_id").eq("parent_access_id",parentId).maybeSingle();
 if(membershipError)throw new Error("Unable to update family activity");
 const ids=[parentId];
 if(membership?.family_id){
  const {data:members,error}=await db.from("match_parent_family_members").select("parent_access_id").eq("family_id",membership.family_id);
  if(error)throw new Error("Unable to update family activity");
  for(const member of members??[])ids.push(Number(member.parent_access_id));
 }
 const {error:updateError}=await db.from("match_parent_access").update({last_activity_at:new Date().toISOString()}).in("id",[...new Set(ids)]);
 if(updateError)throw new Error("Unable to update parent activity");
}
async function familyFor(db:any,parentId:number){
 const {data,error}=await db.from("match_parent_family_members").select("family_id").eq("parent_access_id",parentId).maybeSingle();
 if(error)throw new Error("Unable to load family membership");return data?.family_id??null;
}
async function mergeFamilySubmissions(db:any,familyId:number,parentIds:number[]){
 const {data:parents,error:parentError}=await db.from("match_parent_access").select("id,parent_name").in("id",parentIds);
 if(parentError)throw new Error("Unable to inspect linked parent accounts");
 const names=new Set((parents??[]).map((x:any)=>normalise(x.parent_name)));
 const {data:allRows,error:rowsError}=await db.from("match_submissions").select("id,fixture_id,parent_name,family_id,updated_at");
 if(rowsError)throw new Error("Unable to inspect existing responses");
 const related=(allRows??[]).filter((s:any)=>Number(s.family_id)===familyId||(!s.family_id&&names.has(normalise(s.parent_name))));
 const byFixture=new Map<number,any[]>();
 for(const s of related){const list=byFixture.get(Number(s.fixture_id))??[];list.push(s);byFixture.set(Number(s.fixture_id),list);}
 for(const [fixtureId,list] of byFixture){
  list.sort((a,b)=>Number(Boolean(b.family_id))-Number(Boolean(a.family_id))||Number(a.id)-Number(b.id));
  const canonical=list[0];
  for(const other of list.slice(1)){
   const {data:source,error:childErr}=await db.from("match_availability").select("*").eq("submission_id",other.id);
   if(childErr)throw new Error("Unable to combine linked parent responses");
   const {data:target,error:targetErr}=await db.from("match_availability").select("*").eq("submission_id",canonical.id);
   if(targetErr)throw new Error("Unable to combine linked parent responses");
   const key=(x:any)=>[normalise(x.child_name),Number(x.age_group_id),normalise(x.school_year||"")].join("|");
   const existing=new Map((target??[]).map((x:any)=>[key(x),x]));
   for(const child of source??[]){
    const match=existing.get(key(child)) as any;
    if(match){
     if(new Date(child.updated_at).getTime()>new Date(match.updated_at).getTime()){
      const {error:updateErr}=await db.from("match_availability").update({availability:child.availability,updated_at:child.updated_at}).eq("id",match.id);
      if(updateErr)throw new Error("Unable to reconcile duplicate child response");
     }
     const {error:deleteChildError}=await db.from("match_availability").delete().eq("id",child.id);
     if(deleteChildError)throw new Error("Unable to remove duplicate child response");
    }else{
     const {error:moveErr}=await db.from("match_availability").update({submission_id:canonical.id}).eq("id",child.id);
     if(moveErr)throw new Error("Unable to combine linked parent responses");
     existing.set(key(child),child);
    }
   }
   const {error:deleteErr}=await db.from("match_submissions").delete().eq("id",other.id);
   if(deleteErr)throw new Error("Unable to finish combining linked parent responses");
  }
  const {error:familyErr}=await db.from("match_submissions").update({family_id:familyId}).eq("id",canonical.id);
  if(familyErr)throw new Error("Unable to enable shared fixture responses");
 }
}
Deno.serve(async(req)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:corsHeaders});
 if(req.method!=="POST")return response({error:"Method not allowed"},405);
 try{
  const body=await req.json();const name=typeof body?.parent_name==="string"?body.parent_name.trim():"";const pin=typeof body?.parent_pin==="string"?body.parent_pin.trim():"";
  if(!name||name.length>100||!/^\d{6}$/.test(pin))return response({error:"Please enter your parent name and 6-digit PIN."},400);
  const url=Deno.env.get("SUPABASE_URL"),key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");if(!url||!key)return response({error:"Service unavailable"},500);
  const db=createClient(url,key,{auth:{autoRefreshToken:false,persistSession:false}});
  const auth=await authenticateParent(db,name,pin);if(!auth.ok)return response({error:auth.error},auth.status);
  const parent=auth.account;const action=body.action||"status";
  let familyId=await familyFor(db,Number(parent.id));
  if(action==="status"){
   if(!familyId)return response({success:true,family:null,members:[],invitations:[]});
   const {data:members,error:memberErr}=await db.from("match_parent_family_members").select("parent_access_id,joined_at,linked_parent:match_parent_access!match_parent_family_members_parent_access_id_fkey(parent_name)").eq("family_id",familyId).order("joined_at");
   if(memberErr)throw new Error("Unable to load linked parents");
   const {data:invites,error:inviteErr}=await db.from("match_parent_family_invitations").select("id,invited_by_parent_id,expires_at,created_at").eq("family_id",familyId).is("accepted_at",null).is("revoked_at",null).gt("expires_at",new Date().toISOString()).order("created_at",{ascending:false});
   if(inviteErr)throw new Error("Unable to load invitations");
   return response({success:true,family:{id:familyId},members:(members??[]).map((m:any)=>({parent_name:m.linked_parent?.parent_name,joined_at:m.joined_at,is_you:Number(m.parent_access_id)===Number(parent.id)})),invitations:invites??[]});
  }
  if(action==="create_invite"){
   if(!familyId){
    const {data:family,error:familyErr}=await db.from("match_parent_families").insert({created_by_parent_id:parent.id}).select("id").single();
    if(familyErr||!family)throw new Error("Unable to create family sharing");
    familyId=family.id;
    const {error:memberErr}=await db.from("match_parent_family_members").insert({family_id:familyId,parent_access_id:parent.id,linked_by_parent_id:parent.id});
    if(memberErr)throw new Error("Unable to activate family sharing");
   }
   const token=generateToken(),expires=new Date(Date.now()+24*60*60*1000).toISOString();
   const {error}=await db.from("match_parent_family_invitations").insert({family_id:familyId,invited_by_parent_id:parent.id,token_hash:await hashToken(token),expires_at:expires});
   if(error)throw new Error("Unable to create invitation");
   await markParentActivity(db,Number(parent.id));
   await writeSecurityAudit(db,"parent_family_invitation_created","success","info",Number(parent.id),{family_id:Number(familyId)});
   return response({success:true,invite_url:"https://rhrfc-mini.pages.dev/?family_invite="+token,expires_at:expires});
  }
  if(action==="accept_invite"){
    const token=typeof body.invite_token==="string"?body.invite_token:"";
    if(token.length<32||token.length>256){
     await writeSecurityAudit(db,"parent_family_invitation_validation","failed","warning",Number(parent.id),{reason:"invalid_invitation_token_format"});
     return response({error:"This invitation link is invalid."},400);
    }
    const {data:acceptResult,error:acceptError}=await db.rpc("accept_parent_family_invitation",{
     p_token_hash:await hashToken(token),
     p_parent_access_id:Number(parent.id),
    });
    if(acceptError){
     console.error("Family invitation acceptance failed:",acceptError.message);
     throw new Error("Unable to accept invitation");
    }
    if(!acceptResult?.ok){
     const reason=acceptResult?.reason;
     await writeSecurityAudit(db,"parent_family_invitation_validation",
      reason==="already_linked_to_different_family"?"denied":"failed","warning",Number(parent.id),{reason:reason||"invitation_unavailable"});
     if(reason==="already_linked_to_different_family"){
      return response({error:"This parent account is already linked to another family. Please unlink it first."},409);
     }
     if(reason==="invalid_request"||reason==="parent_not_found"){
      return response({error:"This invitation link is invalid."},400);
     }
     return response({error:"This invitation has expired, already been used or was cancelled. Ask the parent to send a new invitation."},410);
    }
    familyId=Number(acceptResult.family_id);
    const {data:allMembers,error:allMembersError}=await db.from("match_parent_family_members").select("parent_access_id").eq("family_id",familyId);
    if(allMembersError)throw new Error("Unable to load linked parents");
    await mergeFamilySubmissions(db,familyId,(allMembers??[]).map((m:any)=>Number(m.parent_access_id)));
    await markParentActivity(db,Number(parent.id));
    await writeSecurityAudit(db,"parent_family_invitation_accepted","success","info",Number(parent.id),{family_id:familyId});
    return response({success:true,accepted:true});
   }
   if(action==="revoke_invite"){
   const id=Number(body.invitation_id);if(!Number.isInteger(id)||id<1||!familyId)return response({error:"Invitation not found."},404);
   const {data:invite,error}=await db.from("match_parent_family_invitations").select("id").eq("id",id).eq("family_id",familyId).eq("invited_by_parent_id",parent.id).is("accepted_at",null).is("revoked_at",null).maybeSingle();
   if(error||!invite)return response({error:"Invitation is no longer available."},404);
   const {error:updateErr}=await db.from("match_parent_family_invitations").update({revoked_at:new Date().toISOString()}).eq("id",id);
   if(updateErr)throw new Error("Unable to revoke invitation");await markParentActivity(db,Number(parent.id));await writeSecurityAudit(db,"parent_family_invitation_revoked","success","info",Number(parent.id),{family_id:Number(familyId)});return response({success:true});
  }
  if(action==="unlink"){
   if(!familyId)return response({success:true});
   const {data:members,error}=await db.from("match_parent_family_members").select("parent_access_id").eq("family_id",familyId);
   if(error)throw new Error("Unable to load family members");
   const remaining=(members??[]).filter((m:any)=>Number(m.parent_access_id)!==Number(parent.id));
   if(remaining.length===0){
    const {error:subErr}=await db.from("match_submissions").update({family_id:null}).eq("family_id",familyId);if(subErr)throw new Error("Unable to separate shared responses");
   }else if(remaining.length===1){
    const {data:owner,error:ownerErr}=await db.from("match_parent_access").select("parent_name").eq("id",remaining[0].parent_access_id).single();
    if(ownerErr)throw new Error("Unable to preserve remaining parent responses");
    const {error:subErr}=await db.from("match_submissions").update({family_id:null,parent_name:owner.parent_name}).eq("family_id",familyId);if(subErr)throw new Error("Unable to separate shared responses");
   }
   const {error:delErr}=await db.from("match_parent_family_members").delete().eq("family_id",familyId).eq("parent_access_id",parent.id);
   if(delErr)throw new Error("Unable to remove family access");
   await db.from("match_parent_family_invitations").update({revoked_at:new Date().toISOString()}).eq("family_id",familyId).is("accepted_at",null).is("revoked_at",null);
   await markParentActivity(db,Number(parent.id));
   await writeSecurityAudit(db,"parent_family_unlinked","success","warning",Number(parent.id),{family_id:Number(familyId)});
   return response({success:true});
  }
  return response({error:"Unknown family action"},400);
 }catch(error){console.error("manage_parent_family:",error);return response({error:error instanceof Error?error.message:"Unable to manage family sharing"},400);}
});