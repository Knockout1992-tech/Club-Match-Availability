let ageGroupData = [];


// Load age groups =======================================

async function loadAgeGroupsFromSupabase() {

    const {
        data,
        error
    } = await supabaseClient
        .from("age_groups")
        .select(`
            id,
            age_group,
            display_name,
            sort_order,
            active,
            next_age_group_id
        `)
        .order("sort_order", {
            ascending: true
        });

    if (error) {

        console.error(
            "Supabase age groups load failed:",
            error
        );

        await appAlert(
            "Unable to load age groups. Please try again.",
            "Age groups unavailable",
            "danger"
        );

        return false;
    }

    ageGroupData = data || [];

    // Build age group list ---------------------------------

    ageGroups = ageGroupData.map(
        group => group.age_group
    );
return true;
}


// Get active age groups ====================================

function getActiveAgeGroups() {

    return ageGroupData
        .filter(group => group.active)
        .map(group => group.age_group);

}


// Get Next Age Group =======================================

function getNextAgeGroup(ageGroup) {

    const currentGroup = ageGroupData.find(
        group => group.age_group === ageGroup
    );

    if (!currentGroup || !currentGroup.next_age_group_id) {
        return null;
    }

    const nextGroup = ageGroupData.find(
        group => group.id === currentGroup.next_age_group_id
    );

    if (!nextGroup) {
        return null;
    }

    return nextGroup.age_group;

}