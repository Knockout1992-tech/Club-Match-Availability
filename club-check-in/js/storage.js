/* =========================================================
   STORAGE / PERSISTENCE
   ========================================================= */

/*
 * Player and attendance information must only live in memory while an
 * authorised session is active. Supabase is the source of truth.
 *
 * Keep the legacy function names because existing player/season workflows
 * still call saveData(). They now only remove the old browser-side cache.
 */

function clearLegacyLocalData() {
    try {
        localStorage.removeItem("clubCheckInData");
    } catch (error) {
        console.warn("Legacy local player data could not be cleared:", error);
    }
}

function clearSensitiveAppData() {
    players = {};

    if (typeof dailyRegisters !== "undefined") {
        dailyRegisters = {};
    }

    if (typeof attendanceRegisters !== "undefined") {
        attendanceRegisters = {};
    }

    clearLegacyLocalData();
}

/*
 * Compatibility: startup still calls loadSavedData(), but no personal data
 * is restored from localStorage. The legacy cache is deleted instead.
 */
function loadSavedData() {
    clearLegacyLocalData();
}

/*
 * Compatibility: existing workflows call saveData() after successful
 * Supabase updates. Do not persist the in-memory roster to localStorage.
 */
function saveData() {
    clearLegacyLocalData();
}


/* =========================================================
   LOAD PLAYERS FROM SUPABASE
   ========================================================= */


async function loadPlayersFromSupabase() {
    try {
        const suppliedRole = currentRole;

        const suppliedCode =
            suppliedRole === "senior"
                ? currentSeniorPIN
                : suppliedRole === "coach"
                    ? currentAccessPIN
                    : null;

        if (!suppliedCode || !suppliedRole) {
            console.error("Player load requires an authorised role.");
            return false;
        }

        const { data, error } = await supabaseClient.rpc(
            "load_players",
            {
                supplied_code: suppliedCode,
                supplied_role: suppliedRole
            }
        );

        if (error) throw error;

        if (!Array.isArray(data)) {
            throw new Error("Invalid players result.");
        }

        players = {};

        data.forEach(player => {
            if (!players[player.age_group]) {
                players[player.age_group] = [];
            }

            players[player.age_group].push({
                id: player.player_id,
                name: player.name,
                ageGroup: player.age_group,
                gms: player.gms,
                coachGmsSuggestion: player.coach_gms_suggestion,
                active: player.active,
                archived: player.archived,
                lastAttendanceDate: player.last_attendance_date
            });
        });

        ageGroups.forEach(ageGroup => {
            if (!Array.isArray(players[ageGroup])) {
                players[ageGroup] = [];
            }
        });
return true;

    } catch (error) {
        console.error("Player load failed:", error.message);
        return false;
    }
}
