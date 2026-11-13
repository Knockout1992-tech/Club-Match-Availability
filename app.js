const BASE="https://muxxlewtqhpckhoqeinn.supabase.co/functions/v1/";
const URLS={fixture:BASE+"get_fixture",submit:BASE+"submit_availability",home:BASE+"parent_home",manage:BASE+"manage_submission"};
const params=new URLSearchParams(location.search);let fixtureToken=params.get("fixture"),groups=[],parentName="",mode="new",activeFixture=null,activeSubmission=null,parentFixtures=[],parentHomeCards=[],activeEventFilter="all";
let homeRefreshTimer=null,homeRefreshBusy=false,lockHeartbeatTimer=null,activeLockToken=null,editLockLost=false;
const el=id=>document.getElementById(id);
const loading=el("loading"),home=el("parent-home"),events=el("events-section"),fixtureBox=el("fixture"),formBox=el("availability-form"),message=el("message"),childrenBox=el("children");
function esc(v){return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));}
function date(v){return new Date(String(v).slice(0,10)+"T12:00:00").toLocaleDateString("en-GB",{weekday:"long",day:"numeric",month:"long",year:"numeric"});}
function hide(){[loading,home,events,fixtureBox,formBox,message].forEach(x=>x.hidden=true);}
function showFormFeedback(text){const box=el("form-feedback");box.textContent=text;box.hidden=false;}
function clearFormFeedback(){const box=el("form-feedback");box.textContent="";box.hidden=true;}
function showMessage(t,err=false){hide();message.hidden=false;message.textContent=t;message.className=err?"panel error-message":"panel";}
async function post(url,data){const r=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(data)});const j=await r.json();if(!r.ok||j.success===false)throw Error(j.error||"Unable to complete request.");return j;}
function showHome(){hide();home.hidden=false;el("lookup-parent-name").value=parentName;}
function stopHomeRefresh(){if(homeRefreshTimer){clearInterval(homeRefreshTimer);homeRefreshTimer=null;}}
function startHomeRefresh(){
 stopHomeRefresh();
 homeRefreshTimer=setInterval(()=>{
  if(document.visibilityState==="visible"&&!events.hidden&&formBox.hidden&&!homeRefreshBusy) loadHome(parentName,true);
 },60000);
}
async function loadHome(name,silent=false){
 if(homeRefreshBusy)return;
 parentName=name.trim();
 if(!silent){stopHomeRefresh();hide();loading.hidden=false;}
 homeRefreshBusy=true;
 try{
  const previous=parentFixtures||[];
  const r=await post(URLS.home,{parent_name:parentName,refresh:silent});
  parentFixtures=(r.fixtures||[]).map(f=>{
   if(f.submission&&!f.submission.edit_token&&silent){
    const prior=previous.find(x=>Number(x.id)===Number(f.id));
    return {...f,submission:{...f.submission,edit_token:prior?.submission?.edit_token||null}};
   }
   return f;
  });
  window.parentCalendarEvents=r.calendar_events||[];
  renderEvents();
  startHomeRefresh();
 }catch(e){if(!silent)showMessage(e.message,true);else console.warn("Parent Home refresh failed:",e);}
 finally{homeRefreshBusy=false;}
}
function renderEvents(){
hide();events.hidden=false;
el("welcome-heading").textContent="Welcome, "+parentName;
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
 const card=document.createElement("article");const eventClass=e.event_type==="match"?(e.match_location==="away"?"calendar-match-away":"calendar-match-home"):"calendar-"+e.event_type;card.className="panel event-card calendar-event "+eventClass;card.dataset.responseState=canRespond?(f.submission?"responded":"needed"):"none";card.dataset.eventDate=String(e.event_date||"");
 card.innerHTML='<p class="eyebrow">'+esc(type)+'</p><h2>'+esc(title)+'</h2><p><strong>'+date(e.event_date)+'</strong></p>'+
 (e.start_time?'<p>'+esc(e.start_time.slice(0,5))+(e.end_time?' – '+esc(e.end_time.slice(0,5)):'')+'</p>':'')+
 (e.venue?'<p>Venue: '+esc(e.venue)+'</p>':'')+
 (e.event_type==="holiday"?"":'<p class="event-groups">Age groups: '+esc(age||"—")+'</p>')+
 (e.notes?'<p>'+esc(e.notes)+'</p>':'')+
 (e.event_type==="holiday"?"":(e.event_type==="cancelled"?'<p class="response-status status-pending">Cancelled</p>':
  (canRespond?'<p><span class="response-status '+(f.submission?"status-done":"status-pending")+'">'+(f.submission?"Response recorded":"Availability requested")+'</span></p><button type="button">'+(f.submission?"View / update availability":"Submit availability")+'</button>':
  '<p class="event-groups">'+(e.availability_enabled?"Availability link not yet available":"No availability requested")+'</p>')));
 if(canRespond)card.querySelector("button").addEventListener("click",()=>f.submission?editResponse(f,f.submission):newResponse(f));
 cards.push(card);
});
(parentFixtures||[]).filter(f=>!linkedIds.has(Number(f.id))).forEach(f=>{
 const sub=f.submission,card=document.createElement("article");card.className="panel event-card calendar-event "+(f.fixture_type==="away"?"calendar-match-away":"calendar-match-home");card.dataset.responseState=sub?"responded":"needed";card.dataset.eventDate=String(f.fixture_date||"");
 const ag=(f.age_groups||[]).map(g=>g.display_name||g.age_group).join(", ");
 card.innerHTML='<p class="eyebrow">'+(f.fixture_type==="home"?"Home fixture":"Away fixture")+'</p><h2>'+esc(f.opposition)+'</h2><p><strong>'+date(f.fixture_date)+'</strong></p>'+
 (f.kick_off_time?'<p>Kick-off: '+esc(f.kick_off_time.slice(0,5))+'</p>':"")+(f.venue?'<p>Venue: '+esc(f.venue)+'</p>':"")+
 '<p class="event-groups">Age groups: '+esc(ag||"—")+'</p><p><span class="response-status '+(sub?"status-done":"status-pending")+'">'+(sub?"Response recorded":"Awaiting your response")+'</span></p><button type="button">'+(sub?"View / update response":"Submit availability")+'</button>';
 card.querySelector("button").addEventListener("click",()=>sub?editResponse(f,sub):newResponse(f));cards.push(card);
});
cards.sort((a,b)=>Date.parse(a.dataset.eventDate+"T12:00:00")-Date.parse(b.dataset.eventDate+"T12:00:00"));
parentHomeCards=cards;
cards.forEach(card=>el("events-list").appendChild(card));
const needed=cards.filter(c=>c.dataset.responseState==="needed").length;
const responded=cards.filter(c=>c.dataset.responseState==="responded").length;
el("home-summary").innerHTML='<div class="summary-item"><strong>'+cards.length+'</strong><span>Events</span></div><div class="summary-item"><strong>'+needed+'</strong><span>Need response</span></div><div class="summary-item"><strong>'+responded+'</strong><span>Responses recorded</span></div>';
applyEventFilter();
}
function applyEventFilter(){
 let shown=0;
 parentHomeCards.forEach(card=>{const visible=activeEventFilter==="all"||(activeEventFilter==="needed"&&card.dataset.responseState==="needed")||(activeEventFilter==="responded"&&card.dataset.responseState==="responded");card.hidden=!visible;if(visible)shown++;});
 document.querySelectorAll("[data-event-filter]").forEach(button=>{const active=button.dataset.eventFilter===activeEventFilter;button.classList.toggle("active",active);button.setAttribute("aria-pressed",String(active));});
 el("event-count").textContent=shown+" event"+(shown===1?"":"s")+" shown";
 const empty=el("events-empty");empty.hidden=shown!==0;empty.textContent=parentHomeCards.length?"There are no events in this filter.":"There are no upcoming events scheduled for the current season.";
}
document.querySelectorAll("[data-event-filter]").forEach(button=>button.addEventListener("click",()=>{activeEventFilter=button.dataset.eventFilter;applyEventFilter();}));
el("parent-lookup-form").addEventListener("submit",async e=>{e.preventDefault();const b=el("lookup-button");b.disabled=true;b.textContent="Loading...";await loadHome(el("lookup-parent-name").value);b.disabled=false;b.textContent="Continue";});
el("change-name").addEventListener("click",showHome);
function showFixture(data){const f=data.fixture;el("opposition").textContent=f.opposition;let d='<p><strong>'+date(f.fixture_date)+'</strong></p><p>'+(f.fixture_type==="home"?"Home fixture":"Away fixture")+'</p>';if(f.kick_off_time)d+='<p>Kick-off: '+esc(f.kick_off_time.slice(0,5))+'</p>';if(f.venue)d+='<p>Venue: '+esc(f.venue)+'</p>';if(f.venue_address)d+='<p>'+esc(f.venue_address)+'</p>';if(f.response_deadline)d+='<p>Responses requested by: '+date(f.response_deadline)+'</p>';el("fixture-details").innerHTML=d;fixtureBox.hidden=false;formBox.hidden=false;}
function addChild(child=null){const cards=childrenBox.querySelectorAll(".child-card");if(cards.length>=20){showFormFeedback("You can add a maximum of 20 children to one response.");return;}clearFormFeedback();const opts=groups.map(g=>'<option value="'+Number(g.id)+'" '+(child&&Number(child.age_group_id)===Number(g.id)?"selected":"")+'>'+esc(g.display_name||g.age_group)+'</option>').join("");const card=document.createElement("div");card.className="child-card";card.dataset.id=child?.id||"";const edit=mode==="edit";card.innerHTML='<h3>Child '+(cards.length+1)+'</h3><div class="form-group"><label>Child\'s full name</label><input class="child-name" maxlength="100" required value="'+esc(child?.child_name||"")+'" '+(edit?"readonly":"")+'></div><div class="form-group"><label>Age group</label><select class="child-group" required '+(edit?"disabled":"")+'><option value="">Select age group</option>'+opts+'</select></div><div class="form-group"><label>School year</label><input class="child-year" maxlength="30" required placeholder="e.g. Year 2" value="'+esc(child?.school_year||"")+'" '+(edit?"readonly":"")+'></div><div class="form-group"><label>Availability</label><select class="child-availability"><option value="available" '+(child?.availability==="available"?"selected":"")+'>Available</option><option value="unavailable" '+(child?.availability==="unavailable"?"selected":"")+'>Unavailable</option><option value="unsure" '+(child?.availability==="unsure"?"selected":"")+'>Unsure</option></select></div>'+(edit?"":'<button type="button" class="remove-child">Remove child</button>');const rm=card.querySelector(".remove-child");if(rm)rm.onclick=()=>{card.remove();[...childrenBox.querySelectorAll(".child-card")].forEach((c,i)=>c.querySelector("h3").textContent="Child "+(i+1));};childrenBox.appendChild(card);}
function newResponse(f){clearFormFeedback();el("submit-button").disabled=false;mode="new";activeFixture=f;activeSubmission=null;fixtureToken=f.fixture_token;groups=f.age_groups||[];if(!fixtureToken){showMessage("This fixture is currently unavailable for online responses.",true);return;}hide();formBox.hidden=false;el("form-heading").textContent="Player availability";el("form-intro").textContent="Please tell us whether your child or children can attend "+f.opposition+".";el("parent-name-group").hidden=true;el("parent-name").value=parentName;el("add-child").hidden=false;el("submit-button").textContent="Submit availability";childrenBox.innerHTML="";addChild();}
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
 catch(e){showMessage(e.message||"This response is currently being edited elsewhere. Please try again shortly.",true);return;}
 activeLockToken=lockToken;activeSubmission=s;
 try{
  const latest=await post(URLS.manage,{action:"load",edit_token:s.edit_token});
  if(!latest.submission?.can_edit)throw Error("This fixture is no longer open for amendments.");
  activeSubmission={...s,match_availability:latest.submission.children||[]};
 }catch(e){await releaseParentLock();showMessage(e.message||"Unable to load the latest saved response.",true);return;}
 editLockLost=false;mode="edit";activeFixture=f;groups=f.age_groups||[];
 hide();formBox.hidden=false;el("form-heading").textContent="Your response";el("form-intro").textContent="Update availability for "+f.opposition+". Child details cannot be changed here.";el("parent-name-group").hidden=true;el("parent-name").value=parentName;el("add-child").hidden=true;el("submit-button").disabled=false;el("submit-button").textContent="Save changes";childrenBox.innerHTML="";(s.match_availability||[]).forEach(addChild);
 if(!s.match_availability?.length){await releaseParentLock();showMessage("No child details were found for this response.",true);return;}
 startLockHeartbeat();
}
el("add-child").addEventListener("click",()=>addChild());
el("cancel-form").addEventListener("click",async()=>{await releaseParentLock();if(params.get("fixture"))location.href=location.pathname;else{mode="new";renderEvents();startHomeRefresh();}});
el("submission-form").addEventListener("submit",async e=>{e.preventDefault();const cards=[...childrenBox.querySelectorAll(".child-card")];if(!cards.length){showFormFeedback("Please add at least one child.");return;}const list=cards.map(c=>({id:c.dataset.id?Number(c.dataset.id):undefined,child_name:c.querySelector(".child-name").value.trim(),age_group_id:Number(c.querySelector(".child-group").value),school_year:c.querySelector(".child-year").value.trim(),availability:c.querySelector(".child-availability").value}));if(list.some(c=>!c.child_name||!c.age_group_id||!c.school_year)){showFormFeedback("Please complete all the details for each child.");return;}const b=el("submit-button");b.disabled=true;b.textContent="Saving...";try{if(mode==="edit"){if(editLockLost||!activeLockToken)throw Error("Your editing session has expired. Cancel and reopen your response before saving.");await post(URLS.manage,{action:"update",edit_token:activeSubmission.edit_token,lock_token:activeLockToken,children:list.map(c=>({id:c.id,availability:c.availability}))});stopLockHeartbeat();activeLockToken=null;mode="new";await loadHome(parentName);}else{await post(URLS.submit,{fixture_token:fixtureToken,parent_name:parentName||el("parent-name").value.trim(),children:list.map(({id,...c})=>c)});if(params.get("fixture"))showMessage("Availability submitted. Thank you — your response has been recorded.");else await loadHome(parentName);}}catch(err){showFormFeedback(err.message||"Unable to save your response. Please try again.");b.disabled=false;b.textContent=mode==="edit"?"Save changes":"Submit availability";}});
document.addEventListener("visibilitychange",()=>{
 if(document.visibilityState!=="visible")return;
 if(mode==="edit"&&activeLockToken){
  post(URLS.manage,{action:"heartbeat",edit_token:activeSubmission.edit_token,lock_token:activeLockToken}).catch(()=>{
   stopLockHeartbeat();editLockLost=true;el("submit-button").disabled=true;
   showFormFeedback("Your editing session has expired. Cancel and reopen your response before making changes.");
  });
 }else if(!events.hidden&&formBox.hidden)loadHome(parentName,true);
});
window.addEventListener("pagehide",()=>{if(activeLockToken&&activeSubmission?.edit_token){const token=activeLockToken;activeLockToken=null;stopLockHeartbeat();fetch(URLS.manage,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"unlock",edit_token:activeSubmission.edit_token,lock_token:token}),keepalive:true}).catch(()=>{});}});
async function start(){if(!fixtureToken){showHome();return;}try{const r=await post(URLS.fixture,{token:fixtureToken});groups=r.age_groups||[];hide();showFixture(r);mode="new";el("parent-name-group").hidden=false;el("parent-name").value="";el("add-child").hidden=false;childrenBox.innerHTML="";addChild();}catch(e){showMessage(e.message||"Unable to load this fixture.",true);}}
start();