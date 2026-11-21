// =====================================================
// PERSONAL USER LOGIN
// =====================================================

let personalLoginAccount = null;
let currentPersonID = null;
let currentUserName = null;
let currentUserRoles = [];
let currentAllowedAgeGroupIDs = [];
let currentAuthSessionToken = null;

let rememberedLoginAutoAttempted = false;

async function showWelcome() {
    stopAppSessionTimeout();

    // Remove player and attendance data whenever the app returns to login.
    clearSensitiveAppData();

    currentAccessPIN = null;
    currentSeniorPIN = null;
    currentRole = null;
    currentPersonID = null;
    currentUserName = null;
    currentUserRoles = [];
    currentAllowedAgeGroupIDs = [];
    currentAuthSessionToken = null;
    currentAgeGroup = null;
    selectedAgeGroups = [];
    personalLoginAccount = null;

    renderPersonalLogin();

    // On a returning visit, automatically look up the remembered account
    // and start passkey verification if this installation has a passkey.
    const rememberedName = getRememberedPersonalLoginName();
    if (rememberedName && !rememberedLoginAutoAttempted) {
        rememberedLoginAutoAttempted = true;
        await lookupPersonalLoginName();
    }
}

const REMEMBERED_PERSONAL_LOGIN_KEY = "clubCheckInRememberedName";

function getRememberedPersonalLoginName() {
    try {
        return localStorage.getItem(REMEMBERED_PERSONAL_LOGIN_KEY) || "";
    } catch (error) {
        console.warn("Remembered login name is unavailable:", error);
        return "";
    }
}

function updateRememberedPersonalLogin() {
    const name = document.getElementById("personalNameInput")?.value.trim() || "";
    const remember = document.getElementById("rememberPersonalLogin")?.checked === true;

    try {
        if (remember && name) {
            localStorage.setItem(REMEMBERED_PERSONAL_LOGIN_KEY, name);
        } else {
            localStorage.removeItem(REMEMBERED_PERSONAL_LOGIN_KEY);
        }
    } catch (error) {
        console.warn("Could not save remembered login name:", error);
    }
}

function renderPersonalLogin(message = "") {
    const account = personalLoginAccount;
    const setup = !!account?.pin_setup_required;
    const isSystemAdmin = account?.protected_user === true;

    document.getElementById("app").innerHTML = `
        <div class="welcome">
            <div class="welcome-card">
                <img src="RHRFC.jpg" class="welcome-logo" alt="Rushden &amp; Higham RUFC">
                <div class="welcome-title">CLUB CHECK-IN</div>
                <div class="welcome-club">Rushden &amp; Higham RUFC</div>

                ${!account ? `
                    <form onsubmit="event.preventDefault(); lookupPersonalLoginName();">
                        <label for="personalNameInput" style="display:block;text-align:left;font-weight:700;margin:0 0 7px">Your name</label>
                        <input id="personalNameInput" class="pin-input" type="text" maxlength="100"
                            autocomplete="name" placeholder="Enter your name"
                            value="${escapeHTML(getRememberedPersonalLoginName())}" required>
                        <label style="display:flex;align-items:center;gap:8px;text-align:left;font-size:14px;margin:10px 0 14px">
                            <input id="rememberPersonalLogin" type="checkbox"
                                style="width:auto;margin:0"
                                ${getRememberedPersonalLoginName() ? "checked" : ""}
                                onchange="updateRememberedPersonalLogin()">
                            Remember me on this device
                        </label>
                        <div id="personalLoginError" class="error">${escapeHTML(message)}</div>
                        <button class="primary-button" type="submit">Continue</button>
                    </form>
                ` : isSystemAdmin ? `
                    <p class="subtitle" style="margin:12px 0">System Admin</p>
                    <p class="subtitle">Continue using the existing Admin PIN.</p>
                    <button class="primary-button" onclick="continueSystemAdminLogin()">Continue to Admin PIN</button>
                    <button class="secondary-button personal-login-secondary" onclick="resetPersonalLoginName()">Use a different name</button>
                ` : `
                    <p class="subtitle" style="margin:8px 0 14px">Signing in as <strong>${escapeHTML(account.display_name)}</strong></p>
                    <form onsubmit="event.preventDefault(); submitPersonalLogin();">
                        ${setup ? `
                            <p class="subtitle" style="margin:8px 0 14px">First-time setup: enter the existing shared Coach PIN, then choose your personal PIN.</p>
                            <input id="setupSharedPin" class="pin-input" type="password" inputmode="numeric" maxlength="8" autocomplete="off" placeholder="Shared Coach PIN" required>
                            <input id="setupNewPin" class="pin-input" type="password" inputmode="numeric" maxlength="12" autocomplete="new-password" placeholder="New personal PIN" required>
                            <input id="setupConfirmPin" class="pin-input" type="password" inputmode="numeric" maxlength="12" autocomplete="new-password" placeholder="Confirm personal PIN" required>
                        ` : `
                            <input id="personalPin" class="pin-input" type="password" inputmode="numeric" maxlength="12" autocomplete="current-password" placeholder="Personal PIN" required>
                        `}
                        <div id="personalLoginError" class="error">${escapeHTML(message)}</div>
                        <button class="primary-button" type="submit">${setup ? "Set Up Personal PIN" : "Sign In"}</button>
                    </form>
                    <button class="secondary-button personal-login-secondary" onclick="resetPersonalLoginName()">Use a different name</button>
                `}
                ${getInstallButtonHTML()}
                <a class="policy-link" href="https://rhrufc-mini.pages.dev/policies/" target="_blank" rel="noopener noreferrer">Privacy &amp; Data Protection</a>
                <div class="welcome-version">${APP_VERSION}</div>
            </div>
        </div>`;

    document.getElementById(account && !isSystemAdmin
        ? (setup ? "setupSharedPin" : "personalPin")
        : "personalNameInput")?.focus();
}

function passkeyBase64UrlToBuffer(value) {
    const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - base64.length % 4) % 4);
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
}

function passkeyBufferToBase64Url(value) {
    const bytes = new Uint8Array(value);
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function serialisePasskeyCredential(credential) {
    const response = credential.response;
    const result = {
        id: credential.id,
        rawId: passkeyBufferToBase64Url(credential.rawId),
        type: credential.type,
        clientExtensionResults: credential.getClientExtensionResults()
    };

    if (response.attestationObject) {
        result.response = {
            attestationObject: passkeyBufferToBase64Url(response.attestationObject),
            clientDataJSON: passkeyBufferToBase64Url(response.clientDataJSON),
            transports: typeof response.getTransports === "function" ? response.getTransports() : []
        };
        result.authenticatorAttachment = credential.authenticatorAttachment || "platform";
    } else {
        result.response = {
            authenticatorData: passkeyBufferToBase64Url(response.authenticatorData),
            clientDataJSON: passkeyBufferToBase64Url(response.clientDataJSON),
            signature: passkeyBufferToBase64Url(response.signature),
            userHandle: response.userHandle ? passkeyBufferToBase64Url(response.userHandle) : null
        };
    }

    return result;
}

function preparePasskeyOptions(options) {
    const prepared = {
        ...options,
        challenge: passkeyBase64UrlToBuffer(options.challenge),
        userVerification: "required"
    };
    if (options.user) {
        prepared.user = { ...options.user, id: passkeyBase64UrlToBuffer(options.user.id) };
    }
    for (const key of ["allowCredentials", "excludeCredentials"]) {
        if (Array.isArray(options[key])) {
            prepared[key] = options[key].map(item => ({
                ...item,
                id: passkeyBase64UrlToBuffer(item.id)
            }));
        }
    }
    return prepared;
}

async function callPasskeyService(action, extra = {}) {
    const { data, error } = await supabaseClient.functions.invoke("club_checkin_passkeys", {
        body: {
            action,
            person_id: personalLoginAccount?.person_id || currentPersonID,
            installation_id: getInstallationID(),
            ...extra
        }
    });
    if (error) {
        console.error("Passkey service request failed:", error);
        throw new Error("Passkey service is unavailable.");
    }
    if (!data?.success) throw new Error(data?.message || "Passkey request could not be completed.");
    return data;
}

async function signInWithPasskey(preloadedOptions = null) {
    try {
        if (!window.PublicKeyCredential || !navigator.credentials?.get) {
            throw new Error("This browser or device does not support passkey sign-in.");
        }

        const result = preloadedOptions
            ? { options: preloadedOptions }
            : await callPasskeyService("authentication-options");
        const credential = await navigator.credentials.get({
            publicKey: preparePasskeyOptions(result.options)
        });
        if (!credential) throw new Error("Sign-in was cancelled.");

        const verified = await callPasskeyService("authentication-verify", {
            response: serialisePasskeyCredential(credential)
        });
        await completePersonalLogin(verified, "passkey");
        return true;
    } catch (error) {
        console.warn("Passkey sign-in was not completed:", error);
        return false;
    }
}

async function offerPasskeyRegistration() {
    if (!currentPersonID || !currentAuthSessionToken || !window.PublicKeyCredential ||
        !navigator.credentials?.create || !personalLoginAccount ||
        personalLoginAccount.protected_user) return;

    try {
        // Do not offer registration again when this account already has a passkey
        // registered for this installation.
        const status = await callPasskeyService("status");
        if (status.available) return;

        const register = await appConfirm(
            "Would you like to set up biometric sign-in on this device? Your device may use fingerprint, face recognition or its screen lock. Your biometric data is never shared with the club.",
            "Set up biometric sign-in",
            "Set up"
        );
        if (!register) return;

        const result = await callPasskeyService("registration-options", {
            session_token: currentAuthSessionToken
        });
        const credential = await navigator.credentials.create({
            publicKey: preparePasskeyOptions(result.options)
        });
        if (!credential) throw new Error("Passkey registration was cancelled.");

        await callPasskeyService("registration-verify", {
            session_token: currentAuthSessionToken,
            response: serialisePasskeyCredential(credential)
        });

        await appAlert(
            "Biometric sign-in has been set up on this device. You can still use your personal PIN whenever you prefer.",
            "Passkey registered",
            "success"
        );
    } catch (error) {
        // Passkey registration is optional. Never interrupt a successful PIN login
        // with a warning if registration is cancelled or the service is unavailable.
        console.warn("Optional passkey registration was not completed:", error);
    }
}

async function lookupPersonalLoginName() {
    const name = document.getElementById("personalNameInput")?.value.trim() || "";
    const errorBox = document.getElementById("personalLoginError");

    if (!name) {
        errorBox.textContent = "Please enter your name.";
        return;
    }

    errorBox.textContent = "Checking account…";
    updateRememberedPersonalLogin();

    try {
        const result = await callPasskeyService("authentication-options-by-name", {
            supplied_name: name
        });

        personalLoginAccount = {
            person_id: result.person_id,
            display_name: result.display_name,
            pin_setup_required: result.pin_setup_required === true,
            protected_user: result.protected_user === true
        };

        renderPersonalLogin();

        if (!personalLoginAccount.protected_user && !personalLoginAccount.pin_setup_required && result.available) {
            const signedIn = await signInWithPasskey(result.options);
            if (signedIn) return;
            renderPersonalLogin("Biometric sign-in was not completed. Please use your personal PIN instead.");
        }
    } catch (error) {
        console.warn("Personal account lookup could not be completed:", error);

        // Account lookup is performed by the trusted passkey Edge Function.
        // Do not fall back to the restricted browser RPC or expose account data.
        // The personal PIN remains available when account lookup succeeds but
        // passkey authentication itself cannot be completed.
        errorBox.textContent =
            "Unable to check your account right now. Please check your connection and try again. Your PIN has not been checked.";
    }
}

function resetPersonalLoginName() {
    personalLoginAccount = null;
    renderPersonalLogin();
}

function continueSystemAdminLogin() {
    if (!personalLoginAccount?.protected_user || personalLoginAccount.person_id !== "MAIN-001") {
        renderPersonalLogin("Invalid System Admin account.");
        return;
    }
    showPIN("senior");
}

async function submitPersonalLogin() {
    const errorBox = document.getElementById("personalLoginError");
    const user = personalLoginAccount;

    if (!user || user.protected_user) {
        errorBox.textContent = "Please enter your name again.";
        return;
    }

    const installationID = getInstallationID();
    let pin = "";

    if (user.pin_setup_required) {
        const sharedPin = document.getElementById("setupSharedPin")?.value || "";
        const newPin = document.getElementById("setupNewPin")?.value || "";
        const confirmPin = document.getElementById("setupConfirmPin")?.value || "";

        if (!sharedPin || !newPin || !confirmPin) {
            errorBox.textContent = "Complete all PIN fields.";
            return;
        }
        if (!/^\d{6,12}$/.test(newPin)) {
            errorBox.textContent = "Your personal PIN must be 6–12 digits.";
            return;
        }
        if (newPin !== confirmPin) {
            errorBox.textContent = "The new PINs do not match.";
            return;
        }

        const { data, error } = await supabaseClient.rpc("complete_personal_pin_setup", {
            supplied_name: user.display_name,
            supplied_shared_pin: sharedPin,
            supplied_new_pin: newPin,
            supplied_installation_id: installationID
        });

        if (error || data !== true) {
            console.error("Personal PIN setup failed:", error);
            errorBox.textContent = "Setup could not be completed. Check the shared Coach PIN, your account status and try again.";
            return;
        }
        pin = newPin;
    } else {
        pin = document.getElementById("personalPin")?.value || "";
        if (!pin) {
            errorBox.textContent = "Please enter your personal PIN.";
            return;
        }
    }

    errorBox.textContent = "Signing in…";
    const { data, error } = await supabaseClient.rpc("authenticate_user_pin", {
        supplied_person_id: user.person_id,
        supplied_pin: pin,
        supplied_installation_id: installationID
    });

    if (error || !data?.success) {
        console.error("Personal login failed:", error || data);
        errorBox.textContent = data?.message || "Unable to sign in. Please try again.";
        return;
    }

    await completePersonalLogin(data, "pin");
}

async function completePersonalLogin(data, authMethod = "pin") {
    currentPersonID = data.person_id;
    currentUserName = data.name;
    currentUserRoles = Array.isArray(data.roles) ? data.roles : [];
    currentAllowedAgeGroupIDs = Array.isArray(data.age_group_ids) ? data.age_group_ids.map(Number) : [];
    currentAuthSessionToken = data.session_token;
    startAppSessionTimeout();
    currentAccessPIN = data.session_token;
    currentSeniorPIN = currentUserRoles.includes("admin") ? data.session_token : null;
    currentRole = currentUserRoles.includes("coach") ? "coach" : "senior";

    if (currentRole === "coach") {
        const assigned = getAssignedCoachAgeGroups();
        if (!assigned.length) {
            await appAlert("Your account has no active age groups assigned. Please contact an Admin.", "No age groups assigned", "warning");
            logout();
            return;
        }
        // Personal Coach accounts always open the groups assigned to them.
        // Multiple assignments use the combined dashboard rather than a picker.
        selectedAgeGroups = [...assigned];
    }

    let loaded = false;
    try { loaded = await loadPlayersFromSupabase(); }
    catch (loadError) { console.error("Player load failed:", loadError); }

    if (!loaded) {
        clearPersonalSession();
        await appAlert("Unable to load player data. Please try again.", "Login unavailable", "danger");
        showWelcome();
        return;
    }

    await autoClosePreviousAttendanceRegisters();

    if (authMethod === "pin") {
        await offerPasskeyRegistration();
    }

    if (currentRole === "coach") {
        currentAgeGroup = selectedAgeGroups[0] || null;
        await showCoachDashboard();
        await openPendingCoachNotification();
    } else {
        await showSeniorDashboard();
    }
}

function getAssignedCoachAgeGroups() {
    return ageGroupData
        .filter(group => group.active && currentAllowedAgeGroupIDs.includes(Number(group.id)))
        .map(group => group.age_group);
}

function clearPersonalSession() {
    // A failed login must not leave a previous roster in memory.
    clearSensitiveAppData();

    currentAccessPIN = null;
    currentSeniorPIN = null;
    currentPersonID = null;
    currentUserName = null;
    currentUserRoles = [];
    currentAllowedAgeGroupIDs = [];
    currentAuthSessionToken = null;
    currentRole = null;
    currentAgeGroup = null;
    selectedAgeGroups = [];
}

async function revokePersonalSession() {
    if (!currentAuthSessionToken) return;
    try {
        const { error } = await supabaseClient.rpc("revoke_personal_user_session", {
            supplied_session_token: currentAuthSessionToken,
            supplied_installation_id: getInstallationID()
        });
        if (error) console.error("Session revocation failed:", error);
    } catch (error) {
        console.error("Session revocation failed:", error);
    }
}


/* =====================================================
   ROLE SWITCHING FOR DUAL-ROLE PERSONAL ACCOUNTS
   ===================================================== */

async function showAdminDashboardFromCoach() {
    if (!currentUserRoles.includes("admin") || !currentAuthSessionToken) {
        console.warn("Admin dashboard access denied: no active Admin session.");
        return;
    }

    // Reload using the Admin role so the list contains every active player.
    currentRole = "senior";
    currentSeniorPIN = currentAuthSessionToken;
    currentAccessPIN = currentAuthSessionToken;

    const loaded = await loadPlayersFromSupabase();
    if (!loaded) {
        currentRole = "coach";
        currentSeniorPIN = null;
        await appAlert("Unable to load the full club player list. You are still in Coach mode.", "Player load failed", "danger");
        return;
    }

    await showSeniorDashboard();
}

async function showCoachAreaFromAdmin() {
    if (!currentUserRoles.includes("coach") || !currentAuthSessionToken) {
        console.warn("Coach area access denied: no active Coach session.");
        return;
    }

    const assigned = getAssignedCoachAgeGroups();
    if (!assigned.length) {
        await appAlert("Your account has no active age groups assigned. Please contact an Admin.", "No age groups assigned", "warning");
        return;
    }

    // Reload using the Coach role so Admin-only players are no longer in memory.
    currentRole = "coach";
    currentSeniorPIN = null;
    currentAccessPIN = currentAuthSessionToken;
    selectedAgeGroups = [...assigned];
    currentAgeGroup = assigned[0];

    const loaded = await loadPlayersFromSupabase();
    if (!loaded) {
        currentRole = "senior";
        currentSeniorPIN = currentAuthSessionToken;
        await appAlert("Unable to reload your assigned Coach players. You are still in Admin mode.", "Player load failed", "danger");
        return;
    }

    await showCoachDashboard();
}


/* =====================================================
   SESSION TIMEOUT
   10 minutes inactivity, 2-minute warning, 2-hour maximum
   ===================================================== */
const APP_IDLE_LIMIT_MS = 10 * 60 * 1000;
const APP_IDLE_WARNING_MS = 2 * 60 * 1000;
const APP_ABSOLUTE_LIMIT_MS = 2 * 60 * 60 * 1000;
let appSessionStartedAt = 0;
let appLastActivityAt = 0;
let appSessionTimeoutInterval = null;
let appSessionWarningVisible = false;

function startAppSessionTimeout() {
    stopAppSessionTimeout();
    appSessionStartedAt = Date.now();
    appLastActivityAt = appSessionStartedAt;
    appSessionWarningVisible = false;
    ["pointerdown", "keydown", "touchstart", "scroll"].forEach(eventName => {
        document.addEventListener(eventName, recordAppSessionActivity, { passive: true });
    });
    appSessionTimeoutInterval = setInterval(checkAppSessionTimeout, 1000);
}

function stopAppSessionTimeout() {
    if (appSessionTimeoutInterval !== null) {
        clearInterval(appSessionTimeoutInterval);
        appSessionTimeoutInterval = null;
    }
    ["pointerdown", "keydown", "touchstart", "scroll"].forEach(eventName => {
        document.removeEventListener(eventName, recordAppSessionActivity);
    });
    document.getElementById("appSessionTimeoutModal")?.remove();
    appSessionWarningVisible = false;
    appSessionStartedAt = 0;
    appLastActivityAt = 0;
}

function recordAppSessionActivity() {
    if (!appSessionStartedAt || appSessionWarningVisible) return;
    appLastActivityAt = Date.now();
}

function checkAppSessionTimeout() {
    if (!appSessionStartedAt) return;
    const now = Date.now();
    if (now - appSessionStartedAt >= APP_ABSOLUTE_LIMIT_MS) {
        logout();
        return;
    }
    const idleTime = now - appLastActivityAt;
    if (idleTime >= APP_IDLE_LIMIT_MS) {
        logout();
        return;
    }
    if (idleTime >= APP_IDLE_LIMIT_MS - APP_IDLE_WARNING_MS && !appSessionWarningVisible) {
        showAppSessionTimeoutWarning();
    }
}

function showAppSessionTimeoutWarning() {
    if (appSessionWarningVisible) return;
    appSessionWarningVisible = true;
    const modal = document.createElement("div");
    modal.id = "appSessionTimeoutModal";
    modal.className = "session-timeout-overlay";
    modal.innerHTML = `
        <div class="session-timeout-dialog" role="dialog" aria-modal="true" aria-labelledby="sessionTimeoutTitle">
            <h2 id="sessionTimeoutTitle">Still using Club Check-In?</h2>
            <p>You will be logged out in 2 minutes due to inactivity.</p>
            <div class="session-timeout-actions">
                <button type="button" class="primary-button" onclick="continueAppSession()">Stay signed in</button>
                <button type="button" class="secondary-button" onclick="logout()">Log out</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    modal.querySelector("button")?.focus();
}

function continueAppSession() {
    if (!appSessionStartedAt) return;
    appLastActivityAt = Date.now();
    appSessionWarningVisible = false;
    document.getElementById("appSessionTimeoutModal")?.remove();
}
