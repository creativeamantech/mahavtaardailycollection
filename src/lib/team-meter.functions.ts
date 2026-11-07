import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSession } from "./auth.functions";
import { EXECUTIVES } from "./executives";

const TAB = "TeamMeter";
const HEADERS = ["Date", "Hour", "Voter", "Target", "Category", "Timestamp"];
const voteSchema = z.object({
  target: z.enum(EXECUTIVES),
  category: z.enum(["Loud Voice", "Bad Words"]),
});

function indiaNow() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    hour: Number(get("hour")),
  };
}

async function prepareTab() {
  const { ensureSheetStrict } = await import("./mahavtaar.server");
  await ensureSheetStrict(TAB, HEADERS);
}

export const getTeamMeter = createServerFn({ method: "GET" }).handler(async () => {
  const session = await requireSession();
  const { date } = indiaNow();
  await prepareTab();
  const { sheetsGet } = await import("./mahavtaar.server");
  const rows = await sheetsGet(`${TAB}!A2:F`);
  const votes = rows
    .map((row) => ({
      date: String(row[0] ?? ""),
      hour: Number(row[1]),
      voter: String(row[2] ?? ""),
      target: String(row[3] ?? ""),
      category: String(row[4] ?? ""),
      timestamp: String(row[5] ?? ""),
    }))
    .filter((vote) => vote.date === date && Number.isInteger(vote.hour) && vote.hour >= 9 && vote.hour < 21);

  const hourly = Array.from({ length: 12 }, (_, index) => {
    const hour = index + 9;
    const matching = votes.filter((vote) => vote.hour === hour);
    return {
      hour,
      label: `${hour % 12 || 12} ${hour < 12 ? "AM" : "PM"}–${(hour + 1) % 12 || 12} ${hour + 1 < 12 ? "AM" : "PM"}`,
      loudVoice: matching.filter((vote) => vote.category === "Loud Voice").length,
      badWords: matching.filter((vote) => vote.category === "Bad Words").length,
    };
  });

  const executiveTotals = EXECUTIVES.map((name) => ({
    name,
    loudVoice: votes.filter((vote) => vote.target === name && vote.category === "Loud Voice").length,
    badWords: votes.filter((vote) => vote.target === name && vote.category === "Bad Words").length,
  }));
  const hourlyByExecutive = Object.fromEntries(EXECUTIVES.map((name) => [
    name,
    Object.fromEntries(Array.from({ length: 12 }, (_, index) => {
      const hour = index + 9;
      const matching = votes.filter((vote) => vote.target === name && vote.hour === hour);
      return [hour, {
        loudVoice: matching.filter((vote) => vote.category === "Loud Voice").length,
        badWords: matching.filter((vote) => vote.category === "Bad Words").length,
      }];
    })),
  ]));

  return {
    date,
    canVote: indiaNow().hour >= 9 && indiaNow().hour < 21,
    hourly,
    executiveTotals,
    hourlyByExecutive,
    // Voter identities are never sent to executive sessions.
    adminRecords: session.role === "Admin"
      ? votes.map(({ voter, target, category, hour, timestamp }) => ({ voter, target, category, hour, timestamp }))
      : [],
  };
});

export const castTeamMeterVote = createServerFn({ method: "POST" })
  .inputValidator((value: unknown) => voteSchema.parse(value))
  .handler(async ({ data }) => {
    const session = await requireSession();
    if (session.name.toLowerCase() === data.target.toLowerCase()) {
      throw new Error("You cannot vote for yourself.");
    }
    const { date, hour } = indiaNow();
    if (hour < 9 || hour >= 21) {
      throw new Error("Voting is open daily from 9:00 AM to 9:00 PM.");
    }

    const { ensureSheetStrict, sheetsGet, sheetsAppendStrict, withSheetMutex } =
      await import("./mahavtaar.server");
    await ensureSheetStrict(TAB, HEADERS);

    return withSheetMutex("team-meter-votes", async () => {
      const rows = await sheetsGet(`${TAB}!A2:F`);
      const duplicate = rows.some((row) =>
        String(row[0] ?? "") === date &&
        Number(row[1]) === hour &&
        String(row[2] ?? "").toLowerCase() === session.name.toLowerCase() &&
        String(row[3] ?? "").toLowerCase() === data.target.toLowerCase() &&
        String(row[4] ?? "") === data.category
      );
      if (duplicate) {
        throw new Error("You have already voted for this executive in this category during the current hour.");
      }
      await sheetsAppendStrict(`${TAB}!A:F`, [[
        date,
        hour,
        session.name,
        data.target,
        data.category,
        new Date().toISOString(),
      ]]);
      return { ok: true as const, target: data.target, category: data.category, hour };
    });
  });
