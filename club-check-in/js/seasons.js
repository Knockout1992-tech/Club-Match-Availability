/* =========================================================
   SEASONS - SUPABASE BACKEND
   ========================================================= */


/* =========================================================
   LOAD CURRENT SEASON FROM SUPABASE
   ========================================================= */

async function loadCurrentSeasonFromSupabase() {

    try {

        const { data, error } =
            await supabaseClient
                .from("seasons")
                .select("season_name")
                .eq("is_current", true)
                .maybeSingle();

        if (error) {
            throw error;
        }

        if (!data || !data.season_name) {

            throw new Error(
                "No current season is marked in Supabase."
            );

        }

        currentSeason = data.season_name;

        saveData();
return true;

    } catch (error) {

        console.error(
            "Failed to load current season from Supabase:",
            error
        );

        return false;

    }

}


/* =========================================================
   GET NEXT SEASON
   ========================================================= */

function getNextSeason(season) {

    const parts = season.split("/");

    const start = parseInt(parts[0], 10);

    const end = parseInt(parts[1], 10);

    return (
        start + 1
    ) + "/" + (
        String(end + 1).slice(-2)
    );

}


/* =========================================================
   START NEW SEASON
   ========================================================= */

async function performNewSeason(nextSeason, coachAssignments, expectedCurrentSeason) {

    const startYear = Number(String(nextSeason).split("/")[0]);
    const startDate = startYear + "-08-01";

    const { data, error } = await supabaseClient.rpc(
        "rollover_season_with_coaches_secure",
        {
            supplied_code: currentSeniorPIN,
            supplied_installation_id: getInstallationID(),
            expected_current_season: expectedCurrentSeason,
            new_season_name: nextSeason,
            new_start_date: startDate,
            coach_assignments: coachAssignments
        }
    );

    if (error) {
        console.error("Supabase season rollover failed:", error);
        await appAlert(
            "Unable to start the new season. No rollover changes have been committed.\n\n" +
            error.message,
            "Season rollover failed",
            "danger"
        );
        return false;
    }

    if (data !== true) {
        await appAlert(
            "The new season could not be started. No rollover changes have been committed.",
            "Season not started",
            "danger"
        );
        return false;
    }

    const playersLoaded = await loadPlayersFromSupabase();

    if (!playersLoaded) {
        await appAlert(
            "The new season was created successfully, but the player list could not be refreshed. Please refresh the app.",
            "Season created",
            "warning"
        );
        return false;
    }

    currentSeason = nextSeason;
    saveData();
    window.seasonRolloverPreview = null;
    showSeniorDashboard();
    return true;
}