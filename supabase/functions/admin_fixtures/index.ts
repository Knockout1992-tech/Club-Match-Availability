
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function response(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

// =========================================================
// DECRYPT FIXTURE TOKEN
// =========================================================

async function decryptToken(encryptedToken: string): Promise<string> {
  const secret = Deno.env.get("FIXTURE_TOKEN_ENCRYPTION_KEY");

  if (!secret) {
    throw new Error("Fixture encryption key is missing");
  }

  const rawKey = Uint8Array.from(
    atob(secret),
    (character) => character.charCodeAt(0),
  );

  if (rawKey.length !== 32) {
    throw new Error("Fixture encryption key must be 32 bytes");
  }

  const key = await crypto.subtle.importKey(
    "raw",
    rawKey,
    { name: "AES-GCM" },
    false,
    ["decrypt"],
  );

  const stored = JSON.parse(encryptedToken);

  if (
    typeof stored.iv !== "string" ||
    typeof stored.ciphertext !== "string"
  ) {
    throw new Error("Invalid encrypted fixture token");
  }

  const iv = Uint8Array.from(
    atob(stored.iv),
    (character) => character.charCodeAt(0),
  );

  const ciphertext = Uint8Array.from(
    atob(stored.ciphertext),
    (character) => character.charCodeAt(0),
  );

  if (iv.length !== 12) {
    throw new Error("Invalid encryption IV");
  }

  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    ciphertext,
  );

  return new TextDecoder().decode(decrypted);
}

// =========================================================
// MAIN FUNCTION
// =========================================================


async function writeSecurityAudit(db: any, eventType: string, outcome: string, severity: string, actorType: string, actorReference: string | null, details: Record<string, unknown> = {}) {
  try {
    const { error } = await db.from("system_admin_audit_log").insert({
      source_system: "match_availability_parent_portal",
      severity, event_type: eventType, outcome, actor_type: actorType,
      actor_reference: actorReference, details,
    });
    if (error) console.error("Security audit write failed:", error.message);
  } catch (error) { console.error("Security audit write failed:", error); }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return response({ error: "Method not allowed" }, 405);
  }

  try {
    const body = await req.json();

    const installationId = body?.installation_id;
    const seniorCode = body?.senior_code;
    const coachCode = body?.coach_code;
    const action = body?.action;
    const fixtureId = body?.fixture_id;

    // Determine which role is making the request.
    const requestedRole =
      typeof coachCode === "string" && coachCode
        ? "coach"
        : "senior";

    if (
      typeof installationId !== "string" ||
      !installationId.trim() ||
      (requestedRole === "senior" &&
        (typeof seniorCode !== "string" || !seniorCode)) ||
      (requestedRole === "coach" &&
        (typeof coachCode !== "string" || !coachCode)) ||
      (seniorCode && coachCode) ||
      !["list", "detail", "update", "cancel"].includes(action) ||
      (["detail", "update", "cancel"].includes(action) &&
        (!Number.isInteger(fixtureId) || fixtureId <= 0))
    ) {
      return response({ error: "Invalid request details" }, 400);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !serviceKey) {
      console.error("Required environment variables are missing");
      return response({ error: "Service unavailable" }, 500);
    }

    const supabase = createClient(supabaseUrl, serviceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    // =====================================================
    // VERIFY INSTALLATION
    // =====================================================

    const { data: personId, error: accessError } =
      await supabase.rpc(
        "verify_installation_access",
        {
          requested_installation_id: installationId.trim(),
        },
      );

    if (accessError || !personId) {
      console.error(
        "Installation verification failed:",
        accessError?.message,
      );

      return response({ error: "Access denied" }, 401);
    }

    // =====================================================
    // VERIFY ROLE ACCESS
    // =====================================================

const suppliedCode = requestedRole === "coach" ? coachCode : seniorCode;
    const { data: codeValid, error: codeError } = await supabase.rpc(
      "verify_access_code_for_installation",
      {
        supplied_code: suppliedCode,
        code_type: requestedRole,
        supplied_installation_id: installationId.trim(),
      },
    );
    if (codeError) {
      console.error("Access code verification failed:", codeError.message);
      return response({
        error: requestedRole === "coach" ? "Unable to verify Coach access" : "Unable to verify Admin access",
      }, 500);
    }
    if (codeValid !== true) {
      return response({
        error: requestedRole === "coach" ? "Invalid Coach access code" : "Invalid Admin access code",
      }, 401);
    }

    // Coach operations require an individual authenticated session.
    // The shared Coach PIN is only for first-time personal PIN setup.
    let authenticatedPersonId = personId;
    if (requestedRole === "coach") {
      if (!/^[0-9a-f]{64}$/.test(suppliedCode)) {
        return response({ error: "Please sign in with your personal Coach PIN before continuing" }, 401);
      }
      const { data: sessionPersonId, error: sessionError } = await supabase.rpc(
        "get_authenticated_person_id",
        {
          supplied_credential: suppliedCode,
          required_access_role: "coach",
          supplied_installation_id: installationId.trim(),
        },
      );
      if (sessionError || !sessionPersonId) {
        return response({ error: "Your Coach session is no longer valid. Please sign in again." }, 401);
      }
      authenticatedPersonId = sessionPersonId;
    }

    // Coach permissions come only from server-side assignments.
    let authorisedAgeGroupNames: string[] = [];
    let authorisedAgeGroupIDs: number[] = [];
    if (requestedRole === "coach") {
      const { data: assignments, error: assignmentsError } = await supabase
        .from("user_age_group_assignments")
        .select("age_group_id")
        .eq("person_id", authenticatedPersonId);
      if (assignmentsError) {
        console.error("Coach age-group lookup failed:", assignmentsError.message);
        return response({ error: "Unable to verify Coach age-group access" }, 500);
      }
      authorisedAgeGroupIDs = [...new Set((assignments ?? []).map((item: any) => Number(item.age_group_id)))];
      if (authorisedAgeGroupIDs.length === 0) {
        return response({ error: "No age groups are assigned to this Coach account" }, 403);
      }
      const { data: assignedGroups, error: assignedGroupsError } = await supabase
        .from("age_groups")
        .select("id, age_group, display_name")
        .eq("active", true)
        .in("id", authorisedAgeGroupIDs);
      if (assignedGroupsError) {
        return response({ error: "Unable to verify Coach age-group access" }, 500);
      }
      authorisedAgeGroupNames = (assignedGroups ?? []).flatMap((group: any) => [group.display_name, group.age_group]);
    }

    // UPDATE OR CANCEL A FIXTURE
    // =====================================================

    if (action === "update" || action === "cancel") {
      const { data: fixtureRow, error: fixtureLookupError } = await supabase
        .from("match_fixtures")
        .select("id, status, season_event_fixture_links(event_id)")
        .eq("id", fixtureId)
        .maybeSingle();

      if (fixtureLookupError || !fixtureRow) {
        return response({ error: "Fixture not found" }, 404);
      }

      if (!["draft", "open"].includes(fixtureRow.status)) {
        return response({ error: "Only draft or open fixtures can be changed or cancelled" }, 400);
      }

      if ((fixtureRow.season_event_fixture_links ?? []).length > 0) {
        return response({
          error: "This event is managed through the Season Planner. Please change or cancel it there."
        }, 400);
      }

      // A Coach may change or cancel a fixture only when every linked
      // age group is assigned to that Coach. Never trust browser selections.
      if (requestedRole === "coach") {
        const { data: fixtureGroups, error: fixtureGroupsError } = await supabase
          .from("match_fixture_age_groups")
          .select("age_group_id")
          .eq("fixture_id", fixtureId);

        if (fixtureGroupsError) {
          return response({ error: "Unable to verify fixture age groups" }, 500);
        }

        if (!fixtureGroups?.length ||
            fixtureGroups.some((item: any) =>
              !authorisedAgeGroupIDs.includes(Number(item.age_group_id))
            )) {
          return response({ error: "You do not have access to manage every age group in this fixture" }, 403);
        }
      }

      if (action === "cancel") {
        const { error: cancelError } = await supabase
          .from("match_fixtures")
          .update({ status: "cancelled" })
          .eq("id", fixtureId)
          .in("status", ["draft", "open"]);

        if (cancelError) {
          console.error("Fixture cancellation failed:", cancelError.message);
          return response({ error: "Unable to cancel fixture" }, 500);
        }

        await writeSecurityAudit(supabase, "fixture_cancelled", "success", "warning", requestedRole, installationId.trim(), {
          fixture_id: Number(fixtureId),
        });
        return response({ success: true, message: "Fixture cancelled" });
      }

      const opposition = body?.opposition;
      const fixtureDate = body?.fixture_date;
      const fixtureType = body?.fixture_type;
      const kickOffTime = body?.kick_off_time ?? null;
      const venue = body?.venue ?? "";
      const venueAddress = body?.venue_address ?? "";
      const responseDeadline = body?.response_deadline ?? null;
      const ageGroupIds = body?.age_group_ids;

      if (
        typeof opposition !== "string" || !opposition.trim() ||
        opposition.length > 150 ||
        typeof fixtureDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(fixtureDate) ||
        !["home", "away"].includes(fixtureType) ||
        (kickOffTime !== null && (typeof kickOffTime !== "string" || !/^\d{2}:\d{2}$/.test(kickOffTime))) ||
        typeof venue !== "string" || venue.length > 150 ||
        typeof venueAddress !== "string" || venueAddress.length > 300 ||
        (responseDeadline !== null && (typeof responseDeadline !== "string" || Number.isNaN(Date.parse(responseDeadline)))) ||
        !Array.isArray(ageGroupIds) || ageGroupIds.length === 0 ||
        ageGroupIds.some((id: any) => !Number.isInteger(id) || id <= 0)
      ) {
        return response({ error: "Invalid fixture details" }, 400);
      }

      const { data: currentLinks, error: linksError } = await supabase
        .from("match_fixture_age_groups")
        .select("age_group_id")
        .eq("fixture_id", fixtureId);

      if (linksError) {
        return response({ error: "Unable to check fixture age groups" }, 500);
      }

      const { count: submissionCount, error: submissionsError } = await supabase
        .from("match_submissions")
        .select("id", { count: "exact", head: true })
        .eq("fixture_id", fixtureId);

      if (submissionsError) {
        return response({ error: "Unable to check existing responses" }, 500);
      }

      const currentIDs = (currentLinks ?? []).map((item: any) => Number(item.age_group_id)).sort((a: number, b: number) => a - b);
      const requestedIDs = [...new Set(ageGroupIds.map(Number))].sort((a: number, b: number) => a - b);
      const groupsChanged = currentIDs.length !== requestedIDs.length ||
        currentIDs.some((id: number, index: number) => id !== requestedIDs[index]);

      if (groupsChanged && Number(submissionCount || 0) > 0) {
        return response({ error: "Age groups cannot be changed after parents have responded" }, 400);
      }

      const { data: validGroups, error: validGroupsError } = await supabase
        .from("age_groups")
        .select("id, age_group, display_name")
        .eq("active", true)
        .in("id", requestedIDs);

      if (validGroupsError || (validGroups ?? []).length !== requestedIDs.length) {
        return response({ error: "One or more selected age groups are unavailable" }, 400);
      }

      if (requestedRole === "coach") {
        const permittedChanges = new Set(
          (validGroups ?? [])
            .filter((group: any) =>
              (authorisedAgeGroupNames.includes(group.display_name) || authorisedAgeGroupNames.includes(group.age_group))
            )
            .map((group: any) => Number(group.id))
        );

        const changedIDs = [
          ...currentIDs.filter((id: number) => !requestedIDs.includes(id)),
          ...requestedIDs.filter((id: number) => !currentIDs.includes(id)),
        ];

        if (changedIDs.some((id: number) => !permittedChanges.has(id))) {
          return response({
            error: "Coaches can only change age groups assigned to their dashboard access"
          }, 403);
        }
      }

      const { error: updateError } = await supabase
        .from("match_fixtures")
        .update({
          opposition: opposition.trim(),
          fixture_date: fixtureDate,
          fixture_type: fixtureType,
          kick_off_time: kickOffTime,
          venue: venue.trim(),
          venue_address: venueAddress.trim(),
          response_deadline: responseDeadline,
        })
        .eq("id", fixtureId)
        .in("status", ["draft", "open"]);

      if (updateError) {
        console.error("Fixture update failed:", updateError.message);
        return response({ error: "Unable to update fixture details" }, 500);
      }

      if (groupsChanged) {
        const { error: deleteLinksError } = await supabase
          .from("match_fixture_age_groups")
          .delete()
          .eq("fixture_id", fixtureId);

        if (deleteLinksError) {
          console.error("Fixture age group removal failed:", deleteLinksError.message);
          return response({ error: "Fixture details saved, but age groups could not be updated" }, 500);
        }

        const { error: insertLinksError } = await supabase
          .from("match_fixture_age_groups")
          .insert(requestedIDs.map((age_group_id: number) => ({
            fixture_id: fixtureId,
            age_group_id,
          })));

        if (insertLinksError) {
          console.error("Fixture age group update failed:", insertLinksError.message);
          return response({ error: "Fixture details saved, but age groups could not be updated" }, 500);
        }
      }

      await writeSecurityAudit(supabase, "fixture_updated", "success", "info", requestedRole, installationId.trim(), {
        fixture_id: Number(fixtureId), age_groups_changed: groupsChanged,
      });
      return response({ success: true, message: "Fixture updated" });
    }

    // =====================================================
    // RETRIEVE FIXTURES AND RESPONSES
    // =====================================================


    // =====================================================
    // RETRIEVE ACTIVE MASTER AGE GROUPS
    // =====================================================

    const { data: availableAgeGroups, error: ageGroupsError } =
      await supabase
        .from("age_groups")
        .select(`
          id,
          age_group,
          display_name,
          sort_order
        `)
        .eq("active", true)
        .order("sort_order", { ascending: true });

    if (ageGroupsError) {
      console.error(
        "Active age group retrieval failed:",
        ageGroupsError.message,
      );

      return response({
        error: "Unable to retrieve active age groups",
      }, 500);
    }

    let selectedAgeGroupIDs: number[] = [];
    if (requestedRole === "coach") {
      selectedAgeGroupIDs = authorisedAgeGroupIDs.filter((id) =>
        (availableAgeGroups ?? []).some((group: any) => Number(group.id) === id)
      );
      if (selectedAgeGroupIDs.length === 0) {
        return response({ error: "No active age groups are assigned to this Coach account" }, 403);
      }
    }

    let query = supabase
      .from("match_fixtures")
      .select(`
        id,
        public_token_encrypted,
        opposition,
        fixture_date,
        fixture_type,
        kick_off_time,
        venue,
        venue_address,
        response_deadline,
        status,
        created_at,
        season_event_fixture_links ( event_id ),
        match_fixture_age_groups (
          age_groups (
            id,
            age_group,
            display_name,
            sort_order
          )
        ),
        match_submissions (
          id,
          parent_name,
          parent_contact,
          submitted_at,
          updated_at,
          edit_lock_expires_at,
          match_availability (
            id,
            child_name,
            age_group_id,
            school_year,
            availability,
            duplicate_review_status
          )
        )
      `)
      .order("fixture_date", { ascending: true });

    if (action === "detail") {
      query = query.eq("id", fixtureId);
    }

    const { data: fixtures, error: fixturesError } =
      await query;

    if (fixturesError) {
      console.error(
        "Fixture retrieval failed:",
        fixturesError.message,
      );

      return response({
        error: "Unable to retrieve fixtures",
      }, 500);
    }

    if (action === "detail" && (!fixtures || fixtures.length === 0)) {
      return response({ error: "Fixture not found" }, 404);
    }

    const results = [];

    for (const fixture of fixtures ?? []) {

      const allGroups = (fixture.match_fixture_age_groups ?? [])
        .map((item: any) => item.age_groups)
        .filter(Boolean)
        .sort(
          (a: any, b: any) => a.sort_order - b.sort_order,
        );

      // Coaches receive fixture and response data only for their assigned
      // age groups, on both list and detail requests.
      const groups = requestedRole === "coach"
        ? allGroups.filter((group: any) => selectedAgeGroupIDs.includes(Number(group.id)))
        : allGroups;

      // Do not expose stale parent response headers after all child entries are deleted.
      const allSubmissions = (fixture.match_submissions ?? []).filter(
        (submission: any) => (submission.match_availability ?? []).length > 0,
      );
      const submissions = requestedRole === "coach"
        ? allSubmissions
            .map((submission: any) => ({
              ...submission,
              match_availability: (submission.match_availability ?? [])
                .filter((child: any) => selectedAgeGroupIDs.includes(Number(child.age_group_id))),
            }))
            .filter((submission: any) => submission.match_availability.length > 0)
        : allSubmissions;

      // A Coach must not even receive fixture metadata for unrelated groups.
      if (requestedRole === "coach" && groups.length === 0) continue;

      const children = submissions.flatMap((submission: any) =>
        (submission.match_availability ?? []).map((child: any) => ({
          ...child,
          parent_name: submission.parent_name,
          parent_contact: submission.parent_contact,
          submitted_at: submission.submitted_at,
        })),
      );

      // ===================================================
      // AGE GROUP COUNTS
      // ===================================================

      const ageGroupCounts = groups.map((group: any) => {

        const groupChildren = children.filter(
          (child: any) => child.age_group_id === group.id,
        );

        return {
          age_group_id: group.id,
          age_group: group.age_group,
          display_name: group.display_name,
          total: groupChildren.length,
          available: groupChildren.filter(
            (child: any) => child.availability === "available",
          ).length,
          unavailable: groupChildren.filter(
            (child: any) => child.availability === "unavailable",
          ).length,
          unsure: groupChildren.filter(
            (child: any) => child.availability === "unsure",
          ).length,
        };
      });

      // ===================================================
      // FIXTURE SUMMARY
      // ===================================================

      const responseAgeGroups = requestedRole === "coach"
        ? ageGroupCounts.filter((group: any) =>
            selectedAgeGroupIDs.includes(Number(group.age_group_id)),
          )
        : ageGroupCounts;

      const result: any = {
        id: fixture.id,
        opposition: fixture.opposition,
        fixture_date: fixture.fixture_date,
        fixture_type: fixture.fixture_type,
        kick_off_time: fixture.kick_off_time,
        venue: fixture.venue,
        venue_address: fixture.venue_address,
        response_deadline: fixture.response_deadline,
        status: fixture.status,
        created_at: fixture.created_at,
        calendar_managed: (fixture.season_event_fixture_links ?? []).length > 0,
        calendar_event_ids: (fixture.season_event_fixture_links ?? []).map((link: any) => Number(link.event_id)),
        response_count: submissions.length,
        children_count: children.length,
        available_count: responseAgeGroups.reduce((total: number, group: any) => total + Number(group.available || 0), 0),
        unavailable_count: responseAgeGroups.reduce((total: number, group: any) => total + Number(group.unavailable || 0), 0),
        age_groups: ageGroupCounts,
        duplicate_review_count: children.filter(
          (child: any) =>
            child.duplicate_review_status === "pending",
        ).length,
      };

      // ===================================================
      // DETAIL RESPONSE
      // ===================================================

      if (action === "detail") {

        // Return the original parent token only for
        // authorised detail requests.
        if (!fixture.public_token_encrypted) {
          result.parent_token = null;
        } else {
          try {
            result.parent_token = await decryptToken(
              fixture.public_token_encrypted,
            );
          } catch (error) {
            console.error(
              "Fixture token decryption failed:",
              fixture.id,
              error,
            );

            return response({
              error: "Unable to retrieve parent fixture link",
            }, 500);
          }
        }

        result.submissions = submissions.map(
          (submission: any) => ({
            id: submission.id,
            parent_name: submission.parent_name,
            parent_contact: submission.parent_contact,
            submitted_at: submission.submitted_at,
            updated_at: submission.updated_at,
            edit_locked: Boolean(submission.edit_lock_expires_at && new Date(submission.edit_lock_expires_at).getTime() > Date.now()),
            edit_lock_expires_at: submission.edit_lock_expires_at,

            children: (submission.match_availability ?? []).map(
              (child: any) => ({
                ...child,
                age_group: groups.find(
                  (group: any) => group.id === child.age_group_id,
                )?.age_group ?? null,
              }),
            ),
          }),
        );
      }

      results.push(result);
    }


    return response({
      success: true,
      requested_by: requestedRole === "coach" ? authenticatedPersonId : personId,
      requested_role: requestedRole,
      available_age_groups: availableAgeGroups ?? [],
      fixtures: results,
    });


  } catch (error) {
    console.error("Unexpected admin_fixtures error:", error);
    return response({ error: "Invalid request" }, 400);
  }
});
