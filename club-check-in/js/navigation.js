// Navigation =====================================


let deferredInstallPrompt = null;

window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
});

function isIOSDevice() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
        (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function installClubCheckIn() {
    if (deferredInstallPrompt) {
        deferredInstallPrompt.prompt();

        deferredInstallPrompt.userChoice.then(() => {
            deferredInstallPrompt = null;
            showWelcome();
        });

        return;
    }

    if (isIOSDevice()) {
        appAlert(
            "To install Club Check-In:\n\n" +
            "1. Open this website in Safari.\n" +
            "2. Tap the Share button.\n" +
            "3. Select 'Add to Home Screen'.\n" +
            "4. Tap 'Add'.",
            "Install Club Check-In",
            "info"
        );
        return;
    }

    appAlert(
        "To install Club Check-In, open your browser menu and look for " +
        "'Install app' or 'Add to Home screen'.",
        "Install Club Check-In",
        "info"
    );
}

// Get Install Button ==================================

function getInstallButtonHTML() {

    const isInstalledApp =
        window.matchMedia("(display-mode: standalone)").matches ||
        window.navigator.standalone === true;

    if (isInstalledApp) {
        return "";
    }

    return `
        <button
            class="role-button"
            onclick="installClubCheckIn()">
            Install Club Check-In
        </button>
    `;
}

// Return to dashboard ==============================================

function goHome() {

    if (
        currentRole === "coach"
    ) {

        currentAgeGroup = null;
        selectedAgeGroups = [];

        showCoachAgeGroups();

        return;

    }

    if (
        currentRole === "senior"
    ) {

        showSeniorDashboard();

        return;

    }

    showWelcome();

}

// Logout ==========================================

async function logout() {

    if (typeof stopAppSessionTimeout === "function") {
        stopAppSessionTimeout();
    }


    if (typeof revokePersonalSession === "function") {
        await revokePersonalSession();
    }

    currentRole = null;

    currentAgeGroup = null;

    selectedAgeGroups = [];

    showWelcome();

}

//Show welcome page ====================================


function showWelcome() {

    // Clear the current session credentials
    currentAccessPIN = null;
    currentSeniorPIN = null;

    // Reset the current session selections
    currentRole = null;
    currentAgeGroup = null;
    selectedAgeGroups = [];

    document.getElementById(
        "app"
    ).innerHTML = `

        <div class="welcome">

            <div class="welcome-card">

                <img
                    src="RHRFC.jpg"
                    class="welcome-logo"
                    alt="Rushden & Higham RUFC">

                <div class="welcome-title">
                    CLUB CHECK-IN
                </div>

                <div class="welcome-club">
                    Rushden & Higham RUFC
                </div>

                <button
                    class="role-button"
                    onclick="showPIN('coach')">

                    Coach

                </button>

                <button
                    class="role-button"
                    onclick="showPIN('senior')">

                    Admin

                </button>
${getInstallButtonHTML()}

                <a class="policy-link" href="/policies/" target="_blank" rel="noopener noreferrer">Privacy &amp; Data Protection</a>

                <div class="welcome-version">
                    ${APP_VERSION}
                </div>

            </div>

        </div>

    `;

}
