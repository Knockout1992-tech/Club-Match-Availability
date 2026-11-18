
 // Find Players ===========================

function findPlayerByID(playerID) {

    for (const ageGroup of ageGroups) {

        if (!players[ageGroup]) {
            continue;
        }

        const player =
            players[ageGroup].find(
                player =>
                    String(player.id) === String(playerID)
            );

        if (player) {
            return player;
        }

    }

    return null;

}


// Active Players =================================

function getActivePlayers(ageGroup) {

    if (!players[ageGroup]) {
        return [];
    }

    return players[ageGroup]
        .filter(player =>
            player.active &&
            !player.archived
        );

}


// All active player ==========================

function getAllActivePlayers() {

    let result = [];

    ageGroups.forEach(ageGroup => {

        getActivePlayers(ageGroup)
            .forEach(player => {

                result.push(player);

            });

    });

    return result;

}


// Age group needs GMS Confirmation ===================================

function ageGroupNeedsGMSConfirmation(ageGroup) {

    return getActivePlayers(ageGroup)
        .some(player => !player.gms);

}


// Add Player =========================================

async function addPlayerToAgeGroup(ageGroup, name, gms) {

    // Require a valid logged-in role and PIN.
    let suppliedCode = null;

    if (currentRole === "coach") {
        suppliedCode = currentAccessPIN;
    } else if (currentRole === "senior") {
        suppliedCode = currentSeniorPIN;
    }

    if (!suppliedCode) {
        await appAlert(
            "Please log in again before adding a player.",
            "Login required",
            "warning"
        );
        return null;
    }

    const playerID = crypto.randomUUID();

    // Create the player through the PIN-protected database function.
    const {
        data,
        error
    } = await supabaseClient.rpc(
        "create_player",
        {
            requested_player_id: playerID,
            requested_name: name,
            requested_age_group: ageGroup,
            requested_gms: gms,
            supplied_code: suppliedCode,
            supplied_role: currentRole
        }
    );

    if (error) {
        console.error(
            "Supabase player creation failed:",
            error
        );

        await appAlert(
            "Unable to add the player. Please try again.",
            "Player creation failed",
            "danger"
        );
        return null;
    }

    // The function returns a table, so expect one returned row.
    if (!Array.isArray(data) || data.length !== 1) {
        console.error(
            "Player creation was not confirmed by the database:",
            data
        );

        await appAlert(
            "The player could not be created. " +
            "Please check your login and try again.",
            "Player not created",
            "danger"
        );

        return null;
    }

    const savedPlayer = data[0];

    // Update the local roster using the saved database record.
    const newPlayer = {
        id: savedPlayer.player_id,
        name: savedPlayer.name,
        ageGroup: savedPlayer.age_group,
        gms: savedPlayer.gms,
        coachGmsSuggestion: savedPlayer.coach_gms_suggestion,
        active: savedPlayer.active,
        archived: savedPlayer.archived,
        lastAttendanceDate: savedPlayer.last_attendance_date
    };

    if (!players[savedPlayer.age_group]) {
        players[savedPlayer.age_group] = [];
    }

    players[savedPlayer.age_group].push(newPlayer);

    saveData();

    // Check today's destination register through the protected RPC.
    const todayKey = getTodayKey();

    const {
        data: registerRows,
        error: registerError
    } = await supabaseClient.rpc(
        "get_today_register_status",
        {
            requested_date: todayKey,
            requested_age_group: ageGroup,
            supplied_code: suppliedCode,
            supplied_role: currentRole
        }
    );

    if (registerError) {
        console.error(
            "Player created, but today's register could not be checked:",
            registerError
        );

        await appAlert(
            "The player was added to the roster, but today's register " +
            "could not be checked. Please ask the Coach to check attendance.",
            "Register check failed",
            "warning"
        );

        return newPlayer;
    }

    if (!Array.isArray(registerRows) || registerRows.length > 1) {
        console.error(
            "Unexpected response when checking today's register:",
            registerRows
        );

        await appAlert(
            "The player was added to the roster, but today's register " +
            "could not be verified.",
            "Register not verified",
            "warning"
        );

        return newPlayer;
    }

    // No returned row means no register exists for this date and age group.
    const register = registerRows.length === 1
        ? registerRows[0]
        : null;

    // Add them only when today's register exists and remains open.
    // Do not create a register automatically.
    if (
        register &&
        !register.submitted &&
        !register.closed_automatically
    ) {

        const {
            data: added,
            error: addError
        } = await supabaseClient.rpc(
            "add_player_to_attendance_register",
            {
                requested_register_id: register.id,
                requested_player_id: savedPlayer.player_id,
                supplied_code: suppliedCode,
                supplied_role: currentRole
            }
        );

        if (addError || added !== true) {
            console.error(
                "Player created, but register addition failed:",
                addError || added
            );

            await appAlert(
                "The player was added to the roster, but could not be " +
                "added to today's open register. Please check attendance " +
                "before marking them present.",
                "Attendance update failed",
                "warning"
            );

            return newPlayer;
        }

        // Keep the in-memory register in sync if it is loaded.
        const loadedRegister = getTodayRegister(ageGroup);

        if (
            loadedRegister &&
            String(loadedRegister.id) === String(register.id)
        ) {
            loadedRegister.attendance[savedPlayer.player_id] = false;
        }
    }

    return newPlayer;
}

// Senior Set GMS ========================

async function setGMS(playerID, confirmed) {

    try {
        const player = findPlayerByID(playerID);

        if (!player) {
            throw new Error("Player not found.");
        }

        const data = await managePlayerRecord(
            "set_gms",
            playerID,
            { value: confirmed }
        );

        player.gms = data.gms;
        player.coachGmsSuggestion = data.coach_gms_suggestion;

        saveData();

        showPlayerManagement(player.ageGroup);

    } catch (error) {

        console.error("GMS update failed:", error);

        await appAlert(
            "Unable to update GMS. Please check your Senior login and try again.",
            "GMS update failed",
            "danger"
        );

    }

}

// Set Coach GMS Suggestion =====================================

async function setCoachGMSSuggestion(playerID, suggested) {

    try {
        const player = findPlayerByID(playerID);

        if (!player) {
            throw new Error("Player not found.");
        }

        const data = await managePlayerRecord(
            "set_coach_suggestion",
            playerID,
            { value: suggested }
        );

        player.coachGmsSuggestion = data.coach_gms_suggestion;

        saveData();

        showRoster();

    } catch (error) {

        console.error("Coach GMS suggestion failed:", error);

        await appAlert(
            "Unable to update the GMS suggestion. Please check your Coach login and try again.",
            "GMS suggestion failed",
            "danger"
        );

    }

}

// Archive Player =============================================

async function archivePlayer(playerID, returnTo) {

    const player = findPlayerByID(playerID);

    if (!player) return;

    const confirmed = await appConfirm(
        "Archive " + player.name + "?\n\n" +
        "Their historical attendance will be retained.\n" +
        "They will disappear from active registers.",
        "Archive player?",
        "Archive player"
    );

    if (!confirmed) return;

    try {

        const data = await managePlayerRecord(
            "archive",
            playerID
        );

        player.active = data.active;
        player.archived = data.archived;
        player.coachGmsSuggestion = data.coach_gms_suggestion;

        saveData();

        if (returnTo === "playerManagement") {
            showPlayerManagement(player.ageGroup);
        } else {
            showArchiveReview();
        }

    } catch (error) {

        console.error("Player archive failed:", error);

        await appAlert(
            "Unable to archive the player. Please try again.",
            "Archive failed",
            "danger"
        );

    }

}

// Coach Restore Player ====================================

async function restoreArchivedPlayer(
    playerID,
    fromRoster = false,
    rosterAgeGroup = null
) {

    const player = findPlayerByID(playerID);

    if (!player) return;

    const groups = rosterAgeGroup
        ? [rosterAgeGroup]
        : (selectedAgeGroups.length ? selectedAgeGroups : [currentAgeGroup]);

    if (!groups.length) {
        await appAlert(
            "Please select an age group first.",
            "Age group required",
            "warning"
        );
        return;
    }

    let targetAgeGroup = groups[0];

    if (groups.length > 1) {

        const select = document.getElementById("targetAgeGroup");

        if (!select || !select.value) {
            await appAlert(
                "Please select the age group to restore the player to.",
                "Age group required",
                "warning"
            );
            return;
        }

        targetAgeGroup = select.value;

    }

    let register = null;

    if (!fromRoster) {

        register = getTodayRegister(targetAgeGroup);

        if (
            !register ||
            register.submitted ||
            register.closedAutomatically
        ) {
            await appAlert(
                "Today's register is not open for " + targetAgeGroup + ".",
                "Register unavailable",
                "warning"
            );
            return;
        }

    }

    const confirmed = await appConfirm(
        "Restore " + player.name + " to " + targetAgeGroup + "?\n\n" +
        "Their historical attendance will be retained.\n" +
        (fromRoster
            ? "They will be added to the roster but NOT marked as present today.\n"
            : "They will be marked as PRESENT today.\n") +
        "GMS will be reset and require Senior confirmation.",
        "Restore player?",
        "Restore player"
    );

    if (!confirmed) return;

    try {

        const data = await managePlayerRecord(
            "restore",
            playerID,
            { ageGroup: targetAgeGroup }
        );

        ageGroups.forEach(ageGroup => {

            if (players[ageGroup]) {
                players[ageGroup] = players[ageGroup].filter(
                    item => String(item.id) !== String(player.id)
                );
            }

        });

        player.ageGroup = data.age_group;
        player.active = data.active;
        player.archived = data.archived;
        player.gms = data.gms;
        player.coachGmsSuggestion = data.coach_gms_suggestion;
        player.lastAttendanceDate = data.last_attendance_date;

        if (!players[targetAgeGroup]) {
            players[targetAgeGroup] = [];
        }

        players[targetAgeGroup].push(player);

        if (!fromRoster) {
            register.attendance[player.id] = true;
            player.lastAttendanceDate = getTodayKey();
        }

        saveData();

        if (fromRoster) {
            showRoster();
        } else {
            showRegister();
        }

    } catch (error) {

        console.error("Player restore failed:", error);

        await appAlert(
            "Unable to restore the player. Please try again.",
            "Restore failed",
            "danger"
        );

    }

}

// Senior Restore Player ====================================

async function seniorRestorePlayer(playerID) {

    const player = findPlayerByID(playerID);

    if (!player) {
        await appAlert(
            "Player could not be found.",
            "Player not found",
            "danger"
        );
        return;
    }

    const select = document.getElementById("seniorRestoreAgeGroup");

    if (!select || !select.value) {
        await appAlert(
            "Please select an age group.",
            "Age group required",
            "warning"
        );
        return;
    }

    const targetAgeGroup = select.value;

    const confirmed = await appConfirm(
        "Restore " + player.name + " to " + targetAgeGroup + "?\n\n" +
        "Their historical attendance will be retained.\n\n" +
        "They will NOT be marked as attending today.",
        "Restore player?",
        "Restore player"
    );

    if (!confirmed) return;

    try {

        const data = await managePlayerRecord(
            "restore",
            playerID,
            { ageGroup: targetAgeGroup }
        );

        ageGroups.forEach(ageGroup => {

            if (players[ageGroup]) {
                players[ageGroup] = players[ageGroup].filter(
                    item => String(item.id) !== String(player.id)
                );
            }

        });

        player.ageGroup = data.age_group;
        player.active = data.active;
        player.archived = data.archived;
        player.gms = data.gms;
        player.coachGmsSuggestion = data.coach_gms_suggestion;
        player.lastAttendanceDate = data.last_attendance_date;

        if (!players[targetAgeGroup]) {
            players[targetAgeGroup] = [];
        }

        players[targetAgeGroup].push(player);

        saveData();

        showPlayerManagement(targetAgeGroup);

    } catch (error) {

        console.error("Senior player restore failed:", error);

        await appAlert(
            "Unable to restore the player. Please try again.",
            "Restore failed",
            "danger"
        );

    }

}

// Move Player =======================================

async function movePlayer(playerID) {

    if (currentRole !== "senior" || !currentSeniorPIN) {
        await appAlert(
            "Please log in as Senior again.",
            "Senior login required",
            "warning"
        );
        return;
    }

    const player = findPlayerByID(playerID);

    if (!player) return;

    const select = document.getElementById("moveTargetAgeGroup");

    if (!select || !select.value) return;

    const targetAgeGroup = select.value;

    if (targetAgeGroup === player.ageGroup) return;

    const confirmed = await appConfirm(
        "Move " + player.name + " from " + player.ageGroup +
        " to " + targetAgeGroup + "?\n\n" +
        "Their attendance history will be retained.",
        "Move player?",
        "Move player"
    );

    if (!confirmed) return;

    try {

        const data = await managePlayerRecord(
            "move",
            playerID,
            { ageGroup: targetAgeGroup }
        );

        if (players[player.ageGroup]) {
            players[player.ageGroup] = players[player.ageGroup].filter(
                item => String(item.id) !== String(player.id)
            );
        }

        player.ageGroup = data.age_group;

        if (!players[targetAgeGroup]) {
            players[targetAgeGroup] = [];
        }

        players[targetAgeGroup].push(player);

        saveData();

        // Check today's target register through the protected RPC.
        const todayKey = getTodayKey();

        const {
            data: registerRows,
            error: registerError
        } = await supabaseClient.rpc(
            "get_today_register_status",
            {
                requested_date: todayKey,
                requested_age_group: targetAgeGroup,
                supplied_code: currentSeniorPIN,
                supplied_role: "senior"
            }
        );

        if (registerError) throw registerError;

        if (
            !Array.isArray(registerRows) ||
            registerRows.length > 1
        ) {
            throw new Error(
                "Unexpected response when checking today's register."
            );
        }

        const register = registerRows.length === 1
            ? registerRows[0]
            : null;

        if (
            register &&
            !register.submitted &&
            !register.closed_automatically
        ) {

            const {
                data: added,
                error: addError
            } = await supabaseClient.rpc(
                "add_player_to_attendance_register",
                {
                    requested_register_id: register.id,
                    requested_player_id: playerID,
                    supplied_code: currentSeniorPIN,
                    supplied_role: "senior"
                }
            );

            if (addError) throw addError;

            if (added !== true) {
                throw new Error(
                    "Could not add the player to today's register."
                );
            }

        }

        showPlayerManagement(targetAgeGroup);

    } catch (error) {

        console.error("Player move failed:", error);

        await appAlert(
            "The player may have been moved, but a later register step failed. " +
            "Check the roster and today's register before retrying.",
            "Move partially completed",
            "warning"
        );

    }

}

// Rename players =======================================

async function renamePlayer(playerID) {

    showChangePlayerName(playerID);

}

// Helper =============================================

async function managePlayerRecord(
    action,
    playerID,
    options = {}
) {

    const role = currentRole;

    const code =
        role === "senior" ? currentSeniorPIN :
        role === "coach" ? currentAccessPIN :
        null;

    if (!code || !role) {
        throw new Error("Please log in again.");
    }

    const {
        data,
        error
    } = await supabaseClient.rpc(
        "manage_player",
        {
            supplied_code: code,
            supplied_role: role,
            requested_action: action,
            requested_player_id: String(playerID),
            requested_name: options.name ?? null,
            requested_age_group: options.ageGroup ?? null,
            requested_boolean: options.value ?? null
        }
    );

    if (error) throw error;

    if (!Array.isArray(data) || data.length !== 1) {
        throw new Error(
            "The database rejected the change or returned no player."
        );
    }

    return data[0];

}

// Show Change Player Name ===================================

async function showChangePlayerName(playerID) {

    const player = findPlayerByID(playerID);

    if (!player) {
        await appAlert(
            "Player could not be found.",
            "Player not found",
            "danger"
        );
        return;
    }

    renderShell(`

        <div class="card">

            <button
                class="back-button"
                onclick='${currentRole === "senior"
                    ? `showPlayerManagement(${JSON.stringify(player.ageGroup)})`
                    : "showRoster()"}'>

                ← Back

            </button>

            <h2>Change Player Name</h2>

            <label for="updatedPlayerName">
                Player name
            </label>

            <input
                type="text"
                id="updatedPlayerName"
                maxlength="100"
                autocomplete="off"
                placeholder="Enter player name"
            >

            <button
                class="blue-button small-button"
                onclick='savePlayerName(
                    ${JSON.stringify(playerID)}
                )'>

                Save Name

            </button>

            <div
                id="changePlayerNameMessage"
                class="info-box">
            </div>

        </div>

    `);

    const nameInput =
        document.getElementById("updatedPlayerName");

    if (nameInput) {
        nameInput.value = player.name;
        nameInput.focus();
        nameInput.select();
    }

}

// Save Player Name =====≈=======================================

async function savePlayerName(playerID) {

    const nameInput =
        document.getElementById("updatedPlayerName");

    if (!nameInput) {
        await appAlert(
            "Unable to find the player name input.",
            "Input unavailable",
            "danger"
        );
        return;
    }

    const name = nameInput.value.trim();

    if (!name) {
        await appAlert(
            "Player name cannot be blank.",
            "Name required",
            "warning"
        );
        nameInput.focus();
        return;
    }

    const player = findPlayerByID(playerID);

    if (!player) {
        await appAlert(
            "Player could not be found.",
            "Player not found",
            "danger"
        );
        return;
    }

    if (name === player.name) {
        if (currentRole === "senior") {
            showPlayerManagement(player.ageGroup);
        } else {
            showRoster();
        }
        return;
    }

    const confirmed = await appConfirm(
        "Change the player name from:\n\n" +
        player.name + "\n\nto:\n\n" + name + "?",
        "Change player name?",
        "Save name"
    );

    if (!confirmed) return;

    try {

        const data = await managePlayerRecord(
            "rename",
            playerID,
            { name: name }
        );

        player.name = data.name;

        saveData();

        if (currentRole === "senior") {
            await showPlayerManagement(player.ageGroup);
        } else {
            await showRoster();
        }

    } catch (error) {

        console.error("Player rename failed:", error);

        await appAlert(
            "Unable to change the player name. " +
            (error.message || "Please try again."),
            "Rename failed",
            "danger"
        );

    }

}
