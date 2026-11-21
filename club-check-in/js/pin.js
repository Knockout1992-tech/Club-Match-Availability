
 // PIN Screen =======================================

// Keep the verified PIN in memory for authorised
// database operations. Do not put it in localStorage.
let currentAccessPIN = null;


// ===================================================
// PIN SCREEN
// ===================================================

function showPIN(role) {

    currentRole = role;

    // Clear any previous session credentials when
    // returning to the PIN screen.
    currentAccessPIN = null;

    const roleName =
        role === "coach"
        ? "Coach"
        : "Admin";

    renderShell(`

        <div class="card pin-card">

            <button
                class="back-button"
                onclick="showWelcome()">

                ← Back

            </button>

            <h2>
                ${roleName} Access
            </h2>

            <div class="subtitle">

                Enter your PIN to continue.

            </div>

            <form onsubmit="event.preventDefault(); checkPIN();">

                <input
                    id="pinInput"
                    class="pin-input"
                    type="password"
                    inputmode="numeric"
                    enterkeyhint="go"
                    maxlength="8"
                    autocomplete="off"
                    required>

                <div
                    id="pinError"
                    class="error">
                </div>

                <button
                    class="primary-button"
                    type="submit">

                    Continue

                </button>

            </form>

        </div>

    `);

    document.getElementById(
        "pinInput"
    ).focus();

}


// ===================================================
// VERIFY PIN
// ===================================================


async function checkPIN() {

const entered =
    document.getElementById("pinInput").value;

const error =
    document.getElementById("pinError");

error.textContent = "";

if (!entered) {
    error.textContent = "Please enter your PIN.";
    return;
}

// Clear credentials from any previous attempt.
currentAccessPIN = null;
currentSeniorPIN = null;

// Step 1: Verify the supplied PIN.
const {
    data,
    error: supabaseError
} = await supabaseClient.rpc(
    "verify_access_code_for_installation",
    {
        supplied_code: entered,
        code_type: currentRole,
        supplied_installation_id: getInstallationID()
    }
);

if (supabaseError) {
    console.error(
        "PIN verification error:",
        supabaseError
    );

    error.textContent =
        "Unable to verify PIN. Please try again.";

    return;
}

if (data !== true) {
    // The lock-status RPC is intentionally not exposed to browser roles.
    // Use a combined message rather than attempting a restricted lookup.
    error.textContent =
        "Incorrect PIN. If the installation has reached its lock limit, contact an Admin to reset it.";
    return;
}

// Step 2: Verify installation and user authorisation.
const installationAuthorised =
    await checkInstallationAccess();

if (installationAuthorised === null) {
    error.textContent =
        "Unable to verify device access. Check your connection and try again.";

    return;
}

if (installationAuthorised === false) {
    error.textContent =
        "Access has been revoked or this user is inactive. Contact an Admin.";

    return;
}

// Step 3: Retain credentials after both checks pass.
if (currentRole === "coach") {
    currentAccessPIN = entered;
} else if (currentRole === "senior") {
    currentSeniorPIN = entered;
    currentAccessPIN = entered;
} else {
    error.textContent =
        "Invalid access role. Please start again.";

    return;
}

// Apply the same session timeout to shared-PIN sessions.
startAppSessionTimeout();

// Step 4: Load players using the verified role and PIN.
let playersLoaded = false;

try {
    playersLoaded =
        await loadPlayersFromSupabase();
} catch (loadError) {
    console.error(
        "Player loading error:",
        loadError
    );
}

if (!playersLoaded) {
    currentAccessPIN = null;
    currentSeniorPIN = null;

    error.textContent =
        "Unable to load players from Supabase. Please try again.";

    console.error(
        "Login stopped because players could not be loaded."
    );

    return;
}

// Step 5: Run the protected daily register housekeeping.
// A housekeeping failure must not prevent an otherwise valid login.
await autoClosePreviousAttendanceRegisters();

// Step 6: Open the correct screen.
if (currentRole === "coach") {
    showCoachAgeGroups();
    return;
}

if (currentRole === "senior") {
    showSeniorDashboard();
    return;
}

}