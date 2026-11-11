
const SUPABASE_URL = "https://muxxlewtqhpckhoqeinn.supabase.co";
const GET_FIXTURE_URL = `${SUPABASE_URL}/functions/v1/get_fixture`;

// Read the unique fixture token from the shared URL
const params = new URLSearchParams(window.location.search);
const fixtureToken = params.get("fixture");

const loading = document.getElementById("loading");
const fixtureSection = document.getElementById("fixture");
const availabilityForm = document.getElementById("availability-form");
const message = document.getElementById("message");

function showMessage(text) {
    loading.hidden = true;
    fixtureSection.hidden = true;
    availabilityForm.hidden = true;
    message.hidden = false;
    message.textContent = text;
}

function formatDate(dateString) {
    return new Date(`${dateString}T12:00:00`).toLocaleDateString(
        "en-GB",
        {
            weekday: "long",
            day: "numeric",
            month: "long",
            year: "numeric"
        }
    );
}

async function loadFixture() {
    if (!fixtureToken) {
        showMessage("This link is missing its fixture reference. Please use the link shared by your coach.");
        return;
    }

    try {
        const response = await fetch(GET_FIXTURE_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                token: fixtureToken
            })
        });

        const result = await response.json();

        if (!response.ok) {
            showMessage(result.error || "Unable to load this fixture.");
            return;
        }

        displayFixture(result);

    } catch (error) {
        console.error("Fixture loading failed:", error);
        showMessage("Unable to connect. Please check your internet connection and try again.");
    }
}

function displayFixture(data) {
    const fixture = data.fixture;

    document.getElementById("opposition").textContent =
        fixture.opposition;

    const fixtureType =
        fixture.fixture_type === "home" ? "Home fixture" : "Away fixture";

    let details = `
        <p><strong>${formatDate(fixture.fixture_date)}</strong></p>
        <p>${fixtureType}</p>
    `;

    if (fixture.kick_off_time) {
        details += `<p>Kick-off: ${fixture.kick_off_time.substring(0, 5)}</p>`;
    }

    if (fixture.venue) {
        details += `<p>Venue: ${escapeHTML(fixture.venue)}</p>`;
    }

    if (fixture.venue_address) {
        details += `<p>${escapeHTML(fixture.venue_address)}</p>`;
    }

    if (fixture.response_deadline) {
        details += `<p>Responses requested by: ${formatDate(fixture.response_deadline)}</p>`;
    }

    document.getElementById("fixture-details").innerHTML = details;

    fixtureSection.hidden = false;
    loading.hidden = true;

    availabilityForm.hidden = false;

    document.getElementById("children").innerHTML =
        data.age_groups.map(group => `
            <p>${escapeHTML(group.display_name || group.age_group)}</p>
        `).join("");
}

function escapeHTML(value) {
    return String(value).replace(/[&<>"']/g, character => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;"
    })[character]);
}

loadFixture();
