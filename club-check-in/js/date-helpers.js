/* =========================================================
   DATE HELPERS
   ========================================================= */

function getTodayKey() {

    const now = new Date();

    return now.getFullYear()
        + "-"
        + String(now.getMonth() + 1).padStart(2, "0")
        + "-"
        + String(now.getDate()).padStart(2, "0");

}

function getDisplayDate(dateKey) {

    const parts = dateKey.split("-");

    return parts[2] + "/" + parts[1] + "/" + parts[0];

}

function getDaysSinceDate(dateKey) {

    if (!dateKey) {
        return null;
    }

    const last =
        new Date(dateKey + "T00:00:00");

    const today =
        new Date(getTodayKey() + "T00:00:00");

    const difference =
        today.getTime() - last.getTime();

    return Math.floor(
        difference / 86400000
    );

}

function getWeeksSinceDate(dateKey) {

    const days =
        getDaysSinceDate(dateKey);

    if (days === null) {
        return null;
    }

    return Math.floor(days / 7);

}

function isArchiveReviewDue(player) {

    if (!player.active || player.archived) {
        return false;
    }

    if (!player.lastAttendanceDate) {
        return false;
    }

    return getDaysSinceDate(
        player.lastAttendanceDate
    ) >= 84;

}
