import { copyDatabase, purgeExpired } from "../maintenance.js";
import { DatabaseSync } from "node:sqlite";
const [command, source, destination] = process.argv.slice(2);
if (command === "backup" || command === "restore") {
  if (!source || !destination)
    throw new Error(
      "Usage: maintenance.mjs backup|restore SOURCE NEW_DESTINATION",
    );
  await copyDatabase(source, destination);
  console.log(JSON.stringify({ status: "ok", operation: command }));
} else if (command === "purge" && source) {
  const db = new DatabaseSync(source);
  try {
    console.log(
      JSON.stringify({
        removed: purgeExpired(db, {
          retentionDays: Number(process.env.CAPSULE_RETENTION_DAYS || 365),
        }),
      }),
    );
  } finally {
    db.close();
  }
} else
  throw new Error(
    "Usage: maintenance.mjs backup|restore SOURCE NEW_DESTINATION, or purge DATABASE",
  );
