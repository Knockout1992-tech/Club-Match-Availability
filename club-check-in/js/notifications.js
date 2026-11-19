// =========================================================
// COACH PUSH NOTIFICATIONS
// =========================================================

const COACH_PUSH_VAPID_PUBLIC_KEY = "BNHfhKxifkbC1pa8rGkaBT7FWsTsQe5Z4DGaH4XWWOdG_UgDkp_iGlvA9Zd_Q21yuKnyG2jGPUzfxG5uP78Qz_Q";


function storeCoachNotificationTarget(source, id) {
    const numericId = Number(id);
    if (numericId > 0 && Number.isInteger(numericId) && ["season_planner", "match_fixture"].includes(source)) {
        sessionStorage.setItem("pendingCoachNotification", JSON.stringify({ source, id: numericId }));
        return true;
    }
    return false;
}

(function captureCoachNotificationTarget() {
    try {
        const params = new URLSearchParams(window.location.search);
        if (params.get("notification") === "1") {
            storeCoachNotificationTarget(params.get("source") || "", params.get("id"));
            params.delete("notification");
            params.delete("source");
            params.delete("id");
            const query = params.toString();
            history.replaceState(null, "", window.location.pathname + (query ? "?" + query : "") + window.location.hash);
        }
    } catch (error) {
        console.warn("Could not preserve notification destination:", error);
    }
})();

if ("serviceWorker" in navigator) {
    navigator.serviceWorker.addEventListener("message", event => {
        if (event.data?.type !== "COACH_NOTIFICATION_OPEN") return;
        try {
            const url = new URL(event.data.url, window.location.href);
            const appPath = new URL("./", window.location.href).pathname;
            if (url.origin !== window.location.origin || !url.pathname.startsWith(appPath)) return;
            if (!storeCoachNotificationTarget(url.searchParams.get("source") || "", url.searchParams.get("id"))) return;
            if (currentRole === "coach" && currentAccessPIN) {
                openPendingCoachNotification();
            } else if (currentPersonID) {
                showWelcome();
            }
        } catch (error) {
            console.warn("Could not process notification click:", error);
        }
    });
}

function coachPushBase64UrlToBytes(value) {
    const padded = value + "=".repeat((4 - value.length % 4) % 4);
    const base64 = padded.replace(/-/g, "+").replace(/_/g, "/");
    return Uint8Array.from(atob(base64), char => char.charCodeAt(0));
}

async function coachPushRequest(action, subscription = null) {
    const { data, error } = await supabaseClient.functions.invoke("coach_push_subscriptions", {
        body: {
            action,
            coach_code: currentAuthSessionToken,
            installation_id: getInstallationID(),
            ...(subscription ? { subscription } : {})
        }
    });
    if (error) {
        console.error("Coach notification request failed:", error);
        throw new Error(data?.error || "Unable to update notification settings.");
    }
    if (!data?.success) throw new Error(data?.error || "Unable to update notification settings.");
    return data;
}

async function enableCoachNotifications() {
    if (currentRole !== "coach" || !currentPersonID || !currentAuthSessionToken) {
        return appAlert("Please sign in to your Coach account first.", "Sign-in required", "warning");
    }
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        return appAlert("Push notifications are not supported by this browser. Install Club Check-In as an app and try again.", "Not supported", "warning");
    }

    try {
        const permission = await Notification.requestPermission();
        if (permission !== "granted") {
            return appAlert("Notifications are blocked. Allow notifications for Club Check-In in your browser or device settings.", "Notifications not enabled", "warning");
        }

        const registration = await navigator.serviceWorker.ready;
        let subscription = await registration.pushManager.getSubscription();
        if (!subscription) {
            subscription = await registration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: coachPushBase64UrlToBytes(COACH_PUSH_VAPID_PUBLIC_KEY)
            });
        }

        await coachPushRequest("subscribe", subscription.toJSON());
        await refreshCoachNotificationButton();
        await appAlert("This device is now set up to receive Coach notifications.", "Notifications enabled", "success");
    } catch (error) {
        console.error("Enable Coach notifications failed:", error);
        await appAlert(error.message || "Unable to enable notifications on this device.", "Notifications unavailable", "danger");
    }
}

async function disableCoachNotifications() {
    if (currentRole !== "coach" || !currentAuthSessionToken) return;
    try {
        await coachPushRequest("unsubscribe");
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.getSubscription();
        if (subscription) await subscription.unsubscribe();
        await refreshCoachNotificationButton();
        await appAlert("Notifications have been disabled on this device.", "Notifications disabled", "success");
    } catch (error) {
        console.error("Disable Coach notifications failed:", error);
        await appAlert(error.message || "Unable to disable notifications.", "Update failed", "danger");
    }
}

async function showCoachNotificationSettings() {
    if (currentRole !== "coach") return;
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        return appAlert("This browser does not support web push notifications.", "Not supported", "warning");
    }

    // Request permission directly from the dashboard button tap. This is
    // important on iOS, where the browser requires a user gesture.
    if (Notification.permission !== "granted") {
        return enableCoachNotifications();
    }

    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) return enableCoachNotifications();

    const choice = await appConfirm(
        "Notifications are enabled on this device. Would you like to turn them off?",
        "Coach notifications"
    );
    if (choice) await disableCoachNotifications();
    await refreshCoachNotificationButton();
}

async function refreshCoachNotificationButton() {
    const button = document.getElementById("coachNotificationToggle");
    if (!button) return;
    const state = button.querySelector("[data-notification-state]");
    if (!state) return;
    let enabled = false;
    try {
        if ("serviceWorker" in navigator && "PushManager" in window && "Notification" in window && Notification.permission === "granted") {
            const registration = await navigator.serviceWorker.ready;
            enabled = !!(await registration.pushManager.getSubscription());
        }
    } catch (error) { console.warn("Could not read notification status:", error); }
    button.dataset.state = enabled ? "on" : "off";
    state.textContent = enabled ? "ON" : "OFF";
    button.setAttribute("aria-label", "Coach notifications " + (enabled ? "on" : "off"));
}

async function openPendingCoachNotification() {
    if (currentRole !== "coach" || !currentAccessPIN) return;
    let target = null;
    try {
        target = JSON.parse(sessionStorage.getItem("pendingCoachNotification") || "null");
        sessionStorage.removeItem("pendingCoachNotification");
    } catch (_) {}
    if (!target || !Number.isInteger(Number(target.id)) || Number(target.id) <= 0) return;
    try {
        await showCoachSeasonPlanner();
        const eventId = Number(target.id);
        const matching = (seasonPlannerData?.events || []).find(event =>
            target.source === "season_planner"
                ? Number(event.id) === eventId
                : Number(event.linked_fixture_id || seasonPlannerAvailabilityByEvent?.get(Number(event.id))) === eventId
        );
        if (matching) {
            seasonPlannerShowPast = true;
            seasonPlannerShowCancelled = true;
            seasonPlannerAgeFilter = "all";
            renderSeasonPlanner();
            requestAnimationFrame(() => {
                const row = document.querySelector('[data-event-ids~="' + Number(matching.id) + '"]');
                if (row) {
                    row.classList.add("coach-notification-highlight");
                    row.scrollIntoView({ behavior: "smooth", block: "center" });
                }
            });
        } else if (target.source === "match_fixture") {
            await appAlert("This fixture is not part of the Season Calendar. Please check the Match Availability area for its details.", "Fixture notification", "info");
        } else {
            await appAlert("This event is no longer available in your assigned Coach calendar.", "Event unavailable", "warning");
        }
    } catch (error) {
        console.error("Could not open notification destination:", error);
        await appAlert("The notification was opened, but its event could not be loaded. Please open the Season Calendar.", "Event unavailable", "warning");
    }
}
