
/* =========================================================
   STORAGE / PERSISTENCE
   ========================================================= */


/* =========================================================
   LOAD SAVED DATA
   ========================================================= */

function loadSavedData() {

    try {

        const rawData =
            localStorage.getItem("clubCheckInData");

        if (rawData) {

            const saved = JSON.parse(rawData);

            if (
                saved.players &&
                typeof saved.players === "object"
            ) {
                players = saved.players;
            }

            if (
                saved.dailyRegisters &&
                typeof saved.dailyRegisters === "object"
            ) {
                dailyRegisters = saved.dailyRegisters;
            }

            if (
                typeof saved.currentSeason === "string" &&
                saved.currentSeason
            ) {
                currentSeason = saved.currentSeason;
            }

        }

        // Ensure every age group has a player array.
        ageGroups.forEach(ageGroup => {

            if (!Array.isArray(players[ageGroup])) {
                players[ageGroup] = [];
            }

        });

        // Normalise player properties.
        Object.values(players).forEach(ageGroupPlayers => {

            if (!Array.isArray(ageGroupPlayers)) {
                return;
            }

            ageGroupPlayers.forEach(player => {

                if (
                    typeof player.coachGmsSuggestion !== "boolean"
                ) {
                    player.coachGmsSuggestion =
                        !!player.gms;
                }

                if (typeof player.archived !== "boolean") {
                    player.archived = false;
                }

                if (typeof player.active !== "boolean") {
                    player.active = !player.archived;
                }

                if (
                    typeof player.lastAttendanceDate === "undefined"
                ) {
                    player.lastAttendanceDate = null;
                }

            });

        });

        if (
            !dailyRegisters ||
            typeof dailyRegisters !== "object" ||
            Array.isArray(dailyRegisters)
        ) {
            dailyRegisters = {};
        }

        backfillLastAttendanceDates();
} catch (error) {

        console.error(
            "Saved data could not be loaded:",
            error
        );

    }

}


/* =========================================================
   BACKFILL LAST ATTENDANCE DATES
   ========================================================= */

function backfillLastAttendanceDates() {

    Object.keys(dailyRegisters).forEach(dateKey => {

        const day = dailyRegisters[dateKey];

        if (!day || typeof day !== "object") {
            return;
        }

        Object.keys(day).forEach(ageGroup => {

            const register = day[ageGroup];

            if (
                !register ||
                !register.attendance ||
                typeof register.attendance !== "object"
            ) {
                return;
            }

            Object.keys(register.attendance).forEach(playerID => {

                if (register.attendance[playerID] !== true) {
                    return;
                }

                const player = findPlayerByID(playerID);

                if (!player) {
                    return;
                }

                if (
                    !player.lastAttendanceDate ||
                    dateKey > player.lastAttendanceDate
                ) {
                    player.lastAttendanceDate = dateKey;
                }

            });

        });

    });

}


/* =========================================================
   SAVE DATA
   ========================================================= */

function saveData() {

    try {

        const saved = {

            players:
                players,

            dailyRegisters:
                dailyRegisters,

            currentSeason:
                currentSeason

        };

        localStorage.setItem(
            "clubCheckInData",
            JSON.stringify(saved)
        );
} catch (error) {

        console.error(
            "Failed to save local data:",
            error
        );

        throw error;

    }

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
