import { randomUUID } from "node:crypto"
import bcrypt from "bcryptjs"
import jwt from "jsonwebtoken"
import { env } from "../../config/env.config.js"
import prisma from "../../lib/prisma.js"
import { ConflictError, UnauthorizedError } from "../../shared/utils/errors.util.js"
import type { AuthTokenPayload } from "../../shared/types/common.types.js"
import { findUserByEmail, findUserById, createUser, getUserStats } from "./auth.repository.js"
import type { RegisterDto, LoginDto, ClaimDto } from "./auth.schema.js"
import type { AuthResponseDto, UserDto } from "./auth.dto.js"

const SALT_ROUNDS = 12

const signToken = (payload: AuthTokenPayload): string => {
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: "7d" })
}

export const registerService = async (input: RegisterDto): Promise<AuthResponseDto> => {
  const existing = await findUserByEmail(input.email)
  if (existing) throw new ConflictError("Email already registered")

  const passwordHash = await bcrypt.hash(input.password, SALT_ROUNDS)
  const user = await createUser({
    email: input.email,
    passwordHash,
    name: input.name,
    timezone: input.timezone ?? "Asia/Kolkata",
  })

  const token = signToken({ id: user.id, email: user.email })
  return { user, token }
}

export const loginService = async (input: LoginDto): Promise<AuthResponseDto> => {
  const user = await findUserByEmail(input.email)
  if (!user) throw new UnauthorizedError("Invalid email or password")

  const valid = await bcrypt.compare(input.password, user.passwordHash)
  if (!valid) throw new UnauthorizedError("Invalid email or password")

  const token = signToken({ id: user.id, email: user.email })
  const userDto: UserDto = {
    id: user.id,
    email: user.email,
    name: user.name,
    timezone: user.timezone,
  }
  return { user: userDto, token }
}

export const getMeService = async (id: string): Promise<UserDto> => {
  const user = await findUserById(id)
  if (!user) throw new UnauthorizedError("User not found")
  return user
}

// Lifetime profile stats for the Settings/profile screen (B10).
export const getStatsService = (id: string) => getUserStats(id)

// First run starts before an account (ALLY.md 2.1): "Get started" makes a
// guest account, so every step saves as it goes. Its email is on a reserved
// domain no one can receive mail at, and its password is random and never
// shown, so nobody can sign in to it; only the token on that phone works.
export const GUEST_DOMAIN = "guest.ally.invalid"
export const isGuestEmail = (email: string): boolean => email.endsWith(`@${GUEST_DOMAIN}`)

export const guestService = async (timezone?: string): Promise<AuthResponseDto> => {
  const email = `guest-${randomUUID()}@${GUEST_DOMAIN}`
  const passwordHash = await bcrypt.hash(`${randomUUID()}${randomUUID()}`, SALT_ROUNDS)
  const user = await createUser({ email, passwordHash, name: "", timezone: timezone ?? "Asia/Kolkata" })
  return { user: { ...user, guest: true }, token: signToken({ id: user.id, email }) }
}

// "Save your account": the guest account gets a real email and password and
// keeps everything made so far. Only a guest account can be saved this way.
export const claimService = async (userId: string, input: ClaimDto): Promise<AuthResponseDto> => {
  const user = await findUserById(userId)
  if (!user) throw new UnauthorizedError("User not found")
  if (!isGuestEmail(user.email)) throw new ConflictError("This account is already saved.")
  if (await findUserByEmail(input.email)) throw new ConflictError("That email already has an account. Sign in with it instead.")
  const passwordHash = await bcrypt.hash(input.password, SALT_ROUNDS)
  const saved = await prisma.user.update({
    where: { id: userId },
    data: { email: input.email, passwordHash, name: input.name },
    select: { id: true, email: true, name: true, timezone: true },
  })
  return { user: { ...saved, guest: false }, token: signToken({ id: saved.id, email: saved.email }) }
}
