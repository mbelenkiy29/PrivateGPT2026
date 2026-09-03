const { PrismaClient } = require("@prisma/client");

// npx prisma introspect
// npx prisma generate
// npx prisma migrate dev --name init -> ensures that db is in sync with schema
// npx prisma migrate reset -> resets the db

const logLevels = ["error", "info", "warn"]; // add "query" to debug query logs
const prismaOptions = { log: logLevels };
if (process.env.TEST_DATABASE_URL) {
  prismaOptions.datasources = {
    db: { url: process.env.TEST_DATABASE_URL },
  };
}
const prisma = new PrismaClient(prismaOptions);

module.exports = prisma;
