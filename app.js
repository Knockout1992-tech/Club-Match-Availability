const BASE="https://muxxlewtqhpckhoqeinn.supabase.co/functions/v1/";
const URLS={fixture:BASE+"get_fixture",submit:BASE+"submit_availability",home:BASE+"parent_home",manage:BASE+"manage_submission",family:BASE+"manage_parent_family"};
const params=new URLSearchParams(location.search);let fixtureToken=params.get("fixture"),groups=[],parentName="",parentPin="",mode="new",activeFixture=null,activeSubmission=null,parentFixtures=[],parentHomeCards=[],activeEventFilter="all";
let lockHeartbeatTimer=null,activeLockToken=null,editLockLost=false,familyInviteToken=params.get("family_invite");
const el=id=>document.getElementById(id);
const loading=el("loading"),home=el("parent-home"),events=el("events-section"),fixtureBox=el("fixture"),formBox=el("availability-form"),message=el("message"),childrenBox=el("children"),successModal=el("success-modal");
function esc(v){return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));}
function date(v){return new Date(String(v).slice(0,10)+"T12:00:00").toLocaleDateString("en-GB",{weekday:"long",day:"numeric",month:"long",year:"numeric"});}
function availabilitySummary(sub){
 const children=Array.isArray(sub?.match_availability)?sub.match_availability:[];
 if(!children.length)return {label:"Awaiting response",className:"status-pending"};
 const counts={available:0,unavailable:0,unsure:0};
 children.forEach(child=>{if(Object.prototype.hasOwnProperty.call(counts,child.availability))counts[child.availability]++;});
 const parts=[];
 for(const [key,label] of [["available","Available"],["unavailable","Unavailable"],["unsure","Unsure"]]){
  const n=counts[key];if(n)parts.push((children.length>1?n+" ":"")+label);
 }
 const state=counts.available&&counts.unavailable?"status-mixed":counts.available?"status-available":counts.unavailable?"status-unavailable":"status-unsure";
 return {label:parts.join(" · "),className:state};
}
function mapsUrl(address){
 const value=String(address||"").trim();
 return value?"https://www.google.com/maps/dir/?api=1&destination="+encodeURIComponent(value):"";
}
function hide(){[loading,home,events,fixtureBox,formBox,message,successModal].forEach(x=>x.hidden=true);}
function showFormFeedback(text){const box=el("form-feedback");box.textContent=text;box.hidden=false;}
function showSuccessPopup(text){el("success-message-text").textContent=text;successModal.hidden=false;el("success-ok").focus();}
function clearFormFeedback(){const box=el("form-feedback");box.textContent="";box.hidden=true;}
function showMessage(t,err=false){hide();message.hidden=false;message.textContent=t;message.className=err?"panel error-message":"panel";}
async function post(url,data){const r=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(data)});const j=await r.json();if(!r.ok||j.success===false)throw Error(j.error||"Unable to complete request.");return j;}
function showHome(){hide();home.hidden=false;el("lookup-parent-name").value=parentName;}
async function loadHome(name,pin=parentPin){
 const requestedName=name.trim();
 hide();
 loading.hidden=false;
 el("login-feedback").hidden=true;
 try{
  const r=await post(URLS.home,{parent_name:requestedName,parent_pin:pin});
  parentName=requestedName;
  parentPin=pin;
  if(familyInviteToken){
   const accepted=await post(URLS.family,{action:"accept_invite",parent_name:parentName,parent_pin:parentPin,invite_token:familyInviteToken});
   familyInviteToken=null;history.replaceState(null,"",location.pathname+(fixtureToken?"?fixture="+encodeURIComponent(fixtureToken):""));
   if(accepted.accepted)showFamilyFeedback("Family sharing is now connected. You can both manage the same fixture responses.");
  }
  await refreshFamilyPanel();
  parentFixtures=r.fixtures||[];
  window.parentCalendarEvents=r.calendar_events||[];
  if(fixtureToken&&activeFixture){
   const existing=parentFixtures.find(f=>f.fixture_token===fixtureToken||Number(f.id)===Number(activeFixture.id));
   if(existing?.submission) await editResponse(existing,existing.submission);
   else newResponse(existing||activeFixture);
  }else renderEvents();
 }catch(e){
  hide();home.hidden=false;if(fixtureToken)fixtureBox.hidden=false;
  el("login-feedback").textContent=e.message||"Unable to sign in. Please try again.";
  el("login-feedback").hidden=false;
 }
}
function renderEvents(){
hide();events.hidden=false;
el("welcome-heading").textContent="Match availability";
el("events-list").innerHTML="";
el("events-empty").hidden=true;
const calendar=window.parentCalendarEvents||[];
const fixtureById=new Map((parentFixtures||[]).map(f=>[Number(f.id),f]));
const linkedIds=new Set(calendar.map(e=>Number(e.fixture_id||e.fixture?.id)).filter(Boolean));
const cards=[];
calendar.forEach(e=>{
 const linkedFixture=e.fixture || fixtureById.get(Number(e.fixture_id)) || null;
 const fixtureToken=e.fixture_token || linkedFixture?.fixture_token || null;
 const f=linkedFixture ? {...linkedFixture,fixture_token:fixtureToken} : (fixtureToken ? {
  id:Number(e.fixture_id || 0),
  fixture_token:fixtureToken,
  opposition:e.opposition || e.title,
  fixture_date:e.event_date,
  fixture_type:e.match_location==="away"?"away":"home",
  kick_off_time:e.start_time,
  venue:e.venue,
  age_groups:e.age_groups || [],
  submission:null
 } : null);
 const type=({training:"Training",match:e.match_location==="away"?"Away match":"Home match",other:"Other event",holiday:"Holiday / break",cancelled:"Cancelled"})[e.event_type]||"Club event";
 const age=(e.age_groups||[]).map(g=>g.display_name||g.age_group).join(", ");
 const title=e.event_type==="match"?(e.opposition||e.title):e.title;
 const canRespond=e.availability_enabled!==false&&e.event_type!=="holiday"&&e.event_type!=="cancelled"&&!!f?.fixture_token;
 const card=document.createElement("article");const eventClass=e.event_type==="match"?(e.match_location==="away"?"calendar-match-away":"calendar-match-home"):"calendar-"+e.event_type;card.className="panel event-card calendar-event "+eventClass;card.dataset.responseState=canRespond?(f.submission?"responded":"needed"):"none";card.dataset.eventDate=String(e.event_date||"");card.dataset.optionKey=String(e.event_date||"")+"|"+String(title||"").trim().toLowerCase();card.dataset.ageGroupKey=(e.age_groups||[]).map(g=>String(g.id||g.age_group_id||g.display_name||g.age_group||"").trim().toLowerCase()).sort().join("|");
 card.innerHTML='<p class="eyebrow">'+esc(type)+'</p><h2>'+esc(title)+'</h2><p><strong>'+date(e.event_date)+'</strong></p>'+
 (e.start_time?'<p>'+esc(e.start_time.slice(0,5))+(e.end_time?' – '+esc(e.end_time.slice(0,5)):'')+'</p>':'')+
 (e.venue?'<p>Venue: '+esc(e.venue)+'</p><p><a class="maps-link" href="'+esc(mapsUrl(e.venue))+'" target="_blank" rel="noopener">Open in Google Maps</a></p>':'')+
 (e.event_type==="holiday"?"":'<p class="event-groups">Age groups: '+esc(age||"—")+'</p>')+
 (e.notes?'<p>'+esc(e.notes)+'</p>':'')+
 (e.event_type==="holiday"?"":(e.event_type==="cancelled"?'<p class="response-status status-pending">Cancelled</p>':
  (canRespond?'<p><span class="response-status '+availabilitySummary(f.submission).className+'">'+esc(availabilitySummary(f.submission).label)+'</span></p><button type="button">'+(f.submission?"View / update availability":"Submit availability")+'</button>':
  '<p class="event-groups">'+(e.availability_enabled?"Availability link not yet available":"No availability requested")+'</p>')));
 if(canRespond)card.querySelector("button").addEventListener("click",()=>f.submission?editResponse(f,f.submission):newResponse(f));
 cards.push(card);
});
(parentFixtures||[]).filter(f=>!linkedIds.has(Number(f.id))).forEach(f=>{
 const sub=f.submission,card=document.createElement("article");card.className="panel event-card calendar-event "+(f.fixture_type==="away"?"calendar-match-away":"calendar-match-home");card.dataset.responseState=sub?"responded":"needed";card.dataset.eventDate=String(f.fixture_date||"");card.dataset.optionKey=String(f.fixture_date||"")+"|"+String(f.opposition||"").trim().toLowerCase();card.dataset.ageGroupKey=(f.age_groups||[]).map(g=>String(g.id||g.age_group_id||g.display_name||g.age_group||"").trim().toLowerCase()).sort().join("|");
 const ag=(f.age_groups||[]).map(g=>g.display_name||g.age_group).join(", ");
 card.innerHTML='<p class="eyebrow">'+(f.fixture_type==="home"?"Home fixture":"Away fixture")+'</p><h2>'+esc(f.opposition)+'</h2><p><strong>'+date(f.fixture_date)+'</strong></p>'+
 (f.kick_off_time?'<p>Kick-off: '+esc(f.kick_off_time.slice(0,5))+'</p>':"")+(f.venue?'<p>Venue: '+esc(f.venue)+'</p><p><a class="maps-link" href="'+esc(mapsUrl(f.venue))+'" target="_blank" rel="noopener">Open in Google Maps</a></p>':"")+
 '<p class="event-groups">Age groups: '+esc(ag||"—")+'</p><p><span class="response-status '+availabilitySummary(sub).className+'">'+esc(availabilitySummary(sub).label)+'</span></p><button type="button">'+(sub?"View / update response":"Submit availability")+'</button>';
 card.querySelector("button").addEventListener("click",()=>sub?editResponse(f,sub):newResponse(f));cards.push(card);
});
const optionGroups=new Map();
cards.forEach(card=>{if(!card.dataset.optionKey)return;const group=optionGroups.get(card.dataset.optionKey)||[];group.push(card);optionGroups.set(card.dataset.optionKey,group);});
optionGroups.forEach(group=>{const ageSets=new Set(group.map(card=>card.dataset.ageGroupKey));if(group.length>1&&ageSets.size>1)group.forEach(card=>{const ageLine=card.querySelector(".event-groups");if(ageLine)ageLine.classList.add("event-groups-different");});});
cards.sort((a,b)=>Date.parse(a.dataset.eventDate+"T12:00:00")-Date.parse(b.dataset.eventDate+"T12:00:00"));
parentHomeCards=cards;
cards.forEach(card=>el("events-list").appendChild(card));
const needed=cards.filter(c=>c.dataset.responseState==="needed").length;
const responded=cards.filter(c=>c.dataset.responseState==="responded").length;
el("home-summary").innerHTML='<div class="summary-item"><strong>'+cards.length+'</strong><span>Events</span></div><div class="summary-item"><strong>'+needed+'</strong><span>Need response</span></div><div class="summary-item"><strong>'+responded+'</strong><span>Responses recorded</span></div>';
applyEventFilter();
}
function showFamilyFeedback(text,error=false){const box=el("family-feedback");if(!box)return;box.textContent=text;box.hidden=false;box.classList.toggle("error-message",error);}
function formatFamilyExpiry(value){return new Date(value).toLocaleString("en-GB",{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"});}
async function refreshFamilyPanel(){
 const panel=el("family-panel");if(!panel||!parentName||!parentPin)return;
 try{
  const r=await post(URLS.family,{action:"status",parent_name:parentName,parent_pin:parentPin});
  const members=el("family-members"),invites=el("family-invitations"),leave=el("family-leave-button"),invite=el("family-invite-button");
  if(!r.family){
   members.innerHTML='<p>No other parents are linked yet. Create an invitation to share your fixture list and responses.</p>';
   invites.innerHTML="";leave.hidden=true;invite.textContent="Invite a parent or carer";
  }else{
   members.innerHTML=(r.members||[]).map(m=>'<div class="family-member"><div><span class="family-member-name">'+esc(m.parent_name)+'</span>'+(m.is_you?'<span class="family-member-you">(you)</span>':'')+'</div></div>').join("");
   invites.innerHTML=(r.invitations||[]).map(i=>'<div class="family-invitation"><span>Invitation awaiting acceptance · expires '+esc(formatFamilyExpiry(i.expires_at))+'</span><button type="button" class="secondary-button family-small-button" data-revoke-invite="'+Number(i.id)+'">Cancel invitation</button></div>').join("");
   leave.hidden=(r.members||[]).length<2;invite.textContent="Invite another parent or carer";
  }
  invites.querySelectorAll("[data-revoke-invite]").forEach(b=>b.addEventListener("click",async()=>{try{await post(URLS.family,{action:"revoke_invite",parent_name:parentName,parent_pin:parentPin,invitation_id:Number(b.dataset.revokeInvite)});await refreshFamilyPanel();showFamilyFeedback("Invitation cancelled.");}catch(e){showFamilyFeedback(e.message,true);}}));
 }catch(e){showFamilyFeedback(e.message||"Unable to load family sharing.",true);}
}
el("family-invite-button")?.addEventListener("click",async()=>{
 const b=el("family-invite-button");b.disabled=true;b.textContent="Creating invitation…";
 try{
  const r=await post(URLS.family,{action:"create_invite",parent_name:parentName,parent_pin:parentPin});
  const box=el("family-invite-result");box.hidden=false;box.innerHTML='<strong>Invitation ready</strong><p>Share this one-time link. It expires in 24 hours and can only be used once.</p><input id="family-invite-link" readonly value="'+esc(r.invite_url)+'"><button type="button" id="family-copy-invite">Copy invitation link</button>';
  el("family-copy-invite").addEventListener("click",async()=>{try{await navigator.clipboard.writeText(r.invite_url);showFamilyFeedback("Invitation link copied. You can now share it by WhatsApp.");}catch(e){el("family-invite-link").select();showFamilyFeedback("Select and copy the invitation link above.");}});
  await refreshFamilyPanel();
 }catch(e){showFamilyFeedback(e.message||"Unable to create invitation.",true);}
 finally{b.disabled=false;b.textContent="Invite another parent or carer";}
});
el("family-leave-button")?.addEventListener("click",async()=>{
 if(!confirm("Leave family sharing? You will no longer see the other parent's shared responses."))return;
 try{await post(URLS.family,{action:"unlink",parent_name:parentName,parent_pin:parentPin});el("family-invite-result").hidden=true;await refreshFamilyPanel();showFamilyFeedback("You have left family sharing.");}
 catch(e){showFamilyFeedback(e.message||"Unable to leave family sharing.",true);}
});
function applyEventFilter(){
 let shown=0;
 parentHomeCards.forEach(card=>{const visible=activeEventFilter==="all"||(activeEventFilter==="needed"&&card.dataset.responseState==="needed")||(activeEventFilter==="responded"&&card.dataset.responseState==="responded");card.hidden=!visible;if(visible)shown++;});
 document.querySelectorAll("[data-event-filter]").forEach(button=>{const active=button.dataset.eventFilter===activeEventFilter;button.classList.toggle("active",active);button.setAttribute("aria-pressed",String(active));});
 el("event-count").textContent=shown+" event"+(shown===1?"":"s")+" shown";
 const empty=el("events-empty");empty.hidden=shown!==0;empty.textContent=parentHomeCards.length?"There are no events in this filter.":"There are no upcoming events scheduled for the current season.";
}
document.querySelectorAll("[data-event-filter]").forEach(button=>button.addEventListener("click",()=>{activeEventFilter=button.dataset.eventFilter;applyEventFilter();}));
el("parent-lookup-form").addEventListener("submit",async e=>{e.preventDefault();const b=el("lookup-button");b.disabled=true;b.textContent="Checking...";await loadHome(el("lookup-parent-name").value,el("lookup-parent-pin").value);b.disabled=false;b.textContent="Continue";});
el("change-name").addEventListener("click",()=>{parentName="";parentPin="";el("lookup-parent-name").value="";el("lookup-parent-pin").value="";showHome();});
function showFixture(data){const f=data.fixture;el("opposition").textContent=f.opposition;let d='<p><strong>'+date(f.fixture_date)+'</strong></p><p>'+(f.fixture_type==="home"?"Home fixture":"Away fixture")+'</p>';if(f.kick_off_time)d+='<p>Kick-off: '+esc(f.kick_off_time.slice(0,5))+'</p>';if(f.venue)d+='<p>Venue: '+esc(f.venue)+'</p>';const address=f.venue_address||f.venue;if(f.venue_address)d+='<p>'+esc(f.venue_address)+'</p>';if(address)d+='<p><a class="maps-link" href="'+esc(mapsUrl(address))+'" target="_blank" rel="noopener">Open in Google Maps</a></p>';if(f.response_deadline)d+='<p>Responses requested by: '+date(f.response_deadline)+'</p>';el("fixture-details").innerHTML=d;fixtureBox.hidden=false;formBox.hidden=false;}
function addChild(child=null){const cards=childrenBox.querySelectorAll(".child-card");if(cards.length>=20){showFormFeedback("You can add a maximum of 20 children to one response.");return;}clearFormFeedback();const opts=groups.map(g=>'<option value="'+Number(g.id)+'" '+(child&&Number(child.age_group_id)===Number(g.id)?"selected":"")+'>'+esc(g.display_name||g.age_group)+'</option>').join("");const card=document.createElement("div");card.className="child-card";card.dataset.id=child?.id||"";const saved=mode==="edit"&&!!child?.id;const schoolYear=String(child?.school_year||"").match(/[0-9]+/)?.[0]||"";card.innerHTML='<div class="child-card-heading"><h3>Child '+(cards.length+1)+'</h3>'+(saved?"":'<button type="button" class="remove-child" aria-label="Remove this child">Remove</button>')+'</div><div class="form-group"><label>Child&#39;s full name</label><input class="child-name" maxlength="100" required value="'+esc(child?.child_name||"")+'" '+(saved?"readonly":"")+'></div><div class="form-group"><label>Age group</label><select class="child-group" required '+(saved?"disabled":"")+'><option value="">Select age group</option>'+opts+'</select></div><div class="form-group"><label>School year</label><input class="child-year" type="number" inputmode="numeric" min="1" max="13" step="1" placeholder="Optional" value="'+esc(schoolYear)+'" '+(saved?"readonly":"")+'></div><div class="form-group"><label>Availability</label><select class="child-availability"><option value="available" '+(child?.availability==="available"?"selected":"")+'>Available</option><option value="unavailable" '+(child?.availability==="unavailable"?"selected":"")+'>Unavailable</option><option value="unsure" '+(child?.availability==="unsure"?"selected":"")+'>Unsure</option></select></div>';const rm=card.querySelector(".remove-child");if(rm)rm.onclick=()=>{card.remove();[...childrenBox.querySelectorAll(".child-card")].forEach((c,i)=>c.querySelector("h3").textContent="Child "+(i+1));};childrenBox.appendChild(card);}
function newResponse(f){clearFormFeedback();el("submit-button").disabled=false;mode="new";activeFixture=f;activeSubmission=null;fixtureToken=f.fixture_token;groups=f.age_groups||[];if(!fixtureToken){showMessage("This fixture is currently unavailable for online responses.",true);return;}hide();formBox.hidden=false;if(home.classList.contains("fixture-entry"))fixtureBox.hidden=false;el("form-heading").textContent="Player availability";el("form-intro").textContent="Please tell us whether your child or children can attend "+f.opposition+".";el("parent-name-group").hidden=true;el("parent-name").value=parentName;el("add-child").hidden=false;el("add-child").disabled=false;el("submit-button").textContent="Submit availability";childrenBox.innerHTML="";addChild();}
function makeLockToken(){return Array.from(crypto.getRandomValues(new Uint8Array(32))).map(b=>b.toString(16).padStart(2,"0")).join("");}
function stopLockHeartbeat(){if(lockHeartbeatTimer){clearInterval(lockHeartbeatTimer);lockHeartbeatTimer=null;}}
async function releaseParentLock(){
 stopLockHeartbeat();
 const token=activeLockToken;
 activeLockToken=null;
 if(token&&activeSubmission?.edit_token){
  try{await post(URLS.manage,{action:"unlock",edit_token:activeSubmission.edit_token,lock_token:token});}catch(e){console.warn("Unable to release edit lock:",e);}
 }
}
function startLockHeartbeat(){
 stopLockHeartbeat();
 lockHeartbeatTimer=setInterval(async()=>{
  if(!activeLockToken||mode!=="edit"||formBox.hidden)return;
  try{await post(URLS.manage,{action:"heartbeat",edit_token:activeSubmission.edit_token,lock_token:activeLockToken});}
  catch(e){
   stopLockHeartbeat();editLockLost=true;
   el("submit-button").disabled=true;
   showFormFeedback("Your editing session has expired or been taken over. Cancel and reopen your response before making changes.");
  }
 },25000);
}
async function editResponse(f,s){
 clearFormFeedback();
 if(s.edit_locked){showMessage("This response is currently being edited by a parent. Please try again shortly.",true);return;}
 if(!s.edit_token){showMessage("Your private edit link needs refreshing. Please return to Parent Home and select your name again.",true);return;}
 const lockToken=makeLockToken();
 try{await post(URLS.manage,{action:"lock",edit_token:s.edit_token,lock_token:lockToken});}
 catch(e){
  const message=e.message||"Unable to open this response.";
  if(!/currently being edited/i.test(message)){
   await loadHome(parentName);
   showMessage("This response has changed since Parent Home was loaded. Your event list has been refreshed. Please check the response status and try again.",true);
  }else showMessage(message,true);
  return;
 }
 activeLockToken=lockToken;activeSubmission=s;
 try{
  const latest=await post(URLS.manage,{action:"load",edit_token:s.edit_token});
  if(!latest.submission?.can_edit)throw Error("This fixture is no longer open for amendments.");
  activeSubmission={...s,match_availability:latest.submission.children||[]};
 }catch(e){await releaseParentLock();showMessage(e.message||"Unable to load the latest saved response.",true);return;}
 const latestChildren=activeSubmission.match_availability||[];
 if(!latestChildren.length){
  await releaseParentLock();
  await loadHome(parentName);
  showMessage("This response no longer contains any child entries. Your event list has been refreshed; you can submit a new response if needed.",true);
  return;
 }
 editLockLost=false;mode="edit";activeFixture=f;groups=f.age_groups||[];
 hide();formBox.hidden=false;if(home.classList.contains("fixture-entry"))fixtureBox.hidden=false;el("form-heading").textContent="Your response";el("form-intro").textContent="Update availability for "+f.opposition+". Child details cannot be changed here.";el("parent-name-group").hidden=true;el("parent-name").value=parentName;el("add-child").hidden=false;el("add-child").disabled=false;el("submit-button").disabled=false;el("submit-button").textContent="Save changes";childrenBox.innerHTML="";latestChildren.forEach(addChild);
 startLockHeartbeat();
}
el("add-child").addEventListener("click",()=>addChild());
async function returnToEvents(){successModal.hidden=true;await releaseParentLock();mode="new";activeSubmission=null;activeFixture=null;fixtureToken=null;home.classList.remove("fixture-entry");const heading=home.querySelector(".sign-in-card h2");if(heading)heading.textContent="Parent sign in";const intro=home.querySelector(".sign-in-card > p:not(.eyebrow):not(.form-feedback)");if(intro)intro.textContent="View upcoming events and let us know when your child is available.";history.replaceState(null,"",location.pathname);await loadHome(parentName,parentPin);}
el("home-button").addEventListener("click",returnToEvents);
el("cancel-form").addEventListener("click",returnToEvents);
el("success-ok").addEventListener("click",returnToEvents);
el("submission-form").addEventListener("submit",async e=>{e.preventDefault();const cards=[...childrenBox.querySelectorAll(".child-card")];if(!cards.length){showFormFeedback("Please add at least one child.");return;}const list=cards.map(c=>({id:c.dataset.id?Number(c.dataset.id):undefined,child_name:c.querySelector(".child-name").value.trim(),age_group_id:Number(c.querySelector(".child-group").value),school_year:c.querySelector(".child-year").value.trim()||null,availability:c.querySelector(".child-availability").value}));if(list.some(c=>!c.child_name||!c.age_group_id||(c.school_year!==null&&!/^(1[0-3]|[1-9])$/.test(c.school_year)))){showFormFeedback("Please complete each child’s details. School year must be between 1 and 13 if entered.");return;}const b=el("submit-button");b.disabled=true;b.textContent="Saving...";try{if(mode==="edit"){if(editLockLost||!activeLockToken)throw Error("Your editing session has expired. Cancel and reopen your response before saving.");await post(URLS.manage,{action:"update",edit_token:activeSubmission.edit_token,lock_token:activeLockToken,children:list.map(c=>c.id?({id:c.id,availability:c.availability}):c)});stopLockHeartbeat();activeLockToken=null;el("add-child").disabled=true;childrenBox.querySelectorAll("input,select").forEach(x=>x.disabled=true);b.textContent="Saved";b.disabled=true;showSuccessPopup("Your availability has been saved successfully.");}else{await post(URLS.submit,{fixture_token:fixtureToken,parent_name:parentName,parent_pin:parentPin,children:list.map(({id,...c})=>c)});mode="submitted";childrenBox.querySelectorAll("input,select").forEach(x=>x.disabled=true);el("add-child").hidden=true;b.textContent="Submitted";b.disabled=true;showSuccessPopup("Your availability has been submitted successfully.");}}catch(err){showFormFeedback(err.message||"Unable to save your response. Please try again.");b.disabled=false;b.textContent=mode==="edit"?"Save changes":"Submit availability";}});
document.addEventListener("visibilitychange",()=>{
 if(document.visibilityState!=="visible"||mode!=="edit"||!activeLockToken)return;
 post(URLS.manage,{action:"heartbeat",edit_token:activeSubmission.edit_token,lock_token:activeLockToken}).catch(()=>{
  stopLockHeartbeat();editLockLost=true;el("submit-button").disabled=true;
  showFormFeedback("Your editing session has expired. Cancel and reopen your response before making changes.");
 });
});
window.addEventListener("pagehide",()=>{if(activeLockToken&&activeSubmission?.edit_token){const token=activeLockToken;activeLockToken=null;stopLockHeartbeat();fetch(URLS.manage,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"unlock",edit_token:activeSubmission.edit_token,lock_token:token}),keepalive:true}).catch(()=>{});}});
async function start(){if(!fixtureToken){home.classList.remove("fixture-entry");showHome();return;}try{const r=await post(URLS.fixture,{token:fixtureToken});groups=r.age_groups||[];activeFixture={...r.fixture,fixture_token:fixtureToken,age_groups:groups};home.classList.add("fixture-entry");hide();showFixture(r);formBox.hidden=true;home.hidden=false;el("lookup-parent-name").value=parentName;el("lookup-parent-pin").value="";const heading=home.querySelector(".sign-in-card h2");if(heading)heading.textContent="Sign in to respond";const intro=home.querySelector(".sign-in-card > p:not(.eyebrow):not(.form-feedback)");if(intro)intro.textContent="Enter your parent or guardian details to submit or update availability for this fixture.";}catch(e){showMessage(e.message||"Unable to load this fixture.",true);}}
start();