import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function response(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}


function normalise(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

async function derivePinHash(pin: string, saltBase64: string): Promise<string> {
  const salt = Uint8Array.from(atob(saltBase64), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: 210000, hash: "SHA-256" }, key, 256);
  return Array.from(new Uint8Array(bits)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}

async function authenticateParent(supabase: any, parentName: string, pin: string, allowCreate: boolean) {
  const normalisedName = normalise(parentName);
  let { data: account, error } = await supabase.from("match_parent_access")
    .select("id,parent_name,pin_salt,pin_hash,failed_attempts,locked_until")
    .eq("normalised_name", normalisedName).maybeSingle();
  if (error) throw new Error("Unable to verify parent access");

  if (!account && allowCreate) {
    const saltBytes = crypto.getRandomValues(new Uint8Array(16));
    const salt = btoa(String.fromCharCode(...saltBytes));
    const hash = await derivePinHash(pin, salt);
    const { data: created, error: createError } = await supabase.from("match_parent_access")
      .insert({ parent_name: parentName.trim(), normalised_name: normalisedName, pin_salt: salt, pin_hash: hash })
      .select("id,parent_name,pin_salt,pin_hash,failed_attempts,locked_until").single();
    if (!createError && created) return { ok: true, created: true };
    const retry = await supabase.from("match_parent_access")
      .select("id,parent_name,pin_salt,pin_hash,failed_attempts,locked_until")
      .eq("normalised_name", normalisedName).maybeSingle();
    if (retry.error || !retry.data) throw new Error("Unable to create parent access. Please try again.");
    account = retry.data;
  }

  if (!account) return { ok: false, status: 401, error: "Parent account not found. Please return to Parent Home and register first." };
  if (account.locked_until && new Date(account.locked_until).getTime() > Date.now()) {
    return { ok: false, status: 429, error: "Too many incorrect PIN attempts. Please try again in 10 minutes." };
  }

  const suppliedHash = await derivePinHash(pin, account.pin_salt);
  if (!constantTimeEqual(suppliedHash, account.pin_hash)) {
    const attempts = Number(account.failed_attempts || 0) + 1;
    const lockedUntil = attempts >= 5 ? new Date(Date.now() + 10 * 60 * 1000).toISOString() : null;
    await supabase.from("match_parent_access").update({
      failed_attempts: attempts >= 5 ? 0 : attempts,
      locked_until: lockedUntil,
      updated_at: new Date().toISOString(),
    }).eq("id", account.id);
    return lockedUntil
      ? { ok: false, status: 429, error: "Too many incorrect PIN attempts. Please try again in 10 minutes." }
      : { ok: false, status: 401, error: "That PIN is incorrect. Please try again." };
  }

  await supabase.from("match_parent_access").update({
    failed_attempts: 0, locked_until: null, updated_at: new Date().toISOString(),
  }).eq("id", account.id);
  return { ok: true, created: false };
}

async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function generateToken(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)))
    .map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function decryptToken(encryptedToken: string): Promise<string> {
  const secret = Deno.env.get("FIXTURE_TOKEN_ENCRYPTION_KEY");
  if (!secret) throw new Error("Fixture encryption key is missing");
  const rawKey = Uint8Array.from(atob(secret), (c) => c.charCodeAt(0));
  if (rawKey.length !== 32) throw new Error("Invalid fixture encryption key");
  const key = await crypto.subtle.importKey("raw", rawKey, { name: "AES-GCM" }, false, ["decrypt"]);
  const stored = JSON.parse(encryptedToken);
  const iv = Uint8Array.from(atob(stored.iv), (c) => c.charCodeAt(0));
  const ciphertext = Uint8Array.from(atob(stored.ciphertext), (c) => c.charCodeAt(0));
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
  return new TextDecoder().decode(decrypted);
}


async function encryptToken(token: string): Promise<string> {
  const secret = Deno.env.get("FIXTURE_TOKEN_ENCRYPTION_KEY");
  if (!secret) throw new Error("Fixture encryption key is missing");
  const rawKey = Uint8Array.from(atob(secret), (c) => c.charCodeAt(0));
  if (rawKey.length !== 32) throw new Error("Invalid fixture encryption key");
  const key = await crypto.subtle.importKey("raw", rawKey, { name: "AES-GCM" }, false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(token));
  return JSON.stringify({
    iv: btoa(String.fromCharCode(...iv)),
    ciphertext: btoa(String.fromCharCode(...new Uint8Array(ciphertext))),
  });
}

function eventToken(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)))
    .map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function syncCurrentSeasonEvents(supabase: any, today: string) {
  const { data: events, error } = await supabase
    .from("season_planner_events")
    .select("id,season_id,age_group_id,event_date,event_type,title,start_time,end_time,venue,match_location,opposition,notes,availability_enabled,seasons!inner(is_current)")
    .eq("seasons.is_current", true)
    .gte("event_date", today)
    .order("event_date", { ascending: true });
  if (error) throw new Error("Unable to load current season events: " + error.message);

  const grouped = new Map<string, any[]>();
  for (const event of events ?? []) {
    const key = [
      event.event_date, event.title, event.event_type, event.match_location ?? "",
      String(event.start_time ?? "").slice(0, 5), String(event.end_time ?? "").slice(0, 5),
      event.venue ?? "", event.notes ?? "", event.availability_enabled === true ? "on" : "off",
    ].join("|");
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(event);
  }

  const syncedFixtureLinks: { fixture_id: number; event_ids: number[] }[] = [];
  for (const items of grouped.values()) {
    const first = items[0];
    const eventIds = items.map((x) => x.id);
    const groupIds = [...new Set(items.map((x) => x.age_group_id))];
    const eligible = first.availability_enabled === true &&
      !["holiday", "cancelled"].includes(first.event_type);

    const { data: links, error: linkReadError } = await supabase
      .from("season_event_fixture_links")
      .select("event_id,fixture_id")
      .in("event_id", eventIds);
    if (linkReadError) throw new Error("Unable to read event links: " + linkReadError.message);

    let fixtureId = links?.[0]?.fixture_id ?? null;
    const duplicateFixtureIds = [...new Set((links ?? []).map((x: any) => Number(x.fixture_id)))].filter((id: number) => id !== Number(fixtureId));
    if (duplicateFixtureIds.length) {
      const { error: duplicateCloseError } = await supabase.from("match_fixtures")
        .update({ status: "closed" }).in("id", duplicateFixtureIds).in("status", ["draft", "open"]);
      if (duplicateCloseError) throw new Error("Unable to close duplicate availability links");
    }
    let fixtureToken: string | null = null;

    if (!eligible) {
      if (fixtureId) {
        const { error: closeError } = await supabase.from("match_fixtures")
          .update({ status: "closed" }).eq("id", fixtureId).in("status", ["draft", "open"]);
        if (closeError) throw new Error("Unable to close disabled event: " + closeError.message);
      }
      continue;
    }

    const token = eventToken();
    const fixtureData = {
      opposition: first.event_type === "match" ? (first.opposition || first.title) : first.title,
      fixture_date: first.event_date,
      fixture_type: first.event_type === "match"
        ? (first.match_location === "away" ? "away" : "home")
        : first.event_type,
      kick_off_time: first.start_time,
      venue: first.venue,
      venue_address: null,
      response_deadline: null,
      season_id: first.season_id,
      status: "open",
    };

    if (fixtureId) {
      const { data: existing, error: existingError } = await supabase
        .from("match_fixtures")
        .select("id,public_token_encrypted,status")
        .eq("id", fixtureId).maybeSingle();
      if (existingError || !existing) throw new Error("Linked availability record is missing");
      const updateData: any = { ...fixtureData };
      if (existing.status !== "open") updateData.status = "open";
      const { error: updateError } = await supabase.from("match_fixtures")
        .update(updateData).eq("id", fixtureId);
      if (updateError) throw new Error("Unable to synchronise event: " + updateError.message);
    } else {
      const tokenHash = await hashToken(token);
      const encrypted = await encryptToken(token);
      const { data: created, error: createError } = await supabase
        .from("match_fixtures")
        .insert({ ...fixtureData, public_token_hash: tokenHash, public_token_encrypted: encrypted })
        .select("id").single();
      if (createError || !created) throw new Error("Unable to create event availability: " + (createError?.message ?? "unknown"));
      fixtureId = created.id;
      fixtureToken = token;
    }

    const { data: currentGroups, error: groupReadError } = await supabase
      .from("match_fixture_age_groups").select("age_group_id").eq("fixture_id", fixtureId);
    if (groupReadError) throw new Error("Unable to read event age groups: " + groupReadError.message);
    const currentGroupIds = (currentGroups ?? []).map((x: any) => Number(x.age_group_id)).sort((a: number,b: number)=>a-b);
    const targetGroupIds = groupIds.map(Number).sort((a: number,b: number)=>a-b);
    const { count: responseCount, error: countError } = await supabase
      .from("match_submissions").select("id", { count: "exact", head: true }).eq("fixture_id", fixtureId);
    if (countError) throw new Error("Unable to check existing responses: " + countError.message);
    if (Number(responseCount ?? 0) === 0 &&
      (currentGroupIds.length !== targetGroupIds.length || currentGroupIds.some((id: number,i: number)=>id!==targetGroupIds[i]))) {
      const { error: deleteGroupsError } = await supabase.from("match_fixture_age_groups").delete().eq("fixture_id", fixtureId);
      if (deleteGroupsError) throw new Error("Unable to update event age groups");
      const { error: insertGroupsError } = await supabase.from("match_fixture_age_groups")
        .insert(targetGroupIds.map((age_group_id: number)=>({fixture_id:fixtureId,age_group_id})));
      if (insertGroupsError) throw new Error("Unable to assign event age groups");
    }

    const missingLinks = eventIds.filter((id: number)=>!(links ?? []).some((x: any)=>Number(x.event_id)===Number(id)));
    if (missingLinks.length) {
      const { error: mapError } = await supabase.from("season_event_fixture_links")
        .upsert(missingLinks.map((event_id: number)=>({event_id,fixture_id: fixtureId})), { onConflict: "event_id" });
      if (mapError) throw new Error("Unable to link calendar event: " + mapError.message);
    }
    syncedFixtureLinks.push({ fixture_id: Number(fixtureId), event_ids: eventIds.map(Number) });
  }
  return syncedFixtureLinks;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return response({ error: "Method not allowed" }, 405);

  try {
    const body = await req.json();

    if (body?.action === "sync_calendar") {
      const installationId = typeof body.installation_id === "string" ? body.installation_id.trim() : "";
      const seniorCode = typeof body.senior_code === "string" ? body.senior_code : "";
      if (!installationId || !seniorCode) return response({ error: "Senior access is required" }, 401);
      const url = Deno.env.get("SUPABASE_URL");
      const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      if (!url || !key) return response({ error: "Service unavailable" }, 500);
      const adminClient = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
      const { data: personId, error: installationError } = await adminClient.rpc("verify_installation_access", {
        requested_installation_id: installationId
      });
      if (installationError || !personId) return response({ error: "Access denied" }, 401);
      const { data: seniorVerified, error: seniorError } = await adminClient.rpc("verify_access_code", {
        supplied_code: seniorCode,
        code_type: "senior"
      });
      if (seniorError || seniorVerified !== true) return response({ error: "Invalid Senior access code" }, 401);
      const synced = await syncCurrentSeasonEvents(adminClient, new Intl.DateTimeFormat("en-CA", {
        timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit",
      }).format(new Date()));
      return response({ success: true, synced_fixture_count: synced.length, calendar_links: synced });
    }

    const parentName = typeof body?.parent_name === "string" ? body.parent_name.trim() : "";
    const parentPin = typeof body?.parent_pin === "string" ? body.parent_pin.trim() : "";
    if (!parentName || parentName.length > 100) return response({ error: "Please enter your parent / guardian name" }, 400);
    if (!/^\d{6}$/.test(parentPin)) return response({ error: "Please enter your 6-digit PIN" }, 400);

    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !key) return response({ error: "Service unavailable" }, 500);
    const supabase = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

    const parentAccess = await authenticateParent(supabase, parentName, parentPin, true);
    if (!parentAccess.ok) return response({ error: parentAccess.error }, parentAccess.status);

    // Always use the currently active club age groups for Parent Home display.
    // This keeps age-group lists and "all age groups" detection in step with Senior settings.
    const { data: activeAgeGroups, error: ageGroupError } = await supabase
      .from("age_groups")
      .select("id,age_group,display_name,sort_order")
      .eq("active", true)
      .order("sort_order", { ascending: true });
    if (ageGroupError) {
      console.error("Age group lookup failed:", ageGroupError.message);
      return response({ error: "Unable to load club age groups" }, 500);
    }
    const activeAgeGroupIds = new Set((activeAgeGroups ?? []).map((x: any) => Number(x.id)));

    // Parent Home reads already-synchronised fixtures only.
    // Fixture creation and synchronisation are handled by the authorised Senior calendar.
    
    const { data: fixtures, error: fixtureError } = await supabase
      .from("match_fixtures")
      .select(`
        id, opposition, fixture_date, fixture_type, kick_off_time, venue,
        venue_address, response_deadline, status, public_token_encrypted,
        match_fixture_age_groups (
          age_group_id,
          age_groups ( id, age_group, display_name, sort_order )
        )
      `)
      .eq("status", "open")
      .order("fixture_date", { ascending: true });

    if (fixtureError) {
      console.error("Fixture lookup failed:", fixtureError.message);
      return response({ error: "Unable to load upcoming events" }, 500);
    }

    const now = Date.now();
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit",
    }).format(new Date());

    const upcoming = (fixtures ?? []).filter((f: any) =>
      f.fixture_date >= today &&
      (!f.response_deadline || new Date(f.response_deadline).getTime() > now)
    );

    const ids = upcoming.map((f: any) => f.id);
    let submissions: any[] = [];
    if (ids.length) {
      const { data, error } = await supabase
        .from("match_submissions")
        .select(`
          id, fixture_id, parent_name, submitted_at, updated_at, edit_lock_expires_at,
          match_availability ( id, child_name, age_group_id, school_year, availability )
        `)
        .in("fixture_id", ids);

      if (error) {
        console.error("Parent response lookup failed:", error.message);
        return response({ error: "Unable to load your saved responses" }, 500);
      }
      // Empty submissions are not valid responses (e.g. after a coach deletes the last child).
      submissions = (data ?? []).filter((s: any) =>
        Array.isArray(s.match_availability) && s.match_availability.length > 0
      );
    }

    const ownSubmissions = submissions.filter((s: any) =>
      normalise(s.parent_name) === normalise(parentName)
    );

    // Reissue a private edit token only for this deliberate name lookup.
    const ownWithTokens = [];
    const refreshOnly = body?.refresh === true;
    for (const submission of ownSubmissions) {
      const editLocked = Boolean(
        submission.edit_lock_expires_at &&
        new Date(submission.edit_lock_expires_at).getTime() > Date.now()
      );

      if (refreshOnly || editLocked) {
        // Background refreshes and active parent edits must never rotate a private edit link.
        ownWithTokens.push({ ...submission, edit_token: null, edit_locked: editLocked });
        continue;
      }

      const editToken = generateToken();
      const { error } = await supabase
        .from("match_submissions")
        .update({ edit_token_hash: await hashToken(editToken) })
        .eq("id", submission.id);
      if (error) {
        console.error("Edit access refresh failed:", error.message);
        return response({ error: "Unable to retrieve one of your saved responses" }, 500);
      }
      ownWithTokens.push({ ...submission, edit_token: editToken, edit_locked: false });
    }

    const { data: linkedFixtureRows, error: linkedFixtureError } = await supabase
      .from("season_event_fixture_links").select("fixture_id");
    if (linkedFixtureError) {
      console.error("Calendar fixture link lookup failed:", linkedFixtureError.message);
      return response({ error: "Unable to load calendar availability links" }, 500);
    }
    const calendarFixtureIds = new Set((linkedFixtureRows ?? []).map((x: any) => Number(x.fixture_id)));

    const resultFixtures = [];
    for (const fixture of upcoming) {
      let fixtureToken: string | null = null;
      try {
        if (fixture.public_token_encrypted) fixtureToken = await decryptToken(fixture.public_token_encrypted);
      } catch (error) {
        console.error("Fixture token decryption failed:", fixture.id, error);
      }

      // Calendar fixtures are newly generated by the planner. If an older encryption
      // key left one unreadable, issue a fresh token and persist its matching hash.
      if (!fixtureToken && calendarFixtureIds.has(Number(fixture.id))) {
        try {
          const replacementToken = generateToken();
          const replacementHash = await hashToken(replacementToken);
          const replacementEncrypted = await encryptToken(replacementToken);
          const { error: tokenRepairError } = await supabase.from("match_fixtures")
            .update({
              public_token_hash: replacementHash,
              public_token_encrypted: replacementEncrypted,
            })
            .eq("id", fixture.id);
          if (tokenRepairError) throw tokenRepairError;
          fixtureToken = replacementToken;
        } catch (repairError) {
          console.error("Calendar fixture token repair failed:", fixture.id, repairError);
        }
      }

      const groups = (fixture.match_fixture_age_groups ?? [])
        .map((x: any) => x.age_groups).filter((x: any) => x && activeAgeGroupIds.has(Number(x.id)))
        .sort((a: any, b: any) => Number(a.sort_order ?? 999) - Number(b.sort_order ?? 999));
      resultFixtures.push({
        id: fixture.id,
        opposition: fixture.opposition,
        fixture_date: fixture.fixture_date,
        fixture_type: fixture.fixture_type,
        kick_off_time: fixture.kick_off_time,
        venue: fixture.venue,
        venue_address: fixture.venue_address,
        response_deadline: fixture.response_deadline,
        fixture_token: fixtureToken,
        age_groups: groups,
        submission: ownWithTokens.find((s: any) => s.fixture_id === fixture.id) ?? null,
      });
    }


    const { data: calendarRows, error: calendarError } = await supabase
      .from("season_planner_events")
      .select("id,season_id,age_group_id,event_date,event_type,title,start_time,end_time,venue,match_location,opposition,notes,availability_enabled,seasons!inner(is_current),age_groups(id,age_group,display_name,sort_order),season_event_fixture_links(fixture_id)")
      .eq("seasons.is_current", true)
      .gte("event_date", today)
      .order("event_date", { ascending: true });
    if (calendarError) {
      console.error("Calendar lookup failed:", calendarError.message);
      return response({ error: "Unable to load the season calendar" }, 500);
    }

    const eventGroups = new Map<string, any[]>();
    // Ignore calendar rows for age groups that have since been deactivated.
    for (const event of calendarRows ?? []) {
      if (!activeAgeGroupIds.has(Number(event.age_group_id))) continue;
      const key = [
        event.event_date, event.title, event.event_type, event.match_location ?? "",
        String(event.start_time ?? "").slice(0, 5), String(event.end_time ?? "").slice(0, 5),
        event.venue ?? "", event.notes ?? "", event.availability_enabled === true ? "on" : "off",
      ].join("|");
      if (!eventGroups.has(key)) eventGroups.set(key, []);
      eventGroups.get(key).push(event);
    }
    const calendarEvents = [...eventGroups.values()].map((items: any[]) => {
      const first = items[0];
      // This relationship is one-to-one (event_id is the primary key),
      // so PostgREST may return an object rather than an array.
      const linkedId = items.map((x: any) => {
        const relation = x.season_event_fixture_links;
        if (Array.isArray(relation)) return relation.find((link: any) => link?.fixture_id)?.fixture_id;
        return relation?.fixture_id ?? null;
      }).find(Boolean);
      const fixture = linkedId ? resultFixtures.find((x: any) => Number(x.id) === Number(linkedId)) ?? null : null;
      const ageGroupIds = [...new Set(items.map((x: any) => Number(x.age_group_id)))];
      const activeIds = (activeAgeGroups ?? []).map((x: any) => Number(x.id));
      const includesAllAgeGroups = activeIds.length > 0 &&
        activeIds.length === ageGroupIds.length &&
        activeIds.every((id: number) => ageGroupIds.includes(id));
      const orderedEventAgeGroups = includesAllAgeGroups
        ? activeAgeGroups
        : ageGroupIds.map((id: number) => items.find((x: any) => Number(x.age_group_id) === id)?.age_groups)
          .filter(Boolean)
          .sort((a: any, b: any) => Number(a.sort_order ?? 999) - Number(b.sort_order ?? 999));
      return {
        event_id: first.id,
        fixture_id: linkedId ? Number(linkedId) : null,
        event_date: first.event_date,
        event_type: first.event_type,
        title: first.title,
        opposition: first.opposition,
        match_location: first.match_location,
        start_time: first.start_time,
        end_time: first.end_time,
        venue: first.venue,
        notes: first.notes,
        availability_enabled: first.availability_enabled === true && !["holiday", "cancelled"].includes(first.event_type),
        age_group_ids: includesAllAgeGroups ? activeIds : ageGroupIds,
        age_groups: orderedEventAgeGroups,
        fixture,
        fixture_token: fixture?.fixture_token ?? null,
      };
    });

    return response({ success: true, parent_name: parentName, fixtures: resultFixtures, calendar_events: calendarEvents });
  } catch (error) {
    console.error("Unexpected parent_home error:", error);
    return response({ error: "Unable to load parent home page" }, 400);
  }
});