const SUPABASE_URL =
    "https://muxxlewtqhpckhoqeinn.supabase.co";

const SUPABASE_KEY =
    "sb_publishable_u3IexkNha97RFr5qEguI1A_Y-NBjxeo";

// Keep one stable installation ID on this browser and attach it to every
// database request so server-side PIN lockout applies to every RPC.
let installationIDForRequests = localStorage.getItem("installationID");
if (!installationIDForRequests) {
    installationIDForRequests = "INSTALL-" + crypto.randomUUID();
    localStorage.setItem("installationID", installationIDForRequests);
}

const supabaseClient =
    supabase.createClient(
        SUPABASE_URL,
        SUPABASE_KEY,
        {
            global: {
                headers: {
                    "x-client-info": "club-check-in-installation=" + installationIDForRequests
                }
            }
        }
    );

// Keep the installation identifier current if the app regenerates it after
// detecting a duplicate device registration.
function setInstallationRequestHeader(installationID) {
    const headers = supabaseClient.rest?.headers;
    if (!headers) return;

    const value = "club-check-in-installation=" + installationID;
    if (typeof headers.set === "function") {
        headers.set("x-client-info", value);
    } else {
        headers["x-client-info"] = value;
    }
}
