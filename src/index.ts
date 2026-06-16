import app from "./app.js"
import { env } from "./config/env.config.js"
import logger from "./lib/logger.js"
import prisma from "./lib/prisma.js"

const PORT = parseInt(env.PORT)

async function main() {
  try {
    await prisma.$connect()
    logger.info("Database connected successfully")

    app.listen(PORT, () => {
      logger.info(`Server running on port ${PORT} in ${env.NODE_ENV} mode`)
    })
  } catch (error) {
    logger.error("Failed to start server:", error)
    await prisma.$disconnect()
    process.exit(1)
  }
}

main()
