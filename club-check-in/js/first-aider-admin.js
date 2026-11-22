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

function firstAiderAssignmentLabel(assignment) {
    return firstAiderEscape(assignment.age_group) +
        (assignment.is_main ? " (main)" : " (shared)") +
        (assignment.pitch ? " — " + firstAiderEscape(assignment.pitch) : "");
}

function renderFirstAiderManagement() {
    if (!requireSystemAdminSession() || !firstAiderAdminData) return;
    const groups = (firstAiderAdminData.age_groups || []).filter(g => g.active);
    const volunteers = firstAiderAdminData.volunteers || [];
    const activeVolunteers = volunteers.filter(v => v.active);
    const coverage = groups.map(group => {
        const main = [];
        const shared = [];
        activeVolunteers.forEach(volunteer => {
            (volunteer.assignments || []).forEach(assignment => {
                if (Number(assignment.age_group_id) !== Number(group.id)) return;
                (assignment.is_main ? main : shared).push({
                    name: volunteer.name,
                    pitch: assignment.pitch
                });
            });
        });
        return { group, main, shared };
    });
    const coverageHtml = coverage.map(item => {
        const status = item.main.length ? "Covered" : "GAP";
        const mainText = item.main.length
            ? item.main.map(x => firstAiderEscape(x.name) + (x.pitch ? " — " + firstAiderEscape(x.pitch) : "")).join(", ")
            : "No main first-aider assigned";
        const sharedText = item.shared.length
            ? item.shared.map(x => firstAiderEscape(x.name) + (x.pitch ? " — " + firstAiderEscape(x.pitch) : "")).join(", ")
            : "None";
        return '<article class="fa-coverage-card">' +
            '<div class="fa-coverage-top"><strong>' + firstAiderEscape(firstAiderGroupLabel(item.group)) + '</strong>' +
            '<span class="' + (item.main.length ? "fa-status-covered" : "fa-status-gap") + '">' + status + '</span></div>' +
            '<p><b>Main cover:</b> ' + mainText + '</p>' +
            '<p><b>Additional/shared cover:</b> ' + sharedText + '</p>' +
            (!item.main.length && item.shared.length ? '<p class="fa-gap-note">Shared cover does not remove this gap.</p>' : '') +
            '</article>';
    }).join("");

    const volunteerHtml = volunteers.map(volunteer => {
        const assignments = volunteer.assignments || [];
        const main = assignments.find(a => a.is_main);
        const additional = assignments.filter(a => !a.is_main);
        const assignmentText = [
            main ? '<b>Main:</b> ' + firstAiderAssignmentLabel(main) : '<b>Main:</b> Not assigned',
            additional.length ? '<b>Additional:</b> ' + additional.map(firstAiderAssignmentLabel).join("; ") : '<b>Additional:</b> None'
        ].join("<br>");
        return '<article class="fa-volunteer-card">' +
            '<div class="fa-volunteer-heading"><div><strong>' + firstAiderEscape(volunteer.name) + '</strong>' +
            (volunteer.is_dummy ? ' <span class="fa-dummy">DUMMY</span>' : '') +
            '<div class="fa-volunteer-state">' + (volunteer.active ? "Active" : "Inactive") + '</div></div>' +
            (!volunteer.is_dummy ? '<div class="fa-volunteer-actions">' +
                '<button class="secondary-button small-button" onclick="editFirstAider(' + Number(volunteer.id) + ')">Edit</button>' +
                '<button class="secondary-button small-button" onclick="toggleFirstAiderActive(' + Number(volunteer.id) + ',' + (!volunteer.active) + ')">' +
                (volunteer.active ? "Deactivate" : "Reactivate") + '</button></div>' : '') +
            '</div><div class="fa-assignment-summary">' + assignmentText + '</div></article>';
    }).join("");

    const dummyCount = volunteers.filter(v => v.is_dummy).length;
    renderShell(
        '<div class="card system-admin-home fa-admin">' +
        '<style>' +
        '.fa-admin{max-width:920px;margin:0 auto;padding:clamp(14px,3vw,26px)}' +
        '.fa-admin .fa-section{margin:18px 0 0;padding:16px;border:1px solid var(--border,#ddd);border-radius:12px;background:var(--card,#fff)}' +
        '.fa-admin .fa-section h3{margin:0 0 12px;font-size:17px}' +
        '.fa-coverage-grid,.fa-volunteer-list{display:grid;gap:10px}' +
        '.fa-coverage-card,.fa-volunteer-card{padding:13px;border:1px solid var(--border,#ddd);border-radius:10px;background:var(--background,#fafafa)}' +
        '.fa-coverage-top,.fa-volunteer-heading{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}' +
        '.fa-coverage-card p{font-size:13px;line-height:1.45;margin:8px 0 0}' +
        '.fa-status-covered,.fa-status-gap,.fa-dummy{font-size:11px;font-weight:800;border-radius:20px;padding:4px 9px;white-space:nowrap}' +
        '.fa-status-covered{background:#e4f3e8;color:#176b37}.fa-status-gap{background:#fff0d8;color:#865400}' +
        '.fa-gap-note{color:#865400;font-weight:700}.fa-dummy{background:#fff0d8;color:#865400}' +
        '.fa-volunteer-state{font-size:12px;opacity:.7;margin-top:4px}.fa-assignment-summary{font-size:13px;line-height:1.55;margin-top:10px}' +
        '.fa-volunteer-actions{display:flex;gap:6px;flex-wrap:wrap}.fa-volunteer-actions button{width:auto;min-height:34px}' +
        '.fa-form-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.fa-field{display:flex;flex-direction:column;gap:5px;margin:10px 0}.fa-field label{font-size:13px;font-weight:700}' +
        '.fa-field input,.fa-field select{width:100%;box-sizing:border-box;padding:11px;border:1px solid var(--border,#ccc);border-radius:8px;background:var(--card,#fff);color:inherit}' +
        '.fa-extra-row{display:grid;grid-template-columns:auto minmax(0,1fr);align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border,#ddd)}' +
        '.fa-extra-row label{font-size:13px}.fa-extra-row input[type=text]{width:100%;min-width:0;box-sizing:border-box;padding:8px;border:1px solid var(--border,#ccc);border-radius:7px;background:var(--card,#fff);color:inherit}' +
        '.fa-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}.fa-dummy-note{padding:11px;border-radius:9px;background:rgba(180,130,20,.10);font-size:13px;line-height:1.45}' +
        '@media(max-width:560px){.fa-admin{padding:12px}.fa-form-grid{grid-template-columns:1fr}.fa-volunteer-heading{flex-direction:column}.fa-volunteer-actions{width:100%}.fa-volunteer-actions button{flex:1}}' +
        '</style>' +
        '<button class="back-button" onclick="showRetentionAdmin()">← System Admin</button>' +
        '<div class="retention-heading"><div><h2>First-Aider Management</h2><div class="subtitle">Manage volunteer cover by age group and pitch</div></div></div>' +
        '<section class="fa-section"><h3>Age-group coverage</h3>' +
        '<p class="subtitle">An age group is covered only when it has an active first-aider assigned as its main group. Additional/shared cover is shown separately and does not close a gap.</p>' +
        '<div class="fa-coverage-grid">' + (coverageHtml || '<div class="empty">No active age groups found.</div>') + '</div></section>' +
        '<section class="fa-section"><div class="retention-heading"><h3>First-aider volunteers</h3><button class="primary-button small-button" onclick="showFirstAiderForm()">Add first aider</button></div>' +
        (dummyCount ? '<div class="fa-dummy-note"><b>Sample records are present.</b> DUMMY entries are demonstration data only and are not real volunteers. Use the clear button below when finished reviewing.</div>' : '') +
        '<div class="fa-volunteer-list">' + (volunteerHtml || '<div class="empty">No first-aider volunteers have been added.</div>') + '</div>' +
        (dummyCount ? '<div class="fa-actions"><button class="red-button small-button" onclick="clearDummyFirstAiderData()">Clear DUMMY sample data</button></div>' : '') +
        '</section></div>'
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
        (Number(g.id) === mainId ? "selected" : "") + '>' + firstAiderEscape(firstAiderGroupLabel(g)) + '</option>').join("");
    const additionalRows = groups.filter(g => Number(g.id) !== mainId).map(g => {
        const existing = assignments.find(a => Number(a.age_group_id) === Number(g.id) && !a.is_main);
        return '<div class="fa-extra-row"><label><input type="checkbox" id="fa-extra-' + Number(g.id) + '" ' +
            (existing ? "checked" : "") + '> ' + firstAiderEscape(firstAiderGroupLabel(g)) + '</label>' +
            '<input type="text" id="fa-pitch-' + Number(g.id) + '" maxlength="80" placeholder="Optional pitch" value="' +
            firstAiderEscape(existing ? existing.pitch || "" : "") + '"></div>';
    }).join("");
    renderShell(
        '<div class="card system-admin-home fa-admin">' +
        '<button class="back-button" onclick="renderFirstAiderManagement()">← First-Aider Management</button>' +
        '<h2>' + (volunteer ? "Edit first aider" : "Add first aider") + '</h2>' +
        '<div class="subtitle">Each volunteer has one main age group. Other selected groups are additional/shared cover.</div>' +
        '<div class="fa-field"><label for="fa-name">Volunteer name</label><input id="fa-name" type="text" maxlength="80" autocomplete="off" value="' +
        firstAiderEscape(volunteer ? volunteer.name : "") + '" placeholder="Enter volunteer name"></div>' +
        '<div class="fa-form-grid"><div class="fa-field"><label for="fa-main-group">Main age group</label><select id="fa-main-group">' + options + '</select></div>' +
        '<div class="fa-field"><label for="fa-main-pitch">Main group pitch (optional)</label><input id="fa-main-pitch" type="text" maxlength="80" value="' +
        firstAiderEscape(main ? main.pitch || "" : "") + '" placeholder="e.g. Pitch 1"></div></div>' +
        '<div class="fa-field"><label>Additional/shared age groups and optional pitch</label>' +
        (additionalRows || '<div class="subtitle">No other active age groups.</div>') + '</div>' +
        '<div class="fa-actions"><button class="primary-button" onclick="saveFirstAider(' + (volunteer ? Number(volunteer.id) : "null") + ')">Save first aider</button>' +
        '<button class="secondary-button" onclick="renderFirstAiderManagement()">Cancel</button></div>' +
        '</div>'
    );
}

function editFirstAider(id) {
    if (!requireSystemAdminSession() || !firstAiderAdminData) return;
    const volunteer = (firstAiderAdminData.volunteers || []).find(v => Number(v.id) === Number(id));
    if (!volunteer || volunteer.is_dummy) return;
    showFirstAiderForm(volunteer);
}

async function saveFirstAider(id) {
    if (!requireSystemAdminSession()) return;
    const name = (document.getElementById("fa-name")?.value || "").trim();
    const mainGroup = Number(document.getElementById("fa-main-group")?.value);
    const mainPitch = (document.getElementById("fa-main-pitch")?.value || "").trim();
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
                pitch: (document.getElementById("fa-pitch-" + Number(g.id))?.value || "").trim()
            });
        }
    });
    const { data, error } = await supabaseClient.rpc("save_first_aider", {
        system_admin_pin: currentSystemAdminPIN,
        requested_id: id === null ? null : Number(id),
        requested_name: name,
        requested_main_age_group_id: mainGroup,
        requested_main_pitch: mainPitch,
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

async function clearDummyFirstAiderData() {
    if (!requireSystemAdminSession()) return;
    if (!await appConfirm("This permanently deletes only the clearly marked DUMMY first-aider sample records. Real volunteer records will not be touched.", "Clear sample data", "Clear DUMMY data")) return;
    const { data, error } = await supabaseClient.rpc("clear_dummy_first_aider_data", {
        system_admin_pin: currentSystemAdminPIN
    });
    if (error || !data || data.success !== true) {
        await appAlert("The DUMMY sample data could not be cleared.", "Cleanup failed", "danger");
        return;
    }
    await appAlert("DUMMY sample records cleared: " + Number(data.deleted || 0) + ".", "Sample data cleared", "success");
    await showFirstAiderManagement();
}
