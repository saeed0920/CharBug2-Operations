
import fs from "fs";
import fetch from "node-fetch"
import * as cheerio from 'cheerio';


// ─────────────────────────────────────────────
// ✅ CONFIG
// ─────────────────────────────────────────────
const DOMJUDGE_BASE = "http://185.97.116.151:12345";
const PHPSESSID = "kduckatjkcqasrilrphndr47v7";
const INPUT_FILE = "./users_to_created.json";

// Standard DOMjudge role mapping
const ROLE_MAP = {
  admin: 1,
  jury: 2,
  team: 3
};


const getInputId = async (user_id) => {
    const  res = await fetch(`${DOMJUDGE_BASE}/jury/users/${user_id}/edit`, {
          headers: {
             "Cookie": `PHPSESSID=${PHPSESSID}`
          }
        })
       const html = await  res.text()
       const $ = cheerio.load(html);
       const teamOption = $('#user_team[name="user[team]"] option[selected]').val();

       console.log("Selected team ID:", teamOption);
       return teamOption
}



// ─────────────────────────────────────────────
// ✅ LOAD USERS FROM JSON FILE
// ─────────────────────────────────────────────
const users = JSON.parse(fs.readFileSync(INPUT_FILE, "utf8"));

// ─────────────────────────────────────────────
// ✅ MAIN UPDATE FUNCTION
// ─────────────────────────────────────────────
async function updateUserFromJson(localUser) {
    
  try {
    console.log(`🔄 Processing ${localUser.username} (ID: ${localUser.id})`);

    // 1. FETCH USER FROM API
    const apiRes = await fetch(
      `${DOMJUDGE_BASE}/api/v4/users/${localUser.username}`,
      {
        headers: {
          "Cookie": `PHPSESSID=${PHPSESSID}`
        }
      }
    );

    if (!apiRes.ok) {
      throw new Error(`API fetch failed for ID ${localUser.id}`);
    }

    const apiUser = await apiRes.json();

    // 2. EXTRACT REQUIRED FIELDS
    const juryUserId = apiUser.userid;
    const externalId = apiUser.id;
    const name = apiUser.team;
    const teamId = await getInputId(apiUser.userid) ;
    const roles = apiUser.roles || [];

    const numericRoles = roles
      .map(r => ROLE_MAP[r])
      .filter(Boolean);

    // 3. BUILD FORM BODY (PASSWORD FROM JSON)
    const form = new URLSearchParams();
    form.append("user[externalid]", externalId);
    form.append("user[name]", name);
    //form.append("user[email]", "");
    form.append("user[plainPassword]", `${localUser.password}`);
   // form.append("user[ipAddress]", "");
    form.append("user[enabled]", "1");
    form.append("user[team]", teamId);
    form.append("user[save]", "");

    numericRoles.forEach(role => {
      form.append("user[user_roles][]", "3");
    });

    form.append("user[save]", "");

    // 4. SEND FINAL UPDATE
    const updateRes = await fetch(
      `${DOMJUDGE_BASE}/jury/users/${juryUserId}/edit`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Cookie": `PHPSESSID=${PHPSESSID}`
        },
        body: form.toString()
      }
    );
     // console.log(updateRes)

    if (!updateRes.ok) {
        console.log(updateRes)
      throw new Error(`Update failed for ${externalId}`);
    }

    console.log(`✅ Updated: ${externalId}`);
    return true;

  } catch (err) {
    console.error(`❌ Failed: ${localUser.username} → ${err.message}`);
    return false;
  }
}

// ─────────────────────────────────────────────
// ✅ BULK EXECUTION
// ─────────────────────────────────────────────
async function run() {
  console.log(`🚀 Starting bulk update for ${users.length} users...\n`);

  let success = 0;
  let failed = 0;

  for (const user of users) {
    const result = await updateUserFromJson(user);
    result ? success++ : failed++;
  }

  console.log("\n─────────────────────────────────");
  console.log(`✅ Success: ${success}`);
  console.log(`❌ Failed: ${failed}`);
  console.log("─────────────────────────────────");
}

run();

