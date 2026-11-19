/* =========================================================
   SEASON PLANNER — ADMIN
   Protected through Senior-PIN-verified Supabase RPCs.
   ========================================================= */

let seasonPlannerData = null;
let seasonPlannerAgeFilter = "all";
let seasonPlannerShowPast = false;
let seasonPlannerShowCancelled = false;
let seasonPlannerPage = "home";
let seasonPlannerEditingEventId = null;
let seasonPlannerAvailabilityByEvent = new Map();
let seasonPlannerAvailabilityData = null;
let seasonPlannerAvailabilityTimer = null;
let seasonPlannerAvailabilityBusy = false;
let seasonPlannerCoachAvailableByFixture = new Map();
let seasonPlannerCoachCountTimer = null;
let seasonPlannerCoachCountBusy = false;

function spEsc(value) {
    return String(value ?? "").replace(/[&<>"']/g, c => ({
        "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"
    })[c]);
}
function spDate(value) {
    if (!value) return "";
    const p = String(value).slice(0,10).split("-");
    return p.length === 3 ? p[2] + "/" + p[1] + "/" + p[0] : value;
}
function spTime(value) { return value ? String(value).slice(0,5) : ""; }
function spMapsUrl(address) {
    const value=String(address||"").trim();
    if (!value) return "";
    // Venue names are normally entered before the first comma.
    const searchValue=value.split(",")[0].trim() || value;
    return "https://maps.google.com/?q="+encodeURIComponent(searchValue);
}
async function shareSeasonPlannerEventWhatsApp(eventId) {
    const event=(seasonPlannerData?.events||[]).find(x=>Number(x.id)===Number(eventId));
    if(!event) return appAlert("This event could not be found.","Share unavailable","warning");
    const date=new Date(event.event_date+"T12:00:00").toLocaleDateString("en-GB",{
        weekday:"short",day:"numeric",month:"short"
    });
    const venue=String(event.venue||"").trim();
    const notes=String(event.notes||"").trim();
    const fixtureId=Number(seasonPlannerAvailabilityByEvent.get(Number(eventId))||0);
    let availabilityLink=MATCH_AVAILABILITY_URL;
    if(fixtureId) {
        try {
            const result=await matchAdminCall("admin_fixtures",{action:"detail",fixture_id:fixtureId});
            const token=result.fixtures?.[0]?.parent_token;
            if(token) availabilityLink=MATCH_AVAILABILITY_URL+"?fixture="+encodeURIComponent(token);
        } catch(error) {
            console.warn("Unable to retrieve direct parent link for WhatsApp share:",error);
        }
    }
    const lines=[
        "🏉 "+event.title+" – "+date,
        [spTime(event.start_time),spTime(event.end_time)].filter(Boolean).join(" – "),
        venue ? "📍 "+venue : "",
        venue ? "🗺️ "+spMapsUrl(venue) : "",
        notes ? "📝 "+notes : "",
        "Availability: "+availabilityLink
    ].filter(Boolean);
    window.location.href="https://wa.me/?text="+encodeURIComponent(lines.join("\n"));
}
function spToday() { return getTodayKey(); }
function spDay(value) {
    return ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"][Number(value)] || "";
}
function spType(value) {
    return ({training:"Training",match:"Match",holiday:"Holiday",cancelled:"Cancelled",other:"Other event"})[value] || value;
}
function spSenior() {
    if (currentRole === "senior" && currentSeniorPIN) return true;
    appAlert("Only Admin can access the Season Planner.","Access denied","danger");
    return false;
}
async function spRPC(name,args) {
    const {data,error} = await supabaseClient.rpc(name,args);
    if (error) { console.error("Season Planner:",name,error); throw error; }
    return data;
}

function spCoachOrSenior() {
    if (currentRole === "senior" && currentSeniorPIN) return true;
    if (currentRole === "coach" && currentAccessPIN && Array.isArray(selectedAgeGroups) && selectedAgeGroups.length) return true;
    appAlert("Please log in again and select your age groups.", "Access denied", "danger");
    return false;
}

async function showCoachSeasonPlanner() {
    if (!spCoachOrSenior()) return;
    seasonPlannerPage = "calendar";
    seasonPlannerAgeFilter = "all";
    renderShell('<div class="card season-planner-shell"><button id="spHeaderBack" class="back-button" onclick="showCoachDashboard()">← Back to Dashboard</button><h2 id="spPageTitle">Fixtures &amp; Events</h2><div id="spPageDescription" class="subtitle">Events for '+spEsc(selectedAgeGroups.join(" + "))+' and club-wide events.</div><div id="seasonPlannerContent">Loading...</div></div>');
    await loadCoachSeasonPlanner();
}

async function loadCoachSeasonPlanner() {
    if (!spCoachOrSenior()) return;
    const root = document.getElementById("seasonPlannerContent");
    if (!root) return;
    root.innerHTML = "Loading...";
    try {
        const { data, error } = await supabaseClient.rpc("get_coach_season_planner", {
            supplied_code: currentAccessPIN,
            requested_age_groups: [...(selectedAgeGroups || [])]
        });
        if (error) throw error;
        seasonPlannerData = data;
        if (!seasonPlannerData?.season) throw new Error("Unable to load the calendar for your selected age groups.");
        seasonPlannerAvailabilityByEvent = new Map();
        (seasonPlannerData.events || []).forEach(event => { if (event.linked_fixture_id) seasonPlannerAvailabilityByEvent.set(Number(event.id), Number(event.linked_fixture_id)); });
        seasonPlannerPage = "calendar";
        renderSeasonPlanner();
        spStartCoachAvailabilityCounts();
    } catch (e) {
        root.innerHTML = '<div class="info-box">Unable to load the Coach Calendar.<br>' + spEsc(e.message || "Please try again.") + '</div><button class="primary-button" onclick="loadCoachSeasonPlanner()">Retry</button>';
    }
}

async function showSeasonPlanner() {
    if (!spSenior()) return;
    seasonPlannerPage = "home";
    renderShell(`
        <div class="card season-planner-shell">
            <button id="spHeaderBack" class="back-button" onclick="showSeniorDashboard()">← Back</button>
            <h2 id="spPageTitle">Season Planner</h2>
            <div id="spPageDescription" class="subtitle">Plan recurring training, matches, holidays and other age-group events across the full season.</div>
            <div id="seasonPlannerContent">Loading...</div>
        </div>`);
    await loadSeasonPlanner();
}

// Explicitly expose the entry point used by the Senior Dashboard's inline button.
window.showSeasonPlanner = showSeasonPlanner;

async function loadSeasonPlanner(requestedSeasonId = null, skipBackgroundSync = false) {
    if (!spSenior()) return;
    const root = document.getElementById("seasonPlannerContent");
    if (!root) return;
    root.innerHTML = "Loading...";
    try {
        seasonPlannerData = await spRPC("get_season_planner",{
            supplied_code:currentSeniorPIN, requested_season_id:requestedSeasonId
        });
        if (!seasonPlannerData || !seasonPlannerData.season) throw new Error("Unable to load the current season. Check Admin access and the current season setting.");
        seasonPlannerAvailabilityByEvent = new Map();
        (seasonPlannerData.events || []).forEach(event => {
            if (event.linked_fixture_id) {
                seasonPlannerAvailabilityByEvent.set(Number(event.id), Number(event.linked_fixture_id));
            }
        });
        seasonPlannerAgeFilter = "all";
        renderSeasonPlanner();

        // Only synchronise missing links, and never make the initial planner render wait for it.
        const needsSync = (seasonPlannerData.events || []).some(event =>
            event.event_date >= spToday() &&
            event.availability_enabled === true &&
            !["holiday", "cancelled"].includes(event.event_type) &&
            !event.linked_fixture_id
        );
        if (!skipBackgroundSync && needsSync && typeof matchAdminCall === "function") {
            matchAdminCall("parent_home", { action: "sync_calendar" })
                .then(result => {
                    (result.calendar_links || []).forEach(link => {
                        (link.event_ids || []).forEach(id =>
                            seasonPlannerAvailabilityByEvent.set(Number(id), Number(link.fixture_id))
                        );
                    });
                    if (seasonPlannerPage === "calendar") renderSeasonPlanner();
                })
                .catch(error => console.warn("Background calendar availability sync failed:", error));
        }
    } catch(e) {
        root.innerHTML = `<div class="info-box">Unable to load Season Planner.<br>${spEsc(e.message)}</div><button class="primary-button" onclick="loadSeasonPlanner()">Retry</button>`;
    }
}

function spSetPage(page) {
    if (page !== "availability-review") spStopAvailabilityRefresh();
    if (page !== "calendar") spStopCoachAvailabilityCounts();
    seasonPlannerPage = page;
    renderSeasonPlanner();
    if (page === "calendar" && currentRole === "coach") spStartCoachAvailabilityCounts();
}
function spBackHome() {
    return "";
}
function spAgeNames(x) {
    if (x.applies_to_all) return "All age groups";
    const names=(x.age_group_ids||[]).map(g=>g.display_name||g.age_group).filter(Boolean);
    return names.length ? names.join(", ") : (x.display_name||x.age_group||"Age group");
}
function spEventCategory(value, matchLocation) {
    if (value === "match") return matchLocation === "away" ? "match-away" : "match-home";
    return ({training:"training",holiday:"holiday",other:"event",cancelled:"cancelled"})[value] || "event";
}
function spTypeBadge(value, matchLocation) {
    const category=spEventCategory(value, matchLocation);
    return '<span class="sp-type-badge sp-type-' + category + '">' + spEsc(spType(value)) + '</span>';
}
function spEventGroupKey(event){return [event.event_date,event.title,event.event_type,event.event_type==="match"?(event.match_location||"home"):(event.match_location||""),spTime(event.start_time),spTime(event.end_time),event.venue||"",event.notes||"",event.availability_enabled===false?"off":"on"].join("|");}
function spGroupUpcomingEvents(events){const grouped=new Map();events.forEach(event=>{const k=spEventGroupKey(event);if(!grouped.has(k))grouped.set(k,[]);grouped.get(k).push(event);});const allIds=(seasonPlannerData.age_groups||[]).map(g=>String(g.id)).sort();return [...grouped.values()].map(items=>{const ids=[...new Set(items.map(e=>String(e.age_group_id)))].sort(),names=ids.map(id=>{const g=(seasonPlannerData.age_groups||[]).find(x=>String(x.id)===id);return g?(g.display_name||g.age_group):"";}).filter(Boolean),all=allIds.length>0&&ids.length===allIds.length&&ids.every((id,i)=>id===allIds[i]),notes=[...new Set(items.map(e=>(e.notes||"").trim()).filter(Boolean))];return {items,event:items[0],ageLabel:all?"All age groups":names.join(" · "),notes:notes.length===1?notes[0]:""};}).sort((a,b)=>a.event.event_date.localeCompare(b.event.event_date)||String(a.event.start_time||"").localeCompare(String(b.event.start_time||"")));}
function spGetCalendarGroups(options={}) {
    const upcomingOnly=options.upcomingOnly===true;
    const filtered=seasonPlannerData.events.filter(x=>
        (seasonPlannerAgeFilter==="all"||String(x.age_group_id)===String(seasonPlannerAgeFilter)) &&
        (upcomingOnly ? x.event_date>=spToday() && x.event_type!=="cancelled" :
            (seasonPlannerShowPast||x.event_date>=spToday()) &&
            (seasonPlannerShowCancelled||x.event_type!=="cancelled"))
    );
    return spGroupCalendarEvents(filtered);
}
function spRenderHome() {
    const s=seasonPlannerData.season;
    const upcomingGroups=spGetCalendarGroups({upcomingOnly:true});
    const nextDate=upcomingGroups.length?upcomingGroups[0].event.event_date:null;
    const next=nextDate?upcomingGroups.filter(g=>g.event.event_date===nextDate):[];
    let html='<section class="sp-season-summary"><div class="sp-eyebrow">CURRENT SEASON</div>'+
        '<div class="sp-season-name">'+spEsc(s.season_name)+'</div><div class="sp-season-dates">'+
        (s.start_date&&s.end_date?spDate(s.start_date)+' – '+spDate(s.end_date):'Season dates not set')+
        '</div></section>';
    html+='<section class="sp-section sp-next-section"><div class="sp-section-heading"><h3>Up Next</h3>'+
        (nextDate?'<span class="sp-date-chip">'+spDate(nextDate)+'</span>':'')+'</div>';
    if(next.length) {
        html+='<div class="sp-upcoming-list">'+next.map(g=>{
            const e=g.event;
            return '<div class="sp-upcoming-row sp-upcoming-'+spEventCategory(e.event_type,e.match_location)+'">'+
                '<div class="sp-event-content"><div class="sp-event-title">'+spEsc(e.title)+' '+spTypeBadge(e.event_type,e.match_location)+'</div>'+
                '<div class="sp-event-meta">'+spEsc(g.ageLabel)+(e.start_time?' · '+spTime(e.start_time):'')+
                (e.venue?' · '+spEsc(e.venue):'')+'</div>'+
                (g.notes?'<div class="sp-event-meta">'+spEsc(g.notes)+'</div>':'')+'</div></div>';
        }).join('')+'</div>';
    } else html+='<div class="sp-empty">No upcoming events have been scheduled.</div>';
    html+='</section>'+
        '<button type="button" class="sp-season-calendar-launch" onclick="spSetPage(\'calendar\')">'+
        '<span class="sp-season-calendar-icon"><svg viewBox="0 0 48 48" aria-hidden="true"><rect x="6" y="10" width="36" height="32" rx="5" fill="none" stroke="currentColor" stroke-width="2.5"/><path d="M6 19h36M16 6v9M32 6v9" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/><path d="M15 26h5v5h-5zM24 26h5v5h-5zM33 26h3v5h-3zM15 34h5v4h-5zM24 34h5v4h-5z" fill="currentColor" opacity=".78"/></svg></span><span class="sp-season-calendar-copy"><strong>Season Calendar</strong>'+
        '<small>View and manage the full season schedule</small></span><span class="sp-season-calendar-arrow">›</span></button>'+
        '<section class="sp-section sp-admin-support"><div class="sp-section-heading"><h3>Admin support</h3><span class="sp-field-hint">Planning tools</span></div><div class="sp-menu-list">'+
        '<button class="sp-menu-item" onclick="spSetPage(\'schedules\')"><span><strong>Recurring Schedules</strong><small>Manage regular training and match days</small></span><b>›</b></button>'+
        '<button class="sp-menu-item" onclick="spSetPage(\'holidays\')"><span><strong>Holidays & Breaks</strong><small>Manage club closures and time off</small></span><b>›</b></button>'+
        '<button class="sp-menu-item" onclick="spSetPage(\'setup\')"><span><strong>Season Setup</strong><small>Season dates and next season planning</small></span><b>›</b></button>'+
        '</div></section>';
    return html;
}
function spRenderSchedules() {
    const s=seasonPlannerData.season, groups=seasonPlannerData.age_groups;
    const checks=groups.map(g=>'<label class="sp-group-choice"><input type="checkbox" class="spScheduleGroup" value="'+g.id+'"> '+spEsc(g.display_name||g.age_group)+'</label>').join("");
    const schedules=seasonPlannerData.schedules.map(x=>'<article class="sp-management-row"><div class="sp-management-main"><strong>'+spEsc(x.schedule_name)+'</strong><div class="sp-event-meta">'+spEsc(spAgeNames(x))+'</div><div class="sp-event-meta">'+spDay(x.weekday)+' · '+spTime(x.start_time)+'–'+spTime(x.end_time)+' · Every '+x.recurrence_interval_weeks+' week(s)</div><div class="sp-event-meta">'+spDate(x.schedule_start_date)+' – '+spDate(x.schedule_end_date)+(x.venue?' · '+spEsc(x.venue):'')+'</div></div><div>'+(x.active?'<button class="secondary-button" onclick="endSeasonPlannerSchedule('+x.id+')">End schedule</button>':'<span class="sp-locked-tag">Ended</span>')+'</div></article>').join("")||'<div class="sp-empty">No recurring schedules yet.</div>';
    let h='<div class="sp-page-intro">Build regular training or match patterns. Each schedule can cover all age groups or a selected group of teams.</div>';
    if(!s.start_date||!s.end_date) h+='<div class="sp-empty">Set the season dates in Season Setup before creating schedules.</div>';
    h+='<section class="sp-form-panel"><h3>Create a schedule</h3><div class="form-group"><label for="spScheduleScope">Applies to</label><select id="spScheduleScope" onchange="document.getElementById(\'spScheduleGroups\').style.display=this.value===\'selected\'?\'block\':\'none\'"><option value="all">All age groups</option><option value="selected">Choose age groups</option></select></div>';
    h+='<div id="spScheduleGroups" class="sp-group-picker" style="display:none;"><div class="sp-field-hint">Select one or more age groups</div>'+checks+'</div>';
    h+='<div class="form-group"><label for="spScheduleName">Schedule name</label><input id="spScheduleName" maxlength="80" placeholder="e.g. Sunday training"></div>';
    h+='<div class="form-group"><label for="spWeekday">Day</label><select id="spWeekday"><option value="0">Sunday</option><option value="1">Monday</option><option value="2">Tuesday</option><option value="3">Wednesday</option><option value="4">Thursday</option><option value="5">Friday</option><option value="6">Saturday</option></select></div>';
    h+='<div class="form-group"><label for="spFrequency">Frequency</label><select id="spFrequency"><option value="1">Every week</option><option value="2">Every 2 weeks</option><option value="3">Every 3 weeks</option><option value="4">Every 4 weeks</option></select></div>';
    h+='<div class="sp-form-grid"><div class="form-group"><label for="spScheduleStart">Starts</label><input id="spScheduleStart" type="date" min="'+(s.start_date||'')+'" max="'+(s.end_date||'')+'" value="'+(s.start_date||'')+'"></div><div class="form-group"><label for="spScheduleEnd">Ends</label><input id="spScheduleEnd" type="date" min="'+(s.start_date||'')+'" max="'+(s.end_date||'')+'" value="'+(s.end_date||'')+'"></div></div>';
    h+='<div class="sp-form-grid"><div class="form-group"><label for="spStartTime">Start time</label><input id="spStartTime" type="time" value="10:00"></div><div class="form-group"><label for="spEndTime">End time</label><input id="spEndTime" type="time" value="11:00"></div></div>';
    h+='<div class="form-group"><label for="spVenue">Location</label><input id="spVenue" maxlength="160" placeholder="e.g. Club grounds"></div><button class="primary-button" onclick="createSeasonPlannerSchedule()">Create schedule</button></section><section class="sp-existing-section"><h3>Existing schedules</h3>'+schedules+'</section>';
    return h;
}
function spRenderHolidays() {
    const s=seasonPlannerData.season, groups=seasonPlannerData.age_groups;
    const opts=groups.map(g=>'<option value="'+g.id+'">'+spEsc(g.display_name||g.age_group)+'</option>').join("");
    const breaks=seasonPlannerData.breaks.map(x=>'<article class="sp-management-row sp-calendar-holiday"><div class="sp-management-main"><strong>'+spEsc(x.label)+'</strong> '+spTypeBadge("holiday")+'<div class="sp-event-meta">'+(x.age_group?spEsc(x.display_name||x.age_group):"All age groups")+'</div><div class="sp-event-meta">'+spDate(x.start_date)+' – '+spDate(x.end_date)+'</div></div><button class="secondary-button" onclick="deleteSeasonPlannerBreak('+x.id+')">Remove</button></article>').join("")||'<div class="sp-empty">No holidays or breaks added.</div>';
    let h='<div class="sp-page-intro">Add club closures and age-group breaks. Matching future training sessions will be marked as holidays; past sessions stay unchanged.</div>';
    h+='<section class="sp-form-panel"><h3>Add a holiday or break</h3><div class="form-group"><label for="spBreakGroup">Applies to</label><select id="spBreakGroup"><option value="">All age groups</option>'+opts+'</select></div>';
    h+='<div class="form-group"><label for="spBreakName">Name</label><input id="spBreakName" maxlength="80" placeholder="e.g. Christmas break"></div>';
    h+='<div class="sp-form-grid"><div class="form-group"><label for="spBreakStart">From</label><input id="spBreakStart" type="date" min="'+(s.start_date||'')+'" max="'+(s.end_date||'')+'"></div><div class="form-group"><label for="spBreakEnd">To</label><input id="spBreakEnd" type="date" min="'+(s.start_date||'')+'" max="'+(s.end_date||'')+'"></div></div><button class="primary-button" onclick="createSeasonPlannerBreak()">Add break</button></section>';
    h+='<section class="sp-existing-section"><h3>Planned holidays</h3>'+breaks+'</section>';
    return h;
}
function spCalendarDateRange(startDate,endDate){
    const format=value=>new Date(value+"T12:00:00").toLocaleDateString("en-GB",{day:"numeric",month:"short"});
    const start=format(startDate),end=format(endDate);
    return startDate===endDate?start+" "+String(startDate).slice(0,4):start+" – "+end+" "+String(endDate).slice(0,4);
}
function spGroupCalendarEvents(events){
    const grouped=new Map();
    events.forEach(event=>{const k=spEventGroupKey(event);if(!grouped.has(k))grouped.set(k,[]);grouped.get(k).push(event);});
    const allIds=(seasonPlannerData.age_groups||[]).map(g=>String(g.id)).sort();
    let groups=[...grouped.values()].map(items=>{
        const ids=[...new Set(items.map(e=>String(e.age_group_id)))].sort();
        const names=ids.map(id=>{const g=(seasonPlannerData.age_groups||[]).find(x=>String(x.id)===id);return g?(g.display_name||g.age_group):"";}).filter(Boolean);
        const all=allIds.length>0&&ids.length===allIds.length&&ids.every((id,i)=>id===allIds[i]);
        const notes=[...new Set(items.map(e=>(e.notes||"").trim()).filter(Boolean))];
        return {items,event:items[0],ageLabel:all?"All age groups":names.join(" · "),multiple:items.length>1,notes:notes.length===1?notes[0]:""};
    });
    return groups.sort((a,b)=>a.event.event_date.localeCompare(b.event.event_date)||String(a.event.start_time||"").localeCompare(String(b.event.start_time||"")));
}
function spRenderCalendar(){
    const groups=seasonPlannerData.age_groups,grouped=spGetCalendarGroups();
    const rows=grouped.map(g=>{
        const x=g.event,past=x.event_date<spToday(),isHoliday=x.event_type==="holiday",time=isHoliday?"":(x.start_time?spTime(x.start_time)+(x.end_time?"–"+spTime(x.end_time):""):"Time not set");
        const fixtureIds=[...new Set((g.items||[]).map(item=>seasonPlannerAvailabilityByEvent.get(Number(item.id))).filter(Boolean).map(Number))];
        const fixtureId=fixtureIds[0]||null;
        const availableCount=fixtureIds.reduce((total,id)=>total+(seasonPlannerCoachAvailableByFixture.has(id)?seasonPlannerCoachAvailableByFixture.get(id):0),0);
        const hasAvailableCount=currentRole==="coach"&&fixtureIds.length>0&&fixtureIds.every(id=>seasonPlannerCoachAvailableByFixture.has(id));
        const availabilityOn=x.availability_enabled!==false&&!["holiday","cancelled"].includes(x.event_type);
        const mapLink=spMapsUrl(x.venue);
        if(past){
            return '<div data-event-ids="'+(g.items||[]).map(item=>Number(item.id)).join(" ")+'" class="sp-calendar-row sp-calendar-'+spEventCategory(x.event_type,x.match_location)+' sp-calendar-past"><div class="sp-calendar-main"><div class="sp-calendar-date">'+(isHoliday&&g.holidayDates&&g.holidayDates.length>1?spCalendarDateRange(g.holidayDates[0],g.holidayDates[g.holidayDates.length-1]):spDate(x.event_date))+'</div><strong>'+spEsc(x.title)+'</strong> '+spTypeBadge(x.event_type,x.match_location)+' <span class="sp-locked-tag">Past</span></div></div>';
        }
        const edit=x.event_date>spToday()?'<button class="secondary-button" onclick="editSeasonPlannerEvent('+x.id+')">Change</button>':'';
        const holidayChangeButtons=isHoliday?[...new Set((g.items||[]).map(item=>item.event_date))].map(date=>{const item=(g.items||[]).find(entry=>entry.event_date===date);return '<button class="secondary-button" onclick="editSeasonPlannerEvent('+item.id+')">Change '+spDate(date).slice(0,5)+'</button>';}).join(""):edit;
        const actions='<div class="sp-calendar-actions">'+(isHoliday?holidayChangeButtons:(fixtureId?'<button class="secondary-button" onclick="spReviewAvailability('+fixtureId+')">Review availability</button><button class="secondary-button" onclick="copyMatchFixtureLink('+fixtureId+')">Copy Fixture Link</button>':(availabilityOn?'<span class="sp-field-hint">Availability link is being prepared for parents.</span>':''))+'<button class="secondary-button" onclick="shareSeasonPlannerEventWhatsApp('+x.id+')">Share via WhatsApp</button>'+edit)+'</div>';
        return '<div data-event-ids="'+(g.items||[]).map(item=>Number(item.id)).join(" ")+'" class="sp-calendar-row sp-calendar-'+spEventCategory(x.event_type,x.match_location)+'"><div class="sp-calendar-main"><div class="sp-calendar-date">'+(isHoliday&&g.holidayDates&&g.holidayDates.length>1?spCalendarDateRange(g.holidayDates[0],g.holidayDates[g.holidayDates.length-1]):spDate(x.event_date))+'</div><strong>'+spEsc(x.title)+'</strong> '+spTypeBadge(x.event_type,x.match_location)+'<div class="sp-event-meta">'+spEsc(g.ageLabel)+(time?' · '+spEsc(time):'')+'</div>'+(x.venue?'<div class="sp-event-meta">Venue: '+spEsc(x.venue)+(mapLink?' · <a href="'+spEsc(mapLink)+'" target="_blank" rel="noopener">Open in Google Maps</a>':'')+'</div>':'')+(g.notes?'<div class="sp-event-meta">'+spEsc(g.notes)+'</div>':'')+(currentRole==="coach"&&availabilityOn&&fixtureIds.length?'<div class="sp-available-count">'+(hasAvailableCount?'<strong>'+availableCount+' Available</strong>':'<span>Loading availability…</span>')+'</div>':'')+actions+'</div></div>';
    }).join("")||'<div class="sp-empty">No events found for these filters.</div>';
    const addEventButton = "<button class=\"primary-button\" onclick=\"spSetPage('new-event')\">+ Add Event / Fixture</button>";
    const toolbar=currentRole==="coach"
        ? '<div class="sp-calendar-toolbar"><div class="sp-field-hint">Showing '+spEsc((selectedAgeGroups||[]).join(" + "))+" and club-wide events</div><button class=\"secondary-button\" onclick=\"copyCentralMatchParentLink()\">Copy Parent Home Link</button>"+addEventButton+"</div>"
        : '<div class="sp-calendar-toolbar"><div class="form-group"><label for="spFilter">Age group</label><select id="spFilter" onchange="filterSeasonPlannerCalendar(this.value)"><option value="all">All age groups</option>'+groups.map(g=>'<option value="'+g.id+'">'+spEsc(g.display_name||g.age_group)+'</option>').join("")+'</select></div><button class="secondary-button" onclick="copyCentralMatchParentLink()">Copy Parent Home Link</button>'+addEventButton+'</div>';
    return toolbar+'<div class="sp-calendar-filter-row"><label><input type="checkbox" '+(seasonPlannerShowPast?'checked':'')+' onchange="toggleSeasonPlannerPast(this.checked)"> Show past sessions</label><label><input type="checkbox" '+(seasonPlannerShowCancelled?'checked':'')+' onchange="toggleSeasonPlannerCancelled(this.checked)"> Show cancelled events</label></div>'+rows;
}

function spStopCoachAvailabilityCounts() {
    if (seasonPlannerCoachCountTimer) clearInterval(seasonPlannerCoachCountTimer);
    seasonPlannerCoachCountTimer = null;
}
async function spRefreshCoachAvailabilityCounts() {
    if (currentRole !== "coach" || seasonPlannerPage !== "calendar" || seasonPlannerCoachCountBusy) return;
    const fixtureIds=[...new Set((seasonPlannerData?.events||[])
        .filter(event=>event.event_date>=spToday()&&event.availability_enabled!==false&&!["holiday","cancelled"].includes(event.event_type))
        .map(event=>seasonPlannerAvailabilityByEvent.get(Number(event.id))).filter(Boolean).map(Number))];
    if (!fixtureIds.length) return;
    seasonPlannerCoachCountBusy=true;
    try {
        const results=await Promise.all(fixtureIds.map(async id=>{
            const result=await matchAdminCall("admin_fixtures",{action:"detail",fixture_id:id});
            const fixture=result.fixtures?.[0];
            if(!fixture) throw new Error("Availability details unavailable for fixture "+id);
            const total=(fixture.age_groups||[]).reduce((sum,group)=>sum+Number(group.available||0),0);
            return [id,total];
        }));
        results.forEach(([id,total])=>seasonPlannerCoachAvailableByFixture.set(id,total));
        if(seasonPlannerPage==="calendar") renderSeasonPlanner();
    } catch(error) {
        console.warn("Coach calendar availability counts could not be refreshed:",error);
    } finally {
        seasonPlannerCoachCountBusy=false;
    }
}
function spStartCoachAvailabilityCounts() {
    if(currentRole!=="coach"||seasonPlannerPage!=="calendar") return;
    spStopCoachAvailabilityCounts();
    spRefreshCoachAvailabilityCounts();
    seasonPlannerCoachCountTimer=setInterval(spRefreshCoachAvailabilityCounts,30000);
}

function spStopAvailabilityRefresh() {
    if (seasonPlannerAvailabilityTimer) clearInterval(seasonPlannerAvailabilityTimer);
    seasonPlannerAvailabilityTimer = null;
}
function spStartAvailabilityRefresh(fixtureId) {
    spStopAvailabilityRefresh();
    seasonPlannerAvailabilityTimer = setInterval(() => {
        if (document.visibilityState !== "visible" || seasonPlannerPage !== "availability-review") return;
        if (document.activeElement?.closest?.("#seasonPlannerContent select")) return;
        spReviewAvailability(fixtureId, true);
    }, 15000);
}
async function spReviewAvailability(fixtureId, silentRefresh = false) {
    if (!spCoachOrSenior() || seasonPlannerAvailabilityBusy) return;
    if (silentRefresh && (seasonPlannerPage !== "availability-review" ||
        document.activeElement?.closest?.("#seasonPlannerContent select"))) return;
    seasonPlannerAvailabilityBusy = true;
    try {
        const result = await matchAdminCall("admin_fixtures", { action: "detail", fixture_id: Number(fixtureId) });
        seasonPlannerAvailabilityData = result.fixtures?.[0] || null;
        if (!seasonPlannerAvailabilityData) throw new Error("Availability details could not be found.");
        seasonPlannerPage = "availability-review";
        renderSeasonPlanner();
        spStartAvailabilityRefresh(fixtureId);
    } catch (e) {
        if (!silentRefresh) await appAlert(e.message || "Unable to load event availability.", "Availability unavailable", "danger");
        else console.warn("Availability refresh failed:", e);
    } finally {
        seasonPlannerAvailabilityBusy = false;
    }
}
function spRenderAvailabilityReview() {
    const f=seasonPlannerAvailabilityData;
    if(!f) return '<div class="sp-empty">No availability details loaded.</div>';
    const groups='<div class="sp-response-summary-head"><span>Age group</span><span>Available</span><span>Unavailable</span><span>Unsure</span></div>'+(f.age_groups||[]).map(g=>'<div class="sp-response-summary"><strong>'+spEsc(g.display_name||g.age_group)+'</strong><span class="sp-response-count sp-count-available">'+Number(g.available||0)+'</span><span class="sp-response-count sp-count-unavailable">'+Number(g.unavailable||0)+'</span><span class="sp-response-count sp-count-unsure">'+Number(g.unsure||0)+'</span></div>').join("");
    const submissions=(f.submissions||[]).map(sub=>{
        const children=(sub.children||[]).map(ch=>'<div class="sp-response-child"><div class="sp-response-child-details"><strong>'+spEsc(ch.child_name)+'</strong><small>'+spEsc(ch.age_group||"Age group not set")+(ch.school_year?' · School Year '+spEsc(ch.school_year):"")+(ch.duplicate_review_status==="pending"?' · Potential duplicate':"")+'</small></div><div class="sp-response-actions"><select aria-label="Availability for '+spEsc(ch.child_name)+'" '+(sub.edit_locked?'disabled title="Parent is editing this response"':'')+' onchange="spUpdateAvailabilityResponse('+Number(ch.id)+',this.value,'+Number(f.id)+')"><option value="available" '+(ch.availability==="available"?"selected":"")+'>Available</option><option value="unavailable" '+(ch.availability==="unavailable"?"selected":"")+'>Unavailable</option><option value="unsure" '+(ch.availability==="unsure"?"selected":"")+'>Unsure</option></select>'+'<button type="button" class="secondary-button sp-delete-duplicate" '+(sub.edit_locked?'disabled title="Parent is editing this response"':'')+' onclick="spDeleteDuplicateAvailability('+Number(ch.id)+','+Number(f.id)+')">Delete</button>'+'</div></div>').join("");
        return '<section class="sp-response-parent"><div class="sp-response-parent-head"><strong>'+spEsc(sub.parent_name||"Parent")+'</strong><small>Submitted '+spEsc(sub.submitted_at?new Date(sub.submitted_at).toLocaleString("en-GB"):"")+'</small></div>'+(sub.edit_locked?'<div class="sp-field-hint">Parent currently editing this response — changes temporarily disabled</div>':'')+children+'</section>';
    }).join("")||'<div class="sp-empty">No parent responses have been submitted yet.</div>';
    return '<div class="sp-review-toolbar"><button class="secondary-button" onclick="spSetPage(\'calendar\')">← Back to calendar</button><button class="secondary-button" onclick="copyMatchFixtureLink('+Number(f.id)+')">Copy Fixture Link</button></div><section class="sp-form-panel"><h3>'+spEsc(f.opposition||"Club event")+'</h3><div class="sp-event-meta">'+spDate(f.fixture_date)+' · '+spEsc(matchAdminFixtureType(f.fixture_type,f.status))+'</div><p>'+Number(f.children_count||0)+' player responses from '+Number(f.response_count||0)+' parents</p>'+groups+'</section><section class="sp-form-panel"><h3>Parent responses</h3>'+submissions+'</section>';
}
async function spDeleteDuplicateAvailability(childId,fixtureId) {
    if (!spCoachOrSenior()) return;
    if (!await appConfirm("Delete this potential duplicate child entry? Only this entry will be removed; the rest of the parent's submission will remain.","Delete duplicate")) return;
    try {
        await matchAdminCall("manage_match_child",{action:"delete_duplicate",child_id:Number(childId)});
        await spReviewAvailability(fixtureId);
    } catch(e) {
        const parentEditing = /currently editing this response/i.test(e.message || "");
        const message = parentEditing
            ? "This parent is currently editing their response. The child entry cannot be deleted until they have finished. Please try again later."
            : (e.message || "Unable to delete duplicate entry.");
        await appAlert(message, parentEditing ? "Cannot delete response" : "Delete failed", "danger");
        await spReviewAvailability(fixtureId);
    }
}

async function spUpdateAvailabilityResponse(childId,availability,fixtureId) {
    try {
        await matchAdminCall("manage_match_child",{action:"update_availability",child_id:Number(childId),availability});
        await spReviewAvailability(fixtureId);
    } catch(e) {
        await appAlert(e.message||"Unable to update availability.","Update failed","danger");
        await spReviewAvailability(fixtureId);
    }
}
function spRenderSetup() {
    const s=seasonPlannerData.season;
    const nextName=typeof getNextSeason==="function"?getNextSeason(s.season_name):"";
    return '<div class="sp-page-intro">Set the dates for this season, or prepare the following season in advance. Creating a planned season does not change player age groups or the active season.</div>'+
    '<section class="sp-form-panel"><h3>'+spEsc(s.season_name)+'</h3><div class="sp-form-grid"><div class="form-group"><label for="spSeasonStart">Season starts</label><input id="spSeasonStart" type="date" value="'+(s.start_date||'')+'"></div><div class="form-group"><label for="spSeasonEnd">Season ends</label><input id="spSeasonEnd" type="date" value="'+(s.end_date||'')+'"></div></div><button class="primary-button" onclick="saveSeasonPlannerPeriod()">Save season dates</button></section>'+
    '<section class="sp-form-panel"><h3>Plan another season</h3><p class="sp-field-hint">This creates the season and planning dates only. Players will not move age groups until the separate rollover is run from 1 August.</p><div class="form-group"><label for="spNewSeasonName">Season name</label><input id="spNewSeasonName" maxlength="20" value="'+spEsc(nextName)+'" placeholder="e.g. 2027/28"></div><div class="sp-form-grid"><div class="form-group"><label for="spNewSeasonStart">Starts</label><input id="spNewSeasonStart" type="date"></div><div class="form-group"><label for="spNewSeasonEnd">Ends</label><input id="spNewSeasonEnd" type="date"></div></div><button class="primary-button" onclick="createSeasonPlannerSeason()">Create planned season</button></section>';
}
function renderSeasonPlanner() {
    const root=document.getElementById("seasonPlannerContent");
    if(!root||!seasonPlannerData) return;
    const pages={home:spRenderHome,schedules:spRenderSchedules,holidays:spRenderHolidays,calendar:spRenderCalendar,setup:spRenderSetup,"new-event":spRenderNewEvent,"edit-event":spRenderEventEditor,"availability-review":spRenderAvailabilityReview};
    const headers={
        home:["Season Planner","Plan recurring training, matches, holidays and other age-group events across the full season."],
        schedules:["Recurring Schedules","Create and manage regular training and match schedules across your age groups."],
        holidays:["Holidays & Breaks","Set dates when training and club activities are paused."],
        calendar:["Season Calendar","View the season at a glance and make changes to future events."],
        "new-event":["Add Event / Fixture","Add a one-off event or fixture for your age groups."],
        "edit-event":["Change Event","Update the event details and choose which age groups receive the change."],
        "availability-review":["Event Availability","Review parent responses and update player availability."],
        setup:["Season Setup","Set the dates for your club season."]
    };
    const header = seasonPlannerPage === "calendar" && currentRole === "coach"
        ? ["Fixtures & Events","Training, matches and other events for your age groups."]
        : (headers[seasonPlannerPage]||headers.home);
    const title=document.getElementById("spPageTitle");
    const description=document.getElementById("spPageDescription");
    const back=document.getElementById("spHeaderBack");
    if(title) title.textContent=header[0];
    if(description) description.textContent=header[1];
    if(back) {
        back.textContent=currentRole==="coach"
            ? (seasonPlannerPage==="calendar"?"← Back to Dashboard":"← Back to Fixtures & Events")
            : (seasonPlannerPage==="home"?"← Back to Dashboard":(["edit-event","availability-review","new-event"].includes(seasonPlannerPage)?"← Back to Calendar":"← Back to Season Planner"));
        if(currentRole==="coach") {
            back.onclick=seasonPlannerPage==="calendar"?showCoachDashboard:()=>spSetPage("calendar");
        } else {
            back.onclick=seasonPlannerPage==="home"?showSeniorDashboard:()=>spSetPage(["edit-event","availability-review"].includes(seasonPlannerPage)?"calendar":"home");
        }
    }
    root.innerHTML=(pages[seasonPlannerPage]||pages.home)();
    const filter=document.getElementById("spFilter");
    if(filter) filter.value=seasonPlannerAgeFilter;
}
async function createSeasonPlannerSeason() {
    if (!spSenior()) return;
    const name=document.getElementById("spNewSeasonName")?.value?.trim();
    const start=document.getElementById("spNewSeasonStart")?.value;
    const end=document.getElementById("spNewSeasonEnd")?.value;
    if (!name || !start || !end || end<=start) return appAlert("Enter a season name and valid dates.","Check season details","warning");
    try {
        const id=await spRPC("create_season_planner_season",{supplied_code:currentSeniorPIN,requested_season_name:name,requested_start_date:start,requested_end_date:end});
        if (!id) throw new Error("That season could not be created. Check the name and dates.");
        seasonPlannerPage="home";
        await loadSeasonPlanner(id);
        await appAlert("The planned season has been created. Players have not been moved and the current season is unchanged.","Season planned","success");
    } catch(e) { await appAlert(e.message||"Unable to create planned season.","Season creation failed","danger"); }
}
async function saveSeasonPlannerPeriod() {
    if (!spSenior()) return;
    const start=document.getElementById("spSeasonStart")?.value;
    const end=document.getElementById("spSeasonEnd")?.value;
    if (!start || !end || end<start) return appAlert("Enter valid season start and end dates.","Check dates","warning");
    try {
        const ok=await spRPC("save_season_planner_period",{
            supplied_code:currentSeniorPIN,requested_season_id:seasonPlannerData.season.id,
            requested_start_date:start,requested_end_date:end
        });
        if (ok!==true) throw new Error("Dates could not be saved. Check that existing schedules fit inside the new season dates.");
        await loadSeasonPlanner();
        await appAlert("Season dates saved.","Season updated","success");
    } catch(e) { await appAlert(e.message || "Unable to save season dates.","Save failed","danger"); }
}

async function createSeasonPlannerSchedule() {
    if (!spSenior()) return;
    const v=id=>document.getElementById(id)?.value;
    const name=v("spScheduleName"),start=v("spScheduleStart"),end=v("spScheduleEnd"),st=v("spStartTime"),et=v("spEndTime");
    const appliesToAll=v("spScheduleScope")==="all";
    const selected=[...document.querySelectorAll(".spScheduleGroup:checked")].map(x=>Number(x.value));
    if(!name||!start||!end||end<start||!st||!et||et<=st||(!appliesToAll&&!selected.length))
        return appAlert("Complete the schedule details and select at least one age group.","Check schedule","warning");
    try {
        const id=await spRPC("create_season_planner_schedule_v2",{
            supplied_code:currentSeniorPIN,
            requested_season_id:seasonPlannerData.season.id,
            requested_age_group_ids:selected,
            requested_applies_to_all:appliesToAll,
            requested_schedule_name:name,
            requested_start_date:start,
            requested_end_date:end,
            requested_weekday:Number(v("spWeekday")),
            requested_interval_weeks:Number(v("spFrequency")),
            requested_start_time:st,
            requested_end_time:et,
            requested_venue:v("spVenue")||null
        });
        if(!id) throw new Error("Schedule could not be created. Check the dates and selected age groups.");
        await loadSeasonPlanner();
        await appAlert("The recurring schedule has been created for the selected age groups.","Schedule created","success");
    } catch(e) { await appAlert(e.message||"Unable to create schedule.","Schedule failed","danger"); }
}
async function createSeasonPlannerBreak() {
    if (!spSenior()) return;
    const v=id=>document.getElementById(id)?.value;
    const start=v("spBreakStart"),end=v("spBreakEnd"),label=v("spBreakName");
    if (!start || !end || !label || end<start)
        return appAlert("Enter a break name and valid start and end dates.","Check break","warning");
    try {
        const id=await spRPC("create_season_planner_break",{
            supplied_code:currentSeniorPIN,requested_season_id:seasonPlannerData.season.id,
            requested_age_group_id:v("spBreakGroup") ? Number(v("spBreakGroup")) : null,
            requested_start_date:start,requested_end_date:end,requested_label:label
        });
        if (!id) throw new Error("Break could not be added. Check the dates are within the season and do not overlap an existing break.");
        await loadSeasonPlanner();
        await appAlert("The break has been added and matching future training dates marked as holidays.","Break added","success");
    } catch(e) { await appAlert(e.message || "Unable to add break.","Break failed","danger"); }
}

async function deleteSeasonPlannerBreak(id) {
    if (!spSenior()) return;
    if (!await appConfirm("Remove this break? Future sessions linked to it will return to training.","Remove break")) return;
    try {
        const ok=await spRPC("delete_season_planner_break",{supplied_code:currentSeniorPIN,requested_break_id:id});
        if (ok!==true) throw new Error("Break could not be removed.");
        await loadSeasonPlanner();
    } catch(e) { await appAlert(e.message || "Unable to remove break.","Remove failed","danger"); }
}

async function endSeasonPlannerSchedule(id) {
    if (!spSenior()) return;
    if (!await appConfirm("End this recurring schedule? Future sessions will be cancelled. Past sessions will remain unchanged.","End schedule")) return;
    try {
        const ok=await spRPC("end_season_planner_schedule",{supplied_code:currentSeniorPIN,requested_schedule_id:id});
        if (ok!==true) throw new Error("Schedule could not be ended.");
        await loadSeasonPlanner();
    } catch(e) { await appAlert(e.message || "Unable to end schedule.","Update failed","danger"); }
}

function toggleSeasonPlannerPast(value){seasonPlannerShowPast=!!value;renderSeasonPlanner();}
function toggleSeasonPlannerCancelled(value){seasonPlannerShowCancelled=!!value;renderSeasonPlanner();}
function filterSeasonPlannerCalendar(value) {
    seasonPlannerAgeFilter=value;
    renderSeasonPlanner();
}

function spMarkMatchTitleManual() {
    const title=document.getElementById("spEditTitle");
    if(title) title.dataset.matchAuto="false";
}
function spUpdateMatchEditorFields() {
    const type=document.getElementById("spEditType");
    const wrap=document.getElementById("spMatchLocationWrap");
    const location=document.getElementById("spEditMatchLocation");
    const venue=document.getElementById("spEditVenue");
    const label=document.getElementById("spEditVenueLabel");
    const hint=document.getElementById("spEditVenueHint");
    const titleLabel=document.getElementById("spEditTitleLabel");
    const isMatch=type && type.value==="match";
    if(wrap) wrap.style.display=isMatch?"block":"none";
    if(titleLabel) titleLabel.textContent=isMatch?"Opposition":"Event title";
    if(!venue) return;
    if(!isMatch) {
        venue.readOnly=false;
        venue.placeholder="Enter location (optional)";
        if(label) label.textContent="Location";
        if(hint) hint.textContent="";
    } else if(location && location.value==="home") {
        venue.value="Rushden & Higham RUFC";
        venue.readOnly=true;
        venue.placeholder="";
        if(label) label.textContent="Home venue";
        if(hint) hint.textContent="The club home venue is set automatically.";
    } else {
        if(venue.value==="Rushden & Higham RUFC") venue.value="";
        venue.readOnly=false;
        venue.placeholder="Enter away ground name and address";
        if(label) label.textContent="Away venue / address";
        if(hint) hint.textContent="Enter the opposition's ground or full address.";
    }
}
function spUpdateMatchTitle() { spUpdateMatchEditorFields(); }

function editSeasonPlannerEvent(id) {
    if(!spCoachOrSenior()) return;
    const event=seasonPlannerData.events.find(x=>Number(x.id)===Number(id));
    if(!event || event.event_date<=spToday())
        return appAlert("Past sessions and today's sessions cannot be changed.","Past session","warning");
    seasonPlannerEditingEventId=Number(id);
    spSetPage("edit-event");
}


function spUpdateNewEventFields() {
    const type=document.getElementById("spNewType")?.value;
    const location=document.getElementById("spNewMatchLocation")?.value;
    const matchWrap=document.getElementById("spNewMatchLocationWrap");
    const venue=document.getElementById("spNewVenue");
    const venueLabel=document.getElementById("spNewVenueLabel");
    const venueHint=document.getElementById("spNewVenueHint");
    if(matchWrap) matchWrap.style.display=type==="match"?"block":"none";
    if(venueLabel) venueLabel.textContent=type==="match"?(location==="home"?"Home venue":"Away venue / address"):"Location";
    if(venue) {
        const home=type==="match"&&location==="home";
        venue.readOnly=home;
        if(home) venue.value="Rushden & Higham RUFC";
        else if(venue.value==="Rushden & Higham RUFC") venue.value="";
        venue.placeholder=type==="match"&&location==="away"?"Enter away ground name and full address":"Enter venue or full address";
    }
    if(venueHint) venueHint.textContent=type==="match"?(location==="home"?"The club home venue is set automatically.":"Enter the opposition's ground or full address."):"Add the event location if needed.";
}
function spRenderNewEvent() {
    const coachMode=currentRole==="coach";
    const groups=(seasonPlannerData.age_groups||[]).filter(g=>{
        if(g.active===false) return false;
        if(!coachMode) return true;
        return (selectedAgeGroups||[]).includes(g.age_group)||(selectedAgeGroups||[]).includes(g.display_name);
    });
    const checks=groups.map(g=>'<label class="sp-group-choice"><input type="checkbox" class="spNewEventGroup" value="'+Number(g.id)+'" checked> '+spEsc(g.display_name||g.age_group)+'</label>').join("");
    const season=seasonPlannerData.season||{};
    return '<section class="sp-event-editor-page"><div class="sp-editor-page-heading"><div><div class="sp-eyebrow">SEASON CALENDAR</div><h2>Add a one-off event</h2><p>Create an event or fixture without changing recurring schedules.</p></div></div>'+
        '<div class="sp-form-panel"><div class="form-group"><label>Age groups</label><div class="sp-group-picker">'+checks+'</div><div class="sp-field-hint">Select the teams this event applies to.</div></div>'+
        '<div class="form-group"><label for="spNewType">Event type</label><select id="spNewType" onchange="spUpdateNewEventFields()"><option value="training">Training</option><option value="match">Fixture</option><option value="other">Other event</option></select></div>'+
        '<div class="form-group"><label for="spNewTitle" id="spNewTitleLabel">Event title</label><input id="spNewTitle" maxlength="120" placeholder="Enter an event title"></div>'+
        '<div class="form-group"><label for="spNewDate">Date</label><input id="spNewDate" type="date" min="'+(season.start_date||"")+'" max="'+(season.end_date||"")+'"></div>'+
        '<div class="sp-form-grid"><div class="form-group"><label for="spNewStart">Start time</label><input id="spNewStart" type="time"></div><div class="form-group"><label for="spNewEnd">End time</label><input id="spNewEnd" type="time"></div></div>'+
        '<div class="form-group" id="spNewMatchLocationWrap" style="display:none"><label for="spNewMatchLocation">Match location</label><select id="spNewMatchLocation" onchange="spUpdateNewEventFields()"><option value="home">Home</option><option value="away">Away</option></select></div>'+
        '<div class="form-group"><label id="spNewVenueLabel" for="spNewVenue">Location</label><textarea id="spNewVenue" maxlength="500" rows="3" placeholder="Enter venue or full address"></textarea><div id="spNewVenueHint" class="sp-field-hint">Add the event location if needed.</div></div>'+
        '<div class="form-group"><label for="spNewNotes">Notes</label><textarea id="spNewNotes" maxlength="1000" rows="3" placeholder="Add useful information for coaches and parents"></textarea></div>'+
        '<div class="form-group"><label class="sp-availability-setting"><span><strong>Request availability</strong><small>Parents will be asked to respond for this event.</small></span><span class="sp-switch"><input type="checkbox" id="spNewAvailability" checked><span class="sp-switch-track"></span></span></label><div class="sp-field-hint">A parent availability link will be created automatically when you save.</div></div>'+
        '<div class="sp-editor-actions"><button class="primary-button" onclick="createSeasonPlannerEvent()">Create event</button> <button class="secondary-button" onclick="spSetPage(\'calendar\')">Cancel</button></div></div></section>';
}
async function createSeasonPlannerEvent() {
    if(!spCoachOrSenior()) return;
    const value=id=>document.getElementById(id)?.value;
    const type=value("spNewType");
    const title=(value("spNewTitle")||"").trim();
    const date=value("spNewDate");
    const start=value("spNewStart")||null;
    const end=value("spNewEnd")||null;
    const groups=[...document.querySelectorAll(".spNewEventGroup:checked")].map(x=>Number(x.value));
    const matchLocation=type==="match"?(value("spNewMatchLocation")||"home"):null;
    let venue=(value("spNewVenue")||"").trim();
    if(type==="match"&&matchLocation==="home") venue="Rushden & Higham RUFC";
    if(!groups.length) return appAlert("Select at least one age group.","No age groups selected","warning");
    if(!title||!date) return appAlert("Enter an event title and date.","Check event details","warning");
    if(date<=spToday()) return appAlert("Choose a future date.","Date must be in the future","warning");
    if(date<(seasonPlannerData.season.start_date||"")||date>(seasonPlannerData.season.end_date||"")) return appAlert("The event date must be within the current season dates.","Date outside season","warning");
    if(start&&end&&end<=start) return appAlert("The end time must be after the start time.","Check event times","warning");
    if(type==="match"&&matchLocation==="away"&&!venue) return appAlert("Enter the away venue or address.","Away venue required","warning");
    const availability=!!document.getElementById("spNewAvailability")?.checked;
    try {
        const result=await spRPC("create_season_planner_one_off_event",{
            supplied_code:currentRole==="coach"?currentAccessPIN:currentSeniorPIN,
            supplied_installation_id:getInstallationID(),
            requested_season_id:Number(seasonPlannerData.season.id),
            requested_age_group_ids:groups,
            requested_event_date:date,
            requested_event_type:type,
            requested_title:title,
            requested_start_time:start,
            requested_end_time:end,
            requested_venue:venue||null,
            requested_opposition:type==="match"?title:null,
            requested_match_location:matchLocation,
            requested_notes:(value("spNewNotes")||"").trim()||null,
            requested_availability_enabled:availability
        });
        if(!result?.success) throw new Error("The event could not be created. Check your access and selected age groups.");
        if(currentRole==="coach") await loadCoachSeasonPlanner(); else await loadSeasonPlanner(null,true);
        let fixtureId=null;
        if(availability) {
            const synced=await matchAdminCall("parent_home",{action:"sync_calendar"});
            (synced.calendar_links||[]).forEach(link=>(link.event_ids||[]).forEach(id=>seasonPlannerAvailabilityByEvent.set(Number(id),Number(link.fixture_id))));
            if(currentRole==="coach") await loadCoachSeasonPlanner(); else await loadSeasonPlanner(null,true);
            fixtureId=(result.event_ids||[]).map(id=>seasonPlannerAvailabilityByEvent.get(Number(id))).find(Boolean)||null;
        }
        seasonPlannerPage="calendar";
        renderSeasonPlanner();
        if(availability&&!fixtureId) {
            await appAlert("The event was saved, but its parent availability link could not be confirmed. Refresh the calendar and try again.","Event saved — link needs checking","warning");
        } else {
            await appAlert("The one-off event has been added to the Season Calendar."+(fixtureId?" Its parent availability link is ready to share.":""),"Event created","success");
        }
    } catch(e) {
        console.error("One-off Season Planner event creation failed:",e);
        await appAlert(e.message||"Unable to create the event.","Event creation failed","danger");
    }
}

function spRenderEventEditor() {
    const id=seasonPlannerEditingEventId;
    const event=seasonPlannerData.events.find(x=>Number(x.id)===Number(id));
    if(!event) return '<div class="sp-empty">This event could not be found. <button class="secondary-button" onclick="spSetPage(\'calendar\')">Back to calendar</button></div>';
    const group=spGroupCalendarEvents(seasonPlannerData.events.filter(x=>
        x.event_date>spToday() && spEventGroupKey(x)===spEventGroupKey(event)
    )).find(g=>g.items.some(x=>Number(x.id)===Number(id)));
    const items=group?group.items:[event];
    const coachMode=currentRole==="coach";
    const allowedNames=new Set(selectedAgeGroups||[]);
    const editableItems=coachMode?items.filter(e=>{
        const ag=seasonPlannerData.age_groups.find(g=>String(g.id)===String(e.age_group_id));
        return ag && (allowedNames.has(ag.age_group) || allowedNames.has(ag.display_name));
    }):items;
    const checks=coachMode
        ? editableItems.map(e=>{
            const ag=seasonPlannerData.age_groups.find(g=>String(g.id)===String(e.age_group_id));
            return '<label class="sp-group-choice"><input type="checkbox" class="spEditGroup" value="'+e.id+'" checked> '+spEsc(ag?(ag.display_name||ag.age_group):e.age_group)+'</label>';
        }).join("")
        : seasonPlannerData.age_groups.filter(g=>g.active!==false).map(g=>{
            const existing=items.find(e=>String(e.age_group_id)===String(g.id));
            return '<label class="sp-group-choice"><input type="checkbox" class="spEditGroup" value="'+g.id+'" data-event-id="'+(existing?existing.id:"")+'" '+(existing?"checked":"")+'> '+spEsc(g.display_name||g.age_group)+'</label>';
        }).join("");
    const isHomeMatch=event.event_type==="match" && (event.match_location||"home")==="home";
    return '<section class="sp-event-editor-page">'+
        '<div class="sp-editor-page-heading"><div><div class="sp-eyebrow">SEASON CALENDAR</div><h2>Change event</h2><p>'+spDate(event.event_date)+' · '+spEsc(group?group.ageLabel:(event.display_name||event.age_group))+'</p></div></div>'+
        '<div class="sp-form-panel">'+
        '<div class="form-group"><label>Apply changes to</label><div class="sp-group-picker">'+checks+'</div><div class="sp-field-hint">Only the age groups shown here will receive this change.</div></div>'+
        '<div class="form-group"><label for="spEditType">Event type</label><select id="spEditType" onchange="spUpdateMatchEditorFields()">'+
        ["training","match","other","holiday","cancelled"].map(t=>'<option value="'+t+'" '+(t===event.event_type?'selected':'')+'>'+spType(t)+'</option>').join("")+
        '</select></div>'+
        '<div class="form-group"><label id="spEditTitleLabel" for="spEditTitle">'+(event.event_type==="match"?"Opposition":"Event title")+'</label><input id="spEditTitle" maxlength="120" value="'+spEsc(event.title)+'" placeholder="'+(event.event_type==="match"?"e.g. Olney":"Enter an event title")+'" oninput="spMarkMatchTitleManual()"></div>'+
        '<div class="form-group"><label for="spEditDate">Date</label><input id="spEditDate" type="date" min="'+(seasonPlannerData.season.start_date||"")+'" max="'+(seasonPlannerData.season.end_date||"")+'" value="'+event.event_date+'"></div>'+
        '<div class="sp-form-grid"><div class="form-group"><label for="spEditStart">Start time</label><input id="spEditStart" type="time" value="'+spTime(event.start_time)+'"></div><div class="form-group"><label for="spEditEnd">End time</label><input id="spEditEnd" type="time" value="'+spTime(event.end_time)+'"></div></div>'+
        '<div class="form-group" id="spMatchLocationWrap" style="display:'+(event.event_type==="match"?"block":"none")+'"><label for="spEditMatchLocation">Match location</label><select id="spEditMatchLocation" onchange="spUpdateMatchEditorFields()"><option value="home" '+((event.match_location||"home")==="home"?"selected":"")+'>Home</option><option value="away" '+(event.match_location==="away"?"selected":"") +'>Away</option></select></div>'+
        '<div class="form-group"><label id="spEditVenueLabel" for="spEditVenue">'+(isHomeMatch?"Home venue":event.event_type==="match"?"Away venue / address":"Location")+'</label><textarea id="spEditVenue" maxlength="500" rows="3" placeholder="'+(event.event_type==="match"&&!isHomeMatch?"Enter away ground name and full address":"Enter venue or full address")+'" '+(isHomeMatch?'readonly':'')+'>'+spEsc(event.venue||(isHomeMatch?"Rushden & Higham RUFC":""))+'</textarea><div id="spEditVenueHint" class="sp-field-hint">'+(isHomeMatch?"The club home venue is set automatically.":event.event_type==="match"?"Enter the opposition's ground or full address.":"")+'</div></div>'+
        '<div class="form-group"><label for="spEditNotes">Notes</label><textarea id="spEditNotes" maxlength="1000" rows="3" placeholder="Add useful information for coaches and parents">'+spEsc(event.notes||"")+'</textarea></div>'+
        '<div class="form-group"><label class="sp-availability-setting"><span><strong>Request availability</strong><small>Parents will be asked to respond for this event.</small></span><span class="sp-switch"><input type="checkbox" id="spEditAvailability" '+(event.availability_enabled!==false && !["holiday","cancelled"].includes(event.event_type)?"checked":"")+' '+(["holiday","cancelled"].includes(event.event_type)?"disabled":"")+'><span class="sp-switch-track"></span></span></label><div class="sp-field-hint">On by default for training, matches and other events. Holidays and cancelled events cannot request availability.</div></div>'+ 
        '<div class="sp-editor-actions"><button class="primary-button" onclick="saveSeasonPlannerEvent('+event.id+')">Save changes</button> <button class="secondary-button" onclick="spSetPage(\'calendar\')">Cancel</button></div>'+
        '</div></section>';
}

async function saveSeasonPlannerEvent(id) {
    if(!spCoachOrSenior()) return;
    const event=seasonPlannerData.events.find(x=>Number(x.id)===Number(id));
    if(!event || event.event_date<=spToday())
        return appAlert("Past sessions cannot be changed.","Past session","warning");
    const v=k=>document.getElementById(k)?.value;
    const selectedGroups=[...document.querySelectorAll(".spEditGroup:checked")];
    const ids=currentRole==="coach"
        ? selectedGroups.map(x=>Number(x.value))
        : selectedGroups.map(x=>Number(x.dataset.eventId)).filter(Boolean);
    const ageGroupIds=currentRole==="coach"?[]:selectedGroups.map(x=>Number(x.value));
    const type=v("spEditType");
    const matchLocation=type==="match"?(v("spEditMatchLocation")||"home"):null;
    let venue=(v("spEditVenue")||"").trim();
    if(type==="match" && matchLocation==="home") venue="Rushden & Higham RUFC";
    const startTime=v("spEditStart")||null, endTime=v("spEditEnd")||null;
    const date=v("spEditDate"), title=(v("spEditTitle")||"").trim();
    if(!ids.length) return appAlert("Select at least one age group.","No age groups selected","warning");
    if(!title || !date || (startTime&&endTime&&endTime<=startTime))
        return appAlert("Enter an opposition/event name, date and valid session times.","Check details","warning");
    if(date<=spToday()) return appAlert("Only future sessions can be changed.","Past session","warning");
    if(type==="match" && matchLocation==="away" && !venue)
        return appAlert("Enter the away venue or address.","Away venue required","warning");
    try {
        const availabilityEnabled=!["holiday","cancelled"].includes(type) && !!document.getElementById("spEditAvailability")?.checked;
        let ok;
        if(currentRole==="coach") {
            const allowedIds=(selectedAgeGroups||[]).map(name=>{
                const group=seasonPlannerData.age_groups.find(g=>g.age_group===name || g.display_name===name);
                return group?Number(group.id):null;
            }).filter(Boolean);
            ok=await spRPC("update_coach_season_planner_event_group",{
                supplied_code:currentAccessPIN, requested_age_group_ids:allowedIds, requested_event_ids:ids,
                requested_event_date:date, requested_event_type:type, requested_title:title,
                requested_start_time:startTime, requested_end_time:endTime, requested_venue:venue||null,
                requested_opposition:type==="match"?title:null, requested_match_location:matchLocation,
                requested_notes:(v("spEditNotes")||"").trim()||null, requested_availability_enabled:availabilityEnabled
            });
        } else {
            ok=await spRPC("update_season_planner_event_group_shared_v3",{
                supplied_code:currentSeniorPIN, requested_source_event_id:Number(event.id),
                requested_event_ids:ids, requested_age_group_ids:ageGroupIds,
                requested_event_date:date, requested_event_type:type, requested_title:title,
                requested_start_time:startTime, requested_end_time:endTime, requested_venue:venue||null,
                requested_opposition:type==="match"?title:null, requested_match_location:matchLocation,
                requested_notes:(v("spEditNotes")||"").trim()||null,
                requested_availability_enabled:availabilityEnabled
            });
        }
        if(ok!==true) throw new Error(currentRole==="coach"?"This event could not be split safely. If parents have already responded to a shared event, ask an Admin to make the change so existing responses are preserved.":"The selected sessions could not be updated. Check the date is within the season and all sessions are still in the future.");
        seasonPlannerEditingEventId=null;
        seasonPlannerPage="calendar";
        if(currentRole==="coach") await loadCoachSeasonPlanner(); else await loadSeasonPlanner(null,true);
        const availabilitySync = matchAdminCall("parent_home",{action:"sync_calendar"});
        await appAlert("Updated "+(currentRole==="coach"?ids.length:ageGroupIds.length)+" age-group session(s). Parent availability is updating in the background.","Events updated","success");
        try {
            await availabilitySync;
        } catch(syncError) {
            console.error("Season Planner availability sync failed:",syncError);
            await appAlert("The event details were saved, but the parent availability link could not be synchronised. Please try refreshing the calendar. "+(syncError.message||""),"Availability sync needed","warning");
        }
    } catch(e) {
        await appAlert(e.message||"Unable to update sessions.","Update failed","danger");
    }
}
