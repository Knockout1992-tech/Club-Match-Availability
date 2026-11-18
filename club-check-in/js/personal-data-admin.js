/* =========================================================
   PERSONAL DATA MANAGEMENT
   System Admin only. Uses PIN-verified server RPCs.
   ========================================================= */
let pdmSearchResults = null;
let pdmSelectedSubject = null;
let pdmRequests = [];
let pdmCurrentRequest = null;
let pdmBundle = null;
let pdmErasurePreview = null;
let pdmRequestFilter = "open";

function pdmReady() {
    return typeof requireSystemAdminSession === "function" &&
        requireSystemAdminSession() && !!currentSystemAdminPIN;
}
function pdmEscape(value) {
    return escapeHTML(value == null ? "" : String(value));
}
function pdmDate(value) {
    return value ? new Date(value).toLocaleDateString("en-GB") : "—";
}
function pdmTodayLocal() {
    const now = new Date();
    return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}
function pdmIsClosed(request) {
    if (!request) return false;
    if (request.status === "withdrawn") return true;
    return ["completed", "partially_completed", "refused"].includes(request.status) && !!request.sent_at;
}
function pdmDeadlineLabel(request) {
    if (!request?.clock_started_at && ["awaiting_identity", "awaiting_authority"].includes(request?.status)) {
        return "Starts when identity / authority is verified";
    }
    return pdmDate(request?.extended_due_at || request?.due_at);
}
function pdmTypeLabel(value) {
    return ({access:"Access request",erasure:"Erasure request",rectification:"Rectification request",restriction:"Restriction request",objection:"Objection request",portability:"Data portability request",other:"Other request"})[value]||String(value||"Request");
}
function pdmSubjectLabel(value) {
    return ({parent:"Parent account",child:"Club Check-In player",portal_child:"Parent Portal child"})[value]||String(value||"Subject");
}
async function showPersonalDataManagement() {
    if (!pdmReady()) return;
    pdmSelectedSubject = null; pdmCurrentRequest = null; pdmBundle = null; pdmErasurePreview = null;
    const {data,error}=await supabaseClient.rpc("list_personal_data_requests",{p_system_admin_pin:currentSystemAdminPIN});
    if(error || data===null){await appAlert(error?.message||"Unable to load data requests.","Personal Data Management","danger");return;}
    pdmRequests=data.requests||[];
    renderPersonalDataManagement();
}
function pdmSetRequestFilter(filter) {
    if (!["open", "closed"].includes(filter)) return;
    pdmRequestFilter = filter;
    renderPersonalDataManagement();
}
function renderPersonalDataManagement() {
    if(!pdmReady())return;
    const openRequests = pdmRequests.filter(r => !pdmIsClosed(r));
    const closedRequests = pdmRequests.filter(r => pdmIsClosed(r));
    const visibleRequests = pdmRequestFilter === "closed" ? closedRequests : openRequests;
    const rows = visibleRequests.map(r => {
      const due = r.extended_due_at || r.due_at;
      const responseClockActive = ["in_review","extension_notified","ready_to_send","partially_completed"].includes(r.status);
      const overdue = responseClockActive && due && new Date(due).getTime() < Date.now() && !pdmIsClosed(r);
      return '<article class="pdm-request"><div class="pdm-request-head"><strong>'+pdmEscape(r.request_ref)+' · '+pdmEscape(pdmTypeLabel(r.request_type))+'</strong><span class="pdm-status">'+pdmEscape(String(r.status||"received").replace(/_/g," "))+'</span></div><div>'+pdmEscape(r.subject_name)+' · '+pdmEscape(pdmSubjectLabel(r.subject_type))+'</div><div class="subtitle">Received '+pdmDate(r.received_at)+' · Due '+pdmDeadlineLabel(r)+(overdue?' · OVERDUE':'')+'</div><button class="secondary-button small-button" onclick="pdmOpenRequest('+Number(r.id)+')">Open request</button></article>';
    }).join("");
    renderShell('<div class="card retention-admin pdm-page">'+
      '<button class="back-button" onclick="showRetentionAdmin()">← System Admin</button>'+
      '<h2>Personal Data Management</h2><div class="subtitle">Manage data protection requests across Club Check-In and the Parent Portal.</div>'+
      '<div class="info-box"><strong>Handle every request carefully.</strong><br>Verify identity and parental/representative authority, record the original receipt date, check applicable exceptions and retention holds, and treat the displayed date as an operational reminder rather than a legal deadline calculation. Record any clarification requests and correspondence in the case history, and separately check the statutory deadline against current ICO guidance. This screen does not pause or recalculate the legal clock. Do not store copies of identity documents here; record the verification outcome only. The club must approve a retention period for request case records.</div>'+
      '<section class="pdm-section"><h3>Find a parent or child</h3><div class="pdm-search"><input id="pdmSearchTerm" type="search" aria-label="Search parents or children" placeholder="Enter at least 2 characters"><button class="primary-button" onclick="pdmSearch()">Search</button></div><div id="pdmSearchResults"></div></section>'+
      '<section class="pdm-section"><div class="pdm-list-heading"><h3>Requests</h3><button class="secondary-button small-button" onclick="showPersonalDataManagement()">Refresh</button></div>'+
      '<div class="pdm-filter" role="group" aria-label="Filter requests"><button type="button" class="'+(pdmRequestFilter==="open"?"active":"")+'" aria-pressed="'+(pdmRequestFilter==="open"?"true":"false")+'" onclick="pdmSetRequestFilter(\'open\')">Open · '+openRequests.length+'</button><button type="button" class="'+(pdmRequestFilter==="closed"?"active":"")+'" aria-pressed="'+(pdmRequestFilter==="closed"?"true":"false")+'" onclick="pdmSetRequestFilter(\'closed\')">Closed · '+closedRequests.length+'</button></div>'+
      (rows||'<div class="empty">'+(pdmRequestFilter==="closed"?"No closed requests.":"No open requests.")+'</div>')+'</section>'+
      '<button class="secondary-button" onclick="showRetentionAdmin()">Back to System Admin</button>'+
      '<style>.pdm-page{padding:18px!important}.pdm-page .pdm-section{margin:24px 0;padding:16px;border:1px solid #e5e5e5;border-radius:12px;background:#fff}.pdm-page .pdm-section h3{margin:0 0 14px}.pdm-search{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:9px}.pdm-search input,.pdm-form input,.pdm-form select,.pdm-form textarea{width:100%;min-width:0;box-sizing:border-box;padding:12px;border:1px solid #ccc;border-radius:8px;background:#fff;color:#111;font:inherit}.pdm-result,.pdm-request{border:1px solid #ddd;border-radius:10px;padding:14px;margin:12px 0;overflow-wrap:anywhere}.pdm-request-head{display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap}.pdm-case-summary{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin:14px 0;padding:12px;background:#f5f5f5;border-radius:10px}.pdm-case-summary div{min-width:0}.pdm-case-summary span{display:block;font-size:12px;color:#666;margin-bottom:3px}.pdm-case-summary strong{display:block;text-transform:capitalize;overflow-wrap:anywhere}.pdm-timeline{list-style:none;margin:12px 0;padding:0;border-left:2px solid #ddd}.pdm-timeline li{position:relative;margin:0 0 16px 12px;padding:0 0 0 14px}.pdm-timeline li:before{content:"";position:absolute;left:-20px;top:5px;width:10px;height:10px;border-radius:50%;background:#777}.pdm-timeline-event{display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap}.pdm-timeline-outcome{text-transform:capitalize;font-size:12px;font-weight:700}.pdm-timeline .subtitle{margin:4px 0 0}.pdm-list-heading{display:flex;align-items:center;justify-content:space-between;gap:10px}.pdm-list-heading h3{margin:0!important}.pdm-filter{display:flex;gap:8px;margin:12px 0 16px}.pdm-filter button{flex:1;min-height:42px;border:1px solid #ddd;border-radius:8px;background:#f4f4f4;color:#222;font-weight:700}.pdm-filter button.active{background:#171717;color:#fff;border-color:#171717}.pdm-status{text-transform:capitalize;font-size:12px;font-weight:700;background:#eee;padding:4px 8px;border-radius:6px}.pdm-request .subtitle{margin:7px 0 12px}.pdm-request .subtitle:has(+button){line-height:1.4}.pdm-form{display:grid;gap:13px;margin-top:14px}.pdm-form label,.pdm-page #pdmRequestDetail label{display:block!important;width:100%;min-width:0;font-size:14px;font-weight:700;line-height:1.4;margin:12px 0}.pdm-form label input,.pdm-form label select,.pdm-form label textarea{display:block;margin-top:6px}.pdm-page #pdmRequestDetail{margin:22px 0;padding:17px;border:1px solid #ddd;border-radius:13px;background:#fff}.pdm-page #pdmRequestDetail>h3{margin:0 0 9px;font-size:20px}.pdm-page #pdmRequestDetail>p{line-height:1.6;margin:0 0 18px;color:#444}.pdm-page .pdm-actions{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin:16px 0}.pdm-page .pdm-actions button{width:100%;min-width:0;min-height:48px;padding:11px 9px;white-space:normal;line-height:1.25}.pdm-page #pdmResponseHost{margin-top:22px;padding-top:18px;border-top:1px solid #ddd}.pdm-page #pdmResponseHost label{display:block!important;width:100%;margin:0 0 13px;font-size:14px;font-weight:700;line-height:1.45}.pdm-page #pdmResponseHost textarea{display:block;width:100%;min-height:260px;margin-top:8px;padding:13px;border:1px solid #bbb;border-radius:9px;background:#fff;color:#111;font:15px/1.5 Arial,Helvetica,sans-serif;resize:vertical;white-space:pre-wrap}.pdm-page #pdmResponseHost select{display:block;width:100%;min-height:46px;margin-top:7px;padding:10px;border:1px solid #bbb;border-radius:8px;background:#fff;color:#111;font:inherit}.pdm-page #pdmResponseHost .pdm-check-row{display:flex;align-items:flex-start;gap:10px;padding:12px;margin:10px 0;border:1px solid #e1e1e1;border-radius:9px;background:#f8f8f8;font-size:13px;font-weight:400;line-height:1.45}.pdm-page #pdmResponseHost .pdm-check-row input{flex:0 0 20px;width:20px;height:20px;margin:1px 0 0}.pdm-page #pdmResponseHost button{width:100%;min-height:48px;margin:8px 0}.pdm-page #pdmResponseHost .pdm-note{margin:15px 0;padding:12px;background:#f5f5f5;border-radius:8px;line-height:1.5}.pdm-page .pdm-json{white-space:pre-wrap;overflow-wrap:anywhere;max-height:340px;overflow:auto;background:rgba(127,127,127,.1);padding:12px;border-radius:7px;font-size:11px}.pdm-page .pdm-note{font-size:12px;opacity:.85}.pdm-page .pdm-bad{color:#9b2c2c;font-weight:600}@media(max-width:520px){.pdm-case-summary{grid-template-columns:1fr 1fr}.pdm-actions{grid-template-columns:1fr}}@media(max-width:420px){.pdm-page{padding:12px!important}.pdm-page .pdm-section{padding:13px}.pdm-page .pdm-actions{grid-template-columns:1fr}.pdm-page #pdmRequestDetail{padding:13px}}.pdm-page .pdm-action-heading{margin:22px 0 9px;padding-top:14px;border-top:1px solid #e7e7e7;font-size:15px}.pdm-page .pdm-subsection{margin:16px 0;padding:14px;border:1px solid #e2e2e2;border-radius:10px;background:#fafafa}.pdm-page .pdm-subsection h4{margin:0 0 7px;font-size:16px}.pdm-page .pdm-technical{margin-top:12px;border:1px solid #ddd;border-radius:8px;background:#fff}.pdm-page .pdm-technical summary{padding:11px 13px;font-size:13px;font-weight:700;cursor:pointer}.pdm-page .pdm-technical .pdm-json{margin:0 10px 10px}.pdm-page #pdmResponseHost{display:block;width:100%;min-width:0}.pdm-page #pdmResponseHost textarea{box-sizing:border-box;width:100%;max-width:100%}.pdm-page #pdmResponseHost .pdm-check-row{display:flex!important;align-items:flex-start!important;gap:10px!important}.pdm-page #pdmResponseHost .pdm-check-row span{flex:1;min-width:0}.pdm-page #pdmEraseHost .pdm-erasure-notes{box-sizing:border-box;display:block;width:100%;max-width:100%;min-height:150px;margin-top:7px;padding:12px;border:1px solid #bbb;border-radius:9px;font:15px/1.5 Arial,Helvetica,sans-serif;resize:vertical}.pdm-page #pdmEraseHost .pdm-delete-confirm{box-sizing:border-box;display:block;width:100%;max-width:100%;min-height:48px;margin-top:7px;padding:12px;border:1px solid #bbb;border-radius:9px;font:700 16px/1.3 Arial,Helvetica,sans-serif;letter-spacing:2px;text-transform:uppercase}</style></div>');
}
async function pdmSearch() {
    if(!pdmReady())return;
    const term=document.getElementById("pdmSearchTerm")?.value?.trim()||"";
    const host=document.getElementById("pdmSearchResults");
    if(term.length<2){await appAlert("Enter at least two characters.","Search","warning");return;}
    host.textContent="Searching…";
    const {data,error}=await supabaseClient.rpc("search_personal_data_subjects",{p_system_admin_pin:currentSystemAdminPIN,p_search_term:term});
    if(error||data===null||!data.success){host.textContent="Search failed. Please try again.";return;}
    pdmSearchResults=data;
    const parents=(data.parents||[]).map(x=>({type:"parent",ref:x.subject_reference,name:x.parent_name,detail:"Parent account · "+x.linked_submissions+" linked submissions",locator:{}}));
    const children=(data.children||[]).map(x=>({type:x.subject_type,ref:x.subject_reference,name:x.subject_name,detail:[x.context_label,x.age_group,x.school_year,x.ambiguous_match?"Possible duplicate child records — manual identification required":""].filter(Boolean).join(" · "),locator:{age_group_id:x.age_group_id||null,school_year:x.school_year||"",family_id:x.family_id||null,parent_name:x.parent_name||"",availability_ids:x.availability_ids||null,parent_access_id:x.parent_access_id||null,source_submission_id:x.source_submission_id||null,ambiguous_match:x.ambiguous_match===true}}));
    const all=[...parents,...children];
    host.innerHTML=all.length?all.map((x,i)=>'<article class="pdm-result"><strong>'+pdmEscape(x.name)+'</strong><div class="subtitle">'+pdmEscape(x.detail)+'</div><button class="secondary-button small-button" onclick="pdmSelectSubject('+i+')">Select</button></article>').join(""):'<div class="empty">No matching parent or child records found.</div>';
    window.pdmCurrentResults=all;
}
function pdmSelectSubject(index) {
    if(!pdmReady())return;
    const item=window.pdmCurrentResults?.[index];if(!item)return;
    pdmSelectedSubject=item;pdmCurrentRequest=null;pdmBundle=null;pdmErasurePreview=null;
    const host=document.getElementById("pdmSearchResults");
    host.innerHTML='<div class="pdm-result"><strong>Selected: '+pdmEscape(item.name)+'</strong><div>'+pdmEscape(item.detail)+'</div>'+
      '<form class="pdm-form" onsubmit="event.preventDefault();pdmCreateRequest()">'+
      '<label>Request type<select id="pdmType"><option value="access">Access to personal data</option><option value="erasure">Erasure / deletion</option><option value="rectification">Rectification</option><option value="restriction">Restriction</option><option value="objection">Objection</option><option value="portability">Data portability</option><option value="other">Other</option></select></label>'+
      '<label>Requester name<input id="pdmRequester" maxlength="120" required></label>'+
      '<label>Relationship to subject<select id="pdmRelationship">'+(pdmSelectedSubject.type==="parent"?'<option value="self">The person themselves</option><option value="authorised_representative">Authorised representative</option><option value="other">Other</option>':'<option value="parent_or_guardian">Parent / person with parental responsibility</option><option value="authorised_representative">Authorised representative</option><option value="other">Other</option>')+'</select></label>'+
      '<label>Contact method<select id="pdmContactMethod"><option value="club_contact_route">Club official contact route</option><option value="email">Email</option><option value="letter">Letter</option><option value="phone">Phone</option></select></label>'+
      '<label>Contact details (if supplied)<input id="pdmContactDetails" maxlength="250"></label>'+
      '<label>Date received<input id="pdmReceived" type="date" value="'+pdmTodayLocal()+'" required></label>'+
      '<label>Identity check<select id="pdmIdentity"><option value="unverified">Not yet verified</option><option value="verified">Verified</option><option value="more_information_required">More information required</option></select></label>'+
      '<label>Authority to act<select id="pdmAuthority">'+(pdmSelectedSubject.type==="parent"?'<option value="not_applicable">Not applicable / requester is adult subject</option><option value="unverified">Not yet verified</option><option value="verified">Verified</option>':'<option value="unverified">Not yet verified</option><option value="verified">Verified parental responsibility / authority</option><option value="not_authorised">Not authorised</option>')+'</select></label>'+
      '<label>Scope / notes<textarea id="pdmScope" rows="2" maxlength="2000"></textarea></label>'+
      '<button class="primary-button" type="submit">Create request</button></form></div>';
}
async function pdmCreateRequest() {
    if(!pdmReady()||!pdmSelectedSubject)return;
    const v=id=>document.getElementById(id)?.value||"";
    const receivedDate=v("pdmReceived");
    const receivedLocal=new Date(receivedDate+"T00:00:00");
    if(!/^\d{4}-\d{2}-\d{2}$/.test(receivedDate)||Number.isNaN(receivedLocal.getTime())||receivedDate>pdmTodayLocal()){
      await appAlert("Enter a valid received date that is not in the future.","Date received","warning");return;
    }
    const received=receivedLocal.toISOString();
    const args={p_system_admin_pin:currentSystemAdminPIN,p_request_type:v("pdmType"),p_subject_type:pdmSelectedSubject.type,
      p_subject_reference:pdmSelectedSubject.ref,p_subject_name:pdmSelectedSubject.name,p_subject_locator:pdmSelectedSubject.locator,
      p_requester_name:v("pdmRequester"),p_requester_relationship:v("pdmRelationship"),p_contact_method:v("pdmContactMethod"),
      p_contact_details:v("pdmContactDetails"),p_received_at:received,p_identity_status:v("pdmIdentity"),
      p_authority_status:v("pdmAuthority"),p_scope_notes:v("pdmScope")};
    const {data,error}=await supabaseClient.rpc("create_personal_data_request",args);
    if(error||data===null||!data.success){await appAlert(error?.message||data?.message||"Unable to create request.","Request not created","warning");return;}
    await appAlert("Request "+data.request_ref+" created. Due date: "+pdmDate(data.due_at)+".","Request recorded","success");
    await showPersonalDataManagement();await pdmOpenRequest(data.id);
}
async function pdmOpenRequest(id) {
    if(!pdmReady())return;
    const {data,error}=await supabaseClient.rpc("get_personal_data_request_detail",{p_system_admin_pin:currentSystemAdminPIN,p_request_id:id});
    if(error||data===null||!data.success){await appAlert(error?.message||data?.message||"Request could not be loaded.","Personal Data Management","warning");return;}
    pdmCurrentRequest=data.request;
    pdmBundle=null;pdmErasurePreview=null;
    renderPdmRequestDetail();
}
function pdmReturnToList() {
    const host=document.querySelector(".pdm-page");
    if(!host)return;
    host.querySelector("#pdmRequestDetail")?.remove();
    host.querySelectorAll(":scope > .pdm-section").forEach(section=>section.hidden=false);
}
function renderPdmRequestDetail() {
    if(!pdmReady()||!pdmCurrentRequest)return;
    const r=pdmCurrentRequest;
    const isClosed=pdmIsClosed(r);
    const host=document.querySelector(".pdm-page");
    if(!host)return;
    host.querySelectorAll(":scope > .pdm-section").forEach(section=>section.hidden=true);
    const panel=document.createElement("section");panel.id="pdmRequestDetail";panel.className="pdm-section";
    panel.innerHTML='<button class="back-button" type="button" onclick="pdmReturnToList()">← Back to requests</button>'+
      '<h3>'+pdmEscape(r.request_ref)+' · '+pdmEscape(pdmTypeLabel(r.request_type))+'</h3>'+
      '<p>'+pdmEscape(r.subject_name)+' · '+pdmEscape(r.subject_type)+'<br>Received '+pdmDate(r.received_at)+' · Due '+pdmDeadlineLabel(r)+'</p>'+
      '<div class="pdm-case-summary"><div><span>Current status</span><strong>'+pdmEscape(String(r.status||"received").replace(/_/g," "))+'</strong></div><div><span>Identity</span><strong>'+pdmEscape(String(r.identity_status||"unverified").replace(/_/g," "))+'</strong></div><div><span>Authority</span><strong>'+pdmEscape(String(r.authority_status||"not_applicable").replace(/_/g," "))+'</strong></div><div><span>Target response date</span><strong>'+pdmEscape(pdmDeadlineLabel(r))+'</strong></div></div>'+(r.decision_reason?'<div class="pdm-note"><strong>Decision reasons / explanation</strong><p>'+pdmEscape(r.decision_reason)+'</p></div>':'')+
      (isClosed?'<p class="pdm-note">This request is closed. Case actions are disabled; the recorded history remains available below.</p>':
        (["access","portability"].includes(r.request_type)?'<h4 class="pdm-action-heading">Request actions</h4><div class="pdm-actions"><button class="secondary-button" onclick="pdmLoadBundle()">Build data copy</button></div>':'')+
        (r.request_type==="erasure"?(r.erasure_executed_at?'<div class="pdm-note">Erasure executed '+pdmEscape(new Date(r.erasure_executed_at).toLocaleString("en-GB"))+'. Records removed: '+pdmEscape(r.erasure_records_removed??"Not recorded")+'.'+(r.erasure_reviewed_at?' Legal and safeguarding review recorded '+pdmEscape(new Date(r.erasure_reviewed_at).toLocaleString("en-GB"))+'.':'')+' Prepare and send the response below.</div>':'<h4 class="pdm-action-heading">Erasure review</h4><div class="pdm-actions"><button class="secondary-button" onclick="pdmPreviewErasure()">Preview deletion</button></div>'):'')+
        '<div id="pdmBundleHost"></div><div id="pdmEraseHost"></div>'+
        '<h4 class="pdm-action-heading">Response and case management</h4><div class="pdm-actions"><button class="secondary-button" onclick="pdmDraftResponse()">Prepare response</button><button class="secondary-button" onclick="pdmUpdateStatus()">Update progress</button>'+(r.extension_notified_at?'':'<button class="secondary-button" onclick="pdmNotifyExtension()">Record extension notice</button>')+'</div>'+
        '<div id="pdmResponseHost"></div>')+
      '<h4 class="pdm-action-heading">Request history</h4><div id="pdmTimeline" aria-live="polite"><p class="subtitle">Loading request history…</p></div>';
    host.querySelector("#pdmRequestDetail")?.remove();host.appendChild(panel);
    pdmLoadTimeline(r.request_ref);
}
async function pdmLoadTimeline(requestRef) {
    const host=document.getElementById("pdmTimeline");
    if(!host||!pdmReady())return;
    const {data,error}=await supabaseClient.rpc("get_personal_data_request_history",{p_system_admin_pin:currentSystemAdminPIN,p_request_ref:requestRef,p_requested_limit:200});
    if(error||!Array.isArray(data)){
      host.innerHTML='<p class="subtitle">Request history is temporarily unavailable. The underlying audit log is retained.</p>';
      return;
    }
    const events=data;
    const olderEventsMayExist=data.length===200;
    if(!events.length){
      host.innerHTML='<p class="subtitle">'+(olderEventsMayExist?'No matching event was found in the latest 200 audit entries; older events may exist.':'No request-specific history events were returned.')+'</p>';
      return;
    }
    host.innerHTML='<ol class="pdm-timeline">'+events.map(x=>{
      const eventLabel=String(x.event_type||"event").replace(/^personal_data_/,"").replace(/_/g," ");
      const outcome=String(x.outcome||"recorded").replace(/_/g," ");
      return '<li><div class="pdm-timeline-event"><strong>'+pdmEscape(eventLabel)+'</strong><span class="pdm-timeline-outcome">'+pdmEscape(outcome)+'</span></div><div class="subtitle">'+pdmEscape(pdmDate(x.occurred_at))+' · '+pdmEscape(new Date(x.occurred_at).toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit"}))+' · '+pdmEscape(x.actor_type||"system")+'</div></li>';
    }).join("")+'</ol>'+(olderEventsMayExist?'<p class="subtitle">Showing the latest 200 events for this request. Earlier events may exist in the full audit log.</p>':'');
}
async function pdmLoadBundle() {
    if(!pdmReady()||!pdmCurrentRequest)return;
    const r=pdmCurrentRequest;
    if(r.subject_type==="portal_child"&&r.subject_locator?.ambiguous_match===true){await appAlert("This child match is ambiguous. Confirm the exact child record before preparing a data copy.","Child identification required","warning");return;}
    if(r.identity_status!=="verified"||!["verified","not_applicable"].includes(r.authority_status)){
      await appAlert("Verify the requester’s identity and, where applicable, their authority before preparing a personal data copy.","Verification required","warning");return;
    }
    const {data,error}=await supabaseClient.rpc("get_personal_data_subject_bundle",{p_system_admin_pin:currentSystemAdminPIN,
      p_subject_type:r.subject_type,p_subject_reference:r.subject_reference,p_subject_name:r.subject_name,p_subject_locator:r.subject_locator||{}});
    if(error||data===null||!data.success){await appAlert(error?.message||data?.message||"Unable to build data copy.","Access request","warning");return;}
    pdmBundle=data;const host=document.getElementById("pdmBundleHost");
    host.innerHTML='<div class="pdm-subsection"><h4>Data copy prepared</h4><p class="pdm-note">This export includes the selected parent’s family-sharing relationship only. Other family members’ personal data, child records and submissions are excluded and require separate, appropriately verified requests. Still review the copy before disclosure. Preparing this copy does not send it to the requester.</p>'+
      '<div class="pdm-actions"><button class="primary-button small-button" onclick="pdmDownloadReadableBundle()">Download readable report</button><button class="secondary-button small-button" onclick="pdmDownloadBundle()">Download technical JSON</button></div>'+
      '<details class="pdm-technical"><summary>Show technical data preview</summary><pre class="pdm-json">'+pdmEscape(JSON.stringify(data,null,2))+'</pre></details></div>';
}
function pdmDownloadBundle() {
    if(!pdmBundle||!pdmReady())return;
    const blob=new Blob([JSON.stringify(pdmBundle,null,2)],{type:"application/json"});
    const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download=(pdmCurrentRequest.request_ref||"personal-data")+".json";a.click();URL.revokeObjectURL(url);
}
async function pdmDownloadReadableBundle() {
    if(!pdmBundle||!pdmReady())return;
    const render=(key,value)=>{
      if(value===null||typeof value!=="object")return '<p><strong>'+pdmEscape(key.replace(/_/g," "))+'</strong>: '+pdmEscape(value??"Not recorded")+'</p>';
      if(Array.isArray(value)){
        if(!value.length)return '<h3>'+pdmEscape(key.replace(/_/g," "))+'</h3><p>None recorded.</p>';
        if(typeof value[0]==="object"){
          const cols=[...new Set(value.flatMap(row=>Object.keys(row)))];
          return '<h3>'+pdmEscape(key.replace(/_/g," "))+'</h3><div class="table-wrap"><table><thead><tr>'+cols.map(c=>'<th>'+pdmEscape(c.replace(/_/g," "))+'</th>').join("")+'</tr></thead><tbody>'+value.map(row=>'<tr>'+cols.map(c=>'<td>'+pdmEscape(row[c]??"")+'</td>').join("")+'</tr>').join("")+'</tbody></table></div>';
        }
        return '<h3>'+pdmEscape(key.replace(/_/g," "))+'</h3><ul>'+value.map(x=>'<li>'+pdmEscape(x)+'</li>').join("")+'</ul>';
      }
      return '<section><h3>'+pdmEscape(key.replace(/_/g," "))+'</h3>'+Object.entries(value).map(([k,v])=>render(k,v)).join("")+'</section>';
    };
    const html='<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Personal data copy</title><style>body{font:14px Arial,sans-serif;max-width:1100px;margin:32px auto;padding:0 18px;color:#222}h1{font-size:24px}h2{font-size:18px;margin-top:26px}h3{font-size:15px;margin-top:20px;text-transform:capitalize}p{line-height:1.5}.table-wrap{overflow-x:auto}table{border-collapse:collapse;width:100%;margin:10px 0}th,td{border:1px solid #ccc;padding:7px;text-align:left;vertical-align:top}th{background:#f2f2f2}section{margin:14px 0}@media print{body{margin:0;max-width:none}}</style></head><body><h1>Personal data copy</h1><p>Rushden &amp; Higham RUFC · '+pdmEscape(pdmCurrentRequest?.request_ref||"")+'</p><p>Prepared '+pdmEscape(new Date().toLocaleString("en-GB"))+'</p><p><strong>Review before disclosure:</strong> check the identity and authority of the requester and remove or redact information about other people where required.</p>'+Object.entries(pdmBundle).map(([k,v])=>render(k,v)).join("")+'</body></html>';
    const blob=new Blob([html],{type:"text/html;charset=utf-8"});const url=URL.createObjectURL(blob);
    const a=document.createElement("a");a.href=url;a.download=(pdmCurrentRequest?.request_ref||"personal-data")+"-report.html";a.click();URL.revokeObjectURL(url);
}
async function pdmPreviewErasure() {
    if(!pdmReady()||!pdmCurrentRequest)return;
    const {data,error}=await supabaseClient.rpc("preview_personal_data_erasure",{p_system_admin_pin:currentSystemAdminPIN,p_request_id:pdmCurrentRequest.id});
    if(error||data===null||!data.success){await appAlert(error?.message||data?.message||"Unable to preview deletion.","Deletion preview","warning");return;}
    pdmErasurePreview=data;
    document.getElementById("pdmEraseHost").innerHTML='<h4>Deletion preview</h4><pre class="pdm-json">'+pdmEscape(JSON.stringify(data.records,null,2))+'</pre>'+
      (data.can_erase?'<p>Eligible for deletion. No active retention holds were found.</p>':'<p class="pdm-bad">Deletion blocked. '+pdmEscape((data.blockers||[]).map(x=>x.message).join(" "))+'</p>')+
      '<p class="pdm-note">'+pdmEscape(data.retained_aggregate_note)+'</p>'+
      (data.can_erase?'<label><input type="checkbox" id="pdmCheckExceptions"> I have reviewed legal, safeguarding, insurance and claims retention exceptions, and created any required retention holds.</label><label>Erasure review notes<textarea id="pdmErasureReviewNotes" class="pdm-erasure-notes" rows="5" placeholder="Record the checks completed and any retention basis. Do not include names or unnecessary personal details."></textarea></label><label>Type DELETE to confirm<input id="pdmConfirmRef" class="pdm-delete-confirm" type="text" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="DELETE"></label><button class="red-button" onclick="pdmExecuteErasure()">Permanently erase identified records</button>':'');
}
async function pdmExecuteErasure() {
    if(!pdmReady()||!pdmCurrentRequest||!pdmErasurePreview?.can_erase)return;
    const confirmation=document.getElementById("pdmConfirmRef")?.value?.trim()||"";
    if(confirmation.toUpperCase()!=="DELETE"){await appAlert('Type DELETE in the confirmation box to continue.',"Confirmation required","warning");return;}
    // Keep the server-side reference check intact; the user-friendly confirmation
    // word is translated to the exact request reference for the protected RPC.
    const ref=pdmCurrentRequest.request_ref;
    const reviewNotes=document.getElementById("pdmErasureReviewNotes")?.value?.trim()||"";
    if(!document.getElementById("pdmCheckExceptions")?.checked||reviewNotes.length<10){
      await appAlert("Confirm the legal and safeguarding review and record a short reason before erasure.","Erasure review required","warning");return;
    }
    const ok=await appConfirm("This permanently removes the identified personal records. This cannot be undone. Continue only if the request, identity, authority and retention checks have been approved.","Permanent erasure","Erase records");
    if(!ok)return;
    const review=await supabaseClient.rpc("record_personal_data_erasure_review",{p_system_admin_pin:currentSystemAdminPIN,p_request_id:pdmCurrentRequest.id,p_review_notes:reviewNotes,p_confirmed:true});
    if(review.error||review.data===null||!review.data.success){await appAlert(review.error?.message||review.data?.message||"Unable to record erasure review.","Erasure not started","danger");return;}
    const {data,error}=await supabaseClient.rpc("execute_personal_data_erasure",{p_system_admin_pin:currentSystemAdminPIN,p_request_id:pdmCurrentRequest.id,p_confirm_reference:ref});
    if(error||data===null||!data.success){await appAlert(error?.message||data?.message||"Erasure was not completed.","Erasure failed","danger");return;}
    await appAlert(data.message+" Records removed: "+data.records_removed,"Erasure completed","success");
    await showPersonalDataManagement();
}
function pdmResponseOutcomes(type) {
    const options = {
      access: [["provided","All requested information provided"],["partially_provided","Some information provided"],["refused","Request refused"]],
      erasure: [["erased","Identified information erased"],["refused","Request refused"]],
      rectification: [["corrected","Information corrected"],["partially_corrected","Partially corrected"],["refused","Request refused"]],
      restriction: [["restricted","Processing restricted"],["partially_restricted","Partially restricted"],["refused","Request refused"]],
      objection: [["accepted","Objection accepted"],["partially_accepted","Objection partially accepted"],["refused","Objection not accepted"]],
      portability: [["provided","Information provided"],["partially_provided","Some information provided"],["refused","Request refused"]],
      other: [["completed","Request action completed"],["partially_completed","Partially completed"],["not_actioned","No action taken"]]
    };
    return options[type] || options.other;
}
function pdmResponseOutcomeText(type, outcome) {
    const labels = Object.fromEntries(pdmResponseOutcomes(type));
    return labels[outcome] || "Outcome to be confirmed";
}
function pdmBuildResponseText() {
    if (!pdmReady() || !pdmCurrentRequest) return;
    const r = pdmCurrentRequest;
    const outcome = document.getElementById("pdmResponseOutcome")?.value || "";
    const notes = document.getElementById("pdmResponseReason")?.value?.trim() || "[insert the specific decision, reasons and any applicable exemption or exception]";
    const name = r.requester_name || "[requester name]";
    const received = pdmDate(r.received_at);
    const greeting = "Dear " + name + ",";
    let body = greeting + "\n\nThank you for contacting Rushden & Higham RUFC. We received your " +
      pdmTypeLabel(r.request_type).toLowerCase() + " on " + received + ".\n\n";
    const outcomeLine = "Our decision: " + pdmResponseOutcomeText(r.request_type, outcome) + ".\n\n";
    if (r.request_type === "access") {
      body += outcomeLine + notes + "\n\n";
      if (outcome !== "refused") {
        body += "The personal information covered by your request is supplied with this response. " +
          "[Confirm the attached or linked data copy and the secure delivery method.]\n\n";
      }
      body += "Additional information about our processing\n" +
        "Data controller: [confirm the club's legal controller identity and contact details].\n" +
        "Purposes and lawful bases: [list each relevant purpose and its verified lawful basis].\n" +
        "Categories of personal data: [describe the categories included in this response].\n" +
        "Recipients: [identify the recipients or categories of recipients].\n" +
        "International transfers: [confirm whether any apply and describe the safeguards, or state that none apply if verified].\n" +
        "Retention: [state the approved retention periods or criteria].\n" +
        "Sources: [identify the source of information not obtained directly from you, where applicable].\n" +
        "Automated decision-making: [describe any qualifying automated decision-making, or confirm none if verified].\n\n" +
        "You may have the right to request rectification, erasure or restriction, to object to processing, or to request data portability, depending on the circumstances. You may also complain to the Information Commissioner's Office (ICO).\n\n";
    } else if (r.request_type === "portability") {
      body += outcomeLine + notes + "\n\n";
      if (outcome !== "refused") {
        body += "The structured personal information covered by your portability request is supplied in the attached file or secure download. [Confirm the file format, delivery method and that the information relates to data provided by you and processed by automated means where the portability right applies.]\n\n";
      }
      body += "If you remain dissatisfied, you may complain to the ICO.\n\n";
    } else if (r.request_type === "erasure") {
      body += outcomeLine + notes + "\n\n";
      body += outcome === "erased"
        ? "We have erased the identified live application records. Any information retained, and the reason and applicable basis for retaining it, are set out in the decision explanation above. We do not claim to have removed provider backups or logs unless that has been separately verified.\n\n"
        : "We have not erased the information. The reasons and any applicable exemption or retention basis are set out in the decision explanation above.\n\n";
      body += "If you remain dissatisfied, you may complain to the ICO.\n\n";
    } else {
      body += outcomeLine + notes + "\n\n";
      body += "The action taken, information affected and any reasons for not completing all or part of the request are set out in the decision explanation above.\n\n";
      body += "If you remain dissatisfied, you may complain to the ICO.\n\n";
    }
    body += "Kind regards,\nRHRUFC Club Committee";
    const field = document.getElementById("pdmResponseText");
    if (field) field.value = body;
}
function pdmDraftResponse() {
    if(!pdmReady()||!pdmCurrentRequest)return;
    const r=pdmCurrentRequest;
    const options=pdmResponseOutcomes(r.request_type);
    const suggested = r.decision && options.some(x=>x[0]===r.decision) ? r.decision : options[0][0];
    const host=document.getElementById("pdmResponseHost");
    host.innerHTML='<div class="pdm-form">'+
      '<label>Response outcome<select id="pdmResponseOutcome">'+options.map(x=>'<option value="'+pdmEscape(x[0])+'">'+pdmEscape(x[1])+'</option>').join("")+'</select></label>'+
      '<label>Decision reasons / explanation<textarea id="pdmResponseReason" rows="5" maxlength="4000" placeholder="Record the facts and action taken. For erasure, include what information remains held, why, the applicable exemption or retention basis, and the retention period if known."></textarea></label>'+
      '<button type="button" class="secondary-button" onclick="pdmBuildResponseText()">Refresh draft from outcome and reasons</button>'+
      '<label for="pdmResponseText">Editable response draft</label><textarea id="pdmResponseText" rows="18"></textarea>'+
      '<button class="secondary-button" onclick="pdmCopyResponse()">Copy response</button>'+
      '<label for="pdmSentMethod">Sent by</label><select id="pdmSentMethod"><option value="club_contact_route">Club official contact route</option><option value="email">Email</option><option value="letter">Letter</option><option value="phone">Phone</option></select>'+
      (["access","portability"].includes(r.request_type)?'<label class="pdm-check-row"><input type="checkbox" id="pdmCheckExport"><span>I have securely supplied the relevant data copy where the outcome requires disclosure.</span></label>':'')+
      '<label class="pdm-check-row"><input type="checkbox" id="pdmCheckThirdParty"><span>I have checked and redacted information about other people where required.</span></label>'+
      '<label class="pdm-check-row"><input type="checkbox" id="pdmCheckAccuracy"><span>I have verified every factual statement against the club’s approved policies and actual records. No unverified legal basis, retention period or supplier claim remains.</span></label>'+
      '<p class="pdm-note">This is a draft, not a legal determination. Replace every square-bracket instruction and verify the facts. The club privacy notice is still awaiting committee approval; do not present its contents as approved club policy.</p>'+
      '<button class="primary-button" onclick="pdmRecordSent()">Record as sent</button></div>';
    document.getElementById("pdmResponseOutcome").value=suggested;
    document.getElementById("pdmResponseReason").value="";
    pdmBuildResponseText();
}
async function pdmRecordSent() {
    if(!pdmReady()||!pdmCurrentRequest)return;
    const outcome=document.getElementById("pdmResponseOutcome")?.value||"";
    if(pdmCurrentRequest.request_type==="erasure"){
      if(!pdmCurrentRequest.erasure_executed_at&&outcome!=="refused"){
        await appAlert("Complete the deletion preview and authorised erasure first, or record a refusal with the reason, before sending an erasure response.","Erasure outcome required","warning");return;
      }
      if(pdmCurrentRequest.erasure_executed_at&&outcome!=="erased"){
        await appAlert("This request has already been erased. Record the completed erasure outcome; it cannot now be refused.","Erasure outcome required","warning");return;
      }
    }
    if(pdmCurrentRequest.identity_status!=="verified"||!["verified","not_applicable"].includes(pdmCurrentRequest.authority_status)){
      await appAlert("Verify the requester’s identity and, where applicable, their authority before issuing any final response. If verification is outstanding, record the case as awaiting information instead.","Verification required","warning");return;
    }
    const decisionReason=document.getElementById("pdmResponseReason")?.value?.trim()||"";
    if(decisionReason.length<10){
      await appAlert("Enter the decision reasons / explanation (at least 10 characters) before recording the response as sent.","Decision explanation required","warning");return;
    }
    const method=document.getElementById("pdmSentMethod")?.value||"club_contact_route";
    const requiresAccessCopy=["access","portability"].includes(pdmCurrentRequest.request_type)&&outcome!=="refused";
    const responseText=document.getElementById("pdmResponseText")?.value||"";
    if(/\[[^\]]+\]/.test(responseText)){
      await appAlert("The draft still contains square-bracket instructions. Replace or remove every placeholder before sending.","Draft incomplete","warning");return;
    }
    if(!outcome||!document.getElementById("pdmCheckThirdParty")?.checked||!document.getElementById("pdmCheckAccuracy")?.checked||
       (requiresAccessCopy&&(!pdmBundle||!document.getElementById("pdmCheckExport")?.checked))){
      await appAlert("Complete the outcome, disclosure checks and any required access-copy confirmation before recording the response as sent.","Pre-send checks required","warning");return;
    }
    const {data,error}=await supabaseClient.rpc("record_personal_data_response",{p_system_admin_pin:currentSystemAdminPIN,p_request_id:pdmCurrentRequest.id,
       p_decision:outcome,p_decision_reason:decisionReason,p_response_text:responseText,p_sent_via:method,
       p_access_copy_confirmed:!requiresAccessCopy||!!document.getElementById("pdmCheckExport")?.checked,
       p_third_party_reviewed:!!document.getElementById("pdmCheckThirdParty")?.checked,
       p_accuracy_confirmed:!!document.getElementById("pdmCheckAccuracy")?.checked});
     if(error||data===null||!data.success){await appAlert(error?.message||data?.message||"Unable to record response.","Update failed","warning");return;}
    await showPersonalDataManagement();
}
function pdmUpdateStatus() {
    if(!pdmReady()||!pdmCurrentRequest)return;
    const host=document.getElementById("pdmResponseHost");
    const statuses=["received","awaiting_identity","awaiting_authority","in_review","extension_notified","ready_to_send"];
    host.innerHTML='<div class="pdm-form"><label>Request status<select id="pdmStatus">'+statuses.map(x=>'<option value="'+x+'">'+x.replace(/_/g," ")+'</option>').join("")+'</select></label>'+
      '<label>Identity check<select id="pdmIdentityStatus"><option value="unverified">Unverified</option><option value="verified">Verified</option><option value="more_information_required">More information required</option><option value="not_applicable">Not applicable</option></select></label>'+
      '<label>Authority to act<select id="pdmAuthorityStatus"><option value="not_applicable">Not applicable</option><option value="unverified">Unverified</option><option value="verified">Verified</option><option value="not_authorised">Not authorised</option></select></label>'+
      '<label>Decision / outcome<input id="pdmDecision" maxlength="500"></label><label>Review notes<textarea id="pdmResponseNotes" rows="3" maxlength="4000"></textarea></label>'+
      '<label>Scope notes<textarea id="pdmScopeNotes" rows="2" maxlength="2000"></textarea></label>'+
      '<button class="primary-button" onclick="pdmSaveProgress()">Save progress</button></div>';
    document.getElementById("pdmStatus").value=pdmCurrentRequest.status||"in_review";
    document.getElementById("pdmIdentityStatus").value=pdmCurrentRequest.identity_status||"unverified";
    document.getElementById("pdmAuthorityStatus").value=pdmCurrentRequest.authority_status||"not_applicable";
    document.getElementById("pdmDecision").value=pdmCurrentRequest.decision||"";
    document.getElementById("pdmResponseNotes").value=pdmCurrentRequest.response_notes||"";
    document.getElementById("pdmScopeNotes").value=pdmCurrentRequest.scope_notes||"";
}
async function pdmSaveProgress() {
    if(!pdmReady()||!pdmCurrentRequest)return;
    const v=id=>document.getElementById(id)?.value||"";
    const status=v("pdmStatus");
    if(["completed","partially_completed"].includes(status)){await appAlert("Use Prepare response and Record as sent to close a request.","Response required","warning");return;}
    const {data,error}=await supabaseClient.rpc("update_personal_data_request",{p_system_admin_pin:currentSystemAdminPIN,p_request_id:pdmCurrentRequest.id,
      p_status:status,p_identity_status:v("pdmIdentityStatus"),p_authority_status:v("pdmAuthorityStatus"),
      p_scope_notes:v("pdmScopeNotes"),p_extension_reason:pdmCurrentRequest.extension_reason||null,p_extension_notified_at:pdmCurrentRequest.extension_notified_at||null,
      p_decision:v("pdmDecision"),p_response_notes:v("pdmResponseNotes"),
      p_sent_at:pdmCurrentRequest.sent_at||null,p_sent_via:pdmCurrentRequest.sent_via||null,p_completed_at:pdmCurrentRequest.completed_at||null});
    if(error||data===null||!data.success){await appAlert(error?.message||data?.message||"Unable to update request.","Update failed","warning");return;}
    await showPersonalDataManagement();
}
async function pdmNotifyExtension() {
    if(!pdmReady()||!pdmCurrentRequest)return;
    if(pdmCurrentRequest.extension_notified_at){await appAlert("An extension has already been recorded for this request. It cannot be issued again.","Extension already recorded","warning");return;}
    const host=document.getElementById("pdmResponseHost");
    host.innerHTML='<div class="pdm-form"><p>A complex request or multiple requests may justify up to two additional months. The requester must be told, with reasons, within the first month.</p>'+
      '<label>Reason for extension<textarea id="pdmExtensionReason" rows="3" maxlength="2000" required></textarea></label>'+
      '<label>Date the requester was notified<input id="pdmExtensionDate" type="date" value="'+pdmTodayLocal()+'" required></label>'+
      '<button class="primary-button" onclick="pdmSaveExtension()">Record extension notice</button></div>';
}
async function pdmSaveExtension() {
    if(!pdmReady()||!pdmCurrentRequest)return;
    const reason=document.getElementById("pdmExtensionReason")?.value?.trim()||"";
    const notified=document.getElementById("pdmExtensionDate")?.value||"";
    if(reason.length<10||!notified){await appAlert("Enter the reason and date the requester was notified.","Extension details required","warning");return;}
    const when=new Date(notified+"T00:00:00");
    if(!/^\d{4}-\d{2}-\d{2}$/.test(notified)||Number.isNaN(when.getTime())||notified>pdmTodayLocal()){
      await appAlert("Enter a valid notification date that is not in the future. The server will check the statutory notification deadline.","Extension not recorded","warning");return;
    }
    const {data,error}=await supabaseClient.rpc("update_personal_data_request",{p_system_admin_pin:currentSystemAdminPIN,p_request_id:pdmCurrentRequest.id,
      p_status:"extension_notified",p_identity_status:pdmCurrentRequest.identity_status||"unverified",p_authority_status:pdmCurrentRequest.authority_status||"not_applicable",
      p_scope_notes:pdmCurrentRequest.scope_notes||null,p_extension_reason:reason,p_extension_notified_at:when.toISOString(),
      p_decision:pdmCurrentRequest.decision||null,p_response_notes:pdmCurrentRequest.response_notes||null,
      p_sent_at:pdmCurrentRequest.sent_at||null,p_sent_via:pdmCurrentRequest.sent_via||null,p_completed_at:null});
    if(error||data===null||!data.success){await appAlert(error?.message||data?.message||"Unable to record extension.","Extension not recorded","warning");return;}
    await appAlert("Extension recorded. Revised deadline: "+pdmDate(data.extended_due_at)+". Ensure the requester was actually notified and retain a copy of that notice.","Extension recorded","success");
    await showPersonalDataManagement();
}

async function pdmCopyResponse() {
    if(!pdmReady())return;
    const field=document.getElementById("pdmResponseText");
    if(!field)return;
    try {
      await navigator.clipboard.writeText(field.value);
      await appAlert("Response copied. Review it and send it through the club's official contact route.","Copied","success");
    } catch(error) {
      field.focus();field.select();
      const copied=document.execCommand("copy");
      await appAlert(copied?"Response copied. Review it and send it through the club's official contact route.":"Copy was blocked. Select and copy the response manually.","Copy response",copied?"success":"warning");
    }
}
