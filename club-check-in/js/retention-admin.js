/* =========================================================
   SYSTEM ADMIN / RETENTION MANAGEMENT
   Separate from the existing Senior PIN.
   ========================================================= */
let currentSystemAdminPIN = null;
let systemAdminExpiresAt = 0;
let retentionAdminData = null;
let systemAdminAuditEntries = [];
let systemAdminAuditCursor = null;
let systemAdminAuditCursorHistory = [];
let systemAdminAuditHasMore = false;
let systemAdminAuditAllEntries = null;
let systemAdminAuditAllLoading = false;
let systemAdminAuditAllPromise = null;

function requireSystemAdminSession() {
    if (!currentSystemAdminPIN || Date.now() > systemAdminExpiresAt) {
        currentSystemAdminPIN = null;
        systemAdminExpiresAt = 0;
        retentionAdminData = null;
        showSystemAdminLogin();
        return false;
    }
    return true;
}

function closeSystemAdmin() {
    currentSystemAdminPIN = null;
    systemAdminExpiresAt = 0;
    retentionAdminData = null;
    showSeniorDashboard();
}

function showSystemAdminLogin() {
    if (currentRole !== "senior" || !currentSeniorPIN) {
        appAlert("Please sign in with the existing Admin PIN first.", "Admin access required", "warning");
        return;
    }
    currentSystemAdminPIN = null;
    systemAdminExpiresAt = 0;
    renderShell(`
        <div class="card pin-card">
            <button class="back-button" onclick="showSeniorDashboard()">← Admin Dashboard</button>
            <h2>System Admin</h2>
            <div class="subtitle">Enter the separate System Admin PIN to access retention and system controls.</div>
            <form onsubmit="event.preventDefault(); unlockSystemAdmin();">
                <input id="systemAdminPinInput" class="pin-input" type="password"
                    inputmode="numeric" maxlength="4" autocomplete="off" required
                    placeholder="System Admin PIN">
                <div id="systemAdminPinError" class="error"></div>
                <button class="primary-button" type="submit">Unlock System Admin</button>
            </form>
        </div>`);
    document.getElementById("systemAdminPinInput").focus();
}

async function unlockSystemAdmin() {
    const input = document.getElementById("systemAdminPinInput");
    const errorBox = document.getElementById("systemAdminPinError");
    const pin = input?.value || "";
    errorBox.textContent = "";
    if (!/^\d{4}$/.test(pin)) {
        errorBox.textContent = "Enter your System Admin PIN.";
        return;
    }
    const { data, error } = await supabaseClient.rpc("get_retention_admin_data", {
        system_admin_pin: pin
    });
    if (error || !data) {
        errorBox.textContent = error?.message?.includes("locked")
            ? "System Admin access is temporarily locked. Try again later."
            : "System Admin PIN incorrect.";
        input.value = "";
        return;
    }
    currentSystemAdminPIN = pin;
    systemAdminExpiresAt = Date.now() + 10 * 60 * 1000;
    retentionAdminData = data;
    if (data.must_change_pin) {
        showSystemAdminChangePin(true);
        return;
    }
    showRetentionAdmin();
}

function showSystemAdminChangePin(required = false) {
    if (!currentSystemAdminPIN) return showSystemAdminLogin();
    renderShell(`
        <div class="card pin-card">
            ${required ? "" : '<button class="back-button" onclick="showRetentionAdmin()">← System Admin</button>'}
            <h2>Change System Admin PIN</h2>
            <div class="subtitle">${required ? "Your temporary setup PIN must be changed before using System Admin controls." : "Choose a new private PIN for System Admin access."}</div>
            <form onsubmit="event.preventDefault(); saveSystemAdminPin();">
                <input id="newSystemAdminPin" class="pin-input" type="password" inputmode="numeric"
                    maxlength="4" minlength="4" autocomplete="new-password" placeholder="New 4-digit PIN" required>
                <input id="confirmSystemAdminPin" class="pin-input" type="password" inputmode="numeric"
                    maxlength="4" minlength="4" autocomplete="new-password" placeholder="Confirm new PIN" required>
                <div id="changeSystemAdminPinError" class="error"></div>
                <button class="primary-button" type="submit">Save New PIN</button>
            </form>
        </div>`);
}

async function saveSystemAdminPin() {
    const next = document.getElementById("newSystemAdminPin").value;
    const confirm = document.getElementById("confirmSystemAdminPin").value;
    const box = document.getElementById("changeSystemAdminPinError");
    box.textContent = "";
    if (next !== confirm) { box.textContent = "The PIN entries do not match."; return; }
    if (!/^\d{4}$/.test(next)) { box.textContent = "Use exactly 4 digits."; return; }
    const { data, error } = await supabaseClient.rpc("change_system_admin_pin", {
        current_system_admin_pin: currentSystemAdminPIN,
        new_system_admin_pin: next
    });
    if (error || data !== true) { box.textContent = error?.message || "Unable to change PIN."; return; }
    currentSystemAdminPIN = next;
    systemAdminExpiresAt = Date.now() + 10 * 60 * 1000;
    await appAlert("System Admin PIN changed successfully.", "PIN updated", "success");
    const refreshed = await supabaseClient.rpc("get_retention_admin_data", { system_admin_pin: currentSystemAdminPIN });
    if (refreshed.error || !refreshed.data) { closeSystemAdmin(); return; }
    retentionAdminData = refreshed.data;
    showRetentionAdmin();
}


function retentionFriendlyDate(value) {
    if (!value) return "Date not recorded";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return new Intl.DateTimeFormat("en-GB", {day:"numeric",month:"long",year:"numeric",hour:"2-digit",minute:"2-digit"}).format(date);
}
function retentionFriendlyStatus(value) {
    const v=String(value||"").toLowerCase();
    if (["succeeded","success","completed"].includes(v)) return "Completed successfully";
    if (["failed","error"].includes(v)) return "Could not be completed";
    if (["running","started"].includes(v)) return "In progress";
    return v ? v.replace(/[_-]+/g," ").replace(/\b\w/g,c=>c.toUpperCase()) : "Status not recorded";
}
function retentionFriendlyMode(value) {
    const v=String(value||"").toLowerCase();
    if(v==="dry_run") return "Preview check";
    if(v==="scheduled") return "Scheduled check";
    if(v==="enforcement") return "Automatic removal";
    return v.replace(/[_-]+/g," ") || "System check";
}
function retentionHumanLabel(value) {
    return String(value||"").replace(/[_-]+/g," ").replace(/\b\w/g,c=>c.toUpperCase());
}
function retentionPolicyDescription(p) {
    const key=String(p.policy_key||"").toLowerCase()+" "+String(p.record_type||"").toLowerCase();
    const action=String(p.action||"").toLowerCase();
    if(/archiv/.test(key)) return "Automatically anonymise archived player details after the configured number of completed seasons. Player IDs and attendance history remain linked.";
    if(/attendance/.test(key)) return "Remove individual attendance records after the period shown. Season totals and attendance history are kept";
    if(/cancel/.test(key)) return "Keep responses for cancelled matches for the period shown, then remove those responses";
    if(/invitation|invite/.test(key)) return "Remove an invitation after it has been accepted, cancelled or expired";
    if(/availability|match.response/.test(key)) return "Keep match availability responses for the period shown after the fixture date, then remove the responses";
    if(/parent|family|account.link/.test(key)) return "After the configured inactivity period, disable parent accounts for the review period shown. Accounts are only deleted after that review period, with active holds and family-sharing safeguards respected. Successful availability updates and family-sharing changes reset the activity clock; sign-in and failed PIN attempts do not.";
    if(/pdm_case_records/.test(key)) return "Anonymise identifying case details after the configured period from closure. Keep a minimal non-identifying record of the request and its handling; open cases and active holds are excluded.";
    if(/parent_portal_security_audit/.test(key)) return "Keep Parent Portal security and access audit events for the configured period, then automatically delete them. PINs, PIN hashes and authentication tokens must never be recorded.";
    if(/security|audit|log/.test(key)) return "Keep club security records for the period shown, then remove them. Supplier-held records follow the supplier's own settings";
    if(action==="anonymise") return "Remove personal details after the period shown while keeping the remaining record";
    if(action==="review") return "An administrator must check these records before they are removed. They will not be removed automatically";
    if(action==="external") return "These records are managed by the external service and are not removed by this app";
    return "Keep these records for the period shown before the stated action can take place";
}
function retentionSummaryRows(obj,prefix) {
    const rows=[];
    if(!obj||typeof obj!=="object") return rows;
    Object.entries(obj).forEach(([key,val])=>{
        const label=(prefix?prefix+" ":"")+key.replace(/[_-]+/g," ");
        if(typeof val==="number"&&Number.isFinite(val)){if(val>0)rows.push({label:label,value:val});}
        else if(val&&typeof val==="object") rows.push(...retentionSummaryRows(val,label));
    });
    return rows;
}
function renderRetentionRunSummary(summary,mode) {
    summary=summary&&typeof summary==="object"?summary:{};
    const preview=String(mode||"").toLowerCase()==="dry_run";
    const categories=[
        ["Attendance records","attendance_checked"],
        ["Match availability responses","match_availability_checked"],
        ["Cancelled fixture responses","cancelled_responses_checked"],
        ["Invitation tokens","invitation_rows_checked"],
        ["Security logs","security_logs_checked"],
        ["Parent Portal security & access audit","parent_portal_security_audit_checked"],
        ["Parent accounts entering review","parent_accounts_for_review"],
        ["Parent accounts disabled for review","parent_accounts_disabled_for_review"],
        ["Parent accounts due for deletion","inactive_parent_accounts_checked"],
        ["Personal data request cases due for anonymisation","pdm_case_records_checked"],
        ["Archived player records","archived_players_eligible"]
    ];
    const rows=categories.map(([label,key])=>{
        const count=Number(summary[key]??0);
        return '<div class="retention-result-row"><span>'+escapeHTML(label)+'</span><strong>'+count.toLocaleString("en-GB")+'</strong></div>';
    }).join("");
    return '<style>.retention-preview-heading{display:flex;flex-direction:column;gap:5px;margin-bottom:14px;padding-bottom:12px;border-bottom:1px solid var(--border,#ddd)}.retention-preview-heading span{font-size:13px;opacity:.75}.retention-result-grid{display:grid;grid-template-columns:1fr;gap:0;margin-top:10px}.retention-result-row{display:flex;justify-content:space-between;align-items:center;gap:16px;padding:10px 2px;border-bottom:1px solid var(--border,#ddd)}.retention-result-row:last-child{border-bottom:0}.retention-result-row strong{font-variant-numeric:tabular-nums;min-width:34px;text-align:right}</style>'+
      '<div class="retention-result-grid">'+rows+'</div>'+
      '<p class="retention-no-changes">'+(preview?"Preview only — no records were changed or deleted.":"Record changes are shown in the run details.")+'</p>';
}
const systemAdminDashboardStyles = `<style>
.system-admin-home{max-width:920px;margin:0 auto;padding:clamp(14px,3vw,26px)}
.system-admin-home .retention-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:4px 0 22px}
.system-admin-home .retention-heading h2{margin:0 0 5px}
.system-admin-home .system-admin-section{margin:20px 0 0;padding:18px;border:1px solid var(--border,#dedede);border-radius:14px;background:var(--card,#fff)}
.system-admin-home .system-admin-section>h3{font-size:17px;margin:0 0 14px}
.system-admin-tools{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
.system-admin-tool{display:flex;flex-direction:column;align-items:flex-start;gap:10px;min-width:0;padding:15px;border:1px solid var(--border,#dedede);border-radius:11px;background:var(--background,#fafafa)}
.system-admin-tool:first-child{grid-column:1/-1}
.system-admin-tool-icon{display:grid;place-items:center;width:34px;height:34px;border-radius:9px;background:rgba(100,100,100,.12);font-size:20px}
.system-admin-tool-copy{flex:1;min-width:0}
.system-admin-tool-copy strong{display:block;font-size:15px}
.system-admin-tool-copy p{font-size:13px;line-height:1.45;margin:5px 0 0;opacity:.75}
.system-admin-tool button{width:100%;min-height:43px;margin-top:auto}
.system-admin-home .admin-collapse{margin:10px 0;border:1px solid var(--border,#ddd);border-radius:10px;overflow:hidden;background:var(--card,#fff)}
.system-admin-home .admin-collapse>summary{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 15px;font-weight:700;cursor:pointer;list-style:none}
.system-admin-home .admin-collapse>summary::-webkit-details-marker{display:none}
.system-admin-home .admin-collapse>summary:after{content:"+";font-size:20px;font-weight:400;opacity:.65}
.system-admin-home .admin-collapse[open]>summary:after{content:"−"}
.system-admin-home .admin-collapse>summary span{display:block;margin-left:auto;text-align:right;font-size:12px;font-weight:400;opacity:.65}
.system-admin-home .admin-collapse-body{padding:0 14px 15px}
.system-admin-home .retention-policy-editor-grid{grid-template-columns:repeat(auto-fit,minmax(min(100%,230px),1fr))}
.system-admin-home .retention-policy-list{display:grid;gap:9px}
.system-admin-home .retention-policy{margin:0}
.system-admin-home .retention-history{padding:12px 0;border-bottom:1px solid var(--border,#ddd)}
.system-admin-home .retention-history:last-child{border-bottom:0}
@media(max-width:560px){
 .system-admin-home{padding:12px}
 .system-admin-home .retention-heading{align-items:flex-start}
 .system-admin-home .system-admin-section{padding:13px}
 .system-admin-tools{grid-template-columns:1fr}
 .system-admin-tool:first-child{grid-column:auto}
 .system-admin-tool{display:grid;grid-template-columns:34px minmax(0,1fr);column-gap:11px;align-items:center;padding:13px}
 .system-admin-tool-icon{grid-row:1;grid-column:1}
 .system-admin-tool-copy{grid-row:1;grid-column:2}
 .system-admin-tool button{grid-column:1/-1}
 .system-admin-home .admin-collapse>summary{align-items:flex-start;flex-wrap:wrap}
 .system-admin-home .admin-collapse>summary span{width:100%;margin:0;text-align:left}
}
</style>`;

function showRetentionAdmin() {
    if (!requireSystemAdminSession() || !retentionAdminData) return;
    const policies=retentionAdminData.policies||[], runs=retentionAdminData.runs||[], changes=retentionAdminData.changes||[];
    renderShell(
      '<div class="card retention-admin system-admin-home">'+systemAdminDashboardStyles+
      '<button class="back-button" onclick="closeSystemAdmin()">← Admin Dashboard</button>'+
      '<div class="retention-heading"><div><h2>System Admin</h2><div class="subtitle">Security, personal data and record-keeping controls</div></div><button class="secondary-button small-button" onclick="showSystemAdminChangePin(false)">Change PIN</button></div>'+
      '<section class="system-admin-section"><h3>Security &amp; data requests</h3><div class="system-admin-tools">'+
      '<article class="system-admin-tool"><div class="system-admin-tool-icon">⌕</div><div class="system-admin-tool-copy"><strong>Security Audit Log</strong><p>Review security events across Club Check-In and Match Availability.</p></div><button class="primary-button small-button" onclick="loadSystemAdminAuditLog()">Open security log</button></article>'+
      '<article class="system-admin-tool"><div class="system-admin-tool-icon">▣</div><div class="system-admin-tool-copy"><strong>Personal Data Management</strong><p>Handle access, erasure and other individual data requests.</p></div><button class="primary-button small-button" onclick="showPersonalDataManagement()">Open data requests</button></article>'+
      '<article class="system-admin-tool"><div class="system-admin-tool-icon">⌑</div><div class="system-admin-tool-copy"><strong>Retention Holds</strong><p>Protect records that must be retained for safeguarding, legal, insurance or incident reasons.</p></div><button class="secondary-button small-button" onclick="showRetentionHolds()">Manage holds</button></article><article class="system-admin-tool"><div class="system-admin-tool-icon">✚</div><div class="system-admin-tool-copy"><strong>First-Aider Management</strong><p>Manage volunteer names, main age-group cover, shared cover and pitch allocations.</p></div><button class="primary-button small-button" onclick="showFirstAiderManagement()">Manage first aiders</button></article>'+
      '</div></section>'+
      '<section class="system-admin-section"><h3>Retention &amp; privacy settings</h3>'+
      renderClubPolicyEditor(retentionAdminData.policy_content||{})+
      '<details class="admin-collapse"><summary>Retention rules <span>Configure how long each record type is kept</span></summary><div class="admin-collapse-body"><div class="retention-policy-list">'+
      (policies.map(p=>{
        const key=escapeHTML(p.policy_key);
        const amount=Number(p.retention_value)||0;
        const isInvitation=/invitation|invite/i.test(String(p.policy_key||"")+" "+String(p.record_type||""));
        const isParentFamily=String(p.policy_key||"")==="parent_family_links";
        const unit=String(p.retention_unit||"").replace(/s$/,"")+(amount===1?"":"s");
        const manual=String(p.action||"").toLowerCase()==="review"&&!/archiv|parent|family/i.test(String(p.policy_key||"")+" "+String(p.record_type||""));
        return '<details class="retention-policy admin-policy-item"><summary class="retention-policy-title"><strong>'+escapeHTML(p.record_type||retentionHumanLabel(p.policy_key))+'</strong><span class="retention-status '+(manual?"":p.enforcement_enabled?"is-on":"")+'">'+(manual?"Manual review only":p.enforcement_enabled?"Automatic removal ON":"Automatic removal OFF")+'</span></summary>'+
        '<p class="retention-description">'+escapeHTML(retentionPolicyDescription(p))+'</p>'+
        (manual?'<p class="retention-manual-note">No retention period has been approved. Keep under manual review; automatic deletion and anonymisation are unavailable until a documented period is approved and configured.</p>':
          (isInvitation?'<div class="retention-period-line"><strong>Keep until:</strong><span class="retention-unit">Accepted, revoked/cancelled or expired</span></div>':'<div class="retention-period-line"><label for="retention-value-'+key+'">Keep for</label><input type="number" min="0" max="120" step="1" id="retention-value-'+key+'" value="'+amount+'"><span class="retention-unit">'+escapeHTML(unit)+'</span></div>')+
          (isParentFamily?'<div class="retention-period-line"><label for="retention-review-months">Additional review period</label><input type="number" min="1" max="24" step="1" id="retention-review-months" value="'+Number(p.review_period_months||3)+'"><span class="retention-unit">months before deletion</span></div>':'')+
          '<label class="retention-active"><input type="checkbox" id="retention-enabled-'+key+'" '+(p.enabled?"checked":"")+'><span>This rule is active</span></label>'+
          '<div class="retention-actions"><button class="secondary-button small-button" onclick="saveRetentionPolicy(\''+key+'\')">Save changes</button><button class="'+(p.enforcement_enabled?"red-button":"secondary-button")+' small-button" onclick="toggleRetentionEnforcement(\''+key+'\','+(!p.enforcement_enabled)+')">'+(p.enforcement_enabled?"Turn automatic removal OFF":"Turn automatic removal ON")+'</button></div>'+
          (/archiv|parent|family/i.test(String(p.policy_key||"")+" "+String(p.record_type||""))?'<p class="retention-manual-note">Automatic processing runs daily at 03:15 UTC when enforcement is enabled.</p>':""))+'</details>';
      }).join("")||'<div class="empty">No record-keeping rules are available</div>')+
      '</div></div></details>'+
      '<details class="admin-collapse"><summary>Preview check <span>Check eligibility without changing or deleting records</span></summary><div class="admin-collapse-body"><p>Checks which records meet the rules above. It does not change or delete anything.</p><button class="primary-button" onclick="runRetentionDryRun()">Run preview check</button><div id="retentionDryRunResult"></div></div></details>'+
      '<details class="admin-collapse"><summary>Previous checks <span>View earlier retention runs</span></summary><div class="admin-collapse-body">'+
      (runs.map(r=>'<div class="retention-history"><strong>'+escapeHTML(retentionFriendlyMode(r.run_mode))+' — '+escapeHTML(retentionFriendlyStatus(r.status))+'</strong><div class="subtitle">'+escapeHTML(retentionFriendlyDate(r.started_at))+'</div>'+renderRetentionRunSummary(r.summary,r.run_mode)+'</div>').join("")||'<div class="empty">No checks have been run yet</div>')+
      '</div></details></section></div>'
    );
}

function retentionHoldTargetOptions() {
    return [
        ["attendance_individual","attendance_records","Individual attendance record"],
        ["match_availability","match_availability","Match availability response"],
        ["cancelled_fixture_responses","match_availability","Cancelled fixture response"],
        ["invitation_tokens","match_parent_family_invitations","Parent family invitation (legacy)"],
        ["invitation_tokens","match_parent_family_invites","Parent family invitation"],
        ["security_logs","installation_access_attempts","Installation security log (all events for installation)"],
        ["parent_portal_security_audit","system_admin_audit_log","Parent Portal security audit event"],
        ["parent_family_links","match_parent_access","Parent account"],
        ["pdm_case_records","personal_data_requests","Personal data request case"],
        ["archived_players","players","Archived player"]
    ];
}
function showRetentionHolds() {
    if (!requireSystemAdminSession() || !retentionAdminData) return;
    const holds=Array.isArray(retentionAdminData.holds)?retentionAdminData.holds:[];
    const overdueHolds=holds.filter(h=>h.status==="active"&&h.review_due_at&&new Date(h.review_due_at).getTime()<Date.now());
    const options=retentionHoldTargetOptions().map(x=>'<option value="'+escapeHTML(x[0]+'|'+x[1])+'">'+escapeHTML(x[2])+'</option>').join("");
    const rows=holds.map(h=>{
        const active=h.status==="active";
        const reviewOverdue=active&&h.review_due_at&&new Date(h.review_due_at).getTime()<Date.now();
        return '<article class="retention-hold-item">'+
          '<div class="retention-hold-heading"><strong>'+escapeHTML(retentionHumanLabel(h.category))+' hold</strong><span class="retention-status '+(active?"is-on":"")+'">'+(reviewOverdue?"Review overdue":active?"Active":"Released")+'</span></div>'+
          '<div class="retention-hold-meta">'+escapeHTML(retentionHumanLabel(h.policy_key))+' · '+escapeHTML(h.target_table)+' · Ref '+escapeHTML(h.target_reference)+'</div>'+
          '<p>'+escapeHTML(h.reason||"No reason recorded")+'</p>'+
          '<div class="retention-hold-meta">Created '+escapeHTML(retentionFriendlyDate(h.created_at))+' · Review due '+escapeHTML(retentionFriendlyDate(h.review_due_at))+(reviewOverdue?' · OVERDUE':'')+'</div>'+
          (h.last_reviewed_at?'<div class="retention-hold-meta">Last reviewed '+escapeHTML(retentionFriendlyDate(h.last_reviewed_at))+' · '+escapeHTML(h.review_notes||"")+'</div>':"")+
          (active?'<div class="retention-hold-actions"><label>Next review date<input type="date" id="hold-review-date-'+h.id+'" min="'+new Date().toISOString().slice(0,10)+'"></label><label>Review note<input type="text" id="hold-review-note-'+h.id+'" maxlength="2000" placeholder="Why the hold remains necessary"></label><button class="secondary-button small-button" onclick="reviewRetentionHold('+h.id+')">Record review</button><label>Release reason<input type="text" id="hold-release-reason-'+h.id+'" maxlength="2000" placeholder="Why the hold can end"></label><button class="red-button small-button" onclick="releaseRetentionHold('+h.id+')">Release hold</button></div>':'<div class="retention-hold-meta">Released '+escapeHTML(retentionFriendlyDate(h.released_at))+' · '+escapeHTML(h.release_reason||"")+'</div>')+
          '</article>';
    }).join("");
    renderShell('<div class="card retention-admin"><button class="back-button" onclick="showRetentionAdmin()">← System Admin</button><h2>Retention Holds</h2><p class="subtitle">An active hold prevents the retention process from deleting or anonymising the selected record. Holds remain active until explicitly released, even if the review date passes.</p>'+
      (overdueHolds.length?'<p class="retention-overdue-summary">'+overdueHolds.length+' active hold(s) need review. Their protection remains in place until explicitly released.</p>':'')+
      '<style>.retention-hold-form,.retention-hold-actions{display:grid;grid-template-columns:1fr;gap:10px;margin-top:14px}.retention-hold-form label,.retention-hold-actions label{display:flex;flex-direction:column;gap:5px;font-size:13px;font-weight:600}.retention-hold-form input,.retention-hold-form select,.retention-hold-form textarea,.retention-hold-actions input{width:100%;box-sizing:border-box;padding:10px;border:1px solid var(--border,#ccc);border-radius:7px;background:var(--card,#fff);color:inherit}.retention-hold-item{border:1px solid var(--border,#ddd);border-radius:9px;padding:13px;margin:12px 0}.retention-overdue-summary{padding:11px 13px;border-left:4px solid #b45309;background:rgba(180,83,9,.09);border-radius:6px;font-weight:700}.retention-hold-heading{display:flex;justify-content:space-between;gap:10px}.retention-hold-meta{font-size:12px;opacity:.75;margin-top:6px;overflow-wrap:anywhere}.retention-hold-actions{padding-top:10px;border-top:1px solid var(--border,#ddd)}.retention-hold-item p{margin:8px 0;overflow-wrap:anywhere}@media(min-width:650px){.retention-hold-form{grid-template-columns:1fr 1fr}.retention-hold-form .wide{grid-column:1/-1}.retention-hold-actions{grid-template-columns:1fr 1fr}.retention-hold-actions button{align-self:end}}</style>'+
      '<details class="admin-collapse" open><summary>Create a retention hold</summary><div class="admin-collapse-body"><p>Use the record reference shown by the relevant admin screen or audit record. Do not enter PINs, PIN hashes or authentication tokens.</p>'+
      '<div class="retention-hold-form"><label class="wide">Record type<select id="newRetentionHoldTarget">'+options+'</select></label><label>Record reference<input id="newRetentionHoldReference" maxlength="200" placeholder="Record ID or installation ID"></label><label>Reason category<select id="newRetentionHoldCategory"><option value="safeguarding">Safeguarding</option><option value="insurance">Insurance</option><option value="legal">Legal</option><option value="incident">Incident</option></select></label><label class="wide">Reason for retention<textarea id="newRetentionHoldReason" rows="3" maxlength="2000" placeholder="Explain why this record must be retained"></textarea></label><label>Review due date<input id="newRetentionHoldReview" type="date" min="'+new Date().toISOString().slice(0,10)+'"></label></div><button class="primary-button" style="margin-top:14px" onclick="createRetentionHold()">Create hold</button></div></details>'+
      '<h3>Existing holds</h3>'+(rows||'<div class="empty">No retention holds have been recorded.</div>')+
      '<button class="secondary-button" onclick="showRetentionAdmin()">Back to System Admin</button></div>');
}
async function callRetentionHold(args) {
    if(!requireSystemAdminSession())return false;
    const {data,error}=await supabaseClient.rpc("manage_retention_hold",{p_system_admin_pin:currentSystemAdminPIN,...args});
    if(error || data===null){
        await appAlert(error?.message||"System Admin verification failed. Please sign in again.","Retention hold not updated","danger");
        if(data===null)closeSystemAdmin();
        return false;
    }
    if(!data.success){await appAlert(data.message||"The retention hold could not be updated.","Unable to update hold","warning");return false;}
    await appAlert(data.message||"Retention hold updated.","Retention hold updated","success");
    await refreshRetentionAdmin();
    showRetentionHolds();
    return true;
}
async function createRetentionHold() {
    const target=(document.getElementById("newRetentionHoldTarget")?.value||"").split("|");
    const reference=document.getElementById("newRetentionHoldReference")?.value?.trim()||"";
    const category=document.getElementById("newRetentionHoldCategory")?.value||"";
    const reason=document.getElementById("newRetentionHoldReason")?.value?.trim()||"";
    const review=document.getElementById("newRetentionHoldReview")?.value||"";
    if(target.length!==2||!reference||!reason||reason.length<10||!review){await appAlert("Enter a record reference, a reason of at least 10 characters and a review date.","Complete the hold details","warning");return;}
    const reviewDate=new Date(review+"T23:59:00");
    if(Number.isNaN(reviewDate.getTime())||reviewDate<=new Date()){await appAlert("Choose a future review date.","Check review date","warning");return;}
    await callRetentionHold({p_action:"create",p_policy_key:target[0],p_target_table:target[1],p_target_reference:reference,p_category:category,p_reason:reason,p_review_due_at:reviewDate.toISOString()});
}
async function reviewRetentionHold(id) {
    const review=document.getElementById("hold-review-date-"+id)?.value||"";
    const notes=document.getElementById("hold-review-note-"+id)?.value?.trim()||"";
    if(!review||notes.length<10){await appAlert("Choose a future review date and enter a review note of at least 10 characters.","Review details required","warning");return;}
    const date=new Date(review+"T23:59:00");
    if(Number.isNaN(date.getTime())||date<=new Date()){await appAlert("Choose a future review date.","Check review date","warning");return;}
    await callRetentionHold({p_action:"review",p_hold_id:id,p_review_due_at:date.toISOString(),p_review_notes:notes});
}
async function releaseRetentionHold(id) {
    const reason=document.getElementById("hold-release-reason-"+id)?.value?.trim()||"";
    if(reason.length<10){await appAlert("Enter a release reason of at least 10 characters.","Release reason required","warning");return;}
    const ok=await appConfirm("Releasing this hold returns the record to its normal retention rule. If it is already overdue, the next retention run may process it. Continue?","Release retention hold","Release hold");
    if(!ok)return;
    await callRetentionHold({p_action:"release",p_hold_id:id,p_release_reason:reason});
}

async function saveRetentionPolicy(key) {
    if (!requireSystemAdminSession()) return;
    const policy=(retentionAdminData?.policies||[]).find(p=>p.policy_key===key);
    if(!policy){await appAlert("This rule could not be found. Refresh System Admin and try again","Unable to save","danger");return;}
    const valueInput=document.getElementById("retention-value-"+key);
    const value=valueInput?Number(valueInput.value):Number(policy.retention_value)||0;
    const enabled=document.getElementById("retention-enabled-"+key).checked;
    const reviewInput=key==="parent_family_links"?document.getElementById("retention-review-months"):null;
    const reviewMonths=reviewInput?Number(reviewInput.value):null;
    if(valueInput&&(!Number.isInteger(value)||value<0||value>120)){await appAlert("Enter a whole number from 0 to 120","Check the retention period","warning");return;}
    if(reviewInput&&(!Number.isInteger(reviewMonths)||reviewMonths<1||reviewMonths>24)){await appAlert("Enter a review period from 1 to 24 months","Check the review period","warning");return;}
    const {data,error}=await supabaseClient.rpc("update_retention_policy",{system_admin_pin:currentSystemAdminPIN,requested_policy_key:key,requested_retention_value:value,requested_retention_unit:policy.retention_unit,requested_enabled:enabled});
    if(error || data === null){await appAlert(error?.message || "System Admin verification failed. Please sign in again.","Unable to save rule","danger");closeSystemAdmin();return;}
    if(reviewInput){
      const reviewResult=await supabaseClient.rpc("update_parent_retention_review_period",{system_admin_pin:currentSystemAdminPIN,requested_review_period_months:reviewMonths});
      if(reviewResult.error||!reviewResult.data?.success){
        await refreshRetentionAdmin();
        await appAlert(reviewResult.error?.message||"The inactivity rule was saved, but the review period could not be updated. Please check it and retry.","Review period not saved","warning");
        return;
      }
    }
    await refreshRetentionAdmin("Rule saved successfully");
}
async function toggleRetentionEnforcement(key, enabled) {
    if (!requireSystemAdminSession()) return;
    const message = enabled
        ? "This enables scheduled automatic processing for this policy. Only proceed once the rule has been reviewed and approved. Continue?"
        : "Turn off automatic enforcement for this policy?";
    const ok = await appConfirm(message, "Confirm enforcement change", enabled ? "Enable enforcement" : "Disable enforcement");
    if (!ok) return;
    const { data, error } = await supabaseClient.rpc("set_retention_enforcement", {
        system_admin_pin: currentSystemAdminPIN,
        requested_policy_key: key,
        requested_enforcement: enabled
    });
    if (error || data === null) { await appAlert(error?.message || "System Admin verification failed. Please sign in again.", "Unable to change enforcement", "danger"); closeSystemAdmin(); return; }
    await refreshRetentionAdmin("Enforcement setting updated.");
}

async function runRetentionDryRun() {
    if(!requireSystemAdminSession())return;
    const target=document.getElementById("retentionDryRunResult");
    target.innerHTML='<p class="retention-running">Checking records…</p>';
    const {data,error}=await supabaseClient.rpc("run_retention_admin_check",{system_admin_pin:currentSystemAdminPIN});
    if(error || data === null){target.innerHTML='<p class="retention-error">System Admin verification failed or the preview could not be completed. Please sign in again.</p>';closeSystemAdmin();return;}
    const summary=data?.summary||data?.counts||data?.result||data||{};
    target.innerHTML='<div class="retention-preview-result"><div class="retention-preview-heading"><strong>Preview check completed successfully</strong><span>'+escapeHTML(retentionFriendlyDate(new Date().toISOString()))+'</span></div>'+renderRetentionRunSummary(summary,"dry_run")+'</div>';
    await refreshRetentionAdmin();
}
async function refreshRetentionAdmin(message) {
    if (!requireSystemAdminSession()) return;
    const { data, error } = await supabaseClient.rpc("get_retention_admin_data", {
        system_admin_pin: currentSystemAdminPIN
    });
    if (error || !data) { await appAlert(error?.message || "System Admin verification failed. Please sign in again.", "System Admin session ended", "warning"); closeSystemAdmin(); return; }
    retentionAdminData = data;
    showRetentionAdmin();
    if (message) await appAlert(message, "System Admin", "success");
}



function renderClubPolicyEditor(content) {
    const c=content||{};
    const roles=Array.isArray(c.roles)?c.roles:[];
    const accessRoles=Array.isArray(c.access_roles)?c.access_roles:[];
    const field=(id,label,value,multi=false,type="text")=>'<label class="retention-policy-field"><span>'+label+'</span>'+(multi
      ?'<textarea id="policy-'+id+'" rows="3">'+escapeHTML(value||"")+'</textarea>'
      :'<input id="policy-'+id+'" type="'+type+'" maxlength="1000" value="'+escapeHTML(value||"")+'">')+'</label>';
    const roleRows=roles.map((r,i)=>clubPolicyRoleMarkup(r.role,r.responsibility)).join("");
    return '<style>.retention-policy-editor-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px}.retention-policy-field,.retention-role-editor label{display:flex;flex-direction:column;gap:6px;font-size:13px;font-weight:600}.retention-policy-field input,.retention-policy-field textarea,.retention-role-editor input,.retention-role-editor textarea{width:100%;box-sizing:border-box;padding:10px;border:1px solid #bbb;border-radius:8px;font:inherit;background:#fff;color:#111}.retention-role-editor{display:grid;grid-template-columns:minmax(130px,.8fr) minmax(220px,2fr) auto;gap:10px;align-items:end;border:1px solid #ddd;border-radius:10px;padding:12px;margin:10px 0}.retention-role-editor button{white-space:nowrap}@media(max-width:600px){.retention-role-editor{grid-template-columns:1fr}}</style>'+
      '<details class="admin-collapse" id="club-policy-editor"><summary>Privacy policy wording — Edit public-facing wording and responsibilities</summary><div class="admin-collapse-body"><section class="retention-section"><h3>Privacy policy wording</h3>'+
      '<p>Update the public-facing wording here. Changes appear on the privacy policy page without editing website code.</p>'+
      '<div class="retention-policy-editor-grid">'+
      field("document_owner","Document owner",c.document_owner)+
      field("approval_status","Approval status",c.approval_status)+
      field("approval_date","Approval date",c.approval_date,false,"date")+
      field("draft_notice","Draft notice",c.draft_notice,true)+
      field("privacy_contact","Privacy contact wording",c.privacy_contact,true)+
      field("controller_description","Data controller name",c.controller_description)+
      field("rights_contact_instruction","Privacy requests wording",c.rights_contact_instruction,true)+
      field("incident_contact_instruction","Incident reporting wording",c.incident_contact_instruction,true)+
      field("review_frequency","Review frequency",c.review_frequency,true)+
      field("next_review","Next review date / wording",c.next_review,true)+
      '</div><h4>Who can access information?</h4><div id="club-policy-access-roles">'+accessRoles.map(r=>clubPolicyAccessRoleMarkup(r.role,r.description)).join("")+'</div>'+
      '<button class="secondary-button small-button" onclick="addClubPolicyAccessRole()">Add access role</button>'+
      '<h4>Roles and responsibilities</h4><div id="club-policy-roles">'+roleRows+'</div>'+
      '<button class="secondary-button small-button" onclick="addClubPolicyRole()">Add responsibility</button> '+
      '<button class="primary-button" onclick="saveClubPolicyContent()">Save privacy policy wording</button>'+
      '<p class="retention-manual-note">Only System Admin can change this content. Changes are recorded in the system audit log.</p></section></div></details>';
}
function clubPolicyRoleMarkup(role="",responsibility="") {
    return '<div class="retention-role-editor"><label><span>Role / contact</span><input class="policy-role-name" maxlength="100" value="'+escapeHTML(role)+'"></label><label><span>Responsibility</span><textarea class="policy-role-responsibility" rows="3" maxlength="600">'+escapeHTML(responsibility)+'</textarea></label><button class="red-button small-button" type="button" onclick="this.parentElement.remove()">Remove</button></div>';
}
function addClubPolicyRole() {
    if(!requireSystemAdminSession())return;
    const list=document.getElementById("club-policy-roles");
    if(!list)return;
    if(list.querySelectorAll(".retention-role-editor").length>=12){appAlert("A maximum of 12 responsibility entries is allowed.","Role limit","warning");return;}
    list.insertAdjacentHTML("beforeend",clubPolicyRoleMarkup("",""));
}
function clubPolicyAccessRoleMarkup(role="",description="") {
    return '<div class="retention-role-editor"><label><span>Access group</span><input class="policy-access-role-name" maxlength="100" value="'+escapeHTML(role)+'"></label><label><span>What they can access</span><textarea class="policy-access-role-description" rows="3" maxlength="500">'+escapeHTML(description)+'</textarea></label><button class="red-button small-button" type="button" onclick="this.parentElement.remove()">Remove</button></div>';
}
function addClubPolicyAccessRole() {
    if(!requireSystemAdminSession())return;
    const list=document.getElementById("club-policy-access-roles");
    if(!list)return;
    if(list.querySelectorAll(".retention-role-editor").length>=10){appAlert("A maximum of 10 access groups is allowed.","Role limit","warning");return;}
    list.insertAdjacentHTML("beforeend",clubPolicyAccessRoleMarkup("",""));
}
async function saveClubPolicyContent() {
    if(!requireSystemAdminSession())return;
    const get=id=>document.getElementById("policy-"+id)?.value?.trim()||"";
    const roles=[];
    document.querySelectorAll("#club-policy-roles .retention-role-editor").forEach(row=>{
      roles.push({
        role:row.querySelector(".policy-role-name")?.value?.trim()||"",
        responsibility:row.querySelector(".policy-role-responsibility")?.value?.trim()||""
      });
    });
    if(roles.some(r=>!r.role)){await appAlert("Every role needs a name. Remove unused rows before saving.","Check the role list","warning");return;}
    const access_roles=[];
    document.querySelectorAll("#club-policy-access-roles .retention-role-editor").forEach(row=>{
      access_roles.push({
        role:row.querySelector(".policy-access-role-name")?.value?.trim()||"",
        description:row.querySelector(".policy-access-role-description")?.value?.trim()||""
      });
    });
    if(access_roles.some(r=>!r.role)){await appAlert("Every access group needs a name. Remove unused rows before saving.","Check access groups","warning");return;}
    const approvalStatus=get("approval_status");
    const approvalDate=get("approval_date");
    if(/^approved\b/i.test(approvalStatus) && !approvalDate){
      await appAlert("An approval date is required when the status is Approved.","Approval date required","warning");return;
    }
    if(approvalDate && !/^approved\b/i.test(approvalStatus)){
      await appAlert("Set the approval status to Approved before entering an approval date.","Check approval status","warning");return;
    }
    const content={
      access_roles,
      document_owner:get("document_owner"),
      approval_status:approvalStatus,
      approval_date:approvalDate,
      draft_notice:get("draft_notice"),
      privacy_contact:get("privacy_contact"),
      controller_description:get("controller_description"),
      rights_contact_instruction:get("rights_contact_instruction"),
      incident_contact_instruction:get("incident_contact_instruction"),
      review_frequency:get("review_frequency"),
      next_review:get("next_review"),
      roles
    };
    const {data,error}=await supabaseClient.rpc("update_club_policy_content",{
      system_admin_pin:currentSystemAdminPIN,requested_content:content
    });
    if(error || data === null){await appAlert(error?.message || "System Admin verification failed. Please sign in again.","Unable to save policy wording","danger");closeSystemAdmin();return;}
    await refreshRetentionAdmin("Privacy policy wording saved.");
}

 
// =========================================================
// CENTRAL SECURITY AUDIT LOG
// =========================================================

async function loadSystemAdminAuditLog(cursor = null, navigation = "reset") {
    if (!requireSystemAdminSession()) return;
    if (navigation === "reset") {
        systemAdminAuditCursorHistory = [];
        systemAdminAuditAllEntries = null;
        systemAdminAuditAllPromise = null;
        cursor = null;
    } else if (navigation === "next") {
        systemAdminAuditCursorHistory.push(systemAdminAuditCursor);
    } else if (navigation === "previous") {
        cursor = systemAdminAuditCursorHistory.pop() ?? null;
    }
    const { data, error } = await supabaseClient.rpc("get_system_admin_audit_log_page", {
        supplied_pin: currentSystemAdminPIN,
        requested_limit: 201,
        before_occurred_at: cursor?.occurred_at ?? null,
        before_id: cursor?.id ?? null
    });
    if (error || !Array.isArray(data)) {
        console.error("Security audit log load failed:", error);
        await appAlert("The security log could not be loaded. Your System Admin session may have expired.", "Unable to load security log", "warning");
        closeSystemAdmin();
        return;
    }
    systemAdminAuditCursor = cursor;
    systemAdminAuditHasMore = data.length > 200;
    systemAdminAuditEntries = data.slice(0, 200);
    showSystemAdminAuditLog();
}

function showSystemAdminAuditLog() {
    if (!requireSystemAdminSession()) return;
    const entries = Array.isArray(systemAdminAuditEntries) ? systemAdminAuditEntries : [];
    const unique = field => [...new Set(entries.map(item => String(item[field] || "")).filter(Boolean))].sort();
    const options = (values, label) =>
        '<option value="">All ' + label + '</option>' +
        values.map(value => '<option value="' + escapeHTML(value) + '">' +
            escapeHTML(value.replace(/_/g, " ")) + '</option>').join("");

    renderShell(
        '<div class="card retention-admin security-audit-page">' +
        '<button class="back-button" onclick="showRetentionAdmin()">← System Admin</button>' +
        '<div class="retention-heading"><div><h2>Security Audit Log</h2><div class="subtitle">Browse the complete retained security history, 200 events per page.</div></div>' +
        '<button class="secondary-button small-button" onclick="loadSystemAdminAuditLog(null, \'reset\')">Refresh</button></div>' +
        '<style>' +
        '.audit-filter-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:10px;margin:16px 0}' +
        '.audit-filter-grid label{display:flex;flex-direction:column;gap:5px;font-size:12px;font-weight:600}' +
        '.audit-filter-grid select,.audit-filter-grid input{width:100%;box-sizing:border-box;padding:9px;border:1px solid var(--border,#ccc);border-radius:7px;background:var(--card,#fff);color:inherit}' +
        '.audit-event{border:1px solid var(--border,#ddd);border-radius:9px;padding:12px;margin:10px 0}' +
        '.audit-event-head{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap}' +
        '.audit-event-title{font-weight:700;text-transform:capitalize;overflow-wrap:anywhere}' +
        '.audit-event-meta{font-size:12px;opacity:.75;margin-top:5px;line-height:1.5}' +
        '.audit-severity{display:inline-block;border-radius:20px;padding:3px 8px;font-size:11px;font-weight:700;text-transform:uppercase;background:#e8e8e8;color:#222}' +
        '.audit-severity.warning{background:#fff0c2;color:#704d00}.audit-severity.critical,.audit-severity.error{background:#f8d7da;color:#842029}' +
        '.audit-event details{margin-top:9px}.audit-event pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:11px;background:rgba(127,127,127,.10);padding:9px;border-radius:6px;max-height:220px;overflow:auto}' +
        '.audit-hold-action{display:grid;grid-template-columns:minmax(0,1fr);gap:10px;margin-top:12px;min-width:0}' +
        '.audit-hold-form{display:grid;grid-template-columns:minmax(0,1fr);gap:12px;padding:14px;margin-top:10px;border:1px solid var(--border,#ddd);border-radius:9px;min-width:0;box-sizing:border-box}' +
        '.audit-hold-form label{display:grid!important;grid-template-columns:minmax(0,1fr)!important;grid-auto-flow:row!important;align-items:stretch!important;gap:6px;min-width:0;width:100%;font-size:13px;font-weight:600;line-height:1.4;box-sizing:border-box}' +
        '.audit-hold-form input,.audit-hold-form select,.audit-hold-form textarea{display:block!important;position:static!important;float:none!important;width:100%!important;max-width:100%!important;min-width:0!important;margin:0!important;box-sizing:border-box;padding:11px;border:1px solid var(--border,#ccc);border-radius:7px;background:var(--card,#fff);color:inherit;font:inherit;font-weight:400}' +
        '.audit-hold-form textarea{resize:vertical;min-height:90px}' +
        '.audit-hold-form .wide{grid-column:1/-1}' +
        '.audit-hold-form button{width:100%;min-height:44px;white-space:normal}' +
        '@media(min-width:650px){.audit-hold-form{grid-template-columns:repeat(2,minmax(0,1fr))}.audit-hold-form .wide{grid-column:1/-1}.audit-hold-form button{width:auto;justify-self:start}}' +
        '.audit-empty{padding:20px;text-align:center;opacity:.7}' +
        '.retention-audit-launch{display:flex;justify-content:space-between;align-items:center;gap:14px;flex-wrap:wrap;padding:14px;border:1px solid var(--border,#ddd);border-radius:9px;margin:16px 0}' +
        '.retention-audit-launch p{margin:5px 0 0;font-size:13px;opacity:.75}' +
        '</style>' +
        '<div class="audit-filter-grid">' +
        '<label>Application<select id="auditSourceFilter" onchange="filterSystemAdminAuditLog()">' + options(unique("source_system"), "applications") + '</select></label>' +
        '<label>Severity<select id="auditSeverityFilter" onchange="filterSystemAdminAuditLog()">' + options(unique("severity"), "severities") + '</select></label>' +
        '<label>Outcome<select id="auditOutcomeFilter" onchange="filterSystemAdminAuditLog()">' + options(unique("outcome"), "outcomes") + '</select></label>' +
        '<label>Search event<input id="auditEventSearch" type="search" placeholder="e.g. PIN, fixture" oninput="filterSystemAdminAuditLog()"></label>' +
        '</div>' +
        '<div id="systemAdminAuditResult"></div>' +
        '<div class="audit-pagination" style="display:flex;justify-content:space-between;gap:10px;align-items:center;margin:16px 0;flex-wrap:wrap">' +
        '<button class="secondary-button" onclick="loadSystemAdminAuditLog(null, \'previous\')" ' + (systemAdminAuditCursorHistory.length ? '' : 'disabled') + '>← Newer records</button>' +
        '<span class="subtitle">200 records per page</span>' +
        '<button class="secondary-button" onclick="loadSystemAdminAuditLog({occurred_at: systemAdminAuditEntries[systemAdminAuditEntries.length-1]?.occurred_at, id: systemAdminAuditEntries[systemAdminAuditEntries.length-1]?.id}, \'next\')" ' + (systemAdminAuditHasMore ? '' : 'disabled') + '>Older records →</button>' +
        '</div>' +
        '<button class="secondary-button" onclick="showRetentionAdmin()">Back to System Admin</button>' +
        '</div>'
    );
    filterSystemAdminAuditLog();
}


function getAuditRetentionHoldTarget(item) {
    if (!item) return null;

    if (item.source_system === "match_availability_parent_portal") {
        return {
            policyKey: "parent_portal_security_audit",
            targetTable: "system_admin_audit_log",
            targetReference: String(item.id),
            label: "Parent Portal security audit event",
            key: "system_admin_audit_log|" + String(item.id)
        };
    }

    if (
        item.source_system === "club_check_in" &&
        item.actor_type === "installation" &&
        /^INSTALL-[a-f0-9-]{20,}$/i.test(String(item.actor_reference || ""))
    ) {
        return {
            policyKey: "security_logs",
            targetTable: "system_admin_audit_log",
            targetReference: String(item.id),
            label: "Security audit event " + String(item.reference_number || ("SEC-" + String(item.id).padStart(8, "0"))),
            key: "system_admin_audit_log|" + String(item.id)
        };
    }

    return null;
}

async function openAuditRetentionHold(auditId) {
    if (!requireSystemAdminSession()) return;
    const item = (systemAdminAuditAllEntries || systemAdminAuditEntries).find(entry => Number(entry.id) === Number(auditId));
    const targetInfo = getAuditRetentionHoldTarget(item);
    if (!item || !targetInfo) {
        await appAlert("This audit entry is not linked to a record that supports retention holds.", "Cannot place hold", "warning");
        return;
    }

    const existingHold = (retentionAdminData?.holds || []).find(hold =>
        hold.status === "active" &&
        hold.target_table === targetInfo.targetTable &&
        String(hold.target_reference) === targetInfo.targetReference
    );
    if (existingHold) {
        await appAlert("This record is already protected by an active retention hold.", "Already protected", "info");
        return;
    }

    const target = document.getElementById("audit-hold-form-" + Number(auditId));
    if (!target) return;
    target.innerHTML =
        '<div class="retention-hold-form audit-hold-form">' +
        '<p class="subtitle wide">Holding ' + escapeHTML(item.reference_number || ("SEC-" + String(item.id).padStart(8, "0"))) + ' — ' + escapeHTML(targetInfo.label) + '</p>' +
        '<label>Reason category<select id="audit-hold-category-' + Number(auditId) + '">' +
        '<option value="safeguarding">Safeguarding</option><option value="insurance">Insurance</option><option value="legal">Legal</option><option value="incident" selected>Incident</option></select></label>' +
        '<label>Review due date<input type="date" id="audit-hold-date-' + Number(auditId) + '" min="' + new Date().toISOString().slice(0,10) + '"></label>' +
        '<label class="wide">Reason for retaining this record<textarea id="audit-hold-reason-' + Number(auditId) + '" rows="3" maxlength="2000" placeholder="Explain why this record must be retained"></textarea></label>' +
        '<div class="wide"><button class="primary-button small-button" onclick="submitAuditRetentionHold(' + Number(auditId) + ')">Save retention hold</button> ' +
        '<button class="secondary-button small-button" onclick="document.getElementById(\'audit-hold-form-' + Number(auditId) + '\').innerHTML=\'\'">Cancel</button></div></div>';
}

async function submitAuditRetentionHold(auditId) {
    if (!requireSystemAdminSession()) return;
    const item = (systemAdminAuditAllEntries || systemAdminAuditEntries).find(entry => Number(entry.id) === Number(auditId));
    const targetInfo = getAuditRetentionHoldTarget(item);
    if (!item || !targetInfo) return;

    const category = document.getElementById("audit-hold-category-" + auditId)?.value || "";
    const reason = document.getElementById("audit-hold-reason-" + auditId)?.value?.trim() || "";
    const review = document.getElementById("audit-hold-date-" + auditId)?.value || "";
    if (!review || reason.length < 10) {
        await appAlert("Choose a review date and enter a reason of at least 10 characters.", "Complete the hold details", "warning");
        return;
    }
    const reviewDate = new Date(review + "T23:59:00");
    if (Number.isNaN(reviewDate.getTime()) || reviewDate <= new Date()) {
        await appAlert("Choose a future review date.", "Check review date", "warning");
        return;
    }

    const { data, error } = await supabaseClient.rpc("manage_retention_hold", {
        p_system_admin_pin: currentSystemAdminPIN,
        p_action: "create",
        p_policy_key: targetInfo.policyKey,
        p_target_table: targetInfo.targetTable,
        p_target_reference: targetInfo.targetReference,
        p_category: category,
        p_reason: reason,
        p_review_due_at: reviewDate.toISOString()
    });

    if (error || data === null) {
        await appAlert(error?.message || "System Admin verification failed. Please sign in again.", "Retention hold not created", "danger");
        if (data === null) closeSystemAdmin();
        return;
    }
    if (!data.success) {
        await appAlert(data.message || "The retention hold could not be created.", "Unable to create hold", "warning");
        return;
    }

    await refreshRetentionAdmin();
    await appAlert("Retention hold created for " + (item.reference_number || ("SEC-" + String(item.id).padStart(8, "0"))) + ".", "Retention hold created", "success");
    await loadSystemAdminAuditLog(systemAdminAuditCursor, "stay");
}

async function loadAllSystemAdminAuditEntries() {
    if (Array.isArray(systemAdminAuditAllEntries)) return systemAdminAuditAllEntries;
    if (systemAdminAuditAllPromise) return systemAdminAuditAllPromise;

    systemAdminAuditAllLoading = true;
    systemAdminAuditAllPromise = (async () => {
        const all = [];
        let cursor = null;
        while (true) {
            if (!requireSystemAdminSession()) throw new Error("System Admin session expired.");
            const { data, error } = await supabaseClient.rpc("get_system_admin_audit_log_page", {
                supplied_pin: currentSystemAdminPIN,
                requested_limit: 201,
                before_occurred_at: cursor?.occurred_at ?? null,
                before_id: cursor?.id ?? null
            });
            if (error || !Array.isArray(data)) throw new Error(error?.message || "The complete audit history could not be loaded.");
            const page = data.slice(0, 200);
            all.push(...page);
            if (data.length <= 200) break;
            const last = page[page.length - 1];
            if (!last || (cursor && last.id === cursor.id)) throw new Error("Audit history paging stopped unexpectedly.");
            cursor = { occurred_at: last.occurred_at, id: last.id };
        }
        systemAdminAuditAllEntries = all;
        return all;
    })();

    try {
        return await systemAdminAuditAllPromise;
    } finally {
        systemAdminAuditAllLoading = false;
        systemAdminAuditAllPromise = null;
    }
}

function refreshSystemAdminAuditFilterOptions(entries) {
    const update = (id, field, label) => {
        const select = document.getElementById(id);
        if (!select) return;
        const selected = select.value;
        const values = [...new Set(entries.map(item => String(item[field] || "")).filter(Boolean))].sort();
        select.innerHTML = '<option value="">All ' + label + '</option>' +
            values.map(value => '<option value="' + escapeHTML(value) + '">' +
                escapeHTML(value.replace(/_/g, " ")) + '</option>').join("");
        select.value = values.includes(selected) ? selected : "";
    };
    update("auditSourceFilter", "source_system", "applications");
    update("auditSeverityFilter", "severity", "severities");
    update("auditOutcomeFilter", "outcome", "outcomes");
}

async function filterSystemAdminAuditLog() {
    const source = document.getElementById("auditSourceFilter")?.value || "";
    const severity = document.getElementById("auditSeverityFilter")?.value || "";
    const outcome = document.getElementById("auditOutcomeFilter")?.value || "";
    const search = (document.getElementById("auditEventSearch")?.value || "").trim().toLowerCase();
    const target = document.getElementById("systemAdminAuditResult");
    if (!target) return;
    if (!Array.isArray(systemAdminAuditAllEntries)) {
        target.innerHTML = '<div class="audit-empty">Loading all pages of the retained security history…</div>';
        try {
            const all = await loadAllSystemAdminAuditEntries();
            refreshSystemAdminAuditFilterOptions(all);
            const pagination = document.querySelector(".audit-pagination");
            if (pagination) pagination.style.display = "none";
        } catch (error) {
            target.innerHTML = '<div class="audit-empty">Could not search all audit pages. ' + escapeHTML(error.message || "Please refresh and try again.") + '</div>';
            return;
        }
    }
    const filtered = systemAdminAuditAllEntries.filter(item =>
        (!source || item.source_system === source) &&
        (!severity || item.severity === severity) &&
        (!outcome || item.outcome === outcome) &&
        (!search || [item.reference_number, item.event_type, item.actor_reference, item.source_system].some(value => String(value || "").toLowerCase().includes(search)))
    );
    if (!filtered.length) {
        target.innerHTML = '<div class="audit-empty">No security events match these filters.</div>';
        return;
    }
    target.innerHTML = '<div class="subtitle">' + filtered.length + ' matching event(s) across all ' + systemAdminAuditAllEntries.length + ' retained records</div>' +
        filtered.map(item => {
            const title = String(item.event_type || "Unknown event").replace(/[_-]+/g, " ");
            const details = item.details && typeof item.details === "object"
                ? JSON.stringify(item.details, null, 2) : String(item.details || "{}");
            const meta = [
                item.reference_number ? "Record ref: " + item.reference_number : "Record ref: SEC-" + String(item.id).padStart(8, "0"),
                item.source_system,
                item.actor_type ? "Actor: " + item.actor_type : "",
                item.actor_reference ? "Actor reference: " + item.actor_reference : ""
            ].filter(Boolean).join(" · ");
            return '<article class="audit-event">' +
                '<div class="audit-event-head"><div><div class="audit-event-title">' + escapeHTML(title) + '</div>' +
                '<div class="audit-event-meta">' + escapeHTML(retentionFriendlyDate(item.occurred_at)) + '<br>' + escapeHTML(meta) +
                '</div></div><div><span class="audit-severity ' + escapeHTML(String(item.severity || "info").toLowerCase()) + '">' +
                escapeHTML(item.severity || "info") + '</span><div class="audit-event-meta">Outcome: ' + escapeHTML(item.outcome || "unknown") + '</div></div></div>' +
                '<details><summary>Event details</summary><pre>' + escapeHTML(details) + '</pre></details>' +
                (getAuditRetentionHoldTarget(item)
                    ? '<div class="audit-hold-action"><button class="secondary-button small-button" onclick="openAuditRetentionHold(' + Number(item.id) + ')">Place retention hold</button><div id="audit-hold-form-' + Number(item.id) + '"></div></div>'
                    : '') +
                '</article>';
        }).join("");
}
