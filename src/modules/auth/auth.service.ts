import bcrypt from "bcryptjs"
import jwt from "jsonwebtoken"
import { env } from "../../config/env.config.js"
import { ConflictError, UnauthorizedError } from "../../shared/utils/errors.util.js"
import type { AuthTokenPayload } from "../../shared/types/common.types.js"
import { findUserByEmail, findUserById, createUser } from "./auth.repository.js"
import type { RegisterDto, LoginDto } from "./auth.schema.js"
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
