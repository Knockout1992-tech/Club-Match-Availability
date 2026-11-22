// =====================================================
// ADMIN COACH INVITATION
// =====================================================

const CLUB_CHECK_IN_INITIAL_ACCESS_URL =
    "https://rhrufc-mini.pages.dev/club-check-in/";

async function showCoachInvitation() {
    if (currentRole !== "senior" || !currentSeniorPIN) {
        await appAlert(
            "Admin access is required to invite a Coach.",
            "Access denied",
            "warning"
        );
        return;
    }

    renderShell(`
        <div class="card coach-invitation-page">
            <button class="back-button" onclick="showSeniorDashboard()">← Back to Dashboard</button>

            <h2>Invite a Coach</h2>
            <p class="subtitle">
                Share the initial access link and these setup instructions with a new Coach.
            </p>

            <div class="info-box">
                <strong>Initial access link</strong>
                <p>Open Club Check-In to begin first-time Coach setup.</p>
                <a class="primary-button" href="${CLUB_CHECK_IN_INITIAL_ACCESS_URL}"
                    target="_blank" rel="noopener noreferrer"
                    style="display:block;text-align:center;text-decoration:none;box-sizing:border-box">
                    Open Club Check-In
                </a>
                <button class="secondary-button" type="button"
                    style="width:100%;margin-top:10px"
                    onclick="copyCoachInvitationLink()">
                    Copy Access Link
                </button>
                <small style="display:block;margin-top:8px;overflow-wrap:anywhere">
                    ${CLUB_CHECK_IN_INITIAL_ACCESS_URL}
                </small>
            </div>

            <div class="info-box">
                <strong>Before you send the invitation</strong>
                <ol style="padding-left:22px;line-height:1.6">
                    <li>Open <strong>User Management</strong> and add the Coach using the name they will enter at sign-in.</li>
                    <li>Make sure their account is active, the <strong>Coach</strong> role is assigned, and their correct age group(s) are selected.</li>
                    <li>Give them the existing shared Coach setup PIN privately. It is only for their first personal PIN setup.</li>
                </ol>
            </div>

            <div class="info-box">
                <strong>Instructions for the Coach</strong>
                <ol style="padding-left:22px;line-height:1.6">
                    <li>Open the link above and enter the name registered by the Admin.</li>
                    <li>For first-time setup, enter the shared Coach setup PIN.</li>
                    <li>Create and confirm a personal PIN (6–12 digits). Keep it private.</li>
                    <li>If asked to approve or register this device, contact the Admin before continuing.</li>
                    <li>Sign in with your personal PIN. Your assigned age group(s) will be available.</li>
                </ol>
            </div>

            <div class="info-box">
                <strong>Using an iPhone</strong>
                <p>Tap the link. If it opens inside WhatsApp and does not work correctly, tap the share/menu button and choose <strong>Open in Safari</strong>. Safari can then be used to sign in and optionally add Club Check-In to the Home Screen.</p>
            </div>

            <div class="info-box">
                <strong>Security reminder</strong>
                <p>Do not send personal PINs in a group chat. The shared Coach setup PIN should be sent privately and must not be used for normal sign-in. The invitation link does not grant access by itself; the Coach must be added and assigned by an Admin.</p>
            </div>
        </div>
    `);
}

async function copyCoachInvitationLink() {
    const link = CLUB_CHECK_IN_INITIAL_ACCESS_URL;
    try {
        if (navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText(link);
        } else {
            const field = document.createElement("textarea");
            field.value = link;
            field.setAttribute("readonly", "");
            field.style.position = "fixed";
            field.style.opacity = "0";
            document.body.appendChild(field);
            field.select();
            const copied = document.execCommand("copy");
            field.remove();
            if (!copied) throw new Error("Clipboard copy was not available.");
        }
        await appAlert("The Club Check-In initial access link has been copied.", "Link copied", "success");
    } catch (error) {
        console.error("Coach invitation link copy failed:", error);
        await appAlert("Copying was blocked by this browser. You can select and copy the link shown on this screen.", "Unable to copy", "warning");
    }
}
