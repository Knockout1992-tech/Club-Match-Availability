/* =========================================================
   SYSTEM-WIDE DUMMY DATA MANAGEMENT
   System Admin only. Preview first; destructive action requires confirmation.
   ========================================================= */

let dummyDataSummary = null;

const dummyDataLabels = [
    ["players", "Players"],
    ["attendance_records", "Attendance records linked to DUMMY players"],
    ["attendance_registers_affected", "Attendance registers affected"],
    ["match_fixtures", "Match fixtures"],
    ["match_submissions", "Parent submissions"],
    ["match_availability", "Match availability responses"],
    ["season_planner_events", "Season planner events"],
    ["season_planner_schedules", "Recurring schedules"],
    ["season_planner_breaks", "Holidays and breaks"],
    ["seasons", "Seasons"],
    ["first_aider_volunteers", "First-aider volunteers"],
    ["coach_notifications", "Queued coach notifications"]
];

async function showDummyDataManagement() {
    if (!requireSystemAdminSession()) return;
    const { data, error } = await supabaseClient.rpc("get_dummy_data_summary", {
        system_admin_pin: currentSystemAdminPIN
    });
    if (error || !data) {
        await appAlert("Unable to load the DUMMY data summary. Please try again.", "DUMMY data unavailable", "danger");
        return;
    }
    dummyDataSummary = data;
    renderDummyDataManagement();
}

function renderDummyDataManagement() {
    if (!requireSystemAdminSession() || !dummyDataSummary) return;
    const total = dummyDataLabels.reduce((sum, item) => sum + Number(dummyDataSummary[item[0]] || 0), 0);
    const rows = dummyDataLabels.map(item => {
        const count = Number(dummyDataSummary[item[0]] || 0);
        return '<div class="dummy-data-row"><span>' + escapeHTML(item[1]) +
            '</span><strong>' + count.toLocaleString("en-GB") + '</strong></div>';
    }).join("");

    renderShell(
        '<div class="card retention-admin dummy-data-admin">' +
        '<style>' +
        '.dummy-data-admin{max-width:850px;margin:0 auto}' +
        '.dummy-data-intro{font-size:14px;line-height:1.5;margin:12px 0}' +
        '.dummy-data-list{border:1px solid var(--border,#ddd);border-radius:10px;overflow:hidden;margin:16px 0}' +
        '.dummy-data-row{display:flex;justify-content:space-between;gap:14px;padding:11px 13px;border-bottom:1px solid var(--border,#ddd);font-size:13px}' +
        '.dummy-data-row:last-child{border-bottom:0}.dummy-data-row strong{font-variant-numeric:tabular-nums}' +
        '.dummy-data-protected{padding:13px;border-radius:9px;background:rgba(30,120,70,.08);font-size:13px;line-height:1.5;margin:14px 0}' +
        '.dummy-data-warning{padding:13px;border-radius:9px;background:rgba(180,130,20,.12);font-size:13px;line-height:1.5;margin:14px 0}' +
        '.dummy-data-actions{display:flex;gap:9px;flex-wrap:wrap;margin-top:16px}.dummy-data-actions button{flex:1;min-width:150px}' +
        '</style>' +
        '<button class="back-button" onclick="showRetentionAdmin()">← System Admin</button>' +
        '<h2>DUMMY Data Management</h2>' +
        '<p class="dummy-data-intro">This is a database-wide review of demonstration records. Only records whose designated identifying field starts with DUMMY are selected, together with their dependent demonstration records.</p>' +
        '<div class="dummy-data-list">' + rows +
        '<div class="dummy-data-row"><span><b>Total selected operational records</b></span><strong>' + total.toLocaleString("en-GB") + '</strong></div>' +
        '</div>' +
        '<div class="dummy-data-protected"><b>Protected and not deleted</b><br>User and Parent accounts, access credentials, installations, sessions, age-group configuration, personal-data cases, security logs, audit history, retention policies, retention runs and retention holds.</div>' +
        '<div class="dummy-data-warning"><b>Safety checks</b><br>The cleanup runs as one database transaction. Active retention holds, a current DUMMY season, genuine attendance in a DUMMY season, or genuine responses linked to a DUMMY parent/fixture will stop the entire cleanup. Mixed attendance registers are retained and their historical totals recalculated. Genuine player and parent records are not selected by name matching alone.</div>' +
        '<div class="dummy-data-actions">' +
        '<button class="secondary-button" onclick="showDummyDataManagement()">Refresh preview</button>' +
        '<button class="red-button" onclick="clearAllDummyData()" ' + (total ? '' : 'disabled') + '>Clear all DUMMY data</button>' +
        '</div></div>'
    );
}

async function clearAllDummyData() {
    if (!requireSystemAdminSession() || !dummyDataSummary) return;
    const total = dummyDataLabels.reduce((sum, item) => sum + Number(dummyDataSummary[item[0]] || 0), 0);
    if (!total) return;

    const confirmed = await appConfirm(
        "This will permanently remove the DUMMY demonstration records shown in the preview across the operational database. Genuine records, access/security data, audit history, retention configuration and held records are protected. Mixed attendance registers will be retained.\n\nContinue?",
        "Clear all DUMMY data?",
        "Clear DUMMY data"
    );
    if (!confirmed) return;

    const { data, error } = await supabaseClient.rpc("clear_dummy_data", {
        system_admin_pin: currentSystemAdminPIN
    });
    if (error || !data || data.success !== true) {
        await appAlert(error?.message || "The DUMMY records could not be cleared. No partial cleanup is retained.", "DUMMY cleanup stopped", "danger");
        await showDummyDataManagement();
        return;
    }

    const deleted = data.deleted || {};
    const removed = Object.entries(deleted)
        .filter(([key, value]) => !key.includes("recalculated") && Number(value) > 0)
        .reduce((sum, [, value]) => sum + Number(value), 0);
    await appAlert(
        "DUMMY cleanup completed. " + removed.toLocaleString("en-GB") +
        " operational records were removed. Attendance history for mixed registers was recalculated where required.",
        "DUMMY data cleared",
        "success"
    );
    await showDummyDataManagement();
}

window.showDummyDataManagement = showDummyDataManagement;
