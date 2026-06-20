import app from "./app.js"
import { env } from "./config/env.config.js"
import logger from "./lib/logger.js"
import prisma from "./lib/prisma.js"

const PORT = parseInt(env.PORT)

async function main() {
  try {
    await prisma.$connect()
    logger.info("Database connected successfully")

    const server = app.listen(PORT, () => {
      logger.info(`Server running on port ${PORT} in ${env.NODE_ENV} mode`)
    })

    // Graceful shutdown so deploys/restarts drain connections cleanly.
    const shutdown = async (signal: string) => {
      logger.info(`${signal} received, shutting down gracefully...`)
      server.close(async () => {
        await prisma.$disconnect()
        logger.info("Server closed, database disconnected")
        process.exit(0)
      })
      setTimeout(() => {
        logger.error("Forced shutdown after timeout")
        process.exit(1)
      }, 10_000).unref()
    }

    process.on("SIGTERM", () => void shutdown("SIGTERM"))
    process.on("SIGINT", () => void shutdown("SIGINT"))
  } catch (error) {
    logger.error("Failed to start server:", error)
    await prisma.$disconnect()
    process.exit(1)
  }
}

main()
