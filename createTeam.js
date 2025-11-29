/**
 * DOMjudge CSV Import Script (Teams + Users)
 * ------------------------------------------
 * CSV format: team,uni,id
 */

import fs from "fs/promises";
import path from "path";
import readline from "readline";
import axios from "axios";
import dotenv from "dotenv";
import crypto from "crypto";

dotenv.config();
console.log("Init...");

function slugify(s) {
  // produce a safe shortname: ascii-only, lower, words joined with '-'
  if (!s) return "";
  return s
    .toString()
    .normalize("NFKD")                // normalize accents
    .replace(/[\u0300-\u036F]/g, "")  // remove diacritics
    .toLowerCase()
    .replace(/[^a-z0-9\s-_]/g, "")    // remove non-ascii chars (keep ascii letters/numbers/space/-/_)
    .trim()
    .replace(/[\s_]+/g, "-")          // spaces/underscores to dash
    .replace(/-+/g, "-");             // collapse multiple dashes
}


const UNIVERSITY_MAP = {
  "اصفهان": "University of Isfahan",
  "صنعتی شاهرود": "Shahrood University of Technology",
  "صنعتی اصفهان": "Isfahan University of Technology",
  "صنعتی شریف": "Sharif University of Technology",
  "صنعتی شیراز": "Shiraz University of Technology",
  "آزاد اسلامی واحد نجف‌آباد": "Islamic Azad University, Najafabad Branch",
  "آموزش عالی گناباد": "Gonabad Higher Education Institute",
  "پیام نور مرکزی (کهندژ)": "Payame Noor University, Central (Kahandazh)",
  "فردوسی مشهد": "Ferdowsi University of Mashhad",
  "آزاد اسلامی واحد علوم و تحقیقات": "Islamic Azad University, Science and Research Branch",
  "تهران": "University of Tehran",
  "ملی مهارت الزهرای تبریزی": "Al-Zahra Tabrizi National Skills University",
  "یزد": "Yazd University",
  "امیرکبیر": "Amirkabir University of Technology",
  "آزاد اسلامی واحد دولت‌آباد": "Islamic Azad University, Dowlatabad Branch"
};

const API_BASE = process.env.DOMJUDGE_API_BASE;
const CONTEST_ID = process.env.DOMJUDGE_CONTEST_ID;
const DOMJUDGE_USERNAME = process.env.DOMJUDGE_USERNAME;
const DOMJUDGE_PASSWORD = process.env.DOMJUDGE_PASSWORD;
const CONTEST_BASE_DIR = process.env.CONTEST_BASE_DIR;
const CONTEST_STATE_NAME = process.env.CONTEST_STATE_NAME;

const DRY = false;

// -------------------- Axios Instance --------------------
const session = axios.create({
  auth: { username: DOMJUDGE_USERNAME, password: DOMJUDGE_PASSWORD },
  headers: { "Content-Type": "application/json" },
});

// -------------------- Helper Functions --------------------

import { parse } from "csv-parse/sync";

async function getTeamsFromCSV(filePath) {
  console.log(`📄 Reading CSV data from ${filePath}`);
  const content = await fs.readFile(filePath, "utf8");
  const records = parse(content, {
    columns: false,
    relax_quotes: true,
    trim: true,
    skip_empty_lines: true
  });
  const teams = [];
  for (let idx = 0; idx < records.length; idx++) {
    const row = records[idx];
    // ✅ NEW FORMAT:
    // team, englishUni, id, rank, persianUni
    if (row.length >= 5) {
      const [team, englishUni, idStr, rankStr, persianUni] = row;
      const normalizedEnglish =
        UNIVERSITY_MAP[persianUni] || englishUni || persianUni;
      teams.push({
        team,
        uni_fa: persianUni,
        uni_en: normalizedEnglish,
        id: `${idStr}`,
      });

      console.log(
        `  • [${idx + 1}] Parsed: team='${team}', fa='${persianUni}', en='${normalizedEnglish}', id=${idStr}`
      );
    }

    // ✅ OLD FALLBACK FORMAT:
    // team, uni, id
    else if (row.length === 3) {
      const [team, uni, idStr] = row;

      teams.push({
        team,
        uni_fa: uni,
        uni_en: uni,
        id: `${idStr}`,
      });

      console.log(
        `  • [${idx + 1}] Parsed (legacy): team='${team}', uni='${uni}', id=${idStr}`
      );
    }

    else {
      console.log(`⚠️ Skipping malformed line #${idx + 1}:`, row);
    }
  }

  return teams;
}


async function getExistingUnisAndIds() {
  const resp = await session.get(
    `${API_BASE}/api/v4/contests/${CONTEST_ID}/organizations`
  );
  // Build map that includes both name and shortname (if present)
  const map = {};
  for (const u of resp.data) {
    if (u.name) map[u.name] = u.id;
    if (u.shortname) map[u.shortname] = u.id;
  }
  return map;
  //return Object.fromEntries(resp.data.map((u) => [u.name, u.id]));
}

async function getExistingTeamsAndIds() {
  const resp = await session.get(
    `${API_BASE}/api/v4/contests/${CONTEST_ID}/teams`
  );
  return Object.fromEntries(resp.data.map((t) => [t.name, t.id]));
}

async function getExistingUsersAndIds() {
  const resp = await session.get(`${API_BASE}/api/v4/users`);
  return Object.fromEntries(resp.data.map((u) => [u.username, u.id]));
}

async function createOrIgnoreUni(entry, existingUnis, existingUniNames) {
  const uniName = entry.uni_en || entry.uni_fa || entry.uni || "Unknown";
  const shortname = slugify(uniName);

   // if either the full name or shortname already exist, return that ID
  if (existingUnis[uniName]) return existingUnis[uniName];
  if (shortname && existingUnis[shortname]) return existingUnis[shortname];

  const payload = {
    id: shortname,
    shortname,
    name: uniName,
    formal_name: uniName ,
    country: "IRN",
  };
 if (DRY) {
    // mimic API-created ID for dry-run (use shortname as placeholder)
    const fakeId = shortname || uniName;
    existingUnis[uniName] = fakeId;
    if (shortname) existingUnis[shortname] = fakeId;
    existingUniNames.add(uniName);
    if (shortname) existingUniNames.add(shortname);
    return fakeId;
  }
    const resp = await session.post(
    `${API_BASE}/api/v4/contests/${CONTEST_ID}/organizations`,
    payload
  );

  
  const uniId = resp.data.id;

  // update caches: map both name and shortname to id
  existingUnis[uniName] = uniId;
  if (shortname) existingUnis[shortname] = uniId;
  existingUniNames.add(uniName);
  if (shortname) existingUniNames.add(shortname);

  console.log(`✅ University '${uniName}' (shortname='${shortname}') created with ID ${uniId}`);
  return uniId;
}

// -------------------- Main Script --------------------
(async () => {
  const csvPath = path.join(CONTEST_BASE_DIR, `${CONTEST_STATE_NAME}.csv`);
  const teams = await getTeamsFromCSV(csvPath);

  const existingUnis = await getExistingUnisAndIds();
  const existingTeams = await getExistingTeamsAndIds();
  const existingUsers = await getExistingUsersAndIds();

  const existingUniNames = new Set(Object.keys(existingUnis));
  const existingTeamNames = new Set(Object.keys(existingTeams));
  const existingUsernames = new Set(Object.keys(existingUsers));
  const existingIds = new Set([
    ...Object.values(existingTeams),
    ...Object.values(existingUsers),
  ]);

  const toCreate = teams.filter((u) => !existingTeamNames.has(u.team));
  console.log(`⏳ ${toCreate.length} new teams to create`);

  const previewPath = path.join(CONTEST_BASE_DIR, `teams_to_create.json`);
  await fs.writeFile(previewPath, JSON.stringify(toCreate, null, 2), "utf8");
  console.log(`💾 Preview saved to ${previewPath}`);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const confirm = await new Promise((resolve) =>
    rl.question(`Create these teams and users? (y/n): `, resolve)
  );
  rl.close();
  if (confirm.toLowerCase() !== "y") process.exit(0);

  const createdUsers = [];

  for (let idx = 0; idx < toCreate.length; idx++) {
    const entry = toCreate[idx];

    // Use the ID from CSV
    const uniqueId = `${entry.id}`;

    // Ensure username uniqueness
    let username = `t${uniqueId}`;
    if (existingUsernames.has(username)) username = `t${uniqueId}_${idx}`;
    existingUsernames.add(username);

    const password = crypto.randomBytes(6).toString("hex");

    // Ensure university exists
    const uniId = await createOrIgnoreUni(
      entry,
      existingUnis,
      existingUniNames
    );
    if (!uniId) continue;

    // Create team
     const teamPayload = {
      id: uniqueId,
      name: entry.team,
      display_name: entry.team,
      description: "",
      organization_id: uniId,
      group_ids: ["participants"],
    };;

    if (!DRY) {
      const teamResp = await session.post(
        `${API_BASE}/api/v4/contests/${CONTEST_ID}/teams`,
        teamPayload
      );
      console.log(`✅ Team '${entry.team}' created with ID ${uniqueId}`);
    }

    // Create user for the team
    const userPayload = {
      id: `${uniqueId}`,
      username,
      name: entry.team,
      email: null,
      //password, 
      enabled: true,
      team_id: `${uniqueId}`,
      roles: ["team"],
    };

    if (!DRY) {
      const userResp = await session.post(
        `${API_BASE}/api/v4/users`,
        userPayload
      );
      console.log(`👤 User '${username}' created with password '${password}'`);
      createdUsers.push({
        team: entry.team,
        id: uniqueId,
        username,
        password,
      });
    }
  }

  // Save created users to JSON
  const createdPath = path.join(CONTEST_BASE_DIR, `users_to_created.json`);
  await fs.writeFile(
    createdPath,
    JSON.stringify(createdUsers, null, 2),
    "utf8"
  );
  console.log(`💾 Written all new user accounts to ${createdPath}`);
})();
