/* =========================================================
   FIRST-AIDER MANAGEMENT
   System Admin only. Volunteers are not app users.
   ========================================================= */

let firstAiderAdminData = null;

function firstAiderEscape(value) {
    return escapeHTML(String(value ?? ""));
}

async function loadFirstAiderAdminData() {
    if (!requireSystemAdminSession()) return false;
    const { data, error } = await supabaseClient.rpc("get_first_aider_admin_data", {
        system_admin_pin: currentSystemAdminPIN
    });
    if (error || !data) {
        await appAlert("Unable to load first-aider information. Please try again.", "First-aider data unavailable", "danger");
        return false;
    }
    firstAiderAdminData = data;
    return true;
}

async function showFirstAiderManagement() {
    if (!requireSystemAdminSession()) return;
    if (!await loadFirstAiderAdminData()) return;
    renderFirstAiderManagement();
}

function renderFirstAiderManagement() {
    if (!requireSystemAdminSession() || !firstAiderAdminData) return;
    const groups = (firstAiderAdminData.age_groups || []).filter(g => g.active);
    const volunteers = firstAiderAdminData.volunteers || [];
    const activeVolunteers = volunteers.filter(v => v.active);
    const coverage = groups.map(group => {
        const main = [], shared = [];
        activeVolunteers.forEach(volunteer => (volunteer.assignments || []).forEach(assignment => {
            if (Number(assignment.age_group_id) !== Number(group.id)) return;
            (assignment.is_main ? main : shared).push(volunteer.name);
        }));
        return { group, main, shared };
    });
    const coverageRows = coverage.map(item => {
        const covered = item.main.length > 0;
        return '<tr><th scope="row">' + firstAiderEscape(firstAiderGroupLabel(item.group)) + '</th>' +
            '<td>' + (covered ? item.main.map(firstAiderEscape).join(", ") : "No main cover assigned") + '</td>' +
            '<td>' + (item.shared.length ? item.shared.map(firstAiderEscape).join(", ") : "—") + '</td>' +
            '<td><span class="' + (covered ? "fa-status-covered" : "fa-status-gap") + '">' +
            (covered ? "Covered" : "Gap") + '</span></td></tr>';
    }).join("");
    const volunteerHtml = volunteers.map(volunteer => {
        const assignments = volunteer.assignments || [];
        const main = assignments.find(a => a.is_main);
        const additional = assignments.filter(a => !a.is_main);
        return '<article class="fa-volunteer-card"><div class="fa-volunteer-heading"><div><strong>' +
            firstAiderEscape(volunteer.name) + '</strong>' +
            (volunteer.is_dummy ? ' <span class="fa-dummy">DUMMY</span>' : '') +
            '<div class="fa-volunteer-state">' + (volunteer.active ? "Active" : "Inactive") + '</div></div>' +
            '<div class="fa-volunteer-actions">' +
            '<button class="secondary-button small-button" onclick="editFirstAider(' + Number(volunteer.id) + ')">Edit</button>' +
            '<button class="secondary-button small-button" onclick="toggleFirstAiderActive(' + Number(volunteer.id) + ',' + (!volunteer.active) + ')">' +
            (volunteer.active ? "Deactivate" : "Reactivate") + '</button></div></div>' +
            '<div class="fa-assignment-summary"><b>Main:</b> ' +
            (main ? firstAiderEscape(firstAiderGroupLabel(main)) : "Not assigned") +
            '<br><b>Additional/shared:</b> ' +
            (additional.length ? additional.map(a => firstAiderEscape(firstAiderGroupLabel(a))).join(", ") : "None") +
            '</div></article>';
    }).join("");
    const dummyCount = volunteers.filter(v => v.is_dummy).length;
    renderShell(
        '<div class="card system-admin-home fa-admin"><style>' +
        '.fa-admin{max-width:920px;margin:0 auto;padding:clamp(14px,3vw,26px)}' +
        '.fa-admin .fa-section{margin:18px 0 0;padding:16px;border:1px solid var(--border,#ddd);border-radius:12px;background:var(--card,#fff)}' +
        '.fa-admin .fa-section h3{margin:0 0 12px;font-size:17px}.fa-volunteer-list{display:grid;gap:10px}' +
        '.fa-coverage-table-wrap{width:100%;overflow-x:auto}.fa-coverage-table{width:100%;border-collapse:collapse;font-size:13px;min-width:480px}' +
        '.fa-coverage-table th,.fa-coverage-table td{padding:11px 10px;text-align:left;vertical-align:middle;border-bottom:1px solid var(--border,#ddd)}' +
        '.fa-coverage-table thead th{font-size:12px;opacity:.75;font-weight:700}.fa-coverage-table tbody th{font-weight:800;white-space:nowrap}' +
        '.fa-volunteer-card{padding:13px;border:1px solid var(--border,#ddd);border-radius:10px;background:var(--background,#fafafa)}' +
        '.fa-volunteer-heading{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}' +
        '.fa-status-covered,.fa-status-gap,.fa-dummy{display:inline-block;font-size:11px;font-weight:800;border-radius:20px;padding:4px 9px;white-space:nowrap}' +
        '.fa-status-covered{background:#e4f3e8;color:#176b37}.fa-status-gap{background:#fff0d8;color:#865400}.fa-dummy{background:#fff0d8;color:#865400}' +
        '.fa-volunteer-state{font-size:12px;opacity:.7;margin-top:4px}.fa-assignment-summary{font-size:13px;line-height:1.55;margin-top:10px}' +
        '.fa-volunteer-actions{display:flex;gap:6px;flex-wrap:wrap}.fa-volunteer-actions button{width:auto;min-height:34px}' +
        '.fa-dummy-note{padding:11px;border-radius:9px;background:rgba(180,130,20,.10);font-size:13px;line-height:1.45}' +
        '@media(max-width:560px){.fa-admin{padding:12px}.fa-volunteer-heading{flex-direction:column}.fa-volunteer-actions{width:100%}.fa-volunteer-actions button{flex:1}}' +
        '</style><button class="back-button" onclick="showRetentionAdmin()">← System Admin</button>' +
        '<div class="retention-heading"><div><h2>First-Aider Management</h2><div class="subtitle">Manage volunteer cover by age group</div></div></div>' +
        '<section class="fa-section"><h3>First-aider gap analysis</h3>' +
        '<p class="subtitle">An age group is covered only when it has an active first aider assigned as its main group. Additional/shared cover is shown separately and does not close a gap.</p>' +
        '<div class="fa-coverage-table-wrap"><table class="fa-coverage-table"><thead><tr>' +
        '<th scope="col">Age group</th><th scope="col">Main cover</th><th scope="col">Additional/shared cover</th><th scope="col">Status</th>' +
        '</tr></thead><tbody>' + (coverageRows || '<tr><td colspan="4">No active age groups found.</td></tr>') +
        '</tbody></table></div></section><section class="fa-section">' +
        '<div class="retention-heading"><h3>First-aider volunteers</h3><button class="primary-button small-button" onclick="showFirstAiderForm()">Add first aider</button></div>' +
        (dummyCount ? '<div class="fa-dummy-note"><b>Sample records are present.</b> DUMMY entries are demonstration data only. They can be edited here and are cleared from the System Admin DUMMY Data tool.</div>' : '') +
        '<div class="fa-volunteer-list">' + (volunteerHtml || '<div class="empty">No first-aider volunteers have been added.</div>') +
        '</div></section></div>'
    );
}


function firstAiderGroupLabel(group) {
    return group.display_name || group.age_group || "";
}

function showFirstAiderForm(volunteer) {
    if (!requireSystemAdminSession() || !firstAiderAdminData) return;
    const groups = (firstAiderAdminData.age_groups || []).filter(g => g.active);
    if (!groups.length) {
        appAlert("There are no active age groups available.", "No age groups", "warning");
        return;
    }
    const assignments = volunteer ? (volunteer.assignments || []) : [];
    const main = assignments.find(a => a.is_main);
    const mainId = main ? Number(main.age_group_id) : Number(groups[0].id);
    const options = groups.map(g => '<option value="' + Number(g.id) + '" ' +
        (Number(g.id) === mainId ? "selected" : "") + '>' +
        firstAiderEscape(firstAiderGroupLabel(g)) + '</option>').join("");
    const additionalRows = groups.filter(g => Number(g.id) !== mainId).map(g => {
        const existing = assignments.find(a => Number(a.age_group_id) === Number(g.id) && !a.is_main);
        const groupId = Number(g.id);
        return '<label class="fa-additional-row" for="fa-extra-' + groupId + '">' +
            '<input type="checkbox" id="fa-extra-' + groupId + '" ' + (existing ? "checked" : "") + '>' +
            '<span>' + firstAiderEscape(firstAiderGroupLabel(g)) + '</span></label>';
    }).join("");
    renderShell(
        '<div class="card season-planner-shell sp-event-editor-page fa-editor-page">' +
        '<button class="back-button" onclick="renderFirstAiderManagement()">← First-Aider Management</button>' +
        '<div class="sp-editor-page-heading"><div><h2>' + (volunteer ? "Edit first aider" : "Add first aider") +
        '</h2><p>Set the volunteer’s main age group and any additional/shared cover.</p></div></div>' +
        '<section class="sp-form-panel"><div class="form-group"><label for="fa-name">Volunteer name</label>' +
        '<input id="fa-name" type="text" maxlength="80" autocomplete="off" value="' +
        firstAiderEscape(volunteer ? volunteer.name : "") + '" placeholder="Enter volunteer name"></div>' +
        '<div class="form-group"><label for="fa-main-group">Main age group</label><select id="fa-main-group">' +
        options + '</select></div><div class="form-group fa-additional-section"><label>Additional/shared cover</label>' +
        '<p class="sp-field-hint">Select any additional age groups this volunteer can cover.</p>' +
        '<div class="fa-additional-list">' + (additionalRows || '<div class="sp-empty">No other active age groups.</div>') +
        '</div></div><div class="sp-editor-actions"><button class="primary-button" onclick="saveFirstAider(' +
        (volunteer ? Number(volunteer.id) : "null") + ')">Save first aider</button>' +
        '<button class="secondary-button" onclick="renderFirstAiderManagement()">Cancel</button></div></section></div>'
    );
}


function editFirstAider(id) {
    if (!requireSystemAdminSession() || !firstAiderAdminData) return;
    const volunteer = (firstAiderAdminData.volunteers || []).find(v => Number(v.id) === Number(id));
    if (!volunteer) return;
    showFirstAiderForm(volunteer);
}

async function saveFirstAider(id) {
    if (!requireSystemAdminSession()) return;
    let name = (document.getElementById("fa-name")?.value || "").trim();
    const existingVolunteer = id === null ? null : (firstAiderAdminData?.volunteers || []).find(v => Number(v.id) === Number(id));
    if (existingVolunteer?.is_dummy && !/^DUMMY\b/i.test(name)) name = "DUMMY - " + name;
    const mainGroup = Number(document.getElementById("fa-main-group")?.value);
    if (!name || name.length > 80 || !mainGroup) {
        await appAlert("Enter a volunteer name and select a main age group.", "Check the details", "warning");
        return;
    }
    const additional = [];
    (firstAiderAdminData.age_groups || []).filter(g => g.active && Number(g.id) !== mainGroup).forEach(g => {
        const check = document.getElementById("fa-extra-" + Number(g.id));
        if (check?.checked) {
            additional.push({
                age_group_id: Number(g.id),
                pitch: ""
            });
        }
    });
    const { data, error } = await supabaseClient.rpc("save_first_aider", {
        system_admin_pin: currentSystemAdminPIN,
        requested_id: id === null ? null : Number(id),
        requested_name: name,
        requested_main_age_group_id: mainGroup,
        requested_main_pitch: "",
        requested_additional_assignments: additional
    });
    if (error || !data || data.success !== true) {
        await appAlert("The first-aider details could not be saved. Please check the information and try again.", "Save failed", "danger");
        return;
    }
    await appAlert("First-aider details saved.", "Saved", "success");
    await showFirstAiderManagement();
}

async function toggleFirstAiderActive(id, active) {
    if (!requireSystemAdminSession()) return;
    const action = active ? "reactivate" : "deactivate";
    if (!await appConfirm("Are you sure you want to " + action + " this first aider?", "Confirm " + action, action === "deactivate" ? "Deactivate" : "Reactivate")) return;
    const { data, error } = await supabaseClient.rpc("set_first_aider_active", {
        system_admin_pin: currentSystemAdminPIN,
        requested_id: Number(id),
        requested_active: Boolean(active)
    });
    if (error || !data || data.success !== true) {
        await appAlert("The first-aider status could not be changed.", "Update failed", "danger");
        return;
    }
    await showFirstAiderManagement();
}

// Explicitly expose the entry point used by the System Admin button.
window.showFirstAiderManagement = showFirstAiderManagement;
