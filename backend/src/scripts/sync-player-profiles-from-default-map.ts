import { prisma } from "../db/prisma";
import { MapService } from "../services/mapService";

/**
 * One-off task: ensure every playerKey from /maps/default has a PlayerProfile.
 * Safe to re-run (uses upsert).
 */
async function main() {
  const mapService = new MapService();
  const map = await mapService.getMapDefault();

  // mapService returns an enriched DTO; `players` should include playerKey.
  const players: Array<any> = (map as any)?.players ?? [];

  if (!Array.isArray(players) || players.length === 0) {
    // eslint-disable-next-line no-console
    console.log("No players found in /maps/default payload");
    return;
  }

  const uniquePlayerKeys = Array.from(
    new Set(players.map((p) => p?.playerKey).filter((k): k is string => typeof k === "string" && k.length > 0))
  );

  // eslint-disable-next-line no-console
  console.log(`Ensuring PlayerProfile for ${uniquePlayerKeys.length} playerKeys...`);

  for (const playerKey of uniquePlayerKeys) {
    const mapPlayer = players.find((p) => p?.playerKey === playerKey);

    const aoeProfileId: string | undefined = mapPlayer?.aoeProfileId ?? mapPlayer?.extraJson?.aoeProfileId;
    const displayName: string | undefined = mapPlayer?.name ?? mapPlayer?.displayName;

    await prisma.playerProfile.upsert({
      where: { playerKey },
      create: {
        playerKey,
        aoeProfileId: typeof aoeProfileId === "string" ? aoeProfileId : null,
        displayName: typeof displayName === "string" ? displayName : null,
      },
      update: {
        aoeProfileId: typeof aoeProfileId === "string" ? aoeProfileId : undefined,
        displayName: typeof displayName === "string" ? displayName : undefined,
      },
    });
  }

  // eslint-disable-next-line no-console
  console.log("Done");
}

main()
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
