const BASE="https://muxxlewtqhpckhoqeinn.supabase.co/functions/v1/";
const URLS={fixture:BASE+"get_fixture",submit:BASE+"submit_availability",home:BASE+"parent_home",manage:BASE+"manage_submission"};
const params=new URLSearchParams(location.search);let fixtureToken=params.get("fixture"),groups=[],parentName="",mode="new",activeFixture=null,activeSubmission=null,parentFixtures=[];
const el=id=>document.getElementById(id);
const loading=el("loading"),home=el("parent-home"),events=el("events-section"),fixtureBox=el("fixture"),formBox=el("availability-form"),message=el("message"),childrenBox=el("children");
function esc(v){return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));}
function date(v){return new Date(String(v).slice(0,10)+"T12:00:00").toLocaleDateString("en-GB",{weekday:"long",day:"numeric",month:"long",year:"numeric"});}
function hide(){[loading,home,events,fixtureBox,formBox,message].forEach(x=>x.hidden=true);}
function showMessage(t,err=false){hide();message.hidden=false;message.textContent=t;message.className=err?"panel error-message":"panel";}
async function post(url,data){const r=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(data)});const j=await r.json();if(!r.ok||j.success===false)throw Error(j.error||"Unable to complete request.");return j;}
function showHome(){hide();home.hidden=false;el("lookup-parent-name").value=parentName;}
async function loadHome(name){parentName=name.trim();hide();loading.hidden=false;try{const r=await post(URLS.home,{parent_name:parentName});parentFixtures=r.fixtures||[];window.parentCalendarEvents=r.calendar_events||[];renderEvents();}catch(e){showMessage(e.message,true);}}
function renderEvents(){
hide();events.hidden=false;
el("welcome-heading").textContent="Welcome, "+parentName;
el("events-list").innerHTML="";
const calendar=window.parentCalendarEvents||[];
const fixtureById=new Map((parentFixtures||[]).map(f=>[Number(f.id),f]));
const linkedIds=new Set(calendar.map(e=>Number(e.fixture_id||e.fixture?.id)).filter(Boolean));
const cards=[];
calendar.forEach(e=>{
 const f=e.fixture || fixtureById.get(Number(e.fixture_id)) || (e.fixture_token ? {
  id:Number(e.fixture_id || 0),
  fixture_token:e.fixture_token,
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
 const canRespond=e.availability_enabled===true&&f&&f.fixture_token;
 const card=document.createElement("article");card.className="panel event-card calendar-event calendar-"+e.event_type;
 card.innerHTML='<p class="eyebrow">'+esc(type)+'</p><h2>'+esc(title)+'</h2><p><strong>'+date(e.event_date)+'</strong></p>'+
 (e.start_time?'<p>'+esc(e.start_time.slice(0,5))+(e.end_time?' – '+esc(e.end_time.slice(0,5)):'')+'</p>':'')+
 (e.venue?'<p>Venue: '+esc(e.venue)+'</p>':'')+
 '<p class="event-groups">Age groups: '+esc(age||"—")+'</p>'+
 (e.notes?'<p>'+esc(e.notes)+'</p>':'')+
 (e.event_type==="cancelled"?'<p class="response-status status-pending">Cancelled</p>':
  (canRespond?'<p><span class="response-status '+(f.submission?"status-done":"status-pending")+'">'+(f.submission?"Response recorded":"Availability requested")+'</span></p><button type="button">'+(f.submission?"View / update availability":"Submit availability")+'</button>':
  '<p class="event-groups">'+(e.event_type==="holiday"?"No availability required":(e.availability_enabled?"Availability link not yet available":"No availability requested"))+'</p>'));
 if(canRespond)card.querySelector("button").addEventListener("click",()=>f.submission?editResponse(f,f.submission):newResponse(f));
 cards.push(card);
});
(parentFixtures||[]).filter(f=>!linkedIds.has(Number(f.id))).forEach(f=>{
 const sub=f.submission,card=document.createElement("article");card.className="panel event-card";
 const ag=(f.age_groups||[]).map(g=>g.display_name||g.age_group).join(", ");
 card.innerHTML='<p class="eyebrow">'+(f.fixture_type==="home"?"Home fixture":"Away fixture")+'</p><h2>'+esc(f.opposition)+'</h2><p><strong>'+date(f.fixture_date)+'</strong></p>'+
 (f.kick_off_time?'<p>Kick-off: '+esc(f.kick_off_time.slice(0,5))+'</p>':"")+(f.venue?'<p>Venue: '+esc(f.venue)+'</p>':"")+
 '<p class="event-groups">Age groups: '+esc(ag||"—")+'</p><p><span class="response-status '+(sub?"status-done":"status-pending")+'">'+(sub?"Response recorded":"Awaiting your response")+'</span></p><button type="button">'+(sub?"View / update response":"Submit availability")+'</button>';
 card.querySelector("button").addEventListener("click",()=>sub?editResponse(f,sub):newResponse(f));cards.push(card);
});
if(!cards.length){el("events-list").innerHTML='<div class="panel">There are no upcoming events scheduled for the current season.</div>';return;}
cards.forEach(card=>el("events-list").appendChild(card));
}
el("parent-lookup-form").addEventListener("submit",async e=>{e.preventDefault();const b=el("lookup-button");b.disabled=true;b.textContent="Loading...";await loadHome(el("lookup-parent-name").value);b.disabled=false;b.textContent="Continue";});
el("change-name").addEventListener("click",showHome);
function showFixture(data){const f=data.fixture;el("opposition").textContent=f.opposition;let d='<p><strong>'+date(f.fixture_date)+'</strong></p><p>'+(f.fixture_type==="home"?"Home fixture":"Away fixture")+'</p>';if(f.kick_off_time)d+='<p>Kick-off: '+esc(f.kick_off_time.slice(0,5))+'</p>';if(f.venue)d+='<p>Venue: '+esc(f.venue)+'</p>';if(f.venue_address)d+='<p>'+esc(f.venue_address)+'</p>';if(f.response_deadline)d+='<p>Responses requested by: '+date(f.response_deadline)+'</p>';el("fixture-details").innerHTML=d;fixtureBox.hidden=false;formBox.hidden=false;}
function addChild(child=null){const cards=childrenBox.querySelectorAll(".child-card");if(cards.length>=20){alert("You can add a maximum of 20 children.");return;}const opts=groups.map(g=>'<option value="'+Number(g.id)+'" '+(child&&Number(child.age_group_id)===Number(g.id)?"selected":"")+'>'+esc(g.display_name||g.age_group)+'</option>').join("");const card=document.createElement("div");card.className="child-card";card.dataset.id=child?.id||"";const edit=mode==="edit";card.innerHTML='<h3>Child '+(cards.length+1)+'</h3><div class="form-group"><label>Child\'s full name</label><input class="child-name" maxlength="100" required value="'+esc(child?.child_name||"")+'" '+(edit?"readonly":"")+'></div><div class="form-group"><label>Age group</label><select class="child-group" required '+(edit?"disabled":"")+'><option value="">Select age group</option>'+opts+'</select></div><div class="form-group"><label>School year</label><input class="child-year" maxlength="30" required placeholder="e.g. Year 2" value="'+esc(child?.school_year||"")+'" '+(edit?"readonly":"")+'></div><div class="form-group"><label>Availability</label><select class="child-availability"><option value="available" '+(child?.availability==="available"?"selected":"")+'>Available</option><option value="unavailable" '+(child?.availability==="unavailable"?"selected":"")+'>Unavailable</option><option value="unsure" '+(child?.availability==="unsure"?"selected":"")+'>Unsure</option></select></div>'+(edit?"":'<button type="button" class="remove-child">Remove child</button>');const rm=card.querySelector(".remove-child");if(rm)rm.onclick=()=>{card.remove();[...childrenBox.querySelectorAll(".child-card")].forEach((c,i)=>c.querySelector("h3").textContent="Child "+(i+1));};childrenBox.appendChild(card);}
function newResponse(f){mode="new";activeFixture=f;activeSubmission=null;fixtureToken=f.fixture_token;groups=f.age_groups||[];if(!fixtureToken){showMessage("This fixture is currently unavailable for online responses.",true);return;}hide();formBox.hidden=false;el("form-heading").textContent="Player availability";el("form-intro").textContent="Please tell us whether your child or children can attend "+f.opposition+".";el("parent-name-group").hidden=true;el("parent-name").value=parentName;el("add-child").hidden=false;el("submit-button").textContent="Submit availability";childrenBox.innerHTML="";addChild();}
function editResponse(f,s){mode="edit";activeFixture=f;activeSubmission=s;groups=f.age_groups||[];hide();formBox.hidden=false;el("form-heading").textContent="Your response";el("form-intro").textContent="Update availability for "+f.opposition+". Child details cannot be changed here.";el("parent-name-group").hidden=true;el("add-child").hidden=true;el("submit-button").textContent="Save changes";childrenBox.innerHTML="";(s.match_availability||[]).forEach(addChild);if(!s.match_availability?.length)showMessage("No child details were found for this response.",true);}
el("add-child").addEventListener("click",()=>addChild());
el("cancel-form").addEventListener("click",()=>{if(params.get("fixture"))location.href=location.pathname;else renderEvents();});
el("submission-form").addEventListener("submit",async e=>{e.preventDefault();const cards=[...childrenBox.querySelectorAll(".child-card")];if(!cards.length){alert("Please add at least one child.");return;}const list=cards.map(c=>({id:c.dataset.id?Number(c.dataset.id):undefined,child_name:c.querySelector(".child-name").value.trim(),age_group_id:Number(c.querySelector(".child-group").value),school_year:c.querySelector(".child-year").value.trim(),availability:c.querySelector(".child-availability").value}));if(list.some(c=>!c.child_name||!c.age_group_id||!c.school_year)){alert("Please complete all the details for each child.");return;}const b=el("submit-button");b.disabled=true;b.textContent="Saving...";try{if(mode==="edit"){await post(URLS.manage,{action:"update",edit_token:activeSubmission.edit_token,children:list.map(c=>({id:c.id,availability:c.availability}))});await loadHome(parentName);}else{await post(URLS.submit,{fixture_token:fixtureToken,parent_name:parentName||el("parent-name").value.trim(),children:list.map(({id,...c})=>c)});if(params.get("fixture"))showMessage("Availability submitted. Thank you — your response has been recorded.");else await loadHome(parentName);}}catch(err){alert(err.message);b.disabled=false;b.textContent=mode==="edit"?"Save changes":"Submit availability";}});
async function start(){if(!fixtureToken){showHome();return;}try{const r=await post(URLS.fixture,{token:fixtureToken});groups=r.age_groups||[];hide();showFixture(r);mode="new";el("parent-name-group").hidden=false;el("parent-name").value="";el("add-child").hidden=false;childrenBox.innerHTML="";addChild();}catch(e){showMessage(e.message||"Unable to load this fixture.",true);}}
start();